/**
 * Address verification and distance.
 *
 * Default lookup: the US Census Bureau geocoder - free, no account or API
 * key, covers US street addresses. If GOOGLE_MAPS_API_KEY is set in .env,
 * Google's Geocoding API is used instead (more forgiving of typos).
 *
 * verifyAddress(text) resolves to one of:
 *   { status: "match", matches: [{ label, lat, lon }] }   (1-3 matches)
 *   { status: "none" }                                    (couldn't find it)
 *   { status: "error", message }                          (service down)
 */

const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const GOOGLE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const TIMEOUT_MS = 8000;

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function titleCase(s) {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Nj|Ny|Pa|Ct|De|Md)\b/g, (m) => m.toUpperCase());
}

// "1 W MAIN ST, SOMERVILLE, NJ, 08876" -> "1 W Main St, Somerville, NJ 08876"
function tidyCensusLabel(label) {
  const parts = label.split(",").map((p) => p.trim());
  if (parts.length === 4) {
    return `${titleCase(parts[0])}, ${titleCase(parts[1])}, ${parts[2]} ${parts[3]}`;
  }
  return titleCase(label);
}

async function censusLookup(text) {
  const url = `${CENSUS_URL}?address=${encodeURIComponent(text)}&benchmark=Public_AR_Current&format=json`;
  const data = await getJson(url);
  const matches = (data?.result?.addressMatches || []).slice(0, 3).map((m) => ({
    label: tidyCensusLabel(m.matchedAddress),
    lat: m.coordinates.y,
    lon: m.coordinates.x
  }));
  return matches;
}

async function googleLookup(text) {
  const url = `${GOOGLE_URL}?address=${encodeURIComponent(text)}&components=country:US&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  const data = await getJson(url);
  if (data.status === "ZERO_RESULTS") return [];
  if (data.status !== "OK") throw new Error(`Google geocoder: ${data.status}`);
  // Only accept results precise to a building/street address.
  return data.results
    .filter((r) => r.types.some((t) => ["street_address", "premise", "subpremise"].includes(t)))
    .slice(0, 3)
    .map((r) => ({
      label: r.formatted_address.replace(/, USA$/, ""),
      lat: r.geometry.location.lat,
      lon: r.geometry.location.lng
    }));
}

async function verifyAddress(text) {
  try {
    const matches = process.env.GOOGLE_MAPS_API_KEY
      ? await googleLookup(text)
      : await censusLookup(text);
    return matches.length ? { status: "match", matches } : { status: "none" };
  } catch (err) {
    console.error("Address lookup failed:", err.message);
    return { status: "error", message: err.message };
  }
}

/** Straight-line distance in miles between two { lat, lon } points. */
function milesBetween(a, b) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

module.exports = { verifyAddress, milesBetween };
