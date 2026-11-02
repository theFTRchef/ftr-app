/**
 * Zelle deposits.
 *
 * Flow:
 *   1. Chef approves an order (or a customer accepts a custom quote).
 *      -> order goes to "Awaiting Deposit" and the customer gets the Zelle
 *         details: amount, who to pay, the order number for the memo, and
 *         the chef's Zelle QR code (uploaded once in the admin page).
 *   2. Customer sends a screenshot of the Zelle confirmation.
 *      -> the bot reads it (Google Cloud Vision text reading), checks the
 *         amount / recipient / confirmation code, tells the customer if
 *         something looks off, and forwards the screenshot to the chef
 *         with "Payment received" / "Not received" buttons.
 *   3. Chef taps "Payment received" (after seeing the money in the bank app)
 *      -> order is "Confirmed" and the customer gets FTR's acknowledgement.
 *   4. No deposit within the deadline -> a reminder, then the order is
 *      released ("Released - Unpaid") and both sides are told.
 *
 * A screenshot is never treated as proof on its own - only the chef's tap
 * confirms a payment.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const orderDb = require("./orderDb");
const menuStore = require("./menuStore");
const { sendText, sendButtons, sendImage } = require("./messaging");
const { updateOrderStatus, updateOrderPayment } = require("./records");
const { paymentText, money, deadlineLabel } = require("./paymentText");

const DATA_DIR = process.env.FTR_DATA_DIR || path.join(__dirname, "..", "data");
const PROOF_DIR = path.join(DATA_DIR, "payments");
const QR_BASENAME = "zelle-qr";

const STATUS = {
  awaiting: "Awaiting Deposit",
  review: "Deposit Under Review",
  paid: "Confirmed",
  released: "Released - Unpaid"
};

function baseUrl() {
  return (process.env.PUBLIC_BASE_URL || "https://bot.franklintiffinroom.com").replace(/\/$/, "");
}

function settings(menu = menuStore.getMenu()) {
  const p = (menu.settings && menu.settings.payment) || {};
  const zelleTo = (p.zelleTo || "").trim();
  return {
    enabled: p.enabled === true,
    zelleTo,
    zelleName: (p.zelleName || "").trim(),
    depositPercent: Number(p.depositPercent) > 0 ? Math.min(100, Number(p.depositPercent)) : 50,
    cateringHoursBefore: Number(p.cateringHoursBefore) >= 0 && p.cateringHoursBefore !== "" && p.cateringHoursBefore != null ? Number(p.cateringHoursBefore) : 48,
    ldsDaysBefore: Number(p.ldsDaysBefore) >= 0 && p.ldsDaysBefore !== "" && p.ldsDaysBefore != null ? Number(p.ldsDaysBefore) : 3,
    ldsTime: /^\d{2}:\d{2}$/.test(p.ldsTime || "") ? p.ldsTime : "10:00",
    deadlineHours: Number(p.deadlineHours) > 0 ? Number(p.deadlineHours) : 24,
    lateHours: Number(p.lateHours) > 0 ? Number(p.lateHours) : 2
  };
}

/** Deposits are on when the admin switch is on and there's a Zelle email/phone. */
function enabled(menu) {
  const s = settings(menu);
  return s.enabled && !!s.zelleTo;
}

// ---------------------------------------------------------------- deadlines

const TZ = "America/New_York";

/** The UTC instant for a wall-clock date + time in New Jersey. */
function njTime(dateStr, hhmm) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Offset of New York from UTC at that moment (handles EST/EDT).
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).formatToParts(new Date(guess));
  const get = (t) => Number(parts.find((x) => x.type === t).value);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  let t = guess - (asIfUtc - guess);
  // One correction pass in case the guess straddled a clock change.
  const p2 = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", hour: "2-digit", minute: "2-digit"
  }).formatToParts(new Date(t));
  const h2 = Number(p2.find((x) => x.type === "hour").value);
  if (h2 !== hh) t += (hh - h2) * 3600 * 1000;
  return t;
}

function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function isLiveDose(order) {
  return (order.cart || []).some((l) => l.isLiveDoseStation);
}

/**
 * When the deposit is due:
 *  - Catering: N hours (default 48) before 12:00 AM on the day of the order.
 *    Saturday order -> due by 12:00 AM Thursday (i.e. end of Wednesday).
 *  - LIVE Dose Station: H:MM (default 10:00 AM) N days (default 3) before
 *    the event. Saturday event -> Wednesday 10:00 AM.
 *  - Custom requests / no date known: N hours (default 24) after approval.
 * If that time has already passed (a late booking), the customer gets a
 * short window instead (default 2 hours) and the chef is told.
 * Returns { deadline (ms), rule, late }.
 */
function depositDeadline(order, s = settings(), now = Date.now()) {
  let deadline;
  let rule;
  if (order.eventDate && order.type !== "custom") {
    if (isLiveDose(order)) {
      deadline = njTime(shiftDate(order.eventDate, -s.ldsDaysBefore), s.ldsTime);
      rule = "lds";
    } else {
      deadline = njTime(order.eventDate, "00:00") - s.cateringHoursBefore * 3600 * 1000;
      rule = "catering";
    }
  } else {
    deadline = now + s.deadlineHours * 3600 * 1000;
    rule = "hours";
  }
  const minimum = now + s.lateHours * 3600 * 1000;
  if (deadline < minimum) return { deadline: minimum, rule, late: true };
  return { deadline, rule, late: false };
}

/** Plain-English deposit rule for customers (welcome/availability text). */
function ruleSentence(menu) {
  const s = settings(menu);
  const days = s.cateringHoursBefore % 24 === 0 ? `${s.cateringHoursBefore / 24} day${s.cateringHoursBefore === 24 ? "" : "s"}` : `${s.cateringHoursBefore} hours`;
  const [hh, mm] = s.ldsTime.split(":").map(Number);
  const time = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
  return (
    `A ${s.depositPercent}% Zelle deposit locks in your date: catering is due ${days} before the day of your order, ` +
    `and the LIVE Dose Station by ${time} ${s.ldsDaysBefore} days before the event (e.g. Wednesday for a Saturday).`
  );
}

function depositFor(subtotal, menu) {
  const pct = settings(menu).depositPercent;
  return Math.round(Number(subtotal || 0) * pct) / 100;
}

// ---------------------------------------------------------------- QR code

function qrFile() {
  if (!fs.existsSync(DATA_DIR)) return null;
  const f = fs.readdirSync(DATA_DIR).find((n) => n.startsWith(QR_BASENAME + "."));
  return f ? path.join(DATA_DIR, f) : null;
}

function saveQr(buffer, contentType) {
  const ext = /png/.test(contentType) ? "png" : /jpe?g/.test(contentType) ? "jpg" : null;
  if (!ext) throw new Error("Please upload a PNG or JPG picture of your Zelle QR code.");
  if (!buffer || buffer.length < 200) throw new Error("That file looks empty.");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const old = qrFile();
  if (old) fs.unlinkSync(old);
  fs.writeFileSync(path.join(DATA_DIR, `${QR_BASENAME}.${ext}`), buffer);
}

function removeQr() {
  const old = qrFile();
  if (old) fs.unlinkSync(old);
}

function qrInfo() {
  const f = qrFile();
  if (!f) return null;
  const st = fs.statSync(f);
  return { url: `/zelle-qr?v=${Math.round(st.mtimeMs)}`, updatedAt: st.mtime.toISOString() };
}

// ---------------------------------------------------------------- asking for the deposit

function balanceWhere(order) {
  if (order.type === "custom") return "on the day of your order";
  if ((order.cart || []).some((l) => l.isLiveDoseStation)) return "on the day of your event";
  return order.fulfillment === "delivery" ? "at delivery" : "at pickup";
}

function payInstructions(order) {
  const s = settings();
  const p = order.payment;
  return (
    `To lock in order ${order.orderId}, please send a ${s.depositPercent}% deposit by Zelle:\n\n` +
    `Amount: ${money(p.depositDue)}\n` +
    `Send to: ${s.zelleTo}${s.zelleName ? ` (${s.zelleName})` : ""}\n` +
    `Memo: ${order.orderId}\n\n` +
    `Please pay by ${deadlineLabel(p.deadline)}. ` +
    (p.balance > 0 ? `The balance of ${money(p.balance)} is due ${balanceWhere(order)}.\n\n` : "\n\n") +
    `After you pay, *PLEASE UPLOAD THE SCREENSHOT CONFIRMATION HERE.*`
  );
}

/**
 * Put an order into "Awaiting Deposit" and send the customer the Zelle
 * details. Returns false (and does nothing) if deposits aren't set up.
 */
async function requestDeposit(order, intro = "") {
  const menu = menuStore.getMenu();
  if (!enabled(menu)) return false;
  const s = settings(menu);
  const depositDue = depositFor(order.subtotal, menu);
  const due = depositDeadline(order, s);
  const payment = {
    state: "awaiting",
    depositPercent: s.depositPercent,
    depositDue,
    balance: Math.round((Number(order.subtotal) - depositDue) * 100) / 100,
    requestedAt: new Date().toISOString(),
    deadline: new Date(due.deadline).toISOString(),
    deadlineRule: due.rule,
    late: due.late,
    reminded: false,
    proofs: []
  };
  const updated = orderDb.update(order.orderId, { payment, status: STATUS.awaiting, pending: false }) || {
    ...order,
    payment
  };
  await updateOrderStatus(order.orderId, STATUS.awaiting).catch(() => {});
  await syncPaymentCell(updated);

  // One message: approval note + Zelle details, on the QR picture if there is one.
  const message = (intro ? `${intro}\n\n` : "") + payInstructions(updated);
  const qr = qrInfo();
  let sent = false;
  if (qr && message.length <= 1024) {
    try {
      await sendImage(order.customerPhone, baseUrl() + qr.url, message);
      sent = true;
    } catch (err) {
      console.error(`Zelle QR not sent for ${order.orderId}:`, err.message);
    }
  }
  if (!sent) await sendText(order.customerPhone, message);
  return payment;
}

async function syncPaymentCell(order) {
  if (order) await updateOrderPayment(order.orderId, paymentText(order)).catch(() => {});
}

/** The customer's most recent order that's waiting on a deposit, if any. */
function openDepositFor(phone, orderId = null) {
  return orderDb
    .all()
    .filter((o) => o.customerPhone === phone && o.payment && (o.payment.state === "awaiting" || o.payment.state === "review"))
    .filter((o) => !orderId || o.orderId === orderId)
    .sort((a, b) => String(b.payment.requestedAt).localeCompare(String(a.payment.requestedAt)))[0] || null;
}

// ---------------------------------------------------------------- reading the screenshot

let visionAuth = null;
async function visionToken() {
  if (!visionAuth) {
    const { google } = require("googleapis");
    visionAuth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  }
  const t = await visionAuth.getAccessToken();
  return typeof t === "string" ? t : t?.token;
}

/** Text in the picture, via Google Cloud Vision. Returns "" if it can't be read. */
async function readText(buffer) {
  const res = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: { Authorization: `Bearer ${await visionToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{ image: { content: buffer.toString("base64") }, features: [{ type: "TEXT_DETECTION" }] }]
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Vision API ${res.status}: ${body?.error?.message || res.statusText}`);
  const r = (body.responses || [])[0] || {};
  if (r.error) throw new Error(`Vision API: ${r.error.message}`);
  return (r.fullTextAnnotation && r.fullTextAnnotation.text) || "";
}

const CODE_RE =
  /(?:confirmation|conf\.?|transaction|reference|ref\.?|tracking)\s*(?:number|no\.?|num|#|code|id)?\s*[:#.\-]?\s*\n?\s*([A-Z0-9][A-Z0-9-]{5,24})/gi;

/**
 * Pull what we can out of the screenshot text. Exported for tests.
 * Everything is "best effort" - bank apps all lay this out differently.
 */
function parseScreenshot(text) {
  const t = String(text || "");
  const amounts = [...t.matchAll(/\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?/g)].map((m) =>
    Number(m[1].replace(/,/g, "") + "." + (m[2] || "00"))
  );
  let code = null;
  for (const m of t.matchAll(CODE_RE)) {
    const c = m[1].replace(/-+$/, "");
    if (/\d/.test(c) && !/^(NUMBER|CODE)$/i.test(c)) {
      code = c.toUpperCase();
      break;
    }
  }
  const orderIds = [...t.toUpperCase().matchAll(/\b((?:FTR|CUST)-[A-Z0-9]{5,})\b/g)].map((m) => m[1]);
  return {
    amounts,
    code,
    orderIds,
    mentionsZelle: /zelle/i.test(t),
    notSentYet: /\b(scheduled|pending|processing|not sent|cancel+ed|failed)\b/i.test(t)
  };
}

function digits(s) {
  return String(s || "").replace(/\D/g, "");
}

/** Compare what the screenshot shows with what we expect. Exported for tests. */
function checkScreenshot(parsed, text, order, s, usedCodes) {
  const issues = [];
  const notes = [];
  const due = order.payment.depositDue;
  const lower = String(text || "").toLowerCase();

  if (!text || !text.trim()) {
    return { readable: false, issues: [], notes: ["Couldn't read any text in the picture."], amountOk: false };
  }

  const amountOk = parsed.amounts.some((a) => Math.abs(a - due) < 0.01 || a > due);
  const exact = parsed.amounts.some((a) => Math.abs(a - due) < 0.01);
  if (!parsed.amounts.length) issues.push("no dollar amount found");
  else if (!amountOk) issues.push(`amount shown ${parsed.amounts.map(money).join(", ")} is less than the ${money(due)} deposit`);
  else notes.push(exact ? `amount ${money(due)} matches` : `amount shown is at least ${money(due)}`);

  const to = s.zelleTo.toLowerCase();
  const nameWords = s.zelleName.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const toDigits = digits(to);
  const recipientOk =
    (to.includes("@") && lower.includes(to)) ||
    (toDigits.length >= 7 && digits(text).includes(toDigits.slice(-7))) ||
    (nameWords.length && nameWords.every((w) => lower.includes(w)));
  if (recipientOk) notes.push("recipient matches");
  else issues.push("couldn't see FTR's Zelle name/email/phone as the recipient");

  if (parsed.code) {
    if (usedCodes.has(parsed.code)) issues.push(`confirmation code ${parsed.code} was already used on another order`);
    else notes.push(`confirmation ${parsed.code}`);
  } else {
    issues.push("no confirmation code found");
  }

  if (parsed.orderIds.length && !parsed.orderIds.includes(order.orderId)) {
    issues.push(`memo mentions ${parsed.orderIds.join(", ")}, not ${order.orderId}`);
  } else if (parsed.orderIds.includes(order.orderId)) {
    notes.push("order number in memo");
  }
  if (parsed.notSentYet) issues.push('screenshot says "scheduled/pending" - the payment may not have gone through yet');
  if (!parsed.mentionsZelle) notes.push("doesn't mention Zelle");

  return { readable: true, issues, notes, amountOk };
}

function usedCodesExcept(orderId) {
  const used = new Set();
  orderDb.all().forEach((o) => {
    if (o.orderId === orderId || !o.payment) return;
    (o.payment.proofs || []).forEach((p) => p.code && used.add(p.code));
  });
  return used;
}

// ---------------------------------------------------------------- customer sent a picture

/**
 * Called for every picture a customer sends. Returns true if it was handled
 * as a payment screenshot.
 */
async function handleCustomerImage(from, image) {
  // The iOS app names the order and sends the picture itself (image.buffer);
  // WhatsApp sends a link to the most recent picture (image.url).
  const order = image && image.orderId
    ? openDepositFor(from, image.orderId)
    : openDepositFor(from);
  if (!order) {
    await sendText(
      from,
      `Thanks for the picture! We don't have an order waiting on a deposit from this number. If you need help, send "hi" or call us.`
    );
    return true;
  }

  let buffer;
  try {
    buffer = image.buffer || (await require("./vonageClient").downloadMedia(image.url));
  } catch (err) {
    console.error(`Couldn't download screenshot for ${order.orderId}:`, err.message);
    await sendText(from, `Sorry, that picture didn't come through. Please send the Zelle screenshot again.`);
    return true;
  }

  fs.mkdirSync(PROOF_DIR, { recursive: true });
  const token = crypto.randomBytes(16).toString("hex");
  fs.writeFileSync(path.join(PROOF_DIR, `${token}.jpg`), buffer);

  const s = settings();
  let text = "";
  let ocrError = null;
  try {
    text = await readText(buffer);
  } catch (err) {
    ocrError = err.message;
    console.error(`Screenshot reading failed for ${order.orderId}:`, err.message);
  }
  const parsed = parseScreenshot(text);
  const check = ocrError
    ? { readable: false, issues: [], notes: ["automatic check unavailable"], amountOk: false }
    : checkScreenshot(parsed, text, order, s, usedCodesExcept(order.orderId));

  const proof = {
    token,
    receivedAt: new Date().toISOString(),
    code: parsed.code,
    amounts: parsed.amounts,
    issues: check.issues,
    notes: check.notes
  };
  const payment = { ...order.payment, state: "review", proofs: [...(order.payment.proofs || []), proof] };
  const updated = orderDb.update(order.orderId, { payment, status: STATUS.review });
  await updateOrderStatus(order.orderId, STATUS.review).catch(() => {});
  await syncPaymentCell(updated);

  // Tell the customer.
  const amountProblem = check.readable && !check.amountOk;
  if (amountProblem) {
    await sendText(
      from,
      `Thanks - we got your screenshot for ${order.orderId}, but it doesn't seem to show the ${money(order.payment.depositDue)} deposit` +
        (parsed.amounts.length ? ` (we see ${parsed.amounts.map(money).join(", ")})` : "") +
        `. If that's a mistake, no worries - Chef will check. Otherwise please send the rest by Zelle to ${s.zelleTo} and send a new screenshot.`
    );
  } else {
    await sendText(
      from,
      `Thanks! We received your payment screenshot for order ${order.orderId}` +
        (parsed.code ? ` (confirmation ${parsed.code})` : "") +
        `. Chef will confirm the deposit shortly and you'll get a payment acknowledgement here.`
    );
  }

  // Forward to the chef.
  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER;
  if (!ownerNumber) return true;
  const verdict = !check.readable
    ? "Couldn't check automatically - please look at the screenshot."
    : check.issues.length
    ? "CHECK: " + check.issues.join("; ")
    : "Looks right: " + check.notes.join(", ");
  const proofUrl = `${baseUrl()}/payment-proof/${token}.jpg`;
  const card = {
    body: (
      `${order.customerName || "Customer"} (${order.customerPhone}) sent a Zelle screenshot for ${order.orderId}.\n` +
      `Deposit due: ${money(order.payment.depositDue)} (order total ${money(order.subtotal)})\n` +
      (parsed.code ? `Confirmation: ${parsed.code}\n` : "") +
      `\n${verdict}\n\nOpen your bank app - tap Payment received only once you see the money.`
    ).slice(0, 1024),
    buttons: [
      { id: `paid:${order.orderId}`, title: "Payment received" },
      { id: `unpaid:${order.orderId}`, title: "Not received" }
    ]
  };
  // Screenshot on top of the buttons, in one message.
  await sendButtons(ownerNumber, { ...card, headerImage: proofUrl }).catch(async (err) => {
    console.error(`Picture+buttons failed for ${order.orderId}, sending separately:`, err.message);
    await sendImage(ownerNumber, proofUrl, `Zelle screenshot for ${order.orderId}`).catch(() => {});
    await sendButtons(ownerNumber, { header: "Deposit screenshot", ...card }).catch((e) =>
      console.error(`Couldn't send deposit buttons for ${order.orderId}:`, e.message)
    );
  });
  return true;
}

/** Customer typed something like "paid" / "sent the zelle" while a deposit is open. */
async function maybeHandlePaymentText(from, text) {
  if (!/\b(paid|zelle|sent|payment|deposit|transferred)\b/i.test(text || "")) return false;
  const order = openDepositFor(from);
  if (!order) return false;
  if (order.payment.state === "review") {
    await sendText(from, `Thanks! We have your screenshot for ${order.orderId} - Chef will confirm shortly.`);
  } else {
    await sendText(
      from,
      `Thanks! *PLEASE UPLOAD THE SCREENSHOT CONFIRMATION HERE* for order ${order.orderId} (${money(order.payment.depositDue)} to ${settings().zelleTo}), so Chef can confirm it.`
    );
  }
  return true;
}

// ---------------------------------------------------------------- chef's buttons

async function handleOwnerPaymentReply(ownerNumber, action, id) {
  const order = orderDb.get(id);
  if (!order || !order.payment) {
    return sendText(ownerNumber, `Order ${id} doesn't have a deposit request.`);
  }
  const p = order.payment;
  if (p.state === "paid") return sendText(ownerNumber, `Deposit for ${id} is already marked paid.`);
  if (p.state === "released") {
    if (action !== "paid") return sendText(ownerNumber, `Order ${id} was already released.`);
  }

  if (action === "paid") {
    const code = (p.proofs || []).map((x) => x.code).filter(Boolean).slice(-1)[0] || null;
    const payment = { ...p, state: "paid", paidAt: new Date().toISOString(), confirmationCode: code };
    const updated = orderDb.update(id, { payment, status: STATUS.paid });
    await updateOrderStatus(id, STATUS.paid).catch(() => {});
    await syncPaymentCell(updated);
    const menu = menuStore.getMenu();
    await sendText(
      order.customerPhone,
      `Payment received - thank you!\n\n` +
        `${(menu.settings.shortName || "").trim() || "FTR"} has received your ${money(p.depositDue)} Zelle deposit for order ${id}` +
        (code ? ` (confirmation ${code})` : "") +
        `.\n\nYour order is confirmed` +
        (order.requestedTime ? ` for ${order.requestedTime}` : "") +
        `.` +
        (p.balance > 0 ? `\nBalance due ${balanceWhere(order)}: ${money(p.balance)}.` : "") +
        `\n\nSee you then!`
    ).catch((err) => {
      console.error(`Couldn't send payment acknowledgement for ${id}:`, err.message);
      return sendText(ownerNumber, `Couldn't message the customer for ${id} (WhatsApp 24-hour limit?). Please text them at ${order.customerPhone}.`);
    });
    return sendText(ownerNumber, `${id} marked PAID - customer sent the payment acknowledgement. Order confirmed.`);
  }

  // Not received: back to waiting, deadline unchanged.
  const payment = { ...p, state: "awaiting" };
  const updated = orderDb.update(id, { payment, status: STATUS.awaiting });
  await updateOrderStatus(id, STATUS.awaiting).catch(() => {});
  await syncPaymentCell(updated);
  const s = settings();
  await sendText(
    order.customerPhone,
    `Chef hasn't received your Zelle deposit for order ${id} yet. Zelle usually arrives within minutes - please check it went to ${s.zelleTo} for ${money(p.depositDue)}, then *PLEASE UPLOAD THE SCREENSHOT CONFIRMATION HERE* again. Deposit is due by ${deadlineLabel(p.deadline)}.`
  ).catch((err) => console.error(`Couldn't send not-received note for ${id}:`, err.message));
  return sendText(ownerNumber, `${id}: customer asked to check their payment and resend.`);
}

// ---------------------------------------------------------------- reminders and release

/** Remind 24 hours ahead when there's lots of time, otherwise 4 hours ahead. */
function remindWindow(p) {
  const total = Date.parse(p.deadline) - Date.parse(p.requestedAt || p.deadline);
  if (total > 48 * 3600 * 1000) return 24 * 3600 * 1000;
  if (total > 8 * 3600 * 1000) return 4 * 3600 * 1000;
  return 0; // short (late-booking) windows: no reminder
}

async function sweep(now = Date.now()) {
  const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER;
  for (const o of orderDb.all()) {
    const p = o.payment;
    if (!p || p.state !== "awaiting") continue;
    const deadline = Date.parse(p.deadline);
    if (now >= deadline) {
      const payment = { ...p, state: "released", releasedAt: new Date(now).toISOString() };
      const updated = orderDb.update(o.orderId, { payment, status: STATUS.released });
      await updateOrderStatus(o.orderId, STATUS.released).catch(() => {});
      await syncPaymentCell(updated);
      await sendText(
        o.customerPhone,
        `We didn't receive the deposit for order ${o.orderId}, so it has been released. If you still want it, send "hi" to place it again (subject to availability) or call us.`
      ).catch((err) => console.error(`Couldn't send release notice for ${o.orderId}:`, err.message));
      if (ownerNumber) {
        await sendText(ownerNumber, `${o.orderId} (${o.customerName || o.customerPhone}) released - no deposit by the deadline.`).catch(() => {});
      }
    } else if (!p.reminded && deadline - now <= remindWindow(p)) {
      orderDb.update(o.orderId, { payment: { ...p, reminded: true } });
      await sendText(
        o.customerPhone,
        `Reminder: the ${money(p.depositDue)} Zelle deposit for order ${o.orderId} is due by ${deadlineLabel(p.deadline)}. Send to ${settings().zelleTo}, memo ${o.orderId}, then *PLEASE UPLOAD THE SCREENSHOT CONFIRMATION HERE.*`
      ).catch((err) => console.error(`Couldn't send reminder for ${o.orderId}:`, err.message));
    }
  }
}

function startSweeper() {
  const run = () => sweep().catch((err) => console.error("Deposit check failed:", err.message));
  setTimeout(run, 30 * 1000);
  return setInterval(run, 10 * 60 * 1000);
}

function proofPath(token) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const f = path.join(PROOF_DIR, `${token}.jpg`);
  return fs.existsSync(f) ? f : null;
}

module.exports = {
  STATUS,
  openDepositFor,
  payInstructions,
  settings,
  enabled,
  depositFor,
  depositDeadline,
  ruleSentence,
  njTime,
  requestDeposit,
  handleCustomerImage,
  maybeHandlePaymentText,
  handleOwnerPaymentReply,
  sweep,
  startSweeper,
  saveQr,
  removeQr,
  qrFile,
  qrInfo,
  proofPath,
  paymentText,
  parseScreenshot,
  checkScreenshot
};
