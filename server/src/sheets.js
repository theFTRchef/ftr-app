/**
 * Google Sheets mirror of the order log. Called only through records.js,
 * which skips it when no sheet is connected.
 *
 * Talks to the Sheets REST API with Node's built-in fetch (the googleapis
 * client's own HTTP layer hits "Premature close" errors on newer Node
 * versions). Sign-in: a key file if one exists, otherwise the server's own
 * Google Cloud identity (the VM must be allowed the Sheets scope).
 *
 * Columns (header row is added automatically if the tab is empty):
 *   A Timestamp | B Order ID | C Customer Name | D Phone | E Items (with notes)
 *   F Subtotal  | G Fulfillment | H Address | I Requested Time | J Status
 *   K Payment (Zelle deposit status)
 */
const fs = require("fs");
const { google } = require("googleapis");
const { paymentText } = require("./paymentText");

const HEADER = [
  "Timestamp",
  "Order ID",
  "Customer Name",
  "Phone",
  "Items",
  "Subtotal",
  "Fulfillment",
  "Address",
  "Requested Time",
  "Status",
  "Payment"
];
const STATUS_COL = "J";
const SUBTOTAL_COL = "F";
const PAYMENT_COL = "K";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

let authClient = null;

function getAuth() {
  if (!authClient) {
    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
    authClient = new google.auth.GoogleAuth({
      ...(keyFile && fs.existsSync(keyFile) ? { keyFile } : {}),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
  }
  return authClient;
}

async function token() {
  const t = await getAuth().getAccessToken();
  return typeof t === "string" ? t : t?.token;
}

function tabName() {
  return process.env.GOOGLE_SHEET_TAB_NAME || "Orders";
}

function sheetId() {
  return process.env.GOOGLE_SHEET_ID;
}

/** One Sheets API call (values endpoint), retried once on a network hiccup. */
async function call(method, rangeA1, { query = "", body } = {}, attempt = 1) {
  return request(method, `/values/${encodeURIComponent(rangeA1)}${query}`, body, attempt);
}

/** Any Sheets API call under /spreadsheets/{id}, retried once on a network hiccup. */
async function request(method, suffix, body, attempt = 1) {
  const url = `${API}/${sheetId()}${suffix}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).error.message; } catch (e) { /* keep raw */ }
      throw new Error(`Sheets API ${res.status}: ${msg}`);
    }
    return text ? JSON.parse(text) : {};
  } catch (err) {
    const network = !/^Sheets API \d/.test(err.message);
    if (network && attempt < 2) return request(method, suffix, body, attempt + 1);
    throw err;
  }
}

function itemsText(order) {
  if (order.type === "custom") return `CUSTOM REQUEST: ${order.request || ""}`;
  if (order.itemsManual) return `PAST ORDER: ${order.itemsManual}` + (order.orderNote ? ` | NOTE: ${order.orderNote}` : "");
  return itemLines(order) + (order.orderNote ? ` | NOTE: ${order.orderNote}` : "");
}

function itemLines(order) {
  return (order.cart || [])
    .map((l) => {
      const note = l.note ? ` (note: ${l.note})` : "";
      if (l.isLiveDoseStation) {
        const parts = [];
        if (l.mdQty) parts.push(`${l.mdQty} Mysore Masale Dose`);
        if (l.odQty) parts.push(`${l.odQty} Onion Dose`);
        const travel = l.travelFee ? ` (+$${Number(l.travelFee).toFixed(2)} travel)` : "";
        const ext = l.extensionFee ? ` (+$${Number(l.extensionFee).toFixed(2)} for ${l.extensionMinutes} extra min)` : "";
        return `LIVE Dose Station: ${parts.join(" + ")}${travel}${ext}${note}`;
      }
      return `${Number.isInteger(Number(l.qty)) ? l.qty : (Math.floor(l.qty) || "") + "½"}x ${l.title}${Number.isInteger(Number(l.qty)) ? "" : " (half tray)"}${note}`;
    })
    .join("; ");
}

function rowFor(order) {
  const ts = order.createdAt
    ? new Date(order.createdAt).toLocaleString("en-US", { timeZone: "America/New_York" })
    : new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  return [
    ts,
    order.orderId,
    order.customerName || "",
    order.customerPhone || "",
    itemsText(order),
    Number(order.subtotal || 0).toFixed(2),
    order.fulfillment || "",
    (order.address || "") +
      (order.address && order.distanceMiles != null ? ` (~${order.distanceMiles} mi)` : "") +
      (order.address && order.addressVerified === false ? " [NOT VERIFIED]" : ""),
    order.requestedTime || "",
    order.status || "Pending Approval",
    paymentText(order)
  ];
}

async function ensureHeader() {
  const data = await call("GET", `${tabName()}!A1:K1`);
  const row = (data.values && data.values[0]) || [];
  if (!row[0] || !row[10]) {
    // Empty tab, or a sheet from before the Payment column existed.
    await call("PUT", `${tabName()}!A1:K1`, {
      query: "?valueInputOption=RAW",
      body: { values: [HEADER] }
    });
  }
}

async function appendRows(rows) {
  await call("POST", `${tabName()}!A:K`, {
    query: ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
    body: { values: rows }
  });
}

async function appendOrder(order) {
  await ensureHeader();
  await appendRows([rowFor(order)]);
}

async function orderIdColumn() {
  const data = await call("GET", `${tabName()}!B:B`);
  return (data.values || []).map((r) => r[0]);
}

async function setCell(orderId, col, value) {
  const ids = await orderIdColumn();
  const idx = ids.indexOf(orderId);
  if (idx === -1) {
    console.warn(`Google Sheet: order ${orderId} not found`);
    return;
  }
  await call("PUT", `${tabName()}!${col}${idx + 1}`, {
    query: "?valueInputOption=RAW",
    body: { values: [[value]] }
  });
}

async function updateOrderStatus(orderId, status) {
  return setCell(orderId, STATUS_COL, status);
}

async function updateOrderTime(orderId, text) {
  return setCell(orderId, "I", text || "");
}

async function updateOrderPayment(orderId, text) {
  return setCell(orderId, PAYMENT_COL, text || "");
}

async function updateOrderSubtotal(orderId, newSubtotal) {
  return setCell(orderId, SUBTOTAL_COL, Number(newSubtotal).toFixed(2));
}

/**
 * Brings the sheet in line with the server's order records: adds any
 * orders missing from the sheet and refreshes status/subtotal on the rest.
 * Run with:  node src/syncSheet.js
 */
async function syncAll(orders) {
  await ensureHeader();
  const ids = await orderIdColumn();
  const missing = orders.filter((o) => !ids.includes(o.orderId));
  if (missing.length) await appendRows(missing.map(rowFor));
  let refreshed = 0;
  for (const o of orders.filter((x) => ids.includes(x.orderId))) {
    const row = ids.indexOf(o.orderId) + 1;
    await call("PUT", `${tabName()}!${SUBTOTAL_COL}${row}:${SUBTOTAL_COL}${row}`, {
      query: "?valueInputOption=RAW",
      body: { values: [[Number(o.subtotal || 0).toFixed(2)]] }
    });
    await call("PUT", `${tabName()}!${STATUS_COL}${row}`, {
      query: "?valueInputOption=RAW",
      body: { values: [[o.status || ""]] }
    });
    await call("PUT", `${tabName()}!${PAYMENT_COL}${row}`, {
      query: "?valueInputOption=RAW",
      body: { values: [[paymentText(o)]] }
    });
    refreshed += 1;
  }
  return { added: missing.length, refreshed };
}

/** Numeric id of the Orders tab (needed to delete rows). */
async function tabGid() {
  const data = await request("GET", "?fields=sheets.properties(sheetId,title)");
  const tab = (data.sheets || []).find((s) => s.properties.title === tabName());
  if (!tab) throw new Error(`No tab named "${tabName()}" in the sheet`);
  return tab.properties.sheetId;
}

/** Remove one order's row from the sheet (if it's there). */
async function deleteOrderRow(orderId) {
  const ids = await orderIdColumn();
  const idx = ids.indexOf(orderId);
  if (idx < 1) return false; // not found (row 0 is the header)
  const gid = await tabGid();
  await request("POST", ":batchUpdate", {
    requests: [
      { deleteDimension: { range: { sheetId: gid, dimension: "ROWS", startIndex: idx, endIndex: idx + 1 } } }
    ]
  });
  return true;
}

/** Clear every order row, keeping the header. */
async function clearAllRows() {
  await call("POST", `${tabName()}!A2:K`, { query: ":clear", body: {} });
}

module.exports = {
  request,
  deleteOrderRow,
  clearAllRows,
  appendOrder,
  updateOrderStatus,
  updateOrderSubtotal,
  updateOrderPayment,
  updateOrderTime,
  syncAll,
  HEADER,
  itemsText
};
