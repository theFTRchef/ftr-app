/**
 * Draws the "Chef availability" calendar picture customers get on WhatsApp
 * before they choose a date: the months covering the next 60 days, open
 * weekends in green, everything else grey. Built as SVG, turned into a PNG
 * with resvg (no browser needed). Served publicly at /calendar.png so
 * WhatsApp can fetch it.
 */
const crypto = require("crypto");
const { normalizeDateEntry, offersCatering, offersLiveDose, isBooked } = require("./availability");

const TZ = "America/New_York";
const WINDOW_DAYS = 60;

// Same palette as franklintiffinroom.com.
const C = {
  bg: "#fbf6ec",
  card: "#ffffff",
  ink: "#2b2118",
  muted: "#6b5d4f",
  faint: "#d3c6b1",
  line: "#e8dcc6",
  open: "#2f5d3a",
  openSoft: "#dfeadc",
  closed: "#efe7d8",
  turmeric: "#e3a51a",
  chili: "#a8321e",
  bookedSoft: "#f6e1da",
  info: "#2d5a8c"
};
const path = require("path");
const fs = require("fs");
const FONT_DIR = path.join(__dirname, "..", "fonts");

function todayLocal() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}
function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function dow(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function bookedMap(menu) {
  const map = {};
  (menu.availability?.dates || []).map(normalizeDateEntry).forEach((d) => {
    if (isBooked(d) && !offersCatering(d) && !offersLiveDose(d)) map[d.date] = d;
  });
  return map;
}

function openMap(menu) {
  const map = {};
  (menu.availability?.dates || []).map(normalizeDateEntry).forEach((d) => {
    if (offersCatering(d) || offersLiveDose(d)) map[d.date] = d;
  });
  return map;
}

/** Months (YYYY-MM) spanned by today .. today+60. */
function monthsInWindow(today) {
  const end = addDays(today, WINDOW_DAYS);
  const out = [];
  let [y, m] = today.split("-").map(Number);
  while (true) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > end.slice(0, 7)) break;
    out.push(key);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function buildSvg(menu) {
  const today = todayLocal();
  const end = addDays(today, WINDOW_DAYS);
  const open = openMap(menu);
  const booked = bookedMap(menu);
  const months = monthsInWindow(today);

  const W = 760, PAD = 28, CELL_GAP = 8;
  const cellW = (W - PAD * 2 - CELL_GAP * 6) / 7;
  const cellH = 64;
  const parts = [];
  let y = PAD;

  // header
  // The FTR wordmark, as on the website: Fraunces bold, "Tiffin" in chili red.
  parts.push(`<text x="${PAD}" y="${y + 34}" font-family="Fraunces, Georgia, serif" font-size="36" font-weight="700" fill="${C.ink}">Franklin <tspan fill="${C.chili}">Tiffin</tspan> Room</text>`);
  parts.push(`<text x="${PAD}" y="${y + 66}" font-size="20" font-weight="700" fill="${C.chili}" letter-spacing="2">CHEF AVAILABILITY</text>`);
  parts.push(`<text x="${PAD}" y="${y + 92}" font-size="18" fill="${C.muted}">Green days are open · tap a date in the next message</text>`);
  y += 116;

  // legend
  const legend = [
    [C.openSoft, C.open, "Open - you can order"],
    [C.bookedSoft, C.chili, "Booked"],
    [C.closed, C.faint, "Not open"]
  ];
  let lx = PAD;
  legend.forEach(([fill, stroke, label]) => {
    parts.push(`<rect x="${lx}" y="${y}" width="22" height="22" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`);
    parts.push(`<text x="${lx + 32}" y="${y + 17}" font-size="18" fill="${C.ink}">${label}</text>`);
    lx += 32 + label.length * 9.6 + 34;
  });
  y += 46;

  months.forEach((key) => {
    const [yy, mm] = key.split("-").map(Number);
    const first = `${key}-01`;
    const daysIn = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const lead = dow(first);
    const totalRows = Math.ceil((lead + daysIn) / 7);
    // Only draw the weeks that touch the booking window.
    const isoAt = (row, col) => {
      const d = row * 7 + col - lead + 1;
      return d >= 1 && d <= daysIn ? `${key}-${String(d).padStart(2, "0")}` : null;
    };
    const keepRows = [];
    for (let r = 0; r < totalRows; r++) {
      for (let c = 0; c < 7; c++) {
        const iso = isoAt(r, c);
        if (iso && iso >= today && iso <= end) { keepRows.push(r); break; }
      }
    }
    if (!keepRows.length) return;
    const cardH = 70 + 34 + keepRows.length * (cellH + CELL_GAP);
    parts.push(`<rect x="${PAD - 12}" y="${y}" width="${W - PAD * 2 + 24}" height="${cardH}" rx="18" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>`);
    const label = new Date(Date.UTC(yy, mm - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    parts.push(`<text x="${PAD + 4}" y="${y + 44}" font-size="26" font-weight="700" fill="${C.ink}">${label}</text>`);
    let gy = y + 70;
    ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].forEach((wd, i) => {
      const cx = PAD + i * (cellW + CELL_GAP) + cellW / 2;
      parts.push(`<text x="${cx}" y="${gy + 16}" font-size="15" font-weight="700" text-anchor="middle" fill="${i === 0 || i === 6 ? C.ink : C.muted}" letter-spacing="1">${wd}</text>`);
    });
    gy += 34;
    keepRows.forEach((row, ri) => {
      for (let col = 0; col < 7; col++) {
        const iso = isoAt(row, col);
        if (!iso) continue;
        const d = Number(iso.slice(8));
        const x = PAD + col * (cellW + CELL_GAP);
        const cy = gy + ri * (cellH + CELL_GAP);
        const inWindow = iso >= today && iso <= end;
        const e = inWindow ? open[iso] : null;
        const b = inWindow && !e ? booked[iso] : null;
        const weekend = col === 0 || col === 6;
        let fill = "none", stroke = "none", num = C.faint, weight = 400;
        if (e) { fill = C.openSoft; stroke = C.open; num = C.open; weight = 700; }
        else if (b) { fill = C.bookedSoft; stroke = C.chili; num = C.chili; weight = 700; }
        else if (inWindow && weekend) { fill = C.closed; stroke = C.line; num = C.muted; }
        else if (inWindow) { num = C.muted; }
        if (fill !== "none") parts.push(`<rect x="${x}" y="${cy}" width="${cellW}" height="${cellH}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`);
        if (iso === today) parts.push(`<rect x="${x + 1}" y="${cy + 1}" width="${cellW - 2}" height="${cellH - 2}" rx="11" fill="none" stroke="${C.ink}" stroke-width="2.5"/>`);
        parts.push(`<text x="${x + cellW / 2}" y="${cy + 33}" font-size="23" font-weight="${weight}" text-anchor="middle" fill="${num}">${d}</text>`);
        if (b) parts.push(`<text x="${x + cellW / 2}" y="${cy + 54}" font-size="13" font-weight="700" text-anchor="middle" fill="${C.chili}" letter-spacing="0.5">BOOKED</text>`);
        if (e) {
          const dots = [];
          if (e.pickupAM || e.pickupPM) dots.push(C.open);
          if (e.catering.length) dots.push(C.info);
          if (e.liveDose.length) dots.push(C.turmeric);
          const startX = x + cellW / 2 - ((dots.length - 1) * 14) / 2;
          dots.forEach((c, i) => parts.push(`<circle cx="${startX + i * 14}" cy="${cy + 50}" r="4.5" fill="${c}"/>`));
        }
      }
    });
    y += cardH + 20;
  });

  // dot key
  const keys = [[C.open, "Pickup"], [C.info, "Delivery"], [C.turmeric, "LIVE Dose Station"]];
  let kx = PAD;
  keys.forEach(([c, label]) => {
    parts.push(`<circle cx="${kx + 6}" cy="${y + 8}" r="6" fill="${c}"/>`);
    parts.push(`<text x="${kx + 20}" y="${y + 14}" font-size="18" fill="${C.ink}">${label}</text>`);
    kx += 20 + label.length * 9.6 + 30;
  });
  y += 40;

  const H = Math.round(y + 8);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Figtree, DejaVu Sans, Arial, sans-serif">` +
    `<rect width="${W}" height="${H}" fill="${C.bg}"/>${parts.join("")}</svg>`;
}

let cache = { key: null, png: null };

/** PNG of the current calendar, cached until availability or the day changes. */
function renderPng(menu) {
  const svg = buildSvg(menu);
  const key = crypto.createHash("sha1").update(svg).digest("hex");
  if (cache.key === key) return { png: cache.png, version: key.slice(0, 10) };
  const { Resvg } = require("@resvg/resvg-js");
  const png = new Resvg(svg, {
    font: {
      fontFiles: fs.existsSync(FONT_DIR) ? fs.readdirSync(FONT_DIR).filter((f) => /\.ttf$/i.test(f)).map((f) => path.join(FONT_DIR, f)) : [],
      loadSystemFonts: true,
      defaultFontFamily: "Figtree"
    },
    fitTo: { mode: "width", value: 760 }
  }).render().asPng();
  cache = { key, png };
  return { png, version: key.slice(0, 10) };
}

/** Version string for the image URL, so WhatsApp never shows a stale copy. */
function currentVersion(menu) {
  try {
    return renderPng(menu).version;
  } catch (err) {
    console.error("Calendar image unavailable:", err.message);
    return null;
  }
}

module.exports = { buildSvg, renderPng, currentVersion };
