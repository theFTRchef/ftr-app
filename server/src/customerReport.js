/**
 * One row per saved customer, with their order history totals.
 * Used by the admin Customers page, the Customers CSV and the Google
 * Sheet "Customers" tab.
 */
const orderDb = require("./orderDb");
const customerStore = require("./customerStore");

const COLUMNS = [
  "First Name",
  "Last Name",
  "Phone",
  "Saved Address",
  "Orders",
  "Confirmed Orders",
  "Confirmed Total",
  "Last Order",
  "First Contact",
  "Comments"
];

function localStamp(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York" });
}

function customers() {
  const orders = orderDb.all();
  let feedback = [];
  try { feedback = require("./feedbackStore").all(); } catch (e) { /* optional */ }
  return Object.entries(customerStore.all())
    .map(([phone, c]) => {
      const theirs = orders.filter((o) => o.customerPhone === phone);
      const confirmed = theirs.filter((o) => o.status === "Confirmed");
      const lastOrder = theirs.map((o) => o.createdAt).filter(Boolean).sort().pop() || null;
      return {
        phone,
        firstName: c.firstName || "",
        lastName: c.lastName || "",
        address: c.address || "",
        addressVerified: !!c.addressVerified,
        orders: theirs.length,
        confirmedOrders: confirmed.length,
        confirmedTotal: Math.round(confirmed.reduce((sum, o) => sum + Number(o.subtotal || 0), 0) * 100) / 100,
        lastOrder,
        comments: feedback.filter((f) => f.phone === phone).length,
        createdAt: c.createdAt || null
      };
    })
    .sort((a, b) => String(b.lastOrder || b.createdAt || "").localeCompare(String(a.lastOrder || a.createdAt || "")));
}

function rows() {
  return customers().map((c) => [
    c.firstName,
    c.lastName,
    c.phone,
    c.address,
    c.orders,
    c.confirmedOrders,
    c.confirmedTotal.toFixed(2),
    localStamp(c.lastOrder),
    localStamp(c.createdAt),
    c.comments
  ]);
}

module.exports = { COLUMNS, customers, rows };
