/**
 * Customer comments & suggestions, kept by phone number in
 * data/feedback.json and mirrored to a "Comments" tab in the Google Sheet.
 * Entries are only removed one at a time from the admin page.
 */
const crypto = require("crypto");
const store = require("./jsonFile");
const tabSync = require("./tabSync");

const FILE = "feedback.json";
const HEADER = ["Date", "Name", "Phone", "Comment", "Related Order", "Status"];

function all() {
  const list = store.read(FILE, []);
  return Array.isArray(list) ? list : [];
}

function stamp(iso) {
  return iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York" }) : "";
}

function sync() {
  tabSync.schedule(process.env.GOOGLE_SHEET_FEEDBACK_TAB || "Comments", () => ({
    header: HEADER,
    rows: all().map((f) => [stamp(f.createdAt), f.name || "", f.phone, f.text, f.orderId || "", f.read ? "Read" : "New"])
  }));
}

function add({ phone, name, text, orderId }) {
  const list = all();
  const entry = {
    id: "FB-" + crypto.randomBytes(4).toString("hex").toUpperCase(),
    phone,
    name: name || "",
    text: String(text || "").slice(0, 2000),
    orderId: orderId || null,
    read: false,
    createdAt: new Date().toISOString()
  };
  list.push(entry);
  store.write(FILE, list);
  sync();
  return entry;
}

function markRead(ids) {
  const set = new Set(ids);
  const list = all().map((f) => (set.has(f.id) ? { ...f, read: true } : f));
  store.write(FILE, list);
  sync();
}

/** Remove ONE comment (admin page only). A backup copy is kept. */
function remove(id) {
  const list = all();
  const f = list.find((x) => x.id === id);
  if (!f) return null;
  store.backup(`feedback-${id}.json`, f);
  store.write(FILE, list.filter((x) => x.id !== id));
  sync();
  return f;
}

module.exports = { all, add, markRead, remove, HEADER };
