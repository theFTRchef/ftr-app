/**
 * Chef availability model, shared by menuStore (validation on save) and
 * orderFlow (what customers can book).
 *
 * Each weekend date can offer any mix of:
 *   - pickupAM / pickupPM: catering pickup at the site-wide AM / PM pickup
 *     times (default "pickup by 11:30 AM" for lunch, "by 6:00 PM" for
 *     dinner) - the chef cooks that morning/afternoon for those orders.
 *   - catering: one or more delivery windows, e.g. 12-3 PM and 6-9 PM.
 *   - liveDose: one or more LIVE Dose Station windows.
 *
 * Older menu.json files stored catering/liveDose as a single {start,end}
 * object (or null) and had no pickup flags - normalizeDateEntry upgrades
 * those transparently, so nothing breaks on first load.
 */
const { isValidTime, timeToMinutes } = require("./timeUtils");

const DEFAULT_PICKUP_TIMES = { am: "11:30", pm: "18:00" };

function toWindowList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((w) => w && (w.start || w.end));
}

function normalizeDateEntry(entry) {
  return {
    date: entry.date,
    pickupAM: !!entry.pickupAM,
    pickupPM: !!entry.pickupPM,
    catering: toWindowList(entry.catering).map((w) => ({ start: w.start, end: w.end })),
    liveDose: toWindowList(entry.liveDose).map((w) => ({ start: w.start, end: w.end }))
  };
}

function pickupTimes(menu) {
  const p = menu?.availability?.pickupTimes || {};
  return {
    am: isValidTime(p.am) ? p.am : DEFAULT_PICKUP_TIMES.am,
    pm: isValidTime(p.pm) ? p.pm : DEFAULT_PICKUP_TIMES.pm
  };
}

function hasPickup(d) {
  return d.pickupAM || d.pickupPM;
}

function offersCatering(d) {
  return hasPickup(d) || d.catering.length > 0;
}

function offersLiveDose(d) {
  return d.liveDose.length > 0;
}

/** Throws a readable error for the admin page if a window is bad. */
function validateWindow(w, label, dateStr) {
  if (!isValidTime(w.start) || !isValidTime(w.end)) {
    throw new Error(`${dateStr}: every ${label} window needs both a start and end time`);
  }
  if (timeToMinutes(w.start) >= timeToMinutes(w.end)) {
    throw new Error(`${dateStr}: a ${label} window's end time must be after its start time`);
  }
}

function sortWindows(list) {
  return [...list].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
}

/** Catering pickup-only switch (admin Setup). On unless switched off. */
function pickupOnly(menu) {
  return !(menu && menu.settings && menu.settings.cateringPickupOnly === false);
}

/**
 * The menu as customers see it: with catering set to pickup-only, catering
 * delivery windows are left out everywhere (date list, calendar, checkout).
 */
function customerView(menu) {
  if (!pickupOnly(menu) || !menu.availability || !Array.isArray(menu.availability.dates)) return menu;
  return {
    ...menu,
    availability: {
      ...menu.availability,
      dates: menu.availability.dates.map((d) => ({ ...normalizeDateEntry(d), catering: [] }))
    }
  };
}

module.exports = {
  pickupOnly,
  customerView,
  DEFAULT_PICKUP_TIMES,
  normalizeDateEntry,
  pickupTimes,
  hasPickup,
  offersCatering,
  offersLiveDose,
  validateWindow,
  sortWindows
};
