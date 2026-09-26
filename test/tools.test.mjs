// Golden tests: every tool over a real MCP client at 2026-09-26 14:00 UTC.
import assert from "node:assert/strict";
import test from "node:test";
import { call, connect } from "./harness.mjs";

test("world_time now: cities, ambiguous names, countries with several zones, abbreviations, offsets, next change", async () => {
  const client = await connect();
  const { data } = await call(client, "world_time", { places: ["Dubai", "Portland", "Portland, Maine", "United States", "PST", "UTC+5:30", "Asia/Kathmandu", "London"] });
  const [dubai, portland, maine, us, pst, offset, kathmandu, london] = data.results;
  assert.equal(data.utc, "2026-09-26 14:00");
  assert.deepEqual([dubai.place, dubai.zone, dubai.time, dubai.utc_offset, dubai.dst], ["Dubai, AE", "Asia/Dubai", "18:00", "+04:00", false]);
  assert.deepEqual([portland.place, portland.time, portland.abbreviation, portland.dst], ["Portland, Oregon, US", "07:00", "PDT", true], "the most populous Portland");
  assert.deepEqual([maine.zone, maine.time], ["America/New_York", "10:00"]);
  assert.match(us.note, /United States spans 6 UTC offsets; used New York's clock/);
  assert.match(pst.note, /PST was written, but America\/Los_Angeles is on PDT on 2026-09-26/);
  assert.deepEqual([offset.place, offset.time, offset.dst], ["UTC+05:30", "19:30", false]);
  assert.equal(kathmandu.utc_offset, "+05:45");
  assert.equal(london.next_change, "2026-10-25 02:00 to +00:00", "clocks go back at 02:00 BST");
  assert.equal(dubai.next_change, undefined, "no DST in Dubai");
  assert.equal(data.from, undefined);
  const bad = await call(client, "world_time", { places: ["Nowhereville"] });
  assert.equal(bad.data.error.code, "unknown_place");
});

test("world_time converting: skipped and repeated times are flagged, day changes shown", async () => {
  const client = await connect();
  const skipped = await call(client, "world_time", { places: ["London", "Dubai"], time: "2026-03-08 02:30", from: "New York" });
  assert.equal(skipped.data.status, "skipped");
  assert.equal(skipped.data.from.time, "03:30");
  assert.equal(skipped.data.utc, "2026-03-08 07:30");
  assert.equal(skipped.data.results[0].time, "07:30");
  const repeated = await call(client, "world_time", { places: ["London"], time: "2026-11-01 01:30", from: "New York" });
  assert.equal(repeated.data.status, "repeated");
  assert.match(repeated.data.note, /second is at 2026-11-01 06:30 UTC/);
  assert.equal(repeated.data.utc, "2026-11-01 05:30", "the first 01:30 (EDT)");
  const today = await call(client, "world_time", { places: ["Tokyo", "Sydney"], time: "9pm", from: "Los Angeles" });
  assert.equal(today.data.from.date, "2026-09-26", "no date means today in the source place");
  assert.deepEqual([today.data.results[0].date, today.data.results[0].time, today.data.results[0].day_change], ["2026-09-27", "13:00", "+1"]);
  assert.equal(today.data.status, undefined);
});

test("holidays: a year's list, one date's status, multi-day and estimated Islamic holidays, regions", async () => {
  const client = await connect();
  const sa = await call(client, "holidays", { where: "Saudi Arabia", year: 2026 });
  const eid = sa.data.results.filter((h) => h.name.includes("Eid al-Fitr"));
  assert.deepEqual(eid.map((h) => h.date), ["2026-03-19", "2026-03-20", "2026-03-21", "2026-03-22"], "one row per day of a four-day holiday");
  assert.ok(eid.every((h) => h.estimated));
  assert.match(sa.data.note, /moon sighting/);
  const bavaria = await call(client, "holidays", { where: "Munich", date: "2026-01-06" });
  assert.deepEqual([bavaria.data.region, bavaria.data.working_day, bavaria.data.results[0].name], ["Bayern, Germany", false, "Epiphany"], "a city resolves to its state's rules");
  const berlin = await call(client, "holidays", { where: "Berlin", date: "2026-01-06" });
  assert.deepEqual([berlin.data.working_day, berlin.data.results], [true, []], "Epiphany is not a holiday in Berlin");
  const ca = await call(client, "holidays", { where: "US-CA", year: 2026 });
  assert.ok(ca.data.results.some((h) => h.name === "Labor Day" && h.date === "2026-09-07"), "the country's own English");
  assert.ok(ca.data.results.some((h) => h.name === "César Chávez Day"));
  const england = await call(client, "holidays", { where: "England", date: "2026-12-28" });
  assert.equal(england.data.results[0].substitute, true);
  const mothers = await call(client, "holidays", { where: "GB", year: 2026, all: true });
  assert.ok(mothers.data.results.some((h) => h.name === "Mother's Day" && h.date === "2026-03-15" && h.type === "observance"), "observances with all");
  assert.ok(!sa.data.results.some((h) => h.type), "public only by default");
  const bad = await call(client, "holidays", { where: "Atlantis" });
  assert.equal(bad.data.error.code, "unknown_country");
});

test("business_days: the local weekend and holidays are skipped; counting includes both ends", async () => {
  const client = await connect();
  const sa = await call(client, "business_days", { where: "Saudi Arabia", start: "2026-03-12", add: 5 });
  assert.deepEqual(sa.data.weekend_days, ["fri", "sat"]);
  // Thu 12 + 5: Sun 15 to Wed 18 are days 1-4; Eid runs Thu 19 to Sun 22 (with the Fri-Sat weekend); Mon 23 is day 5.
  assert.equal(sa.data.result, "2026-03-23");
  assert.equal(sa.data.holidays_skipped.length, 4);
  const us = await call(client, "business_days", { where: "US", start: "2026-12-01", end: "2026-12-31" });
  assert.deepEqual([us.data.business_days, us.data.calendar_days, us.data.holidays_excluded[0].holiday], [22, 31, "Christmas Day"]);
  const back = await call(client, "business_days", { where: "GB", start: "2026-12-29", add: -2 });
  // Tue 29 back 2: Mon 28 (Boxing Day's substitute), the weekend and Fri 25 (Christmas) are skipped; Thu 24 is 1, Wed 23 is 2.
  assert.equal(back.data.result, "2026-12-23");
  const custom = await call(client, "business_days", { where: "Bangladesh", start: "2026-10-01", add: 1, weekend: "fri,sat" });
  assert.deepEqual([custom.data.weekend_days, custom.data.result], [["fri", "sat"], "2026-10-04"]);
  const both = await call(client, "business_days", { where: "US", start: "2026-12-01", add: 1, end: "2026-12-31" });
  assert.equal(both.data.error.code, "bad_request");
});

test("meeting_slots: overlap windows across zones, holidays skipped; the closest time when none fits", async () => {
  const client = await connect();
  const xmas = await call(client, "meeting_slots", { people: ["New York", "London 08:00-18:00", "Berlin"], date: "2026-12-24", days: 3, minutes: 60 });
  assert.equal(xmas.data.slots.length, 1, "only the 24th: the 25th and 26th are holidays or weekend");
  assert.deepEqual([xmas.data.slots[0].utc_start, xmas.data.slots[0].utc_end], ["2026-12-24 14:00", "2026-12-24 16:00"]);
  assert.ok(xmas.data.slots[0].local.includes("London, GB: 2026-12-24 14:00-16:00"));
  const none = await call(client, "meeting_slots", { people: ["San Francisco", "London", "Dubai"], date: "2026-09-28", days: 1 });
  assert.deepEqual(none.data.slots, []);
  assert.equal(none.data.closest.utc_start, "2026-09-28 12:30");
  assert.match(none.data.closest.local[0], /San Francisco, California, US: 2026-09-28 05:30 \(210 min outside hours\)/);
});

test("date_info: weekday, ISO week 53, month-end clamping, durations in words or ISO 8601", async () => {
  const client = await connect();
  const { data } = await call(client, "date_info", { date: "2027-01-31", add: "+1 month", until: "2027-12-25" });
  assert.deepEqual([data.weekday, data.iso_week, data.result.date, data.days_until], ["Sunday", "2027-W04", "2027-02-28", 328]);
  assert.match(data.note, /used its last day/);
  const w53 = await call(client, "date_info", { date: "2027-01-01" });
  assert.deepEqual([w53.data.weekday, w53.data.iso_week], ["Friday", "2026-W53"]);
  const iso = await call(client, "date_info", { date: "2028-02-29", add: "P1Y" });
  assert.deepEqual([iso.data.leap_year, iso.data.result.date], [true, "2029-02-28"]);
  const today = await call(client, "date_info", { date: "today", add: "-3 weeks" });
  assert.deepEqual([today.data.date, today.data.result.date], ["2026-09-26", "2026-09-05"]);
  const bad = await call(client, "date_info", { date: "2027-02-30" });
  assert.equal(bad.data.error.code, "bad_date");
});
