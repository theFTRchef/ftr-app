/**
 * Customer API for the Franklin Tiffin Room iOS app.  Mounted at /api/v1.
 *
 * The app is a second front door to the SAME kitchen: it reads the same
 * menu and chef dates (data/menu.json, edited in /admin), and every order
 * it places goes through the same steps as a WhatsApp order:
 *   orders.json + Google Sheet row (records.js) -> Chef's Approve / Edit
 *   price / Decline prompt on WhatsApp -> Zelle deposit -> Confirmed.
 * Prices, minimums, half trays, travel fees, slots and the requested-time
 * text are all worked out here on the server with the bot's own functions,
 * never trusted from the phone.
 */
const { promoActive } = require("./menuStore");
const express = require("express");
const menuStore = require("./menuStore");
const customerStore = require("./customerStore");
const orderDb = require("./orderDb");
const pendingOrderStore = require("./pendingOrderStore");
const records = require("./records");
const payments = require("./payments");
const appUsers = require("./appUsers");
const appInbox = require("./appInbox");
const phoneVerify = require("./phoneVerify");
const appCarts = require("./appCarts");
const { verifyAddress } = require("./geocode");
const { itemsText } = require("./sheets");
const { paymentText, deadlineLabel } = require("./paymentText");
const { pickupTimes, offersCatering, offersLiveDose, pickupOnly, ldsSessions, ldsExtension } = require("./availability");
const { formatTimeLabel } = require("./timeUtils");
const preorders = require("./preorders");
const { sendText } = require("./messaging");

const flow = () => require("./orderFlow").shared;

class ApiError extends Error {
  constructor(status, message, code = null, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// ------------------------------------------------------------------ helpers

/** "(908) 555-1234" / "+1 908 555 1234" -> "19085551234" (the bot's format). */
function normalizePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10) d = "1" + d;
  if (d.length === 11 && d[0] === "1") return d;
  if (d.length >= 11 && d.length <= 15 && process.env.APP_ALLOW_INTERNATIONAL === "true") return d;
  return null;
}

function money2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

const limits = new Map(); // key -> { n, until }
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const e = limits.get(key);
  if (!e || e.until < now) {
    limits.set(key, { n: 1, until: now + windowMs });
    if (limits.size > 5000) limits.clear();
    return;
  }
  e.n += 1;
  if (e.n > max) throw new ApiError(429, "Too many tries - please wait a few minutes and try again.");
}

function ip(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
}

const wrap = (fn) => (req, res) =>
  Promise.resolve()
    .then(() => fn(req, res))
    .catch((err) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
    }
    console.error(`App API ${req.method} ${req.path} failed:`, err);
    res.status(500).json({ error: "Something went wrong on our side. Please try again." });
  });

function requireUser(req, res, next) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  const phone = m ? appUsers.phoneForToken(m[1].trim()) : null;
  if (!phone) return res.status(401).json({ error: "Please sign in again.", code: "signed_out" });
  req.phone = phone;
  req.token = m[1].trim();
  next();
}

/** The owner's WhatsApp number (and any APP_ADMIN_PHONES) can open Chef's Kitchen in the app. */
function isAdminPhone(phone) {
  const list = [process.env.OWNER_WHATSAPP_NUMBER, ...String(process.env.APP_ADMIN_PHONES || "").split(",")]
    .map((p) => normalizePhone(p))
    .filter(Boolean);
  return list.includes(phone);
}

function profileFor(phone) {
  const p = customerStore.get(phone) || {};
  return {
    phone,
    phoneDisplay: phone.length === 11 ? `(${phone.slice(1, 4)}) ${phone.slice(4, 7)}-${phone.slice(7)}` : `+${phone}`,
    firstName: p.firstName || "",
    lastName: p.lastName || "",
    savedAddress: p.address || null,
    needsName: !p.firstName,
    isAdmin: isAdminPhone(phone),
    announcementAlerts: !!(appUsers.get(phone) || {}).announcementAlerts,
    unread: appInbox.unreadCount(phone)
  };
}

function cleanName(s) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 40 || !/[a-zA-Z]/.test(t)) return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "1-234-FTR-DOSE (387-3673)" -> "12343873673" (letters as on a phone keypad). */
function dialable(display) {
  if (process.env.APP_CALL_NUMBER) return String(process.env.APP_CALL_NUMBER).replace(/[^\d+]/g, "");
  const keypad = { abc: 2, def: 3, ghi: 4, jkl: 5, mno: 6, pqrs: 7, tuv: 8, wxyz: 9 };
  const main = String(display || "").replace(/\(.*?\)/g, "");
  const digits = main
    .toLowerCase()
    .split("")
    .map((ch) => {
      if (/\d/.test(ch)) return ch;
      const k = Object.keys(keypad).find((g) => g.includes(ch));
      return k ? String(keypad[k]) : "";
    })
    .join("");
  return digits.length >= 10 ? digits : null;
}

function ldsCategory(menu) {
  return (menu.categories || []).find((c) => c.type === "live-dose-station") || null;
}

/** "18:30" from minutes after midnight. */
function hhmm(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function minutesOf(t) {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + (m || 0);
}

/** The LIVE Dose on-site sessions, extra-time offer and extra-dose note (Setup > Standard times). */
function ldsTimes(menu) {
  const f = flow();
  const lds = f.liveDoseConfig(menu) || {};
  const ext = ldsExtension(menu);
  return {
    sessions: ldsSessions(menu).map((w) => ({
      start: w.start,
      end: w.end,
      label: w.label,
      title: `${formatTimeLabel(w.start)} - ${formatTimeLabel(w.end)}`
    })),
    extraTime: { minutes: ext.minutes, fee: ext.fee },
    extraDoseNote: f.extraDoseText(lds),
    setupMinutes: Number(lds.setupMinutes) > 0 ? Number(lds.setupMinutes) : 30
  };
}

function shortTime(t) {
  return formatTimeLabel(t).replace(":00 ", " ");
}

// ------------------------------------------------------------------ public: menu & dates

/** Changes whenever the admin page saves the menu/settings (file time), so the app can tell. */
function menuVersion() {
  try {
    return String(Math.floor(require("fs").statSync(require("path").join(__dirname, "..", "data", "menu.json")).mtimeMs));
  } catch (e) {
    return "0";
  }
}

function configPayload() {
  const f = flow();
  const menu = f.botMenu();
  const st = menu.settings || {};
  const pt = pickupTimes(menu);
  const pay = payments.settings(menu);
  const del = f.deliverySettings(menu);
  const qr = payments.qrInfo();
  return {
    businessName: st.businessName || "Franklin Tiffin Room",
    shortName: st.shortName || "FTR",
    tagline: st.tagline || "",
    phoneDisplay: st.phoneDisplay || "",
    phoneDial: dialable(st.phoneDisplay),
    halfTrays: f.halfTraysOn(menu),
    halfTrayPercent: Number(st.halfTrayPercent) > 0 ? Number(st.halfTrayPercent) : 65,
    orderMinimum: f.orderMinimum(menu),
    maxOrderQtyPerItem: Number(st.maxOrderQtyPerItem) || 4,
    cateringPickupOnly: pickupOnly(menu),
    pickupAgreementText: f.pickupAgreementText(menu),
    pickupTimes: { am: pt.am, pm: pt.pm, amLabel: formatTimeLabel(pt.am), pmLabel: formatTimeLabel(pt.pm) },
    paymentSentence: f.paymentSentence(menu),
    deposit: { enabled: payments.enabled(menu), percent: pay.depositPercent },
    zelleQrUrl: qr ? qr.url : null,
    delivery: {
      kitchenKnown: !!del.kitchen,
      maxMiles: del.maxMiles,
      ldsMaxMiles: del.ldsMaxMiles,
      ldsTravelRule: f.ldsTravelRule(menu)
    },
    bookingWindowDays: f.BOOKING_WINDOW_DAYS,
    // From /admin › Setup › Zelle, so the app shows what customers should pay to.
    zelle: payments.enabled(menu) ? { to: pay.zelleTo, name: pay.zelleName || null } : null,
    instagram: (process.env.APP_INSTAGRAM || "ftr.doseadda").replace(/^@/, "") || null,
    signInByWhatsApp: phoneVerify.whatsappAvailable(),
    menuVersion: menuVersion(),
    minAppVersion: process.env.APP_MIN_VERSION || "1.0",
    supportEmail: process.env.APP_SUPPORT_EMAIL || null
  };
}

function menuPayload() {
  const f = flow();
  const menu = f.botMenu();
  const allowed = new Set(f.categoriesAllowedForCart(menu, [], null).map((c) => c.id));
  const half = f.halfTraysOn(menu);
  return {
    categories: (menu.categories || []).map((c) => {
      const isLds = c.type === "live-dose-station";
      const base = {
        id: c.id,
        title: c.title,
        subtitle: c.rowDescription || "",
        kind: isLds ? "lds" : "catering",
        // Home button: "festival" (Festival Specials), "dry" (Dry Products), or absent.
        ...(c.section ? { section: c.section } : {}),
        open: allowed.has(c.id)
      };
      if (isLds) {
        const l = c.liveDoseStation || {};
        const totals = [];
        const lo = Number(l.minTotal) || 100, hi = Number(l.maxTotal) || 200, step = Number(l.increment) || 50;
        for (let n = lo; n <= hi; n += step) totals.push(n);
        return {
          ...base,
          items: [],
          liveDose: {
            setupFee: Number(l.setupFee) || 0,
            pricePerHundred: Number(l.pricePerHundred) || 0,
            minTotal: Number(l.minTotal) || 100,
            maxTotal: Number(l.maxTotal) || 200,
            increment: Number(l.increment) || 50,
            mdTitle: l.mdTitle || "Mysore Masale Dose",
            mdDescription: l.mdDescription || "",
            odTitle: l.odTitle || "Onion Dose",
            odDescription: l.odDescription || "",
            delayFeePerHour: Number(l.delayFeePerHour) || 0,
            ...ldsTimes(menu),
            options: totals.map((n) => ({
              total: n,
              price: money2((n * Number(l.pricePerHundred)) / 100 + Number(l.setupFee || 0))
            }))
          }
        };
      }
      const isPre = c.type === "preorder";
      return {
        ...base,
        // Pre-order sections (Dose-in-a-Box, weekly takeout). Sent as "catering"
        // so older app versions still read the menu; this tells newer ones.
        ...(isPre ? { preorder: preorderInfo(menu, c) } : {}),
        items: (c.items || []).map((i) => ({
          id: i.id,
          title: i.title,
          description: i.description || "",
          price: Number(i.price) || 0,
          halfTrayPrice: half && !isPre ? f.trayTotal(menu, Number(i.price) || 0, 0.5) : null,
          size: i.size || "",
          servesMin: i.servesMin || null,
          servesMax: i.servesMax || null,
          minQty: f.effectiveMinQty(menu, i),
          maxQty: f.effectiveMaxQty(menu, i),
          qtyStep: half && !isPre ? 0.5 : 1,
          requiresNote: !!i.requiresNote,
          notePrompt: i.notePrompt || null,
          // Chef's picks and limited availability (older app versions ignore these).
          promoted: promoActive(i),
          promoNote: promoActive(i) && i.promoNote ? i.promoNote : null,
          limited: !!i.limited,
          limitedNote: i.limited && i.limitedNote ? i.limitedNote : null
        }))
      };
    })
  };
}

/** A stand-in cart so the bot's slot functions know which order type we mean. */
function probeCart(kind, plates) {
  return kind === "lds" ? [{ isLiveDoseStation: true, mdQty: plates, odQty: 0 }] : [{ isLiveDoseStation: false }];
}

/** Pickup days for a pre-order section, for the app. */
function preorderInfo(menu, c) {
  const days = preorders.open(menu).map(preorderDay);
  return { flagship: !!c.flagship, days, next: days[0] || null };
}
function preorderDay(e) {
  const menu = flow().botMenu();
  return {
    date: e.date,
    label: flow().formatDateLabel(e.date),
    pickupTime: formatTimeLabel(e.pickupTime),
    pickupLabel: e.pickupLabel,
    orderByLabel: e.orderByLabel,
    // Kitchen minimum / most for the day, and how many are ordered so far.
    items: preorders.dayStatus(menu, e.date).filter((st) => st.min > 0 || st.max != null)
  };
}

function availabilityPayload(query) {
  const f = flow();
  const menu = f.botMenu();
  if (query.kind === "preorder") {
    return {
      kind: "preorder",
      fulfillment: "pickup",
      dates: preorders.open(menu).map((e) => ({
        date: e.date,
        label: f.formatDateLabel(e.date),
        catering: false,
        cateringPickup: true,
        cateringDelivery: false,
        liveDose: false,
        summary: `Pickup ${formatTimeLabel(e.pickupTime)} · order by ${e.orderByLabel}`,
        slots: [{ id: "slot:preorder", title: `Pickup at ${formatTimeLabel(e.pickupTime)}`, subtitle: `Order by ${e.orderByLabel}` }]
      })),
      fulfillmentOptions: { pickup: true, delivery: false },
      preorderDays: preorders.open(menu).map(preorderDay)
    };
  }
  const pt = pickupTimes(menu);
  const kind = query.kind === "lds" ? "lds" : query.kind === "catering" ? "catering" : null;
  const fulfillment = query.fulfillment === "delivery" ? "delivery" : "pickup";
  let plates = parseInt(query.plates, 10);
  const ldsCfg = f.liveDoseConfig(menu);
  if (!(plates > 0)) plates = ldsCfg ? Number(ldsCfg.minTotal) || 100 : 100;

  const dates = f.upcomingDates(menu).map((d) => {
    const offer = [];
    const pickups = [];
    if (d.pickupAM) pickups.push(shortTime(pt.am));
    if (d.pickupPM) pickups.push(shortTime(pt.pm));
    if (pickups.length) offer.push(`Catering pickup ${pickups.join(" or ")}`);
    if (d.catering.length) offer.push(`Catering delivery ${d.catering.map(f.windowLabel).join(", ")}`);
    if (d.liveDose.length) offer.push(`LIVE Dose ${d.liveDose.map(f.windowLabel).join(", ")}`);
    const out = {
      date: d.date,
      label: f.formatDateLabel(d.date),
      catering: offersCatering(d),
      cateringPickup: !!(d.pickupAM || d.pickupPM),
      cateringDelivery: d.catering.length > 0,
      liveDose: offersLiveDose(d),
      summary: offer.join(" · ")
    };
    if (kind) {
      out.slots = f.timeOptionsFor(menu, d, probeCart(kind, plates), kind === "lds" ? "delivery" : fulfillment).map((s) => ({
        id: s.id,
        title: s.title,
        subtitle: s.description || null
      }));
    }
    return out;
  });
  return {
    kind,
    preorderDays: preorders.open(menu).map(preorderDay),
    fulfillment: kind === "lds" ? "delivery" : fulfillment,
    dates: kind ? dates.filter((d) => d.slots.length > 0) : dates,
    fulfillmentOptions: kind === "catering" ? f.cateringFulfillmentOptions(menu, probeCart("catering"), null) : null
  };
}

// ------------------------------------------------------------------ addresses

const geoCache = new Map(); // text -> { at, result }
async function lookup(text) {
  const key = String(text).trim().toLowerCase();
  const hit = geoCache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60 * 1000) return hit.result;
  const result = await verifyAddress(text);
  if (result.status !== "error") {
    geoCache.set(key, { at: Date.now(), result });
    if (geoCache.size > 500) geoCache.delete(geoCache.keys().next().value);
  }
  return result;
}

function describeMatch(menu, kind, m) {
  const f = flow();
  const miles = f.distanceFromKitchen(menu, m);
  const lim = f.deliverySettings(menu);
  const max = kind === "lds" ? lim.ldsMaxMiles : lim.maxMiles;
  return {
    label: m.label,
    miles,
    maxMiles: max,
    inRange: !max || miles == null || miles <= max,
    travelFee: kind === "lds" ? f.ldsTravelFee(menu, miles) : null
  };
}

async function addressCheck(body) {
  const text = String(body.address || "").trim();
  const kind = body.kind === "lds" ? "lds" : "catering";
  if (text.length < 8 || !/\d/.test(text)) {
    throw new ApiError(400, "Please include the street number, street, town and ZIP.", "address_incomplete");
  }
  const menu = flow().botMenu();
  const result = await lookup(text);
  if (result.status === "error") return { status: "unavailable", matches: [] };
  if (result.status === "none") return { status: "none", matches: [] };
  return { status: "match", matches: result.matches.map((m) => describeMatch(menu, kind, m)) };
}

// ------------------------------------------------------------------ building an order

/**
 * Turn what the app sent into the same order record the WhatsApp bot
 * builds. Throws ApiError with a customer-facing message on any problem.
 *
 * body = {
 *   kind: "catering" | "lds",
 *   items: [{ itemId, qty, note }],          // catering
 *   liveDose: { total, md, note },           // lds
 *   fulfillment: "pickup" | "delivery",      // catering only (lds is always on-site)
 *   date: "YYYY-MM-DD", slotId: "slot:...",
 *   address: "typed or chosen address",       // delivery / lds
 *   useUnverifiedAddress: bool,               // lookup said "not found" and customer kept it
 *   askChefOutOfRange: bool,                  // lds beyond range: let Chef decide
 *   pickupAgreed: bool                        // catering pickup-only notice
 * }
 */
async function buildOrder(phone, body) {
  const f = flow();
  const menu = f.botMenu();
  if (body.kind === "preorder") return buildPreorder(phone, body);
  const kind = body.kind === "lds" ? "lds" : "catering";
  const cart = [];

  if (kind === "catering") {
    const lines = Array.isArray(body.items) ? body.items : [];
    if (!lines.length) throw new ApiError(400, "Your cart is empty.", "empty_cart");
    if (lines.length > 40) throw new ApiError(400, "That's a lot of dishes - please call Chef for an order this size.");
    const half = f.halfTraysOn(menu);
    for (const l of lines) {
      let item = null;
      for (const c of menu.categories) {
        if (c.type === "live-dose-station" || c.type === "preorder") continue;
        item = (c.items || []).find((i) => i.id === l.itemId) || item;
      }
      if (!item) throw new ApiError(400, "One of the dishes in your cart is no longer on the menu. Please remove it.", "item_gone", { itemId: l.itemId });
      const qty = Number(l.qty);
      const min = f.effectiveMinQty(menu, item);
      const max = f.effectiveMaxQty(menu, item);
      if (!(qty > 0) || (!half && !Number.isInteger(qty)) || (half && !Number.isInteger(qty * 2))) {
        throw new ApiError(400, half ? `Please choose whole or half trays of ${item.title}.` : `Please choose whole trays of ${item.title}.`, "bad_qty", { itemId: item.id });
      }
      if (qty < min) throw new ApiError(400, `The minimum for ${item.title} is ${f.fmtQty(min)}.`, "bad_qty", { itemId: item.id });
      if (qty > max) {
        throw new ApiError(400, `For more than ${max} of ${item.title}, please call Chef at ${menu.settings.phoneDisplay} so we can plan properly.`, "bad_qty", { itemId: item.id });
      }
      const note = String(l.note || "").trim().slice(0, 300) || null;
      if (item.requiresNote && !note) {
        throw new ApiError(400, item.notePrompt || `Please tell us your preference for ${item.title}.`, "note_required", { itemId: item.id });
      }
      const line = { ...item, qty, note };
      if (!Number.isInteger(qty)) {
        const total = f.trayTotal(menu, item.price, qty);
        line.fullTrayPrice = item.price;
        line.price = total / qty;
      }
      cart.push(line);
    }
    const subtotal = f.cartSubtotal(cart);
    const min = f.orderMinimum(menu);
    if (min > 0 && subtotal < min) {
      throw new ApiError(400, `Your subtotal is $${subtotal.toFixed(2)}, below our $${min.toFixed(2)} minimum for catering orders. Please add a bit more.`, "below_minimum");
    }
  } else {
    const cat = ldsCategory(menu);
    const lds = cat && cat.liveDoseStation;
    if (!lds) throw new ApiError(400, "The LIVE Dose Station isn't available right now.");
    const total = Number(body.liveDose && body.liveDose.total);
    const md = Number(body.liveDose && body.liveDose.md);
    const inc = Number(lds.increment) || 50;
    if (!(total >= lds.minTotal && total <= lds.maxTotal) || (total - lds.minTotal) % inc !== 0) {
      throw new ApiError(400, `Please choose ${lds.minTotal}-${lds.maxTotal} plates in steps of ${inc}.`, "bad_qty");
    }
    if (!(md >= 0 && md <= total) || md % inc !== 0) {
      throw new ApiError(400, `Please split the plates in steps of ${inc}.`, "bad_qty");
    }
    const price = (total * lds.pricePerHundred) / 100 + lds.setupFee;
    const ext = ldsExtension(menu);
    const extend = !!(body.liveDose && body.liveDose.extend);
    cart.push({
      id: `${cat.id}-order`,
      title: "LIVE Dose Station",
      isLiveDoseStation: true,
      mdQty: md,
      odQty: total - md,
      setupFee: lds.setupFee,
      qty: 1,
      extensionMinutes: extend ? ext.minutes : 0,
      extensionFee: extend ? ext.fee : 0,
      price: price + (extend ? ext.fee : 0),
      note: String((body.liveDose && body.liveDose.note) || "").trim().slice(0, 300) || null
    });
  }

  // Date first, so a stale date gets the right message.
  const date = String(body.date || "");
  const entry = f.upcomingDates(menu).find((d) => d.date === date);
  if (!entry) throw new ApiError(400, "That date isn't open anymore. Please pick another.", "date_gone");

  // Fulfillment & address.
  let fulfillment = kind === "lds" ? "delivery" : body.fulfillment === "delivery" ? "delivery" : "pickup";
  if (kind === "catering") {
    const opts = f.cateringFulfillmentOptions(menu, cart, body.date || null);
    if (fulfillment === "delivery" && !opts.delivery) {
      throw new ApiError(400, pickupOnly(menu) ? "Catering orders are pickup only." : "Delivery isn't open on that date.", "no_delivery");
    }
    if (fulfillment === "pickup" && !opts.pickup) throw new ApiError(400, "Pickup isn't open on that date.", "no_pickup");
    if (fulfillment === "pickup" && pickupOnly(menu) && body.pickupAgreed !== true) {
      throw new ApiError(400, "Please agree to pick up your order.", "pickup_agreement");
    }
  }

  let address = "";
  let addressVerified = false;
  let distanceMiles = null;
  let outOfRange = null;
  let addressMatch = null;
  if (fulfillment === "delivery") {
    const text = String(body.address || "").trim();
    if (text.length < 8 || !/\d/.test(text)) {
      throw new ApiError(400, "Please enter the full address - street number, street, town and ZIP.", "address_needed");
    }
    const result = await lookup(text);
    if (result.status === "match") {
      const m = result.matches[0];
      const d = describeMatch(menu, kind, m);
      address = m.label;
      addressVerified = true;
      distanceMiles = d.miles;
      addressMatch = m;
      if (!d.inRange) {
        if (kind === "lds" && body.askChefOutOfRange === true) {
          outOfRange = { miles: d.miles, max: d.maxMiles };
        } else {
          throw new ApiError(
            400,
            kind === "lds"
              ? `${m.label} is about ${d.miles} miles from our kitchen, outside our ${d.maxMiles}-mile range for the LIVE Dose Station. You can ask Chef to make an exception.`
              : `${m.label} is about ${d.miles} miles from our kitchen, and we deliver within ${d.maxMiles} miles.`,
            "out_of_range",
            { miles: d.miles, maxMiles: d.maxMiles, canAskChef: kind === "lds" }
          );
        }
      }
    } else if (result.status === "none" && body.useUnverifiedAddress !== true) {
      throw new ApiError(400, `We couldn't find "${text}" on the map. Please check the street number, street name and ZIP.`, "address_not_found");
    } else {
      // Not found but kept as typed, or the lookup service is down: the bot
      // takes it as-is and flags it for Chef.
      address = text;
    }
  }

  // Travel fee for the LIVE Dose Station.
  if (kind === "lds") {
    const fee = f.ldsTravelFee(menu, distanceMiles);
    cart[0] = {
      ...cart[0],
      basePrice: cart[0].price,
      travelFee: fee || 0,
      travelMiles: distanceMiles,
      travelFeeUnknown: fee === null,
      price: cart[0].price + (fee || 0)
    };
  }

  // Time slot.
  const options = f.timeOptionsFor(menu, entry, cart, fulfillment);
  const slot = options.find((o) => o.id === body.slotId);
  if (!slot) throw new ApiError(400, "That time isn't available anymore. Please pick another.", "slot_gone");

  let requestedTime;
  let schedule = null;
  if (slot.id === "slot:pickup-am" || slot.id === "slot:pickup-pm") {
    const pt = pickupTimes(menu);
    const isAM = slot.id === "slot:pickup-am";
    requestedTime = `${f.formatDateLabel(date)}, pickup by ${formatTimeLabel(isAM ? pt.am : pt.pm)} (${isAM ? "lunch" : "dinner"})`;
  } else {
    const [slotStart, slotEnd] = slot.id.slice(5).split("-");
    requestedTime = `${f.formatDateLabel(date)}, ${formatTimeLabel(slotStart)} - ${formatTimeLabel(slotEnd)}`;
    if (kind === "lds") {
      // Standard on-site session (Setup > Standard times), plus any extra time.
      const t = ldsTimes(menu);
      const extMin = cart[0].extensionMinutes || 0;
      const endLabel = formatTimeLabel(hhmm(minutesOf(slotEnd) + extMin));
      requestedTime = `${f.formatDateLabel(date)}, LIVE Dose serving ${formatTimeLabel(slotStart)} - ${endLabel}${
        extMin ? ` (incl. ${extMin} extra min)` : ""
      }`;
      schedule = {
        arrival: formatTimeLabel(hhmm(minutesOf(slotStart) - t.setupMinutes)),
        servingStart: formatTimeLabel(slotStart),
        servingEnd: endLabel,
        sessionEnd: formatTimeLabel(slotEnd),
        extraMinutes: extMin,
        extraTime: t.extraTime,
        extraDoseNote: t.extraDoseNote,
        delayFeePerHour: Number((f.liveDoseConfig(menu) || {}).delayFeePerHour) || 0
      };
    }
  }

  const subtotal = money2(f.cartSubtotal(cart));
  const order = {
    customerPhone: phone,
    customerName: f.nameFor(phone),
    cart,
    subtotal,
    fulfillment,
    address,
    addressVerified,
    distanceMiles,
    requestedTime,
    eventDate: date,
    channel: "app",
    // Note for the whole order (same as WhatsApp's "Add a note").
    orderNote: String(body.orderNote || "").trim().slice(0, 500) || null,
    ...(outOfRange ? { outOfRange } : {})
  };

  const pay = payments.settings(menu);
  const summary = {
    lines: cart.map(linePayload),
    subtotal,
    deliveryFeeNote:
      fulfillment === "delivery" && kind === "catering" ? "Delivery fee based on distance - Chef adds it when confirming." : null,
    travelFee: kind === "lds" ? cart[0].travelFee : null,
    travelFeeUnknown: kind === "lds" ? !!cart[0].travelFeeUnknown : false,
    travelRule: kind === "lds" ? f.ldsTravelRule(menu) : null,
    fulfillment,
    address: address || null,
    addressVerified,
    distanceMiles,
    outOfRange,
    requestedTime,
    schedule,
    orderNote: String(body.orderNote || "").trim().slice(0, 500) || null,
    payment: payments.enabled(menu)
      ? {
          deposit: true,
          percent: pay.depositPercent,
          amount: payments.depositFor(subtotal, menu),
          text: `${pay.depositPercent}% Zelle deposit after Chef approves, balance ${
            kind === "lds" ? "on the day of your event" : fulfillment === "pickup" ? "at pickup" : "at delivery"
          }.`
        }
      : { deposit: false, text: `Payment is collected ${kind === "lds" ? "on the day of your event" : `at ${fulfillment}`}.` }
  };
  return { order, summary, addressMatch };
}

/**
 * Dose-in-a-Box / weekly takeout: whole portions from the pre-order
 * sections, picked up on one of Chef's pre-order days before its order-by time.
 */
async function buildPreorder(phone, body) {
  const f = flow();
  const menu = f.botMenu();
  const lines = Array.isArray(body.items) ? body.items : [];
  if (!lines.length) throw new ApiError(400, "Your cart is empty.", "empty_cart");
  if (lines.length > 30) throw new ApiError(400, "That's a lot of items - please call Chef for an order this size.");
  const cart = [];
  for (const l of lines) {
    let item = null;
    for (const c of menu.categories) if (c.type === "preorder") item = (c.items || []).find((i) => i.id === l.itemId) || item;
    if (!item) throw new ApiError(400, "One of the items in your cart isn't available any more. Please remove it.", "item_gone", { itemId: l.itemId });
    const qty = Number(l.qty);
    const min = f.effectiveMinQty(menu, item), max = f.effectiveMaxQty(menu, item);
    if (!Number.isInteger(qty) || qty < min) throw new ApiError(400, `Please choose at least ${min} of ${item.title}.`, "bad_qty", { itemId: item.id });
    if (qty > max) throw new ApiError(400, `For more than ${max} of ${item.title}, please call Chef at ${menu.settings.phoneDisplay}.`, "bad_qty", { itemId: item.id });
    const note = String(l.note || "").trim().slice(0, 300) || null;
    if (item.requiresNote && !note) throw new ApiError(400, item.notePrompt || `Please tell us your preference for ${item.title}.`, "note_required", { itemId: item.id });
    cart.push({ ...item, qty, note, isPreorder: true });
  }
  const date = String(body.date || "");
  const e = preorders.openEntry(menu, date);
  if (!e) throw new ApiError(400, "Orders for that pickup day have closed. Please pick another day.", "date_gone");
  if (body.slotId && body.slotId !== "slot:preorder") throw new ApiError(400, "That time isn't available anymore. Please pick another.", "slot_gone");
  const full = preorders.capacityProblem(menu, date, cart);
  if (full) throw new ApiError(409, full, "sold_out");
  const adding = {};
  for (const l of cart) adding[l.id] = (adding[l.id] || 0) + l.qty;
  const requestedTime = `${f.formatDateLabel(date)}, pickup at ${formatTimeLabel(e.pickupTime)} (pre-order)`;
  const subtotal = money2(f.cartSubtotal(cart));
  const order = {
    customerPhone: phone,
    customerName: f.nameFor(phone),
    cart,
    subtotal,
    fulfillment: "pickup",
    address: "",
    addressVerified: false,
    distanceMiles: null,
    requestedTime,
    eventDate: date,
    channel: "app",
    kind: "preorder",
    orderNote: String(body.orderNote || "").trim().slice(0, 500) || null
  };
  const pay = payments.settings(menu);
  const summary = {
    lines: cart.map(linePayload),
    subtotal,
    deliveryFeeNote: null,
    travelFee: null,
    travelFeeUnknown: false,
    travelRule: null,
    fulfillment: "pickup",
    address: null,
    addressVerified: false,
    distanceMiles: null,
    outOfRange: null,
    requestedTime,
    schedule: null,
    orderNote: order.orderNote,
    preorder: {
      pickupLabel: e.pickupLabel,
      orderByLabel: e.orderByLabel,
      items: preorders.dayStatus(menu, date, adding).filter((st) => st.adding > 0 && (st.min > 0 || st.max != null)),
      notes: preorders.statusLines(menu, date, adding).filter((l) => cart.some((c) => l.startsWith(c.title + ":")))
    },
    payment: payments.enabled(menu)
      ? { deposit: true, percent: pay.depositPercent, amount: payments.depositFor(subtotal, menu), text: `${pay.depositPercent}% Zelle deposit after Chef approves, balance at pickup.` }
      : { deposit: false, text: "Payment is collected at pickup." }
  };
  return { order, summary, addressMatch: null };
}

function linePayload(l) {
  const f = flow();
  if (l.isLiveDoseStation) {
    return {
      kind: "lds",
      itemId: l.id,
      title: "LIVE Dose Station",
      detail: [l.mdQty ? `${l.mdQty} Mysore Masale Dose` : null, l.odQty ? `${l.odQty} Onion Dose` : null].filter(Boolean).join(" + "),
      mdQty: l.mdQty || 0,
      odQty: l.odQty || 0,
      setupFee: l.setupFee || 0,
      travelFee: l.travelFee || 0,
      extensionMinutes: l.extensionMinutes || 0,
      extensionFee: l.extensionFee || 0,
      qty: 1,
      qtyLabel: "1",
      note: l.note || null,
      total: money2(l.price)
    };
  }
  const halfTray = !Number.isInteger(Number(l.qty));
  return {
    kind: "catering",
    itemId: l.id || null,
    title: l.title,
    detail: halfTray ? "includes a half tray" : l.size || null,
    qty: Number(l.qty),
    qtyLabel: f.fmtQty(l.qty),
    note: l.note || null,
    total: money2(Number(l.qty) * Number(l.price))
  };
}

// ------------------------------------------------------------------ orders for the customer

/** Where an order is, for the app's progress tracker. */
function stageFor(o) {
  const s = String(o.status || "");
  if (o.source === "past") return "confirmed";
  if (/declined|released|cancelled/i.test(s)) return "closed";
  if (/confirmed/i.test(s)) return "confirmed";
  if (/deposit under review/i.test(s)) return "deposit_review";
  if (/awaiting deposit/i.test(s)) return "deposit_due";
  if (/quote sent/i.test(s)) return "quote_ready";
  if (/awaiting quote/i.test(s)) return "quote_requested";
  return "review";
}

function orderPayload(o) {
  const p = o.payment || null;
  const pay = payments.settings();
  const qr = payments.qrInfo();
  const isCustom = o.type === "custom";
  return {
    orderId: o.orderId,
    type: o.source === "past" ? "past" : isCustom ? "custom" : (o.cart || []).some((l) => l.isLiveDoseStation) ? "lds" : (o.cart || []).some((l) => l.isPreorder) ? "preorder" : "catering",
    status: o.status || "Pending Approval",
    stage: stageFor(o),
    createdAt: o.createdAt || null,
    updatedAt: o.updatedAt || null,
    eventDate: o.eventDate || null,
    eventDateLabel: o.eventDate ? flow().formatDateLabel(o.eventDate) : null,
    // While Chef is still deciding, a changed time isn't shown yet: the
    // customer is told the new time when Chef approves (same as WhatsApp).
    requestedTime: (o.pending && o.timeChangedByChef ? o.requestedTimeOriginal || o.timeChangedByChef.from : o.requestedTime) || null,
    fulfillment: o.fulfillment || null,
    address: o.address || null,
    subtotal: money2(o.subtotal),
    lines: isCustom ? [] : (o.cart || []).map(linePayload),
    itemsText: itemsText(o),
    request: isCustom ? o.request || "" : null,
    quote:
      isCustom && o.quoted
        ? { price: money2(o.subtotal), comment: o.quoteComment || null, open: !!o.pending && /quote sent/i.test(o.status || "") }
        : null,
    payment: p
      ? {
          state: p.state,
          depositDue: money2(p.depositDue),
          balance: money2(p.balance),
          deadline: p.deadline,
          deadlineLabel: p.deadline ? deadlineLabel(p.deadline) : null,
          zelleTo: pay.zelleTo,
          zelleName: pay.zelleName || null,
          memo: o.orderId,
          qrUrl: qr ? qr.url : null,
          summary: paymentText(o),
          screenshotsSent: (p.proofs || []).length
        }
      : null,
    canUploadProof: !!p && (p.state === "awaiting" || p.state === "review"),
    orderNote: o.orderNote || null,
    // An order from before the app, added by Chef on the admin page.
    pastItems: o.source === "past" ? o.itemsManual || "" : null,
    // Customers can cancel until the 50% deposit is paid (or its screenshot is in).
    canCancel: o.source !== "past" && !flow().cancelBlock(o),
    // Chef changed the time before approving (WhatsApp: Edit / message > Change time).
    timeChange: o.timeChangedByChef && !o.pending ? { from: o.timeChangedByChef.from, to: o.timeChangedByChef.to, at: o.timeChangedByChef.at || null } : null,
    // Chef's chat about this order, and whether the customer can reply right now.
    chat: (o.chat || []).map((m) => ({ from: m.from === "chef" ? "chef" : "customer", text: String(m.text || ""), at: m.at || null })),
    chatOpen: !!(o.pending && (flow().chatFor(o.customerPhone) || {}).orderId === o.orderId),
    channel: o.channel || "whatsapp"
  };
}

function ordersFor(phone) {
  return orderDb
    .all()
    .filter((o) => o.customerPhone === phone)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function ownOrder(phone, id) {
  const o = orderDb.get(id);
  if (!o || o.customerPhone !== phone) throw new ApiError(404, "We couldn't find that order.", "not_found");
  return o;
}

function ownerReady() {
  return !!process.env.OWNER_WHATSAPP_NUMBER && process.env.OWNER_HAS_OPTED_IN === "true";
}

// ------------------------------------------------------------------ routes

function router() {
  const r = express.Router();
  r.use(express.json({ limit: "200kb" }));
  r.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  r.get("/health", (req, res) => res.json({ ok: true }));

  r.get("/config", wrap((req, res) => res.json(configPayload())));
  r.get("/menu", wrap((req, res) => res.json(menuPayload())));
  // A recipe from a packet's QR code. Only the scanned code's recipe is returned; there is no list.
  r.get("/recipes/scan/:token", wrap((req, res) => {
    const recipe = require("./recipes").scan(req.params.token);
    if (!recipe) return res.status(404).json({ error: "This code isn't an FTR recipe, or it has been turned off." });
    res.json({ recipe });
  }));
  // Single-use gift codes printed on FTR-BBB Powder packets (see giftCodes.js).
  const gift = require("./giftCodes");
  function giftWho(req) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
    const phone = m ? appUsers.phoneForToken(m[1].trim()) : null;
    const install = String(req.get("x-ftr-install") || "");
    const ua = String(req.get("user-agent") || "");
    const device = /okhttp|dalvik|android/i.test(ua) ? "Android app" : /darwin|cfnetwork|iphone|ios/i.test(ua) ? "iPhone app" : "App";
    if (phone) return { owner: `user:${phone}`, phone, name: flow().nameFor(phone) || "", device, chef: isAdminPhone(phone) };
    if (!/^[A-Za-z0-9-]{8,64}$/.test(install)) throw new ApiError(400, "Please update the FTR-DOSE app and scan again.");
    return { owner: `app:${install}`, device };
  }
  const giftCall = (fn) => wrap((req, res) => {
    rateLimit(`gift:${ip(req)}`, 60, 15 * 60 * 1000);
    try {
      res.json(fn(req));
    } catch (e) {
      if (e instanceof gift.GiftError) throw new ApiError(e.status, e.message, e.code);
      throw e;
    }
  });
  r.get("/gift/:code", giftCall((req) => gift.appScan(req.params.code, giftWho(req))));
  r.post("/gift/:code/survey", giftCall((req) => gift.appSurvey(req.params.code, giftWho(req), req.body)));
  r.get("/availability", wrap((req, res) => res.json(availabilityPayload(req.query))));

  // --- sign in ---
  r.post(
    "/auth/start",
    wrap(async (req, res) => {
      const phone = normalizePhone(req.body && req.body.phone);
      if (!phone) throw new ApiError(400, "Please enter a 10-digit US mobile number.", "bad_phone");
      rateLimit(`start:${ip(req)}`, 10, 15 * 60 * 1000);
      rateLimit(`start:${phone}`, 4, 15 * 60 * 1000);
      let sent;
      try {
        sent = await phoneVerify.start(phone, req.body && req.body.via === "sms" ? "sms" : undefined);
      } catch (err) {
        throw new ApiError(400, err.message, "code_not_sent");
      }
      res.json({ ok: true, phone, via: sent.via });
    })
  );

  r.post(
    "/auth/verify",
    wrap(async (req, res) => {
      const phone = normalizePhone(req.body && req.body.phone);
      if (!phone) throw new ApiError(400, "Please enter a 10-digit US mobile number.", "bad_phone");
      rateLimit(`verify:${ip(req)}`, 30, 15 * 60 * 1000);
      let ok;
      try {
        ok = await phoneVerify.check(phone, req.body.code);
      } catch (err) {
        throw new ApiError(400, err.message, "code_expired");
      }
      if (!ok) throw new ApiError(400, "That code isn't right. Please check the text message and try again.", "wrong_code");
      const token = appUsers.createSession(phone, req.body.device || "");
      res.json({ token, profile: profileFor(phone) });
    })
  );

  r.post("/auth/signout", requireUser, wrap((req, res) => {
    appUsers.endSession(req.token);
    res.json({ ok: true });
  }));

  // --- Chef's Kitchen: the admin page inside the app, for the owner's phone ---
  r.post(
    "/admin/handoff",
    requireUser,
    wrap((req, res) => {
      if (!isAdminPhone(req.phone)) throw new ApiError(403, "This phone isn't set up as Chef's.", "not_admin");
      const auth = require("./adminAuth");
      if (!auth.configured()) throw new ApiError(500, "Set up the admin sign-in in .env first.");
      // With Google sign-in on, the phone number alone isn't enough: the app opens
      // Google sign-in for Chef's account (older app versions are asked to update).
      if (auth.googleConfigured()) {
        if (!(req.body && req.body.google)) throw new ApiError(426, "Update the FTR-DOSE app to open Chef's Kitchen with Chef's Google account.", "update_app");
        return res.json({ google: "/admin/google/start?app=1" });
      }
      res.json({ path: `/admin/app-entry?code=${auth.newEntryCode()}` });
    })
  );

  // --- profile ---
  r.get("/me", requireUser, wrap((req, res) => res.json(profileFor(req.phone))));

  r.put(
    "/me",
    requireUser,
    wrap((req, res) => {
      const firstName = cleanName(req.body.firstName);
      const lastName = cleanName(req.body.lastName);
      if (!firstName || !lastName) throw new ApiError(400, "Please enter your first and last name.", "bad_name");
      customerStore.save(req.phone, { firstName, lastName });
      res.json(profileFor(req.phone));
    })
  );

  // Alerts for Chef's announcements and new menu items (customer's choice).
  r.put(
    "/me/preferences",
    requireUser,
    wrap((req, res) => {
      appUsers.setPrefs(req.phone, { announcementAlerts: (req.body || {}).announcementAlerts === true });
      res.json(profileFor(req.phone));
    })
  );

  r.delete(
    "/me",
    requireUser,
    wrap((req, res) => {
      appUsers.remove(req.phone);
      appInbox.clear(req.phone);
      appCarts.remove(req.phone);
      customerStore.remove(req.phone);
      res.json({ deleted: true });
    })
  );

  // Saved cart: kept with the account so customers can come back to it later.
  r.get("/me/cart", requireUser, wrap((req, res) => res.json(appCarts.get(req.phone))));
  r.put("/me/cart", requireUser, wrap((req, res) => res.json(appCarts.save(req.phone, (req.body || {}).cart))));

  r.post(
    "/me/push-token",
    requireUser,
    wrap((req, res) => {
      try {
        appUsers.savePushToken(req.phone, req.body.token, req.body.environment);
      } catch (err) {
        throw new ApiError(400, err.message);
      }
      res.json({ ok: true });
    })
  );

  // --- addresses & checkout ---
  r.post(
    "/address/check",
    requireUser,
    wrap(async (req, res) => {
      rateLimit(`addr:${req.phone}`, 40, 15 * 60 * 1000);
      res.json(await addressCheck(req.body || {}));
    })
  );

  r.post(
    "/orders/preview",
    requireUser,
    wrap(async (req, res) => {
      const { summary } = await buildOrder(req.phone, req.body || {});
      res.json(summary);
    })
  );

  r.post(
    "/orders",
    requireUser,
    wrap(async (req, res) => {
      rateLimit(`order:${req.phone}`, 10, 60 * 60 * 1000);
      if (!flow().nameFor(req.phone)) throw new ApiError(400, "Please add your name first.", "needs_name");
      const clientRequestId = String((req.body && req.body.clientRequestId) || "").slice(0, 64) || null;
      if (clientRequestId) {
        const dup = ordersFor(req.phone).find((o) => o.clientRequestId === clientRequestId);
        if (dup) return res.json(orderPayload(dup));
      }
      const { order, addressMatch } = await buildOrder(req.phone, req.body || {});
      const id = flow().orderId();
      const full = { ...order, orderId: id, ...(clientRequestId ? { clientRequestId } : {}) };

      if (addressMatch) {
        customerStore.save(req.phone, {
          address: addressMatch.label,
          addressLat: addressMatch.lat,
          addressLon: addressMatch.lon,
          addressVerified: true
        });
      } else if (full.address) {
        customerStore.save(req.phone, { address: full.address, addressLat: null, addressLon: null, addressVerified: false });
      }

      pendingOrderStore.create(id, full);
      appCarts.remove(req.phone);
      await records.appendOrder({ ...full, status: "Pending Approval" }).catch((err) =>
        console.error(`Failed to record app order ${id}:`, err.message)
      );

      const payNote = payments.enabled()
        ? `Once Chef approves, you'll get Zelle details for the ${payments.settings().depositPercent}% deposit.`
        : `Payment will be collected at ${full.fulfillment}.`;
      await sendText(
        req.phone,
        `Thanks! Your order ${id} ($${full.subtotal.toFixed(2)}) is being reviewed - we'll confirm shortly. ${payNote}`
      ).catch((err) => console.error(`App order ${id} confirmation message failed:`, err.message));

      if (ownerReady()) {
        await flow().sendApprovalPrompt(process.env.OWNER_WHATSAPP_NUMBER, id, full);
      } else {
        console.warn(`App order ${id} needs manual approval - OWNER_WHATSAPP_NUMBER isn't set or hasn't opted in. Check the Google Sheet.`);
      }
      res.status(201).json(orderPayload(orderDb.get(id) || full));
    })
  );

  r.get("/orders", requireUser, wrap((req, res) => res.json({ orders: ordersFor(req.phone).map(orderPayload) })));
  r.get("/orders/:id", requireUser, wrap((req, res) => res.json(orderPayload(ownOrder(req.phone, req.params.id)))));

  r.post(
    "/orders/:id/quote",
    requireUser,
    wrap(async (req, res) => {
      const o = ownOrder(req.phone, req.params.id);
      if (o.type !== "custom" || !o.quoted || !o.pending) throw new ApiError(400, "That quote isn't open anymore.", "quote_closed");
      const accept = req.body && req.body.accept === true;
      await flow().handleQuoteResponse(req.phone, `${accept ? "caccept" : "creject"}:${o.orderId}`);
      appInbox.markActioned(req.phone, o.orderId);
      res.json(orderPayload(orderDb.get(o.orderId)));
    })
  );

  r.post(
    "/orders/:id/payment-proof",
    requireUser,
    express.raw({ type: ["image/jpeg", "image/png", "image/heic"], limit: "10mb" }),
    wrap(async (req, res) => {
      const o = ownOrder(req.phone, req.params.id);
      if (!o.payment || !["awaiting", "review"].includes(o.payment.state)) {
        throw new ApiError(400, "This order isn't waiting on a deposit.", "no_deposit");
      }
      if (!Buffer.isBuffer(req.body) || req.body.length < 1000) throw new ApiError(400, "That picture didn't come through. Please try again.");
      rateLimit(`proof:${req.phone}`, 10, 60 * 60 * 1000);
      await payments.handleCustomerImage(req.phone, { buffer: req.body, orderId: o.orderId });
      res.json(orderPayload(orderDb.get(o.orderId)));
    })
  );

  r.post(
    "/custom-requests",
    requireUser,
    wrap(async (req, res) => {
      const text = String((req.body && req.body.text) || "").trim();
      if (text.length < 10) throw new ApiError(400, "Please tell us a bit more - the dishes, how many people, the date and pickup or delivery.");
      if (!flow().nameFor(req.phone)) throw new ApiError(400, "Please add your name first.", "needs_name");
      rateLimit(`custom:${req.phone}`, 5, 60 * 60 * 1000);
      const before = new Set(ordersFor(req.phone).map((o) => o.orderId));
      await flow().submitCustomRequest(req.phone, text.slice(0, 1500), flow().botMenu());
      const created = ordersFor(req.phone).find((o) => !before.has(o.orderId));
      if (created) orderDb.update(created.orderId, { channel: "app" });
      res.status(201).json(created ? orderPayload(orderDb.get(created.orderId)) : { ok: true });
    })
  );

  // Reply to Chef while Chef has a chat open about this order (WhatsApp:
  // Edit / message > Message customer). Goes to Chef's WhatsApp exactly like
  // a WhatsApp reply would, with Approve / Edit / Decline buttons.
  r.post(
    "/orders/:id/chat",
    requireUser,
    wrap(async (req, res) => {
      const o = ownOrder(req.phone, req.params.id);
      const text = String((req.body && req.body.text) || "").trim().slice(0, 1500);
      if (!text) throw new ApiError(400, "Please type your message for Chef.");
      rateLimit(`chat:${req.phone}`, 40, 60 * 60 * 1000);
      const open = flow().chatFor(req.phone);
      if (!o.pending || !open || open.orderId !== o.orderId) {
        throw new ApiError(409, "Chef has closed this chat. Use Ask a question to send Chef a message.", "chat_closed");
      }
      const handled = await flow().relayCustomerMessage(req.phone, true, text, false);
      if (!handled) throw new ApiError(409, "Chef has closed this chat. Use Ask a question to send Chef a message.", "chat_closed");
      res.json(orderPayload(orderDb.get(o.orderId)));
    })
  );

  // Cancel an order: while Chef is still deciding, or approved but the deposit isn't paid.
  r.post(
    "/orders/:id/cancel",
    requireUser,
    wrap(async (req, res) => {
      const o = ownOrder(req.phone, req.params.id);
      const result = await flow().cancelOrder(o.orderId, "customer");
      if (!result.ok) throw new ApiError(409, result.reason, "cant_cancel");
      res.json(orderPayload(orderDb.get(o.orderId)));
    })
  );

  // Comments & suggestions, kept by phone number (and optionally tied to an order).
  r.get(
    "/feedback",
    requireUser,
    wrap((req, res) => {
      const mine = require("./feedbackStore").all().filter((f) => f.phone === req.phone).reverse();
      res.json({ comments: mine.map((f) => ({ id: f.id, text: f.text, orderId: f.orderId || null, at: f.createdAt })) });
    })
  );
  r.post(
    "/feedback",
    requireUser,
    wrap(async (req, res) => {
      const text = String((req.body && req.body.text) || "").trim();
      if (text.length < 2) throw new ApiError(400, "Please type your comment.");
      rateLimit(`feedback:${req.phone}`, 10, 60 * 60 * 1000);
      let orderId = (req.body && req.body.orderId) || null;
      if (orderId) orderId = ownOrder(req.phone, String(orderId)).orderId;
      const f = await flow().saveFeedback(req.phone, text.slice(0, 2000), orderId);
      res.json({ id: f.id, text: f.text, orderId: f.orderId || null, at: f.createdAt });
    })
  );

  r.post(
    "/questions",
    requireUser,
    wrap(async (req, res) => {
      const text = String((req.body && req.body.text) || "").trim();
      if (!text) throw new ApiError(400, "Please type your question.");
      rateLimit(`question:${req.phone}`, 6, 60 * 60 * 1000);
      const menu = flow().botMenu();
      if (ownerReady()) {
        await sendText(
          process.env.OWNER_WHATSAPP_NUMBER,
          `Question from ${flow().nameFor(req.phone) || "customer"} (${req.phone}) via the FTR app:\n\n"${text.slice(0, 1500)}"\n\nReply to them directly at that number.`
        ).catch((err) => console.error("Failed to forward app question to owner:", err.message));
      } else {
        console.warn(`Unforwarded app question from ${req.phone}: ${text}`);
      }
      await sendText(
        req.phone,
        `Thanks - we've passed your question along and will get back to you soon. If it's urgent, give us a call at ${menu.settings.phoneDisplay}.`
      ).catch(() => {});
      res.json({ ok: true });
    })
  );

  // --- in-app messages ---
  r.get("/inbox", requireUser, wrap((req, res) => res.json({ messages: appInbox.list(req.phone), unread: appInbox.unreadCount(req.phone) })));
  r.post(
    "/inbox/read",
    requireUser,
    wrap((req, res) => {
      const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(String) : null;
      appInbox.markRead(req.phone, ids);
      res.json({ unread: appInbox.unreadCount(req.phone) });
    })
  );

  // Unknown API path.
  r.use((req, res) => res.status(404).json({ error: "Not found" }));
  return r;
}

module.exports = { isAdminPhone, router, _normalizePhone: normalizePhone, _buildOrder: buildOrder };
