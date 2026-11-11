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
    cancelled: e.cancelled === true,
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
  return all(menu).filter((e) => now < e.cutoff && !e.cancelled);
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
      return { date: n.date, pickupTime: n.pickupTime, orderByDate: n.orderByDate, orderByTime: n.orderByTime, ...(n.cancelled ? { cancelled: true } : {}) };
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
    rowDescription: "Take-home Masale Dose kit for 4 - pre-order, pickup only",
    items: [
      {
        id: DIB_ID,
        title: "Dose-in-a-Box",
        description:
          "A take-home kit for Mysore Masale Dose, prepped and packed. You just make it on your tawa. In the box: dose batter, potato-onion palya, red garlic chutney and green coconut chutney.",
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

// ------------------------------------------------------------ day limits
// Each pre-order dish can have a kitchen minimum and a most-per-day for a
// pickup day (all customers together), set by Chef on the dish.

function preItems(menu) {
  return (menu.categories || []).filter(isPreorderCategory).flatMap((c) => c.items || []);
}

/** Portions already ordered for a pickup day, per dish id (open orders only). */
function dayCounts(date, exceptOrderId = null) {
  const counts = {};
  for (const o of require("./orderDb").all()) {
    if (o.eventDate !== date || o.orderId === exceptOrderId || !isPreorderOrder(o) || CLOSED.test(o.status || "")) continue;
    for (const l of o.cart || []) if (l.isPreorder) counts[l.id] = (counts[l.id] || 0) + Number(l.qty || 0);
  }
  return counts;
}

/**
 * Where each pre-order dish stands for a pickup day:
 * { itemId, title, ordered, min, max, left, needed, reached }.
 * `adding` = { itemId: qty } for a cart being checked.
 */
function dayStatus(menu, date, adding = {}) {
  const counts = dayCounts(date);
  return preItems(menu)
    .filter((i) => Number(i.price) > 0)
    .map((i) => {
      const min = Number(i.dayMin) > 0 ? Math.round(Number(i.dayMin)) : 0;
      const max = Number(i.dayMax) > 0 ? Math.round(Number(i.dayMax)) : null;
      const ordered = counts[i.id] || 0;
      const add = Number(adding[i.id] || 0);
      return {
        itemId: i.id,
        title: i.title,
        ordered,
        adding: add,
        min,
        max,
        left: max == null ? null : Math.max(0, max - ordered),
        needed: Math.max(0, min - ordered),
        reached: min === 0 || ordered + add >= min
      };
    });
}

/** Problem with fitting this cart into a pickup day (over the day's most), or null. */
function capacityProblem(menu, date, cart) {
  const adding = {};
  for (const l of cart || []) if (l.isPreorder) adding[l.id] = (adding[l.id] || 0) + Number(l.qty || 0);
  for (const st of dayStatus(menu, date, adding)) {
    if (st.max != null && st.adding > st.left) {
      return st.left === 0
        ? `Sorry - ${st.title} is sold out for that pickup day.`
        : `Sorry - only ${st.left} ${st.title} left for that pickup day. Please lower your amount.`;
    }
  }
  return null;
}

/** One line per dish for customers, e.g. "Dose-in-a-Box: 5 of 10 ordered - 5 more needed to make the batch. 15 left." */
function statusLines(menu, date, adding = {}) {
  return dayStatus(menu, date, adding)
    .filter((st) => st.min > 0 || st.max != null)
    .map((st) => {
      const parts = [];
      if (st.min > 0) {
        if (st.adding && st.ordered < st.min && st.ordered + st.adding >= st.min) parts.push(`your order brings it to ${st.ordered + st.adding} - that makes the kitchen minimum of ${st.min}, so the batch is on!`);
        else if (st.ordered >= st.min) parts.push(`${st.ordered} ordered - kitchen minimum of ${st.min} reached, the batch is on`);
        else parts.push(`${st.ordered} of ${st.min} ordered so far - ${st.min - st.ordered - st.adding > 0 ? `${st.min - st.ordered - st.adding} more needed` : "your order completes it"} to make the batch (kitchen minimum for the day)`);
      }
      if (st.max != null) parts.push(st.left === 0 ? "sold out" : `${st.left} left`);
      return `${st.title}: ${parts.join(". ")}.`;
    });
}

const REGRET = (o, e, paid) =>
  `We're truly sorry - Chef has had to cancel the pre-order batch for pickup ${e.pickupLabel}, so your order ${o.orderId} won't go ahead.` +
  (paid ? ` Your deposit of $${Number(o.payment.depositDue || 0).toFixed(2)} will be refunded by Zelle.` : "") +
  `\n\nWe know you were counting on it, and we don't take this lightly. Cancellations like this are rare - they only happen in extreme situations - and we're working to make sure it doesn't happen again. We hope to cook for you on the next pickup day.\n\n- Chef, Franklin Tiffin Room`;

/**
 * Chef cancels a whole pickup day: every open pre-order for it is cancelled,
 * each customer gets the regret message, and the day closes to new orders.
 */
async function cancelBatch(date) {
  const menuStore = require("./menuStore");
  const menu = menuStore.getMenu();
  const raw = (menu.availability.preorders || []).find((x) => x.date === date);
  if (!raw) return { ok: false, reason: "That pickup day isn't set up." };
  const e = normalize(raw);
  raw.cancelled = true;
  menuStore.saveMenu(menu);
  const orderDb = require("./orderDb");
  const records = require("./records");
  const { sendText } = require("./messaging");
  const affected = orderDb.all().filter((o) => o.eventDate === date && isPreorderOrder(o) && !CLOSED.test(o.status || ""));
  const owner = process.env.OWNER_WHATSAPP_NUMBER;
  for (const o of affected) {
    const paid = !!(o.payment && (o.payment.state === "paid" || o.payment.state === "review"));
    const status = "Cancelled by Chef (batch)";
    orderDb.update(o.orderId, {
      status,
      pending: false,
      cancelledAt: new Date().toISOString(),
      cancelledBy: "chef",
      batchCancelled: true,
      ...(o.payment ? { payment: { ...o.payment, state: paid ? "refund" : "cancelled" } } : {})
    });
    await records.updateOrderStatus(o.orderId, status).catch(() => {});
    if (o.payment) {
      await records.updateOrderPayment(o.orderId, paid ? `REFUND deposit $${Number(o.payment.depositDue || 0).toFixed(2)} - batch cancelled` : "Deposit not needed - batch cancelled").catch(() => {});
    }
    await sendText(o.customerPhone, REGRET(o, e, paid)).catch((err) => console.error(`Regret message for ${o.orderId} not sent:`, err.message));
  }
  const refunds = affected.filter((o) => o.payment && (o.payment.state === "paid" || o.payment.state === "review"));
  if (owner) {
    await sendText(
      owner,
      `Batch for pickup ${e.pickupLabel} cancelled. ${affected.length} customer${affected.length === 1 ? "" : "s"} told.` +
        (refunds.length ? `\n\nRefund these deposits by Zelle:\n${refunds.map((o) => `- ${o.orderId} ${o.customerName || o.customerPhone}: $${Number(o.payment.depositDue || 0).toFixed(2)}`).join("\n")}` : "")
    ).catch(() => {});
  }
  return { ok: true, cancelled: affected.map((o) => o.orderId), refunds: refunds.map((o) => o.orderId) };
}

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
  const mins = dayStatus(menu, e.date).filter((st) => st.min > 0);
  return (
    `PREP LIST - pre-orders closed for pickup ${e.pickupLabel}\n\n` +
    p.totals.map((t) => `${t.qty} x ${t.title}`).join("\n") +
    (mins.length ? `\n\n` + mins.map((st) => `${st.title}: ${st.ordered >= st.min ? "minimum reached" : `BELOW your minimum of ${st.min}`} (${st.ordered} ordered)`).join("\n") +
      (mins.some((st) => st.ordered < st.min) ? `\nTo cancel this batch, open Chef's Kitchen > Today > Cancel this batch (every customer is told).` : "") : "") +
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
  dayStatus,
  dayCounts,
  capacityProblem,
  statusLines,
  cancelBatch,
  checkCutoffs,
  startWatcher,
  njTime
};
