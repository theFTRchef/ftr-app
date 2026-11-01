/**
 * Google Sheet mirror of the customer list, on its own tab ("Customers",
 * or GOOGLE_SHEET_CUSTOMERS_TAB). The server copy (data/customers.json)
 * is the real record; this tab is rewritten from it a few seconds after
 * any change. Deleting a row in the Sheet does NOT delete the customer -
 * that only happens with the admin page's Delete button.
 */
const sheets = require("./sheets");

let timer = null;

function configured() {
  const id = process.env.GOOGLE_SHEET_ID;
  return !!id && id !== "not-set-yet";
}

function tabName() {
  return process.env.GOOGLE_SHEET_CUSTOMERS_TAB || "Customers";
}

async function ensureTab() {
  const data = await sheets.request("GET", "?fields=sheets.properties(title)");
  const exists = (data.sheets || []).some((s) => s.properties.title === tabName());
  if (!exists) {
    await sheets.request("POST", ":batchUpdate", { requests: [{ addSheet: { properties: { title: tabName() } } }] });
  }
}

async function syncNow() {
  if (!configured()) return;
  const { COLUMNS, rows } = require("./customerReport");
  await ensureTab();
  const values = [COLUMNS, ...rows()];
  const range = encodeURIComponent(`${tabName()}!A:I`);
  await sheets.request("POST", `/values/${range}:clear`, {});
  await sheets.request("PUT", `/values/${encodeURIComponent(`${tabName()}!A1`)}?valueInputOption=RAW`, { values });
}

/** Rewrite the tab shortly (batches bursts of changes into one write). */
function scheduleSync(delayMs = 4000) {
  if (!configured()) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    syncNow().catch((err) => console.error("Google Sheet customers tab failed:", err.message));
  }, delayMs);
  if (timer.unref) timer.unref();
}

module.exports = { scheduleSync, syncNow };
