const fs = require("fs");
const path = require("path");
const { isValidTime } = require("./timeUtils");
const {
  normalizeDateEntry,
  validateWindow,
  sortWindows,
  DEFAULT_PICKUP_TIMES
} = require("./availability");

const DATA_PATH = path.join(__dirname, "..", "data", "menu.json");

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 30);
}

function uniqueId(base, existingIds) {
  let id = base || "item";
  let n = 2;
  while (existingIds.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

// Parses a "YYYY-MM-DD" string as a UTC calendar date so weekday checks
// don't shift depending on server timezone.
function dayOfWeekUTC(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun, 6 = Sat
}

function isWeekend(dateStr) {
  const dow = dayOfWeekUTC(dateStr);
  return dow === 0 || dow === 6;
}

function getMenu() {
  const raw = fs.readFileSync(DATA_PATH, "utf8");
  const menu = JSON.parse(raw);
  // Upgrade older single-window dates to the multi-window/pickup shape.
  if (menu.availability && Array.isArray(menu.availability.dates)) {
    menu.availability.dates = menu.availability.dates.map(normalizeDateEntry);
  }
  return menu;
}

function saveMenu(menu) {
  // Basic shape validation so a malformed admin save can't corrupt the
  // live file the bot reads from on every message.
  if (!menu || !Array.isArray(menu.categories) || !menu.settings) {
    throw new Error("Invalid menu shape - expected { settings, categories }");
  }
  for (const category of menu.categories) {
    if (!category.title || !Array.isArray(category.items)) {
      throw new Error(`Category "${category.title || "?"}" is missing a title or items array`);
    }
    for (const item of category.items) {
      if (!item.title || typeof item.price !== "number" || item.price < 0) {
        throw new Error(`Item "${item.title || "?"}" needs a title and a non-negative price`);
      }
    }
  }

  // Fill in any missing ids (new categories/items added via the admin UI
  // arrive without one).
  const categoryIds = new Set(menu.categories.map((c) => c.id).filter(Boolean));
  for (const category of menu.categories) {
    if (!category.id) {
      category.id = uniqueId(slugify(category.title), categoryIds);
      categoryIds.add(category.id);
    }
    const itemIds = new Set(category.items.map((i) => i.id).filter(Boolean));
    for (const item of category.items) {
      if (!item.id) {
        item.id = uniqueId(slugify(item.title), itemIds);
        itemIds.add(item.id);
      }
      item.price = Number(item.price) || 0;
      item.servesMin = item.servesMin ? Number(item.servesMin) : 1;
      item.servesMax = item.servesMax ? Number(item.servesMax) : item.servesMin;
      item.minQty = item.minQty && Number(item.minQty) > 0 ? Number(item.minQty) : 1;
      item.maxQty = item.maxQty && Number(item.maxQty) > 0 ? Number(item.maxQty) : null;
    }
  }
  if (String(menu.settings.tagline || "").trim().length > 300) {
    throw new Error("Tagline must be 300 characters or fewer.");
  }
  if (String(menu.settings.businessName || "").trim().length > 60) {
    throw new Error("Business name must be 60 characters or fewer.");
  }
  menu.settings.minOrderSubtotal = Number(menu.settings.minOrderSubtotal) || 0;
  menu.settings.halfTrays = menu.settings.halfTrays === true;
  menu.settings.cateringPickupOnly = menu.settings.cateringPickupOnly !== false;
  menu.settings.shortName = String(menu.settings.shortName || "").trim().slice(0, 20) || "FTR";
  const hp = Number(menu.settings.halfTrayPercent);
  menu.settings.halfTrayPercent = hp > 0 && hp <= 100 ? hp : 65;
  menu.settings.minOrderHalfTray = Number(menu.settings.minOrderHalfTray) > 0 ? Number(menu.settings.minOrderHalfTray) : 0;
  const del = menu.settings.delivery || {};
  menu.settings.delivery = {
    kitchenAddress: (del.kitchenAddress || "").trim(),
    kitchenLat: typeof del.kitchenLat === "number" ? del.kitchenLat : null,
    kitchenLon: typeof del.kitchenLon === "number" ? del.kitchenLon : null,
    maxMiles: Number(del.maxMiles) > 0 ? Number(del.maxMiles) : null,
    ldsMaxMiles: Number(del.ldsMaxMiles) > 0 ? Number(del.ldsMaxMiles) : null
  };
  const pay = menu.settings.payment || {};
  const num = (v, dflt, min = 0) => (v === "" || v == null || !(Number(v) >= min) ? dflt : Number(v));
  const pct = Number(pay.depositPercent);
  const hrs = Number(pay.deadlineHours);
  if (pay.enabled && !String(pay.zelleTo || "").trim()) {
    throw new Error("Enter your Zelle email or phone before turning on Zelle deposits.");
  }
  if (pay.ldsTime && !isValidTime(pay.ldsTime)) throw new Error("LIVE Dose deposit time must be a valid time");
  menu.settings.payment = {
    enabled: pay.enabled === true,
    cateringHoursBefore: num(pay.cateringHoursBefore, 48),
    ldsDaysBefore: num(pay.ldsDaysBefore, 3),
    ldsTime: pay.ldsTime || "10:00",
    zelleTo: String(pay.zelleTo || "").trim(),
    zelleName: String(pay.zelleName || "").trim(),
    depositPercent: pct > 0 && pct <= 100 ? pct : 50,
    deadlineHours: hrs > 0 ? hrs : 24
  };
  menu.settings.maxOrderQtyPerItem =
    Number(menu.settings.maxOrderQtyPerItem) > 0
      ? Number(menu.settings.maxOrderQtyPerItem)
      : 4;

  if (!menu.availability || !Array.isArray(menu.availability.dates)) {
    menu.availability = { dates: [] };
  }
  menu.availability.slotLengthMinutes =
    Number(menu.availability.slotLengthMinutes) > 0
      ? Number(menu.availability.slotLengthMinutes)
      : 120;

  const pt = menu.availability.pickupTimes || {};
  for (const [key, label] of [["am", "AM pickup"], ["pm", "PM pickup"]]) {
    if (pt[key] && !isValidTime(pt[key])) {
      throw new Error(`${label} time must be a valid time`);
    }
  }
  const sess = Array.isArray(menu.availability.liveDoseSessions) ? menu.availability.liveDoseSessions : null;
  if (sess) {
    sess.forEach((w, i) => {
      if (!isValidTime(w.start) || !isValidTime(w.end) || w.end <= w.start) {
        throw new Error(`LIVE Dose session ${i + 1} needs a start time before its end time`);
      }
    });
    menu.availability.liveDoseSessions = sess.map((w) => ({ start: w.start, end: w.end, ...(w.label ? { label: String(w.label).slice(0, 20) } : {}) }));
  }
  const ext = menu.availability.ldsExtension || {};
  menu.availability.ldsExtension = {
    minutes: Number(ext.minutes) > 0 ? Number(ext.minutes) : 30,
    fee: Number(ext.fee) >= 0 && ext.fee !== "" && ext.fee != null ? Number(ext.fee) : 100
  };
  menu.availability.pickupTimes = {
    am: pt.am || DEFAULT_PICKUP_TIMES.am,
    pm: pt.pm || DEFAULT_PICKUP_TIMES.pm
  };

  const seenDates = new Set();
  menu.availability.dates = menu.availability.dates.map((raw) => {
    const entry = normalizeDateEntry(raw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date || "")) {
      throw new Error(`Availability date "${entry.date || "?"}" isn't a valid YYYY-MM-DD date`);
    }
    if (!isWeekend(entry.date)) {
      throw new Error(
        `${entry.date} is a weekday - only Saturdays and Sundays can be marked available`
      );
    }
    if (seenDates.has(entry.date)) {
      throw new Error(`${entry.date} is listed more than once in availability`);
    }
    seenDates.add(entry.date);
    entry.catering.forEach((w) => validateWindow(w, "catering delivery", entry.date));
    entry.liveDose.forEach((w) => validateWindow(w, "LIVE Dose Station", entry.date));
    entry.catering = sortWindows(entry.catering);
    entry.liveDose = sortWindows(entry.liveDose);
    return entry;
  });
  menu.availability.dates.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  fs.writeFileSync(DATA_PATH, JSON.stringify(menu, null, 2));
  return menu;
}

module.exports = { getMenu, saveMenu, isWeekend, dayOfWeekUTC };
