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
 *   - bookedAM / bookedPM: Chef is booked (e.g. a private event) for lunch /
 *     dinner. Customers see "Booked" instead of "not available"; a booked
 *     pickup is never open at the same time.
 *
 * Older menu.json files stored catering/liveDose as a single {start,end}
 * object (or null) and had no pickup flags - normalizeDateEntry upgrades
 * those transparently, so nothing breaks on first load.
 */
const { isValidTime, timeToMinutes } = require("./timeUtils");

const DEFAULT_PICKUP_TIMES = { am: "11:30", pm: "18:30" };

// Standard LIVE Dose Station on-site times, used on every chef day.
const DEFAULT_LDS_SESSIONS = [
  { start: "11:00", end: "13:00", label: "Lunch" },
  { start: "19:00", end: "21:00", label: "Evening" }
];
const DEFAULT_LDS_EXTENSION = { minutes: 30, fee: 100 };

function ldsSessions(menu) {
  const list = menu?.availability?.liveDoseSessions;
  const ok = Array.isArray(list) ? list.filter((w) => w && isValidTime(w.start) && isValidTime(w.end) && timeToMinutes(w.end) > timeToMinutes(w.start)) : [];
  const out = ok.length ? ok : DEFAULT_LDS_SESSIONS;
  return out.map((w, i) => ({ start: w.start, end: w.end, label: w.label || (timeToMinutes(w.start) < 15 * 60 ? "Lunch" : "Evening") || `Session ${i + 1}` }));
}

function ldsExtension(menu) {
  const e = menu?.availability?.ldsExtension || {};
  return {
    minutes: Number(e.minutes) > 0 ? Number(e.minutes) : DEFAULT_LDS_EXTENSION.minutes,
    fee: Number(e.fee) >= 0 && e.fee !== "" && e.fee != null ? Number(e.fee) : DEFAULT_LDS_EXTENSION.fee
  };
}

/** Standard sessions a day offers: a session is on if any of the day's LIVE Dose windows overlaps it. */
function sessionsForDay(menu, entry) {
  const wins = toWindowList(entry.liveDose).filter((w) => isValidTime(w.start) && isValidTime(w.end));
  return ldsSessions(menu).filter((s) =>
    wins.some((w) => timeToMinutes(w.start) < timeToMinutes(s.end) && timeToMinutes(w.end) > timeToMinutes(s.start))
  );
}

function toWindowList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((w) => w && (w.start || w.end));
}

function normalizeDateEntry(entry) {
  const bookedAM = !!entry.bookedAM;
  const bookedPM = !!entry.bookedPM;
  return {
    date: entry.date,
    pickupAM: !!entry.pickupAM && !bookedAM,
    pickupPM: !!entry.pickupPM && !bookedPM,
    bookedAM,
    bookedPM,
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

function isBooked(d) {
  return !!(d && (d.bookedAM || d.bookedPM));
}

/** "Lunch & dinner" / "Lunch" / "Dinner" for a booked day. */
function bookedLabel(d) {
  return d.bookedAM && d.bookedPM ? "Lunch & dinner" : d.bookedAM ? "Lunch" : d.bookedPM ? "Dinner" : "";
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
 * The menu as customers see it: LIVE Dose windows become the standard
 * on-site sessions, and with catering set to pickup-only, catering delivery
 * windows are left out everywhere (date list, calendar, checkout).
 */
function customerView(menu) {
  if (!menu || !menu.availability || !Array.isArray(menu.availability.dates)) return menu;
  const noDelivery = pickupOnly(menu);
  return {
    ...menu,
    availability: {
      ...menu.availability,
      dates: menu.availability.dates.map((d) => {
        const e = normalizeDateEntry(d);
        // LIVE Dose is only ever offered at the standard on-site times.
        e.liveDose = sessionsForDay(menu, e).map((s) => ({ start: s.start, end: s.end, label: s.label }));
        if (noDelivery) e.catering = [];
        return e;
      })
    },
    // Pre-order sections (Dose-in-a-Box, weekly takeout): only dishes with a
    // price, each tagged so the cart knows it's a pre-order.
    categories: (menu.categories || []).map((c) =>
      c.type === "preorder"
        ? { ...c, items: (c.items || []).filter((i) => Number(i.price) > 0).map((i) => ({ ...i, isPreorder: true })) }
        : c
    )
  };
}

module.exports = {
  DEFAULT_LDS_SESSIONS,
  ldsSessions,
  ldsExtension,
  sessionsForDay,
  pickupOnly,
  customerView,
  DEFAULT_PICKUP_TIMES,
  normalizeDateEntry,
  pickupTimes,
  hasPickup,
  offersCatering,
  offersLiveDose,
  isBooked,
  bookedLabel,
  validateWindow,
  sortWindows
};
