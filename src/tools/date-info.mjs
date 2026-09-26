import { z } from "zod";
import { compact, defineTool, ToolError } from "../kit/index.mjs";
import { addDays, dateText, daysBetween, isoWeek, parseDate, weekdayName } from "../clock.mjs";
import { dateInput, OFFLINE, todayIn } from "./shared.mjs";

const UNITS = { y: "years", yr: "years", year: "years", years: "years", mo: "months", month: "months", months: "months", w: "weeks", wk: "weeks", week: "weeks", weeks: "weeks", d: "days", day: "days", days: "days" };

/** "+1 month", "-3 weeks", "2 years 6 months", "90d" or ISO "P1Y2M10D" -> {years, months, weeks, days}. */
export function parseDuration(text) {
  const t = String(text).trim();
  const iso = t.match(/^([+-])?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/i);
  if (iso && iso.slice(2).some(Boolean)) {
    const s = iso[1] === "-" ? -1 : 1;
    const n = (x) => s * (Number(x) || 0) || 0; // never -0
    return { years: n(iso[2]), months: n(iso[3]), weeks: n(iso[4]), days: n(iso[5]) };
  }
  const out = { years: 0, months: 0, weeks: 0, days: 0 };
  const parts = [...t.toLowerCase().matchAll(/([+-]?)\s*(\d+)\s*([a-z]+)/g)];
  if (!parts.length || parts.map((m) => m[0]).join("").replace(/\s|,|and/g, "").length !== t.toLowerCase().replace(/\s|,|and/g, "").length) throw new ToolError("bad_duration", `"${text}" is not a duration; write "+1 month", "-3 weeks", "90 days" or "P1Y2M".`);
  let sign = 1;
  for (const [, s, n, u] of parts) {
    if (s) sign = s === "-" ? -1 : 1;
    const unit = UNITS[u];
    if (!unit) throw new ToolError("bad_duration", `"${u}" is not a unit; use years, months, weeks or days.`);
    out[unit] += sign * Number(n);
  }
  return out;
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const monthDays = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

export const dateInfo = defineTool({
  name: "date_info",
  title: "Facts and arithmetic for a date",
  description: "Weekday, ISO week, day of year and leap year of a date ('today' = UTC); optionally the date after adding '+1 month' (month ends clamp) and the days until another date.",
  input: {
    date: z.string().max(10).describe("YYYY-MM-DD or 'today'"),
    add: z.string().max(40).optional().describe("'+1 month', '-3 weeks', 'P1Y2M'"),
    until: dateInput.optional(),
  },
  output: { date: z.string(), weekday: z.string() },
  annotations: OFFLINE,
  handler: async ({ date, add: addText, until }, ctx) => {
    const d = /^today$/i.test(date.trim()) ? todayIn(ctx, { offsetMinutes: 0 }) : parseDate(date);
    const add = addText ? parseDuration(addText) : undefined;
    const w = isoWeek(d);
    const out = {
      date: dateText(d),
      weekday: weekdayName(d),
      iso_week: `${w.year}-W${String(w.week).padStart(2, "0")}`,
      day_of_year: daysBetween({ year: d.year, month: 1, day: 1 }, d) + 1,
      quarter: `Q${Math.ceil(d.month / 3)}`,
      days_in_month: monthDays(d.year, d.month),
      leap_year: isLeap(d.year),
    };
    let result;
    let clamped;
    if (add) {
      const months = add.years * 12 + add.months;
      const total = d.year * 12 + (d.month - 1) + months;
      const y = Math.floor(total / 12);
      const m = (total % 12) + 1;
      if (y < 1 || y > 9999) throw new ToolError("too_far", "The result falls outside years 1 to 9999.");
      const day = Math.min(d.day, monthDays(y, m));
      clamped = day !== d.day;
      if (Math.abs(add.weeks * 7 + add.days) > 3_660_000) throw new ToolError("too_far", "That many days runs past years 1 to 9999.");
      const r = addDays({ year: y, month: m, day }, add.weeks * 7 + add.days);
      result = { date: dateText(r), weekday: weekdayName(r) };
    }
    return compact({
      ...out,
      result,
      note: clamped ? `Day ${d.day} does not exist in the target month; used its last day.` : undefined,
      days_until: until ? daysBetween(d, parseDate(until)) : undefined,
    });
  },
});
