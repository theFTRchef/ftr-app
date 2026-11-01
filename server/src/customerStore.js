/**
 * Customer profiles keyed by WhatsApp number, stored in data/customers.json.
 * Lets the bot greet returning customers by name and offer their last
 * delivery address instead of asking every time.
 *
 * { "19085551234": { firstName, lastName, address, createdAt, updatedAt } }
 */
const store = require("./jsonFile");

const FILE = "customers.json";

function all() {
  const data = store.read(FILE, {});
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

function get(phone) {
  return all()[phone] || null;
}

function save(phone, patch) {
  const customers = all();
  const now = new Date().toISOString();
  customers[phone] = {
    createdAt: now,
    ...(customers[phone] || {}),
    ...patch,
    updatedAt: now
  };
  store.write(FILE, customers);
  sync();
  return customers[phone];
}

function fullName(profile) {
  if (!profile) return "";
  return [profile.firstName, profile.lastName].filter(Boolean).join(" ");
}

/**
 * Delete ONE customer. Only called from the admin page's per-customer
 * Delete button - there is deliberately no way to delete all customers.
 * A copy is kept in data/backups/ first.
 */
function remove(phone) {
  const customers = all();
  if (!customers[phone]) return null;
  const removed = customers[phone];
  store.backup(`customer-${phone}.json`, { phone, ...removed });
  delete customers[phone];
  store.write(FILE, customers);
  sync();
  return removed;
}

/** Mirror to the Google Sheet "Customers" tab (debounced, never blocks). */
function sync() {
  try {
    require("./customerSheet").scheduleSync();
  } catch (e) {
    /* sheet mirror is optional */
  }
}

module.exports = { all, get, save, fullName, remove };
