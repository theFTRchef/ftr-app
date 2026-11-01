/**
 * Each app customer's cart, saved to their account (data/app-carts.json) so
 * they can leave and come back later - on the same phone or another one.
 * Only dish ids, quantities and notes are kept; prices always come from the
 * live menu when they check out.
 *
 *   { "19085551234": { cart: { lines: [{ itemId, qty, note }], liveDose: { total, md, note } | null }, updatedAt } }
 */
const store = require("./jsonFile");

const FILE = "app-carts.json";

function all() {
  const d = store.read(FILE, {});
  return d && typeof d === "object" && !Array.isArray(d) ? d : {};
}

function clean(cart) {
  const c = cart && typeof cart === "object" ? cart : {};
  const lines = (Array.isArray(c.lines) ? c.lines : []).slice(0, 40).map((l) => ({
    itemId: String(l.itemId || "").slice(0, 60),
    qty: Math.max(0, Math.min(99, Number(l.qty) || 0)),
    note: l.note ? String(l.note).slice(0, 300) : null
  })).filter((l) => l.itemId && l.qty > 0);
  const ld = c.liveDose && typeof c.liveDose === "object"
    ? { total: Number(c.liveDose.total) || 0, md: Number(c.liveDose.md) || 0, note: c.liveDose.note ? String(c.liveDose.note).slice(0, 300) : null }
    : null;
  return { lines: ld ? [] : lines, liveDose: ld && ld.total > 0 ? ld : null };
}

function get(phone) {
  return all()[phone] || { cart: { lines: [], liveDose: null }, updatedAt: null };
}

function save(phone, cart) {
  const carts = all();
  const entry = { cart: clean(cart), updatedAt: new Date().toISOString() };
  if (!entry.cart.lines.length && !entry.cart.liveDose) delete carts[phone];
  else carts[phone] = entry;
  store.write(FILE, carts);
  return entry.cart.lines.length || entry.cart.liveDose ? entry : { cart: entry.cart, updatedAt: entry.updatedAt };
}

function remove(phone) {
  const carts = all();
  if (carts[phone]) {
    delete carts[phone];
    store.write(FILE, carts);
  }
}

module.exports = { get, save, remove };
