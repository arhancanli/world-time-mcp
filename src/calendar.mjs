// src/calendar.mjs
//
// Holidays and weekends. Holidays come from date-holidays (rules for 207 countries and their
// states and regions, ISC-licensed, data CC BY 3.0), evaluated offline for any year. Weekends come
// from the Unicode CLDR week data built into Node (Saudi Arabia: Friday and Saturday; India:
// Sunday), and can be overridden. Holidays on the Islamic calendar are astronomical estimates:
// the official day follows a moon sighting and can differ by one, so they are marked estimated.
import { createRequire } from "node:module";
import { ToolError } from "./kit/index.mjs";
import { addDays, dateText, isoWeekday, parseDate } from "./clock.mjs";
import { countryCode } from "./places.mjs";

const require = createRequire(import.meta.url);
const Holidays = require("date-holidays");

const index = new Holidays();
const COUNTRY_NAMES = index.getCountries("en");
const fold = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// English names for regions the data spells in the local language (and a few everyday ones).
const REGION_ALIASES = {
  DE: {
    bavaria: "BY",
    hesse: "HE",
    "lower saxony": "NI",
    "north rhine westphalia": "NW",
    "rhineland palatinate": "RP",
    saxony: "SN",
    "saxony anhalt": "ST",
    thuringia: "TH",
    "mecklenburg western pomerania": "MV",
    "mecklenburg vorpommern": "MV",
    hamburg: "HH",
    bremen: "HB",
    "baden wurttemberg": "BW",
    "baden wuerttemberg": "BW",
    brandenburg: "BB",
    berlin: "BE",
    saarland: "SL",
    "schleswig holstein": "SH",
  },
  GB: { england: "ENG", scotland: "SCT", wales: "WLS", "northern ireland": "NIR" },
  CH: { zurich: "ZH", geneva: "GE", bern: "BE", basel: "BS", vaud: "VD", ticino: "TI", lucerne: "LU" },
  AT: { vienna: "9", "lower austria": "3", "upper austria": "4", tyrol: "7", styria: "6", carinthia: "2", salzburg: "5", vorarlberg: "8", burgenland: "1" },
};
const COUNTRY_REGION = { england: ["GB", "ENG"], scotland: ["GB", "SCT"], wales: ["GB", "WLS"], "northern ireland": ["GB", "NIR"] };

/**
 * A country (and optional state) for the holiday rules, from codes ("US", "US-CA", "DE-BY"),
 * names ("Germany", "Bavaria", "England") or a place the caller already resolved.
 * @returns {{country: string, state?: string, label: string}}
 */
export function resolveRegion(countryRaw, regionRaw) {
  let country;
  let state;
  const c = String(countryRaw ?? "").trim();
  const iso = c.match(/^([A-Za-z]{2})-([A-Za-z0-9]{1,3})$/);
  if (iso) [country, state] = [iso[1].toUpperCase(), iso[2].toUpperCase()];
  else if (COUNTRY_REGION[fold(c)]) [country, state] = COUNTRY_REGION[fold(c)];
  else country = COUNTRY_NAMES[c.toUpperCase()] ? c.toUpperCase() : (countryCode(c) ?? Object.keys(COUNTRY_NAMES).find((k) => fold(COUNTRY_NAMES[k]) === fold(c)));
  if (!country || !COUNTRY_NAMES[country]) throw new ToolError("unknown_country", `No holiday rules for "${c}". Give an ISO country code (DE, US, AE) or an English country name.`);
  if (regionRaw && !state) {
    state = stateCode(country, regionRaw);
    if (!state) state = String(regionRaw).trim().toUpperCase(); // reported as unknown below
  }
  if (state && !index.getStates(country)?.[state]) {
    const states = index.getStates(country, "en") ?? {};
    throw new ToolError(
      "unknown_region",
      `${COUNTRY_NAMES[country]} has no region "${regionRaw ?? state}".${
        Object.keys(states).length
          ? ` Regions: ${Object.entries(states)
              .slice(0, 20)
              .map(([k, v]) => `${k} ${v}`)
              .join(", ")}${Object.keys(states).length > 20 ? ", ..." : ""}.`
          : " Its holidays are national."
      }`,
    );
  }
  const stateName = state ? index.getStates(country, "en")[state] : undefined;
  return { country, state, label: stateName ? `${stateName}, ${COUNTRY_NAMES[country]}` : COUNTRY_NAMES[country] };
}

/** A state code from a code or a name, or undefined when the country has no such region (national rules apply). */
export function stateCode(country, raw) {
  const states = index.getStates(country, "en") ?? {};
  const r = String(raw ?? "").trim();
  if (!r) return undefined;
  const upper = r.toUpperCase().replace(new RegExp(`^${country}-`), "");
  if (states[upper]) return upper;
  const f = fold(r);
  return Object.keys(states).find((k) => fold(states[k]) === f) ?? REGION_ALIASES[country]?.[f];
}

const HIJRI = /\b(Muharram|Safar|Rabi al-awwal|Rabi al-thani|Jumada al-awwal|Jumada al-thani|Rajab|Shaban|Ramadan|Shawwal|Dhu al-Qidah|Dhu al-Hijjah)\b/i;
const rulesCache = new Map();

/**
 * Every holiday of a region in a year, one row per day (a four-day Eid is four rows), in date order.
 * @returns {{date: string, name: string, type: string, substitute?: true, estimated?: true, from?: string}[]}
 */
export function holidaysIn(region, year, types) {
  const key = `${region.country}|${region.state ?? ""}|${year}`;
  if (!rulesCache.has(key)) {
    // A holiday starting late in the previous year can run into this one.
    const rows = [...expand(region, year - 1), ...expand(region, year)].filter((r) => r.date.startsWith(`${year}-`));
    const seen = new Set();
    rulesCache.set(
      key,
      rows.filter((r) => !seen.has(`${r.date}|${r.name}`) && seen.add(`${r.date}|${r.name}`)).sort((a, b) => a.date.localeCompare(b.date)),
    );
  }
  return rulesCache.get(key).filter((h) => types.includes(h.type));
}

function expand(region, year) {
  const hd = new Holidays(region.country, region.state);
  // The country's own English where it has one ("Labor Day" in en-us), otherwise generic English.
  const lang = (hd.getLanguages() ?? []).find((l) => l.startsWith("en")) ?? "en";
  const rows = [];
  for (const h of hd.getHolidays(year, lang) ?? []) {
    const first = parseDate(h.date.slice(0, 10));
    const days = Math.max(1, Math.round((Date.parse(h.end) - Date.parse(h.start)) / 86_400_000));
    const from = h.date.slice(11, 16) !== "00:00" ? h.date.slice(11, 16) : undefined;
    for (let i = 0; i < days; i++)
      rows.push({ date: dateText(addDays(first, i)), name: h.name, type: h.type, substitute: h.substitute || undefined, estimated: HIJRI.test(h.rule ?? "") || undefined, from });
  }
  return rows;
}

const DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** The weekend of a country as ISO weekday numbers (6, 7 = Saturday, Sunday), from CLDR or an override. */
export function weekendOf(country, override) {
  if (override?.length) {
    return override.map((d) => {
      const i = DAY_NAMES.findIndex((n) => n.startsWith(String(d).toLowerCase().slice(0, 3)));
      if (i < 0) throw new ToolError("bad_weekend", `"${d}" is not a day of the week.`);
      return i + 1;
    });
  }
  const locale = new Intl.Locale(`und-${country ?? "001"}`);
  return (locale.getWeekInfo?.() ?? locale.weekInfo)?.weekend ?? [6, 7];
}
export const weekendNames = (days) => days.map((d) => DAY_NAMES[d - 1].slice(0, 3));

/**
 * Whether a date is a working day in a region: not a weekend day, not a full-day holiday of the
 * given types (a holiday from 14:00 leaves the morning working and is only noted).
 */
export function dayStatus(region, weekend, date, types) {
  const text = dateText(date);
  const holidays = region ? holidaysIn(region, date.year, types).filter((h) => h.date === text) : [];
  const closing = holidays.find((h) => !h.from);
  const isWeekend = weekend.includes(isoWeekday(date));
  return { working: !isWeekend && !closing, weekend: isWeekend || undefined, holiday: closing?.name, partial: holidays.find((h) => h.from) };
}
