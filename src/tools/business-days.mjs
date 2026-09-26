import { z } from "zod";
import { compact, defineTool, ToolError } from "../kit/index.mjs";
import { dayStatus, weekendNames, weekendOf } from "../calendar.mjs";
import { addDays, dateText, daysBetween, parseDate, weekdayName } from "../clock.mjs";
import { dateInput, OFFLINE, regionFor, where as whereInput } from "./shared.mjs";

const MAX_SPAN_DAYS = 3660;
const MAX_LISTED = 25;

export const businessDays = defineTool({
  name: "business_days",
  title: "Add or count business days",
  description: "Adds business days to a date (add: 10 or -5) or counts them to an end date, skipping the local weekend (Fri-Sat in Saudi Arabia) and public holidays.",
  input: {
    where: whereInput,
    start: dateInput,
    add: z.number().int().min(-2500).max(2500).optional(),
    end: dateInput.optional(),
    weekend: z.string().max(40).optional().describe("override, e.g. 'fri,sat'"),
  },
  output: { region: z.string(), start: z.string() },
  annotations: OFFLINE,
  handler: async ({ where, start, add, end, weekend }) => {
    if ((add === undefined) === (end === undefined)) throw new ToolError("bad_request", "Give either add (business days to add) or end (a date to count to), not both.");
    const r = regionFor(where);
    const days = weekendOf(r.country, weekend?.split(/[\s,]+/).filter(Boolean));
    const types = ["public"];
    const from = parseDate(start);
    const skipped = [];
    const note = (d, s) => skipped.length < MAX_LISTED && skipped.push(compact({ date: dateText(d), holiday: s.holiday, weekend: s.holiday ? undefined : s.weekend }));
    const base = { region: r.label, weekend_days: weekendNames(days), start, start_weekday: weekdayName(from) };
    if (add !== undefined) {
      // The start day itself is never counted: 1 business day after Friday is Monday.
      const step = add < 0 ? -1 : 1;
      let d = from;
      let left = Math.abs(add);
      let guard = 0;
      while (left > 0) {
        d = addDays(d, step);
        if (++guard > MAX_SPAN_DAYS * 2) throw new ToolError("too_far", "That many business days runs past the supported range.");
        const s = dayStatus(r, days, d, types);
        if (s.working) left--;
        else if (s.holiday) note(d, s);
      }
      return compact({ ...base, add, result: dateText(d), result_weekday: weekdayName(d), calendar_days: daysBetween(from, d), holidays_skipped: skipped.filter((x) => x.holiday) });
    }
    const to = parseDate(end);
    const span = daysBetween(from, to);
    if (Math.abs(span) > MAX_SPAN_DAYS) throw new ToolError("too_far", `Count at most ${MAX_SPAN_DAYS} days at once.`);
    const lo = span >= 0 ? from : to;
    let count = 0;
    for (let i = 0; i <= Math.abs(span); i++) {
      const d = addDays(lo, i);
      const s = dayStatus(r, days, d, types);
      if (s.working) count++;
      else if (s.holiday) note(d, s);
    }
    return compact({
      ...base,
      end,
      business_days: count,
      calendar_days: Math.abs(span) + 1,
      counted: "both start and end dates are counted when they are working days",
      holidays_excluded: skipped,
      note: span < 0 ? "end is before start; counted the same span." : undefined,
    });
  },
});
