// The calls the golden tests make and scripts/perf.mjs times. The server is offline (time zone
// database, holiday rules and cities are local), so the tests run the real code at a fixed moment.
export const NOW = Date.parse("2026-09-26T14:00:00Z");

export const SCENARIOS = [
  { label: "world_time: now in 5 places (city, ambiguous city, country, abbreviation, offset)", tool: "world_time", args: { places: ["Dubai", "Portland", "United States", "PST", "UTC+5:30"] } },
  { label: "world_time: a time the spring-forward change skips", tool: "world_time", args: { places: ["London", "Dubai"], time: "2026-03-08 02:30", from: "New York" }, example: true },
  { label: "holidays: Saudi Arabia 2026 (multi-day Eid, estimated)", tool: "holidays", args: { where: "Saudi Arabia", year: 2026 } },
  { label: "business_days: 5 business days in Saudi Arabia across Eid", tool: "business_days", args: { where: "Saudi Arabia", start: "2026-03-12", add: 5 } },
  { label: "meeting_slots: New York, London, Berlin over Christmas", tool: "meeting_slots", args: { people: ["New York", "London 08:00-18:00", "Berlin"], date: "2026-12-24", days: 3, minutes: 60 } },
  { label: "date_info: Jan 31 plus one month, days to Christmas", tool: "date_info", args: { date: "2027-01-31", add: "+1 month", until: "2027-12-25" } },
];
