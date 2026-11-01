/** One-line description of an order's Zelle deposit (Sheet column K, CSV). */
function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function deadlineLabel(iso) {
  // 12:00 AM reads oddly ("by 12:00 AM Thu"), so say "11:59 PM Wed" instead.
  const t = new Date(iso);
  const hm = t.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  if (hm === "12:00 AM") return deadlineLabel(new Date(t.getTime() - 60000).toISOString());
  return t.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function paymentText(order) {
  const p = order && order.payment;
  if (!p) return "";
  const conf = p.confirmationCode || (p.proofs || []).map((x) => x.code).filter(Boolean).slice(-1)[0];
  if (p.state === "paid") return `Deposit ${money(p.depositDue)} PAID${conf ? ` (Zelle ${conf})` : ""}; balance ${money(p.balance)}`;
  if (p.state === "review") return `Deposit ${money(p.depositDue)} - screenshot received, chef to confirm`;
  if (p.state === "released") return `Deposit ${money(p.depositDue)} not paid - released`;
  return `Deposit ${money(p.depositDue)} due by ${deadlineLabel(p.deadline)}`;
}

module.exports = { paymentText, money, deadlineLabel };
