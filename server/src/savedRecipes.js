// Recipes a signed-in customer saved to their account from a scanned QR code.
// Only references are kept (which code, when); the recipe itself is read fresh
// from the gift batch or Chef's recipe list, so a recipe Chef turns off
// disappears from accounts too. Deleting an account removes its saved recipes.

const crypto = require("crypto");
const store = require("./jsonFile");

const FILE = "saved-recipes.json";
const MAX = 50;

const read = () => store.read(FILE, {});

function list(phone) {
  return (read()[phone] || []).slice().sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

function find(phone, id) {
  return (read()[phone] || []).find((x) => x.id === id) || null;
}

/** Save (or re-save) a code for this phone. Returns the saved entry. */
function save(phone, entry) {
  const all = read();
  const mine = all[phone] || [];
  const existing = mine.find((x) => x.kind === entry.kind && x.code === entry.code);
  if (existing) {
    existing.title = entry.title;
    existing.subtitle = entry.subtitle;
    store.write(FILE, all);
    return existing;
  }
  if (mine.length >= MAX) {
    const err = new Error(`You can keep up to ${MAX} recipes. Remove one to save this.`);
    err.status = 400;
    throw err;
  }
  const item = { id: crypto.randomBytes(8).toString("hex"), kind: entry.kind, code: entry.code, title: entry.title, subtitle: entry.subtitle || "", savedAt: new Date().toISOString() };
  all[phone] = mine.concat([item]);
  store.write(FILE, all);
  return item;
}

function remove(phone, id) {
  const all = read();
  const mine = all[phone] || [];
  const next = mine.filter((x) => x.id !== id);
  if (next.length === mine.length) return false;
  if (next.length) all[phone] = next; else delete all[phone];
  store.write(FILE, all);
  return true;
}

function clear(phone) {
  const all = read();
  if (all[phone]) {
    delete all[phone];
    store.write(FILE, all);
  }
}

module.exports = { list, find, save, remove, clear };
