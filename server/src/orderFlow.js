const menuStore = require("./menuStore");
const sessionStore = require("./sessionStore");
const pendingOrderStore = require("./pendingOrderStore");
const ownerState = require("./ownerState");
const { sendText, sendButtons, sendList, sendImage, choiceFromNumber } = require("./messaging");
const calendarImage = require("./calendarImage");
const menuImage = require("./menuImage");
const { appendOrder, updateOrderStatus, updateOrderSubtotal, updateOrderTime } = require("./records");
const customerStore = require("./customerStore");
const { verifyAddress, milesBetween } = require("./geocode");
const { generateSlots, formatTimeLabel, liveDoseSchedule, liveDoseTotalMinutes } = require("./timeUtils");
const { normalizeDateEntry, pickupTimes, offersCatering, offersLiveDose, customerView, pickupOnly, ldsExtension } = require("./availability");

/** The menu as customers see it (catering delivery hidden when pickup-only). */
function botMenu() {
  return customerView(menuStore.getMenu());
}
const payments = require("./payments");
const { deadlineLabel } = require("./paymentText");

const RESTART_WORDS = /^(menu|restart|start over|hi|hello|hey)$/i;
const DESCRIBE_WORDS = /^(describe|details|detail|info|more info|tell me more|what is (it|this)\??)$/i;
const SKIP_WORDS = /^(skip|none|no|n\/a)$/i;

function findCategory(menu, categoryId) {
  return menu.categories.find((c) => c.id === categoryId);
}

function findItem(menu, itemId) {
  for (const category of menu.categories) {
    const item = category.items.find((i) => i.id === itemId);
    if (item) return item;
  }
  return null;
}

/** How payment works, in one sentence for customers. */
function paymentSentence(menu) {
  if (payments.enabled(menu)) return payments.ruleSentence(menu);
  return "Payment is collected in person.";
}

/** Short name used everywhere after the first greeting (admin Setup; default "FTR"). */
function shortName(menu) {
  return (menu.settings && String(menu.settings.shortName || "").trim()) || "FTR";
}

function orderId() {
  return `FTR-${Date.now().toString(36).toUpperCase()}`;
}

function cartSubtotal(cart) {
  return cart.reduce((sum, line) => sum + line.qty * line.price, 0);
}

function servingsLabel(item) {
  if (!item.servesMin) return "";
  return item.servesMin === item.servesMax
    ? `serves ${item.servesMin}`
    : `serves ${item.servesMin}-${item.servesMax}`;
}

function formatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

function cartOrderTypes(cart) {
  return {
    hasCatering: cart.some((l) => !l.isLiveDoseStation && !l.isPreorder),
    hasLiveDose: cart.some((l) => l.isLiveDoseStation),
    // Dose-in-a-Box / weekly takeout: order by Chef's deadline, pickup on a set day.
    hasPreorder: cart.some((l) => l.isPreorder)
  };
}

const preorders = require("./preorders");

function liveDoseTotalInCart(cart) {
  const line = cart.find((l) => l.isLiveDoseStation);
  return line ? (line.mdQty || 0) + (line.odQty || 0) : null;
}

/**
 * A Live Dose Station order needs a slot long enough for setup + serving
 * + close-out (which scales with how many plates were ordered) rather
 * than the fixed site-wide slot length used for regular catering.
 */
function liveDoseConfig(menu) {
  const cat = (menu.categories || []).find((c) => c.type === "live-dose-station");
  return cat ? cat.liveDoseStation : null;
}

function requiredSlotMinutes(menu, cart) {
  const ldsTotal = liveDoseTotalInCart(cart);
  if (ldsTotal) return liveDoseTotalMinutes(ldsTotal, liveDoseConfig(menu));
  return menu.availability?.slotLengthMinutes || 120;
}

/**
 * Weekdays are never bookable - only dates the owner has explicitly
 * added via /admin show up here, and only if they cover whichever
 * order type(s) are actually in the cart (catering trays, the Live Dose
 * Station, or both).
 */
// Customers see, and can book, chef dates this many days ahead.
const BOOKING_WINDOW_DAYS = 60;
const BUSINESS_TZ = "America/New_York";

// "YYYY-MM-DD" for today in New Jersey (not UTC, which flips to
// tomorrow at 8pm Eastern).
function todayLocal() {
  return new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });
}

function dow(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Chef dates from today through the booking window, oldest first. */
function upcomingDates(menu) {
  const from = todayLocal();
  const to = addDays(from, BOOKING_WINDOW_DAYS);
  return (menu.availability?.dates || [])
    .map(normalizeDateEntry)
    .filter((d) => d.date >= from && d.date <= to && (offersCatering(d) || offersLiveDose(d)))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function findDateEntry(menu, dateStr) {
  const raw = (menu.availability?.dates || []).find((d) => d.date === dateStr);
  const pre = preorders.openEntry(menu, dateStr);
  if (!raw) return pre ? preorderDateEntry(pre) : null;
  const entry = normalizeDateEntry(raw);
  return pre ? { ...entry, preorder: pre } : entry;
}

/** A pre-order pickup day in the same shape as a chef date. */
function preorderDateEntry(e) {
  return { date: e.date, pickupAM: false, pickupPM: false, catering: [], liveDose: [], preorder: e };
}

function windowLabel(w) {
  return `${formatTimeLabel(w.start)}-${formatTimeLabel(w.end)}`.replace(/:00 /g, " ");
}

function shortTime(t) {
  return formatTimeLabel(t).replace(":00 ", " ");
}

/**
 * Shown when a customer taps "Place an order", before any items, so they
 * know which weekends (and which order type) are open first.
 */
function availabilitySummary(menu) {
  const dates = upcomingDates(menu);
  if (dates.length === 0) return null;
  const pt = pickupTimes(menu);
  const lines = dates.map((d) => {
    const parts = [];
    const pickups = [];
    if (d.pickupAM) pickups.push(shortTime(pt.am));
    if (d.pickupPM) pickups.push(shortTime(pt.pm));
    if (pickups.length) parts.push(`Catering pickup ${pickups.join(" or ")}`);
    if (d.catering.length) parts.push(`Catering delivery ${d.catering.map(windowLabel).join(", ")}`);
    if (d.liveDose.length) parts.push(`LIVE Dose Station ${d.liveDose.map(windowLabel).join(", ")}`);
    return `- ${formatDateLabel(d.date)}: ${parts.join(" | ")}`;
  });
  return [
    `Chef availability (next ${BOOKING_WINDOW_DAYS} days):`,
    ...lines,
    "",
    `Catering and the LIVE Dose Station are booked as separate orders. Delivery has a fee based on distance. ${paymentSentence(menu)}`
  ].join("\n");
}

/**
 * Every bookable time on one date for this cart, as list rows:
 * - LIVE Dose Station: appointment slots inside each LDS window (length =
 *   setup + serving + close-out for the plates ordered).
 * - Catering pickup: "Pickup by 11:30 AM" / "Pickup by 6:00 PM" if the
 *   chef opened that pickup on this date.
 * - Catering delivery: fixed-length slots inside each delivery window.
 */
function timeOptionsFor(menu, d, cart, fulfillment) {
  const { hasLiveDose, hasPreorder } = cartOrderTypes(cart);
  if (hasPreorder) {
    const e = d.preorder || preorders.openEntry(menu, d.date);
    return e
      ? [{ id: "slot:preorder", title: `Pickup at ${formatTimeLabel(e.pickupTime)}`, description: `Order by ${e.orderByLabel}` }]
      : [];
  }
  if (hasLiveDose) {
    // Standard on-site sessions (customerView has already mapped the day's
    // LIVE Dose windows onto them).
    return d.liveDose.map((w) => ({
      id: `slot:${w.start}-${w.end}`,
      title: `${formatTimeLabel(w.start)} - ${formatTimeLabel(w.end)}`,
      description: `${w.label || "LIVE Dose"} session - on-site serving time`
    }));
  }
  if (fulfillment === "pickup") {
    const pt = pickupTimes(menu);
    const out = [];
    if (d.pickupAM) out.push({ id: "slot:pickup-am", title: `Pickup by ${formatTimeLabel(pt.am)}`, description: "Lunch order" });
    if (d.pickupPM) out.push({ id: "slot:pickup-pm", title: `Pickup by ${formatTimeLabel(pt.pm)}`, description: "Dinner order" });
    return out;
  }
  const len = menu.availability?.slotLengthMinutes || 120;
  return d.catering.flatMap((w) =>
    generateSlots(w, len).map((s) => ({ id: `slot:${s.start}-${s.end}`, title: s.label }))
  );
}

function getAvailableDatesForCart(menu, cart, fulfillment, onlyDate) {
  if (cartOrderTypes(cart).hasPreorder) {
    return preorders
      .open(menu)
      .filter((e) => !onlyDate || e.date === onlyDate)
      .map((e) => preorderDateEntry(e));
  }
  return upcomingDates(menu)
    .filter((d) => !onlyDate || d.date === onlyDate)
    .filter((d) => timeOptionsFor(menu, d, cart, fulfillment).length > 0);
}

/** Which catering fulfillment types are open (on the chosen date, if any). */
function cateringFulfillmentOptions(menu, cart, onlyDate) {
  return {
    pickup: getAvailableDatesForCart(menu, cart, "pickup", onlyDate).length > 0,
    delivery: getAvailableDatesForCart(menu, cart, "delivery", onlyDate).length > 0
  };
}

/** Maps sendDatePrompt's result to the next conversation step. */
function dateStep(result) {
  if (result === "slot") return "AWAITING_SLOT";
  return result ? "AWAITING_DATE" : "AWAITING_DATE_NONE";
}

function lineLabel(l) {
  if (l.isLiveDoseStation) {
    const parts = [];
    if (l.mdQty) parts.push(`${l.mdQty}x Mysore Masale Dose`);
    if (l.odQty) parts.push(`${l.odQty}x Onion Dose`);
    const note = l.note ? ` (${l.note})` : "";
    const travel = l.travelFee
      ? ` (+$${l.travelFee.toFixed(2)} travel, ~${l.travelMiles} mi)`
      : "";
    const ext = l.extensionFee ? ` (+$${Number(l.extensionFee).toFixed(2)} for ${l.extensionMinutes} extra min)` : "";
    return `- LIVE Dose Station: ${parts.join(" + ")}${note} (+$${l.setupFee.toFixed(
      2
    )} setup)${travel}${ext} ($${l.price.toFixed(2)})`;
  }
  const note = l.note ? ` (${l.note})` : "";
  return `- ${fmtQty(l.qty)}x ${l.title}${Number.isInteger(Number(l.qty)) ? "" : " (half tray)"}${note} ($${(l.qty * l.price).toFixed(2)})`;
}

/**
 * The first thing anyone reaching the number sees. Four options need a
 * list message rather than reply buttons, since WhatsApp caps buttons
 * at three.
 */
async function sendWelcome(to, greet = true) {
  const menu = botMenu();
  let hello = "";
  if (greet) {
    const profile = customerStore.get(to);
    hello = profile?.firstName
      ? `🙏 Namaste, ${profile.firstName}! Welcome back to ${menu.settings.businessName}.\n\n`
      : `🙏 Namaste, welcome to ${menu.settings.businessName}!\n\n`;
    // First time on WhatsApp but Chef already loaded their earlier orders.
    if (profile && !profile.botSeenAt) {
      const past = require("./orderDb").all().filter((o) => o.customerPhone === to && o.source === "past");
      if (past.length) {
        const latest = past.slice().sort((a, b) => String(b.eventDate || "").localeCompare(String(a.eventDate || "")))[0];
        hello += `We have ${past.length === 1 ? "your past order" : `your ${past.length} past orders`} with us on file` +
          (latest.eventDate ? ` (most recent: ${formatDateLabel(latest.eventDate)}${latest.eventDate.slice(0, 4) !== todayLocal().slice(0, 4) ? " " + latest.eventDate.slice(0, 4) : ""})` : "") +
          `. Tap "My orders" to see ${past.length === 1 ? "it" : "them"}.\n\n`;
      }
      customerStore.save(to, { botSeenAt: new Date().toISOString() });
    }
  }
  await sendList(to, {
    header: shortName(menu),
    body:
      hello +
      (menu.settings.tagline ? `${menu.settings.tagline}\n\nHow can we help you today?` : "How can we help you today?"),
    buttonLabel: "Choose an option",
    sections: [
      {
        title: "Options",
        rows: [
          { id: "hub:order", title: "Place an order", description: "Start a catering or LIVE Dose Station order" },
          ...(preorders.open(menu).length && menu.categories.some((c) => c.type === "preorder" && (c.items || []).length)
            ? [{ id: "hub:preorder", title: "Dose-in-a-Box", description: (preorderShort(menu) || "Take-home Masala Dose kit - pre-order").slice(0, 72) }]
            : []),
          { id: "hub:browse", title: "See our menu", description: "Browse dishes and prices without ordering" },
          { id: "hub:myorders", title: "My orders", description: "See your orders, or cancel one before it's paid" },
          { id: "hub:custom", title: "Custom request", description: "Tell the chef what you need and get a price quote" },
          { id: "hub:question", title: "Ask a question", description: "Send us a message and we'll get back to you" },
          { id: "hub:feedback", title: "Comments & ideas", description: "Tell us how we did or what you'd like to see" },
          { id: "hub:call", title: "Call us", description: "Get our phone number" }
        ]
      }
    ]
  });
  sessionStore.set(to, {
    ...sessionStore.getOrCreate(to),
    step: "AWAITING_HUB_CHOICE"
  });
}

/**
 * A read-only menu overview for people just browsing. Sent as plain text
 * (not an interactive list) so it isn't capped at 10 rows and doesn't
 * imply they're mid-order.
 */
async function sendMenuOverview(to) {
  const menu = botMenu();
  // One picture per menu category, LIVE Dose Station (the flagship) first.
  // Sent one at a time with a short gap so they arrive in this order.
  const base = (process.env.PUBLIC_BASE_URL || "https://bot.franklintiffinroom.com").replace(/\/$/, "");
  const cats = menuImage.orderedCategories(menu);
  let sentAll = cats.length > 0;
  for (const cat of cats) {
    const version = await menuImage.currentVersion(menu, cat.id);
    if (!version) { sentAll = false; break; }
    try {
      await sendImage(to, `${base}/menu.png?cat=${encodeURIComponent(cat.id)}&v=${version}`, cat.title);
    } catch (err) {
      console.error("Menu picture not sent:", err.message);
      sentAll = false;
      break;
    }
    await pause(2500);
  }
  if (!sentAll) await sendMenuText(to, menu);
  await sendButtons(to, {
    body: "Ready to order, or anything else?",
    buttons: [
      { id: "hub:order", title: "Place an order" },
      { id: "hub:back", title: "Back to menu" }
    ]
  });
}

function pause(ms) {
  return process.env.NODE_ENV === "test" ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
}

/** Text version of the menu (used if the picture can't be sent). */
async function sendMenuText(to, menu) {
  const ordered = menu.categories
    .slice()
    .sort((a, b) => (a.type === "live-dose-station" ? 0 : 1) - (b.type === "live-dose-station" ? 0 : 1));
  for (const category of ordered) {
    if (category.type === "live-dose-station") {
      const lds = category.liveDoseStation;
      await sendText(
        to,
        `*${category.title}*\n${lds.mdTitle} and ${lds.odTitle}, cooked fresh on-site.\n` +
          `$${lds.pricePerHundred} per ${100} plates, plus a $${lds.setupFee} setup fee.\n` +
          `${lds.minTotal}-${lds.maxTotal} plates total (in ${lds.increment}s), split between the two dishes however you like.`
      );
      await pause(800);
      continue;
    }
    if (!category.items.length) continue;
    const lines = category.items
      .map((i) => {
        const serves = servingsLabel(i);
        const size = i.size ? `${i.size}${serves ? ", " : ""}` : "";
        return `• ${i.title} - $${i.price.toFixed(2)}${size || serves ? ` (${size}${serves})` : ""}`;
      })
      .join("\n");
    await sendText(to, `*${category.title}*\n${lines}`);
    await pause(800);
  }
}

/**
 * Catering and the LIVE Dose Station share the same crew, so one order can
 * hold one or the other, never both. Once the cart has catering items, the
 * LIVE Dose Station category is hidden from the menu (and vice versa - an
 * LDS order goes straight to checkout, see proceedToCheckout).
 */
const MIXED_ORDER_MESSAGE =
  "Catering and the LIVE Dose Station are booked as separate orders - they use the same crew, so we can't do both for one event. Let's finish this order first; you can start a new one afterwards by sending \"hi\".";

function categoriesAllowedForCart(menu, cart, onlyDate) {
  const { hasCatering, hasLiveDose, hasPreorder } = cartOrderTypes(cart || []);
  const dates = upcomingDates(menu).filter((d) => !onlyDate || d.date === onlyDate);
  const cateringOpen = dates.some(offersCatering);
  const liveDoseOpen = dates.some(offersLiveDose);
  const preorderOpen = preorders.open(menu).some((e) => !onlyDate || e.date === onlyDate);
  return menu.categories.filter((c) => {
    // Pre-order sections: their own order (pickup on Chef's pre-order days).
    if (c.type === "preorder") return preorderOpen && !hasCatering && !hasLiveDose && (c.items || []).length > 0;
    if (hasPreorder) return false;
    const isLds = c.type === "live-dose-station";
    // Hide an order type the chef has no open dates for.
    if (isLds && !liveDoseOpen) return false;
    if (!isLds && !cateringOpen) return false;
    if (hasCatering && isLds) return false;
    if (hasLiveDose) return false;
    return true;
  }).sort((a, b) => (a.type === "live-dose-station" ? 0 : 1) - (b.type === "live-dose-station" ? 0 : 1)); // flagship first
}

const NO_DATES_MESSAGE = (menu) =>
  `The chef doesn't have any dates open in the next ${BOOKING_WINDOW_DAYS} days. Please check back soon, or call us at ${menu.settings.phoneDisplay} to ask about your event.`;

async function sendMainMenu(to, greet = true, intro = "") {
  const menu = botMenu();
  const sess = sessionStore.getOrCreate(to);
  const cart = sess.cart || [];
  // No greeting here - customers only see the full business name once,
  // in the welcome message.
  const allowed = categoriesAllowedForCart(menu, cart, sess.eventDate);
  if (allowed.length === 0 && cart.length === 0) {
    // No chef dates open at all - nothing can be ordered.
    await sendText(to, NO_DATES_MESSAGE(menu));
    sessionStore.clear(to);
    return sendWelcome(to, false);
  }
  if (allowed.length === 0) {
    // Only reachable with a LIVE Dose Station already in the cart - nothing
    // else can be added, so send them back toward checkout.
    await sendText(to, MIXED_ORDER_MESSAGE);
    sessionStore.set(to, {
      ...sessionStore.getOrCreate(to),
      step: "AWAITING_ADD_MORE"
    });
    return sendButtons(to, {
      body: "Ready to continue?",
      buttons: [{ id: "addmore:no", title: "Continue to checkout" }]
    });
  }
  const sections = allowed.map((c) => ({
    title: c.title.slice(0, 24),
    rows: [
      {
        id: `cat:${c.id}`,
        title: (c.rowTitle || c.title || "").slice(0, 24),
        description: (c.type === "preorder" ? preorderShort(menu) || c.rowDescription || "" : c.rowDescription || "").slice(0, 72)
      }
    ]
  }));
  await sendList(to, {
    header: shortName(menu),
    body: (intro ? `${intro}\n\n` : "") + "What would you like to order?",
    buttonLabel: "View Menu",
    sections
  });
  sessionStore.set(to, {
    ...sessionStore.getOrCreate(to),
    step: "AWAITING_CATEGORY"
  });
}

const MAX_ROWS_PER_LIST = 10;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * WhatsApp list messages cap out at 10 rows total. Categories with more
 * items than that (e.g. a big catering menu) get split across multiple
 * sequential list messages instead of one - each is independently valid,
 * so the customer can tap an item from whichever message they're looking
 * at.
 */
async function sendCategoryItems(to, category, intro = "", page = 0) {
  const rowFor = (i) => {
    const size = i.size ? `${i.size} - ` : "";
    const serves = servingsLabel(i);
    // Chef's picks and limited dishes say so first, so it isn't cut off.
    const { promoActive } = require("./menuStore");
    const tag = [promoActive(i) ? "⭐ Chef's pick" : "", i.limited ? "Limited" : ""].filter(Boolean).join(" · ");
    return {
      id: `item:${i.id}`,
      title: i.title.slice(0, 24),
      description: `${tag ? tag + " - " : ""}$${i.price.toFixed(2)} - ${size}${serves}`.slice(0, 72)
    };
  };
  // One list at a time (WhatsApp lists hold 10 rows): 9 dishes plus a
  // "More dishes" row that opens the next page only if they want it.
  const items = category.items || [];
  const per = items.length > MAX_ROWS_PER_LIST ? MAX_ROWS_PER_LIST - 1 : MAX_ROWS_PER_LIST;
  const pages = Math.max(1, Math.ceil(items.length / per));
  const p = Math.min(Math.max(0, page), pages - 1);
  const rows = items.slice(p * per, p * per + per).map(rowFor);
  if (pages > 1) {
    const next = (p + 1) % pages;
    rows.push({
      id: `more:${category.id}:${next}`,
      title: next === 0 ? "Back to first dishes" : "More dishes",
      description: next === 0 ? "Show the first page again" : `See dishes ${next * per + 1}-${Math.min(items.length, (next + 1) * per)}`
    });
  }
  await sendList(to, {
    header: `${category.title}${pages > 1 ? ` (${p + 1}/${pages})` : ""}`,
    body: (intro ? `${intro}\n\n` : "") + (p === 0 ? "Pick an item to add to your order:" : "More dishes - pick one to add:"),
    buttonLabel: "View Items",
    sections: [{ title: category.title.slice(0, 24), rows }]
  });
}

/** Put a dish in the cart and show the order so far. */
async function addLineToCart(from, session, menu, item, qty, note) {
  const line = { ...item, qty, note };
  if (!Number.isInteger(qty)) {
    // Half trays aren't half price: keep qty x price = the real total.
    const total = trayTotal(menu, item.price, qty);
    line.fullTrayPrice = item.price;
    line.price = total / qty;
  }
  const cart = [...session.cart, line];
  sessionStore.set(from, {
    ...session,
    cart,
    pendingItem: null,
    pendingQty: null,
    step: "AWAITING_ADD_MORE"
  });
  return sendAddMorePrompt(from, cart, line);
}

/** Half-tray orders switched on in admin Setup? */
function halfTraysOn(menu) {
  return !!(menu.settings && menu.settings.halfTrays);
}

/** Smallest amount a customer can order of this dish right now. */
function effectiveMinQty(menu, item) {
  if (item && item.isPreorder) return item.minQty || 1;
  return halfTraysOn(menu) ? 0.5 : item.minQty || 1;
}

/** Order minimum ($) that applies right now. */
function orderMinimum(menu) {
  const st = menu.settings || {};
  return halfTraysOn(menu) ? Number(st.minOrderHalfTray) || 0 : Number(st.minOrderSubtotal) || 0;
}

/** Half tray price as a share of a full tray (admin Setup; default 65%). */
function halfShare(menu) {
  const pct = Number(menu.settings && menu.settings.halfTrayPercent);
  return (pct > 0 && pct <= 100 ? pct : 65) / 100;
}

/** Price of `qty` trays: whole trays at full price, a half tray at the half-tray share. */
function trayTotal(menu, unitPrice, qty) {
  const whole = Math.floor(qty);
  const half = qty - whole > 0 ? unitPrice * halfShare(menu) : 0;
  return Math.round((whole * unitPrice + half) * 100) / 100;
}

/** 0.5 -> "½", 1.5 -> "1½", 2 -> "2" */
function fmtQty(q) {
  const n = Number(q);
  if (Number.isInteger(n)) return String(n);
  const whole = Math.floor(n);
  return (whole ? String(whole) : "") + "½";
}

/** "½", "1/2", "half", "0.5", ".5", "1.5", "1 1/2", "2" -> number (or null). */
function parseQty(text) {
  const t = String(text || "").toLowerCase().trim().replace(/\s*(trays?|x)$/, "").trim();
  if (/^(half|½|1\/2|0?\.5|half tray)$/.test(t)) return 0.5;
  let m;
  if ((m = /^(\d+)\s*(?:½|1\/2|\.5| and a half)$/.exec(t))) return Number(m[1]) + 0.5;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return null;
}

function effectiveMaxQty(menu, item) {
  if (item && item.isPreorder) return item.maxQty || 20;
  return item.maxQty || menu.settings.maxOrderQtyPerItem || 4;
}

/**
 * The LIVE Dose Station is a special case: Mysore Masale Dose (MD) and
 * Onion Dose (OD) share one combined pool (100-200 plates total, in 50s)
 * rather than being independent items, plus a flat setup fee. That
 * doesn't fit the generic single-item + quantity model, so it gets its
 * own mini-flow instead of a normal item list.
 */
/** "$10 per dose, in 10s" - extra doses on site, at the same per-plate rate. */
function extraDoseText(lds) {
  const per = Number(lds.pricePerHundred || 0) / 100;
  const inc = Number(lds.extraDoseIncrement) > 0 ? Number(lds.extraDoseIncrement) : 10;
  return `Extra doses on site (while supplies last): $${per % 1 ? per.toFixed(2) : per} per dose, in ${inc}s.`;
}

function ldsTimesText(menu) {
  const s = require("./availability").ldsSessions(menu);
  const ext = ldsExtension(menu);
  return (
    `On-site serving times: ${s.map((w) => `${formatTimeLabel(w.start)} - ${formatTimeLabel(w.end)} (${w.label.toLowerCase()})`).join(" or ")}. ` +
    `Extra ${ext.minutes} minutes: $${ext.fee}.`
  );
}

async function sendLiveDoseTotalPrompt(to, category) {
  const lds = category.liveDoseStation;
  const options = [];
  for (let n = lds.minTotal; n <= lds.maxTotal; n += lds.increment) {
    options.push(n);
  }
  const rows = options.map((n) => ({
    id: `ldstotal:${n}`,
    title: `${n} plates`,
    description: `$${((n * lds.pricePerHundred) / 100 + lds.setupFee).toFixed(
      2
    )} total (incl. $${lds.setupFee} setup fee)`
  }));
  await sendList(to, {
    header: category.title,
    body:
      `How many plates total would you like from the LIVE Dose Station? This is a combined total across Mysore Masale Dose and Onion Dose (${lds.minTotal}-${lds.maxTotal}, in ${lds.increment}s). A $${lds.setupFee} setup fee applies once per order.\n\n` +
      `${ldsTimesText(botMenu())}\n${extraDoseText(lds)}`,
    buttonLabel: "Choose total",
    sections: [{ title: "Combined total", rows }]
  });
}

async function sendLiveDoseSplitPrompt(to, category, total) {
  const lds = category.liveDoseStation;
  const options = [];
  for (let md = 0; md <= total; md += lds.increment) options.push(md);
  const rows = options.map((md) => {
    const od = total - md;
    const parts = [];
    if (md) parts.push(`${md} MD`);
    if (od) parts.push(`${od} OD`);
    if (parts.length === 0) parts.push("0 plates");
    return {
      id: `ldssplit:${md}`,
      title: parts.join(" / ").slice(0, 24),
      description: `${md} Mysore Masale Dose, ${od} Onion Dose`
    };
  });
  await sendList(to, {
    header: `${total} plates total`,
    body: `How many of the ${total} should be Mysore Masale Dose (MD)? The rest will be Onion Dose (OD) - same live station either way.`,
    buttonLabel: "Choose split",
    sections: [{ title: "MD / OD split", rows }]
  });
}

async function sendLiveDoseNotePrompt(to) {
  await sendText(
    to,
    `Any notes for the LIVE Dose Station (spice level, timing, etc.)? Type your note, or "skip".`
  );
}

async function sendQtyPrompt(to, item, menu) {
  const min = effectiveMinQty(menu, item);
  let max = effectiveMaxQty(menu, item);
  if (item.isPreorder) {
    // Where this dish stands for the next pickup day (kitchen minimum / most).
    const day = preorders.open(menu)[0];
    const st = day && preorders.dayStatus(menu, day.date).find((x) => x.itemId === item.id);
    if (st && st.max != null && st.left === 0) {
      return sendText(to, `Sorry - ${item.title} is sold out for pickup ${day.pickupLabel}. Type "menu" to see what else is available.`);
    }
    if (st && st.max != null) max = Math.min(max, st.left);
    const lines = day ? preorders.statusLines(menu, day.date).filter((l) => l.startsWith(item.title + ":")) : [];
    const options = [min, min + 1, min + 2].filter((n) => n <= max);
    if (options.length === 0) options.push(min);
    return sendButtons(to, {
      body: (`How many "${item.title}" would you like? ($${Number(item.price).toFixed(2)} each)` + (lines.length ? `\n\nPickup ${day.pickupLabel}:\n${lines.join("\n")}` : "")).slice(0, 1024),
      buttons: options.map((n) => ({ id: `qty:${n}`, title: String(n) })),
      footer: `Type a number for a different amount (up to ${max}), or "describe" for details.`
    });
  }
  if (halfTraysOn(menu) && !item.isPreorder) {
    const options = [0.5, 1, 2].filter((n) => n <= max);
    await sendButtons(to, {
      body: `How many trays of "${item.title}" would you like?\n\nFull tray: $${item.price.toFixed(2)}\nHalf tray: $${trayTotal(menu, item.price, 0.5).toFixed(2)}`,
      buttons: options.map((n) => ({ id: `qty:${n}`, title: n === 0.5 ? "½ tray" : `${n} tray${n > 1 ? "s" : ""}` })),
      footer: `Type another amount like 1.5 (up to ${max}), or "describe" for details.`
    });
    return;
  }
  const options = [min, min + 1, min + 2].filter((n) => n <= max);
  if (options.length === 0) options.push(min);
  await sendButtons(to, {
    body: `How many "${item.title}" would you like?${
      min > 1 ? ` (minimum ${min})` : ""
    }`,
    buttons: options.map((n) => ({ id: `qty:${n}`, title: String(n) })),
    footer: `Type a number for a different amount (up to ${max}), or "describe" for details.`
  });
}

/**
 * Every item gets a chance for the customer to add a free-text note
 * (customization, spice level, whatever). Items flagged `requiresNote`
 * (e.g. Palya, where price depends on which vegetable) can't be skipped.
 */
async function sendItemNotePrompt(to, item) {
  if (item.requiresNote) {
    await sendText(
      to,
      item.notePrompt || `Please tell us your preference for "${item.title}".`
    );
    return;
  }
  await sendText(
    to,
    `Any customization notes for "${item.title}"? Type your note, or "skip".`
  );
}

async function sendAddMorePrompt(to, cart = null, added = null) {
  cart = cart || (sessionStore.get(to) || {}).cart || [];
  const parts = [];
  if (added) parts.push(`Added: ${lineLabel(added).replace(/^- /, "")}`);
  if (cart.length) {
    let lines = cart.map(lineLabel);
    // Keep the message inside WhatsApp's size limit for very long orders.
    while (lines.join("\n").length > 700 && lines.length > 1) lines = lines.slice(1);
    const hidden = cart.length - lines.length;
    parts.push(
      `Your order so far:\n${hidden ? `(+${hidden} more)\n` : ""}${lines.join("\n")}\nSubtotal: $${cartSubtotal(cart).toFixed(2)}`
    );
  }
  parts.push("Add another item, or move on to checkout?");
  await sendButtons(to, {
    body: parts.join("\n\n"),
    buttons: [
      { id: "addmore:yes", title: "Add another" },
      { id: "addmore:no", title: "Checkout" }
    ]
  });
}

const DELIVERY_ADDRESS_PROMPT =
  "What's the delivery address? (Street, town, ZIP)\n\nA delivery fee based on distance will be added when the chef confirms your order. Delivery is subject to availability.";

/**
 * Catering only: offer pickup and/or delivery, whichever the chef has open
 * dates for. If only one is open, skip the question and go straight on.
 */
async function askFulfillment(from, session, menu) {
  const opts = cateringFulfillmentOptions(menu, session.cart, session.eventDate);
  const want = session.prefer && session.prefer.kind;
  if (want === "pickup" && opts.pickup) {
    const updated = { ...session, fulfillment: "pickup" };
    const hasDates = await sendDatePrompt(from, menu, updated);
    sessionStore.set(from, { ...updated, step: dateStep(hasDates) });
    return;
  }
  if (want === "delivery" && opts.delivery) {
    return askAddress(from, { ...session, fulfillment: "delivery" }, DELIVERY_ADDRESS_PROMPT);
  }
  if (opts.pickup && opts.delivery) {
    sessionStore.set(from, { ...session, step: "AWAITING_FULFILLMENT" });
    return sendButtons(from, {
      body: "Would you like to pick up or have it delivered?\n\nDelivery has a fee based on distance, added when the chef confirms.",
      buttons: [
        { id: "fulfillment:pickup", title: "Pickup" },
        { id: "fulfillment:delivery", title: "Delivery" }
      ]
    });
  }
  if (opts.pickup) {
    const updated = { ...session, fulfillment: "pickup" };
    if (!session.pickupAgreed) await sendText(from, "Catering is pickup-only for the dates currently open.");
    const hasDates = await sendDatePrompt(from, menu, updated);
    sessionStore.set(from, { ...updated, step: dateStep(hasDates) });
    return;
  }
  if (opts.delivery) {
    await sendText(from, "Catering is delivery-only for the dates currently open.");
    return askAddress(from, { ...session, fulfillment: "delivery" }, DELIVERY_ADDRESS_PROMPT);
  }
  const updated = { ...session, fulfillment: "pickup" };
  await sendDatePrompt(from, menu, updated); // sends the "no dates open" message
  sessionStore.set(from, { ...updated, step: "AWAITING_DATE_NONE" });
}

/**
 * We only take orders on select weekends the owner has opened up, and
 * catering vs the Live Dose Station can have different windows on the
 * same date (e.g. tray pickup all afternoon, but the live station only
 * running for a couple hours). Returns true if at least one date was
 * offered, false if none fit this cart right now.
 */
async function sendDatePrompt(to, menu, session) {
  const { cart, fulfillment } = session;
  if (session.eventDate) {
    // Date was chosen before the menu - go straight to that day's times.
    const entry = findDateEntry(menu, session.eventDate);
    if (entry && timeOptionsFor(menu, entry, cart, fulfillment).length) {
      sessionStore.set(to, { ...sessionStore.getOrCreate(to), selectedDate: session.eventDate });
      await sendSlotPrompt(to, menu, entry, session);
      return "slot";
    }
    await sendText(
      to,
      `Sorry - that option isn't available on ${formatDateLabel(session.eventDate)} anymore. Please call us at ${menu.settings.phoneDisplay}, or type "menu" to start again.`
    );
    await sendButtons(to, {
      body: "What would you like to do?",
      buttons: [{ id: "nodates:cancel", title: "Cancel order" }]
    });
    return false;
  }
  const dates = getAvailableDatesForCart(menu, cart, fulfillment);

  if (dates.length === 0) {
    await sendText(
      to,
      `We don't have any weekend dates open right now for this order - please check back soon, or call us at ${menu.settings.phoneDisplay}.`
    );
    await sendButtons(to, {
      body: "What would you like to do?",
      buttons: [{ id: "nodates:cancel", title: "Cancel order" }]
    });
    return false;
  }

  const rows = dates.slice(0, 10).map((d) => {
    const opts = timeOptionsFor(menu, d, cart, fulfillment);
    const desc = cartOrderTypes(cart).hasPreorder
      ? `${opts.map((o) => o.title).join(" or ")} - ${opts[0] ? opts[0].description : ""}`
      : fulfillment === "pickup" && !cartOrderTypes(cart).hasLiveDose
        ? opts.map((o) => o.title.replace("Pickup by ", "")).join(" or ")
        : (cartOrderTypes(cart).hasLiveDose ? d.liveDose : d.catering).map(windowLabel).join(", ");
    return {
      id: `date:${d.date}`,
      title: formatDateLabel(d.date).slice(0, 24),
      description: desc.slice(0, 72)
    };
  });

  const what =
    cartOrderTypes(cart).hasLiveDose ? "the LIVE Dose Station" : fulfillment === "pickup" ? "pickup" : "delivery";
  await sendList(to, {
    header: "Choose a date",
    body: `Here are the upcoming dates open for ${what}:`,
    buttonLabel: "Choose date",
    sections: [{ title: "Available dates", rows }]
  });
  return true;
}

/**
 * Once a date is picked, offer the actual bookable times for this order
 * type, so the customer can only pick something the chef has opened.
 */
async function sendSlotPrompt(to, menu, dateEntry, session) {
  const options = timeOptionsFor(menu, dateEntry, session.cart, session.fulfillment);

  if (options.length === 0) {
    // Guard in case the chef changed availability mid-conversation.
    await sendText(
      to,
      `That date no longer has an open time for this order - please pick a different date.`
    );
    return false;
  }

  const isPickup = session.fulfillment === "pickup" && !cartOrderTypes(session.cart).hasLiveDose;
  const isLds = cartOrderTypes(session.cart).hasLiveDose;

  // They typed a time earlier ("11/7 pickup at 11:30 AM") - offer that one.
  const p = session.prefer;
  let wanted = null;
  if (p && (!p.kind || p.kind === (isLds ? "lds" : session.fulfillment))) {
    if (p.slotId) wanted = options.find((o) => o.id === p.slotId);
    else if (p.time) {
      const t = minutesOf(p.time);
      wanted = options.find((o) => {
        const m = /^slot:(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(o.id);
        return m && t >= minutesOf(m[1]) && t < minutesOf(m[2]);
      });
    }
  }
  if (wanted) {
    return sendButtons(to, {
      header: formatDateLabel(dateEntry.date),
      body: `You asked for ${wanted.title.replace(/^Pickup by/, "pickup by")}${wanted.description ? ` (${wanted.description.toLowerCase()})` : ""} on ${formatDateLabel(dateEntry.date)}. Book this time?`,
      buttons: [
        { id: wanted.id, title: "Yes, book it" },
        { id: "slotlist", title: "Other times" }
      ]
    }).then(() => true);
  }

  const rows = options.slice(0, 10).map((o) => ({
    id: o.id,
    title: o.title.slice(0, 24),
    ...(o.description ? { description: o.description.slice(0, 72) } : {})
  }));

  await sendList(to, {
    header: formatDateLabel(dateEntry.date),
    body: isPickup
      ? "When would you like to pick up? The chef cooks fresh that day for your pickup time."
      : "What time works for you?",
    buttonLabel: "Choose time",
    sections: [{ title: isPickup ? "Pickup times" : "Available times", rows }]
  });
  return true;
}

async function sendOrderSummary(to, session) {
  const lines = session.cart.map(lineLabel).join("\n");
  const subtotal = cartSubtotal(session.cart);
  const isCateringDelivery =
    session.fulfillment === "delivery" && !cartOrderTypes(session.cart).hasLiveDose;
  const isLds = cartOrderTypes(session.cart).hasLiveDose;
  const fulfillmentLine = isLds
    ? `Event location: ${session.address}`
    : session.fulfillment === "delivery"
    ? `Delivery to: ${session.address}`
    : "Pickup";
  const balanceWhen = isLds ? "on the day of your event" : session.fulfillment === "pickup" ? "at pickup" : "at delivery";
  const feeLine = isCateringDelivery
    ? "\nDelivery fee: based on distance - the chef will add it when confirming"
    : "";
  const summary = `Here's your order:\n\n${lines}\n\nSubtotal: $${subtotal.toFixed(
    2
  )}${feeLine}\n${fulfillmentLine}\nRequested time: ${session.requestedTime}\nPayment: ${
    payments.enabled()
      ? `${payments.settings().depositPercent}% Zelle deposit after Chef approves, balance ${balanceWhen}`
      : `collected ${balanceWhen}`
  }${session.orderNote ? `\nYour note: ${session.orderNote}` : ""}${preorderStatusBlock(session)}\n\nShall I send this in for approval?`;
  await sendButtons(to, {
    body: summary.slice(0, 1024),
    buttons: [
      { id: "confirm:yes", title: "Submit order" },
      { id: "confirm:note", title: session.orderNote ? "Change note" : "Add a note" },
      { id: "confirm:no", title: "Cancel" }
    ]
  });
}

/**
 * Customer tapped "Submit order". Nothing is confirmed yet - this logs the
 * order as Pending, tells the customer it's under review, and asks the
 * owner to Approve / Edit price / Decline. Actual confirmation only
 * happens once the owner responds (see handleOwnerReply).
 */
async function requestApproval(to, session) {
  const id = orderId();
  const subtotal = cartSubtotal(session.cart);
  const order = {
    orderId: id,
    customerPhone: to,
    customerName: nameFor(to),
    cart: session.cart,
    subtotal,
    fulfillment: session.fulfillment,
    address: session.address,
    addressVerified: !!session.addressVerified,
    distanceMiles: session.distanceMiles ?? null,
    requestedTime: session.requestedTime,
    eventDate: session.selectedDate || null,
    orderNote: session.orderNote || null
  };

  pendingOrderStore.create(id, order);

  try {
    await appendOrder({ ...order, status: "Pending Approval" });
  } catch (err) {
    console.error(`Failed to log order ${id} to Google Sheet:`, err.message);
  }

  const payNote = payments.enabled()
    ? `Once Chef approves, you'll get Zelle details for the ${payments.settings().depositPercent}% deposit.`
    : `Payment will be collected at ${session.fulfillment}.`;
  await sendText(
    to,
    `Thanks! Your order ${id} ($${subtotal.toFixed(2)}) is being reviewed - we'll confirm shortly. ${payNote}\n\nNeed to cancel? Just send "cancel".`
  );

  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER;
  const ownerOptedIn = process.env.OWNER_HAS_OPTED_IN === "true";
  if (!ownerNumber || !ownerOptedIn) {
    console.warn(
      `Order ${id} needs manual approval - OWNER_WHATSAPP_NUMBER isn't set or hasn't opted in, so no WhatsApp prompt was sent. Check the Google Sheet.`
    );
    return;
  }

  await sendApprovalPrompt(ownerNumber, id, order);
}

async function sendApprovalPrompt(ownerNumber, id, order) {
  const itemsSummary = order.cart.map(lineLabel).join("\n");
  const needsFee =
    order.fulfillment === "delivery" && !order.cart.some((l) => l.isLiveDoseStation);
  const fulfillmentLine =
    order.fulfillment === "delivery"
      ? `Deliver to: ${order.address}${addressNote(order)}${needsFee ? "\n(Add delivery fee via Edit price)" : ""}${
          order.cart.some((l) => l.isLiveDoseStation && l.travelFeeUnknown)
            ? "\n(Travel fee NOT calculated - address unverified. Add it via Edit price if needed)"
            : ""
        }`
      : "Pickup";

  const rangeLine = order.outOfRange
    ? `\nOUTSIDE RANGE: ~${order.outOfRange.miles} mi (your limit is ${order.outOfRange.max}) - customer asked for an exception`
    : "";
  await sendButtons(ownerNumber, {
    header: order.channel === "app" ? "New app order needs approval" : "New order needs approval",
    body: `Order ${id} from ${order.customerName || "customer"} (${order.customerPhone})${order.channel === "app" ? " via the FTR app" : ""}\n${itemsSummary}\nSubtotal: $${order.subtotal.toFixed(
      2
    )}\n${fulfillmentLine}\nRequested time: ${order.requestedTime}${rangeLine}${order.orderNote ? `\nCustomer note: ${order.orderNote}` : ""}`.slice(0, 1024),
    buttons: [
      { id: `approve:${id}`, title: "Approve" },
      { id: `editprice:${id}`, title: "Edit / message" },
      { id: `decline:${id}`, title: "Decline" }
    ]
  }).catch((err) =>
    console.error(`Failed to send approval prompt for ${id} to owner:`, err.message)
  );
}

// ---------------------------------------------------------------------
// Chef <-> customer chat before approving, relayed through the FTR
// number. Open chats are saved in data/chats.json (survive restarts) and
// every message is kept on the order (order.chat) for the record.
// ---------------------------------------------------------------------
const chatFile = require("./jsonFile");
function openChats() {
  return chatFile.read("chats.json", {}) || {};
}
function chatFor(phone) {
  return openChats()[phone] || null;
}
function setChat(phone, value) {
  const all = openChats();
  if (value) all[phone] = value;
  else delete all[phone];
  chatFile.write("chats.json", all);
}
function logChat(orderId, from, text) {
  const order = require("./orderDb").get(orderId);
  if (!order) return;
  const chat = [...(order.chat || []), { from, text, at: new Date().toISOString() }];
  require("./orderDb").update(orderId, { chat });
}

async function startChat(ownerNumber, id, order) {
  setChat(order.customerPhone, { orderId: id, openedAt: new Date().toISOString() });
  ownerState.set(ownerNumber, { orderId: id, mode: "chat", phone: order.customerPhone });
  return sendText(
    ownerNumber,
    `Chat with ${order.customerName || order.customerPhone} about ${id} is open.\n\n` +
      `Type your message - it goes to them from the FTR number, and their replies come back here. ` +
      `Tap Approve or Decline on the order when you're ready (that ends the chat).`
  );
}

function endChat(ownerNumber, id, phone) {
  const c = phone ? chatFor(phone) : null;
  if (c && c.orderId === id) setChat(phone, null);
  const st = ownerState.get(ownerNumber);
  if (st && st.orderId === id) ownerState.clear(ownerNumber);
}

async function sendChefMessage(ownerNumber, state, order, text) {
  try {
    await sendText(order.customerPhone, `Message from Chef about your order ${state.orderId}:\n\n${text}\n\n(Just reply here to answer Chef.)`);
    logChat(state.orderId, "chef", text);
  } catch (err) {
    return sendText(ownerNumber, `Couldn't deliver that (WhatsApp may block it if they haven't messaged in 24 hours). Try calling ${order.customerPhone}.`);
  }
  if (!state.acked) {
    ownerState.set(ownerNumber, { ...state, acked: true });
    return sendButtons(ownerNumber, {
      body: `Sent to ${order.customerName || order.customerPhone}. Keep typing to send more.`,
      buttons: [
        { id: `approve:${state.orderId}`, title: "Approve" },
        { id: `chatend:${state.orderId}`, title: "End chat" },
        { id: `decline:${state.orderId}`, title: "Decline" }
      ]
    });
  }
}

/** Customer replied while Chef has a chat open with them. Returns true if handled. */
async function relayCustomerMessage(from, isText, text, isReply) {
  if (isReply) return false; // button taps carry on as normal
  const c = chatFor(from);
  if (!c) return false;
  const order = pendingOrderStore.get(c.orderId);
  if (!order) {
    setChat(from, null);
    return false;
  }
  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER;
  if (!isText) {
    await sendText(from, "Please type your message for Chef as text.");
    return true;
  }
  logChat(c.orderId, "customer", text);
  ownerState.set(ownerNumber, { orderId: c.orderId, mode: "chat", phone: from, acked: true });
  await sendButtons(ownerNumber, {
    header: `Reply about ${c.orderId}`.slice(0, 60),
    body: `${order.customerName || from} says:\n\n${text}\n\n(Your next message goes to them.)`.slice(0, 1024),
    buttons: [
      { id: `approve:${c.orderId}`, title: "Approve" },
      { id: `editprice:${c.orderId}`, title: "Edit / message" },
      { id: `decline:${c.orderId}`, title: "Decline" }
    ]
  }).catch((err) => console.error("Couldn't relay customer reply:", err.message));
  return true;
}

async function approveOrder(id, order, ownerNumber) {
  endChat(ownerNumber, id, order.customerPhone);
  pendingOrderStore.remove(id);
  if (payments.enabled()) {
    try {
      const pay = await payments.requestDeposit(
        order,
        `Good news - Chef approved your order ${id}! Total: $${order.subtotal.toFixed(2)}.\nTime: ${order.requestedTime}` + chefTimeNote(order)
      );
      if (ownerNumber && pay) {
        await sendButtons(ownerNumber, {
          body:
            `Order ${id} approved - customer asked for a $${pay.depositDue.toFixed(2)} Zelle deposit, due by ${deadlineLabel(pay.deadline)}.` +
            (pay.late ? ` (Late booking - the usual deadline has passed, so they have ${payments.settings().lateHours} hours.)` : "") +
            ` You'll get their screenshot to confirm.\n\nYou can cancel this order until the deposit is paid.`,
          buttons: [{ id: `ccancel:${id}`, title: "Cancel order" }]
        });
      }
    } catch (err) {
      console.error(`Failed to request deposit for ${id}:`, err.message);
      if (ownerNumber) {
        await sendText(
          ownerNumber,
          `Order ${id} approved, but the deposit request couldn't be sent on WhatsApp (often the 24-hour limit). Please text the customer at ${order.customerPhone}.`
        ).catch(() => {});
      }
    }
    return;
  }
  await updateOrderStatus(id, "Confirmed").catch((err) =>
    console.error(`Failed to update sheet status for ${id}:`, err.message)
  );
  await sendText(
    order.customerPhone,
    `Good news - your order ${id} is confirmed! Subtotal: $${order.subtotal.toFixed(2)}.\nTime: ${order.requestedTime}` +
      chefTimeNote(order) +
      `\n\nPayment will be collected ${(order.cart || []).some((l) => l.isLiveDoseStation) ? "on the day of your event" : `at ${order.fulfillment}`}. See you then!`
  );
  if (ownerNumber) {
    await sendText(ownerNumber, `Order ${id} confirmed - customer notified.`);
  }
}

async function declineOrder(id, order, ownerNumber) {
  endChat(ownerNumber, id, order.customerPhone);
  pendingOrderStore.remove(id);
  await updateOrderStatus(id, "Declined").catch((err) =>
    console.error(`Failed to update sheet status for ${id}:`, err.message)
  );
  await sendText(
    order.customerPhone,
    `Sorry, we're not able to take order ${id} right now. Please reach out to us directly, or type "menu" to try a different order.`
  );
  if (ownerNumber) {
    await sendText(ownerNumber, `Order ${id} declined - customer notified.`);
  }
}

async function handleOwnerReply(payload) {
  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER;
  const isReply = payload.message_type === "reply";
  const isText = payload.message_type === "text";
  const replyId = isReply ? payload.reply?.id : null;
  const text = isText ? (payload.text || "").trim() : null;

  const pendingEdit = ownerState.get(ownerNumber);

  if (pendingEdit) {
    const order = pendingOrderStore.get(pendingEdit.orderId);
    if (!order) {
      ownerState.clear(ownerNumber);
      await sendText(
        ownerNumber,
        `Order ${pendingEdit.orderId} isn't pending anymore - nothing to update.`
      );
      return;
    }

    if (pendingEdit.mode && pendingEdit.mode.startsWith("custom-")) {
      return handleOwnerCustomStep(ownerNumber, pendingEdit, order, isText ? text : null);
    }

    if (pendingEdit.mode === "select-line") {
      if (replyId && replyId.startsWith("editline:")) {
        const idx = parseInt(replyId.slice(9), 10);
        const line = order.cart[idx];
        ownerState.set(ownerNumber, {
          orderId: pendingEdit.orderId,
          mode: "awaiting-line-price",
          lineIndex: idx
        });
        await sendText(
          ownerNumber,
          `"${line.title}" is currently $${(line.qty * line.price).toFixed(2)} total (${
            Number.isInteger(Number(line.qty)) ? `${line.qty} x $${line.price.toFixed(2)}` : `${fmtQty(line.qty)} trays`
          }). Reply with the new total for this line.`
        );
        return;
      }
      if (replyId === "editwhole:1") {
        ownerState.set(ownerNumber, {
          orderId: pendingEdit.orderId,
          mode: "awaiting-subtotal"
        });
        await sendText(
          ownerNumber,
          `Order ${pendingEdit.orderId} - current subtotal is $${order.subtotal.toFixed(
            2
          )}. Reply with the new subtotal amount.`
        );
        return;
      }
      return sendLineEditPrompt(ownerNumber, pendingEdit.orderId, order);
    }

    if (isText && pendingEdit.mode === "awaiting-line-price") {
      const newLineTotal = parseFloat(text.replace(/[^0-9.]/g, ""));
      if (!newLineTotal || newLineTotal <= 0) {
        await sendText(
          ownerNumber,
          `Please reply with just the new total for this line, e.g. "85".`
        );
        return;
      }
      const line = order.cart[pendingEdit.lineIndex];
      line.price = newLineTotal / line.qty;
      order.subtotal = cartSubtotal(order.cart);
      order.priceEdited = true;
      pendingOrderStore.create(pendingEdit.orderId, order);
      ownerState.clear(ownerNumber);
      await updateOrderSubtotal(pendingEdit.orderId, order.subtotal).catch((err) =>
        console.error(
          `Failed to update sheet subtotal for ${pendingEdit.orderId}:`,
          err.message
        )
      );
      await finishPriceEdit(ownerNumber, pendingEdit.orderId, order);
      return;
    }

    if (isText && pendingEdit.mode === "chat") {
      return sendChefMessage(ownerNumber, pendingEdit, order, text);
    }

    if (isText && pendingEdit.mode === "awaiting-time") {
      const change = parseChefTime(text, order);
      if (!change) {
        return sendText(
          ownerNumber,
          `Sorry, I couldn't read that time. Please reply like "12:30 PM" or "6:30 PM - 8:30 PM" (with AM/PM), or "11/8 12:30 PM" to change the day too.`
        );
      }
      const original = order.requestedTimeOriginal || order.requestedTime || "";
      order.requestedTimeOriginal = original;
      order.requestedTime = `${change.label} (set by Chef)`;
      order.timeChangedByChef = { from: original, to: change.label, at: new Date().toISOString() };
      if (change.date) {
        order.eventDate = change.date;
      }
      pendingOrderStore.create(pendingEdit.orderId, order);
      ownerState.clear(ownerNumber);
      await updateOrderTime(pendingEdit.orderId, order.requestedTime).catch((err) =>
        console.error(`Failed to update sheet time for ${pendingEdit.orderId}:`, err.message)
      );
      return sendButtons(ownerNumber, {
        body: `Order ${pendingEdit.orderId} time changed.\n\nCustomer asked: ${original}\nNew time: ${change.label}\n\nThe customer will see the new time when you approve.`,
        buttons: [
          { id: `approve:${pendingEdit.orderId}`, title: "Approve" },
          { id: `editprice:${pendingEdit.orderId}`, title: "Edit / message" },
          { id: `decline:${pendingEdit.orderId}`, title: "Decline" }
        ]
      });
    }

    if (isText && pendingEdit.mode === "awaiting-subtotal") {
      const newSubtotal = parseFloat(text.replace(/[^0-9.]/g, ""));
      if (!newSubtotal || newSubtotal <= 0) {
        await sendText(
          ownerNumber,
          `Please reply with just the new subtotal amount, e.g. "185" or "185.00".`
        );
        return;
      }
      order.subtotal = newSubtotal;
      order.priceEdited = true;
      pendingOrderStore.create(pendingEdit.orderId, order);
      ownerState.clear(ownerNumber);
      await updateOrderSubtotal(pendingEdit.orderId, newSubtotal).catch((err) =>
        console.error(
          `Failed to update sheet subtotal for ${pendingEdit.orderId}:`,
          err.message
        )
      );
      await finishPriceEdit(ownerNumber, pendingEdit.orderId, order);
      return;
    }
  }

  if (!replyId) return;
  const [action, id] = replyId.split(":");
  const order = pendingOrderStore.get(id);

  if (!order) {
    await sendText(
      ownerNumber,
      `Order ${id} isn't pending anymore (already handled, or the server restarted before it could be actioned - check the Google Sheet).`
    );
    return;
  }

  if (action === "cquote") {
    ownerState.set(ownerNumber, { orderId: id, mode: "custom-price" });
    return sendText(ownerNumber, `Custom request ${id} - reply with the price to quote, e.g. "250".`);
  }
  if (action === "cdecline") {
    ownerState.set(ownerNumber, { orderId: id, mode: "custom-decline-comment" });
    return sendText(
      ownerNumber,
      `Declining ${id}. Reply with a short note for the customer (e.g. "Fully booked that weekend"), or "skip".`
    );
  }
  if (action === "approve") {
    return approveOrder(id, order, ownerNumber);
  }
  if (action === "decline") {
    return declineOrder(id, order, ownerNumber);
  }
  if (action === "editprice") {
    return sendButtons(ownerNumber, {
      body: `Order ${id} - what would you like to do?\n\nTime now: ${order.requestedTime || "not set"}\nSubtotal: $${order.subtotal.toFixed(2)}`,
      buttons: [
        { id: `edp:${id}`, title: "Change price" },
        { id: `edt:${id}`, title: "Change time" },
        { id: `msg:${id}`, title: "Message customer" }
      ]
    });
  }
  if (action === "msg") {
    return startChat(ownerNumber, id, order);
  }
  if (action === "chatend") {
    endChat(ownerNumber, id, order.customerPhone);
    await sendText(order.customerPhone, `Thanks! Chef will confirm your order ${id} here shortly.`).catch(() => {});
    return sendButtons(ownerNumber, {
      body: `Chat about ${id} ended. Approve or decline now?`,
      buttons: [
        { id: `approve:${id}`, title: "Approve" },
        { id: `editprice:${id}`, title: "Edit / message" },
        { id: `decline:${id}`, title: "Decline" }
      ]
    });
  }
  if (action === "edt") {
    ownerState.set(ownerNumber, { orderId: id, mode: "awaiting-time" });
    const lds = (order.cart || []).some((l) => l.isLiveDoseStation);
    return sendText(
      ownerNumber,
      `Order ${id} - customer asked for: ${order.requestedTime || "no time"}.\n\n` +
        `Reply with the time you'll do, e.g. ${lds ? `"6:30 PM - 8:30 PM" (serving time)` : `"12:30 PM"`}. ` +
        `To change the day too, put the date first, e.g. "11/8 ${lds ? "11 AM - 1 PM" : "12:30 PM"}".`
    );
  }
  if (action === "edp") {
    if (order.cart.length > 1) {
      ownerState.set(ownerNumber, { orderId: id, mode: "select-line" });
      return sendLineEditPrompt(ownerNumber, id, order);
    }
    ownerState.set(ownerNumber, { orderId: id, mode: "awaiting-subtotal" });
    await sendText(
      ownerNumber,
      `Order ${id} - current subtotal is $${order.subtotal.toFixed(
        2
      )}. Reply with the new subtotal amount.`
    );
  }
}

async function sendLineEditPrompt(ownerNumber, orderId, order) {
  const rows = order.cart.map((l, idx) => ({
    id: `editline:${idx}`,
    title: l.title.slice(0, 24),
    description: (Number.isInteger(Number(l.qty))
      ? `${l.qty} x $${l.price.toFixed(2)} = $${(l.qty * l.price).toFixed(2)}`
      : `${fmtQty(l.qty)} trays = $${(l.qty * l.price).toFixed(2)}`).slice(0, 72)
  }));
  rows.push({
    id: "editwhole:1",
    title: "Edit whole order total",
    description: `Current subtotal: $${order.subtotal.toFixed(2)}`
  });
  await sendList(ownerNumber, {
    header: `Order ${orderId}`,
    body: "Which line would you like to edit the price for?",
    buttonLabel: "Choose line",
    sections: [{ title: "Order lines", rows }]
  });
}

async function finishPriceEdit(ownerNumber, orderId, order) {
  await sendText(
    ownerNumber,
    `Updated order ${orderId} subtotal to $${order.subtotal.toFixed(
      2
    )}. Approve or decline it now?`
  );
  await sendButtons(ownerNumber, {
    body: `Order ${orderId} - new subtotal $${order.subtotal.toFixed(2)}`,
    buttons: [
      { id: `approve:${orderId}`, title: "Approve" },
      { id: `decline:${orderId}`, title: "Decline" }
    ]
  });
}

// ---------------------------------------------------------------------
// Custom requests: customer describes what they want -> chef quotes a
// price + comments (or declines) -> customer accepts or declines the
// quote -> both get a confirmation.
// ---------------------------------------------------------------------

const CUSTOM_REQUEST_PROMPT =
  "Tell us what you're looking for - for example the dishes, how many people, the date and time, and pickup or delivery (with address). The chef will reply here with a price.";

function customId() {
  return `CUST-${Date.now().toString(36).toUpperCase()}`;
}

async function submitCustomRequest(from, text, menu) {
  const id = customId();
  const order = {
    orderId: id,
    type: "custom",
    customerPhone: from,
    request: text,
    customerName: nameFor(from),
    cart: [{ qty: 1, title: `CUSTOM REQUEST: ${text}`, price: 0 }],
    subtotal: 0,
    fulfillment: "custom",
    address: "",
    requestedTime: ""
  };
  pendingOrderStore.create(id, order);
  await appendOrder({ ...order, status: "Custom - Awaiting Quote" }).catch((err) =>
    console.error(`Failed to log custom request ${id} to Google Sheet:`, err.message)
  );
  await sendText(
    from,
    `Thanks! Your request ${id} has gone to the chef. You'll get a price quote here soon. If it's urgent, call us at ${menu.settings.phoneDisplay}.`
  );

  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER;
  if (!ownerNumber || process.env.OWNER_HAS_OPTED_IN !== "true") {
    console.warn(`Custom request ${id} not sent to owner - check the Google Sheet.`);
    return;
  }
  await sendButtons(ownerNumber, {
    header: "New custom request",
    body: `Request ${id} from ${nameFor(from) || "customer"} (${from}):\n\n"${text}"`.slice(0, 1024),
    buttons: [
      { id: `cquote:${id}`, title: "Send quote" },
      { id: `cdecline:${id}`, title: "Decline" }
    ]
  }).catch((err) =>
    console.error(`Failed to send custom request ${id} to owner:`, err.message)
  );
}

async function handleOwnerCustomStep(ownerNumber, state, order, text) {
  const id = state.orderId;
  if (text === null) {
    return sendText(ownerNumber, "Please reply with a text message.");
  }

  if (state.mode === "custom-price") {
    const price = parseFloat(text.replace(/[^0-9.]/g, ""));
    if (!price || price <= 0) {
      return sendText(ownerNumber, `Please reply with just the price, e.g. "250".`);
    }
    ownerState.set(ownerNumber, { orderId: id, mode: "custom-comment", price });
    return sendText(
      ownerNumber,
      `Quote $${price.toFixed(2)} for ${id}. Any comments for the customer (what's included, timing, pickup/delivery)? Reply with your note, or "skip".`
    );
  }

  if (state.mode === "custom-comment") {
    const comment = SKIP_WORDS.test(text) ? null : text;
    order.subtotal = state.price;
    order.quoteComment = comment;
    order.quoted = true;
    pendingOrderStore.create(id, order);
    ownerState.clear(ownerNumber);
    await updateOrderSubtotal(id, state.price).catch((err) =>
      console.error(`Failed to update sheet subtotal for ${id}:`, err.message)
    );
    await updateOrderStatus(id, "Quote Sent").catch((err) =>
      console.error(`Failed to update sheet status for ${id}:`, err.message)
    );
    try {
      await sendButtons(order.customerPhone, {
        header: "Your quote is ready",
        body: (
          `Request ${id}\n"${order.request}"\n\nPrice: $${state.price.toFixed(2)}` +
          (comment ? `\nChef's note: ${comment}` : "") +
          `\n\n${paymentSentence(botMenu())} Would you like to go ahead?`
        ).slice(0, 1024),
        buttons: [
          { id: `caccept:${id}`, title: "Accept" },
          { id: `creject:${id}`, title: "Decline" }
        ]
      });
      return sendText(ownerNumber, `Quote for ${id} sent to the customer. You'll be notified when they reply.`);
    } catch (err) {
      console.error(`Failed to send quote ${id} to customer:`, err.message);
      return sendText(
        ownerNumber,
        `Couldn't send the quote for ${id} on WhatsApp (often because it's been over 24 hours since the customer last messaged). Please call or text them at ${order.customerPhone}.`
      );
    }
  }

  if (state.mode === "custom-decline-comment") {
    const comment = SKIP_WORDS.test(text) ? null : text;
    pendingOrderStore.remove(id);
    ownerState.clear(ownerNumber);
    await updateOrderStatus(id, "Declined").catch((err) =>
      console.error(`Failed to update sheet status for ${id}:`, err.message)
    );
    await sendText(
      order.customerPhone,
      `Sorry, the chef isn't able to take custom request ${id}.` +
        (comment ? `\nChef's note: ${comment}` : "") +
        `\n\nSend "hi" any time to see our menu or make another request.`
    ).catch((err) => console.error(`Failed to send decline for ${id}:`, err.message));
    return sendText(ownerNumber, `Custom request ${id} declined - customer notified.`);
  }
}

async function handleQuoteResponse(from, replyId) {
  const [action, id] = replyId.split(":");
  const order = pendingOrderStore.get(id);
  if (!order || order.type !== "custom" || order.customerPhone !== from || !order.quoted) {
    return sendText(
      from,
      `That quote isn't open anymore. Send "hi" to see our menu, or call us if you have questions.`
    );
  }
  pendingOrderStore.remove(id);
  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER;
  const price = `$${order.subtotal.toFixed(2)}`;

  if (action === "caccept" && payments.enabled()) {
    try {
      await payments.requestDeposit(order, `Great - you accepted the quote for custom order ${id} (${price}).`);
    } catch (err) {
      console.error(`Failed to request deposit for ${id}:`, err.message);
    }
    if (ownerNumber) {
      await sendText(
        ownerNumber,
        `ACCEPTED: ${order.customerName || "customer"} (${from}) accepted custom order ${id} at ${price}. Zelle deposit of $${payments
          .depositFor(order.subtotal)
          .toFixed(2)} requested.\n\nRequest: "${order.request}"`
      ).catch((err) => console.error(`Failed to notify owner for ${id}:`, err.message));
    }
    return;
  }

  if (action === "caccept") {
    await updateOrderStatus(id, "Confirmed").catch((err) =>
      console.error(`Failed to update sheet status for ${id}:`, err.message)
    );
    await sendText(
      from,
      `Confirmed! Your custom order ${id} is booked for ${price}.` +
        (order.quoteComment ? `\nChef's note: ${order.quoteComment}` : "") +
        `\nPayment is collected in person. Thank you!`
    );
    if (ownerNumber) {
      await sendText(
        ownerNumber,
        `CONFIRMED: ${order.customerName || "customer"} (${from}) accepted custom order ${id} at ${price}.\n\nRequest: "${order.request}"` +
          (order.quoteComment ? `\nYour note: ${order.quoteComment}` : "")
      ).catch((err) => console.error(`Failed to notify owner for ${id}:`, err.message));
    }
    return;
  }

  await updateOrderStatus(id, "Quote Declined").catch((err) =>
    console.error(`Failed to update sheet status for ${id}:`, err.message)
  );
  await sendText(from, `No problem - quote ${id} declined. Send "hi" any time if you'd like something else.`);
  if (ownerNumber) {
    await sendText(ownerNumber, `${order.customerName || "Customer"} (${from}) declined the quote for ${id} (${price}).`).catch((err) =>
      console.error(`Failed to notify owner for ${id}:`, err.message)
    );
  }
}

const LDS_ADDRESS_PROMPT =
  "Our LIVE Dose Station crew will come to you. What's the address for the event/setup location? (Street, town, ZIP)";

/**
 * Asks for the delivery / event address. Returning customers with an
 * address on file get one tap: "Use this address" or "New address".
 */
async function askAddress(from, session, prompt) {
  const profile = customerStore.get(from);
  if (profile?.address) {
    sessionStore.set(from, { ...session, step: "AWAITING_ADDRESS_CHOICE", addressPrompt: prompt });
    const isLds = cartOrderTypes(session.cart).hasLiveDose;
    return sendButtons(from, {
      body: `${isLds ? "Event location" : "Deliver to"} your saved address?\n\n${profile.address}${
        isLds ? "" : "\n\nA delivery fee based on distance will be added when the chef confirms."
      }`.slice(0, 1024),
      buttons: [
        { id: "addr:saved", title: "Use this address" },
        { id: "addr:new", title: "New address" }
      ]
    });
  }
  sessionStore.set(from, { ...session, step: "AWAITING_ADDRESS", addressPrompt: prompt });
  return sendText(from, prompt);
}

async function afterAddress(from, session, menu) {
  if (cartOrderTypes(session.cart).hasLiveDose) {
    const fee = ldsTravelFee(menu, session.distanceMiles);
    session = {
      ...session,
      cart: session.cart.map((l) => {
        if (!l.isLiveDoseStation) return l;
        const basePrice = l.basePrice ?? l.price;
        return {
          ...l,
          basePrice,
          travelFee: fee || 0,
          travelMiles: session.distanceMiles ?? null,
          travelFeeUnknown: fee === null,
          price: basePrice + (fee || 0)
        };
      })
    };
    if (fee > 0) {
      await sendText(
        from,
        `Travel fee: $${fee.toFixed(2)} - your event is about ${session.distanceMiles} miles from our kitchen (${ldsTravelRule(
          menu
        )}). It's included in your total.`
      );
    }
  }
  const hasDates = await sendDatePrompt(from, menu, session);
  sessionStore.set(from, {
    ...session,
    step: dateStep(hasDates)
  });
}

// ---------------------------------------------------------------------
// Address verification: look the address up, confirm it with the
// customer, and check it's inside the delivery radius set in /admin.
// ---------------------------------------------------------------------

function deliverySettings(menu) {
  const d = menu.settings?.delivery || {};
  const hasKitchen = typeof d.kitchenLat === "number" && typeof d.kitchenLon === "number";
  return {
    kitchen: hasKitchen ? { lat: d.kitchenLat, lon: d.kitchenLon } : null,
    maxMiles: Number(d.maxMiles) > 0 ? Number(d.maxMiles) : null,
    ldsMaxMiles: Number(d.ldsMaxMiles) > 0 ? Number(d.ldsMaxMiles) : null
  };
}

/**
 * LIVE Dose Station travel fee: free up to travelFreeMiles, then
 * travelFeePerBlock for every started travelBlockMiles beyond that
 * (defaults: 20 mi free, then $50 per 10 mi). Editable in /admin.
 * Returns null when the distance is unknown (unverified address).
 */
function ldsTravelFee(menu, miles) {
  if (miles == null) return null;
  const cfg = liveDoseConfig(menu) || {};
  const free = Number(cfg.travelFreeMiles ?? 20);
  const per = Number(cfg.travelFeePerBlock ?? 50);
  const block = Number(cfg.travelBlockMiles ?? 10) || 10;
  if (miles <= free || per <= 0) return 0;
  return Math.ceil((miles - free) / block) * per;
}

function ldsTravelRule(menu) {
  const cfg = liveDoseConfig(menu) || {};
  return `first ${cfg.travelFreeMiles ?? 20} miles included, then $${cfg.travelFeePerBlock ?? 50} per ${
    cfg.travelBlockMiles ?? 10
  } miles`;
}

function distanceFromKitchen(menu, point) {
  const { kitchen } = deliverySettings(menu);
  if (!kitchen || !point) return null;
  return Math.round(milesBetween(kitchen, point) * 10) / 10;
}

function addressNote(order) {
  const parts = [];
  if (order.distanceMiles != null) parts.push(`~${order.distanceMiles} mi`);
  parts.push(order.addressVerified ? "verified" : "NOT verified - please check");
  return ` (${parts.join(", ")})`;
}

function addrRetryPrompt() {
  return "Please type the full address again - street number, street, town and ZIP.";
}

/** Is this point too far? Sends the "outside our area" message if so. */
async function outsideArea(from, session, menu, label, miles, match = null) {
  const isLds = cartOrderTypes(session.cart).hasLiveDose;
  const limits = deliverySettings(menu);
  const maxMiles = isLds ? limits.ldsMaxMiles : limits.maxMiles;
  if (!maxMiles || miles == null || miles <= maxMiles) return false;
  if (isLds && session.rangeApprovedFor && session.rangeApprovedFor === label) return false;
  const opts = cateringFulfillmentOptions(menu, session.cart, session.eventDate);
  const buttons = [{ id: "out:retry", title: "Different address" }];
  if (!isLds && opts.pickup) buttons.unshift({ id: "out:pickup", title: "Switch to pickup" });
  if (isLds) buttons.unshift({ id: "out:askchef", title: "Ask Chef" });
  buttons.push({ id: "out:cancel", title: "Cancel" });
  sessionStore.set(from, {
    ...session,
    step: "AWAITING_ADDRESS_OUTSIDE",
    outside: isLds && match ? { label, lat: match.lat, lon: match.lon, miles, max: maxMiles } : null
  });
  await sendButtons(from, {
    body: (isLds
      ? `Sorry - ${label} is about ${miles} miles from our kitchen, which is outside our ${maxMiles}-mile range for the LIVE Dose Station.\n\n` +
        `You can ask Chef to make an exception, call Chef at ${menu.settings.phoneDisplay} to discuss, or use a different address.`
      : `Sorry - ${label} is about ${miles} miles from our kitchen, and we deliver within ${maxMiles} miles.`
    ).slice(0, 1024),
    buttons
  });
  return true;
}

/** Customer picked / confirmed a looked-up address. */
async function acceptVerifiedAddress(from, session, menu, match) {
  const miles = distanceFromKitchen(menu, match);
  if (await outsideArea(from, session, menu, match.label, miles, match)) return;
  customerStore.save(from, { address: match.label, addressLat: match.lat, addressLon: match.lon, addressVerified: true });
  return afterAddress(
    from,
    { ...session, address: match.label, addressVerified: true, distanceMiles: miles, addrMatches: null },
    menu
  );
}

/** Customer typed an address: look it up and ask them to confirm. */
async function checkTypedAddress(from, session, menu, text) {
  if (text.length < 8 || !/\d/.test(text)) {
    return sendText(
      from,
      "That doesn't look like a full address - please include the street number, street, town and ZIP."
    );
  }
  const result = await verifyAddress(text);

  if (result.status === "error") {
    // Lookup service is down - don't block the order; flag it for the chef.
    customerStore.save(from, { address: text, addressLat: null, addressLon: null, addressVerified: false });
    return afterAddress(from, { ...session, address: text, addressVerified: false, distanceMiles: null }, menu);
  }

  if (result.status === "none") {
    sessionStore.set(from, { ...session, step: "AWAITING_ADDRESS_NOTFOUND", typedAddress: text });
    return sendButtons(from, {
      body: `We couldn't find "${text}" on the map. Please check the street number, street name and ZIP.`.slice(0, 1024),
      buttons: [
        { id: "addr:retry", title: "Re-enter address" },
        { id: "addr:asis", title: "Use as typed" }
      ]
    });
  }

  const matches = result.matches;
  if (matches.length === 1) {
    const miles = distanceFromKitchen(menu, matches[0]);
    if (await outsideArea(from, session, menu, matches[0].label, miles, matches[0])) return;
    sessionStore.set(from, { ...session, step: "AWAITING_ADDRESS_CONFIRM", addrMatches: matches });
    return sendButtons(from, {
      body: `Is this the right address?\n\n${matches[0].label}${miles != null ? `\n(about ${miles} mi from our kitchen)` : ""}`,
      buttons: [
        { id: "addrok:0", title: "Yes, that's right" },
        { id: "addr:retry", title: "Re-enter" }
      ]
    });
  }

  sessionStore.set(from, { ...session, step: "AWAITING_ADDRESS_CONFIRM", addrMatches: matches });
  return sendList(from, {
    body: "We found a few matches - which one is yours?",
    buttonLabel: "Choose address",
    sections: [
      {
        title: "Matches",
        rows: [
          ...matches.map((m, i) => ({
            id: `addrok:${i}`,
            title: m.label.split(",")[0].slice(0, 24),
            description: m.label.split(",").slice(1).join(",").trim().slice(0, 72)
          })),
          { id: "addr:retry", title: "None of these", description: "Type the address again" }
        ]
      }
    ]
  });
}

/**
 * First time a number messages us, ask for first and last name before
 * anything else. Returns true if it handled the message.
 */
const NAME_PROMPT =
  "🙏 Namaste, welcome to Franklin Tiffin Room! Before we start, what's your first and last name?";

async function handleNameCapture(from, isText, text) {
  const profile = customerStore.get(from);
  if (profile?.firstName) return false;
  const session = sessionStore.getOrCreate(from);

  if (session.step !== "AWAITING_NAME") {
    sessionStore.set(from, { ...session, step: "AWAITING_NAME" });
    await sendText(from, NAME_PROMPT);
    return true;
  }
  const parts = isText ? text.replace(/\s+/g, " ").trim().split(" ") : [];
  if (parts.length < 2 || parts.some((p) => !/[a-zA-Z]/.test(p)) || text.length > 60) {
    await sendText(from, `Please send your first and last name, for example "Priya Rao".`);
    return true;
  }
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const firstName = cap(parts[0]);
  const lastName = parts.slice(1).map(cap).join(" ");
  customerStore.save(from, { firstName, lastName });
  sessionStore.clear(from);
  await sendText(from, `Thanks, ${firstName}! Nice to meet you.`);
  await sendWelcome(from, false);
  return true;
}

function nameFor(phone) {
  return customerStore.fullName(customerStore.get(phone)) || "";
}

// ---------------------------------------------------------------------
// Date first: customers pick their event date before seeing the menu.
// ---------------------------------------------------------------------

const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

/** "Nov 14", "14 Nov", "11/14", "11-14-2026", "2026-11-14" -> "YYYY-MM-DD" (or null). */
function parseTypedDate(text) {
  const t = text.toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
  let y = null, m = null, d = null, m1;
  if ((m1 = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(t))) { y = +m1[1]; m = +m1[2]; d = +m1[3]; }
  else if ((m1 = /\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/.exec(t))) {
    m = +m1[1]; d = +m1[2]; if (m1[3]) y = +m1[3] < 100 ? 2000 + +m1[3] : +m1[3];
  } else {
    const names = MONTHS.join("|");
    if ((m1 = new RegExp(`\\b(${names})[a-z]*\\s+(\\d{1,2})(?:\\s+(\\d{4}))?\\b`).exec(t))) { m = MONTHS.indexOf(m1[1]) + 1; d = +m1[2]; if (m1[3]) y = +m1[3]; }
    else if ((m1 = new RegExp(`\\b(\\d{1,2})\\s+(?:of\\s+)?(${names})[a-z]*(?:\\s+(\\d{4}))?\\b`).exec(t))) { d = +m1[1]; m = MONTHS.indexOf(m1[2]) + 1; if (m1[3]) y = +m1[3]; }
  }
  if (!m || !d || m > 12 || d > 31) return null;
  const today = todayLocal();
  const build = (yy) => `${yy}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  let iso = build(y || Number(today.slice(0, 4)));
  const check = new Date(iso + "T12:00:00Z");
  if (isNaN(check) || check.getUTCDate() !== d) return null; // e.g. Feb 30
  if (!y && iso < today) iso = build(Number(today.slice(0, 4)) + 1);
  return iso;
}

/** "11:30 AM", "6pm", "noon", "18:00" -> "HH:MM" (or null). */
function parseTypedTime(t) {
  let m;
  if (/\bnoon\b/.test(t)) return "12:00";
  if ((m = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?![a-z])/.exec(t))) {
    let h = +m[1];
    const min = m[2] ? +m[2] : 0;
    if (h < 1 || h > 12 || min > 59) return null;
    const pm = m[3].startsWith("p");
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  if ((m = /\b(\d{1,2}):(\d{2})\b/.exec(t))) {
    let h = +m[1];
    const min = +m[2];
    if (h > 23 || min > 59) return null;
    if (h >= 1 && h <= 7) h += 12; // "6:00" with no am/pm almost always means evening
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  return null;
}

/**
 * Reads a typed request like "11/7 pickup at 11:30 AM" into
 * { date, kind: "pickup"|"delivery"|"lds"|null, time: "HH:MM"|null, meal }.
 * Exported for tests.
 */
function parseOrderRequest(text) {
  const t = String(text || "").toLowerCase();
  let kind = null;
  if (/\blive\b|dose station|\blds\b|\bstation\b/.test(t)) kind = "lds";
  else if (/pick\s*-?\s*up|\bcollect|take\s*-?\s*away|takeout/.test(t)) kind = "pickup";
  else if (/deliver|drop\s*-?\s*off/.test(t)) kind = "delivery";
  const time = parseTypedTime(t);
  const meal = /\blunch\b/.test(t) ? "am" : /\b(dinner|evening)\b/.test(t) ? "pm" : null;
  // Take the time out before reading the date so "11:30" can't be mistaken for one.
  const dateText = t
    .replace(/\b\d{1,2}(?::\d{2})?\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?![a-z])/g, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ");
  return { date: parseTypedDate(dateText), kind, time, meal };
}

function minutesOf(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Check a typed request against what Chef offers that day. Returns the
 * preference to remember (or null) and a note for the customer.
 */
function matchPreference(menu, entry, req) {
  if (!req || (!req.kind && !req.time && !req.meal)) return { prefer: null, note: "" };
  const pt = pickupTimes(menu);
  const hasPickup = entry.pickupAM || entry.pickupPM;
  let kind = req.kind;
  // A time with no type: if only one kind of order is open that day, it's that one.
  if (!kind) {
    const kinds = [hasPickup && "pickup", entry.catering.length && "delivery", entry.liveDose.length && "lds"].filter(Boolean);
    if (kinds.length === 1) kind = kinds[0];
    else if (req.meal && hasPickup) kind = "pickup";
  }
  if (kind === "pickup") {
    if (!hasPickup) return { prefer: null, note: "Note: pickup isn't open that day - see the options above." };
    let am;
    if (req.meal) am = req.meal === "am";
    else if (req.time) am = Math.abs(minutesOf(req.time) - minutesOf(pt.am)) <= Math.abs(minutesOf(req.time) - minutesOf(pt.pm));
    else am = entry.pickupAM && !entry.pickupPM;
    if (am && !entry.pickupAM) return { prefer: { kind, slotId: "slot:pickup-pm" }, note: `Lunch pickup isn't open that day, so I've noted dinner pickup by ${formatTimeLabel(pt.pm)}.` };
    if (!am && !entry.pickupPM) return { prefer: { kind, slotId: "slot:pickup-am" }, note: `Dinner pickup isn't open that day, so I've noted lunch pickup by ${formatTimeLabel(pt.am)}.` };
    if (!req.time && !req.meal) return { prefer: { kind }, note: "Noted: pickup." };
    const by = am ? pt.am : pt.pm;
    const off = req.time && req.time !== by ? ` (pickups are ready by ${formatTimeLabel(by)})` : "";
    return { prefer: { kind, slotId: am ? "slot:pickup-am" : "slot:pickup-pm" }, note: `Noted: pickup by ${formatTimeLabel(by)} (${am ? "lunch" : "dinner"})${off}.` };
  }
  if (kind === "delivery" && pickupOnly(menu)) {
    return { prefer: null, note: "Note: all catering orders are pickup only - delivery isn't available." };
  }
  if (kind === "delivery" || kind === "lds") {
    const windows = kind === "lds" ? entry.liveDose : entry.catering;
    const what = kind === "lds" ? "the LIVE Dose Station" : "delivery";
    if (!windows.length) return { prefer: null, note: `Note: ${what} isn't open that day - see the options above.` };
    if (!req.time) return { prefer: { kind }, note: `Noted: ${what}.` };
    const t = minutesOf(req.time);
    const inside = windows.some((w) => t >= minutesOf(w.start) && t < minutesOf(w.end));
    if (!inside) {
      return { prefer: { kind }, note: `Noted: ${what}. ${formatTimeLabel(req.time)} is outside the open hours (${windows.map(windowLabel).join(", ")}), so I'll show you the times when you check out.` };
    }
    return { prefer: { kind, time: req.time }, note: `Noted: ${what} at ${formatTimeLabel(req.time)}.` };
  }
  if (req.time) return { prefer: { time: req.time }, note: `Noted: ${formatTimeLabel(req.time)}.` };
  return { prefer: null, note: "" };
}

function offeringsText(menu, d) {
  const pt = pickupTimes(menu);
  const lines = [];
  const pickups = [];
  if (d.pickupAM) pickups.push(formatTimeLabel(pt.am) + " (lunch)");
  if (d.pickupPM) pickups.push(formatTimeLabel(pt.pm) + " (dinner)");
  if (pickups.length) lines.push(`- Catering pickup by ${pickups.join(" or ")}`);
  if (d.catering.length) lines.push(`- Catering delivery ${d.catering.map(windowLabel).join(", ")}`);
  if (d.liveDose.length) lines.push(`- LIVE Dose Station ${d.liveDose.map(windowLabel).join(", ")}`);
  return lines.join("\n");
}

function shortOfferings(menu, d) {
  const pt = pickupTimes(menu), out = [];
  const p = [];
  if (d.pickupAM) p.push(shortTime(pt.am));
  if (d.pickupPM) p.push(shortTime(pt.pm));
  if (p.length) out.push("Pickup " + p.join("/"));
  if (d.catering.length) out.push("Delivery");
  if (d.liveDose.length) out.push("LIVE Dose");
  return out.join(" · ");
}

/** Examples built from real open days, e.g. "11/7 pickup at 11:30 AM". */
function typingExamples(menu, dates) {
  const md = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8)}`;
  const pt = pickupTimes(menu);
  const out = [];
  const p = dates.find((d) => d.pickupAM || d.pickupPM);
  if (p) out.push(`${md(p.date)} pickup at ${formatTimeLabel(p.pickupAM ? pt.am : pt.pm)}`);
  const c = dates.find((d) => d.catering.length);
  if (c) out.push(`${md(c.date)} delivery ${formatTimeLabel(c.catering[0].start)}`);
  const l = dates.find((d) => d.liveDose.length);
  if (l) out.push(`${md(l.date)} LIVE Dose ${formatTimeLabel(l.liveDose[0].start)}`);
  if (!out.length && dates[0]) out.push(md(dates[0].date));
  return out;
}

async function sendEventDateList(to, menu) {
  const dates = upcomingDates(menu);
  sessionStore.set(to, { ...sessionStore.getOrCreate(to), step: "AWAITING_EVENT_DATE" });
  return sendList(to, {
    header: "Choose your date",
    body:
      `Which day is your order for? These are the open days in the next ${BOOKING_WINDOW_DAYS} days.\n\n` +
      `Or just type it, with the time if you know it - for example:\n` +
      typingExamples(menu, dates).map((e) => `"${e}"`).join("\n"),
    buttonLabel: "Choose date",
    sections: [
      {
        title: "Open days",
        rows: dates.slice(0, 10).map((d) => ({
          id: `evdate:${d.date}`,
          title: formatDateLabel(d.date).slice(0, 24),
          description: shortOfferings(menu, d).slice(0, 72)
        }))
      }
    ]
  });
}

async function startDateFirst(from, menu) {
  const dates = upcomingDates(menu);
  sessionStore.set(from, { ...sessionStore.getOrCreate(from), cart: [], eventDate: null, selectedDate: null });
  if (!dates.length) {
    await sendText(from, NO_DATES_MESSAGE(menu));
    sessionStore.clear(from);
    return sendWelcome(from, false);
  }
  // The calendar picture (falls back to a text list if it can't be made).
  const version = calendarImage.currentVersion(menu);
  let sentImage = false;
  if (version) {
    const base = (process.env.PUBLIC_BASE_URL || "https://bot.franklintiffinroom.com").replace(/\/$/, "");
    try {
      await sendImage(from, `${base}/calendar.png?v=${version}`, "Chef availability - green days are open for orders.");
      sentImage = true;
    } catch (err) {
      console.error("Could not send calendar image:", err.message);
    }
  }
  if (!sentImage) {
    const summary = availabilitySummary(menu);
    if (summary) await sendText(from, summary);
  }
  return sendEventDateList(from, menu);
}

async function chooseEventDate(from, menu, date, req = null) {
  const today = todayLocal();
  const last = addDays(today, BOOKING_WINDOW_DAYS);
  const entry = upcomingDates(menu).find((d) => d.date === date);
  const label = formatDateLabel(date);

  if (entry) {
    const { prefer, note } = matchPreference(menu, entry, req);
    sessionStore.set(from, {
      ...sessionStore.getOrCreate(from),
      cart: [],
      eventDate: date,
      selectedDate: date,
      prefer,
      step: "AWAITING_CATEGORY"
    });
    return sendMainMenu(
      from,
      false,
      `${label} it is! Here's what Chef offers that day:\n${offeringsText(menu, entry)}` + (note ? `\n\n${note}` : "")
    );
  }

  let why;
  if (date < today) why = `${label} has already passed.`;
  else if (date > last) why = `We take orders up to ${BOOKING_WINDOW_DAYS} days ahead, so ${label} isn't open yet. For a bigger event that far out, send us a custom request.`;
  else if (dow(date) !== 0 && dow(date) !== 6) why = `Sorry, Chef isn't available on ${label}. We cook on select weekends only.`;
  else why = `Sorry, Chef isn't available on ${label}.`;

  sessionStore.set(from, { ...sessionStore.getOrCreate(from), step: "AWAITING_EVENT_DATE", eventDate: null });
  return sendButtons(from, {
    body: `${why}\n\nThe green days in the calendar are open.`,
    buttons: [
      { id: "evagain", title: "Pick another date" },
      { id: "hub:custom", title: "Custom request" }
    ]
  });
}

/**
 * Customer is done adding items. Checks the order minimum, then either
 * asks delivery/pickup (catering) or goes straight to the address
 * (LIVE Dose Station, which is always on-site).
 */
async function proceedToCheckout(from, session, menu) {
  if (session.cart.length === 0) {
    sessionStore.set(from, { ...session, step: "AWAITING_CATEGORY" });
    return sendMainMenu(from, false);
  }
  const min = orderMinimum(menu);
  const subtotal = cartSubtotal(session.cart);
  const { hasLiveDose, hasPreorder } = cartOrderTypes(session.cart);
  if (hasPreorder) {
    // Pre-orders are always picked up on one of Chef's pre-order days; no minimum.
    const updated = { ...session, fulfillment: "pickup" };
    const hasDates = await sendDatePrompt(from, menu, updated);
    sessionStore.set(from, { ...updated, step: dateStep(hasDates) });
    return;
  }
  // An LDS order can't take more items, so the minimum only applies to
  // catering carts.
  if (!hasLiveDose && min > 0 && subtotal < min) {
    await sendText(
      from,
      `Your order subtotal is $${subtotal.toFixed(
        2
      )}, which is below our $${min.toFixed(2)} minimum for catering orders. Please add a bit more.`
    );
    sessionStore.set(from, { ...session, step: "AWAITING_CATEGORY" });
    return sendMainMenu(from, false);
  }
  if (hasLiveDose) {
    // The Live Dose Station is always on-site - the crew comes to
    // the client, so there's no pickup option and no separate
    // delivery/pickup question to ask.
    return askAddress(from, { ...session, fulfillment: "delivery" }, LDS_ADDRESS_PROMPT);
  }
  return askFulfillment(from, session, menu);
}

// ---------------------------------------------------------------------
// Coming back later: customers who stop mid-order and message again after
// a break are asked whether to continue where they left off.
// ---------------------------------------------------------------------
const RESUME_AFTER_MS = 30 * 60 * 1000;
const NOT_RESUMABLE = new Set(["NEW", "AWAITING_HUB_CHOICE", "AWAITING_NAME", "AWAITING_MYORDER"]);

function inProgress(session) {
  if (!session || NOT_RESUMABLE.has(session.step)) return false;
  if (session.step === "AWAITING_EVENT_DATE" && !(session.cart || []).length) return false;
  return true;
}

/** Why an old session can't be continued (date passed / closed), or null. */
function staleReason(session, menu) {
  const d = session.eventDate || session.selectedDate;
  if (!d) return null;
  if (d < todayLocal()) return `the date you picked (${formatDateLabel(d)}) has passed`;
  const entry = findDateEntry(menu, d);
  if (!entry || !(offersCatering(entry) || offersLiveDose(entry))) {
    return `Chef is no longer available on ${formatDateLabel(d)}`;
  }
  return null;
}

const STEP_DOING = {
  AWAITING_EVENT_DATE: "choosing a date",
  AWAITING_CATEGORY: "choosing what to order",
  AWAITING_ITEM: "choosing dishes",
  AWAITING_QTY: "choosing a quantity",
  AWAITING_ITEM_NOTE: "adding a note to a dish",
  AWAITING_LDS_TOTAL: "setting up a LIVE Dose Station",
  AWAITING_LDS_SPLIT: "setting up a LIVE Dose Station",
  AWAITING_LDS_NOTE: "setting up a LIVE Dose Station",
  AWAITING_ADD_MORE: "adding dishes",
  AWAITING_FULFILLMENT: "choosing pickup or delivery",
  AWAITING_ADDRESS_CHOICE: "entering the address",
  AWAITING_ADDRESS: "entering the address",
  AWAITING_ADDRESS_CONFIRM: "confirming the address",
  AWAITING_ADDRESS_NOTFOUND: "entering the address",
  AWAITING_ADDRESS_OUTSIDE: "entering the address",
  AWAITING_DATE: "choosing a time",
  AWAITING_DATE_NONE: "choosing a time",
  AWAITING_SLOT: "choosing a time",
  AWAITING_CONFIRM: "reviewing your order",
  AWAITING_PICKUP_AGREE: "confirming pickup",
  AWAITING_LDS_EXTEND: "choosing your LIVE Dose time",
  AWAITING_ORDER_NOTE: "adding a note to your order",
  AWAITING_FEEDBACK: "writing a comment for us",
  AWAITING_FEEDBACK_ORDER: "writing a comment for us",
  AWAITING_RANGE_APPROVAL: "waiting for Chef to OK your address",
  AWAITING_CUSTOM_REQUEST: "writing a custom request",
  AWAITING_QUESTION: "asking us a question"
};

async function offerResume(from, session, menu) {
  const stale = staleReason(session, menu);
  if (stale) {
    sessionStore.clear(from);
    await sendText(from, `Welcome back! Your earlier order couldn't be kept because ${stale}. Let's start a fresh one.`);
    return sendWelcome(from, false);
  }
  const cart = session.cart || [];
  const name = customerStore.get(from)?.firstName;
  const lines = [`Welcome back${name ? `, ${name}` : ""}! You were ${STEP_DOING[session.step] || "placing an order"}.`];
  const d = session.eventDate || session.selectedDate;
  if (d) lines.push(`Date: ${formatDateLabel(d)}`);
  if (cart.length) {
    lines.push(`In your order so far:`);
    cart.forEach((l) => lines.push(lineLabel(l)));
    lines.push(`Subtotal: $${cartSubtotal(cart).toFixed(2)}`);
  }
  lines.push("", "Pick up where you left off?");
  sessionStore.set(from, { ...session, resumeOffered: true });
  return sendButtons(from, {
    body: lines.join("\n"),
    buttons: [
      { id: "resume:yes", title: "Continue" },
      { id: "resume:no", title: "Start over" }
    ]
  });
}

/** Re-send the question for the step the customer was on. */
async function repromptStep(from, session, menu) {
  const lds = (session.cart || []).some((l) => l.isLiveDoseStation);
  switch (session.step) {
    case "AWAITING_EVENT_DATE":
      return sendEventDateList(from, menu);
    case "AWAITING_CATEGORY":
    case "AWAITING_ADD_MORE":
      return session.step === "AWAITING_ADD_MORE" ? sendAddMorePrompt(from) : sendMainMenu(from, false);
    case "AWAITING_ITEM": {
      const cat = findCategory(menu, session.itemCategoryId);
      if (cat) return sendCategoryItems(from, cat);
      sessionStore.set(from, { ...session, step: "AWAITING_CATEGORY" });
      return sendMainMenu(from, false);
    }
    case "AWAITING_QTY":
      if (session.pendingItem) return sendQtyPrompt(from, session.pendingItem, menu);
      break;
    case "AWAITING_ITEM_NOTE":
      if (session.pendingItem) return sendItemNotePrompt(from, session.pendingItem);
      break;
    case "AWAITING_LDS_TOTAL":
    case "AWAITING_LDS_SPLIT": {
      const cat = findCategory(menu, session.ldsCategoryId);
      if (!cat) break;
      return session.step === "AWAITING_LDS_TOTAL"
        ? sendLiveDoseTotalPrompt(from, cat)
        : sendLiveDoseSplitPrompt(from, cat, session.ldsTotal);
    }
    case "AWAITING_LDS_NOTE":
      return sendLiveDoseNotePrompt(from);
    case "AWAITING_FULFILLMENT":
      return askFulfillment(from, session, menu);
    case "AWAITING_ADDRESS_CHOICE":
    case "AWAITING_ADDRESS":
    case "AWAITING_ADDRESS_CONFIRM":
    case "AWAITING_ADDRESS_NOTFOUND":
    case "AWAITING_ADDRESS_OUTSIDE":
      return askAddress(from, session, session.addressPrompt || (lds ? LDS_ADDRESS_PROMPT : DELIVERY_ADDRESS_PROMPT));
    case "AWAITING_DATE":
    case "AWAITING_DATE_NONE":
    case "AWAITING_SLOT": {
      const hasDates = await sendDatePrompt(from, menu, session);
      sessionStore.set(from, { ...sessionStore.getOrCreate(from), step: dateStep(hasDates) });
      return;
    }
    case "AWAITING_CONFIRM":
      return sendOrderSummary(from, session);
    case "AWAITING_ORDER_NOTE":
      return sendOrderSummary(from, { ...session, step: "AWAITING_CONFIRM" });
    case "AWAITING_LDS_EXTEND":
      if (session.ldsSession) return offerLdsExtension(from, session, menu);
      break;
    case "AWAITING_PICKUP_AGREE":
      return askPickupAgreement(from, session, menu, findCategory(menu, session.itemCategoryId) || { id: session.itemCategoryId });
    case "AWAITING_RANGE_APPROVAL":
      return sendText(from, `We're still waiting to hear back from Chef about ${session.outside?.label || "your address"}. You can also call Chef at ${menu.settings.phoneDisplay}.`);
    case "AWAITING_CUSTOM_REQUEST":
      return sendText(from, CUSTOM_REQUEST_PROMPT);
    case "AWAITING_QUESTION":
      return sendText(from, "Sure - what's your question? Type it below and we'll get back to you as soon as we can.");
  }
  // Couldn't rebuild that exact question - go back to the order menu.
  if ((session.cart || []).length || session.eventDate) {
    sessionStore.set(from, { ...session, step: "AWAITING_CATEGORY" });
    return sendMainMenu(from, false);
  }
  sessionStore.clear(from);
  return sendWelcome(from, false);
}

// ---------------------------------------------------------------------
// Catering is pickup only: customers agree before choosing dishes.
// ---------------------------------------------------------------------
function pickupAgreementText(menu) {
  return (
    `Please note: ALL CATERING ORDERS ARE FOR PICKUP ONLY.\n\n` +
    `You'll collect your order from our kitchen at your chosen pickup time - Chef will share the pickup details when your order is confirmed. ` +
    `We don't deliver catering orders.\n\nDo you agree to pick up your order?`
  );
}

async function askPickupAgreement(from, session, menu, category) {
  sessionStore.set(from, { ...session, step: "AWAITING_PICKUP_AGREE", itemCategoryId: category.id });
  return sendButtons(from, {
    header: "Pickup only",
    body: pickupAgreementText(menu),
    buttons: [
      { id: "pickup:agree", title: "I agree - pickup" },
      { id: "pickup:no", title: "I need delivery" }
    ]
  });
}

async function handlePickupAgreement(from, session, menu, replyId) {
  if (replyId === "pickup:agree") {
    const category = findCategory(menu, session.itemCategoryId);
    const updated = { ...session, pickupAgreed: true, fulfillment: "pickup", step: "AWAITING_ITEM" };
    sessionStore.set(from, updated);
    if (category) return sendCategoryItems(from, category, "Thank you! Pickup it is.");
    sessionStore.set(from, { ...updated, step: "AWAITING_CATEGORY" });
    return sendMainMenu(from, false);
  }
  if (replyId === "pickup:no") {
    const lds = (menu.categories || []).find((c) => c.type === "live-dose-station");
    const ldsOpen =
      lds && categoriesAllowedForCart(menu, session.cart, session.eventDate).some((c) => c.id === lds.id);
    sessionStore.set(from, { ...session, step: "AWAITING_CATEGORY" });
    const buttons = [];
    if (ldsOpen) buttons.push({ id: `cat:${lds.id}`, title: "LIVE Dose Station" });
    buttons.push({ id: "hub:back", title: "Back to menu" });
    return sendButtons(from, {
      body:
        `No problem. Catering orders are pickup only, but you're welcome to call Chef at ${menu.settings.phoneDisplay} to discuss what you need.` +
        (ldsOpen ? `\n\nOur LIVE Dose Station does come to you - would you like that instead?` : ""),
      buttons
    });
  }
  return askPickupAgreement(from, session, menu, findCategory(menu, session.itemCategoryId) || { id: session.itemCategoryId });
}

// ---------------------------------------------------------------------
// LIVE Dose address beyond the travel limit: the customer can ask Chef,
// who allows or declines on WhatsApp (or in the admin page).
// ---------------------------------------------------------------------
async function askChefAboutRange(from, session, menu) {
  const o = session.outside;
  if (!o) return askAddress(from, session, LDS_ADDRESS_PROMPT);
  sessionStore.set(from, { ...session, step: "AWAITING_RANGE_APPROVAL", rangeAskedAt: new Date().toISOString() });
  await sendText(
    from,
    `We've asked Chef whether the LIVE Dose Station can come to ${o.label}. You'll get an answer here shortly - or call Chef at ${menu.settings.phoneDisplay} to discuss.`
  );
  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER;
  if (!ownerNumber) return;
  const line = (session.cart || []).find((l) => l.isLiveDoseStation);
  const plates = line ? (line.mdQty || 0) + (line.odQty || 0) : null;
  const fee = ldsTravelFee(menu, o.miles);
  await sendButtons(ownerNumber, {
    header: "Out-of-range LIVE Dose",
    body: (
      `${nameFor(from) || "A customer"} (${from}) wants the LIVE Dose Station at:\n${o.label}\n` +
      `About ${o.miles} miles away (your limit is ${o.max}).\n` +
      (session.eventDate ? `Date: ${formatDateLabel(session.eventDate)}\n` : "") +
      (plates ? `Plates: ${plates}\n` : "") +
      (fee != null ? `Travel fee at this distance: $${fee.toFixed(2)}\n` : "") +
      `\nAllow this address for their order?`
    ).slice(0, 1024),
    buttons: [
      { id: `rangeok:${from}`, title: "Allow" },
      { id: `rangeno:${from}`, title: "Decline" }
    ]
  }).catch((err) => console.error("Couldn't send range request to owner:", err.message));
}

/** Chef's answer (WhatsApp button or admin page). Returns a short status. */
async function decideRange(phone, allow) {
  const session = sessionStore.get(phone);
  if (!session || session.step !== "AWAITING_RANGE_APPROVAL" || !session.outside) {
    return "This request isn't waiting anymore (the customer may have started over).";
  }
  const menu = botMenu();
  const o = session.outside;
  if (allow) {
    await sendText(phone, `Good news - Chef can bring the LIVE Dose Station to ${o.label}! Let's continue.`);
    customerStore.save(phone, { address: o.label, addressLat: o.lat, addressLon: o.lon, addressVerified: true });
    await afterAddress(
      phone,
      { ...session, outside: null, rangeApprovedFor: o.label, address: o.label, addressVerified: true, distanceMiles: o.miles, addrMatches: null },
      menu
    );
    return `Allowed - ${nameFor(phone) || phone} can continue their order.`;
  }
  sessionStore.set(phone, { ...session, step: "AWAITING_ADDRESS_OUTSIDE" });
  await sendButtons(phone, {
    body: `Sorry - Chef isn't able to bring the LIVE Dose Station to ${o.label}. Please call Chef at ${menu.settings.phoneDisplay} if you'd like to discuss, or use a different address.`,
    buttons: [
      { id: "out:retry", title: "Different address" },
      { id: "out:cancel", title: "Cancel" }
    ]
  });
  return `Declined - ${nameFor(phone) || phone} was told.`;
}

/** Waiting out-of-range requests, for the admin page. */
function rangeRequests() {
  const all = require("./jsonFile").read("sessions.json", {}) || {};
  return Object.entries(all)
    .filter(([, s]) => s && s.step === "AWAITING_RANGE_APPROVAL" && s.outside)
    .map(([phone, s]) => {
      const line = (s.cart || []).find((l) => l.isLiveDoseStation);
      return {
        phone,
        name: nameFor(phone),
        address: s.outside.label,
        miles: s.outside.miles,
        limit: s.outside.max,
        eventDate: s.eventDate || null,
        plates: line ? (line.mdQty || 0) + (line.odQty || 0) : null,
        askedAt: s.rangeAskedAt || null
      };
    });
}

// ---------------------------------------------------------------------
// LIVE Dose session chosen: show the schedule, offer extra time.
// ---------------------------------------------------------------------
function ldsRequestedTime(session, menu, extended) {
  const { start, end } = session.ldsSession;
  const ext = ldsExtension(menu);
  const endMin = minutesOf(end) + (extended ? ext.minutes : 0);
  const endLabel = formatTimeLabel(`${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`);
  return `${formatDateLabel(session.selectedDate)}, LIVE Dose serving ${formatTimeLabel(start)} - ${endLabel}${
    extended ? ` (incl. ${ext.minutes} extra min)` : ""
  }`;
}

async function offerLdsExtension(from, session, menu) {
  const lds = liveDoseConfig(menu) || {};
  const ext = ldsExtension(menu);
  const { start, end } = session.ldsSession;
  const setup = Number(lds.setupMinutes) > 0 ? Number(lds.setupMinutes) : 30;
  const arrive = minutesOf(start) - setup;
  const arriveLabel = formatTimeLabel(`${String(Math.floor(arrive / 60)).padStart(2, "0")}:${String(arrive % 60).padStart(2, "0")}`);
  sessionStore.set(from, { ...session, step: "AWAITING_LDS_EXTEND" });
  return sendButtons(from, {
    header: "Your LIVE Dose schedule",
    body:
      `${formatDateLabel(session.selectedDate)}\n` +
      `Crew arrives to set up: about ${arriveLabel}\n` +
      `Serving on site: ${formatTimeLabel(start)} - ${formatTimeLabel(end)}\n\n` +
      `${extraDoseText(lds)}\n\n` +
      `Need longer? Add ${ext.minutes} extra minutes of serving for $${ext.fee}.`,
    buttons: [
      { id: "ldsext:no", title: "No, that's fine" },
      { id: "ldsext:yes", title: `Add ${ext.minutes} min +$${ext.fee}`.slice(0, 20) }
    ]
  });
}

async function handleLdsExtension(from, session, menu, replyId) {
  if (replyId !== "ldsext:yes" && replyId !== "ldsext:no") return offerLdsExtension(from, session, menu);
  const extended = replyId === "ldsext:yes";
  const ext = ldsExtension(menu);
  const cart = session.cart.map((l) => {
    if (!l.isLiveDoseStation) return l;
    const withoutExt = l.price - (Number(l.extensionFee) || 0);
    return {
      ...l,
      extensionMinutes: extended ? ext.minutes : 0,
      extensionFee: extended ? ext.fee : 0,
      price: withoutExt + (extended ? ext.fee : 0)
    };
  });
  const updated = { ...session, cart, requestedTime: ldsRequestedTime(session, menu, extended), step: "AWAITING_CONFIRM" };
  sessionStore.set(from, updated);
  return sendOrderSummary(from, updated);
}

/**
 * Chef's reply when changing an order's time: "12:30 PM", "6:30 PM - 8:30 PM",
 * optionally with a date first ("11/8 12:30 PM"). Returns { label, date } or null.
 */
function parseChefTime(text, order) {
  const raw = String(text || "").toLowerCase();
  const timeRe = /(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)|\bnoon\b/g;
  const times = [];
  let m;
  while ((m = timeRe.exec(raw))) times.push(parseTypedTime(m[0]));
  const clean = times.filter(Boolean);
  if (!clean.length) return null;
  const dateText = raw.replace(timeRe, " ");
  const date = /\d{1,2}[\/-]\d{1,2}|[a-z]{3,}\s+\d{1,2}|\d{1,2}\s+[a-z]{3,}/.test(dateText) ? parseTypedDate(dateText) : null;
  const day = date || order.eventDate || order.selectedDate || null;
  const dayLabel = day ? `${formatDateLabel(day)}, ` : "";
  const lds = (order.cart || []).some((l) => l.isLiveDoseStation);
  let start = clean[0];
  let end = clean[1] || null;
  if (lds && !end) {
    // Keep the same serving length as the session they booked.
    const r = /(\d{1,2}:\d{2} [AP]M) - (\d{1,2}:\d{2} [AP]M)/.exec(order.requestedTime || "");
    const len = r ? minutesOf(to24(r[2])) - minutesOf(to24(r[1])) : 120;
    const e = minutesOf(start) + (len > 0 ? len : 120);
    end = `${String(Math.floor(e / 60) % 24).padStart(2, "0")}:${String(e % 60).padStart(2, "0")}`;
  }
  let label;
  if (lds) label = `${dayLabel}LIVE Dose serving ${formatTimeLabel(start)} - ${formatTimeLabel(end)}`;
  else if (order.fulfillment === "pickup") label = `${dayLabel}pickup at ${formatTimeLabel(start)}${end ? ` - ${formatTimeLabel(end)}` : ""}`;
  else label = `${dayLabel}${formatTimeLabel(start)}${end ? ` - ${formatTimeLabel(end)}` : ""}`;
  return { label, date };
}

/** "6:30 PM" -> "18:30" */
function to24(label) {
  const m = /(\d{1,2}):(\d{2}) ([AP])M/.exec(label);
  if (!m) return "00:00";
  let h = +m[1] % 12;
  if (m[3] === "P") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** Line for the customer when Chef changed their time. */
function chefTimeNote(order) {
  if (!order.timeChangedByChef) return "";
  return `\n\nPlease note: Chef has set your time to ${order.timeChangedByChef.to} (you asked for ${order.timeChangedByChef.from}).`;
}

// ---------------------------------------------------------------------
// Cancelling: the customer (or Chef) can cancel an order while it's
// waiting for Chef's approval or for the 50% deposit - not after payment.
// ---------------------------------------------------------------------
const CLOSED_STATUS = /declined|cancelled|released|completed/i;

/** Can this order still be cancelled? Returns null if yes, else the reason. */
function cancelBlock(order) {
  if (!order) return "That order wasn't found.";
  if (order.source === "past") return "That's a past order on file.";
  if (CLOSED_STATUS.test(order.status || "")) return `Order ${order.orderId} is already ${String(order.status).toLowerCase()}.`;
  if (order.pending) return null; // waiting for Chef (or a custom quote)
  const p = order.payment;
  if (p && p.state === "awaiting") return null; // approved, deposit not sent yet
  if (p && p.state === "review") return `We've received your deposit screenshot for ${order.orderId}, so it can't be cancelled here.`;
  return `Order ${order.orderId} is already confirmed${p && p.state === "paid" ? " and the deposit is paid" : ""}.`;
}

function cancellableOrders(phone) {
  return require("./orderDb")
    .all()
    .filter((o) => o.customerPhone === phone && !cancelBlock(o))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

/** Cancel an order (by "customer" or "chef") and tell the other side. */
async function cancelOrder(id, by) {
  const orderDb = require("./orderDb");
  const order = orderDb.get(id);
  const block = cancelBlock(order);
  if (block) return { ok: false, reason: block };
  const status = by === "chef" ? "Cancelled by Chef" : "Cancelled by customer";
  const patch = { status, pending: false, cancelledAt: new Date().toISOString(), cancelledBy: by };
  if (order.payment) patch.payment = { ...order.payment, state: "cancelled" };
  orderDb.update(id, patch);
  await updateOrderStatus(id, status).catch((err) => console.error(`Failed to update sheet status for ${id}:`, err.message));
  if (order.payment) {
    await require("./records").updateOrderPayment(id, `Deposit ${"$" + Number(order.payment.depositDue || 0).toFixed(2)} not needed - order cancelled`).catch(() => {});
  }
  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER;
  if (ownerNumber) endChat(ownerNumber, id, order.customerPhone);
  const menu = botMenu();
  if (by === "chef") {
    await sendText(
      order.customerPhone,
      `Chef has cancelled your order ${id}. Sorry for any trouble - if you have questions, please call ${menu.settings.phoneDisplay}. Send "hi" any time to place a new order.`
    ).catch((err) => console.error(`Couldn't tell customer about cancel ${id}:`, err.message));
  } else if (ownerNumber) {
    await sendText(
      ownerNumber,
      `CANCELLED: ${order.customerName || order.customerPhone} cancelled order ${id} ($${Number(order.subtotal || 0).toFixed(2)}${order.requestedTime ? `, ${order.requestedTime}` : ""}).`
    ).catch(() => {});
  }
  return { ok: true, status };
}

function shortWhen(o) {
  const d = o.eventDate || (o.createdAt || "").slice(0, 10);
  if (!d) return "";
  const yr = d.slice(0, 4) !== todayLocal().slice(0, 4) ? ` ${d.slice(0, 4)}` : "";
  return formatDateLabel(d) + yr;
}

function statusWord(o) {
  if (o.source === "past") return "Past order";
  if (o.pending) return o.type === "custom" ? (o.quoted ? "Quote sent" : "Waiting for quote") : "Waiting for Chef";
  if (o.payment && o.payment.state === "awaiting") return "Deposit due";
  if (o.payment && o.payment.state === "review") return "Deposit being checked";
  return o.status || "";
}

const MY_ORDERS_WORDS = [
  /^\s*(please\s+)?((show|see|view|check|list|get|display|send|give)\s+(me\s+)?)?(all\s+)?(of\s+)?(my|our)\s+(past\s+|previous\s+|old\s+|recent\s+)?orders?(\s+(status|history|details|list))?\s*(please)?[?.!]*\s*$/i,
  /^\s*(show|see|view|check|list)\s+(the\s+)?orders?\s*[?.!]*\s*$/i,
  /\border\s+history\b/i,
  /\b(my|our)\s+(past|previous|old)\s+orders?\b/i,
  /\bwhat\s+(did|have)\s+(i|we)\s+(order|ordered)\b/i,
  /\b(status\s+of|where\s+is|check\s+on)\s+(my|our)\s+orders?\b/i,
  /^\s*orders?\s*[?.!]*\s*$/i
];
const FREE_TEXT_STEPS = new Set([
  "AWAITING_FEEDBACK", "AWAITING_QUESTION", "AWAITING_CUSTOM_REQUEST", "AWAITING_ORDER_NOTE",
  "AWAITING_ITEM_NOTE", "AWAITING_LDS_NOTE", "AWAITING_ADDRESS", "AWAITING_NAME"
]);

async function sendMyOrders(from) {
  const orders = require("./orderDb")
    .all()
    .filter((o) => o.customerPhone === from)
    .sort((a, b) => String(b.eventDate || b.createdAt || "").localeCompare(String(a.eventDate || a.createdAt || "")));
  if (!orders.length) {
    return sendButtons(from, {
      body: "You don't have any orders with us yet.",
      buttons: [{ id: "hub:order", title: "Place an order" }, { id: "hub:back", title: "Back to menu" }]
    });
  }
  sessionStore.set(from, { ...sessionStore.getOrCreate(from), step: "AWAITING_MYORDER" });
  const open = orders.filter((o) => !cancelBlock(o)).length;
  return sendList(from, {
    header: "My orders",
    body:
      `You have ${orders.length} order${orders.length === 1 ? "" : "s"} with us` +
      (orders.some((o) => o.source === "past") ? " (including earlier orders Chef added for you)" : "") +
      `.${orders.length > 10 ? " Showing your 10 most recent." : ""}\n\n` +
      `Tap an order to see the details or leave a comment on it` +
      (open ? ` - or cancel it, before the deposit is paid` : "") +
      `.`,
    buttonLabel: "View orders",
    sections: [
      {
        title: "Your orders",
        rows: orders.slice(0, 10).map((o) => ({
          id: `myord:${o.orderId}`,
          title: `${shortWhen(o) || o.orderId}`.slice(0, 24),
          description: `${statusWord(o)} · $${Number(o.subtotal || 0).toFixed(2)} · ${o.orderId}`.slice(0, 72)
        }))
      }
    ]
  });
}

async function sendOneOrder(from, id) {
  const o = require("./orderDb").get(id);
  if (!o || o.customerPhone !== from) return sendMyOrders(from);
  const items =
    o.type === "custom"
      ? `"${o.request || ""}"`
      : o.itemsManual
      ? o.itemsManual
      : (o.cart || []).map(lineLabel).join("\n");
  const body =
    `Order ${o.orderId}\n${statusWord(o)}\n\n${items}\n\nTotal: $${Number(o.subtotal || 0).toFixed(2)}` +
    (o.requestedTime ? `\nWhen: ${o.requestedTime}` : "");
  const canCancel = !cancelBlock(o);
  return sendButtons(from, {
    body: body.slice(0, 1024),
    buttons: canCancel
      ? [{ id: `mycancel:${o.orderId}`, title: "Cancel this order" }, { id: `myfb:${o.orderId}`, title: "Comment on it" }, { id: "hub:myorders", title: "Back to my orders" }]
      : [{ id: `myfb:${o.orderId}`, title: "Comment on it" }, { id: "hub:myorders", title: "Back to my orders" }, { id: "hub:back", title: "Main menu" }]
  });
}

async function askCancelConfirm(from, id) {
  const o = require("./orderDb").get(id);
  const block = !o || o.customerPhone !== from ? "That order wasn't found." : cancelBlock(o);
  if (block) {
    return sendText(from, `${block} If you need to change it, please call ${botMenu().settings.phoneDisplay}.`);
  }
  sessionStore.set(from, { ...sessionStore.getOrCreate(from), step: "AWAITING_MYORDER" });
  return sendButtons(from, {
    body: `Cancel order ${id} ($${Number(o.subtotal || 0).toFixed(2)}${o.requestedTime ? `, ${o.requestedTime}` : ""})?`.slice(0, 1024),
    buttons: [
      { id: `mycancelyes:${id}`, title: "Yes, cancel it" },
      { id: "mykeep", title: "No, keep it" }
    ]
  });
}

/** Customer typed "cancel" outside an order in progress. */
async function handleCancelWord(from) {
  const list = cancellableOrders(from);
  if (!list.length) {
    await sendText(from, `You don't have an order that can be cancelled here. Orders can be cancelled until the deposit is paid - after that, please call ${botMenu().settings.phoneDisplay}.`);
    return true;
  }
  if (list.length === 1) {
    await askCancelConfirm(from, list[0].orderId);
    return true;
  }
  await sendMyOrders(from);
  return true;
}

async function handleMyOrderReply(from, replyId) {
  if (replyId.startsWith("myord:")) return sendOneOrder(from, replyId.slice(6));
  if (replyId.startsWith("mycancel:")) return askCancelConfirm(from, replyId.slice(9));
  if (replyId.startsWith("myfb:")) {
    const o = require("./orderDb").get(replyId.slice(5));
    return askFeedbackText(from, o && o.customerPhone === from ? o.orderId : null);
  }
  if (replyId.startsWith("mycancelyes:")) {
    const id = replyId.slice(12);
    const o = require("./orderDb").get(id);
    if (!o || o.customerPhone !== from) return sendMyOrders(from);
    const r = await cancelOrder(id, "customer");
    sessionStore.clear(from);
    if (!r.ok) return sendText(from, `${r.reason} If you need to change it, please call ${botMenu().settings.phoneDisplay}.`);
    return sendButtons(from, {
      body: `Your order ${id} has been cancelled. Chef has been told.`,
      buttons: [{ id: "hub:order", title: "Place a new order" }, { id: "hub:back", title: "Main menu" }]
    });
  }
  if (replyId === "mykeep") {
    sessionStore.clear(from);
    return sendText(from, "No problem - your order stays as it is.");
  }
  return sendMyOrders(from);
}

// ---------------------------------------------------------------------
// Chef cancels (before the deposit is paid).
// ---------------------------------------------------------------------
async function handleChefCancel(ownerNumber, replyId) {
  const [action, id] = replyId.split(":");
  const o = require("./orderDb").get(id);
  if (action === "ccancel") {
    const block = cancelBlock(o);
    if (block) return sendText(ownerNumber, `Can't cancel: ${block}`);
    return sendButtons(ownerNumber, {
      body: `Cancel order ${id} for ${o.customerName || o.customerPhone} ($${Number(o.subtotal || 0).toFixed(2)})? They'll be told by WhatsApp.`,
      buttons: [
        { id: `ccancelyes:${id}`, title: "Yes, cancel it" },
        { id: `ckeep:${id}`, title: "No, keep it" }
      ]
    });
  }
  if (action === "ccancelyes") {
    const r = await cancelOrder(id, "chef");
    return sendText(ownerNumber, r.ok ? `Order ${id} cancelled - customer told.` : `Can't cancel: ${r.reason}`);
  }
  return sendText(ownerNumber, `OK - order ${id} stays as it is.`);
}

// ---------------------------------------------------------------------
// Comments & suggestions
// ---------------------------------------------------------------------
const FEEDBACK_PROMPT =
  "We'd love to hear from you! Type your comments or suggestions below - about the food, the ordering, or anything you'd like us to offer.";

/** Comments: if they have orders, let them (optionally) pick which one it's about. */
async function startFeedback(from) {
  const orders = require("./orderDb")
    .all()
    .filter((o) => o.customerPhone === from && !/cancelled|declined|released/i.test(o.status || ""))
    .sort((a, b) => String(b.eventDate || b.createdAt || "").localeCompare(String(a.eventDate || a.createdAt || "")))
    .slice(0, 9);
  if (!orders.length) {
    sessionStore.set(from, { ...sessionStore.getOrCreate(from), step: "AWAITING_FEEDBACK", feedbackOrderId: null });
    return sendText(from, FEEDBACK_PROMPT);
  }
  sessionStore.set(from, { ...sessionStore.getOrCreate(from), step: "AWAITING_FEEDBACK_ORDER" });
  return sendList(from, {
    header: "Comments & ideas",
    body: "Thanks for sharing! Is your comment about one of your orders? Pick it, or choose \"General comment\".",
    buttonLabel: "Choose",
    sections: [
      {
        title: "About",
        rows: [
          { id: "fbord:none", title: "General comment", description: "Not about a particular order" },
          ...orders.map((o) => ({
            id: `fbord:${o.orderId}`,
            title: `${shortWhen(o) || o.orderId}`.slice(0, 24),
            description: `${o.orderId} · $${Number(o.subtotal || 0).toFixed(2)}`.slice(0, 72)
          }))
        ]
      }
    ]
  });
}

async function askFeedbackText(from, orderId) {
  sessionStore.set(from, { ...sessionStore.getOrCreate(from), step: "AWAITING_FEEDBACK", feedbackOrderId: orderId || null });
  return sendText(
    from,
    orderId
      ? `Comment on order ${orderId} - type it below. We'd love to hear how it went!`
      : FEEDBACK_PROMPT
  );
}

async function saveFeedback(from, text, orderId) {
  const entry = require("./feedbackStore").add({ phone: from, name: nameFor(from), text, orderId: orderId || null });
  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER;
  if (ownerNumber && process.env.OWNER_HAS_OPTED_IN === "true") {
    await sendText(
      ownerNumber,
      `New comment from ${nameFor(from) || from} (${from})${orderId ? ` about order ${orderId}` : ""}:\n\n"${text}"`.slice(0, 4096)
    ).catch(() => {});
  }
  return entry;
}

// ---------------------------------------------------------------------
// Pre-orders: Dose-in-a-Box and Chef's weekly takeout.
// ---------------------------------------------------------------------
/** For a pre-order summary: where the pickup day stands with this order in it. */
function preorderStatusBlock(session) {
  if (!cartOrderTypes(session.cart || []).hasPreorder || !session.selectedDate) return "";
  const adding = {};
  for (const l of session.cart) if (l.isPreorder) adding[l.id] = (adding[l.id] || 0) + Number(l.qty || 0);
  const lines = preorders.statusLines(botMenu(), session.selectedDate, adding).filter((l) => Object.keys(adding).some((id) => l.startsWith(((session.cart.find((c) => c.id === id) || {}).title || "") + ":")));
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}

function preorderShort(menu) {
  const e = preorders.open(menu)[0];
  return e ? `Order by ${e.orderByLabel} - pickup ${formatDateLabel(e.date)}` : null;
}

function preorderIntro(menu) {
  const days = preorders.open(menu);
  if (!days.length) return "";
  return (
    `Pre-order, pickup only:\n` +
    days.slice(0, 3).map((e) => `- Pickup ${e.pickupLabel} (order by ${e.orderByLabel})`).join("\n")
  );
}

async function startPreorder(from, menu) {
  const cats = menu.categories.filter((c) => c.type === "preorder" && (c.items || []).length);
  const days = preorders.open(menu);
  if (!cats.length || !days.length) {
    return sendText(
      from,
      `Dose-in-a-Box isn't open for orders right now - Chef opens it on select weeks. Send "hi" to see what's available, or call ${menu.settings.phoneDisplay}.`
    );
  }
  const session = { ...sessionStore.getOrCreate(from), cart: [], eventDate: null, selectedDate: null, fulfillment: "pickup" };
  if (cats.length === 1) {
    sessionStore.set(from, { ...session, step: "AWAITING_ITEM", itemCategoryId: cats[0].id });
    return sendCategoryItems(from, cats[0], preorderIntro(menu));
  }
  sessionStore.set(from, { ...session, step: "AWAITING_CATEGORY" });
  return sendList(from, {
    header: "Pre-order",
    body: `${preorderIntro(menu)}\n\nWhat would you like?`.slice(0, 1024),
    buttonLabel: "View",
    sections: cats.map((c) => ({
      title: c.title.slice(0, 24),
      rows: [{ id: `cat:${c.id}`, title: (c.rowTitle || c.title).slice(0, 24), description: (c.rowDescription || "").slice(0, 72) }]
    }))
  });
}

/** Typed "11/7 pickup at 11:30 AM" from the main menu: jump straight in. */
async function typedDateShortcut(from, menu, text) {
  const req = parseOrderRequest(text);
  if (!req.date) return false;
  sessionStore.set(from, { ...sessionStore.getOrCreate(from), cart: [], step: "AWAITING_EVENT_DATE" });
  await chooseEventDate(from, menu, req.date, req);
  return true;
}

async function handleIncoming(payload) {
  // A plain-text numbered menu was sent because WhatsApp refused the
  // buttons/list; "2" means the second option.
  if (payload.message_type === "text") {
    const picked = typeof choiceFromNumber === "function" ? choiceFromNumber(payload.from, payload.text || "") : null;
    if (picked) payload = { ...payload, message_type: "reply", text: null, reply: { id: picked.id, title: picked.title } };
  }
  const from = payload.from;
  const isText = payload.message_type === "text";
  const isReply = payload.message_type === "reply";
  const text = isText ? (payload.text || "").trim() : null;
  const reply = isReply ? payload.reply : null;
  const replyId = reply ? reply.id : null;

  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER;

  // Chef's Payment received / Not received buttons.
  if (from === ownerNumber && replyId && /^(paid|unpaid):/.test(replyId)) {
    const [action, id] = replyId.split(":");
    return payments.handleOwnerPaymentReply(ownerNumber, action, id);
  }

  // Chef has a chat open with this customer: their messages go to Chef.
  if (from !== ownerNumber && (await relayCustomerMessage(from, isText, text, isReply))) return;

  // Pictures: Zelle payment screenshots.
  if (payload.message_type === "image" && from !== ownerNumber) {
    return payments.handleCustomerImage(from, payload.image || {});
  }

  // Chef cancelling an approved order before the deposit.
  if (from === ownerNumber && replyId && /^(ccancel|ccancelyes|ckeep):/.test(replyId)) {
    return handleChefCancel(ownerNumber, replyId);
  }
  if (from === ownerNumber && isText && /^cancel\s+(FTR|CUST)-[A-Z0-9]+$/i.test(text)) {
    return handleChefCancel(ownerNumber, "ccancel:" + text.split(/\s+/)[1].toUpperCase());
  }

  // Chef's Allow / Decline for an out-of-range LIVE Dose address.
  if (from === ownerNumber && replyId && /^range(ok|no):/.test(replyId)) {
    const phone = replyId.split(":")[1];
    const status = await decideRange(phone, replyId.startsWith("rangeok:"));
    return sendText(ownerNumber, status);
  }

  const isOwnerActionReply =
    replyId &&
    (replyId.startsWith("approve:") ||
      replyId.startsWith("decline:") ||
      replyId.startsWith("editprice:") ||
      replyId.startsWith("edp:") ||
      replyId.startsWith("edt:") ||
      replyId.startsWith("msg:") ||
      replyId.startsWith("chatend:") ||
      replyId.startsWith("cquote:") ||
      replyId.startsWith("cdecline:"));
  const isOwnerMidEdit = ownerState.get(ownerNumber) && (isText || isReply);

  if (from === ownerNumber && (isOwnerActionReply || isOwnerMidEdit)) {
    return handleOwnerReply(payload);
  }

  // New customers give their name before anything else.
  if (await handleNameCapture(from, isText, text)) return;

  const prior = sessionStore.get(from);
  const away = prior && Date.now() - (prior.updatedAt || 0) > RESUME_AFTER_MS;

  // "I paid" etc. while a deposit is open (and they're not mid-order).
  if (isText && (!inProgress(prior) || away) && (await payments.maybeHandlePaymentText(from, text))) return;

  // My orders / cancelling.
  if (replyId && (replyId === "hub:myorders" || /^(myord|mycancel|mycancelyes|myfb):/.test(replyId) || replyId === "mykeep")) {
    return replyId === "hub:myorders" ? sendMyOrders(from) : handleMyOrderReply(from, replyId);
  }
  if (isText && /^(cancel|cancel (my )?order)$/i.test(text) && (!inProgress(prior) || away)) {
    return handleCancelWord(from);
  }
  // Typed "my orders", "show my orders", "order history"... (not while they're
  // typing an answer, and not in the middle of building an order).
  if (isText && MY_ORDERS_WORDS.some((re) => re.test(text)) && !FREE_TEXT_STEPS.has(prior?.step) && (!(prior?.cart || []).length || away)) {
    return sendMyOrders(from);
  }

  // Continue / Start over.
  if (replyId === "resume:yes" || replyId === "resume:no") {
    if (replyId === "resume:no" || !inProgress(prior)) {
      sessionStore.clear(from);
      return sendWelcome(from, replyId === "resume:no" ? false : true);
    }
    const { resumeOffered, ...rest } = prior;
    sessionStore.set(from, rest);
    return repromptStep(from, rest, botMenu());
  }

  // Back after a break with an order in progress: ask before carrying on
  // (button taps on the earlier messages just continue as normal).
  if (isText && away && inProgress(prior)) {
    return offerResume(from, prior, botMenu());
  }
  // Typed something instead of tapping Continue / Start over.
  if (isText && prior?.resumeOffered && !RESTART_WORDS.test(text)) {
    const { resumeOffered, ...rest } = prior;
    sessionStore.set(from, rest);
  }

  if (isText && RESTART_WORDS.test(text)) {
    sessionStore.clear(from);
    return sendWelcome(from);
  }

  const session = sessionStore.getOrCreate(from);
  const menu = botMenu();

  // The browse view and hub can be re-entered from a few different
  // steps, so handle those choices before the per-step switch.
  if (replyId === "hub:back") {
    sessionStore.clear(from);
    return sendWelcome(from, false);
  }
  if (replyId === "hub:order") {
    return startDateFirst(from, menu);
  }
  if (replyId === "hub:preorder") {
    return startPreorder(from, menu);
  }

  if (replyId && (replyId.startsWith("caccept:") || replyId.startsWith("creject:"))) {
    return handleQuoteResponse(from, replyId);
  }

  switch (session.step) {
    case "NEW": {
      if (isText && (await typedDateShortcut(from, menu, text))) return;
      return sendWelcome(from);
    }

    case "AWAITING_HUB_CHOICE": {
      if (isText && (await typedDateShortcut(from, menu, text))) return;
      if (replyId === "hub:browse") {
        return sendMenuOverview(from);
      }
      if (replyId === "hub:feedback") {
        return startFeedback(from);
      }
      if (replyId === "hub:question") {
        sessionStore.set(from, { ...session, step: "AWAITING_QUESTION" });
        return sendText(
          from,
          "Sure - what's your question? Type it below and we'll get back to you as soon as we can."
        );
      }
      if (replyId === "hub:custom") {
        sessionStore.set(from, { ...session, step: "AWAITING_CUSTOM_REQUEST" });
        return sendText(from, CUSTOM_REQUEST_PROMPT);
      }
      if (replyId === "hub:call") {
        await sendText(
          from,
          `You can reach us at ${menu.settings.phoneDisplay}. We're happy to talk through your event.`
        );
        return sendWelcome(from, false);
      }
      return sendWelcome(from, false);
    }

    case "AWAITING_CUSTOM_REQUEST": {
      if (isText && text.length > 0) {
        sessionStore.clear(from);
        return submitCustomRequest(from, text, menu);
      }
      return sendText(from, CUSTOM_REQUEST_PROMPT);
    }

    case "AWAITING_MYORDER": {
      return sendMyOrders(from);
    }

    case "AWAITING_FEEDBACK_ORDER": {
      if (replyId && replyId.startsWith("fbord:")) {
        const id = replyId.slice(6);
        const o = id === "none" ? null : require("./orderDb").get(id);
        return askFeedbackText(from, o && o.customerPhone === from ? id : null);
      }
      if (isText && text.length > 0) {
        // Typed straight away - keep it as a general comment.
        await saveFeedback(from, text, null);
        sessionStore.clear(from);
        return sendText(from, `Thank you for your feedback! Chef reads every comment. Send "hi" any time to see the menu.`);
      }
      return startFeedback(from);
    }

    case "AWAITING_FEEDBACK": {
      if (isText && text.length > 0) {
        await saveFeedback(from, text, session.feedbackOrderId);
        sessionStore.clear(from);
        return sendText(from, `Thank you for your feedback! Chef reads every comment. Send "hi" any time to see the menu.`);
      }
      return sendText(from, "Please type your comments as a message.");
    }

    case "AWAITING_QUESTION": {
      if (isText && text.length > 0) {
        const ownerNum = process.env.OWNER_WHATSAPP_NUMBER;
        const ownerOptedIn = process.env.OWNER_HAS_OPTED_IN === "true";
        if (ownerNum && ownerOptedIn) {
          await sendText(
            ownerNum,
            `Question from ${nameFor(from) || "customer"} (${from}):\n\n"${text}"\n\nReply to them directly at that number.`
          ).catch((err) =>
            console.error("Failed to forward customer question to owner:", err.message)
          );
        } else {
          console.warn(`Unforwarded customer question from ${from}: ${text}`);
        }
        await sendText(
          from,
          `Thanks - we've passed your question along and will get back to you soon. If it's urgent, give us a call at ${menu.settings.phoneDisplay}.`
        );
        sessionStore.clear(from);
        return sendWelcome(from, false);
      }
      return sendText(from, "Please type your question as a message.");
    }

    case "AWAITING_EVENT_DATE": {
      if (replyId && replyId.startsWith("evdate:")) {
        return chooseEventDate(from, menu, replyId.slice(7));
      }
      if (replyId === "evagain") {
        return sendEventDateList(from, menu);
      }
      if (replyId === "hub:custom") {
        sessionStore.set(from, { ...sessionStore.getOrCreate(from), step: "AWAITING_CUSTOM_REQUEST" });
        return sendText(from, CUSTOM_REQUEST_PROMPT);
      }
      if (isText && text.length > 0) {
        const req = parseOrderRequest(text);
        if (!req.date) {
          return sendText(from, `Sorry, I couldn't read that date. Try something like "11/7 pickup at 11:30 AM" or "Nov 14", or pick one from the list above.`);
        }
        return chooseEventDate(from, menu, req.date, req);
      }
      return sendEventDateList(from, menu);
    }

    case "AWAITING_CATEGORY": {
      if (replyId && replyId.startsWith("cat:")) {
        const category = findCategory(menu, replyId.slice(4));
        if (category) {
          // Catches taps on an older menu card that still showed the
          // other order type.
          const allowed = categoriesAllowedForCart(menu, session.cart, session.eventDate);
          if (!allowed.some((c) => c.id === category.id)) {
            await sendText(from, MIXED_ORDER_MESSAGE);
            if (cartOrderTypes(session.cart).hasLiveDose) {
              return proceedToCheckout(from, session, menu);
            }
            if (session.cart.length > 0) {
              sessionStore.set(from, { ...session, step: "AWAITING_ADD_MORE" });
              return sendAddMorePrompt(from);
            }
            return sendMainMenu(from, false);
          }
          if (category.type === "live-dose-station") {
            sessionStore.set(from, {
              ...session,
              step: "AWAITING_LDS_TOTAL",
              ldsCategoryId: category.id
            });
            return sendLiveDoseTotalPrompt(from, category);
          }
          if (category.type === "preorder") {
            sessionStore.set(from, { ...session, step: "AWAITING_ITEM", itemCategoryId: category.id });
            return sendCategoryItems(from, category, preorderIntro(menu));
          }
          if (pickupOnly(menu) && !session.pickupAgreed) {
            return askPickupAgreement(from, session, menu, category);
          }
          sessionStore.set(from, { ...session, step: "AWAITING_ITEM", itemCategoryId: category.id });
          return sendCategoryItems(from, category);
        }
      }
      return sendText(
        from,
        `Sorry, I didn't catch that - please pick an option from the list above, or type "menu" to see it again.`
      );
    }

    case "AWAITING_ITEM": {
      if (replyId && replyId.startsWith("more:")) {
        const [, catId, pg] = replyId.split(":");
        const cat = findCategory(menu, catId);
        if (cat) return sendCategoryItems(from, cat, "", Number(pg) || 0);
      }
      if (replyId && replyId.startsWith("item:")) {
        const item = findItem(menu, replyId.slice(5));
        if (item) {
          sessionStore.set(from, {
            ...session,
            step: "AWAITING_QTY",
            pendingItem: item
          });
          return sendQtyPrompt(from, item, menu);
        }
      }
      return sendText(
        from,
        `Please pick an item from the list, or type "menu" to start over.`
      );
    }

    case "AWAITING_QTY": {
      if (isText && DESCRIBE_WORDS.test(text)) {
        const item = session.pendingItem;
        await sendText(
          from,
          item?.description
            ? `${item.title}: ${item.description}`
            : `No extra details on file for this item yet.`
        );
        return sendQtyPrompt(from, item, menu);
      }
      let qty = null;
      // Pre-order items (Dose-in-a-Box, takeout) are whole portions.
      const half = halfTraysOn(menu) && !(session.pendingItem && session.pendingItem.isPreorder);
      if (replyId && replyId.startsWith("qty:")) {
        qty = Number(replyId.slice(4));
      } else if (isText) {
        qty = parseQty(text);
      }
      // Only whole trays when half trays are off; only half steps when on.
      if (qty != null && !(qty > 0)) qty = null;
      if (qty != null && !half && !Number.isInteger(qty)) {
        return sendText(from, `Sorry, we're only taking full trays right now. Please enter a whole number, like "1" or "2".`);
      }
      if (qty != null && half && !Number.isInteger(qty * 2)) {
        return sendText(from, `Please enter whole or half trays, like "0.5", "1" or "1.5".`);
      }
      const item = session.pendingItem;
      const min = effectiveMinQty(menu, item || {});
      const max = effectiveMaxQty(menu, item || {});
      if (qty && qty > max) {
        await sendText(
          from,
          `For orders of ${item.title} larger than ${max}, please call us directly at ${menu.settings.phoneDisplay} so we can plan properly.`
        );
        return sendQtyPrompt(from, item, menu);
      }
      if (qty && qty >= min) {
        if (item.requiresNote) {
          sessionStore.set(from, {
            ...session,
            pendingItem: item,
            pendingQty: qty,
            step: "AWAITING_ITEM_NOTE"
          });
          return sendItemNotePrompt(from, item);
        }
        // No per-dish note question - customers can add one note for the
        // whole order at the summary (fewer messages).
        return addLineToCart(from, session, menu, item, qty, null);
      }
      return sendText(
        from,
        qty
          ? `The minimum for this item is ${fmtQty(min)}. Please enter ${fmtQty(min)} or more.`
          : half
          ? `Please enter a valid quantity, like "0.5" for a half tray or "2".`
          : `Please enter a valid quantity, like "2".`
      );
    }

    case "AWAITING_ITEM_NOTE": {
      const item = session.pendingItem;
      if (!isText || text.length === 0) {
        return sendItemNotePrompt(from, item);
      }
      if (item.requiresNote && SKIP_WORDS.test(text)) {
        await sendText(
          from,
          `Sorry, we need this detail for "${item.title}" to prepare your order.`
        );
        return sendItemNotePrompt(from, item);
      }
      const note = SKIP_WORDS.test(text) ? null : text;
      return addLineToCart(from, session, menu, item, session.pendingQty, note);
    }

    case "AWAITING_LDS_TOTAL": {
      const category = findCategory(menu, session.ldsCategoryId);
      if (replyId && replyId.startsWith("ldstotal:") && category) {
        const total = parseInt(replyId.slice(9), 10);
        sessionStore.set(from, {
          ...session,
          ldsTotal: total,
          step: "AWAITING_LDS_SPLIT"
        });
        return sendLiveDoseSplitPrompt(from, category, total);
      }
      return category
        ? sendLiveDoseTotalPrompt(from, category)
        : sendMainMenu(from, false);
    }

    case "AWAITING_LDS_SPLIT": {
      const category = findCategory(menu, session.ldsCategoryId);
      if (replyId && replyId.startsWith("ldssplit:") && category) {
        const mdQty = parseInt(replyId.slice(9), 10);
        const odQty = session.ldsTotal - mdQty;
        sessionStore.set(from, {
          ...session,
          ldsMdQty: mdQty,
          ldsOdQty: odQty,
          step: "AWAITING_LDS_NOTE"
        });
        return sendLiveDoseNotePrompt(from);
      }
      return category
        ? sendLiveDoseSplitPrompt(from, category, session.ldsTotal)
        : sendMainMenu(from, false);
    }

    case "AWAITING_LDS_NOTE": {
      if (!isText || text.length === 0) {
        return sendLiveDoseNotePrompt(from);
      }
      const category = findCategory(menu, session.ldsCategoryId);
      const lds = category?.liveDoseStation;
      if (!lds) {
        sessionStore.set(from, { ...session, step: "AWAITING_ADD_MORE" });
        return sendAddMorePrompt(from);
      }
      const note = SKIP_WORDS.test(text) ? null : text;
      const price = (session.ldsTotal * lds.pricePerHundred) / 100 + lds.setupFee;
      const cart = [
        ...session.cart,
        {
          id: `${category.id}-order`,
          title: "LIVE Dose Station",
          isLiveDoseStation: true,
          mdQty: session.ldsMdQty,
          odQty: session.ldsOdQty,
          setupFee: lds.setupFee,
          qty: 1,
          price,
          note
        }
      ];
      const updated = {
        ...session,
        cart,
        ldsCategoryId: null,
        ldsTotal: null,
        ldsMdQty: null,
        ldsOdQty: null,
        step: "AWAITING_ADD_MORE"
      };
      sessionStore.set(from, updated);
      // Nothing else can join an LDS order, so skip "add more".
      return proceedToCheckout(from, updated, menu);
    }

    case "AWAITING_ADD_MORE": {
      if (replyId === "addmore:yes") {
        // Only one menu they can add from? Go straight to its dishes.
        const allowed = categoriesAllowedForCart(menu, session.cart, session.eventDate).filter(
          (c) => c.type !== "live-dose-station"
        );
        if (allowed.length === 1 && (allowed[0].items || []).length) {
          sessionStore.set(from, { ...session, step: "AWAITING_ITEM", itemCategoryId: allowed[0].id });
          return sendCategoryItems(from, allowed[0]);
        }
        sessionStore.set(from, { ...session, step: "AWAITING_CATEGORY" });
        return sendMainMenu(from, false);
      }
      if (replyId === "addmore:no") {
        return proceedToCheckout(from, session, menu);
      }
      return sendAddMorePrompt(from);
    }

    case "AWAITING_FULFILLMENT": {
      if (replyId === "fulfillment:delivery") {
        return askAddress(from, { ...session, fulfillment: "delivery" }, DELIVERY_ADDRESS_PROMPT);
      }
      if (replyId === "fulfillment:pickup") {
        const updated = { ...session, fulfillment: "pickup" };
        const hasDates = await sendDatePrompt(from, menu, updated);
        sessionStore.set(from, {
          ...updated,
          step: dateStep(hasDates)
        });
        return;
      }
      return askFulfillment(from, session, menu);
    }

    case "AWAITING_ADDRESS_CHOICE": {
      const profile = customerStore.get(from);
      if (replyId === "addr:saved" && profile?.address) {
        const point =
          typeof profile.addressLat === "number" ? { lat: profile.addressLat, lon: profile.addressLon } : null;
        const miles = distanceFromKitchen(menu, point);
        if (await outsideArea(from, session, menu, profile.address, miles, point ? { label: profile.address, ...point } : null)) return;
        return afterAddress(
          from,
          { ...session, address: profile.address, addressVerified: !!profile.addressVerified, distanceMiles: miles },
          menu
        );
      }
      if (replyId === "addr:new") {
        sessionStore.set(from, { ...session, step: "AWAITING_ADDRESS" });
        return sendText(from, "Please type the full address (street, town, ZIP).");
      }
      return askAddress(from, session, session.addressPrompt || DELIVERY_ADDRESS_PROMPT);
    }

    case "AWAITING_ADDRESS": {
      if (isText && text.length > 0) {
        return checkTypedAddress(from, session, menu, text);
      }
      return sendText(from, "Please send the delivery address as text.");
    }

    case "AWAITING_ADDRESS_CONFIRM": {
      if (replyId && replyId.startsWith("addrok:")) {
        const match = (session.addrMatches || [])[parseInt(replyId.slice(7), 10)];
        if (match) return acceptVerifiedAddress(from, session, menu, match);
      }
      if (replyId === "addr:retry") {
        sessionStore.set(from, { ...session, step: "AWAITING_ADDRESS", addrMatches: null });
        return sendText(from, addrRetryPrompt());
      }
      if (isText && text.length > 0) {
        return checkTypedAddress(from, session, menu, text);
      }
      return sendText(from, "Please tap one of the options above, or type the address again.");
    }

    case "AWAITING_ADDRESS_NOTFOUND": {
      if (replyId === "addr:asis" && session.typedAddress) {
        const typed = session.typedAddress;
        customerStore.save(from, { address: typed, addressLat: null, addressLon: null, addressVerified: false });
        return afterAddress(
          from,
          { ...session, address: typed, addressVerified: false, distanceMiles: null, typedAddress: null },
          menu
        );
      }
      if (replyId === "addr:retry") {
        sessionStore.set(from, { ...session, step: "AWAITING_ADDRESS" });
        return sendText(from, addrRetryPrompt());
      }
      if (isText && text.length > 0) {
        return checkTypedAddress(from, session, menu, text);
      }
      return sendText(from, "Please tap one of the options above, or type the address again.");
    }

    case "AWAITING_PICKUP_AGREE": {
      return handlePickupAgreement(from, session, menu, replyId);
    }

    case "AWAITING_ORDER_NOTE": {
      if (!isText) return sendText(from, `Please type your note, or "skip".`);
      const updated = { ...session, orderNote: SKIP_WORDS.test(text) ? null : text.slice(0, 500), step: "AWAITING_CONFIRM" };
      sessionStore.set(from, updated);
      return sendOrderSummary(from, updated);
    }

    case "AWAITING_LDS_EXTEND": {
      return handleLdsExtension(from, session, menu, replyId);
    }

    case "AWAITING_RANGE_APPROVAL": {
      if (replyId === "out:cancel") {
        sessionStore.clear(from);
        return sendText(from, `No problem - your order wasn't submitted. Send "hi" any time to start again.`);
      }
      return sendButtons(from, {
        body: `Still waiting to hear back from Chef about ${session.outside?.label || "your address"}. You can also call Chef at ${menu.settings.phoneDisplay}.`,
        buttons: [{ id: "out:cancel", title: "Cancel order" }]
      });
    }

    case "AWAITING_ADDRESS_OUTSIDE": {
      if (replyId === "out:askchef") {
        return askChefAboutRange(from, session, menu);
      }
      if (replyId === "out:pickup") {
        const updated = { ...session, fulfillment: "pickup", address: null, distanceMiles: null };
        const hasDates = await sendDatePrompt(from, menu, updated);
        sessionStore.set(from, { ...updated, step: dateStep(hasDates) });
        return;
      }
      if (replyId === "out:retry") {
        sessionStore.set(from, { ...session, step: "AWAITING_ADDRESS" });
        return sendText(from, addrRetryPrompt());
      }
      if (replyId === "out:cancel") {
        sessionStore.clear(from);
        return sendText(from, `No problem - your order wasn't submitted. Send "hi" any time to start again.`);
      }
      if (isText && text.length > 0) {
        return checkTypedAddress(from, session, menu, text);
      }
      return sendText(from, "Please tap one of the options above.");
    }

    case "AWAITING_DATE_NONE": {
      if (replyId === "nodates:cancel") {
        sessionStore.clear(from);
        return sendText(
          from,
          `No problem - your order wasn't submitted. Type "menu" any time to start over.`
        );
      }
      const hasDates = await sendDatePrompt(from, menu, session);
      sessionStore.set(from, {
        ...session,
        step: dateStep(hasDates)
      });
      return;
    }

    case "AWAITING_DATE": {
      if (replyId === "nodates:cancel") {
        sessionStore.clear(from);
        return sendText(
          from,
          `No problem - your order wasn't submitted. Type "menu" any time to start over.`
        );
      }
      if (replyId && replyId.startsWith("date:")) {
        const dateStr = replyId.slice(5);
        const dateEntry = findDateEntry(menu, dateStr);
        if (!dateEntry) {
          const hasDates = await sendDatePrompt(from, menu, session);
          sessionStore.set(from, {
            ...session,
            step: dateStep(hasDates)
          });
          return;
        }
        const hasSlots = await sendSlotPrompt(from, menu, dateEntry, session);
        if (!hasSlots) {
          const hasDates = await sendDatePrompt(from, menu, session);
          sessionStore.set(from, {
            ...session,
            step: dateStep(hasDates)
          });
          return;
        }
        sessionStore.set(from, {
          ...session,
          selectedDate: dateStr,
          step: "AWAITING_SLOT"
        });
        return;
      }
      const hasDates = await sendDatePrompt(from, menu, session);
      sessionStore.set(from, {
        ...session,
        step: dateStep(hasDates)
      });
      return;
    }

    case "AWAITING_SLOT": {
      if (replyId === "slotlist") {
        const updated = { ...session, prefer: null };
        sessionStore.set(from, updated);
        const dateEntry = findDateEntry(menu, updated.selectedDate);
        if (dateEntry) return sendSlotPrompt(from, menu, dateEntry, updated);
      }
      if (replyId === "slot:preorder") {
        const e = preorders.openEntry(menu, session.selectedDate);
        if (!e) {
          await sendText(from, `Sorry - orders for that pickup day have closed. Please pick another day.`);
          const hasDates = await sendDatePrompt(from, menu, session);
          sessionStore.set(from, { ...session, step: dateStep(hasDates) });
          return;
        }
        const full = preorders.capacityProblem(menu, session.selectedDate, session.cart);
        if (full) {
          await sendText(from, full);
          return startPreorder(from, menu);
        }
        const requestedTime = `${formatDateLabel(session.selectedDate)}, pickup at ${formatTimeLabel(e.pickupTime)} (pre-order)`;
        const updated = { ...session, fulfillment: "pickup", requestedTime, step: "AWAITING_CONFIRM" };
        sessionStore.set(from, updated);
        return sendOrderSummary(from, updated);
      }
      if (replyId === "slot:pickup-am" || replyId === "slot:pickup-pm") {
        const dateEntry = findDateEntry(menu, session.selectedDate);
        const isAM = replyId === "slot:pickup-am";
        if (!dateEntry || !(isAM ? dateEntry.pickupAM : dateEntry.pickupPM)) {
          const hasDates = await sendDatePrompt(from, menu, session);
          sessionStore.set(from, { ...session, step: dateStep(hasDates) });
          return;
        }
        const pt = pickupTimes(menu);
        const requestedTime = `${formatDateLabel(session.selectedDate)}, pickup by ${formatTimeLabel(
          isAM ? pt.am : pt.pm
        )} (${isAM ? "lunch" : "dinner"})`;
        const updated = { ...session, requestedTime, step: "AWAITING_CONFIRM" };
        sessionStore.set(from, updated);
        return sendOrderSummary(from, updated);
      }
      if (replyId && replyId.startsWith("slot:")) {
        const [slotStart, slotEnd] = replyId.slice(5).split("-");
        let requestedTime = `${formatDateLabel(session.selectedDate)}, ${formatTimeLabel(
          slotStart
        )} - ${formatTimeLabel(slotEnd)}`;

        const ldsTotal = liveDoseTotalInCart(session.cart);
        if (ldsTotal) {
          return offerLdsExtension(from, { ...session, ldsSession: { start: slotStart, end: slotEnd } }, menu);
        }

        const updated = { ...session, requestedTime, step: "AWAITING_CONFIRM" };
        sessionStore.set(from, updated);
        return sendOrderSummary(from, updated);
      }
      const dateEntry = findDateEntry(menu, session.selectedDate);
      if (!dateEntry) {
        const hasDates = await sendDatePrompt(from, menu, session);
        sessionStore.set(from, {
          ...session,
          step: dateStep(hasDates)
        });
        return;
      }
      await sendSlotPrompt(from, menu, dateEntry, session);
      return;
    }

    case "AWAITING_CONFIRM": {
      if (replyId === "confirm:yes" && cartOrderTypes(session.cart).hasPreorder) {
        // Someone else may have taken the last boxes while they were deciding.
        const full = !preorders.openEntry(menu, session.selectedDate)
          ? "Sorry - orders for that pickup day have just closed."
          : preorders.capacityProblem(menu, session.selectedDate, session.cart);
        if (full) {
          await sendText(from, full);
          return startPreorder(from, menu);
        }
      }
      if (replyId === "confirm:yes") {
        const finalSession = session;
        sessionStore.clear(from);
        return requestApproval(from, finalSession);
      }
      if (replyId === "confirm:note") {
        sessionStore.set(from, { ...session, step: "AWAITING_ORDER_NOTE" });
        return sendText(from, `Type your note for Chef (spice level, allergies, anything about the dishes), or "skip".`);
      }
      if (replyId === "confirm:no") {
        sessionStore.clear(from);
        return sendText(
          from,
          `No problem, your order was cancelled. Type "menu" any time to start a new order.`
        );
      }
      return sendOrderSummary(from, session);
    }

    default: {
      sessionStore.clear(from);
      return sendMainMenu(from);
    }
  }
}

module.exports = {
  handleIncoming,
  decideRange,
  rangeRequests,
  cancelOrder,
  cancelBlock,
  _parseTypedDate: (t) => parseTypedDate(t),
  _parseOrderRequest: (t) => parseOrderRequest(t),
  // Shared with the iOS app API (src/appApi.js) so app orders follow
  // exactly the same menu, pricing, availability and approval rules.
  shared: {
    BOOKING_WINDOW_DAYS,
    botMenu,
    orderId,
    nameFor,
    paymentSentence,
    pickupAgreementText,
    upcomingDates,
    findDateEntry,
    timeOptionsFor,
    cateringFulfillmentOptions,
    categoriesAllowedForCart,
    halfTraysOn,
    effectiveMinQty,
    effectiveMaxQty,
    orderMinimum,
    trayTotal,
    fmtQty,
    cartSubtotal,
    lineLabel,
    liveDoseConfig,
    deliverySettings,
    distanceFromKitchen,
    ldsTravelFee,
    ldsTravelRule,
    formatDateLabel,
    windowLabel,
    sendApprovalPrompt,
    submitCustomRequest,
    handleQuoteResponse,
    // Chef <-> customer chat and LIVE Dose session wording, for app customers.
    relayCustomerMessage,
    chatFor,
    extraDoseText,
    ldsTimesText,
    parseChefTime,
    // Comments, and cancelling before the deposit is paid.
    saveFeedback,
    cancelOrder,
    cancelBlock,
    cartOrderTypes
  }
};
