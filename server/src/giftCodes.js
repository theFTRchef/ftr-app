/**
 * Single-use gift QR codes (first batch: 125 packets of FTR-BBB Powder in the
 * Triveni 50th anniversary souvenir bag).
 *
 *   QR on each packet -> https://bot.franklintiffinroom.com/g/T50-017-K7Q2M9XW
 *
 * A code is "<batch>-<label number>-<check>". The check is an HMAC of the
 * batch and number with GIFT_CODE_SECRET (.env), so no list of codes lives
 * in the repo and nobody can make up a valid one.
 *
 * Single use: the first phone that opens a code claims it (a cookie marks
 * that phone). The same phone can come back to the recipe and survey any
 * time; any other phone gets a polite "already used" page.
 *
 * Every scan is logged. Records are kept in data/ and mirrored to three
 * tabs in the Google Sheet:
 *   "BBB Gift Codes"  one row per code: status, who claimed it, survey done
 *   "BBB Gift Scans"  one row per scan (first, repeat, or blocked)
 *   "BBB Survey"      one row per survey answer
 */
const crypto = require("crypto");
const store = require("./jsonFile");
const tabSync = require("./tabSync");

const BATCHES = {
  T50: { count: 125, title: "Triveni 50th anniversary souvenir bag", product: "FTR-BBB Powder, 25 g", recipe: "bbb25" }
};

const CODES_FILE = "gift-codes.json";
const SCANS_FILE = "gift-scans.json";
const SURVEY_FILE = "gift-survey.json";
const COOKIE = "ftr_gift_dev";
const MAX_SCANS_LOGGED = 5000;

// ---------- codes ----------
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford: no I, L, O, U

function secret() {
  return process.env.GIFT_CODE_SECRET || "";
}

function check(batch, n) {
  const mac = crypto.createHmac("sha256", secret()).update(`${batch}-${n}`).digest();
  let out = "";
  for (let i = 0; i < 8; i++) out += B32[mac[i] % 32];
  return out;
}

function makeCode(batch, n) {
  return `${batch}-${String(n).padStart(3, "0")}-${check(batch, n)}`;
}

function parse(raw) {
  const m = /^([A-Z0-9]{2,8})-(\d{1,4})-([0-9A-Z]{8})$/.exec(String(raw || "").toUpperCase().trim());
  if (!m || !secret()) return null;
  const batch = BATCHES[m[1]];
  const n = Number(m[2]);
  if (!batch || n < 1 || n > batch.count) return null;
  const expect = check(m[1], n);
  if (!crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(m[3]))) return null;
  return { code: makeCode(m[1], n), batchId: m[1], batch, n };
}

function baseUrl() {
  return (process.env.GIFT_BASE_URL || "https://bot.franklintiffinroom.com").replace(/\/+$/, "");
}

function urlFor(code) {
  return `${baseUrl()}/g/${code}`;
}

// ---------- records ----------
function codes() {
  const c = store.read(CODES_FILE, {});
  return c && typeof c === "object" && !Array.isArray(c) ? c : {};
}
function scans() {
  const s = store.read(SCANS_FILE, []);
  return Array.isArray(s) ? s : [];
}
function surveys() {
  const s = store.read(SURVEY_FILE, []);
  return Array.isArray(s) ? s : [];
}

function stamp(iso) {
  return iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York" }) : "";
}

function deviceOf(ua) {
  ua = String(ua || "");
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipod/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua) || (/macintosh/i.test(ua) && /mobile/i.test(ua))) return "iPad";
  return "Other";
}

const SURVEY_FIELDS = [
  ["verdict", "Lip-smacking or just another BBB?"],
  ["taste", "Taste (1-5)"],
  ["spice", "Spice level"],
  ["masala", "Masala level"],
  ["consistency", "Consistency"],
  ["ease", "Ease of following the recipe (1-5)"],
  ["missed", "Steps missed or unclear"],
  ["emphasis", "What to emphasize more"],
  ["different", "What they would do differently"],
  ["better", "Their BBB secret"],
  ["notes", "Notes for FTR"],
  ["buyAgain", "Would buy FTR-BBB powder"]
];

function syncSheets() {
  tabSync.schedule(process.env.GIFT_SHEET_CODES_TAB || "BBB Gift Codes", () => {
    const all = codes();
    const sv = new Set(surveys().map((s) => s.code));
    const rows = [];
    for (const [id, b] of Object.entries(BATCHES)) {
      for (let n = 1; n <= b.count; n++) {
        const code = makeCode(id, n);
        const r = all[code] || {};
        rows.push([
          n, code, r.claimedAt ? "Used" : "Not scanned yet", stamp(r.claimedAt), r.device || "",
          r.name || "", r.phone || "", r.email || "", r.contactOk ? "Yes" : r.claimedAt ? "No" : "",
          r.scans || 0, r.blocked || 0, sv.has(code) ? "Yes" : ""
        ]);
      }
    }
    return {
      header: ["Label #", "Code", "Status", "First scan", "Device", "Name", "Phone", "Email", "OK to contact", "Scans (same phone)", "Blocked scans (other phones)", "Survey done"],
      rows
    };
  });
  tabSync.schedule(process.env.GIFT_SHEET_SCANS_TAB || "BBB Gift Scans", () => {
    const all = codes();
    return {
      header: ["Time", "Label #", "Code", "Result", "Device", "Name", "Phone"],
      rows: scans().map((s) => {
        const r = all[s.code] || {};
        const mine = s.result !== "Blocked: already used";
        return [stamp(s.at), s.n, s.code, s.result, s.device, mine ? r.name || "" : "", mine ? r.phone || "" : ""];
      })
    };
  });
  tabSync.schedule(process.env.GIFT_SHEET_SURVEY_TAB || "BBB Survey", () => ({
    header: ["Date", "Label #", "Code", "Name", "Phone", ...SURVEY_FIELDS.map((f) => f[1])],
    rows: surveys().map((s) => [stamp(s.at), s.n, s.code, s.name || "", s.phone || "", ...SURVEY_FIELDS.map((f) => s.answers[f[0]] || "")])
  }));
}

function logScan(info, result, device) {
  const list = scans();
  if (list.length >= MAX_SCANS_LOGGED) return;
  list.push({ at: new Date().toISOString(), code: info.code, n: info.n, result, device });
  store.write(SCANS_FILE, list);
}

// ---------- cookies ----------
function readCookie(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{32})`).exec(req.headers.cookie || "");
  return m ? m[1] : null;
}
function deviceId(req, res) {
  let id = readCookie(req);
  if (!id) {
    id = crypto.randomBytes(16).toString("hex");
    res.append("Set-Cookie", `${COOKIE}=${id}; Path=/g; Max-Age=31536000; HttpOnly; SameSite=Lax${req.secure || req.get("x-forwarded-proto") === "https" ? "; Secure" : ""}`);
  }
  return id;
}

/** Who is this visitor for this code? "owner", "new" (unclaimed) or "other". */
function standing(info, dev) {
  const r = codes()[info.code];
  if (!r || !r.claimedAt) return "new";
  return r.device_id === dev ? "owner" : "other";
}

// ---------- pages ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const CSS = `:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#F7F1E8;color:#2E2A26;font:17px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:560px;margin:0 auto;padding:28px 18px 40px}
.seal{display:block;width:120px;height:120px;margin:0 auto 10px}
h1{font:700 28px/1.15 Georgia,serif;text-align:center;margin:6px 0 4px}
h2{font:700 21px/1.2 Georgia,serif;margin:28px 0 10px;color:#7A3B1E}
.sub{text-align:center;color:#6E5D55;margin:0 0 18px}
.card{background:#FFFDF8;border:1px solid #E6DAC6;border-radius:14px;padding:16px 18px;margin:14px 0}
ul.ing{list-style:none;padding:0;margin:0}
ul.ing li{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #EFE6D6}
ul.ing li b{white-space:nowrap}
ol.steps{padding-left:22px;margin:0}
ol.steps li{margin:0 0 12px}
label{display:block;font-weight:600;margin:14px 0 6px}
input[type=text],input[type=tel],input[type=email],textarea{width:100%;padding:12px;border:1px solid #CDBFA4;border-radius:10px;font:inherit;background:#fff;color:inherit}
textarea{min-height:84px}
fieldset{border:0;margin:14px 0 0;padding:0}
legend{font-weight:600;margin-bottom:6px}
.opts{display:flex;flex-wrap:wrap;gap:8px}
.opts label{font-weight:500;margin:0;display:flex;align-items:center;gap:8px;padding:10px 14px;border:1px solid #CDBFA4;border-radius:999px;background:#fff;min-height:44px}
.check{display:flex;gap:10px;align-items:flex-start;font-weight:500}
.check input{width:22px;height:22px;margin-top:2px}
.btn{display:block;width:100%;text-align:center;margin:18px 0 0;padding:15px 18px;border:0;border-radius:999px;background:#7A3B1E;color:#fff;text-decoration:none;font-family:inherit;font-size:17px;font-weight:600;line-height:1.2;cursor:pointer}
a{color:#7A3B1E}
.btn.alt{background:#EEE6D8;color:#2E2A26}
.btn:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #2E2A26;outline-offset:2px}
.note{font-size:15px;color:#6E5D55}
.foot{margin-top:30px;text-align:center;font-size:14px;color:#6E5D55}
.foot a{color:#7A3B1E}
.hi{background:#FFF4DC;border-color:#E9B44C}`;

function shell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title><style>${CSS}</style></head><body><main>
<img class="seal" src="/app/seal.png" alt="Franklin Tiffin Room seal">
${body}
<p class="foot">Franklin Tiffin Room · 100% vegetarian · Somerset, NJ<br>
<a href="tel:+12343873673">1-234-FTR-DOSE (387-3673)</a> · <a href="/app">Get the FTR-DOSE app</a></p>
</main></body></html>`;
}

const RECIPE = {
  bbb25: {
    title: "FTR Special Bisi Bele Bhath",
    serves: "Serves 3–4 · about 2.5 qt · made with one 25 g packet",
    ingredients: [
      ["FTR-BBB Powder", "25 g (1 packet)"], ["Rice, uncooked", "150 g"], ["Toor dal (cook fully ahead)", "100 g"],
      ["Fresh coconut", "25 g"], ["Curry leaves", "4–5, plus a few for tadka"], ["Tamarind", "to taste"],
      ["Khol rabi, 1\" pieces", "50 g"], ["Green beans, 1\" pieces", "50 g"], ["Carrot", "50 g"],
      ["Seme badnekai, small pieces", "50 g"], ["Green peas", "50 g"], ["White pumpkin, medium pieces", "100 g"],
      ["Bell pepper, diced", "50 g"], ["Tomato, wedges", "½ medium"], ["Onion, chopped", "½ medium"],
      ["Oil", "1 tbsp"], ["Mustard seeds", "½ tsp + a pinch"], ["Ghee", "2 tbsp + more to serve"],
      ["Cashews, fried in ghee", "15 g"], ["Byadgi chillies (tadka)", "2"], ["Ghee or oil (tadka)", "2 tsp"],
      ["Salt, hing, extra chilly powder", "to taste"]
    ],
    steps: [
      ["Paste", "In a blender, add the 25 g FTR-BBB Powder, 25 g fresh coconut, tamarind to taste and 4–5 curry leaves with a little water. Blend to a thick paste. Keep it ready with the uncooked rice and cooked toor dal."],
      ["Tempering", "Heat 1 tbsp oil in a pot and add ½ tsp mustard seeds. Once they splutter, add the onion and sauté till translucent, then the khol rabi and fry 1 min."],
      ["Vegetables", "Add ¾ glass of water and cook 2 min. Then every 2 min add, in this order: beans, carrot, seme badnekai, peas, white pumpkin, bell pepper and tomato. Add a little more water if needed."],
      ["Simmer", "Cook 5 min. If the beans are cooked, the rest will be fine."],
      ["Masala", "Add the paste; rinse the blender with ¼ cup water into the pot. Mix well and cook 3 min."],
      ["Rice", "Add the washed rice and ⅔ cup water, flame above medium. From now on stir constantly so the rice does not stick and burn."],
      ["Cook", "About 10 min, adding water as it thickens. At 80% cooked, add the toor dal and ¾ glass of water, and adjust salt, tamarind, hing and extra chilly powder. Stir and cover, stirring every 20 sec. Cook about 5 min more."],
      ["Finish", "Stir in 2 tbsp ghee and the cashews; rest a few minutes."],
      ["Consistency", "It should flow. If it cakes up, add a little water."],
      ["Tadka", "Heat 2 tsp ghee or oil in a small pan; splutter mustard seeds, add 2 byadgi chillies and a few curry leaves. Pour over before serving."],
      ["Serve", "Serve hot with raitha (cucumber, tomato, onion and curds, made separately) and/or boondi. Top with another spoon of ghee: BBB is incomplete without it."]
    ]
  }
};

function recipeHtml(key) {
  const r = RECIPE[key];
  return `<h2>${esc(r.title)}</h2><p class="note">${esc(r.serves)}</p>
<div class="card"><ul class="ing">${r.ingredients.map(([n, q]) => `<li><span>${esc(n)}</span><b>${esc(q)}</b></li>`).join("")}</ul></div>
<h2>Method</h2><div class="card"><ol class="steps">${r.steps.map(([t, s]) => `<li><b>${esc(t)}:</b> ${esc(s)}</li>`).join("")}</ol></div>`;
}

function welcomeForm(info, r) {
  if (r.name || r.skipped) return "";
  return `<form class="card hi" method="post" action="/g/${esc(info.code)}/hello">
<b>Tell us who you are</b> <span class="note">(optional)</span>
<label for="name">Name</label><input id="name" name="name" type="text" autocomplete="name" maxlength="80">
<label for="phone">Phone</label><input id="phone" name="phone" type="tel" autocomplete="tel" maxlength="20">
<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" maxlength="120">
<label class="check"><input type="checkbox" name="contactOk" value="1"> FTR may contact me about new products and offers</label>
<button class="btn" type="submit">Save and show the recipe</button>
<button class="btn alt" type="submit" name="skip" value="1">Skip</button>
</form>`;
}

function giftPage(info, r) {
  const done = surveys().some((s) => s.code === info.code);
  return shell("Your FTR-BBB Powder recipe", `
<h1>Welcome from FTR!</h1>
<p class="sub">Thank you for trying our first product, <b style="white-space:nowrap">FTR‑BBB Powder</b>.<br>Gift no. ${info.n} · ${esc(info.batch.title)}</p>
${welcomeForm(info, r)}
${recipeHtml(info.batch.recipe)}
<h2>How was it?</h2>
<p>${done ? "Thank you for your feedback! You can update it any time." : "Once you've made it, tell us what was right and what was wrong. Every answer helps FTR get better."}</p>
<a class="btn" href="/g/${esc(info.code)}/survey">${done ? "Update my feedback" : "Share my feedback"}</a>
<a class="btn alt" href="/app">Get the FTR-DOSE app and comment there</a>`);
}

function radios(name, opts, cur) {
  return `<div class="opts">${opts.map((o) => `<label><input type="radio" name="${name}" value="${esc(o)}"${cur === o ? " checked" : ""}> ${esc(o)}</label>`).join("")}</div>`;
}

function surveyPage(info, r, prev) {
  const a = (prev && prev.answers) || {};
  const q = (name, legend, opts) => `<fieldset><legend>${legend}</legend>${radios(name, opts, a[name])}</fieldset>`;
  const t = (name, text) => `<label for="${name}">${text}</label><textarea id="${name}" name="${name}" maxlength="1500">${esc(a[name] || "")}</textarea>`;
  return shell("FTR-BBB Powder feedback", `
<h1>How was your BBB?</h1>
<p class="sub">Gift no. ${info.n} · takes about 2 minutes</p>
<form class="card" method="post" action="/g/${esc(info.code)}/survey">
${q("verdict", "Was it lip-smacking or just another BBB?", ["Lip-smacking!", "Really good", "Just another BBB", "Not for me"])}
${q("taste", "Taste", ["1", "2", "3", "4", "5"])}<p class="note">1 = poor, 5 = excellent</p>
${q("spice", "Spice level", ["Too mild", "Just right", "Too spicy"])}
${q("masala", "Masala level", ["Too little", "Just right", "Too much"])}
${q("consistency", "Consistency", ["Too thick", "Just right", "Too runny"])}
${q("ease", "How easy was the recipe to follow?", ["1", "2", "3", "4", "5"])}<p class="note">1 = hard, 5 = very easy</p>
${t("missed", "Were any steps missing or unclear?")}
${t("emphasis", "Anything we should emphasize more in the recipe?")}
${t("different", "Anything you would do differently?")}
${t("better", "Is your BBB better than FTR's? Share your secret!")}
${t("notes", "Any other notes for FTR")}
${q("buyAgain", "Would you buy FTR-BBB Powder?", ["Yes", "Maybe", "No"])}
<label for="sname">Name <span class="note">(optional)</span></label><input id="sname" name="name" type="text" maxlength="80" value="${esc((prev && prev.name) || r.name || "")}">
<label for="sphone">Phone <span class="note">(optional)</span></label><input id="sphone" name="phone" type="tel" maxlength="20" value="${esc((prev && prev.phone) || r.phone || "")}">
<button class="btn" type="submit">Send feedback</button>
</form>
<a class="btn alt" href="/g/${esc(info.code)}">Back to the recipe</a>`);
}

function usedPage() {
  return shell("Gift already used", `
<h1>This gift code has already been used</h1>
<p class="sub">Each FTR gift QR code works on one phone only.</p>
<div class="card">If this is your packet, open the code on the phone you first scanned it with. Otherwise, call or text us at <a href="tel:+12343873673">1-234-FTR-DOSE</a> and we'll send you the recipe.</div>
<a class="btn" href="/app">Get the FTR-DOSE app</a>`);
}

function invalidPage(setup) {
  return shell("FTR gift", `<h1>${setup ? "Not ready yet" : "We couldn't find this code"}</h1>
<p class="sub">${setup ? "This gift link isn't switched on yet. Please try again later." : "Please scan the QR code on your packet again."}</p>
<a class="btn" href="/app">Get the FTR-DOSE app</a>`);
}

// ---------- routes ----------
function clean(v, max) {
  return String(v || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

function register(app, requireAdminAuth) {
  // Fill the three Sheet tabs at start-up, so all codes show as "Not scanned yet".
  if (secret()) setTimeout(syncSheets, 15000).unref?.();
  // Admin first, so "/g/admin..." is never treated as a code.
  app.get("/admin/api/gift", requireAdminAuth, (req, res) => {
    const all = codes();
    const out = {};
    for (const [id, b] of Object.entries(BATCHES)) {
      const used = Object.keys(all).filter((c) => c.startsWith(id + "-") && all[c].claimedAt).length;
      out[id] = { title: b.title, codes: b.count, scanned: used, surveys: surveys().filter((s) => s.batchId === id).length };
    }
    res.json({ ready: !!secret(), batches: out });
  });
  app.get("/admin/api/gift/:batch/labels.csv", requireAdminAuth, (req, res) => {
    const id = String(req.params.batch).toUpperCase();
    const b = BATCHES[id];
    if (!b || !secret()) return res.status(404).send("Unknown batch or GIFT_CODE_SECRET not set");
    const lines = ["label,code,url"];
    for (let n = 1; n <= b.count; n++) lines.push(`${n},${makeCode(id, n)},${urlFor(makeCode(id, n))}`);
    res.type("text/csv").set("Content-Disposition", `attachment; filename="${id}-labels.csv"`).send(lines.join("\n") + "\n");
  });

  function load(req, res) {
    res.set("Cache-Control", "no-store");
    if (!secret()) {
      res.status(503).type("html").send(invalidPage(true));
      return null;
    }
    const info = parse(req.params.code);
    if (!info) {
      res.status(404).type("html").send(invalidPage(false));
      return null;
    }
    return info;
  }

  app.get("/g/:code", (req, res) => {
    const info = load(req, res);
    if (!info) return;
    const dev = deviceId(req, res);
    const device = deviceOf(req.get("user-agent"));
    const all = codes();
    const r = all[info.code] || {};
    const who = standing(info, dev);
    if (who === "other") {
      all[info.code] = { ...r, blocked: (r.blocked || 0) + 1 };
      store.write(CODES_FILE, all);
      logScan(info, "Blocked: already used", device);
      syncSheets();
      return res.status(410).type("html").send(usedPage());
    }
    if (who === "new") {
      all[info.code] = { ...r, claimedAt: new Date().toISOString(), device_id: dev, device, scans: 1 };
      logScan(info, "First scan", device);
    } else {
      all[info.code] = { ...r, scans: (r.scans || 0) + 1 };
      logScan(info, "Repeat (same phone)", device);
    }
    store.write(CODES_FILE, all);
    syncSheets();
    res.type("html").send(giftPage(info, all[info.code]));
  });

  app.post("/g/:code/hello", (req, res) => {
    const info = load(req, res);
    if (!info) return;
    if (standing(info, readCookie(req)) !== "owner") return res.status(410).type("html").send(usedPage());
    const b = req.body || {};
    const all = codes();
    const r = all[info.code];
    if (b.skip) r.skipped = true;
    else {
      r.name = clean(b.name, 80);
      r.phone = clean(b.phone, 20);
      r.email = clean(b.email, 120);
      r.contactOk = b.contactOk === "1";
      if (!r.name && !r.phone && !r.email) r.skipped = true;
    }
    store.write(CODES_FILE, all);
    syncSheets();
    res.redirect(303, `/g/${info.code}`);
  });

  app.get("/g/:code/survey", (req, res) => {
    const info = load(req, res);
    if (!info) return;
    if (standing(info, readCookie(req)) !== "owner") return res.status(410).type("html").send(usedPage());
    const prev = surveys().find((s) => s.code === info.code);
    res.type("html").send(surveyPage(info, codes()[info.code], prev));
  });

  app.post("/g/:code/survey", (req, res) => {
    const info = load(req, res);
    if (!info) return;
    if (standing(info, readCookie(req)) !== "owner") return res.status(410).type("html").send(usedPage());
    const b = req.body || {};
    const answers = {};
    for (const [k] of SURVEY_FIELDS) answers[k] = clean(b[k], 1500);
    const list = surveys().filter((s) => s.code !== info.code);
    list.push({ at: new Date().toISOString(), code: info.code, n: info.n, batchId: info.batchId, name: clean(b.name, 80), phone: clean(b.phone, 20), answers });
    store.write(SURVEY_FILE, list);
    syncSheets();
    res.type("html").send(shell("Thank you!", `<h1>Thank you!</h1>
<p class="sub">Your feedback goes straight to Chef. We read every answer.</p>
<a class="btn" href="/app">Get the FTR-DOSE app</a>
<a class="btn alt" href="/g/${esc(info.code)}">Back to the recipe</a>`));
  });
}

module.exports = { register, makeCode, parse, urlFor, syncSheets, BATCHES };
