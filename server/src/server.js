require("dotenv").config();
const path = require("path");
const express = require("express");
const { handleIncoming } = require("./orderFlow");
const { verifyAddress } = require("./geocode");
const { requireAdminAuth, mountAuthRoutes } = require("./adminAuth");
const menuStore = require("./menuStore");
const payments = require("./payments");
const { paymentText } = require("./paymentText");

const app = express();
app.disable("x-powered-by");
// Security headers on every response (the admin page must not be framed by other sites).
app.use((req, res, next) => {
  res.set({
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  });
  next();
});
// Keep the raw body so Vonage's webhook signature can be checked.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));

/**
 * Vonage signs every Messages API webhook with a JWT (HS256, the account's
 * signature secret) whose payload_hash is the SHA-256 of the body. With
 * VONAGE_SIGNATURE_SECRET set, unsigned or tampered webhooks are refused, so
 * nobody can fake a WhatsApp message from Chef or a customer.
 */
function vonageSigned(req) {
  const secret = process.env.VONAGE_SIGNATURE_SECRET;
  if (!secret) {
    if (!vonageSigned.warned) { console.warn("[webhooks] VONAGE_SIGNATURE_SECRET not set: inbound webhooks are not verified"); vonageSigned.warned = true; }
    return true;
  }
  try {
    const m = /^Bearer\s+(.+)$/i.exec(req.get("authorization") || "");
    if (!m) return false;
    const [h, p, sig] = m[1].split(".");
    const crypto = require("crypto");
    const want = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
    if (!sig || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return false;
    const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (claims.exp && claims.exp * 1000 < Date.now()) return false;
    if (claims.payload_hash) {
      const hash = crypto.createHash("sha256").update(req.rawBody || Buffer.from("")).digest("hex");
      if (hash !== claims.payload_hash) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function normalizeInbound(body) {
  const from =
    typeof body.from === "string" ? body.from : body.from?.number || null;

  const messageType = body.message_type || body.message?.content?.type;

  let text = null;
  let reply = null;

  if (messageType === "text") {
    text = body.text ?? body.message?.content?.text ?? null;
  } else if (messageType === "reply") {
    reply = body.reply ?? null;
  } else if (messageType === "image") {
    const img = body.image || body.message?.content?.image || {};
    return { from, message_type: "image", text: null, reply: null, image: { url: img.url, caption: img.caption || null } };
  } else if (messageType === "button") {
    const btn = body.message?.content?.button;
    if (btn) {
      reply = { id: btn.payload, title: btn.text };
    }
  }

  return { from, message_type: reply ? "reply" : messageType, text, reply };
}

mountAuthRoutes(app);

// --- FTR iOS app (customer ordering). Same menu, dates, approval flow and
// Google Sheet as WhatsApp orders - see src/appApi.js.
app.use("/api/v1", require("./appApi").router());

app.post("/webhooks/inbound", async (req, res) => {
  if (!vonageSigned(req)) {
    console.warn("[webhooks] refused an unsigned or invalid inbound webhook");
    return res.status(401).end();
  }
  res.status(200).end();
  try {
    const payload = normalizeInbound(req.body);
    if (!payload.from || !payload.message_type) {
      console.warn(
        "Unrecognized inbound payload shape:",
        JSON.stringify(req.body)
      );
      return;
    }
    // Remember when this number last wrote on WhatsApp (24-hour window),
    // so app customers only get WhatsApp copies while WhatsApp allows it.
    require("./appInbox").noteWhatsAppInbound(payload.from);
    await handleIncoming(payload);
  } catch (err) {
    console.error("Error handling inbound message:", err);
  }
});

app.post("/webhooks/status", (req, res) => {
  if (!vonageSigned(req)) return res.status(401).end();
  res.status(200).end();
  const b = req.body || {};
  // Delivered/read receipts are routine - only log problems.
  if (b.status === "rejected" || b.status === "failed" || b.error) {
    console.log("Status callback:", JSON.stringify(b));
  }
  require("./messaging").handleStatus(b).catch((err) => console.error("Status handling failed:", err.message));
});

// --- Admin panel: menu management ---
// The admin app is one page (public/admin.html) written without its own
// <html>/<head> wrapper so the same file also works as a preview page;
// add the wrapper here so browsers render it in standards mode.
function sendAdminApp(req, res) {
  const fs = require("fs");
  const body = fs.readFileSync(path.join(__dirname, "..", "public", "admin.html"), "utf8");
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "no-store");
  res.send('<!doctype html><html lang="en"><head><meta charset="utf-8">' + body + "</html>");
}

app.get("/admin", requireAdminAuth, sendAdminApp)

app.get("/admin/api/menu", requireAdminAuth, (req, res) => {
  try {
    res.json(menuStore.getMenu());
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.put("/admin/api/menu", requireAdminAuth, async (req, res) => {
  try {
    const menu = req.body;
    // Look up the kitchen address (once, when it's new or changed) so the
    // bot can measure delivery distances from it.
    const d = (menu.settings && menu.settings.delivery) || null;
    if (d) {
      const typed = (d.kitchenAddress || "").trim();
      const current = menuStore.getMenu().settings?.delivery || {};
      if (!typed) {
        d.kitchenLat = null;
        d.kitchenLon = null;
      } else if (typed !== current.kitchenAddress || typeof current.kitchenLat !== "number") {
        const result = await verifyAddress(typed);
        if (result.status !== "match") {
          return res
            .status(400)
            .send(
              result.status === "none"
                ? `Couldn't find the kitchen address "${typed}" - please check the street number, street, town and ZIP.`
                : "The address lookup service didn't respond - please try saving again in a minute."
            );
        }
        d.kitchenAddress = result.matches[0].label;
        d.kitchenLat = result.matches[0].lat;
        d.kitchenLon = result.matches[0].lon;
      } else {
        d.kitchenLat = current.kitchenLat;
        d.kitchenLon = current.kitchenLon;
      }
    }
    const saved = menuStore.saveMenu(menu);
    // Dishes customers can see for the first time get announced (Setup switch).
    try { require("./broadcasts").noteMenuSaved(saved); } catch (e) { console.error("New-dish check failed:", e.message); }
    res.json(saved);
  } catch (err) {
    res.status(400).send(err.message);
  }
});

// --- Admin: orders & customers ---
const orderDb = require("./orderDb");
const customerStore = require("./customerStore");
const { HEADER, itemsText } = require("./sheets");

function ordersNewestFirst() {
  return orderDb
    .all()
    .slice()
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sendCsv(res, filename, header, rows) {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("﻿" + body); // BOM so Excel reads accents/symbols correctly
}

function localStamp(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York" });
}

app.get("/admin/orders", requireAdminAuth, sendAdminApp);

app.get("/admin/api/orders", requireAdminAuth, (req, res) => {
  res.json(ordersNewestFirst().map((o) => ({ ...o, itemsText: itemsText(o) })));
});

const records = require("./records");

app.delete("/admin/api/orders/:id", requireAdminAuth, async (req, res) => {
  const result = await records.deleteOrder(req.params.id);
  if (!result.deleted) return res.status(404).send("Order not found");
  res.json(result);
});

// Chef cancels an order (only before the 50% deposit is paid).
app.post("/admin/api/orders/:id/cancel", requireAdminAuth, async (req, res) => {
  try {
    const r = await require("./orderFlow").cancelOrder(req.params.id, "chef");
    if (!r.ok) return res.status(400).send(r.reason);
    res.json(require("./orderDb").get(req.params.id));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Add an order from before the WhatsApp bot, tied to a phone number.
function normalizePhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10) return "1" + d;
  if (d.length === 11 && d.startsWith("1")) return d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}
app.post("/admin/api/orders/past", requireAdminAuth, async (req, res) => {
  const b = req.body || {};
  const phone = normalizePhone(b.phone);
  if (!phone) return res.status(400).send("Please enter a valid phone number (10 digits for a US number).");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || "")) return res.status(400).send("Please pick the order date.");
  const total = Number(b.total);
  if (!(total >= 0)) return res.status(400).send("Please enter the order total.");
  if (!String(b.items || "").trim()) return res.status(400).send("Please describe what was ordered.");
  const existing = customerStore.get(phone);
  const firstName = String(b.firstName || "").trim();
  const lastName = String(b.lastName || "").trim();
  if (!existing && !firstName) return res.status(400).send("This is a new customer - please enter their first name.");
  // Fill in the customer's name only where it's missing (never overwrite).
  const patch = {};
  if (firstName && !(existing && existing.firstName)) patch.firstName = firstName;
  if (lastName && !(existing && existing.lastName)) patch.lastName = lastName;
  if (!existing || Object.keys(patch).length) customerStore.save(phone, patch);
  const profile = customerStore.get(phone);
  const [y, m, d] = b.date.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const order = {
    orderId: "PAST-" + Date.now().toString(36).toUpperCase(),
    source: "past",
    customerPhone: phone,
    customerName: customerStore.fullName(profile),
    cart: [],
    itemsManual: String(b.items).trim().slice(0, 1000),
    orderNote: String(b.notes || "").trim().slice(0, 500) || null,
    subtotal: Math.round(total * 100) / 100,
    fulfillment: String(b.kind || "pickup"),
    eventDate: b.date,
    requestedTime: label,
    status: "Confirmed",
    pending: false,
    createdAt: new Date(Date.UTC(y, m - 1, d, 17)).toISOString(),
    addedByAdminAt: new Date().toISOString()
  };
  await records.appendOrder(order);
  res.json(order);
});

// --- Comments & suggestions ---
// --- Pre-orders (Dose-in-a-Box, weekly takeout): prep list per pickup day ---
app.get("/admin/api/preorders", requireAdminAuth, (req, res) => {
  const pre = require("./preorders");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const days = pre.all(menuStore.getMenu()).filter((e) => e.date >= today);
  const menu = menuStore.getMenu();
  res.json(days.map((e) => ({ ...e, open: Date.now() < e.cutoff && !e.cancelled, ...pre.prepList(e.date), status: pre.dayStatus(menu, e.date) })));
});

// Chef cancels a whole pre-order pickup day: every customer gets a regret message.
app.post("/admin/api/preorders/:date/cancel", requireAdminAuth, async (req, res) => {
  if ((req.body || {}).confirm !== "CANCEL") return res.status(400).send("Type CANCEL to confirm.");
  try {
    const r = await require("./preorders").cancelBatch(req.params.date);
    if (!r.ok) return res.status(400).send(r.reason);
    res.json(r);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/admin/api/feedback", requireAdminAuth, (req, res) => {
  res.json(require("./feedbackStore").all().slice().reverse());
});
app.post("/admin/api/feedback/read", requireAdminAuth, (req, res) => {
  require("./feedbackStore").markRead(Array.isArray((req.body || {}).ids) ? req.body.ids : []);
  res.json({ ok: true });
});
app.delete("/admin/api/feedback/:id", requireAdminAuth, (req, res) => {
  const removed = require("./feedbackStore").remove(req.params.id);
  if (!removed) return res.status(404).send("Comment not found");
  res.json({ deleted: req.params.id });
});

// Approve / Decline / Payment received / Not received / Send quote from the
// admin page (on the web or inside the FTR app). Each one replays exactly the
// WhatsApp button the bot sends the owner, so customers, the Google Sheet and
// Zelle deposits behave the same whichever way Chef decides.
app.post("/admin/api/orders/:id/decision", requireAdminAuth, async (req, res) => {
  const owner = process.env.OWNER_WHATSAPP_NUMBER;
  if (!owner) return res.status(400).send("Set OWNER_WHATSAPP_NUMBER in .env first.");
  const id = req.params.id;
  const o = orderDb.get(id);
  if (!o) return res.status(404).send("Order not found");
  const { action, price, note, time, message } = req.body || {};
  const pay = o.payment && ["awaiting", "review"].includes(o.payment.state);
  const custom = o.type === "custom";
  const ok =
    (["approve", "decline", "time", "message", "endchat"].includes(action) && o.pending && !custom && /pending approval/i.test(o.status || "")) ||
    (["paid", "unpaid"].includes(action) && pay) ||
    (["quote", "cdecline"].includes(action) && o.pending && custom && !o.quoted);
  if (!ok) return res.status(409).send("This order isn't waiting on that any more - refresh to see where it is.");
  if (action === "quote" && !(Number(price) > 0)) return res.status(400).send("Enter the price for the quote.");
  if (action === "time" && !String(time || "").trim()) return res.status(400).send('Enter the new time, e.g. "12:30 PM".');
  if (action === "message" && !String(message || "").trim()) return res.status(400).send("Type your message to the customer.");
  if (action === "time" && !require("./orderFlow").shared.parseChefTime(String(time), o)) {
    return res.status(400).send('Couldn\'t read that time. Use e.g. "12:30 PM", "6:30 PM - 8:30 PM", or "11/8 12:30 PM" to change the day too.');
  }
  const reply = (rid) => handleIncoming({ from: owner, message_type: "reply", reply: { id: rid, title: rid } });
  const text = (t) => handleIncoming({ from: owner, message_type: "text", text: t });
  try {
    if (action === "approve") await reply(`approve:${id}`);
    else if (action === "decline") await reply(`decline:${id}`);
    else if (action === "time") {
      await reply(`edt:${id}`);
      await text(String(time).trim());
    } else if (action === "message") {
      await reply(`msg:${id}`);
      await text(String(message).trim().slice(0, 1500));
    } else if (action === "endchat") await reply(`chatend:${id}`);
    else if (action === "paid") await reply(`paid:${id}`);
    else if (action === "unpaid") await reply(`unpaid:${id}`);
    else if (action === "quote") {
      await reply(`cquote:${id}`);
      await text(String(Number(price)));
      await text(String(note || "").trim() || "skip");
    } else if (action === "cdecline") {
      await reply(`cdecline:${id}`);
      await text(String(note || "").trim() || "skip");
    }
  } catch (err) {
    // The decision is saved before the bot's WhatsApp note to you goes out; a
    // failed note (e.g. WhatsApp's 24-hour window) doesn't undo it.
    console.error(`Admin decision ${action} for ${id}: WhatsApp note failed:`, err.message);
  }
  const updated = orderDb.get(id);
  res.json({ ...updated, itemsText: itemsText(updated) });
});

// FTR app: Chef's Kitchen opens here with a one-time code (see appApi.js /admin/handoff).
app.get("/admin/app-entry", (req, res) => {
  if (!require("./adminAuth").useEntryCode(req.query.code, req.query.v)) return res.redirect(302, "/admin/login");
  require("./adminAuth").issueSession(req, res, "FTR-DOSE app");
  res.redirect(302, "/admin");
});

// Chef's Kitchen › Setup › Signed-in devices
app.get("/admin/api/sessions", requireAdminAuth, (req, res) => {
  res.json(require("./adminAuth").listSessions(req));
});
app.delete("/admin/api/sessions/:id", requireAdminAuth, (req, res) => {
  res.json({ ok: require("./adminAuth").endSession(String(req.params.id)) });
});
app.post("/admin/api/sessions/sign-out-others", requireAdminAuth, (req, res) => {
  require("./adminAuth").endOtherSessions(req);
  res.json({ ok: true });
});

app.post("/admin/api/orders/reset", requireAdminAuth, async (req, res) => {
  if ((req.body || {}).confirm !== "RESET") {
    return res.status(400).send('Type RESET to confirm');
  }
  // Saved customers are never touched by a reset - they can only be
  // deleted one at a time from the Customers page.
  const result = await records.resetAllOrders();
  require("./sessionStore").clearAll();
  res.json(result);
});

app.get("/admin/api/orders.csv", requireAdminAuth, (req, res) => {
  const rows = ordersNewestFirst().map((o) => [
    localStamp(o.createdAt),
    o.orderId,
    o.customerName || "",
    o.customerPhone || "",
    itemsText(o),
    Number(o.subtotal || 0).toFixed(2),
    o.fulfillment || "",
    o.address || "",
    o.requestedTime || "",
    o.status || "",
    paymentText(o)
  ]);
  sendCsv(res, "ftr-orders.csv", HEADER, rows);
});

app.get("/admin/api/customers.csv", requireAdminAuth, (req, res) => {
  const report = require("./customerReport");
  sendCsv(res, "ftr-customers.csv", report.COLUMNS, report.rows());
});

app.get("/admin/api/customers", requireAdminAuth, (req, res) => {
  res.json(require("./customerReport").customers());
});

// Delete ONE customer. The phone number must be sent again in the body as
// a deliberate confirmation - there is no "delete all customers".
app.delete("/admin/api/customers/:phone", requireAdminAuth, (req, res) => {
  const phone = req.params.phone;
  if ((req.body || {}).confirmPhone !== phone) {
    return res.status(400).send("Confirmation didn't match - customer not deleted.");
  }
  const removed = customerStore.remove(phone);
  if (!removed) return res.status(404).send("Customer not found");
  res.json({ deleted: phone });
});

// Friends & family switch for one customer.
app.post("/admin/api/customers/:phone/family", requireAdminAuth, (req, res) => {
  const saved = require("./broadcasts").setFamily(req.params.phone, (req.body || {}).family === true);
  if (!saved) return res.status(404).send("Customer not found");
  res.json({ phone: req.params.phone, family: saved.family === true });
});

// --- Announcements to customers ---
// --- Recipes (QR codes on give-away masala packets) ---
// Chef's recipe book (internal recipe cards, Chef only; content lives in the data folder, not Git)
app.get("/admin/api/book", requireAdminAuth, (req, res) => res.json({ cards: require("./chefBook").summary() }));
app.post("/admin/api/book/import", requireAdminAuth, (req, res) => {
  try {
    res.json({ ok: true, saved: require("./chefBook").importFile(req.body) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.delete("/admin/api/book/:id", requireAdminAuth, (req, res) => {
  if (!require("./chefBook").remove(String(req.params.id))) return res.status(404).json({ error: "Recipe not found" });
  res.json({ ok: true });
});
app.get("/admin/book/:id", requireAdminAuth, (req, res) => {
  const html = require("./chefBook").page(String(req.params.id));
  if (!html) return res.status(404).type("text").send("Recipe not found.");
  res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }).type("html").send(html);
});
app.get("/admin/api/recipes", requireAdminAuth, (req, res) => res.json({ recipes: require("./recipes").list() }));
app.post("/admin/api/recipes", requireAdminAuth, (req, res) => res.json(require("./recipes").create(req.body || {})));
app.put("/admin/api/recipes/:id", requireAdminAuth, (req, res) => {
  const r = require("./recipes").update(req.params.id, req.body || {});
  if (!r) return res.status(404).json({ error: "Recipe not found" });
  res.json(r);
});
app.delete("/admin/api/recipes/:id", requireAdminAuth, (req, res) => {
  if (!require("./recipes").remove(req.params.id)) return res.status(404).json({ error: "Recipe not found" });
  res.json({ ok: true });
});

app.get("/admin/api/broadcasts", requireAdminAuth, (req, res) => {
  const b = require("./broadcasts");
  res.json({ history: b.history(), pending: b.pending(), audiences: b.AUDIENCES });
});
app.get("/admin/api/broadcasts/preview", requireAdminAuth, (req, res) => {
  res.json(require("./broadcasts").preview(String(req.query.audience || "all")));
});
app.post("/admin/api/broadcasts", requireAdminAuth, async (req, res) => {
  try {
    const { title, text, audience, kind } = req.body || {};
    res.json(await require("./broadcasts").send({ title, text, audience, kind }));
  } catch (err) {
    res.status(400).send(err.message);
  }
});
app.post("/admin/api/broadcasts/pending/send", requireAdminAuth, async (req, res) => {
  try {
    res.json({ sent: await require("./broadcasts").sendPending() });
  } catch (err) {
    res.status(500).send(err.message);
  }
});
app.post("/admin/api/broadcasts/pending/skip", requireAdminAuth, (req, res) => {
  require("./broadcasts").skipPending();
  res.json({ skipped: true });
});

// --- Out-of-range LIVE Dose addresses waiting for Chef ---
app.get("/admin/api/range-requests", requireAdminAuth, (req, res) => {
  res.json(require("./orderFlow").rangeRequests());
});
app.post("/admin/api/range-requests/:phone", requireAdminAuth, async (req, res) => {
  try {
    const status = await require("./orderFlow").decideRange(req.params.phone, !!(req.body || {}).allow);
    res.json({ status });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// --- Zelle QR code (uploaded in admin Setup) ---
app.get("/admin/api/zelle-qr", requireAdminAuth, (req, res) => {
  res.json(payments.qrInfo());
});
app.put(
  "/admin/api/zelle-qr",
  requireAdminAuth,
  express.raw({ type: ["image/png", "image/jpeg"], limit: "5mb" }),
  (req, res) => {
    try {
      payments.saveQr(req.body, req.get("Content-Type") || "");
      res.json(payments.qrInfo());
    } catch (err) {
      res.status(400).send(err.message);
    }
  }
);
app.delete("/admin/api/zelle-qr", requireAdminAuth, (req, res) => {
  payments.removeQr();
  res.json(null);
});

function sniffType(file) {
  const fs = require("fs");
  const head = Buffer.alloc(4);
  const fd = fs.openSync(file, "r");
  fs.readSync(fd, head, 0, 4, 0);
  fs.closeSync(fd);
  if (head[0] === 0x89 && head[1] === 0x50) return "image/png";
  if (head.toString("ascii", 0, 4) === "RIFF") return "image/webp";
  return "image/jpeg";
}

// Public (WhatsApp fetches it to show customers).
app.get("/zelle-qr", (req, res) => {
  const f = payments.qrFile();
  if (!f) return res.status(404).send("No Zelle QR code uploaded");
  res.set("Content-Type", sniffType(f));
  res.set("Cache-Control", "public, max-age=300");
  res.sendFile(f);
});

// Payment screenshots forwarded to the chef. The link is a long random
// token, so it can't be guessed; WhatsApp needs it to be reachable.
app.get("/payment-proof/:token.jpg", (req, res) => {
  const f = payments.proofPath(req.params.token);
  if (!f) return res.status(404).send("Not found");
  res.set("Content-Type", sniffType(f));
  res.set("Cache-Control", "private, max-age=3600");
  res.sendFile(f);
});

// Public: the menu picture sent when a customer taps "See our menu".
app.get("/menu.png", async (req, res) => {
  try {
    const cat = typeof req.query.cat === "string" ? req.query.cat : null;
    const { png } = await require("./menuImage").renderPng(require("./availability").customerView(menuStore.getMenu()), cat);
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=300");
    res.send(png);
  } catch (err) {
    console.error("Menu image failed:", err.message);
    res.status(500).send("Menu image unavailable");
  }
});

// Public: the availability calendar picture the bot sends on WhatsApp.
// WhatsApp's servers fetch it by URL, so it can't sit behind the admin login.
app.get("/calendar.png", (req, res) => {
  try {
    const { png } = require("./calendarImage").renderPng(require("./availability").customerView(menuStore.getMenu()));
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=300");
    res.send(png);
  } catch (err) {
    console.error("Calendar image failed:", err.message);
    res.status(500).send("Calendar image unavailable");
  }
});

app.get("/healthz", (req, res) => res.status(200).send("ok"));

// Public: one "get the app" link for flyers and QR codes.
require("./appLink").register(app);
require("./legalPages").register(app);
// Recipe QR codes on give-away powder packets: the browser page says "scan in the app".
app.get("/r/:token", (req, res) => res.type("html").send(require("./recipes").webPage()));
// Public: single-use gift QR codes on product packets (recipe + survey).
require("./giftCodes").register(app, requireAdminAuth);

const port = process.env.PORT || 3000;
payments.startSweeper();
// Bring the Google Sheet "Customers" tab up to date at start-up.
require("./customerSheet").scheduleSync(10000);
// Send Chef the pre-order prep list when each order-by time passes.
require("./preorders").startWatcher();
require("./broadcasts").startWatcher();

app.listen(port, () => {
  console.log(`Franklin Tiffin Room order bot listening on port ${port}`);
  console.log(`Admin panel at http://localhost:${port}/admin`);
});
