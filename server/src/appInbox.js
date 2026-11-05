/**
 * In-app messages for customers who use the FTR iOS app.
 *
 * Every message the bot sends a customer (order received, Chef approved,
 * Zelle deposit details, payment confirmed, quote ready, released...) goes
 * through messaging.js. For app users, messaging.js calls route() first:
 *   - the message is saved to their in-app inbox (data/app-inbox.json)
 *     and pushed to their iPhone (if push is set up), and
 *   - it is ALSO sent on WhatsApp only if they messaged us on WhatsApp in
 *     the last 24 hours (WhatsApp refuses free-form messages after that,
 *     which would otherwise break the approval / deposit steps).
 *
 * Customers who never signed in to the app are untouched: WhatsApp only,
 * exactly as before.
 */
const crypto = require("crypto");
const store = require("./jsonFile");
const appUsers = require("./appUsers");

const FILE = "app-inbox.json";
const SEEN_FILE = "whatsapp-last-inbound.json";
const KEEP = 150;
const WINDOW_MS = 24 * 3600 * 1000;

function readInbox() {
  const d = store.read(FILE, {});
  return d && typeof d === "object" && !Array.isArray(d) ? d : {};
}

/** Called for every inbound WhatsApp message (server.js). */
function noteWhatsAppInbound(phone) {
  if (!phone) return;
  const seen = store.read(SEEN_FILE, {}) || {};
  const now = Date.now();
  seen[phone] = now;
  for (const [p, t] of Object.entries(seen)) if (now - t > 2 * WINDOW_MS) delete seen[p];
  store.write(SEEN_FILE, seen);
}

function inWhatsAppWindow(phone) {
  const seen = store.read(SEEN_FILE, {}) || {};
  return !!seen[phone] && Date.now() - seen[phone] < WINDOW_MS;
}

/** Buttons we can turn into in-app actions. Others are WhatsApp-only. */
function actionFor(button) {
  const m = /^(caccept|creject):(.+)$/.exec(String(button.id || ""));
  if (m) return { type: "quote", orderId: m[2], accept: m[1] === "caccept", title: button.title };
  return null;
}

/**
 * What kind of update a message is, so the app can label it ("Approved",
 * "Declined", "Deposit due"...). Worked out from the bot's own wording,
 * which lives in orderFlow.js / payments.js.
 */
const TAGS = [
  ["paid", "Payment confirmed", /^Payment received - thank you/i],
  ["not_received", "Payment not received", /hasn't received your Zelle deposit/i],
  ["chef_message", "Message from Chef", /^Message from Chef about your order/i],
  ["released", "Released", /has been released/i],
  ["reminder", "Deposit reminder", /^Reminder: the .* deposit/i],
  ["deposit_due", "Deposit due", /please send a \d+% deposit by Zelle|Scan with your bank app to pay/i],
  ["screenshot", "Screenshot received", /received your payment screenshot|we got your screenshot|We have your screenshot/i],
  ["declined", "Declined", /not able to take|isn't able to take|isn't able to bring|declined\b/i],
  ["approved", "Approved", /Chef approved your order|order .* is confirmed!|^Confirmed! Your custom order|Chef can bring the LIVE Dose Station|accepted the quote/i],
  ["quote", "Quote ready", /^Request .*\n.*\n\nPrice:/i],
  ["received", "Received", /is being reviewed|has gone to the chef|passed your question along|Chef will confirm your order .* shortly/i]
];

const PUSH_TITLES = {
  approved: "Order approved",
  declined: "Order declined",
  deposit_due: "Deposit due",
  reminder: "Deposit reminder",
  paid: "Payment confirmed",
  not_received: "Payment not received",
  released: "Order released",
  quote: "Your quote is ready",
  screenshot: "Screenshot received",
  received: "Order received",
  chef_message: "Message from Chef"
};

function classify(entry) {
  if (/quote is ready/i.test(entry.header || "")) return { tag: "quote", tagLabel: "Quote ready" };
  const text = String(entry.text || "");
  // Approval and the Zelle details now arrive as one message (update-23).
  if (/Chef approved your order/i.test(text) && /deposit by Zelle|Scan with your bank app/i.test(text)) {
    return { tag: "approved", tagLabel: "Approved · deposit due" };
  }
  for (const [tag, tagLabel, re] of TAGS) if (re.test(text)) return { tag, tagLabel };
  return { tag: "update", tagLabel: "Update" };
}

/**
 * WhatsApp wording asks customers to send the screenshot "here" (in the chat).
 * In the app the screenshot goes on the order page, so say that instead.
 */
function forApp(text) {
  return String(text)
    .replace(/\(Just reply here to answer Chef\.\)/gi, "(Tap Reply to answer Chef.)")
    .replace(
    /\*?PLEASE UPLOAD THE SCREENSHOT CONFIRMATION HERE\.?\*?/gi,
    "take a screenshot of the Zelle confirmation and upload it on your order page (tap View order, then Upload payment confirmation)."
  );
}

function orderIdIn(text) {
  const m = /\b((?:FTR|CUST)-[A-Z0-9]{5,})\b/.exec(String(text || ""));
  return m ? m[1] : null;
}

function add(phone, entry) {
  const inbox = readInbox();
  const list = inbox[phone] || [];
  const item = {
    id: crypto.randomBytes(8).toString("hex"),
    at: new Date().toISOString(),
    read: false,
    ...entry,
    // Announcements arrive already labelled; everything else is worked out from the wording.
    ...(entry.tag ? { tag: entry.tag, tagLabel: entry.tagLabel || "Update" } : classify(entry)),
    orderId: entry.orderId || orderIdIn(`${entry.header || ""} ${entry.text || ""}`)
  };
  list.push(item);
  inbox[phone] = list.slice(-KEEP);
  store.write(FILE, inbox);
  return item;
}

/**
 * Decide where a customer message goes. `message` is
 * { text, header?, buttons?: [{id,title}], imageUrl? }.
 * Returns { whatsapp: boolean } - false means skip WhatsApp entirely.
 */
function route(to, message) {
  const owner = process.env.OWNER_WHATSAPP_NUMBER;
  if (!to || to === owner || !appUsers.isAppUser(to)) return { whatsapp: true, app: false };
  const actions = (message.buttons || []).map(actionFor).filter(Boolean);
  const item = add(to, {
    header: message.header || null,
    text: forApp(message.text || ""),
    imageUrl: message.imageUrl || null,
    actions
  });
  require("./push")
    .notify(to, {
      title: message.header || PUSH_TITLES[item.tag] || "Franklin Tiffin Room",
      body: String(message.text || (message.imageUrl ? "Sent you a picture" : "")).slice(0, 180),
      data: { inboxId: item.id, orderId: item.orderId || null }
    })
    .catch((err) => console.error("Push failed:", err.message));
  return { whatsapp: inWhatsAppWindow(to), app: true };
}

function list(phone) {
  return (readInbox()[phone] || [])
    .map((m) => (m.tag ? m : { ...m, ...classify(m) }))
    .reverse();
}

function unreadCount(phone) {
  return (readInbox()[phone] || []).filter((m) => !m.read).length;
}

function markRead(phone, ids = null) {
  const inbox = readInbox();
  const listFor = inbox[phone] || [];
  let n = 0;
  for (const m of listFor) {
    if (!m.read && (!ids || ids.includes(m.id))) {
      m.read = true;
      n += 1;
    }
  }
  if (n) store.write(FILE, inbox);
  return n;
}

/** Mark an in-app action (quote Accept/Decline) as used. */
function markActioned(phone, orderId) {
  const inbox = readInbox();
  let changed = false;
  for (const m of inbox[phone] || []) {
    if ((m.actions || []).some((a) => a.orderId === orderId) && !m.actioned) {
      m.actioned = true;
      changed = true;
    }
  }
  if (changed) store.write(FILE, inbox);
}

function clear(phone) {
  const inbox = readInbox();
  if (!inbox[phone]) return;
  delete inbox[phone];
  store.write(FILE, inbox);
}

module.exports = { forApp, classify, route, add, list, unreadCount, markRead, markActioned, clear, noteWhatsAppInbound, inWhatsAppWindow };
