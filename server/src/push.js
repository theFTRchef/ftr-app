/**
 * Apple Push Notifications for the FTR iOS app (optional).
 *
 * Turned on by four .env settings from your Apple Developer account
 * (Certificates, Identifiers & Profiles > Keys > "Apple Push Notifications
 * service (APNs)"):
 *   APNS_KEY_PATH   path to the downloaded AuthKey_XXXXXXXXXX.p8 file
 *   APNS_KEY_ID     the 10-character Key ID
 *   APNS_TEAM_ID    your 10-character Team ID
 *   APNS_BUNDLE_ID  the app's bundle id (e.g. com.franklintiffinroom.app)
 *
 * Without them, notify() quietly does nothing - customers still see every
 * update in the app's Messages tab.
 */
const fs = require("fs");
const crypto = require("crypto");
const http2 = require("http2");
const appUsers = require("./appUsers");

let cachedJwt = null;

function configured() {
  return !!(
    process.env.APNS_KEY_PATH &&
    process.env.APNS_KEY_ID &&
    process.env.APNS_TEAM_ID &&
    process.env.APNS_BUNDLE_ID &&
    fs.existsSync(process.env.APNS_KEY_PATH)
  );
}

/** ES256 provider token, reused for 50 minutes (Apple allows up to 60). */
function providerToken() {
  if (cachedJwt && Date.now() - cachedJwt.at < 50 * 60 * 1000) return cachedJwt.token;
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: process.env.APNS_KEY_ID })).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) })
  ).toString("base64url");
  const key = crypto.createPrivateKey(fs.readFileSync(process.env.APNS_KEY_PATH));
  const sig = crypto
    .sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" })
    .toString("base64url");
  cachedJwt = { token: `${header}.${claims}.${sig}`, at: Date.now() };
  return cachedJwt.token;
}

function sendOne(host, deviceToken, payload) {
  return new Promise((resolve) => {
    const client = http2.connect(`https://${host}`);
    client.on("error", (err) => resolve({ status: 0, reason: err.message }));
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${providerToken()}`,
      "apns-topic": process.env.APNS_BUNDLE_ID,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json"
    });
    let status = 0;
    let body = "";
    req.setTimeout(10000, () => req.close());
    req.on("response", (h) => (status = h[":status"]));
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      client.close();
      let reason = "";
      try { reason = JSON.parse(body).reason || ""; } catch (e) { /* empty body on success */ }
      resolve({ status, reason });
    });
    req.on("error", (err) => {
      client.close();
      resolve({ status: 0, reason: err.message });
    });
    req.end(JSON.stringify(payload));
  });
}

async function notify(phone, { title, body, data = {} }) {
  if (!configured()) return;
  const user = appUsers.get(phone);
  const tokens = (user && user.pushTokens) || [];
  if (!tokens.length) return;
  const unread = require("./appInbox").unreadCount(phone);
  const payload = { aps: { alert: { title, body }, sound: "default", badge: unread }, ...data };
  for (const t of tokens) {
    const host = t.environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
    const res = await sendOne(host, t.token, payload);
    if (res.status === 410 || res.reason === "BadDeviceToken" || res.reason === "Unregistered") {
      appUsers.removePushToken(t.token);
    } else if (res.status !== 200) {
      console.error(`APNs ${res.status} ${res.reason} for ${phone}`);
    }
  }
}

module.exports = { notify, configured, _providerToken: providerToken };
