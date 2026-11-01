/**
 * Small helpers for turning a start/end time window into fixed-length
 * bookable slots (e.g. a 10:00-18:00 window at 120 min slots becomes
 * 10:00-12:00, 12:00-14:00, 14:00-16:00, 16:00-18:00). Only full-length
 * slots that fit entirely inside the window are offered - a window that
 * isn't an exact multiple of the slot length just loses its leftover
 * minutes at the end rather than offering a short slot.
 */

function isValidTime(t) {
  return /^\d{2}:\d{2}$/.test(t || "");
}

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatTimeLabel(t) {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * Returns an array of { start, end, label } slots between window.start
 * and window.end (both "HH:MM" 24h strings), each `slotLengthMinutes`
 * long. Returns [] if the window is invalid or shorter than one slot.
 */
function generateSlots(window, slotLengthMinutes) {
  if (!window || !isValidTime(window.start) || !isValidTime(window.end)) return [];
  const startMin = timeToMinutes(window.start);
  const endMin = timeToMinutes(window.end);
  const length = Number(slotLengthMinutes) > 0 ? Number(slotLengthMinutes) : 120;
  const slots = [];
  for (let s = startMin; s + length <= endMin; s += length) {
    const startTime = minutesToTime(s);
    const endTime = minutesToTime(s + length);
    slots.push({
      start: startTime,
      end: endTime,
      label: `${formatTimeLabel(startTime)} - ${formatTimeLabel(endTime)}`
    });
  }
  return slots;
}

/**
 * Combines the applicable window(s) for a cart into one window: if only
 * one order type is present, that type's window is used as-is; if both
 * are present, the overlap of both windows is used (so the customer
 * picks one slot that works for the whole order).
 */
function combinedWindow(dateEntry, hasCatering, hasLiveDose) {
  let start = null;
  let end = null;
  if (hasCatering && dateEntry.catering) {
    start = dateEntry.catering.start;
    end = dateEntry.catering.end;
  }
  if (hasLiveDose && dateEntry.liveDose) {
    if (start === null) {
      start = dateEntry.liveDose.start;
      end = dateEntry.liveDose.end;
    } else {
      start = timeToMinutes(start) > timeToMinutes(dateEntry.liveDose.start) ? start : dateEntry.liveDose.start;
      end = timeToMinutes(end) < timeToMinutes(dateEntry.liveDose.end) ? end : dateEntry.liveDose.end;
    }
  }
  if (start === null || end === null || timeToMinutes(start) >= timeToMinutes(end)) return null;
  return { start, end };
}

/**
 * LIVE Dose Station appointments aren't the fixed grid used for regular
 * catering slots - the crew needs setup and close-out time regardless of
 * order size, plus a serving window that scales with how many plates
 * were ordered. All of these values are editable in /admin (stored on
 * the category's liveDoseStation config); the defaults below match the
 * business's real numbers as a fallback.
 */
const DEFAULT_LDS_TIMING = {
  setupMinutes: 30,
  closeoutMinutes: 30,
  delayFeePerHour: 200,
  servingMinutesByTotal: { 100: 75, 150: 90, 200: 120 }
};

function ldsTiming(config) {
  return {
    setupMinutes: Number(config?.setupMinutes) >= 0 ? Number(config.setupMinutes) : DEFAULT_LDS_TIMING.setupMinutes,
    closeoutMinutes:
      Number(config?.closeoutMinutes) >= 0 ? Number(config.closeoutMinutes) : DEFAULT_LDS_TIMING.closeoutMinutes,
    delayFeePerHour:
      Number(config?.delayFeePerHour) >= 0 ? Number(config.delayFeePerHour) : DEFAULT_LDS_TIMING.delayFeePerHour,
    servingMinutesByTotal: config?.servingMinutesByTotal || DEFAULT_LDS_TIMING.servingMinutesByTotal
  };
}

function liveDoseServingMinutes(total, config) {
  const t = ldsTiming(config);
  const mapped = t.servingMinutesByTotal[total] ?? t.servingMinutesByTotal[String(total)];
  if (mapped != null) return Number(mapped);
  // Fallback for a custom total not in the table - scale from the largest
  // configured data point so a changed min/max/increment still works.
  const keys = Object.keys(t.servingMinutesByTotal).map(Number).filter(Boolean).sort((a, b) => a - b);
  if (keys.length === 0) return Math.round(total * 0.6);
  const largest = keys[keys.length - 1];
  const rate = Number(t.servingMinutesByTotal[largest]) / largest;
  return Math.round(total * rate);
}

function liveDoseTotalMinutes(total, config) {
  const t = ldsTiming(config);
  return t.setupMinutes + liveDoseServingMinutes(total, config) + t.closeoutMinutes;
}

/**
 * Given a slot start time and the total plates ordered, returns the
 * operational schedule: crew arrival, first dose ready, last dose ready,
 * and wrap-up complete (= slot end).
 */
function liveDoseSchedule(slotStart, total, config) {
  const t = ldsTiming(config);
  const startMin = timeToMinutes(slotStart);
  const serving = liveDoseServingMinutes(total, config);
  const firstDoseMin = startMin + t.setupMinutes;
  const lastDoseMin = firstDoseMin + serving;
  const wrapUpMin = lastDoseMin + t.closeoutMinutes;
  return {
    arrival: slotStart,
    firstDose: minutesToTime(firstDoseMin),
    lastDose: minutesToTime(lastDoseMin),
    wrapUp: minutesToTime(wrapUpMin),
    delayFeePerHour: t.delayFeePerHour,
    totalMinutes: t.setupMinutes + serving + t.closeoutMinutes
  };
}

module.exports = {
  isValidTime,
  timeToMinutes,
  minutesToTime,
  formatTimeLabel,
  generateSlots,
  combinedWindow,
  ldsTiming,
  liveDoseServingMinutes,
  liveDoseTotalMinutes,
  liveDoseSchedule
};
