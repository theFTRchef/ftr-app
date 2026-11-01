/**
 * One-off command: copy every order saved on the server into the Google
 * Sheet (adds missing rows, refreshes status and subtotal on existing ones).
 *
 *   cd ~/ftrbot/dose-in-a-box-bot && node src/syncSheet.js
 */
require("dotenv").config();
const orderDb = require("./orderDb");
const sheets = require("./sheets");

(async () => {
  if (!process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEET_ID === "not-set-yet") {
    console.log("No GOOGLE_SHEET_ID in .env - nothing to sync.");
    return;
  }
  const orders = orderDb
    .all()
    .slice()
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  console.log(`Syncing ${orders.length} order(s) to the Google Sheet...`);
  const { added, refreshed } = await sheets.syncAll(orders);
  console.log(`Done: ${added} added, ${refreshed} updated.`);
})().catch((err) => {
  console.error("Sheet sync failed:", err.message);
  process.exit(1);
});
