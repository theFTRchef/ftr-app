/**
 * Orders waiting on a decision (chef approval, or a customer replying to a
 * custom quote). Backed by data/orders.json via orderDb, so pending orders
 * survive a bot restart - the chef's Approve/Decline buttons keep working.
 *
 * The interface (create/get/remove) is unchanged from the old in-memory
 * version, so orderFlow.js didn't need to change how it uses it.
 */
const orderDb = require("./orderDb");

function create(orderId, order) {
  orderDb.upsert({ ...order, orderId, pending: true });
}

function get(orderId) {
  const order = orderDb.get(orderId);
  return order && order.pending ? order : null;
}

function remove(orderId) {
  orderDb.update(orderId, { pending: false });
}

module.exports = { create, get, remove };
