/**
 * Where each customer is in their WhatsApp conversation (which step, cart,
 * date, address...), keyed by their WhatsApp number.
 *
 * Saved to data/sessions.json so it survives bot restarts and long gaps.
 * A customer who comes back later is offered "continue where you left
 * off" (see orderFlow.js). Sessions untouched for 14 days are dropped.
 */
const store = require("./jsonFile");

const FILE = "sessions.json";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

let sessions = null;

function load() {
  if (sessions) return sessions;
  const raw = store.read(FILE, {});
  sessions = new Map(Object.entries(raw && typeof raw === "object" ? raw : {}));
  prune();
  return sessions;
}

function save() {
  store.write(FILE, Object.fromEntries(sessions));
}

function prune() {
  const now = Date.now();
  let changed = false;
  for (const [phone, s] of sessions) {
    if (!s || now - (s.updatedAt || 0) > SESSION_TTL_MS) {
      sessions.delete(phone);
      changed = true;
    }
  }
  if (changed) save();
}

function get(phoneNumber) {
  const session = load().get(phoneNumber);
  if (!session) return null;
  if (Date.now() - (session.updatedAt || 0) > SESSION_TTL_MS) {
    sessions.delete(phoneNumber);
    save();
    return null;
  }
  return session;
}

function set(phoneNumber, session) {
  load().set(phoneNumber, { ...session, updatedAt: Date.now() });
  save();
}

function clear(phoneNumber) {
  if (load().delete(phoneNumber)) save();
}

function getOrCreate(phoneNumber) {
  const existing = get(phoneNumber);
  if (existing) return existing;
  const fresh = {
    step: "NEW",
    cart: [],
    fulfillment: null,
    address: null,
    requestedTime: null,
    updatedAt: Date.now()
  };
  set(phoneNumber, fresh);
  return fresh;
}

/** Forget every customer's in-progress conversation (used by admin reset). */
function clearAll() {
  load().clear();
  save();
}

module.exports = { get, set, clear, getOrCreate, clearAll };
