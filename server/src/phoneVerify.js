/**
 * Sign-in codes for the iOS app: the customer types their mobile number,
 * gets a 6-digit code by text message, and types it back. This proves the
 * phone is theirs, so nobody can see someone else's orders.
 *
 * Codes go by WhatsApp (from the bot's own business number, WHATSAPP_FROM_NUMBER)
 * with a text message as backup if the WhatsApp code isn't used within 2 minutes,
 * or straight by text message if the customer picks that.
 *
 * Uses Vonage Verify v2 with the SAME Vonage application (VONAGE_APPLICATION_ID
 * + private key) the WhatsApp bot already uses - Verify just has to be
 * allowed on that Vonage account. Vonage charges per successful verification.
 *
 * .env options:
 *   APP_OTP_MODE=vonage   (default) real text messages via Vonage Verify
 *   APP_OTP_MODE=log      testing only - the code is printed in the server log
 *   APP_DEMO_PHONE / APP_DEMO_CODE   one fixed number + code with no text
 *                         message, for Apple's App Review team
 */
const crypto = require("crypto");

const VERIFY_URL = "https://api.nexmo.com/v2/verify";
const pending = new Map(); // phone -> { requestId?, code?, expires, tries }
const TTL_MS = 10 * 60 * 1000;

function mode() {
  return (process.env.APP_OTP_MODE || "vonage").toLowerCase();
}

function isDemo(phone) {
  const demo = String(process.env.APP_DEMO_PHONE || "").replace(/\D/g, "");
  return !!demo && !!process.env.APP_DEMO_CODE && phone === (demo.length === 10 ? "1" + demo : demo);
}

async function vonage(method, url, body) {
  const jwt = require("./vonageClient").generateJwt();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch (e) { /* not json */ }
  return { status: res.status, json };
}

/** Can codes go by WhatsApp? (needs the bot's WhatsApp number, unless switched off) */
function whatsappAvailable() {
  return !!process.env.WHATSAPP_FROM_NUMBER && process.env.APP_OTP_WHATSAPP !== "off";
}

function workflowFor(phone, via) {
  const sms = { channel: "sms", to: phone };
  if (via === "whatsapp" && whatsappAvailable()) {
    return [{ channel: "whatsapp", to: phone, from: String(process.env.WHATSAPP_FROM_NUMBER).replace(/\D/g, "") }, sms];
  }
  return [sms];
}

/**
 * Send a code. `via` is "whatsapp" (default when available) or "sms".
 * Resolves { ok, via } or throws an Error with a customer-friendly message.
 */
async function start(phone, via = whatsappAvailable() ? "whatsapp" : "sms") {
  via = via === "sms" || !whatsappAvailable() ? "sms" : "whatsapp";
  if (isDemo(phone)) {
    pending.set(phone, { demo: true, expires: Date.now() + TTL_MS, tries: 0 });
    return { ok: true, via };
  }
  if (mode() === "log") {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    pending.set(phone, { code, expires: Date.now() + TTL_MS, tries: 0 });
    console.log(`[app sign-in] code for ${phone} (${via}): ${code}`);
    return { ok: true, via };
  }
  // Cancel an earlier unfinished code to the same number (Verify allows one at a time).
  const prev = pending.get(phone);
  if (prev && prev.requestId) {
    await vonage("DELETE", `${VERIFY_URL}/${prev.requestId}`).catch(() => {});
  }
  const send = (how) =>
    vonage("POST", VERIFY_URL, {
      brand: (process.env.APP_OTP_BRAND || "FTR").slice(0, 16),
      code_length: 6,
      // WhatsApp first; if that code isn't used in 2 minutes Verify sends a text.
      channel_timeout: how === "whatsapp" ? 120 : 300,
      workflow: workflowFor(phone, how)
    });
  let { status, json } = await send(via);
  if (via === "whatsapp" && status === 422) {
    // WhatsApp isn't set up for Verify on this Vonage account (or this number) - use a text.
    console.error("Vonage Verify WhatsApp refused, falling back to SMS:", JSON.stringify(json));
    via = "sms";
    ({ status, json } = await send("sms"));
  }
  if (status === 202 && json.request_id) {
    pending.set(phone, { requestId: json.request_id, expires: Date.now() + TTL_MS, tries: 0 });
    return { ok: true, via };
  }
  console.error(`Vonage Verify start ${status}:`, JSON.stringify(json));
  if (status === 409) throw new Error("A code was just sent to this number - please wait a minute and try again.");
  if (status === 429) throw new Error("Too many codes requested. Please wait a few minutes and try again.");
  if (status === 422) throw new Error("We couldn't send a code to that number. Please check it and try again.");
  throw new Error("We couldn't send a code right now. Please try again in a minute.");
}

/** True if the code is right. Throws for expired / too many tries. */
async function check(phone, code) {
  const p = pending.get(phone);
  const clean = String(code || "").replace(/\D/g, "");
  if (!p || p.expires < Date.now()) {
    pending.delete(phone);
    throw new Error("That code has expired. Please ask for a new one.");
  }
  p.tries += 1;
  if (p.tries > 5) {
    pending.delete(phone);
    throw new Error("Too many wrong tries. Please ask for a new code.");
  }
  if (p.demo) {
    const ok = clean === String(process.env.APP_DEMO_CODE).replace(/\D/g, "");
    if (ok) pending.delete(phone);
    return ok;
  }
  if (p.code) {
    const ok = clean.length === 6 && crypto.timingSafeEqual(Buffer.from(clean), Buffer.from(p.code));
    if (ok) pending.delete(phone);
    return ok;
  }
  const { status, json } = await vonage("POST", `${VERIFY_URL}/${p.requestId}`, { code: clean });
  if (status === 200 && (json.status === "completed" || !json.status)) {
    pending.delete(phone);
    return true;
  }
  if (status === 400) return false; // wrong code
  pending.delete(phone);
  if (status === 410 || status === 404) throw new Error("That code has expired. Please ask for a new one.");
  console.error(`Vonage Verify check ${status}:`, JSON.stringify(json));
  throw new Error("We couldn't check the code right now. Please try again.");
}

module.exports = { start, check, isDemo, whatsappAvailable, _workflowFor: workflowFor };
