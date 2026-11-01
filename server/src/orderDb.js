/**
 * Every order and custom request, stored on the server in data/orders.json.
 * This is the main record - the Google Sheet (if connected) is a live copy.
 *
 * Each record keeps the full order (cart lines with notes, customer name,
 * address, requested time) plus:
 *   status    - Pending Approval / Confirmed / Declined / Custom - Awaiting
 *               Quote / Quote Sent / Quote Declined
 *   pending   - true while waiting on the chef (or on the customer for a
 *               quote). Because this lives on disk, Approve/Decline buttons
 *               keep working after the bot restarts.
 *   createdAt / updatedAt - ISO timestamps
 */
const store = require("./jsonFile");

const FILE = "orders.json";

function all() {
  const data = store.read(FILE, []);
  return Array.isArray(data) ? data : [];
}

function get(orderId) {
  return all().find((o) => o.orderId === orderId) || null;
}

/** Insert or replace a whole order record. */
function upsert(order) {
  const orders = all();
  const now = new Date().toISOString();
  const idx = orders.findIndex((o) => o.orderId === order.orderId);
  if (idx === -1) {
    orders.push({ createdAt: now, ...order, updatedAt: now });
  } else {
    orders[idx] = { ...orders[idx], ...order, createdAt: orders[idx].createdAt, updatedAt: now };
  }
  store.write(FILE, orders);
}

/** Merge a few fields into an existing order. */
function update(orderId, patch) {
  const orders = all();
  const idx = orders.findIndex((o) => o.orderId === orderId);
  if (idx === -1) return null;
  orders[idx] = { ...orders[idx], ...patch, updatedAt: new Date().toISOString() };
  store.write(FILE, orders);
  return orders[idx];
}

/** Permanently remove one order. Returns the removed record (or null). */
function remove(orderId) {
  const orders = all();
  const idx = orders.findIndex((o) => o.orderId === orderId);
  if (idx === -1) return null;
  const [removed] = orders.splice(idx, 1);
  store.write(FILE, orders);
  return removed;
}

/**
 * Remove every order. A copy is saved first to data/backups/ so a reset
 * can be undone by hand if it was a mistake. Returns how many were removed.
 */
function clearAll() {
  const orders = all();
  if (orders.length) store.backup(FILE, orders);
  store.write(FILE, []);
  return orders.length;
}

module.exports = { all, get, upsert, update, remove, clearAll };
