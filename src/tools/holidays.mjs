import { z } from "zod";
import { compact, defineTool } from "../kit/index.mjs";
import { dayStatus, holidaysIn, weekendNames, weekendOf } from "../calendar.mjs";
import { parseDate, weekdayName } from "../clock.mjs";
import { allTypes, dateInput, nowOf, OFFLINE, regionFor, where as whereInput } from "./shared.mjs";

const clean = (h) =>
  compact({
    date: h.date,
    name: h.name,
    type: h.type === "public" ? undefined : h.type,
    substitute: h.substitute,
    estimated: h.estimated,
    from: h.from,
  });

export const holidays = defineTool({
  name: "holidays",
  title: "Public holidays",
  description: "Holidays of a country, state or city for a year, or whether one date is a working day, with the next holidays. 207 countries; Islamic-calendar dates are estimates.",
  input: {
    where: whereInput,
    year: z.number().int().min(1970).max(2100).optional(),
    date: dateInput.optional(),
    all: allTypes,
  },
  output: {
    region: z.string(),
    results: z.array(z.looseObject({ date: z.string(), name: z.string() })),
  },
  annotations: OFFLINE,
  handler: async ({ where, year, date, all }, ctx) => {
    const r = regionFor(where);
    const types = all ? ["public", "bank", "optional", "school", "observance"] : ["public"];
    const estimatedNote = (rows) => (rows.some((h) => h.estimated) ? "Estimated dates follow the Islamic calendar; the official day is set by moon sighting and can differ by one day." : undefined);
    if (date) {
      const d = parseDate(date);
      const status = dayStatus(r, weekendOf(r.country), d, types);
      const onDay = holidaysIn(r, d.year, types).filter((h) => h.date === date);
      const next = [...holidaysIn(r, d.year, types), ...holidaysIn(r, d.year + 1, types)].filter((h) => h.date > date).slice(0, 3);
      // results stays outside compact(), which would drop the empty list of an ordinary day.
      return {
        results: onDay.map(clean),
        ...compact({
          region: r.label,
          date,
          weekday: weekdayName(d),
          working_day: status.working,
          weekend: status.weekend,
          weekend_days: weekendNames(weekendOf(r.country)),
          next: next.map(clean),
          note: estimatedNote([...onDay, ...next]),
        }),
      };
    }
    const y = year ?? Number(new Date(nowOf(ctx)).toISOString().slice(0, 4));
    const rows = holidaysIn(r, y, types);
    return {
      ...compact({
        region: r.label,
        year: y,
        count: rows.length,
        note: estimatedNote(rows),
      }),
      region: r.label,
      results: rows.map(clean),
    };
  },
});
