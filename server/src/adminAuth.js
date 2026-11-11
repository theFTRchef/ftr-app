/**
 * Admin sign-in with a proper login page and Log out button.
 *
 * Username/password come from ADMIN_USERNAME / ADMIN_PASSWORD in .env.
 * Signing in sets a signed, HttpOnly cookie that lasts 30 days on that
 * device. Log out clears it. Changing ADMIN_PASSWORD signs out every
 * device (the cookie signature is tied to the password).
 *
 * Google sign-in (recommended): set GOOGLE_OAUTH_CLIENT_ID,
 * GOOGLE_OAUTH_CLIENT_SECRET and ADMIN_GOOGLE_EMAIL (default
 * thechef@franklintiffinroom.com). Then Chef's Kitchen, on the web and in the
 * apps, only opens for that Google account; the password form and the
 * phone-only app handoff are turned off (ADMIN_ALLOW_PASSWORD=1 keeps the
 * password form as a backup). Turning Google on signs out every device once.
 */
const crypto = require("crypto");

const COOKIE = "ftr_admin";
const MAX_AGE_DAYS = 30;
const failures = new Map(); // ip -> { count, until }

function passwordConfigured() {
  return !!(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD);
}

function googleConfigured() {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

/** The password form works when there's no Google sign-in, or when it's kept as a backup. */
function passwordAllowed() {
  return passwordConfigured() && (!googleConfigured() || process.env.ADMIN_ALLOW_PASSWORD === "1");
}

function configured() {
  return passwordConfigured() || googleConfigured();
}

function adminEmails() {
  return String(process.env.ADMIN_GOOGLE_EMAIL || "thechef@franklintiffinroom.com")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function key() {
  return crypto
    .createHash("sha256")
    .update(`ftr-admin|${process.env.ADMIN_USERNAME}|${process.env.ADMIN_PASSWORD}|${process.env.SESSION_SECRET || ""}|${googleConfigured() ? "google:" + process.env.GOOGLE_OAUTH_CLIENT_ID + ":" + adminEmails().join(",") : ""}`)
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
      .send("Admin panel is not configured - set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET (or ADMIN_USERNAME and ADMIN_PASSWORD) in .env");
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
  const google = googleConfigured();
  const pw = passwordAllowed();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · FTR Chef's Kitchen</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/app/seal.png" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700&family=Oswald:wght@500&display=swap" rel="stylesheet">
<style>
:root { --bg:#F7F1E8; --card:#FFFDF9; --ink:#3E2C28; --muted:#6E5D55; --line:#E4D8C6; --leaf:#A4483F; --gold:#B9954A; --bad:#9E3A2E; }
@media (prefers-color-scheme: dark) { :root { --bg:#1F1B18; --card:#2A2521; --ink:#F3EBDD; --muted:#BFB2A3; --line:#433C35; --leaf:#E08A7E; --gold:#D9B76A; --bad:#F08A7C; } }
* { box-sizing:border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--ink);
  font:16px/1.45 "Archivo", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding:16px; }
.card { width:100%; max-width:380px; background:var(--card); border:1px solid var(--line); border-top:4px solid var(--gold); border-radius:20px; padding:28px 24px; text-align:center; }
.card label, .card input, .err { text-align:left; }
.logo { width:96px; height:96px; display:block; margin:0 auto 14px; }
h1 { font:500 24px/1.1 "Oswald", "Arial Narrow", sans-serif; letter-spacing:.04em; text-transform:uppercase; margin:0 0 6px; }
p { margin:0 0 20px; color:var(--muted); font-size:14.5px; }
label { display:block; font-weight:600; font-size:14px; margin:14px 0 6px; }
input { width:100%; font:inherit; padding:12px 14px; border:1px solid var(--line); border-radius:12px; background:transparent; color:var(--ink); }
input:focus { outline:2px solid var(--leaf); outline-offset:1px; border-color:transparent; }
button { width:100%; margin-top:22px; font:inherit; font-weight:700; padding:13px; border:0; border-radius:999px; background:var(--leaf); color:#fff; cursor:pointer; }
@media (prefers-color-scheme: dark) { button { color:#2E2A26; } }
.err { color:var(--bad); font-weight:600; font-size:14px; margin:14px 0 0; }
.note { color:var(--leaf); font-weight:600; font-size:14px; margin:0 0 6px; }
.g { display:flex; align-items:center; justify-content:center; gap:10px; width:100%; margin-top:8px; padding:13px; border:1px solid var(--line); border-radius:999px; background:var(--card); color:var(--ink); font-weight:700; text-decoration:none; }
.g:focus-visible { outline:2px solid var(--leaf); outline-offset:2px; }
.or { text-align:center; color:var(--muted); font-size:13px; margin:18px 0 0; }
</style></head><body>
<form class="card" method="post" action="/admin/login">
  <img class="logo" src="/app/seal.png" alt="Franklin Tiffin Room seal" width="96" height="96">
  <h1>FTR Chef's Kitchen</h1>
  <p>${google ? "Sign in with Chef's Google account." : "Franklin Tiffin Room admin"}</p>
  ${note ? `<div class="note">${esc(note)}</div>` : ""}
  ${google ? `<a class="g" href="/admin/google/start?next=${encodeURIComponent(next)}"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Sign in with Google</a>` : ""}
  ${error ? `<div class="err" role="alert">${esc(error)}</div>` : ""}
  ${pw ? `${google ? '<div class="or">or use the backup password</div>' : ""}
  <input type="hidden" name="next" value="${esc(next)}">
  <label for="u">Username</label>
  <input id="u" name="username" autocomplete="username" autocapitalize="none" required ${google ? "" : "autofocus"}>
  <label for="p">Password</label>
  <input id="p" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Sign in</button>` : ""}
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
    if (!passwordAllowed()) return sendLogin(res, { error: "Please sign in with Google.", next: safeNext(req.body?.next) }, 403);
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

  // --- Google sign-in (OpenID Connect, authorization code + PKCE) ---
  app.get("/admin/google/start", (req, res) => {
    if (!googleConfigured()) return res.redirect(302, "/admin/login");
    const now = Date.now();
    for (const [k, v] of oauthStates) if (v.expires < now) oauthStates.delete(k);
    const state = crypto.randomBytes(24).toString("base64url");
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const nonce = crypto.randomBytes(16).toString("base64url");
    oauthStates.set(state, { verifier, nonce, app: req.query.app === "1", next: safeNext(req.query.next), expires: now + 10 * 60 * 1000 });
    const q = new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: "openid email",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
      login_hint: adminEmails()[0] || ""
    });
    res.set("Cache-Control", "no-store");
    res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  });

  app.get("/admin/google/callback", async (req, res) => {
    const st = oauthStates.get(String(req.query.state || ""));
    oauthStates.delete(String(req.query.state || ""));
    const fail = (msg, status = 403) => sendLogin(res, { error: msg, next: st ? st.next : "/admin" }, status);
    if (!googleConfigured()) return res.redirect(302, "/admin/login");
    if (!st || st.expires < Date.now()) return fail("That sign-in took too long or was already used. Please try again.", 400);
    if (req.query.error) return fail("Google sign-in was cancelled.", 400);
    try {
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: String(req.query.code || ""),
          client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
          client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
          redirect_uri: redirectUri(),
          grant_type: "authorization_code",
          code_verifier: st.verifier
        })
      });
      const tok = await r.json();
      if (!r.ok || !tok.id_token) return fail("Google didn't confirm the sign-in. Please try again.", 400);
      // The ID token came straight from Google over TLS, so its claims can be trusted
      // without checking the signature (OpenID Connect Core 3.1.3.7); still check every claim.
      const claims = JSON.parse(Buffer.from(tok.id_token.split(".")[1], "base64url").toString("utf8"));
      const email = String(claims.email || "").toLowerCase();
      const good =
        ["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) &&
        claims.aud === process.env.GOOGLE_OAUTH_CLIENT_ID &&
        Number(claims.exp) * 1000 > Date.now() &&
        claims.nonce === st.nonce &&
        claims.email_verified === true;
      if (!good) return fail("Google didn't confirm the sign-in. Please try again.", 400);
      if (!adminEmails().includes(email)) {
        console.warn(`[admin] Google sign-in refused for ${email}`);
        return fail(`${email} isn't Chef's account. Sign in with ${adminEmails()[0]}.`);
      }
      console.log(`[admin] Chef signed in with Google (${st.app ? "app" : "browser"})`);
      if (st.app) {
        // Back to the FTR-DOSE app, which opens Chef's Kitchen with this one-time code.
        res.set("Cache-Control", "no-store");
        return res.redirect(302, `ftrdose://kitchen?code=${encodeURIComponent(newEntryCode())}`);
      }
      issueSession(req, res);
      res.redirect(303, st.next);
    } catch (err) {
      console.error("[admin] Google sign-in failed:", err.message);
      fail("Couldn't reach Google. Please try again.", 502);
    }
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

const oauthStates = new Map(); // state -> { verifier, nonce, app, next, expires }
function redirectUri() {
  return `${(process.env.PUBLIC_BASE_URL || "https://bot.franklintiffinroom.com").replace(/\/+$/, "")}/admin/google/callback`;
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

module.exports = { requireAdminAuth, mountAuthRoutes, issueSession, configured, googleConfigured, newEntryCode, useEntryCode, validSession };
