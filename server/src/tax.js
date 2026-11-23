/**
 * New Jersey sales tax on FTR orders.
 *
 * NJ charges one statewide rate (6.625%) on prepared food and catering, so
 * every order is taxed on its subtotal (food, setup and delivery fees).
 *
 * Money rules:
 *   tax     = subtotal x rate, rounded to the cent
 *   total   = subtotal + tax
 *   deposit = depositPercent of the subtotal + ALL of the tax
 *   balance = total - deposit   (the rest of the subtotal; no tax left)
 *
 * The rate is saved on each order when its deposit is requested (or when it is
 * confirmed without one), so a later rate change never moves an agreed price.
 * Orders whose payment was set up before tax existed keep their old amounts.
 */
const DEFAULT_RATE = 6.625; // percent

function cents(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

/** The current rate in percent: Chef's setting, else 6.625. */
function currentRate(menu) {
  const m = menu || require("./menuStore").getMenu();
  const p = (m.settings && m.settings.payment) || {};
  const r = Number(p.taxPercent);
  return p.taxPercent !== undefined && p.taxPercent !== "" && r >= 0 && r < 20 ? r : DEFAULT_RATE;
}

/** Totals for a subtotal at a rate (percent), with the deposit split. */
function split(subtotal, ratePercent, depositPercent) {
  const sub = cents(subtotal);
  const rate = Number(ratePercent) || 0;
  // Work in whole cents so half-cents round up reliably (e.g. $187.50 -> $12.42).
  const tax = Math.round(Math.round(sub * 100) * rate / 100 + 1e-7) / 100;
  const total = cents(sub + tax);
  const pct = depositPercent == null ? null : Number(depositPercent);
  const depositFood = pct == null ? null : cents((sub * pct) / 100);
  const deposit = pct == null ? null : cents(depositFood + tax);
  const balance = pct == null ? total : cents(total - deposit);
  return { subtotal: sub, taxRate: rate, tax, total, depositPercent: pct, depositFood, deposit, balance };
}

/** The rate that applies to an order: saved on it, 0 for pre-tax payments, else current. */
function rateFor(order, menu) {
  if (order && order.taxRate != null) return Number(order.taxRate);
  if (order && order.payment && order.payment.taxRate == null) return 0; // deposit asked before tax existed
  return currentRate(menu);
}

/** Subtotal, tax, total, deposit and balance for an order. */
function forOrder(order, menu) {
  const p = (order && order.payment) || null;
  const t = split(order ? order.subtotal : 0, rateFor(order, menu), p ? p.depositPercent : null);
  if (p) {
    // Use the amounts the customer was actually asked for.
    t.deposit = cents(p.depositDue);
    t.balance = cents(t.total - t.deposit);
  }
  t.paidInFull = !!(order && order.paidInFull);
  return t;
}

function rateLabel(rate) {
  return `${Number(rate).toString()}%`;
}

module.exports = { DEFAULT_RATE, cents, currentRate, split, rateFor, forOrder, rateLabel };
