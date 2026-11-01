const fs = require("fs");
const { tokenGenerate } = require("@vonage/jwt");

const MESSAGES_API_URL = "https://api.nexmo.com/v1/messages";

let cachedPrivateKey = null;
function getPrivateKey() {
  if (!cachedPrivateKey) {
    cachedPrivateKey = fs.readFileSync(process.env.VONAGE_PRIVATE_KEY_PATH);
  }
  return cachedPrivateKey;
}

/**
 * Generates a short-lived JWT for authenticating a single request.
 * Vonage Application v1 Messages API requires JWT Bearer auth - the
 * API key/secret Basic auth from Vonage's older APIs does NOT work here.
 */
function generateJwt() {
  const applicationId = process.env.VONAGE_APPLICATION_ID;
  const privateKey = getPrivateKey();
  return tokenGenerate(applicationId, privateKey, {
    exp: Math.round(Date.now() / 1000) + 60 * 5 // 5 minute expiry is plenty
  });
}

/**
 * Sends a raw payload to the Messages API. `to` should be a plain number
 * string without a leading + (e.g. "12145551234").
 */
async function sendMessage(payload) {
  const jwt = generateJwt();

  const res = await fetch(MESSAGES_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Vonage Messages API error ${res.status}: ${body || res.statusText}`
    );
  }

  return res.json().catch(() => ({}));
}

/**
 * Downloads a picture a customer sent (Vonage gives us a link to it).
 * Vonage's media links need the same JWT sign-in as sending; try that
 * first, then a plain download in case the link is already public.
 */
async function downloadMedia(url) {
  if (!/^https:\/\//.test(url || "")) throw new Error("No media link");
  let res = await fetch(url, { headers: { Authorization: `Bearer ${generateJwt()}` } });
  if (res.status === 401 || res.status === 403) res = await fetch(url);
  if (!res.ok) throw new Error(`Media download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 10 * 1024 * 1024) throw new Error("Picture is too large");
  return buf;
}

module.exports = { sendMessage, downloadMedia, generateJwt };
