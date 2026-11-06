// "Get the FTR app" link: bot.franklintiffinroom.com/app
// One link (and one QR code) for every flyer: iPhones go to the App Store,
// Android phones go to Google Play, anything else gets a small page with both.
const path = require("path");

// Fill APP_STORE_URL in once Apple approves FTR-DOSE (apps.apple.com/app/id...).
// Until then iPhone visitors see the page below with "coming soon".
const APP_STORE_URL = process.env.APP_STORE_URL || "";
const PLAY_URL = process.env.PLAY_STORE_URL || "https://play.google.com/store/apps/details?id=com.franklintiffinroom.app";

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function page(device) {
  const wa = String(process.env.WHATSAPP_FROM_NUMBER || "").replace(/\D/g, "");
  const ios = APP_STORE_URL
    ? `<a class="btn" href="${esc(APP_STORE_URL)}">Get it on the App Store</a>`
    : `<span class="btn off">iPhone app: coming soon to the App Store</span>`;
  const android = `<a class="btn" href="${esc(PLAY_URL)}">Get it on Google Play</a>`;
  const first = device === "android" ? android + ios : ios + android;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Get the FTR-DOSE app</title>
<meta property="og:title" content="Order FTR from your phone">
<meta property="og:description" content="The FTR-DOSE app, on iPhone and Android. Live on-site Masala Dose, Dose-in-a-Box and catering.">
<meta property="og:image" content="/app/seal.png">
<style>
:root{color-scheme:light}
body{margin:0;background:#F7F1E8;color:#3E2C28;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:420px;margin:0 auto;padding:40px 20px 32px;text-align:center}
img{width:180px;height:180px}
h1{font:600 28px/1.1 "Oswald","Arial Narrow",sans-serif;text-transform:uppercase;letter-spacing:.5px;margin:20px 0 6px}
.tag{font:italic 18px Georgia,serif;color:#A4483F;margin:0 0 24px}
.btn{display:block;margin:0 0 12px;padding:15px 18px;border-radius:999px;background:#A4483F;color:#fff;text-decoration:none;font-weight:600}
.btn:focus-visible{outline:3px solid #2E2A26;outline-offset:3px}
.btn.off{background:#EEE6D8;color:#6E5D55;font-weight:500}
.alt{display:block;margin-top:8px;color:#3E2C28}
.foot{margin-top:28px;font-size:13px;color:#6E5D55}
</style></head><body><main>
<img src="/app/seal.png" alt="Franklin Tiffin Room seal, since 2025, NJ USA">
<h1>Order FTR from your phone</h1>
<p class="tag">The FTR-DOSE app, on iPhone and Android</p>
${first}
${wa ? `<a class="alt" href="https://wa.me/${wa}">Or order on WhatsApp</a>` : ""}
<p class="foot">Live on-site Masala Dose · 100% vegetarian<br>1-234-FTR-DOSE (387-3673)</p>
</main></body></html>`;
}

function device(ua) {
  ua = String(ua || "");
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && /mobile/i.test(ua))) return "ios";
  return "other";
}

function register(app) {
  app.get("/app/seal.png", (req, res) => {
    res.set("Cache-Control", "public, max-age=86400");
    res.sendFile(path.join(__dirname, "..", "public", "seal.png"));
  });
  app.get(["/app", "/app/"], (req, res) => {
    const d = device(req.get("user-agent"));
    if (req.query.page === undefined) {
      if (d === "android") return res.redirect(302, PLAY_URL);
      if (d === "ios" && APP_STORE_URL) return res.redirect(302, APP_STORE_URL);
    }
    res.set("Cache-Control", "no-store");
    res.type("html").send(page(d));
  });
}

module.exports = { register, device };
