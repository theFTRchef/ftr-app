// Chef's recipe book: internal recipe cards that only Chef can open, in
// Chef's Kitchen (web, and inside the FTR-DOSE apps). The recipes themselves
// live only in the data folder on the server (chef-book.json), never in Git:
// this repo is public. Chef loads them by importing a recipe file in
// Chef's Kitchen › Recipe book.

const fs = require("fs");
const path = require("path");
const store = require("./jsonFile");

const FILE = "chef-book.json";
const TEMPLATES = ["ledger", "ledger-ingredients", "charcoal"];
const PHONE = "1-234-FTR-DOSE (387-3673)";

let sealUri = null;
function seal() {
  if (sealUri == null) {
    try {
      sealUri = "data:image/png;base64," + fs.readFileSync(path.join(__dirname, "..", "public", "seal.png")).toString("base64");
    } catch {
      sealUri = "";
    }
  }
  return sealUri;
}

function cards() {
  const d = store.read(FILE, { cards: [] });
  return Array.isArray(d.cards) ? d.cards : [];
}

const str = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const pairs = (v, n) => (Array.isArray(v) ? v : []).slice(0, n).map((p) => [str(p && p[0], 120), str(p && p[1], 400)]).filter((p) => p[0]);
const list = (v, n) => (Array.isArray(v) ? v : []).slice(0, n).map((s) => str(s, 400)).filter(Boolean);

function clean(c) {
  const id = str(c.id, 60).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!id) throw new Error("A recipe in the file has no id.");
  return {
    id,
    template: TEMPLATES.includes(c.template) ? c.template : "ledger",
    title: str(c.title, 80) || "Untitled recipe",
    sub: str(c.sub, 120),
    badge: str(c.badge, 40),
    meta: pairs(c.meta, 6),
    ing: pairs(c.ing, 60),
    steps: pairs(c.steps, 30),
    notes: list(c.notes, 12),
    notes2: list(c.notes2, 12),
    updatedAt: new Date().toISOString(),
  };
}

/** Add or replace recipes from an imported file. Returns how many were saved. */
function importFile(body) {
  if (!body || body.format !== "ftr-chef-recipes" || !Array.isArray(body.cards)) throw new Error("That isn't an FTR recipe file.");
  if (body.cards.length > 50) throw new Error("A recipe file can hold at most 50 recipes.");
  const incoming = body.cards.map(clean);
  const byId = new Map(cards().map((c) => [c.id, c]));
  incoming.forEach((c) => byId.set(c.id, c));
  store.write(FILE, { cards: [...byId.values()] });
  return incoming.length;
}

function summary() {
  return cards().map((c) => ({ id: c.id, title: c.title, sub: c.sub, template: c.template, updatedAt: c.updatedAt }));
}

function remove(id) {
  const all = cards();
  const next = all.filter((c) => c.id !== id);
  store.write(FILE, { cards: next });
  return next.length !== all.length;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

// ---------- card templates (Tiffin Ledger = internal, Charcoal & Gold = standard) ----------
function ledger(c, ingredientsOnly) {
  const meta = c.meta.map(([k, v], i) => `<div style="flex-grow:1;padding:8px 12px;${i < c.meta.length - 1 ? "border-right:1px solid #222" : ""}"><div style="font-size:10px;letter-spacing:2px;text-transform:uppercase">${esc(k)}</div><div style="font-family:'Roboto Slab',Georgia,serif;font-weight:700;font-size:16px">${esc(v)}</div></div>`).join("");
  const half = Math.ceil(c.ing.length / 2);
  const fs = ingredientsOnly ? 17 : 13, pad = ingredientsOnly ? 9 : 4;
  const col = (items) => items.map(([n, q]) => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:${fs}px;line-height:1.25;padding:${pad}px 0;border-bottom:1px solid #BBB"><span>${esc(n)}</span><b style="white-space:nowrap">${esc(q)}</b></div>`).join("");
  const steps = c.steps.map(([t, s], i) => `<div style="display:flex;gap:14px;padding:6px 0;border-bottom:1px solid #DDD"><span style="font-family:'Roboto Slab',Georgia,serif;font-weight:800;font-size:22px;line-height:1;width:28px;flex-shrink:0">${String(i + 1).padStart(2, "0")}</span><span style="font-size:13px;line-height:1.4"><b>${esc(t)}.</b> ${esc(s)}</span></div>`).join("");
  const notes = c.notes.length ? `<div style="margin-top:14px;padding:10px 14px;border:1px solid #111;font-size:13px;line-height:1.4"><b>Chef's notes</b><ul style="margin:4px 0 0 0;padding-left:18px">${c.notes.map((n) => `<li style="margin-bottom:2px">${esc(n)}</li>`).join("")}</ul></div>` : "";
  return `<div class="card" style="width:816px;height:1056px;box-sizing:border-box;background:#FFFFFF;font-family:'IBM Plex Sans',Arial,sans-serif;color:#111;padding:40px 48px 26px 48px;display:flex;flex-direction:column;overflow:hidden;position:relative;z-index:0">
<img src="${seal()}" alt="" aria-hidden="true" style="position:absolute;left:88px;top:238px;width:640px;height:640px;z-index:-1;opacity:.08;filter:grayscale(1)">
<div style="display:flex;align-items:center;gap:22px;border-bottom:4px solid #111;padding-bottom:12px">
<img src="${seal()}" alt="Franklin Tiffin Room seal" style="width:88px;height:88px;flex-shrink:0">
<div><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span style="font-size:12px;letter-spacing:3px;text-transform:uppercase">Franklin Tiffin Room · Recipe card</span><span style="border:2px solid #111;padding:2px 8px;font-size:11px;font-weight:700;letter-spacing:2px">INTERNAL · CHEF ONLY</span></div>
<h1 style="margin:6px 0 2px 0;font-family:'Roboto Slab',Georgia,serif;font-weight:800;font-size:44px;line-height:1">${esc(c.title)}</h1>
<div style="font-size:14px">${esc(c.sub)}</div></div></div>
${meta ? `<div style="display:flex;border:1px solid #222;border-top:0">${meta}</div>` : ""}
<h2 style="margin:${ingredientsOnly ? 28 : 20}px 0 6px 0;font-family:'Roboto Slab',Georgia,serif;font-size:${ingredientsOnly ? 22 : 18}px;text-transform:uppercase;letter-spacing:1px">Ingredients</h2>
<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:28px"><div>${col(c.ing.slice(0, half))}</div><div>${col(c.ing.slice(half))}</div></div>
${ingredientsOnly ? "" : `<h2 style="margin:18px 0 2px 0;font-family:'Roboto Slab',Georgia,serif;font-size:18px;text-transform:uppercase;letter-spacing:1px">Method</h2>${steps}${notes}`}
<div style="flex-grow:1"></div>
<div style="display:flex;justify-content:space-between;font-size:12px;border-top:1px solid #111;padding-top:8px"><span>Internal recipe · do not share</span><b style="font-size:15px">${PHONE}</b></div>
</div>`;
}

function charcoal(c) {
  const A = "#D4A84A";
  const meta = c.meta.map(([k, v]) => `<div style="display:flex;flex-direction:column;align-items:center;gap:2px"><span style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#5A4A2E">${esc(k)}</span><span style="font-family:Fraunces,Georgia,serif;font-weight:600;font-size:17px;color:#2E2A26">${esc(v)}</span></div>`).join("");
  const ing = c.ing.map(([n, q]) => `<div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;line-height:1.22;padding:3px 0;border-bottom:1px dotted #CDBB92"><span>${esc(n)}</span><span style="font-weight:600;white-space:nowrap">${esc(q)}</span></div>`).join("");
  const notes = c.notes.map((n) => `<div style="font-size:12px;line-height:1.38;padding-left:12px;border-left:3px solid #B9954A;margin-bottom:5px">${esc(n)}</div>`).join("");
  const steps = c.steps.map(([t, s], i) => `<div style="display:flex;gap:12px"><div style="width:24px;height:24px;flex-shrink:0;border-radius:12px;background:#2E2A26;color:${A};font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center">${i + 1}</div><div style="font-size:12.5px;line-height:1.4"><b>${esc(t)}.</b> ${esc(s)}</div></div>`).join("");
  const more = c.notes2.length ? `<div style="margin-top:4px;background:#FFFCF5;border:1px solid #DCCBA6;border-radius:10px;padding:8px 12px">${c.notes2.map((n) => `<div style="font-size:12px;line-height:1.38;padding-left:10px;border-left:3px solid #B9954A;margin:3px 0">${esc(n)}</div>`).join("")}</div>` : "";
  return `<div class="card" style="width:816px;height:1056px;box-sizing:border-box;background:#F3EAD8;font-family:Archivo,Arial,sans-serif;color:#2E2A26;display:flex;flex-direction:column;overflow:hidden">
<div style="background:#2E2A26;padding:18px 44px;display:flex;align-items:center;gap:22px;border-bottom:5px solid ${A}">
<img src="${seal()}" alt="Franklin Tiffin Room seal" style="width:88px;height:88px;flex-shrink:0">
<div style="flex-grow:1;display:flex;flex-direction:column;gap:4px">
<div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:${A}">Franklin Tiffin Room · Recipe · Chef only</div>
<h1 style="margin:0;font-family:Fraunces,Georgia,serif;font-weight:700;font-size:42px;line-height:1.05;color:#FBF6EC">${esc(c.title)}</h1>
${c.badge ? `<div style="font-size:14px;font-weight:700;letter-spacing:4px;color:#F7D58A">${esc(c.badge)}</div>` : ""}
<div style="font-family:Fraunces,Georgia,serif;font-style:italic;font-size:16px;color:#E8DCC2">${esc(c.sub)}</div></div></div>
${meta ? `<div style="display:flex;justify-content:space-around;padding:9px 44px;background:#E6D3A8">${meta}</div>` : ""}
<div style="flex-grow:1;min-height:0;display:flex;gap:26px;padding:20px 44px 14px 44px">
<div style="width:268px;flex-shrink:0;display:flex;flex-direction:column;gap:14px">
<div style="background:#FFFCF5;border:1px solid #DCCBA6;border-radius:12px;padding:12px 15px"><h2 style="margin:0 0 6px 0;font-family:Fraunces,Georgia,serif;font-size:20px;color:#2E2A26">Ingredients</h2>${ing}</div>
${notes ? `<div style="padding:0 4px"><h2 style="margin:0 0 6px 0;font-family:Fraunces,Georgia,serif;font-size:18px">Chef's notes</h2>${notes}</div>` : ""}
</div>
<div style="flex-grow:1;display:flex;flex-direction:column;gap:9px"><h2 style="margin:0 0 2px 0;font-family:Fraunces,Georgia,serif;font-size:20px">Method</h2>${steps}${more}</div>
</div>
<div style="background:#2E2A26;color:#FBF6EC;padding:12px 44px;display:flex;justify-content:space-between;align-items:center;font-size:13px"><span>100% vegetarian · Somerset, NJ</span><span style="font-family:Fraunces,Georgia,serif;font-weight:700;font-size:18px;color:${A}">${PHONE}</span></div>
</div>`;
}

/** The full page for one card, scaled to fit the screen; prints at letter size. */
function page(id) {
  const c = cards().find((x) => x.id === id);
  if (!c) return null;
  const card = c.template === "charcoal" ? charcoal(c) : ledger(c, c.template === "ledger-ingredients");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(c.title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@700;800&family=IBM+Plex+Sans:wght@400;600;700&family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700;1,9..144,400&family=Archivo:wght@400;600;700&display=swap">
<style>
html,body{margin:0;background:#E9E1D3}
.bar{position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 16px;background:#2E2A26;color:#F3EBDD;font:600 15px/1.2 system-ui,-apple-system,sans-serif;z-index:2}
.bar a{color:#F3EBDD;text-decoration:none;min-height:44px;display:inline-flex;align-items:center}
.wrap{padding:16px 0 32px;display:flex;justify-content:center}
.card{box-shadow:0 10px 30px -12px rgba(0,0,0,.35)}
@media print{html,body{background:#fff}.bar{display:none}.wrap{padding:0}.card{box-shadow:none;zoom:1!important}@page{size:letter;margin:0}}
</style></head><body>
<div class="bar"><a href="/admin#book">‹ Recipe book</a><span>Chef only</span></div>
<div class="wrap">${card}</div>
<script>
(function(){var el=document.querySelector(".card");function fit(){var z=Math.min(1,(window.innerWidth-16)/816);el.style.zoom=z;}fit();addEventListener("resize",fit);})();
</script>
</body></html>`;
}

module.exports = { summary, importFile, remove, page };
