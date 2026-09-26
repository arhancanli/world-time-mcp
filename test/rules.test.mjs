// The rules without the MCP layer: DST gaps and repeats in both hemispheres and at half-hour
// shifts, clock and place parsing, CLDR weekends, holiday expansion and partial days.
import assert from "node:assert/strict";
import test from "node:test";
import { dayStatus, holidaysIn, resolveRegion, weekendOf } from "../src/calendar.mjs";
import { describeInstant, instantOf, isoWeek, parseClock, parseDate } from "../src/clock.mjs";
import { resolvePlace } from "../src/places.mjs";
import { parseDuration } from "../src/tools/date-info.mjs";

const at = (zone, date, hour, minute = 0) => instantOf({ zone }, { ...parseDate(date), hour, minute });

test("DST: gaps and repeats in the southern hemisphere and at Lord Howe Island's half-hour change", () => {
  assert.equal(at("Australia/Sydney", "2026-10-04", 2, 30).status, "skipped");
  assert.equal(at("Australia/Sydney", "2026-04-05", 2, 30).status, "repeated");
  assert.equal(at("Australia/Sydney", "2026-04-05", 3, 30).status, "ok");
  assert.equal(at("Australia/Lord_Howe", "2026-10-04", 2, 15).status, "skipped", "clocks go from 02:00 to 02:30");
  assert.equal(at("Australia/Lord_Howe", "2026-10-04", 2, 45).status, "ok");
  assert.equal(at("Australia/Lord_Howe", "2026-04-05", 1, 45).status, "repeated");
  assert.equal(at("Asia/Dubai", "2026-03-08", 2, 30).status, "ok", "no DST at all");
  const r = at("Europe/London", "2026-10-25", 1, 30);
  assert.deepEqual([r.status, new Date(r.epoch).toISOString(), new Date(r.later).toISOString()], ["repeated", "2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"]);
});

test("offsets: quarter-hour zones, DST flags, fixed offsets", () => {
  const sept = Date.parse("2026-09-26T14:00:00Z");
  assert.equal(describeInstant({ zone: "Pacific/Chatham" }, Date.parse("2026-07-01T00:00:00Z")).utc_offset, "+12:45");
  assert.equal(describeInstant({ zone: "Pacific/Chatham" }, Date.parse("2026-12-01T00:00:00Z")).utc_offset, "+13:45");
  assert.equal(describeInstant({ zone: "Pacific/Chatham" }, Date.parse("2026-12-01T00:00:00Z")).dst, true);
  assert.equal(describeInstant({ zone: "Australia/Sydney" }, Date.parse("2026-12-01T00:00:00Z")).dst, true, "summer in the south");
  assert.deepEqual(describeInstant({ offsetMinutes: -210 }, sept), { date: "2026-09-26", time: "10:30", weekday: "Saturday", utc_offset: "-03:30", dst: false, abbreviation: undefined });
});

test("clock and duration parsing", () => {
  assert.deepEqual(parseClock("12am"), { hour: 0, minute: 0 });
  assert.deepEqual(parseClock("12pm"), { hour: 12, minute: 0 });
  assert.deepEqual(parseClock("9:30 PM"), { hour: 21, minute: 30 });
  assert.deepEqual(parseClock("09:05:59"), { hour: 9, minute: 5 });
  for (const bad of ["24:00", "13pm", "noonish", "9:60"]) assert.throws(() => parseClock(bad), { code: "bad_time" });
  assert.throws(() => parseDate("2026-02-29"), { code: "bad_date" });
  assert.deepEqual(parseDuration("2 years 6 months"), { years: 2, months: 6, weeks: 0, days: 0 });
  assert.deepEqual(parseDuration("-P2W"), { years: 0, months: 0, weeks: -2, days: 0 });
  assert.throws(() => parseDuration("3 fortnights"), { code: "bad_duration" });
});

test("places: zones, legacy links, offsets, abbreviations, qualified cities, states", () => {
  assert.equal(resolvePlace("america/new_york").zone, "America/New_York");
  assert.equal(resolvePlace("US/Pacific").zone, "America/Los_Angeles");
  assert.equal(resolvePlace("utc").zone, "UTC");
  assert.equal(resolvePlace("GMT-3:30").offsetMinutes, -210);
  assert.equal(resolvePlace("+05:45").offsetMinutes, 345);
  assert.throws(() => resolvePlace("UTC+15"), { code: "bad_place" });
  assert.match(resolvePlace("IST").note, /Israel or Irish/);
  assert.equal(resolvePlace("Paris, FR").zone, "Europe/Paris");
  assert.equal(resolvePlace("Birmingham, AL").zone, "America/Chicago");
  assert.equal(resolvePlace("Birmingham").zone, "Europe/London");
  assert.match(resolvePlace("Birmingham").note, /Also Birmingham, Alabama, US/, "a namesake at least a quarter the size is named");
  assert.equal(resolvePlace("Portland").note, undefined, "Portland, Maine is a twelfth of Portland, Oregon: the label says which was used");
  assert.equal(resolvePlace("London").note, undefined);
  assert.equal(resolvePlace("Portland, ME").zone, "America/New_York");
  assert.throws(() => resolvePlace("Paris, Japan"), { code: "unknown_place" });
  assert.equal(resolvePlace("Sao Paulo").zone, "America/Sao_Paulo", "accents optional");
  assert.equal(resolvePlace("UAE").zone, "Asia/Dubai");
  assert.equal(resolvePlace("Queensland").zone, "Australia/Brisbane");
});

test("weekends: CLDR per country, overridable", () => {
  assert.deepEqual(weekendOf("SA"), [5, 6]);
  assert.deepEqual(weekendOf("AE"), [6, 7], "the UAE moved to Saturday-Sunday in 2022");
  assert.deepEqual(weekendOf("IN"), [7]);
  assert.deepEqual(weekendOf("DE", ["Friday", "sat"]), [5, 6]);
  assert.throws(() => weekendOf("DE", ["funday"]), { code: "bad_weekend" });
});

test("holidays: regions by code and name, partial days noted but not closing, ISO weeks at year ends", () => {
  assert.equal(resolveRegion("DE", "Bavaria").state, "BY");
  assert.equal(resolveRegion("US-CA").state, "CA");
  assert.throws(() => resolveRegion("DE", "Narnia"), { code: "unknown_region" });
  const by = resolveRegion("DE", "BY");
  const eve = dayStatus(by, [6, 7], parseDate("2026-12-24"), ["public", "bank"]);
  assert.deepEqual([eve.working, eve.partial.from, eve.partial.name], [true, "14:00", "Christmas Eve"], "from 14:00: the morning works");
  assert.ok(holidaysIn(by, 2026, ["public"]).every((h) => h.date.startsWith("2026-")));
  assert.deepEqual(isoWeek(parseDate("2026-12-31")), { week: 53, year: 2026 });
  assert.deepEqual(isoWeek(parseDate("2027-01-04")), { week: 1, year: 2027 });
  assert.deepEqual(isoWeek(parseDate("2024-12-30")), { week: 1, year: 2025 });
});
