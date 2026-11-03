/**
 * The menu as a picture, sent when a customer taps "See our menu".
 * LIVE Dose Station first, then each catering category with sizes,
 * servings and prices - the same look as the admin page.
 * Built as SVG, turned into a PNG with resvg, served at /menu.png.
 *
 * Fonts are bundled in fonts/ (Figtree, Bricolage Grotesque, Noto Sans
 * Kannada for dish names written in Kannada) so the server needs nothing
 * installed.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FONT_DIR = path.join(__dirname, "..", "fonts");

// Kannada needs proper "shaping" (joining letters and vowel signs), which
// the image renderer gets wrong, so Kannada text is shaped with HarfBuzz
// and drawn as outlines instead.
let hb = null;
const hbFonts = {};
const hbReady = (async () => {
  try {
    hb = await require("harfbuzzjs");
  } catch (err) {
    console.error("Kannada shaping unavailable:", err.message);
  }
})();

function hbFont(weight) {
  const file = weight >= 700 ? "NotoSansKannada-Bold.ttf" : weight >= 600 ? "NotoSansKannada-SemiBold.ttf" : "NotoSansKannada-Regular.ttf";
  if (!hbFonts[file]) {
    const blob = hb.createBlob(fs.readFileSync(path.join(FONT_DIR, file)));
    const face = hb.createFace(blob, 0);
    hbFonts[file] = { font: hb.createFont(face), upem: face.upem || 1000 };
  }
  return hbFonts[file];
}

/** Kannada (or mixed) text as SVG paths. Returns null if it can't. */
function shaped(text, x, y, size, weight, fill, anchor) {
  if (!hb) return null;
  try {
    const { font, upem } = hbFont(weight);
    const buf = hb.createBuffer();
    buf.addText(String(text));
    buf.guessSegmentProperties();
    hb.shape(font, buf);
    const glyphs = buf.json();
    buf.destroy && buf.destroy();
    const total = glyphs.reduce((n, g) => n + g.ax, 0);
    let pen = anchor === "end" ? -total : anchor === "middle" ? -total / 2 : 0;
    const k = size / upem;
    const paths = glyphs.map((g) => {
      const d = font.glyphToPath(g.g);
      const gx = pen + g.dx;
      pen += g.ax;
      return d ? `<path transform="translate(${gx} ${g.dy})" d="${d}"/>` : "";
    });
    return `<g fill="${fill}" transform="translate(${x} ${y}) scale(${k} ${-k})">${paths.join("")}</g>`;
  } catch (err) {
    console.error("Kannada shaping failed:", err.message);
    return null;
  }
}

/**
 * One line of text. Plain <text> normally; HarfBuzz outlines when it
 * contains Kannada.
 */
function txt({ x, y, size, weight = 400, fill, family, anchor, extra = "" }, text) {
  if (KANNADA.test(String(text))) {
    const out = shaped(text, x, y, size, weight, fill, anchor);
    if (out) return out;
  }
  return `<text x="${x}" y="${y}"${anchor ? ` text-anchor="${anchor}"` : ""} font-family="${family || FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" ${extra}>${esc(text)}</text>`;
}

// Same palette as franklintiffinroom.com.
const C = {
  bg: "#fbf6ec",
  card: "#ffffff",
  ink: "#2b2118",
  muted: "#6b5d4f",
  line: "#e8dcc6",
  leaf: "#2f5d3a",
  leafSoft: "#e4ede3",
  turmeric: "#e3a51a",
  turmericSoft: "#fbefd2",
  chili: "#a8321e"
};

const W = 1000;
const PAD = 40;
const KANNADA = /[\u0C80-\u0CFF]/;
const FONT = "Figtree, Noto Sans Kannada, DejaVu Sans, sans-serif";
const DISPLAY = "Fraunces, Georgia, Noto Sans Kannada, DejaVu Serif, serif";

/**
 * The FTR wordmark, exactly as on the website: "Franklin Tiffin Room" in
 * Fraunces bold, with "Tiffin" in chili red.
 */
function wordmark(x, y, size, anchor = "start") {
  return (
    `<text x="${x}" y="${y}"${anchor !== "start" ? ` text-anchor="${anchor}"` : ""} font-family="Fraunces, Georgia, serif" font-size="${size}" font-weight="700" fill="${C.ink}">` +
    `Franklin <tspan fill="${C.chili}">Tiffin</tspan> Room</text>`
  );
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/** Rough text width (no layout engine here) - good enough to wrap/trim. */
function textWidth(s, size) {
  let w = 0;
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x0c80 && cp <= 0x0cff) w += 0.62; // Kannada (marks overlap, so average)
    else if (/[A-Z0-9$]/.test(ch)) w += 0.62;
    else if (/[ilj.,'|!:;]/.test(ch)) w += 0.27;
    else if (ch === " ") w += 0.27;
    else if (/[mwMW]/.test(ch)) w += 0.85;
    else w += 0.52;
  }
  return w * size;
}

function wrap(text, size, maxW, maxLines = 3) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? cur + " " + w : w;
    if (textWidth(next, size) <= maxW || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    return kept;
  }
  return lines;
}

function money(n) {
  const v = Number(n || 0);
  return "$" + (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(2));
}

function servesText(i) {
  if (!i.servesMin) return "";
  return i.servesMin === i.servesMax || !i.servesMax ? `serves ${i.servesMin}` : `serves ${i.servesMin}–${i.servesMax}`;
}

/** "½ tray $84.50" when half trays are on (price only - no formula). */
function halfText(settings, item) {
  if (!settings.halfTrays) return "";
  const pct = Number(settings.halfTrayPercent) > 0 ? Number(settings.halfTrayPercent) : 65;
  const v = Math.round(Number(item.price || 0) * pct) / 100;
  return `½ tray ${Number.isInteger(v) ? "$" + v : "$" + v.toFixed(2)}`;
}

function shortTime(t) {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "AM" : "PM"}`;
}

function ldsInfo(menu, lds) {
  const { ldsSessions, ldsExtension } = require("./availability");
  const sess = ldsSessions(menu).map((w) => `${shortTime(w.start)}–${shortTime(w.end)}`).join(" or ");
  const ext = ldsExtension(menu);
  const per = Number(lds.pricePerHundred || 0) / 100;
  return `On site ${sess}. Extra ${ext.minutes} min $${ext.fee}. Extra doses $${per} each (in ${Number(lds.extraDoseIncrement) || 10}s, while supplies last).`;
}

/** LIVE Dose Station (the flagship) first, then the rest in menu order. */
function orderedCategories(menu) {
  return (menu.categories || [])
    .filter((c) => c.type === "live-dose-station" || (c.items || []).length)
    .slice()
    .sort((a, b) => (a.type === "live-dose-station" ? 0 : 1) - (b.type === "live-dose-station" ? 0 : 1));
}

function buildSvg(menu, categoryId = null) {
  const s = menu.settings || {};
  const parts = [];
  let y = PAD;
  const inner = W - PAD * 2;

  // Header
  parts.push(`<text x="${PAD}" y="${y + 16}" font-family="${FONT}" font-size="18" font-weight="700" fill="${C.chili}" letter-spacing="3">MENU</text>`);
  parts.push(wordmark(PAD, y + 62, 44));
  y += 84;
  if (s.tagline) {
    wrap(s.tagline, 22, inner, 2).forEach((l) => {
      y += 30;
      parts.push(txt({ x: PAD, y, size: 22, fill: C.muted }, l));
    });
  }
  y += 28;

  const cats = orderedCategories(menu).filter((c) => !categoryId || c.id === categoryId);

  let pickupNoteDone = false;
  for (const cat of cats) {
    if (cat.type === "live-dose-station") {
      const lds = cat.liveDoseStation || {};
      const descLines = wrap(
        `${lds.mdTitle || "Mysore Masale Dose"} and ${lds.odTitle || "Onion Dose"}, cooked fresh at your event by our crew. ` +
          ldsInfo(menu, lds),
        22, inner - 48, 4
      );
      const h = 64 + descLines.length * 30 + 96 + 24;
      parts.push(`<rect x="${PAD}" y="${y}" width="${inner}" height="${h}" rx="24" fill="${C.turmericSoft}" stroke="${C.turmeric}" stroke-width="2"/>`);
      parts.push(`<rect x="${PAD + 24}" y="${y + 22}" width="104" height="30" rx="15" fill="${C.chili}"/>`);
      parts.push(`<circle cx="${PAD + 42}" cy="${y + 37}" r="5" fill="#fff"/>`);
      parts.push(`<text x="${PAD + 54}" y="${y + 43}" font-family="${FONT}" font-size="16" font-weight="700" fill="#fff" letter-spacing="1.5">LIVE</text>`);
      parts.push(txt({ x: PAD + 144, y: y + 46, size: 32, weight: 700, fill: C.ink, family: DISPLAY }, cat.title || "LIVE Dose Station"));
      let ly = y + 64;
      descLines.forEach((l) => {
        ly += 30;
        parts.push(txt({ x: PAD + 24, y: ly, size: 22, fill: C.ink }, l));
      });
      ly += 22;
      const facts = [
        [money(lds.pricePerHundred), "per 100 plates"],
        [money(lds.setupFee), "setup fee"],
        [`${lds.minTotal}–${lds.maxTotal}`, `plates (in ${lds.increment}s)`]
      ];
      const fw = (inner - 48 - 24) / 3;
      facts.forEach(([big, small], i) => {
        const fx = PAD + 24 + i * (fw + 12);
        parts.push(`<rect x="${fx}" y="${ly}" width="${fw}" height="78" rx="16" fill="#ffffff"/>`);
        parts.push(`<text x="${fx + 18}" y="${ly + 36}" font-family="${FONT}" font-size="28" font-weight="700" fill="${C.ink}">${esc(big)}</text>`);
        parts.push(`<text x="${fx + 18}" y="${ly + 62}" font-family="${FONT}" font-size="18" fill="${C.muted}">${esc(small)}</text>`);
      });
      y += h + 30;
      continue;
    }

    const items = cat.items || [];
    if (!items.length) continue;
    if (!pickupNoteDone) {
      pickupNoteDone = true;
      const { pickupTimes, pickupOnly } = require("./availability");
      const pt = pickupTimes(menu);
      const note = `${pickupOnly(menu) ? "Catering is pickup only · " : ""}Lunch pickup ${shortTime(pt.am)} · Dinner pickup ${shortTime(pt.pm)}`;
      parts.push(`<rect x="${PAD}" y="${y}" width="${inner}" height="48" rx="14" fill="${C.leafSoft}"/>`);
      parts.push(txt({ x: W / 2, y: y + 32, size: 21, weight: 700, fill: C.leaf, anchor: "middle" }, note));
      y += 66;
    }
    // Section heading
    parts.push(txt({ x: PAD + 4, y: y + 22, size: 19, weight: 700, fill: C.muted, extra: 'letter-spacing="2"' }, String(cat.title || "").toUpperCase()));
    y += 40;
    const rowH = (i) => (i.size || i.servesMin ? 84 : 64);
    const cardH = items.reduce((n, i) => n + rowH(i), 0);
    parts.push(`<rect x="${PAD}" y="${y}" width="${inner}" height="${cardH}" rx="22" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>`);
    let ry = y;
    items.forEach((it, idx) => {
      const h = rowH(it);
      if (idx > 0) parts.push(`<line x1="${PAD + 24}" x2="${PAD + inner - 24}" y1="${ry}" y2="${ry}" stroke="${C.line}" stroke-width="2"/>`);
      const price = money(it.price);
      const priceW = textWidth(price, 28) + 8;
      const nameMax = inner - 48 - priceW - 24;
      const name = wrap(it.title, 26, nameMax, 1)[0] || "";
      const sub = [it.size, servesText(it), halfText(s, it)].filter(Boolean).join(" · ");
      const nameY = sub ? ry + 38 : ry + 41;
      parts.push(txt({ x: PAD + 24, y: nameY, size: 26, weight: 600, fill: C.ink }, name));
      if (sub) parts.push(txt({ x: PAD + 24, y: ry + 68, size: 20, fill: C.muted }, wrap(sub, 20, nameMax, 1)[0]));
      parts.push(`<text x="${PAD + inner - 24}" y="${ry + h / 2 + 10}" text-anchor="end" font-family="${FONT}" font-size="28" font-weight="700" fill="${C.ink}">${esc(price)}</text>`);
      ry += h;
    });
    y += cardH + 30;
  }


  // Footer
  const foot = [];
  if (s.phoneDisplay) foot.push(`Call ${s.phoneDisplay}`);
  foot.push("Tap “Place an order” below to start");
  parts.push(`<text x="${W / 2}" y="${y + 18}" text-anchor="middle" font-family="${FONT}" font-size="20" fill="${C.muted}">${esc(foot.join("  ·  "))}</text>`);
  y += 18 + PAD;

  const H = Math.round(y);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="${C.bg}"/>${parts.join("")}</svg>`;
}

function fontFiles() {
  try {
    return fs.readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/i.test(f)).map((f) => path.join(FONT_DIR, f));
  } catch (e) {
    return [];
  }
}

const cache = new Map();

async function renderPng(menu, categoryId = null) {
  await hbReady;
  const svg = buildSvg(menu, categoryId);
  const key = crypto.createHash("sha1").update(svg).digest("hex");
  if (cache.has(key)) return { png: cache.get(key), version: key.slice(0, 10) };
  const { Resvg } = require("@resvg/resvg-js");
  const png = new Resvg(svg, {
    font: { fontFiles: fontFiles(), loadSystemFonts: true, defaultFontFamily: "Figtree" },
    fitTo: { mode: "width", value: W }
  }).render().asPng();
  cache.set(key, png);
  if (cache.size > 30) cache.delete(cache.keys().next().value);
  return { png, version: key.slice(0, 10) };
}

async function currentVersion(menu, categoryId = null) {
  try {
    return (await renderPng(menu, categoryId)).version;
  } catch (err) {
    console.error("Menu image unavailable:", err.message);
    return null;
  }
}

module.exports = { buildSvg, renderPng, currentVersion, orderedCategories };
