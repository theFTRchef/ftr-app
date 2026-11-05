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
  "Comments",
  "Group",
  "Rating"
];

/**
 * Rating for everyone who isn't Friends & family: 1-5 stars from how many
 * confirmed orders they've placed and how much those orders came to.
 * Each scores 1-5 and the rating is the average, rounded. No confirmed
 * orders yet = "New" (0 stars).
 */
const ORDER_STEPS = [1, 2, 4, 7, 11];          // orders for 1..5 points
const VALUE_STEPS = [0.01, 100, 250, 500, 1000]; // dollars for 1..5 points
function points(n, steps) {
  let p = 0;
  steps.forEach((s, i) => { if (n >= s) p = i + 1; });
  return p;
}
function stars(confirmedOrders, confirmedTotal) {
  if (!confirmedOrders) return 0;
  return Math.max(1, Math.round((points(confirmedOrders, ORDER_STEPS) + points(confirmedTotal, VALUE_STEPS)) / 2));
}

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
        family: c.family === true,
        createdAt: c.createdAt || null
      };
    })
    .map((c) => ({ ...c, stars: stars(c.confirmedOrders, c.confirmedTotal) }))
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
    c.comments,
    c.family ? "Friends & family" : "",
    c.family ? "" : c.stars ? `${c.stars} star${c.stars === 1 ? "" : "s"}` : "New"
  ]);
}

module.exports = { COLUMNS, customers, rows, stars, ORDER_STEPS, VALUE_STEPS };
