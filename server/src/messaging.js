const { sendMessage } = require("./vonageClient");

const FROM = () => process.env.WHATSAPP_FROM_NUMBER;

// WhatsApp's limits for interactive messages. Anything longer makes
// WhatsApp reject the whole message ("1020 Invalid params"), so every
// field is trimmed to fit before sending.
const LIMIT = {
  header: 60,
  buttonBody: 1024,
  listBody: 4096,
  footer: 60,
  buttonTitle: 20,
  buttonId: 256,
  listButton: 20,
  sectionTitle: 24,
  rowTitle: 24,
  rowDescription: 72,
  rowId: 200
};

function fit(text, max) {
  const s = String(text ?? "").replace(/\s+/g, (m) => (m.includes("\n") ? m : " ")).trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

// Header/footer/titles must be one line.
function oneLine(text, max) {
  return fit(String(text ?? "").replace(/\s*\n\s*/g, " "), max);
}

// ---------------------------------------------------------------------
// Safety net: if WhatsApp still rejects a buttons/list message (we only
// learn this later, from the status webhook), resend the same choices as
// plain text with numbers, and let the customer reply with a number.
// ---------------------------------------------------------------------
const recent = new Map(); // message_uuid -> { to, body, options:[{id,title}] }
const numberChoices = new Map(); // phone -> { options, at }

function remember(uuid, entry) {
  if (!uuid) return;
  recent.set(uuid, entry);
  if (recent.size > 300) recent.delete(recent.keys().next().value);
}

function forget(to) {
  numberChoices.delete(to);
}

/** Customer typed "2" after a text fallback -> the option they meant. */
function choiceFromNumber(to, text) {
  const c = numberChoices.get(to);
  if (!c || Date.now() - c.at > 30 * 60 * 1000) return null;
  const n = parseInt(String(text).trim(), 10);
  if (!(n >= 1 && n <= c.options.length) || !/^\s*\d{1,2}\s*[.)]?\s*$/.test(text)) return null;
  numberChoices.delete(to);
  return c.options[n - 1];
}

async function handleStatus(body) {
  if (!body || body.status !== "rejected") return;
  const entry = recent.get(body.message_uuid);
  console.error(
    `WhatsApp rejected a message to ${body.to}: ${body.error?.title} ${body.error?.detail}` +
      (entry ? `\n  Message was: ${JSON.stringify(entry.payload)}` : "")
  );
  if (!entry || !entry.options || entry.fallbackSent) return;
  entry.fallbackSent = true;
  if (entry.headerImage) {
    await sendMessage({
      from: FROM(), to: entry.to, channel: "whatsapp", message_type: "image", image: { url: entry.headerImage }
    }).catch((err) => console.error("Image fallback failed:", err.message));
  }
  const lines = entry.options.map((o, i) => `${i + 1}. ${o.label || o.title}`).join("\n");
  await sendMessage({
    from: FROM(),
    to: entry.to,
    channel: "whatsapp",
    message_type: "text",
    text: `${entry.body}\n\n${lines}\n\nReply with a number.`.slice(0, 4096)
  }).catch((err) => console.error("Text fallback failed:", err.message));
  numberChoices.set(entry.to, { options: entry.options.map(({ id, title }) => ({ id, title })), at: Date.now() });
}

// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// iOS app customers: every customer message is also saved to their in-app
// inbox (see appInbox.js). WhatsApp is only tried while WhatsApp's 24-hour
// window is open for them, and a WhatsApp failure never stops the order
// flow for an app customer - they already have the message in the app.
// ---------------------------------------------------------------------
function appRoute(to, message) {
  try {
    return require("./appInbox").route(to, message);
  } catch (err) {
    console.error("App inbox routing failed:", err.message);
    return { whatsapp: true, app: false };
  }
}

async function viaWhatsApp(route, send) {
  if (!route.whatsapp) return {};
  if (!route.app) return send();
  try {
    return await send();
  } catch (err) {
    console.error("WhatsApp copy to app customer failed (they have it in the app):", err.message);
    return {};
  }
}

async function sendText(to, text) {
  forget(to);
  const route = appRoute(to, { text: String(text) });
  return viaWhatsApp(route, () =>
    sendMessage({
      from: FROM(),
      to,
      channel: "whatsapp",
      message_type: "text",
      text: String(text).slice(0, 4096)
    })
  );
}

async function sendButtons(to, { header, headerImage, body, footer, buttons }) {
  if (buttons.length > 3) {
    throw new Error("WhatsApp reply buttons support a max of 3 options");
  }
  forget(to);
  const h = oneLine(header, LIMIT.header);
  const f = oneLine(footer, LIMIT.footer);
  const options = buttons.map((b) => ({ id: String(b.id).slice(0, LIMIT.buttonId), title: oneLine(b.title, LIMIT.buttonTitle) }));
  const bodyText = fit(body, LIMIT.buttonBody) || " ";
  const payload = {
    from: FROM(),
    to,
    channel: "whatsapp",
    message_type: "custom",
    custom: {
      type: "interactive",
      interactive: {
        type: "button",
        ...(headerImage
          ? { header: { type: "image", image: { link: headerImage } } }
          : h
          ? { header: { type: "text", text: h } }
          : {}),
        body: { text: bodyText },
        ...(f ? { footer: { text: f } } : {}),
        action: {
          buttons: options.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } }))
        }
      }
    }
  };
  const route = appRoute(to, { header: header || null, text: String(body ?? ""), buttons, ...(headerImage ? { imageUrl: headerImage } : {}) });
  const res = await viaWhatsApp(route, () => sendMessage(payload));
  remember(res?.message_uuid, { to, body: bodyText, options, payload, headerImage });
  return res;
}

async function sendList(to, { header, body, footer, buttonLabel, sections }) {
  const totalRows = sections.reduce((n, s) => n + s.rows.length, 0);
  if (totalRows > 10) {
    throw new Error("WhatsApp list messages support a max of 10 rows total");
  }
  forget(to);
  const h = oneLine(header, LIMIT.header);
  const f = oneLine(footer, LIMIT.footer);
  const bodyText = fit(body, LIMIT.listBody) || " ";
  const cleanSections = sections.map((s) => {
    const title = oneLine(s.title, LIMIT.sectionTitle);
    return {
      ...(title ? { title } : {}),
      rows: s.rows.map((r) => {
        const d = oneLine(r.description, LIMIT.rowDescription);
        return {
          id: String(r.id).slice(0, LIMIT.rowId),
          title: oneLine(r.title, LIMIT.rowTitle) || "-",
          ...(d ? { description: d } : {})
        };
      })
    };
  });
  // WhatsApp requires section titles when there's more than one section.
  if (cleanSections.length > 1) cleanSections.forEach((s, i) => { if (!s.title) s.title = `Options ${i + 1}`; });
  const payload = {
    from: FROM(),
    to,
    channel: "whatsapp",
    message_type: "custom",
    custom: {
      type: "interactive",
      interactive: {
        type: "list",
        ...(h ? { header: { type: "text", text: h } } : {}),
        body: { text: bodyText },
        ...(f ? { footer: { text: f } } : {}),
        action: {
          button: oneLine(buttonLabel || "Select", LIMIT.listButton) || "Select",
          sections: cleanSections
        }
      }
    }
  };
  const route = appRoute(to, { header: header || null, text: String(body ?? "") });
  const res = await viaWhatsApp(route, () => sendMessage(payload));
  const options = cleanSections.flatMap((s) =>
    s.rows.map((r) => ({ id: r.id, title: r.title, label: r.description ? `${r.title} - ${r.description}` : r.title }))
  );
  remember(res?.message_uuid, { to, body: bodyText, options, payload });
  return res;
}

async function sendImage(to, url, caption) {
  const route = appRoute(to, { text: caption ? String(caption) : "", imageUrl: url });
  const res = await viaWhatsApp(route, () => sendMessage({
    from: FROM(),
    to,
    channel: "whatsapp",
    message_type: "image",
    image: caption ? { url, caption: String(caption).slice(0, 1024) } : { url }
  }));
  return res;
}

/** WhatsApp only, no app inbox copy (announcements add their own inbox entry). */
async function sendWhatsAppOnly(to, text) {
  return sendMessage({ from: FROM(), to, channel: "whatsapp", message_type: "text", text: String(text).slice(0, 4096) });
}

module.exports = { sendWhatsAppOnly, sendText, sendButtons, sendList, sendImage, handleStatus, choiceFromNumber, _fit: fit };
