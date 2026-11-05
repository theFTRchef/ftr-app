/**
 * Pre-orders: Dose-in-a-Box and Chef's weekly takeout specials.
 *
 * Chef opens pickup days in /admin (Setup > Pre-order pickups), e.g.
 * "pickup Fri Nov 13 at 6:00 PM, order by Tue Nov 10 at 6:00 PM".
 * Menu sections with type "preorder" can only be ordered for those days,
 * always for pickup, until the order-by time. When the order-by time
 * passes, Chef gets a WhatsApp prep list (how many of each to make).
 *
 *   menu.availability.preorders = [
 *     { date: "2026-11-13", pickupTime: "18:00", orderByDate: "2026-11-10", orderByTime: "18:00" }
 *   ]
 */
const TZ = "America/New_York";
const store = require("./jsonFile");
const { isValidTime, formatTimeLabel } = require("./timeUtils");

const DIB_ID = "dose-in-a-box";
const DEFAULT_PICKUP_TIME = "18:00";
const DEFAULT_ORDER_BY_TIME = "18:00";
const DEFAULT_ORDER_BY_DAYS = 3; // Friday pickup -> order by Tuesday

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Epoch ms of a New Jersey local date + time. */
function njTime(dateStr, hhmm) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (t) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
    }).formatToParts(new Date(t));
    const get = (k) => Number(parts.find((x) => x.type === k).value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return t;
}

function dayLabel(dateStr, withYear = false) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC"
  });
}

function shortTime(t) {
  return formatTimeLabel(t).replace(":00 ", " ");
}

/** One pickup day, with defaults filled in. */
function normalize(e) {
  if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || "")) return null;
  const pickupTime = isValidTime(e.pickupTime) ? e.pickupTime : DEFAULT_PICKUP_TIME;
  const orderByDate = /^\d{4}-\d{2}-\d{2}$/.test(e.orderByDate || "") && e.orderByDate <= e.date ? e.orderByDate : addDays(e.date, -DEFAULT_ORDER_BY_DAYS);
  const orderByTime = isValidTime(e.orderByTime) ? e.orderByTime : DEFAULT_ORDER_BY_TIME;
  return {
    date: e.date,
    pickupTime,
    orderByDate,
    orderByTime,
    cutoff: njTime(orderByDate, orderByTime),
    pickupLabel: `${dayLabel(e.date)} at ${formatTimeLabel(pickupTime)}`,
    orderByLabel: `${dayLabel(orderByDate)}, ${shortTime(orderByTime)}`
  };
}

/** Every pickup day Chef has set, oldest first. */
function all(menu) {
  const list = (menu && menu.availability && menu.availability.preorders) || [];
  return (Array.isArray(list) ? list : []).map(normalize).filter(Boolean).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Pickup days customers can still order for (order-by time not passed). */
function open(menu, now = Date.now()) {
  return all(menu).filter((e) => now < e.cutoff);
}

function openEntry(menu, date, now = Date.now()) {
  return open(menu, now).find((e) => e.date === date) || null;
}

function isPreorderCategory(c) {
  return !!c && c.type === "preorder";
}

/** "Order by Tue, Nov 10, 6 PM · pickup Fri, Nov 13 at 6:00 PM" for the next open day. */
function nextLine(menu) {
  const e = open(menu)[0];
  return e ? `Order by ${e.orderByLabel} · pickup ${e.pickupLabel}` : null;
}

/** Saved shape for menu.json (admin save). Throws on bad input. */
function clean(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list
    .map((e, i) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test((e && e.date) || "")) throw new Error(`Pre-order pickup ${i + 1} needs a date`);
      if (seen.has(e.date)) throw new Error(`Pre-order pickup ${e.date} is listed twice`);
      seen.add(e.date);
      const n = normalize(e);
      if (e.orderByDate && e.orderByDate > e.date) throw new Error(`Pre-order pickup ${e.date}: the order-by date must be on or before the pickup date`);
      return { date: n.date, pickupTime: n.pickupTime, orderByDate: n.orderByDate, orderByTime: n.orderByTime };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** The Dose-in-a-Box section, created once so Chef only has to set the price. */
function ensureDoseInABox(menu) {
  if (!menu || !Array.isArray(menu.categories)) return menu;
  if (menu.categories.some((c) => c.id === DIB_ID)) return menu;
  const at = menu.categories.findIndex((c) => c.type === "live-dose-station");
  menu.categories.splice(at >= 0 ? at + 1 : 0, 0, {
    id: DIB_ID,
    type: "preorder",
    flagship: true,
    title: "Dose-in-a-Box",
    rowTitle: "Dose-in-a-Box",
    rowDescription: "Take-home Masala Dose kit for 4 - pre-order, pickup only",
    items: [
      {
        id: DIB_ID,
        title: "Dose-in-a-Box",
        description:
          "A take-home kit for Mysore Masala Dose, prepped and packed. You just make it on your tawa. In the box: dose batter, potato-onion palya, red garlic chutney and green coconut chutney.",
        price: 0,
        size: "Kit - serves 4",
        servesMin: 4,
        servesMax: 4,
        minQty: 1,
        maxQty: 10
      }
    ]
  });
  return menu;
}

// ------------------------------------------------------------ prep list

function isPreorderOrder(o) {
  return (o.cart || []).some((l) => l.isPreorder) || o.kind === "preorder";
}

const CLOSED = /declined|cancelled|released/i;

/** What to make for one pickup day: totals per item and the orders. */
function prepList(date) {
  const orders = require("./orderDb")
    .all()
    .filter((o) => o.eventDate === date && isPreorderOrder(o) && !CLOSED.test(o.status || ""));
  const totals = {};
  for (const o of orders) {
    for (const l of o.cart || []) {
      if (!l.isPreorder) continue;
      totals[l.title] = (totals[l.title] || 0) + Number(l.qty || 0);
    }
  }
  return {
    date,
    orders: orders.map((o) => ({
      orderId: o.orderId,
      name: o.customerName || o.customerPhone,
      phone: o.customerPhone,
      status: o.status || "",
      items: (o.cart || []).filter((l) => l.isPreorder).map((l) => `${l.qty}x ${l.title}`).join(", "),
      subtotal: o.subtotal
    })),
    totals: Object.entries(totals).map(([title, qty]) => ({ title, qty }))
  };
}

function prepText(menu, e) {
  const p = prepList(e.date);
  if (!p.orders.length) return `Pre-orders for pickup ${e.pickupLabel} are closed - no orders this time.`;
  return (
    `PREP LIST - pre-orders closed for pickup ${e.pickupLabel}\n\n` +
    p.totals.map((t) => `${t.qty} x ${t.title}`).join("\n") +
    `\n\n${p.orders.length} order${p.orders.length === 1 ? "" : "s"}:\n` +
    p.orders.map((o) => `- ${o.orderId} ${o.name}: ${o.items} (${o.status})`).join("\n")
  ).slice(0, 4000);
}

/** When an order-by time passes, send Chef the prep list once. */
function checkCutoffs(now = Date.now()) {
  const owner = process.env.OWNER_WHATSAPP_NUMBER;
  if (!owner) return;
  let menu;
  try {
    menu = require("./menuStore").getMenu();
  } catch (e) {
    return;
  }
  const sent = store.read("preorder-prep-sent.json", {}) || {};
  for (const e of all(menu)) {
    if (now < e.cutoff || now - e.cutoff > 2 * 24 * 3600 * 1000 || sent[e.date]) continue;
    sent[e.date] = new Date(now).toISOString();
    store.write("preorder-prep-sent.json", sent);
    require("./messaging")
      .sendText(owner, prepText(menu, e))
      .catch((err) => console.error(`Prep list for ${e.date} not sent:`, err.message));
  }
}

let timer = null;
function startWatcher() {
  if (timer) return;
  timer = setInterval(() => {
    try {
      checkCutoffs();
    } catch (err) {
      console.error("Pre-order cutoff check failed:", err.message);
    }
  }, 5 * 60 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = {
  DIB_ID,
  all,
  open,
  openEntry,
  normalize,
  clean,
  nextLine,
  isPreorderCategory,
  isPreorderOrder,
  ensureDoseInABox,
  prepList,
  prepText,
  checkCutoffs,
  startWatcher,
  njTime
};
