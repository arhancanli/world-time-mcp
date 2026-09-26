// src/places.mjs
//
// Turning what an agent writes ("Paris", "Portland, Maine", "Japan", "PST", "UTC+5:30",
// "America/New_York") into an IANA time zone, and saying which one was used. Cities come from
// city-timezones (7,300 cities with population, country and province); when a name is shared, the
// most populous city wins and the others are named, so the agent can ask again.
import { createRequire } from "node:module";
import { ToolError } from "./kit/index.mjs";
import { standardOffset } from "./clock.mjs";

const require = createRequire(import.meta.url);
// 48 entries (Antarctic stations) carry no zone; they are left out.
const cityMapping = require("city-timezones").cityMapping.filter((c) => c.timezone);

const fold = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const ZONES = new Map(Intl.supportedValuesOf("timeZone").map((z) => [z.toLowerCase(), z]));
for (const z of ["UTC", "Etc/UTC", "GMT", "Etc/GMT"]) ZONES.set(z.toLowerCase(), "UTC");

/** A zone Intl accepts under a name it does not list (legacy links such as US/Pacific). */
function intlZone(name) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

// Abbreviations people write. Each names the zone whose clock people mean: "3pm EST" in July
// means New York time, so the zone is New York and the result notes the daylight-time label.
const ABBREVIATIONS = {
  et: "America/New_York",
  est: "America/New_York",
  edt: "America/New_York",
  eastern: "America/New_York",
  ct: "America/Chicago",
  cst: "America/Chicago",
  cdt: "America/Chicago",
  central: "America/Chicago",
  mt: "America/Denver",
  mst: "America/Denver",
  mdt: "America/Denver",
  mountain: "America/Denver",
  pt: "America/Los_Angeles",
  pst: "America/Los_Angeles",
  pdt: "America/Los_Angeles",
  pacific: "America/Los_Angeles",
  akst: "America/Anchorage",
  akdt: "America/Anchorage",
  hst: "Pacific/Honolulu",
  bst: "Europe/London",
  wet: "Europe/Lisbon",
  west: "Europe/Lisbon",
  cet: "Europe/Berlin",
  cest: "Europe/Berlin",
  eet: "Europe/Athens",
  eest: "Europe/Athens",
  msk: "Europe/Moscow",
  ist: "Asia/Kolkata",
  pkt: "Asia/Karachi",
  gst: "Asia/Dubai",
  sgt: "Asia/Singapore",
  hkt: "Asia/Hong_Kong",
  jst: "Asia/Tokyo",
  kst: "Asia/Seoul",
  wib: "Asia/Jakarta",
  ict: "Asia/Bangkok",
  pht: "Asia/Manila",
  aest: "Australia/Sydney",
  aedt: "Australia/Sydney",
  acst: "Australia/Adelaide",
  acdt: "Australia/Adelaide",
  awst: "Australia/Perth",
  nzst: "Pacific/Auckland",
  nzdt: "Pacific/Auckland",
  sast: "Africa/Johannesburg",
  cat: "Africa/Maputo",
  eat: "Africa/Nairobi",
  wat: "Africa/Lagos",
  brt: "America/Sao_Paulo",
  art: "America/Argentina/Buenos_Aires",
};
const AMBIGUOUS_ABBREVIATIONS = {
  ist: "IST also means Israel or Irish Standard Time; name the city if not India.",
  bst: "BST also means Bangladesh Standard Time; name the city if not the UK.",
  cst: "CST also means China Standard Time; name the city if not US Central.",
  gst: "GST also means South Georgia Time; this is Gulf Standard Time.",
};

const US_STATES = {
  al: "alabama",
  ak: "alaska",
  az: "arizona",
  ar: "arkansas",
  ca: "california",
  co: "colorado",
  ct: "connecticut",
  de: "delaware",
  fl: "florida",
  ga: "georgia",
  hi: "hawaii",
  id: "idaho",
  il: "illinois",
  in: "indiana",
  ia: "iowa",
  ks: "kansas",
  ky: "kentucky",
  la: "louisiana",
  me: "maine",
  md: "maryland",
  ma: "massachusetts",
  mi: "michigan",
  mn: "minnesota",
  ms: "mississippi",
  mo: "missouri",
  mt: "montana",
  ne: "nebraska",
  nv: "nevada",
  nh: "new hampshire",
  nj: "new jersey",
  nm: "new mexico",
  ny: "new york",
  nc: "north carolina",
  nd: "north dakota",
  oh: "ohio",
  ok: "oklahoma",
  or: "oregon",
  pa: "pennsylvania",
  ri: "rhode island",
  sc: "south carolina",
  sd: "south dakota",
  tn: "tennessee",
  tx: "texas",
  ut: "utah",
  vt: "vermont",
  va: "virginia",
  wa: "washington",
  wv: "west virginia",
  wi: "wisconsin",
  wy: "wyoming",
  dc: "district of columbia",
};

// Country names and codes, from the city data and Intl's English display names.
const DISPLAY = new Intl.DisplayNames(["en"], { type: "region" });
// The city data carries a few codes Intl refuses ("-99"): no display name for those.
const REGION_NAMES = {
  of: (code) => {
    try {
      return /^[A-Z]{2}$/.test(code ?? "") ? DISPLAY.of(code) : undefined;
    } catch {
      return undefined;
    }
  },
};
const CITIES_BY_NAME = new Map();
const COUNTRIES = new Map(); // folded name or code -> iso2
for (const c of cityMapping) {
  const key = fold(c.city_ascii || c.city);
  if (!CITIES_BY_NAME.has(key)) CITIES_BY_NAME.set(key, []);
  CITIES_BY_NAME.get(key).push(c);
  if (c.iso2) {
    COUNTRIES.set(fold(c.iso2), c.iso2);
    if (c.iso3) COUNTRIES.set(fold(c.iso3), c.iso2);
    if (c.country) COUNTRIES.set(fold(c.country), c.iso2);
    const display = REGION_NAMES.of(c.iso2);
    if (display) COUNTRIES.set(fold(display), c.iso2);
  }
}
for (const [alias, iso2] of Object.entries({
  uk: "GB",
  "great britain": "GB",
  britain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  usa: "US",
  "united states of america": "US",
  america: "US",
  uae: "AE",
  emirates: "AE",
  "south korea": "KR",
  korea: "KR",
  "north korea": "KP",
  russia: "RU",
  holland: "NL",
  czechia: "CZ",
  "ivory coast": "CI",
  turkey: "TR",
  turkiye: "TR",
}))
  COUNTRIES.set(alias, iso2);

for (const list of CITIES_BY_NAME.values()) list.sort((a, b) => (b.pop ?? 0) - (a.pop ?? 0));

/** The ISO 3166 country code for a name or code, or undefined. */
export const countryCode = (raw) => COUNTRIES.get(fold(raw));

/** The most populous city of a country, which stands for the country's clock when it has several zones. */
function countryPlace(iso2) {
  const cities = cityMapping.filter((c) => c.iso2 === iso2).sort((a, b) => (b.pop ?? 0) - (a.pop ?? 0));
  if (!cities.length) return undefined;
  const zones = [...new Set(cities.map((c) => c.timezone))];
  const top = cities[0];
  return {
    zone: top.timezone,
    label: REGION_NAMES.of(iso2) ?? top.country,
    country: iso2,
    note: offsetsOf(zones) > 1 ? `${REGION_NAMES.of(iso2) ?? iso2} spans ${offsetsOf(zones)} UTC offsets; used ${top.city}'s clock. Name a city for another.` : undefined,
  };
}

const OFFSET = /^(?:utc|gmt)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i;

/**
 * @returns {{zone?: string, offsetMinutes?: number, label: string, country?: string, province?: string, note?: string}}
 */
export function resolvePlace(raw) {
  const text = String(raw ?? "").trim();
  if (!text) throw new ToolError("bad_place", "Name a place: a city, a country, an IANA zone such as Europe/Paris, or an offset such as UTC+4.");
  const key = text.toLowerCase();
  // IANA zone ids, including legacy links Intl still accepts.
  if (ZONES.has(key)) return { zone: ZONES.get(key), label: ZONES.get(key) };
  if (text.includes("/")) {
    const z = intlZone(text);
    if (z) return { zone: z, label: z };
  }
  // Fixed offsets: "UTC+4", "GMT-03:30", "+05:30".
  const off = text.replace(/\s+/g, "").match(OFFSET);
  if (off && (/^(utc|gmt)/i.test(text) || /^[+-]/.test(text))) {
    const minutes = (off[1] === "-" ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3] ?? 0));
    if (Math.abs(minutes) > 14 * 60) throw new ToolError("bad_place", `${text} is not a UTC offset (they run from -12:00 to +14:00).`);
    return { offsetMinutes: minutes, label: `UTC${minutes < 0 ? "-" : "+"}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}:${String(Math.abs(minutes) % 60).padStart(2, "0")}` };
  }
  const f = fold(text);
  if (ABBREVIATIONS[f]) return { zone: ABBREVIATIONS[f], label: text.toUpperCase(), abbreviation: f, note: AMBIGUOUS_ABBREVIATIONS[f] };
  // "City, qualifier": qualifier is a country, a province or a US state code.
  const [head, ...rest] = text.split(",");
  const qualifier = fold(rest.join(" "));
  const cities = CITIES_BY_NAME.get(fold(head)) ?? [];
  if (cities.length) {
    const qualified = qualifier
      ? cities.filter((c) => [c.iso2, c.iso3, c.country, c.province, REGION_NAMES.of(c.iso2)].some((v) => fold(v) === qualifier) || (c.iso2 === "US" && fold(c.province) === US_STATES[qualifier]))
      : cities;
    if (qualifier && !qualified.length) throw new ToolError("unknown_place", `No city named ${head.trim()} in ${rest.join(",").trim()}. Known: ${cities.slice(0, 5).map(cityLabel).join("; ")}.`);
    const top = qualified[0];
    // Named only when a namesake in another zone is a real contender (at least a quarter the size).
    const others = qualified.filter((c) => c.timezone !== top.timezone && (c.pop ?? 0) >= (top.pop ?? 0) / 4).slice(0, 3);
    return {
      zone: top.timezone,
      label: cityLabel(top),
      country: top.iso2,
      province: top.province,
      note: others.length ? `Also ${others.map(cityLabel).join("; ")}, in other zones; add the country or state to choose.` : undefined,
    };
  }
  const iso2 = countryCode(text);
  if (iso2) {
    const p = countryPlace(iso2);
    if (p) return p;
  }
  // US states and other provinces: the largest city there.
  const state = US_STATES[f] ?? f;
  const inProvince = cityMapping.filter((c) => fold(c.province) === state).sort((a, b) => (b.pop ?? 0) - (a.pop ?? 0));
  if (inProvince.length) {
    const zones = [...new Set(inProvince.map((c) => c.timezone))];
    const top = inProvince[0];
    return {
      zone: top.timezone,
      label: `${top.province}, ${top.iso2}`,
      country: top.iso2,
      province: top.province,
      note: offsetsOf(zones) > 1 ? `${top.province} spans ${offsetsOf(zones)} UTC offsets; used ${top.city}'s clock.` : undefined,
    };
  }
  throw new ToolError("unknown_place", `"${text}" is not a known city, country, time zone or UTC offset. Try a larger nearby city, the country, or an IANA zone such as Europe/Paris.`);
}

// States and provinces are named only where people name them with the city.
const FEDERAL = new Set(["US", "CA", "AU", "BR", "MX", "IN"]);
const cityLabel = (c) => [c.city, FEDERAL.has(c.iso2) && c.province && c.province !== c.city ? c.province : undefined, c.iso2].filter(Boolean).join(", ");

/** How many different standard UTC offsets a set of zones has this year (US: 6, not its 30 zone ids). */
function offsetsOf(zones) {
  const year = new Date().getUTCFullYear();
  return new Set(zones.map((z) => standardOffset({ zone: z }, year))).size;
}
