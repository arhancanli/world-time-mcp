// src/clock.mjs
//
// Wall-clock arithmetic on IANA zones with the time zone database built into Node (ICU). A place
// is either a zone or a fixed UTC offset. Converting a local time to an instant has two traps
// agents fall into: at the spring-forward change some local times never happen, and at the
// fall-back change some happen twice. Both are detected and reported, never silently resolved.
import { ToolError } from "./kit/index.mjs";

const MINUTE = 60_000;
const DAY = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const partsFormat = new Map();
function formatter(zone) {
  if (!partsFormat.has(zone)) {
    partsFormat.set(
      zone,
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        weekday: "short",
        timeZoneName: "longOffset",
      }),
    );
  }
  return partsFormat.get(zone);
}

/** Offset from UTC in minutes for a place at an instant. */
export function offsetAt(place, epoch) {
  if (place.offsetMinutes !== undefined) return place.offsetMinutes;
  const name = formatter(place.zone)
    .formatToParts(epoch)
    .find((p) => p.type === "timeZoneName").value; // "GMT+05:30" or "GMT"
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** Local calendar fields for a place at an instant. */
export function localAt(place, epoch) {
  const shifted = new Date(epoch + offsetAt(place, epoch) * MINUTE);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: WEEKDAYS[shifted.getUTCDay()],
  };
}

const pad = (n, w = 2) => String(n).padStart(w, "0");
export const dateText = (l) => `${pad(l.year, 4)}-${pad(l.month)}-${pad(l.day)}`;
export const timeText = (l) => `${pad(l.hour)}:${pad(l.minute)}`;
export const offsetText = (min) => `${min < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(min) / 60))}:${pad(Math.abs(min) % 60)}`;

/** Standard (non-daylight) offset of a zone in a year: the smaller of January's and July's. */
export function standardOffset(place, year) {
  if (place.offsetMinutes !== undefined) return place.offsetMinutes;
  return Math.min(offsetAt(place, Date.UTC(year, 0, 1)), offsetAt(place, Date.UTC(year, 6, 1)));
}

/** The short label (PDT, CET) when the zone has a common one in English; undefined otherwise. */
export function abbreviationAt(place, epoch) {
  if (place.offsetMinutes !== undefined) return undefined;
  for (const locale of ["en-US", "en-GB", "en-AU", "en-IN"]) {
    const v = new Intl.DateTimeFormat(locale, { timeZone: place.zone, timeZoneName: "short" }).formatToParts(epoch).find((p) => p.type === "timeZoneName")?.value;
    if (v && /^[A-Z]{2,5}$/.test(v)) return v;
  }
  return undefined;
}

/** Everything about a place's clock at an instant. */
export function describeInstant(place, epoch) {
  const l = localAt(place, epoch);
  const off = offsetAt(place, epoch);
  return {
    date: dateText(l),
    time: timeText(l),
    weekday: l.weekday,
    utc_offset: offsetText(off),
    dst: place.offsetMinutes === undefined ? off > standardOffset(place, l.year) : false,
    abbreviation: abbreviationAt(place, epoch),
  };
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** "2026-03-08" -> {year, month, day}, validated. */
export function parseDate(text) {
  const m = String(text ?? "")
    .trim()
    .match(DATE);
  if (!m) throw new ToolError("bad_date", `"${text}" is not a date; write YYYY-MM-DD.`);
  const [year, month, day] = m.slice(1).map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) throw new ToolError("bad_date", `${text} does not exist.`);
  return { year, month, day };
}

/** "9am", "9:30 pm", "21:15", "09:00:00" -> {hour, minute}. */
export function parseClock(text) {
  const m = String(text ?? "")
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) throw new ToolError("bad_time", `"${text}" is not a time; write 14:30 or 2:30pm.`);
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const half = m[3]?.[0];
  if (half) {
    if (hour < 1 || hour > 12) throw new ToolError("bad_time", `"${text}" is not a 12-hour time.`);
    hour = (hour % 12) + (half === "p" ? 12 : 0);
  }
  if (hour > 23 || minute > 59) throw new ToolError("bad_time", `"${text}" is not a time of day.`);
  return { hour, minute };
}

/**
 * The instant a local wall time happens in a place.
 * @returns {{epoch: number, status: "ok"|"skipped"|"repeated", later?: number}}
 *   skipped: the clocks jumped over this time; epoch is the moment the gap ends (the time a clock
 *   reading forward would show). repeated: it happened twice; epoch is the first, later the second.
 */
export function instantOf(place, local) {
  const naive = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  if (place.offsetMinutes !== undefined) return { epoch: naive - place.offsetMinutes * MINUTE, status: "ok" };
  const offsets = [...new Set([offsetAt(place, naive - DAY), offsetAt(place, naive), offsetAt(place, naive + DAY)])];
  const matches = offsets
    .map((o) => naive - o * MINUTE)
    .filter((e) => {
      const back = localAt(place, e);
      return back.year === local.year && back.month === local.month && back.day === local.day && back.hour === local.hour && back.minute === local.minute;
    });
  const unique = [...new Set(matches)].sort((a, b) => a - b);
  if (unique.length === 1) return { epoch: unique[0], status: "ok" };
  if (unique.length > 1) return { epoch: unique[0], later: unique.at(-1), status: "repeated" };
  // In a gap: the offset before the change applied to the wall time lands after the gap ends.
  const before = offsetAt(place, naive - DAY);
  return { epoch: naive - before * MINUTE, status: "skipped" };
}

/** Days from one calendar date to another (positive when b is later). */
export const daysBetween = (a, b) => Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY);

/** A calendar date moved by whole days. */
export function addDays(d, n) {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day) + n * DAY);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** Weekday number of a calendar date, 1 = Monday ... 7 = Sunday (ISO, as CLDR's week data uses). */
export const isoWeekday = (d) => ((new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay() + 6) % 7) + 1;
export const weekdayName = (d) => WEEKDAYS[new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()];

/** ISO 8601 week number and week-year. */
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day));
  const dayNum = isoWeekday(d);
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return { week: Math.ceil(((t - yearStart) / DAY + 1) / 7), year: t.getUTCFullYear() };
}

/**
 * The next time a place's clocks change after an instant, within 400 days: the local wall time at
 * which they change (before the change) and the offset after it. Undefined for places without DST.
 */
export function nextChange(place, epoch) {
  if (place.offsetMinutes !== undefined) return undefined;
  const WEEK = 7 * DAY;
  const start = offsetAt(place, epoch);
  let lo = epoch;
  let hi;
  for (let t = epoch + WEEK; t <= epoch + 400 * DAY; t += WEEK) {
    if (offsetAt(place, t) !== start) {
      hi = t;
      break;
    }
    lo = t;
  }
  if (hi === undefined) return undefined;
  while (hi - lo > MINUTE) {
    const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE;
    if (offsetAt(place, mid) === start) lo = mid;
    else hi = mid;
  }
  const before = localAt({ offsetMinutes: start }, hi);
  return { date: dateText(before), at: timeText(before), to: offsetText(offsetAt(place, hi)) };
}
