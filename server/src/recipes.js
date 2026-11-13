// QR recipes for Chef's give-away masala powder packets.
//
// Each packet carries a QR code with https://bot.franklintiffinroom.com/r/<token>.
// The FTR-DOSE app's "Scan" button reads that code and asks the server for the
// recipe; there is no list of recipes anywhere, so a recipe only shows up for
// someone who scans its code. Opening the link in a browser shows a page that
// says to scan it in the app instead. Chef manages recipes in Chef's Kitchen.

const crypto = require("crypto");
const store = require("./jsonFile");

const FILE = "recipes.json";
const BASE = "https://bot.franklintiffinroom.com/r/";
const TEST_TOKEN = "chef-test";

function all() {
  let list = store.read(FILE, null);
  if (!list) {
    list = [testRecipe()];
    store.write(FILE, list);
  }
  return list;
}

function testRecipe() {
  return {
    id: "r-test",
    token: TEST_TOKEN,
    active: true,
    title: "Chef's test recipe",
    powder: "FTR test masala",
    intro: "This is Chef's test QR code. Scanning it shows a recipe the same way a real packet will. Replace this recipe in Chef's Kitchen → Recipes.",
    serves: "4",
    time: "20 min",
    ingredients: ["2 tbsp FTR masala powder", "2 cups cooked rice", "1 tbsp ghee", "Salt to taste"],
    steps: ["Warm the ghee in a pan.", "Stir in the masala powder for 30 seconds.", "Fold in the rice and salt, then serve hot."],
    tip: "Keep the packet sealed and away from light.",
    scans: 0,
    createdAt: new Date().toISOString(),
  };
}

function newToken() {
  // 10 characters from an unambiguous alphabet: unguessable, short enough for a small QR.
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(10);
  return [...bytes].map((b) => abc[b % abc.length]).join("");
}

const lines = (v) =>
  (Array.isArray(v) ? v : String(v || "").split("\n")).map((s) => String(s).trim()).filter(Boolean).slice(0, 40);
const text = (v, max) => String(v || "").trim().slice(0, max);

function clean(input, prev) {
  const r = prev ? { ...prev } : {};
  r.title = text(input.title, 80) || r.title || "Untitled recipe";
  r.powder = text(input.powder, 80);
  r.intro = text(input.intro, 600);
  r.serves = text(input.serves, 20);
  r.time = text(input.time, 20);
  r.ingredients = lines(input.ingredients);
  r.steps = lines(input.steps);
  r.tip = text(input.tip, 400);
  r.active = input.active !== false;
  return r;
}

function forAdmin(r) {
  return { ...r, url: BASE + r.token };
}

/** The public view of a recipe: no token, no counts. */
function forApp(r) {
  const { title, powder, intro, serves, time, ingredients, steps, tip } = r;
  return { title, powder, intro, serves, time, ingredients, steps, tip };
}

function list() {
  return all().map(forAdmin);
}

function create(input) {
  const items = all();
  const r = clean(input || {});
  r.id = "r-" + crypto.randomBytes(4).toString("hex");
  r.token = newToken();
  r.scans = 0;
  r.createdAt = new Date().toISOString();
  items.push(r);
  store.write(FILE, items);
  return forAdmin(r);
}

function update(id, input) {
  const items = all();
  const i = items.findIndex((r) => r.id === id);
  if (i < 0) return null;
  items[i] = clean(input || {}, items[i]);
  store.write(FILE, items);
  return forAdmin(items[i]);
}

function remove(id) {
  const items = all();
  const next = items.filter((r) => r.id !== id);
  if (next.length === items.length) return false;
  store.write(FILE, next);
  return true;
}

/** A scan from the app: returns the recipe (and counts the scan) or null. */
function scan(token) {
  const t = String(token || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{4,40}$/.test(t)) return null;
  const items = all();
  const r = items.find((x) => x.token === t && x.active);
  if (!r) return null;
  r.scans = (r.scans || 0) + 1;
  r.lastScanAt = new Date().toISOString();
  store.write(FILE, items);
  return forApp(r);
}

/** A recipe by its code for someone who saved it (no scan counted); null if turned off. */
function peek(token) {
  const t = String(token || "").trim().toLowerCase();
  const r = all().find((x) => x.token === t && x.active);
  return r ? forApp(r) : null;
}

function webPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scan in the FTR-DOSE app</title>
<style>
body{margin:0;background:#F7F1E8;color:#3E2C28;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:420px;margin:0 auto;padding:40px 22px;text-align:center}
img{width:150px;height:150px}
h1{font:600 26px/1.15 "Oswald","Arial Narrow",sans-serif;text-transform:uppercase;margin:18px 0 8px}
ol{text-align:left;margin:18px auto;max-width:300px;padding-left:22px}
a.btn{display:block;margin:20px 0 0;padding:14px 18px;border-radius:999px;background:#A4483F;color:#fff;text-decoration:none;font-weight:600}
a.btn:focus-visible{outline:3px solid #2E2A26;outline-offset:3px}
</style></head><body><main>
<img src="/app/seal.png" alt="Franklin Tiffin Room seal">
<h1>Chef's recipe is in the app</h1>
<p>This code unlocks a recipe for your FTR masala. Scan it from inside the FTR-DOSE app to see it:</p>
<ol><li>Open the FTR-DOSE app.</li><li>On Home, tap <b>Scan a recipe QR</b>.</li><li>Point your camera at this code again.</li></ol>
<a class="btn" href="/app">Get the FTR-DOSE app</a>
</main></body></html>`;
}

module.exports = { list, create, update, remove, scan, peek, webPage, BASE };
