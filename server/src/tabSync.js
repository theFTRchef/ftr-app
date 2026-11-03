/**
 * Mirror a whole list to its own Google Sheet tab (e.g. "Customers",
 * "Comments"). The server files are the real records; each tab is
 * rewritten from them a few seconds after a change. Editing or deleting
 * rows in the Sheet never changes the server copy.
 */
const sheets = require("./sheets");

const timers = new Map();

function configured() {
  const id = process.env.GOOGLE_SHEET_ID;
  return !!id && id !== "not-set-yet";
}

async function ensureTab(tab) {
  const data = await sheets.request("GET", "?fields=sheets.properties(title)");
  const exists = (data.sheets || []).some((s) => s.properties.title === tab);
  if (!exists) {
    await sheets.request("POST", ":batchUpdate", { requests: [{ addSheet: { properties: { title: tab } } }] });
  }
}

function colLetter(n) {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

async function writeTab(tab, header, rows) {
  if (!configured()) return;
  await ensureTab(tab);
  await sheets.request("POST", `/values/${encodeURIComponent(`${tab}!A:${colLetter(header.length)}`)}:clear`, {});
  await sheets.request("PUT", `/values/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=RAW`, {
    values: [header, ...rows]
  });
}

/** Rewrite a tab shortly; build() returns { header, rows }. Bursts become one write. */
function schedule(tab, build, delayMs = 4000) {
  if (!configured()) return;
  clearTimeout(timers.get(tab));
  const t = setTimeout(() => {
    Promise.resolve()
      .then(() => build())
      .then(({ header, rows }) => writeTab(tab, header, rows))
      .catch((err) => console.error(`Google Sheet "${tab}" tab failed:`, err.message));
  }, delayMs);
  if (t.unref) t.unref();
  timers.set(tab, t);
}

module.exports = { schedule, writeTab };
