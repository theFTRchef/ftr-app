/**
 * Tracks a small side-conversation with the owner when they tap "Edit
 * price" on an approval prompt - the bot needs to remember which order
 * they're mid-edit on until they reply with a number. Same in-memory
 * caveat as the other stores: lost on restart (the owner would just need
 * to tap Edit price again from the original message, which still works
 * since the order itself lives in pendingOrderStore / the Sheet).
 */

const ownerState = new Map();

function set(ownerNumber, state) {
  ownerState.set(ownerNumber, state);
}

function get(ownerNumber) {
  return ownerState.get(ownerNumber) || null;
}

function clear(ownerNumber) {
  ownerState.delete(ownerNumber);
}

module.exports = { set, get, clear };
