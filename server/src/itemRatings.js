// Star ratings (1-5) with an optional comment, per menu item.
// Only customers who received an item can rate it: their order is Confirmed and
// its date has passed. One rating per customer per item; they can change it.
// Customers see each item's average and count; comments are for Chef only.

const store = require("./jsonFile");
const orderDb = require("./orderDb");
const { njToday } = require("./menuStore");

const FILE = "ratings.json";
const MIN_TO_SHOW = 3; // averages appear on the menu from this many ratings

const all = () => store.read(FILE, {});

/** Items this customer can rate: from Confirmed orders whose date has arrived. */
function rateable(phone) {
  const today = njToday();
  const seen = new Map();
  orderDb
    .all()
    .filter((o) => o.customerPhone === phone && o.status === "Confirmed" && o.eventDate && o.eventDate <= today)
    .sort((a, b) => String(b.eventDate).localeCompare(String(a.eventDate)))
    .forEach((o) => {
      (o.cart || []).forEach((l) => {
        if (!l.id || seen.has(l.id)) return;
        seen.set(l.id, { itemId: l.id, title: l.isLiveDoseStation ? "LIVE Dose Station" : l.title, orderId: o.orderId, eventDate: o.eventDate });
      });
    });
  return [...seen.values()];
}

function mine(phone) {
  const r = all();
  const ratings = {};
  for (const [itemId, byPhone] of Object.entries(r)) if (byPhone[phone]) ratings[itemId] = { stars: byPhone[phone].stars, comment: byPhone[phone].comment || "" };
  return rateable(phone).map((it) => ({ ...it, ...(ratings[it.itemId] || { stars: 0, comment: "" }) }));
}

function rate(phone, name, itemId, stars, comment) {
  const item = rateable(phone).find((x) => x.itemId === itemId);
  if (!item) {
    const e = new Error("You can rate a dish once you've received it.");
    e.status = 403;
    throw e;
  }
  const n = Math.round(Number(stars));
  if (!(n >= 1 && n <= 5)) {
    const e = new Error("Choose 1 to 5 stars.");
    e.status = 400;
    throw e;
  }
  const r = all();
  r[itemId] = r[itemId] || {};
  r[itemId][phone] = { stars: n, comment: String(comment || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 500), name: String(name || "").slice(0, 80), title: item.title, orderId: item.orderId, at: new Date().toISOString() };
  store.write(FILE, r);
  return { itemId, stars: n, comment: r[itemId][phone].comment };
}

function unrate(phone, itemId) {
  const r = all();
  if (r[itemId] && r[itemId][phone]) {
    delete r[itemId][phone];
    if (!Object.keys(r[itemId]).length) delete r[itemId];
    store.write(FILE, r);
  }
}

/** Remove everything a customer rated (account deleted). */
function clear(phone) {
  const r = all();
  let changed = false;
  for (const id of Object.keys(r)) {
    if (r[id][phone]) {
      delete r[id][phone];
      if (!Object.keys(r[id]).length) delete r[id];
      changed = true;
    }
  }
  if (changed) store.write(FILE, r);
}

/** Public summary for the menu: { itemId: { avg, count } }, only with enough ratings. */
function summaries() {
  const out = {};
  for (const [id, byPhone] of Object.entries(all())) {
    const list = Object.values(byPhone);
    if (list.length >= MIN_TO_SHOW) out[id] = { avg: Math.round((list.reduce((t, x) => t + x.stars, 0) / list.length) * 10) / 10, count: list.length };
  }
  return out;
}

/** Chef's Kitchen: every item with its ratings and comments. */
function forChef() {
  return Object.entries(all())
    .map(([itemId, byPhone]) => {
      const list = Object.entries(byPhone).map(([phone, x]) => ({ phone, name: x.name, stars: x.stars, comment: x.comment, orderId: x.orderId, at: x.at }));
      list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      const avg = list.reduce((t, x) => t + x.stars, 0) / list.length;
      return { itemId, title: list.length ? Object.values(byPhone)[0].title : itemId, avg: Math.round(avg * 10) / 10, count: list.length, shown: list.length >= MIN_TO_SHOW, ratings: list };
    })
    .sort((a, b) => b.count - a.count);
}

/** Chef removes one rating (spam or a mistake). */
function removeOne(itemId, phone) {
  unrate(phone, itemId);
}

module.exports = { rateable, mine, rate, unrate, clear, summaries, forChef, removeOne, MIN_TO_SHOW };
