/**
 * Tiny JSON-file persistence used for orders and customers. Writes go to a
 * temp file first and are then renamed over the real one, so a crash
 * mid-write can never leave a half-written (corrupt) file behind.
 *
 * The data volume here is small (a home catering business), so reading
 * the whole file per call is fine and keeps things simple and robust.
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.FTR_DATA_DIR || path.join(__dirname, "..", "data");

function filePath(name) {
  return path.join(DATA_DIR, name);
}

function read(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath(name), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    console.error(`Could not read ${name}:`, err.message);
    return fallback;
  }
}

function write(name, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const target = filePath(name);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, target);
}

/** Save a timestamped copy under data/backups/ (e.g. before a reset). */
function backup(name, data) {
  const dir = path.join(DATA_DIR, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(dir, `${stamp}-${name}`), JSON.stringify(data, null, 2));
}

module.exports = { read, write, backup };
