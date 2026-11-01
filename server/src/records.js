/**
 * Single place orderFlow records order activity. Every call:
 *   1. writes the server copy (data/orders.json) - the main record, and
 *   2. mirrors it to the Google Sheet, if one is connected.
 * A Sheet failure is logged but never blocks the order.
 *
 * Same function names the old sheets.js exposed, so orderFlow.js just
 * imports from here instead.
 */
const orderDb = require("./orderDb");
const sheets = require("./sheets");

function sheetConfigured() {
  const id = process.env.GOOGLE_SHEET_ID;
  return !!id && id !== "not-set-yet";
}

async function toSheet(label, fn) {
  if (!sheetConfigured()) return;
  // Order counts/totals on the Customers tab change with orders too.
  try { require("./customerSheet").scheduleSync(); } catch (e) { /* optional */ }
  try {
    await fn();
  } catch (err) {
    console.error(`Google Sheet ${label} failed:`, err.message);
  }
}

async function appendOrder(order) {
  orderDb.upsert(order);
  await toSheet(`append ${order.orderId}`, () => sheets.appendOrder(orderDb.get(order.orderId)));
}

async function updateOrderStatus(orderId, status) {
  orderDb.update(orderId, { status });
  await toSheet(`status ${orderId}`, () => sheets.updateOrderStatus(orderId, status));
}

async function updateOrderSubtotal(orderId, subtotal) {
  orderDb.update(orderId, { subtotal });
  await toSheet(`subtotal ${orderId}`, () => sheets.updateOrderSubtotal(orderId, subtotal));
}

async function updateOrderPayment(orderId, text) {
  await toSheet(`payment ${orderId}`, () => sheets.updateOrderPayment(orderId, text));
}

/** Delete one order everywhere. Returns { deleted, sheet } */
async function deleteOrder(orderId) {
  const removed = orderDb.remove(orderId);
  let sheet = "not connected";
  if (sheetConfigured()) {
    try {
      sheet = (await sheets.deleteOrderRow(orderId)) ? "removed" : "not in sheet";
    } catch (err) {
      console.error(`Google Sheet delete ${orderId} failed:`, err.message);
      sheet = "failed: " + err.message;
    }
  }
  return { deleted: !!removed, sheet };
}

/** Remove all orders everywhere (backup kept on the server). */
async function resetAllOrders() {
  const count = orderDb.clearAll();
  let sheet = "not connected";
  if (sheetConfigured()) {
    try {
      await sheets.clearAllRows();
      sheet = "cleared";
    } catch (err) {
      console.error("Google Sheet reset failed:", err.message);
      sheet = "failed: " + err.message;
    }
  }
  return { count, sheet };
}

module.exports = {
  appendOrder,
  updateOrderStatus,
  updateOrderSubtotal,
  updateOrderPayment,
  sheetConfigured,
  deleteOrder,
  resetAllOrders
};
