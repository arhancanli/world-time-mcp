import { z } from "zod";
import { compact, defineTool } from "../kit/index.mjs";
import { daysBetween, instantOf, nextChange, parseClock, parseDate } from "../clock.mjs";
import { resolvePlace } from "../places.mjs";
import { clockRow, nowOf, OFFLINE, place, todayIn } from "./shared.mjs";

/** "2026-11-01 01:30", "2026-11-01T01:30", "9am", "14:30" or "now" -> {date?, clock?} */
function splitTime(text) {
  const t = String(text).trim();
  if (/^now$/i.test(t)) return { now: true };
  const m = t.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s]+(.+))?$/i);
  if (m) return { date: parseDate(m[1]), clock: parseClock(m[2] ?? "00:00") };
  return { clock: parseClock(t) };
}

const utcText = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

export const worldTime = defineTool({
  name: "world_time",
  title: "Time in places, now or converted",
  description: "Time now in up to 20 places, or a local time in `from` converted to them ('2026-03-08 02:30', '9am'). Flags times DST skips or repeats; gives each place's offset and next clock change. Places: city, country, zone, PST, UTC+4.",
  input: { places: z.array(place).min(1).max(20), time: z.string().max(40).optional().describe("default now"), from: place.optional().describe("where time is local; default UTC") },
  output: { utc: z.string(), results: z.array(z.looseObject({ place: z.string() })) },
  annotations: OFFLINE,
  handler: async ({ places, time, from }, ctx) => {
    const parsed = splitTime(time ?? "now");
    const src = from ? resolvePlace(from) : { offsetMinutes: 0, label: "UTC" };
    let epoch = nowOf(ctx);
    let status = "ok";
    let later;
    if (!parsed.now) ({ epoch, status, later } = instantOf(src, { ...(parsed.date ?? todayIn(ctx, src)), ...parsed.clock }));
    const origin = from ? clockRow(src, epoch) : undefined;
    const results = places.map((raw) => {
      const p = resolvePlace(raw);
      const row = clockRow(p, epoch);
      const shift = origin ? daysBetween(parseDate(origin.date), parseDate(row.date)) : 0;
      const change = nextChange(p, epoch);
      return compact({ ...row, day_change: shift ? (shift > 0 ? `+${shift}` : String(shift)) : undefined, next_change: change && `${change.date} ${change.at} to ${change.to}` });
    });
    const asked = parsed.clock && `${String(parsed.clock.hour).padStart(2, "0")}:${String(parsed.clock.minute).padStart(2, "0")}`;
    const note =
      status === "skipped"
        ? `${asked} does not exist in ${src.label} on ${origin.date}: clocks jump forward past it. Converted ${origin.time}, the time a clock shows at that moment.`
        : status === "repeated"
          ? `${asked} happens twice in ${src.label} on ${origin.date} as clocks fall back. Converted the first; the second is at ${utcText(later)} UTC.`
          : undefined;
    return compact({ utc: utcText(epoch), from: origin && compact(origin), status: status === "ok" ? undefined : status, note, results });
  },
});
