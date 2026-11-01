/**
 * Customers who have signed in to the FTR iOS app, keyed by the same phone
 * number format the WhatsApp bot uses (digits only, e.g. "19085551234"),
 * so one customer is one customer whichever way they order.
 *
 * Stored in data/app-users.json:
 *   { "19085551234": {
 *       createdAt,
 *       sessions:   [{ hash, createdAt, lastSeenAt, device }],   // sign-ins (token hashes only)
 *       pushTokens: [{ token, environment, updatedAt }]           // APNs device tokens
 *   } }
 *
 * Names and addresses are NOT kept here - they live in customers.json via
 * customerStore, shared with the WhatsApp bot and the Sheet's Customers tab.
 */
const crypto = require("crypto");
const store = require("./jsonFile");

const FILE = "app-users.json";
const SESSION_DAYS = 180;
const MAX_SESSIONS = 10;

function all() {
  const data = store.read(FILE, {});
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

function hash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function isAppUser(phone) {
  return !!all()[phone];
}

function get(phone) {
  return all()[phone] || null;
}

/** New sign-in for this phone. Returns the raw token (only time it exists). */
function createSession(phone, device = "") {
  const users = all();
  const now = new Date().toISOString();
  const token = crypto.randomBytes(32).toString("base64url");
  const user = users[phone] || { createdAt: now, sessions: [], pushTokens: [] };
  const cutoff = Date.now() - SESSION_DAYS * 86400000;
  user.sessions = (user.sessions || [])
    .filter((s) => Date.parse(s.lastSeenAt || s.createdAt) > cutoff)
    .slice(-(MAX_SESSIONS - 1));
  user.sessions.push({ hash: hash(token), createdAt: now, lastSeenAt: now, device: String(device).slice(0, 60) });
  users[phone] = user;
  store.write(FILE, users);
  return token;
}

/** Phone number for a bearer token, or null. Touches lastSeenAt at most hourly. */
function phoneForToken(token) {
  if (!token) return null;
  const h = hash(token);
  const users = all();
  const cutoff = Date.now() - SESSION_DAYS * 86400000;
  for (const [phone, user] of Object.entries(users)) {
    const s = (user.sessions || []).find((x) => x.hash === h);
    if (!s) continue;
    const last = Date.parse(s.lastSeenAt || s.createdAt);
    if (last < cutoff) return null;
    if (Date.now() - last > 3600000) {
      s.lastSeenAt = new Date().toISOString();
      store.write(FILE, users);
    }
    return phone;
  }
  return null;
}

function endSession(token) {
  const h = hash(token);
  const users = all();
  for (const user of Object.values(users)) {
    const before = (user.sessions || []).length;
    user.sessions = (user.sessions || []).filter((x) => x.hash !== h);
    if (user.sessions.length !== before) {
      store.write(FILE, users);
      return true;
    }
  }
  return false;
}

function savePushToken(phone, token, environment) {
  if (!/^[a-f0-9]{32,200}$/i.test(String(token || ""))) throw new Error("That doesn't look like a push token.");
  const users = all();
  const user = users[phone];
  if (!user) return;
  // A device token belongs to one phone at a time.
  for (const u of Object.values(users)) u.pushTokens = (u.pushTokens || []).filter((t) => t.token !== token);
  user.pushTokens.push({
    token,
    environment: environment === "sandbox" ? "sandbox" : "production",
    updatedAt: new Date().toISOString()
  });
  user.pushTokens = user.pushTokens.slice(-5);
  store.write(FILE, users);
}

function removePushToken(token) {
  const users = all();
  let changed = false;
  for (const u of Object.values(users)) {
    const before = (u.pushTokens || []).length;
    u.pushTokens = (u.pushTokens || []).filter((t) => t.token !== token);
    if (u.pushTokens.length !== before) changed = true;
  }
  if (changed) store.write(FILE, users);
}

/** Account deletion from inside the app (required by the App Store). */
function remove(phone) {
  const users = all();
  if (!users[phone]) return false;
  delete users[phone];
  store.write(FILE, users);
  return true;
}

module.exports = { isAppUser, get, createSession, phoneForToken, endSession, savePushToken, removePushToken, remove };
