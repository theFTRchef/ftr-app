/**
 * Admin sign-in with a proper login page and Log out button.
 *
 * Username/password come from ADMIN_USERNAME / ADMIN_PASSWORD in .env.
 * Signing in sets a signed, HttpOnly cookie that lasts 30 days on that
 * device. Log out clears it. Changing ADMIN_PASSWORD signs out every
 * device (the cookie signature is tied to the password).
 */
const crypto = require("crypto");

const COOKIE = "ftr_admin";
const MAX_AGE_DAYS = 30;
const failures = new Map(); // ip -> { count, until }

function configured() {
  return !!(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD);
}

function key() {
  return crypto
    .createHash("sha256")
    .update(`ftr-admin|${process.env.ADMIN_USERNAME}|${process.env.ADMIN_PASSWORD}|${process.env.SESSION_SECRET || ""}`)
    .digest();
}

function sign(expires) {
  return crypto.createHmac("sha256", key()).update(String(expires)).digest("hex");
}

function sameText(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function readCookie(req) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

function validSession(req) {
  if (!configured()) return false;
  const value = readCookie(req);
  if (!value) return false;
  const [expires, sig] = value.split(".");
  if (!expires || !sig || Number(expires) < Date.now()) return false;
  return sameText(sig, sign(expires));
}

function cookieFlags(req) {
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(req.headers.host || "");
  return `Path=/; HttpOnly; SameSite=Lax${local ? "" : "; Secure"}`;
}

function safeNext(next) {
  return typeof next === "string" && /^\/admin(\/[\w\-./]*)?$/.test(next) ? next : "/admin";
}

function requireAdminAuth(req, res, next) {
  if (!configured()) {
    return res
      .status(500)
      .send("Admin panel is not configured - set ADMIN_USERNAME and ADMIN_PASSWORD in .env");
  }
  if (validSession(req)) return next();
  if (req.path.startsWith("/admin/api") || req.method !== "GET") {
    return res.status(401).send("Signed out - please reload the page and sign in again.");
  }
  res.redirect(302, `/admin/login?next=${encodeURIComponent(req.originalUrl.split("?")[0])}`);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function loginPage({ error = "", next = "/admin", note = "" } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · FTR Chef's Kitchen</title>
<meta name="robots" content="noindex">
<style>
:root { --bg:#f3f5f2; --card:#fff; --ink:#1c2420; --muted:#66736b; --line:#d5dcd4; --leaf:#2e6a4c; --bad:#b3402e; }
@media (prefers-color-scheme: dark) { :root { --bg:#121815; --card:#1a221e; --ink:#e8eee9; --muted:#9aa89f; --line:#2f3b35; --leaf:#5fae86; --bad:#e2735f; } }
* { box-sizing:border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--ink);
  font:16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding:16px; }
.card { width:100%; max-width:380px; background:var(--card); border:1px solid var(--line); border-radius:20px; padding:28px 24px; }
.logo { width:44px; height:44px; border-radius:50%; border:6px solid var(--leaf); display:grid; place-items:center; margin-bottom:14px; }
.logo::after { content:""; width:16px; height:16px; border-radius:50%; background:#d99a12; }
h1 { font-size:22px; margin:0 0 4px; }
p { margin:0 0 20px; color:var(--muted); font-size:14.5px; }
label { display:block; font-weight:600; font-size:14px; margin:14px 0 6px; }
input { width:100%; font:inherit; padding:12px 14px; border:1px solid var(--line); border-radius:12px; background:transparent; color:var(--ink); }
input:focus { outline:2px solid var(--leaf); outline-offset:1px; border-color:transparent; }
button { width:100%; margin-top:22px; font:inherit; font-weight:700; padding:13px; border:0; border-radius:12px; background:var(--leaf); color:#fff; cursor:pointer; }
.err { color:var(--bad); font-weight:600; font-size:14px; margin:14px 0 0; }
.note { color:var(--leaf); font-weight:600; font-size:14px; margin:0 0 6px; }
</style></head><body>
<form class="card" method="post" action="/admin/login">
  <div class="logo" aria-hidden="true"></div>
  <h1>FTR Chef's Kitchen</h1>
  <p>Franklin Tiffin Room admin</p>
  ${note ? `<div class="note">${esc(note)}</div>` : ""}
  <input type="hidden" name="next" value="${esc(next)}">
  <label for="u">Username</label>
  <input id="u" name="username" autocomplete="username" autocapitalize="none" required autofocus>
  <label for="p">Password</label>
  <input id="p" name="password" type="password" autocomplete="current-password" required>
  ${error ? `<div class="err" role="alert">${esc(error)}</div>` : ""}
  <button type="submit">Sign in</button>
</form></body></html>`;
}

function sendLogin(res, opts, status = 200) {
  res.status(status);
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "no-store");
  res.send(loginPage(opts));
}

function mountAuthRoutes(app) {
  app.get("/admin/login", (req, res) => {
    if (validSession(req)) return res.redirect(302, safeNext(req.query.next));
    sendLogin(res, {
      next: safeNext(req.query.next),
      note: req.query.out ? "You're signed out." : ""
    });
  });

  app.post("/admin/login", (req, res) => {
    if (!configured()) return res.status(500).send("Admin panel is not configured");
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "?";
    const f = failures.get(ip);
    if (f && f.until > Date.now() && f.count >= 8) {
      return sendLogin(res, { error: "Too many tries. Please wait 15 minutes.", next: safeNext(req.body?.next) }, 429);
    }
    const { username = "", password = "" } = req.body || {};
    const ok = sameText(username.trim(), process.env.ADMIN_USERNAME) && sameText(password, process.env.ADMIN_PASSWORD);
    if (!ok) {
      const cur = f && f.until > Date.now() ? f : { count: 0, until: Date.now() + 15 * 60 * 1000 };
      cur.count += 1;
      failures.set(ip, cur);
      return sendLogin(res, { error: "Wrong username or password.", next: safeNext(req.body?.next) }, 401);
    }
    failures.delete(ip);
    const expires = Date.now() + MAX_AGE_DAYS * 24 * 3600 * 1000;
    res.set(
      "Set-Cookie",
      `${COOKIE}=${expires}.${sign(expires)}; Max-Age=${MAX_AGE_DAYS * 24 * 3600}; ${cookieFlags(req)}`
    );
    res.redirect(303, safeNext(req.body?.next));
  });

  const logout = (req, res) => {
    res.set("Set-Cookie", `${COOKIE}=; Max-Age=0; ${cookieFlags(req)}`);
    res.redirect(303, "/admin/login?out=1");
  };
  app.post("/admin/logout", logout);
  app.get("/admin/logout", logout);
}

/**
 * Sign this browser in to the admin page (same 30-day cookie as the login form).
 * Used when the owner opens Chef's Kitchen from the FTR iOS app - they've already
 * proved it's them with a code sent to the owner's phone.
 */
function issueSession(req, res) {
  const expires = Date.now() + MAX_AGE_DAYS * 24 * 3600 * 1000;
  res.set("Set-Cookie", `${COOKIE}=${expires}.${sign(expires)}; Max-Age=${MAX_AGE_DAYS * 24 * 3600}; ${cookieFlags(req)}`);
}

/** One-time, one-minute codes the app uses to open the admin page signed in. */
const entryCodes = new Map(); // code -> expires
function newEntryCode() {
  const code = crypto.randomBytes(24).toString("base64url");
  const now = Date.now();
  for (const [k, t] of entryCodes) if (t < now) entryCodes.delete(k);
  entryCodes.set(code, now + 60 * 1000);
  return code;
}
function useEntryCode(code) {
  const key = String(code || "");
  const t = entryCodes.get(key);
  entryCodes.delete(key);
  return !!t && t >= Date.now();
}

module.exports = { requireAdminAuth, mountAuthRoutes, issueSession, configured, newEntryCode, useEntryCode };
