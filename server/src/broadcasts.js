/**
 * Chef's announcements to customers, and automatic "New on the menu" notes.
 *
 * Where an announcement goes, per customer:
 *   - App customers: always into their in-app Notifications. Also a phone
 *     alert if they turned on "Alerts for new items & announcements" in the
 *     app (Apple only allows promotional alerts people have opted in to).
 *   - WhatsApp: only customers who messaged the bot in the last 24 hours.
 *     WhatsApp blocks business messages outside that window unless they use
 *     a template Meta has approved, so everyone else is skipped (and counted).
 *
 * New dishes: every time Chef saves the menu, dishes customers can now see
 * for the first time are queued. Fifteen minutes after the last such save
 * they go out together as one announcement (so a burst of edits is one
 * message). Chef can send the queue now or skip it from the admin page, and
 * turn the automatic announcement off in Setup.
 *
 * Files: data/broadcasts.json (history), data/menu-seen-items.json (dishes
 * already announced or present before this feature), data/announce-pending.json.
 */
const crypto = require("crypto");
const store = require("./jsonFile");
const appUsers = require("./appUsers");
const appInbox = require("./appInbox");
const customerStore = require("./customerStore");

const HISTORY = "broadcasts.json";
const SEEN = "menu-seen-items.json";
const PENDING = "announce-pending.json";
const QUIET_MS = 15 * 60 * 1000;
const KEEP = 100;

const AUDIENCES = {
  all: "Everyone",
  family: "Friends & family",
  others: "Everyone except friends & family",
  ordered: "Customers who have ordered",
  top: "4 stars and up",
  new: "New (no orders yet)"
};

function owner() {
  return String(process.env.OWNER_WHATSAPP_NUMBER || "");
}

function people() {
  const report = require("./customerReport").customers();
  const byPhone = new Map(report.map((c) => [c.phone, c]));
  // App customers who haven't given a name yet still count.
  for (const phone of appUsers.phones()) {
    if (!byPhone.has(phone)) byPhone.set(phone, { phone, firstName: "", confirmedOrders: 0, stars: 0, family: false });
  }
  return [...byPhone.values()].filter((c) => c.phone && c.phone !== owner());
}

function audience(key) {
  const list = people();
  switch (key) {
    case "family": return list.filter((c) => c.family);
    case "others": return list.filter((c) => !c.family);
    case "ordered": return list.filter((c) => c.confirmedOrders > 0);
    case "top": return list.filter((c) => !c.family && c.stars >= 4);
    case "new": return list.filter((c) => !c.family && !c.confirmedOrders);
    default: return list;
  }
}

function reachOf(phone) {
  const app = appUsers.isAppUser(phone);
  const user = app ? appUsers.get(phone) : null;
  return {
    app,
    alert: !!(user && user.announcementAlerts && (user.pushTokens || []).length),
    whatsapp: appInbox.inWhatsAppWindow(phone)
  };
}

function preview(key) {
  const list = audience(key);
  let app = 0, alerts = 0, whatsapp = 0, unreachable = 0;
  for (const c of list) {
    const r = reachOf(c.phone);
    if (r.app) app += 1;
    if (r.alert) alerts += 1;
    if (r.whatsapp) whatsapp += 1;
    if (!r.app && !r.whatsapp) unreachable += 1;
  }
  return { audience: key, label: AUDIENCES[key] || AUDIENCES.all, total: list.length, app, alerts, whatsapp, unreachable };
}

function history() {
  const h = store.read(HISTORY, []);
  return Array.isArray(h) ? h : [];
}

function clean(s, max) {
  return String(s || "").replace(/\r/g, "").trim().slice(0, max);
}

/**
 * Send one announcement. Returns the history entry with counts.
 * `deps` lets tests swap the WhatsApp sender.
 */
async function send({ title, text, audience: key = "all", auto = false }, deps = {}) {
  title = clean(title, 60);
  text = clean(text, 1500);
  if (!title) throw new Error("Give the announcement a title.");
  if (!text) throw new Error("Write the announcement message.");
  if (!AUDIENCES[key]) key = "all";
  const sendWa = deps.sendWhatsApp || require("./messaging").sendWhatsAppOnly;
  const push = deps.push || require("./push").notify;
  const counts = { total: 0, app: 0, alerts: 0, whatsapp: 0, unreachable: 0, failed: 0 };
  const waText = `*${title}*\n\n${text}`;
  for (const c of audience(key)) {
    counts.total += 1;
    const r = reachOf(c.phone);
    if (r.app) {
      const item = appInbox.add(c.phone, { header: title, text, tag: "announcement", tagLabel: auto ? "New on the menu" : "Announcement" });
      counts.app += 1;
      if (r.alert) {
        counts.alerts += 1;
        push(c.phone, { title, body: text.slice(0, 180), data: { inboxId: item.id } }).catch((e) => console.error("Announcement push failed:", e.message));
      }
    }
    if (r.whatsapp) {
      try {
        await sendWa(c.phone, waText);
        counts.whatsapp += 1;
      } catch (e) {
        counts.failed += 1;
        console.error(`Announcement WhatsApp to ${c.phone} failed:`, e.message);
      }
    }
    if (!r.app && !r.whatsapp) counts.unreachable += 1;
  }
  const entry = {
    id: "ANN-" + crypto.randomBytes(4).toString("hex").toUpperCase(),
    at: new Date().toISOString(),
    title,
    text,
    audience: key,
    audienceLabel: AUDIENCES[key],
    auto,
    counts
  };
  store.write(HISTORY, [entry, ...history()].slice(0, KEEP));
  return entry;
}

// ------------------------------------------------------------ new dishes

const SECTION_LABEL = { festival: "Festival Specials", dry: "Dry Products" };

/** Every dish a customer can see right now, keyed "section/dish". */
function visibleDishes(menu) {
  const view = require("./availability").customerView(menu);
  const out = new Map();
  for (const c of view.categories || []) {
    if (c.type === "live-dose-station" || c.hidden) continue;
    for (const i of c.items || []) {
      if (i.hidden) continue;
      out.set(`${c.id}/${i.id}`, {
        key: `${c.id}/${i.id}`,
        title: i.title,
        section: SECTION_LABEL[c.section] || (c.flagship ? c.title : c.type === "preorder" ? "Chef's Weekly Specials" : c.title)
      });
    }
  }
  return out;
}

function pending() {
  const p = store.read(PENDING, null);
  return p && Array.isArray(p.items) && p.items.length ? p : null;
}

/** Called after every admin menu save. */
function noteMenuSaved(menu, now = Date.now()) {
  const visible = visibleDishes(menu);
  const seen = store.read(SEEN, null);
  if (!seen || !Array.isArray(seen.keys)) {
    // First run: what's on the menu today is not "new".
    store.write(SEEN, { keys: [...visible.keys()] });
    return null;
  }
  const known = new Set(seen.keys);
  const fresh = [...visible.values()].filter((d) => !known.has(d.key));
  if (!fresh.length) return pending();
  store.write(SEEN, { keys: [...known, ...fresh.map((d) => d.key)] });
  if (menu.settings && menu.settings.announceNewItems === false) return pending();
  const p = pending() || { items: [] };
  p.items.push(...fresh.map((d) => ({ ...d, at: new Date(now).toISOString() })));
  p.dueAt = new Date(now + QUIET_MS).toISOString();
  store.write(PENDING, p);
  return p;
}

function newItemsText(items) {
  const groups = new Map();
  for (const d of items) {
    if (!groups.has(d.section)) groups.set(d.section, []);
    groups.get(d.section).push(d.title);
  }
  const lines = [...groups.entries()].map(([sec, titles]) => `${sec}:\n` + titles.map((t) => `• ${t}`).join("\n"));
  return `Fresh from Chef's kitchen:\n\n${lines.join("\n\n")}\n\nOrder in the FTR app, or reply here on WhatsApp.`;
}

/** Send the queued new dishes (only those still on the menu). */
async function sendPending(deps = {}) {
  const p = pending();
  store.write(PENDING, { items: [] });
  if (!p) return null;
  const visible = visibleDishes(require("./menuStore").getMenu());
  const items = p.items.filter((d) => visible.has(d.key));
  if (!items.length) return null;
  const title = items.length === 1 ? `New: ${items[0].title}` : "New on the FTR menu";
  return send({ title, text: newItemsText(items), audience: "all", auto: true }, deps);
}

function skipPending() {
  store.write(PENDING, { items: [] });
}

let timer = null;
function startWatcher() {
  if (timer) return;
  // Remember what's on the menu now, so only dishes added from here on count as new.
  try { if (!store.read(SEEN, null)) noteMenuSaved(require("./menuStore").getMenu()); } catch (e) { /* menu not set up yet */ }
  timer = setInterval(() => {
    const p = pending();
    if (p && Date.parse(p.dueAt) <= Date.now()) {
      sendPending().catch((e) => console.error("New-dish announcement failed:", e.message));
    }
  }, 60 * 1000);
  if (timer.unref) timer.unref();
}

/** Friends & family switch on the Customers page. */
function setFamily(phone, on) {
  const existing = customerStore.get(phone);
  if (!existing && !appUsers.isAppUser(phone)) return null;
  return customerStore.save(phone, { family: !!on });
}

module.exports = { AUDIENCES, audience, preview, send, history, noteMenuSaved, pending, sendPending, skipPending, startWatcher, newItemsText, visibleDishes, setFamily };
