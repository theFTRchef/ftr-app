/**
 * Google Sheet "Customers" tab (or GOOGLE_SHEET_CUSTOMERS_TAB), rewritten
 * from data/customers.json after any change. Deleting a row in the Sheet
 * does NOT delete the customer - only the admin page's Delete button does.
 */
const tabSync = require("./tabSync");

function tabName() {
  return process.env.GOOGLE_SHEET_CUSTOMERS_TAB || "Customers";
}

function build() {
  const { COLUMNS, rows } = require("./customerReport");
  return { header: COLUMNS, rows: rows() };
}

function scheduleSync(delayMs = 4000) {
  tabSync.schedule(tabName(), build, delayMs);
}

async function syncNow() {
  const { header, rows } = build();
  await tabSync.writeTab(tabName(), header, rows);
}

module.exports = { scheduleSync, syncNow };
