import { z } from "zod";
import { compact, defineTool } from "../kit/index.mjs";
import { dayStatus, resolveRegion, stateCode, weekendOf } from "../calendar.mjs";
import { addDays, dateText, instantOf, localAt, parseClock, parseDate, timeText } from "../clock.mjs";
import { resolvePlace } from "../places.mjs";
import { dateInput, OFFLINE } from "./shared.mjs";

const STEP_MIN = 15;
const MAX_SLOTS = 10;
const MINUTE = 60_000;

export const meetingSlots = defineTool({
  name: "meeting_slots",
  title: "Find meeting times across time zones",
  description: "Use for any meeting across time zones: windows inside everyone's working hours (09:00-17:00 unless given) over up to 14 days, skipping weekends and holidays, else the closest time.",
  input: {
    people: z.array(z.string().max(120)).min(2).max(10).describe("'London', 'Tokyo 08:00-18:00'"),
    date: dateInput,
    days: z.number().int().min(1).max(14).default(5),
    minutes: z.number().int().min(15).max(480).default(30),
  },
  output: { slots: z.array(z.looseObject({ utc_start: z.string() })) },
  annotations: OFFLINE,
  handler: async ({ people, date, days, minutes }) => {
    const who = people.map((raw) => {
      const p = splitPerson(raw);
      const where = resolvePlace(p.place);
      let region;
      try {
        region = where.country ? resolveRegion(where.country, where.province ? stateCode(where.country, where.province) : undefined) : undefined;
      } catch {
        region = undefined; // no holiday rules for this country: weekends only
      }
      const from = parseClock(p.from ?? "09:00");
      const to = parseClock(p.to ?? "17:00");
      return { label: where.label, where, region, weekend: weekendOf(where.country), from: from.hour * 60 + from.minute, to: to.hour * 60 + to.minute === 0 ? 1440 : to.hour * 60 + to.minute, note: where.note };
    });
    const first = parseDate(date);
    // Scan from the start of the first day in the earliest zone to the end of the last day in the latest.
    const start = Math.min(...who.map((w) => instantOf(w.where, { ...first, hour: 0, minute: 0 }).epoch));
    const last = addDays(first, days);
    const end = Math.max(...who.map((w) => instantOf(w.where, { ...last, hour: 0, minute: 0 }).epoch));
    const closed = new Map(); // "label|date" -> reason
    const free = (w, t) => {
      const l = localAt(w.where, t);
      const key = `${w.label}|${dateText(l)}`;
      if (!closed.has(key)) {
        const s = dayStatus(w.region, w.weekend, l, ["public"]);
        closed.set(key, s.working ? null : s.holiday ? `${s.holiday}` : "weekend");
      }
      if (closed.get(key)) return false;
      const m = l.hour * 60 + l.minute;
      return m >= w.from && m < w.to;
    };
    const fits = (t) => who.every((w) => free(w, t) && free(w, t + (minutes - STEP_MIN) * MINUTE)) && who.every((w) => sameDay(w, t, t + minutes * MINUTE - MINUTE));
    // When nothing fits, the closest time: everyone on a working day, fewest minutes outside anyone's hours.
    const outside = (w, t) => {
      const l = localAt(w.where, t);
      if (closed.get(`${w.label}|${dateText(l)}`) || !sameDay(w, t, t + minutes * MINUTE - MINUTE)) return Infinity;
      const m = l.hour * 60 + l.minute;
      return Math.max(0, w.from - m) + Math.max(0, m + minutes - w.to);
    };
    let closest = null;
    const windows = [];
    let open = null;
    for (let t = start; t < end; t += STEP_MIN * MINUTE) {
      who.forEach((w) => free(w, t)); // fills the working-day cache used by outside()
      const cost = who.reduce((sum, w) => sum + outside(w, t), 0);
      if (cost < (closest?.cost ?? Infinity)) closest = { t, cost };
      if (fits(t)) open ??= t;
      else if (open !== null) {
        windows.push([open, t - STEP_MIN * MINUTE + minutes * MINUTE]);
        open = null;
      }
    }
    if (open !== null) windows.push([open, end - STEP_MIN * MINUTE + minutes * MINUTE]);
    const iso = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
    const slots = windows.slice(0, MAX_SLOTS).map(([a, b]) => ({
      utc_start: iso(a),
      utc_end: iso(b),
      local: who.map((w) => `${w.label}: ${dateText(localAt(w.where, a))} ${timeText(localAt(w.where, a))}-${timeText(localAt(w.where, b))}`),
    }));
    const days_off = [...closed.entries()].filter(([, v]) => v && v !== "weekend").map(([k, v]) => `${k.replace("|", " ")}: ${v}`);
    return {
      slots,
      ...compact({
        more: windows.length > MAX_SLOTS ? windows.length - MAX_SLOTS : undefined,
        holidays: days_off.length ? days_off : undefined,
        notes: who.map((w) => w.note).filter(Boolean),
        note: slots.length ? undefined : "No time fits everyone's working hours on working days in this range.",
        closest:
          !slots.length && closest && Number.isFinite(closest.cost)
            ? {
                utc_start: iso(closest.t),
                local: who.map((w) => {
                  const l = localAt(w.where, closest.t);
                  const off = outside(w, closest.t);
                  return `${w.label}: ${dateText(l)} ${timeText(l)}${off ? ` (${off} min outside hours)` : ""}`;
                }),
              }
            : undefined,
      }),
    };
  },
});

/** "Tokyo 08:00-18:00" -> {place, from, to}; hours optional. */
function splitPerson(raw) {
  const m = String(raw).trim().match(/^(.*?)[\s,]+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to|\u2013)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i);
  return m ? { place: m[1], from: m[2], to: m[3] } : { place: String(raw).trim() };
}

/** The local date is the same at both instants (a slot never runs past someone's midnight). */
function sameDay(w, a, b) {
  return dateText(localAt(w.where, a)) === dateText(localAt(w.where, b));
}
