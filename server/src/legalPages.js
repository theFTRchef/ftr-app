// Public pages the app stores require: bot.franklintiffinroom.com/privacy and /support.
// Plain HTML, same Warm Sand look as /app. Update EFFECTIVE when the policy changes.

const EFFECTIVE = "November 13, 2026";
const EMAIL = "thechef@franklintiffinroom.com";
const PHONE = "1-234-FTR-DOSE (387-3673)";

function shell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Franklin Tiffin Room</title>
<style>
:root{color-scheme:light}
body{margin:0;background:#F7F1E8;color:#3E2C28;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:680px;margin:0 auto;padding:36px 20px 48px}
header{display:flex;align-items:center;gap:12px;margin-bottom:24px}
header img{width:56px;height:56px}
header b{display:block;font:600 16px/1.2 "Oswald","Arial Narrow",sans-serif;letter-spacing:1px}
header span{font:italic 13px Georgia,serif;color:#6E5D55}
h1{font:600 30px/1.15 "Oswald","Arial Narrow",sans-serif;text-transform:uppercase;margin:0 0 4px}
h2{font-size:18px;margin:28px 0 6px}
.muted{color:#6E5D55;font-size:14px}
a{color:#A4483F}
a:focus-visible{outline:3px solid #2E2A26;outline-offset:2px}
ul{padding-left:20px}
.card{background:#FFFDF9;border:1px solid #E4D8C6;border-radius:16px;padding:16px 18px;margin:12px 0}
</style></head><body><main>
<header><img src="/app/seal.png" alt=""><div><b>FRANKLIN TIFFIN ROOM</b><span>bringing back the OG flavor of Masale Dose</span></div></header>
${body}
<p class="muted" style="margin-top:36px">Franklin Tiffin Room LLC · Somerset, New Jersey · <a href="mailto:${EMAIL}">${EMAIL}</a> · ${PHONE}</p>
</main></body></html>`;
}

function privacy() {
  return shell("Privacy policy", `
<h1>Privacy policy</h1>
<p class="muted">Effective ${EFFECTIVE}. Applies to the FTR-DOSE app for iPhone and Android, the FTR WhatsApp ordering chat, and this website.</p>

<p>Franklin Tiffin Room LLC ("FTR", "we") is a home catering business in Somerset, New Jersey. We collect only what we need to take and deliver your food orders, and we never sell your information or use it for advertising.</p>

<h2>What we collect</h2>
<ul>
<li><b>Your name and mobile number</b>, to sign you in (we text a one-time code) and to contact you about orders.</li>
<li><b>Order details</b>: the dishes, dates, party size, pickup or delivery choice, and any notes you add.</li>
<li><b>Delivery or event address</b>, when you choose delivery or book the LIVE Dose Station. We check that it is a real US address.</li>
<li><b>Payment confirmations</b>: if you send a screenshot of a deposit or payment, we keep it with that order. We do not receive or store card or bank numbers.</li>
<li><b>Messages</b> between you and Chef, and feedback or quote requests you send.</li>
<li><b>Gift QR code scans</b>: when you scan the code on an FTR gift packet, we record which code, when, the kind of phone, and your name and number if you are signed in or choose to give them, plus any feedback you send. Gift codes work on one phone only; some recipe codes can be shared.</li>
<li><b>Saved recipes</b>: if you tap Save to my account on a recipe, we keep which recipe code you saved and when, so it stays in Account → My recipes. You can remove it there at any time.</li>
<li><b>Ratings</b>: if you rate a dish you ordered, we keep your stars, any comment and your name. The menu shows only each dish's average and number of ratings, never names or comments; Chef reads the comments.</li>
<li><b>A notification token</b> from your phone, so we can send order updates and (only if you turn them on) announcements of new dishes.</li>
</ul>
<p>The app uses the camera only while you scan a QR code; no picture is taken or sent. We do not collect your location, contacts, photos (other than ones you choose to send), or any advertising or tracking identifiers, and the app contains no ads or third-party analytics.</p>

<h2>How we use it</h2>
<ul>
<li>To take, approve, prepare and deliver your orders, and to tell you about their status and payments.</li>
<li>To answer your questions and requests.</li>
<li>To tell you about new dishes and festival menus, only if you turn on "Alerts for new dishes & announcements". You can turn this off any time in Account.</li>
</ul>

<h2>Who we share it with</h2>
<p>Only the service providers that run the ordering system for us, and only for that purpose:</p>
<ul>
<li>Vonage, which sends our WhatsApp messages and sign-in text codes.</li>
<li>Google, which hosts our server (Google Cloud) and our order records (Google Sheets).</li>
<li>Apple and Google, which deliver app notifications.</li>
<li>The US Census Bureau address lookup (or Google Maps), which checks delivery addresses.</li>
</ul>
<p>We may also disclose information if the law requires it. We do not sell or rent your information to anyone.</p>

<h2>How long we keep it</h2>
<p>We keep order records for as long as we need them to run the business and meet tax and legal record-keeping rules. If you delete your account, we remove your profile, saved cart, saved recipes, ratings, messages and notification token; records of past orders may be kept for our books.</p>

<h2>Your choices</h2>
<ul>
<li><b>Delete your account</b> in the app: Account → Delete my account. Or email us and we will do it for you.</li>
<li><b>See or correct your information</b>: email us, or update your name in the app.</li>
<li><b>Stop announcements</b> in the app's Account page, or email us.</li>
</ul>

<h2>Children</h2>
<p>FTR-DOSE is meant for adults placing food orders and is not directed at children under 13. We do not knowingly collect information from children.</p>

<h2>Security</h2>
<p>Information travels over encrypted connections (HTTPS), and access to our order system is limited to Chef.</p>

<h2>Changes</h2>
<p>If we change this policy we will update the date at the top of this page, and tell you in the app for any important change.</p>

<h2>Contact</h2>
<p>Questions or requests: <a href="mailto:${EMAIL}">${EMAIL}</a> or ${PHONE}.</p>
`);
}

function support() {
  return shell("Support", `
<h1>Help &amp; support</h1>
<p>Questions about an order, a catering quote, or the FTR-DOSE app? Chef answers personally.</p>
<div class="card"><b>Email</b><br><a href="mailto:${EMAIL}">${EMAIL}</a></div>
<div class="card"><b>Call or WhatsApp</b><br>${PHONE}</div>
<h2>Common questions</h2>
<p><b>How do I order?</b> Open the app, pick from the catering menu, the LIVE Dose Station or Dose-in-a-Box, and send your order. Chef reviews it and the app tells you when it is approved and if a deposit is due. You can also order on WhatsApp.</p>
<p><b>I didn't get my sign-in code.</b> Check that your number is right, wait a minute and tap "Send again". Still stuck? Email us.</p>
<p><b>How do I delete my account?</b> In the app, go to Account → Delete my account. Or email us.</p>
<p><a href="/privacy">Privacy policy</a> · <a href="/app">Get the app</a></p>
`);
}

function register(app) {
  app.get(["/privacy", "/privacy/"], (req, res) => res.type("html").send(privacy()));
  app.get(["/support", "/support/"], (req, res) => res.type("html").send(support()));
}

module.exports = { register };
