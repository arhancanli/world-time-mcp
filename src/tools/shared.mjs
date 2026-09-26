import { z } from "zod";
import { ToolError } from "../kit/index.mjs";
import { resolveRegion, stateCode } from "../calendar.mjs";
import { describeInstant, localAt } from "../clock.mjs";
import { resolvePlace } from "../places.mjs";

// Nothing here leaves the process: the time zone database, holiday rules and cities are local.
export const OFFLINE = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const place = z.string().max(100);
export const where = z.string().max(100).describe("country, state, US-CA or city");
export const dateInput = z.string().max(10).describe("YYYY-MM-DD");
export const allTypes = z.boolean().optional().describe("also bank, optional and observance days");

export const nowOf = (ctx) => ctx.now?.() ?? Date.now();
export const placeRow = (p) => ({ place: p.label, zone: p.zone ?? p.label, note: p.note });

/** A place's clock at an instant, noting when a written abbreviation is the other half of the year's ("EST" in July). */
export function clockRow(p, epoch) {
  const d = describeInstant(p, epoch);
  const row = { ...placeRow(p), ...d };
  if (p.abbreviation && p.abbreviation.length >= 3 && d.abbreviation && d.abbreviation.toLowerCase() !== p.abbreviation) {
    const said = `${p.abbreviation.toUpperCase()} was written, but ${p.zone} is on ${d.abbreviation} on ${d.date}; used its clock.`;
    row.note = [said, p.note].filter(Boolean).join(" ");
  }
  return row;
}

/** Today's calendar date in a place. */
export const todayIn = (ctx, p) => {
  const l = localAt(p, nowOf(ctx));
  return { year: l.year, month: l.month, day: l.day };
};

/**
 * The holiday region for a country ("DE", "Germany"), an ISO 3166-2 code ("US-CA"), a region and
 * its country ("Bavaria, Germany"), a state or province ("California"), or a city ("Munich" is
 * Bavaria's rules).
 * @returns {{country: string, state?: string, label: string}}
 */
export function regionFor(where) {
  try {
    return resolveRegion(where);
  } catch (err) {
    if (!(err instanceof ToolError) || err.code !== "unknown_country") throw err;
    const [head, ...rest] = String(where).split(",");
    let best = err; // the most specific reason, if nothing matches
    if (rest.length) {
      try {
        return resolveRegion(rest.join(",").trim(), head.trim());
      } catch (inner) {
        // "Munich, Germany": not a state, so a city; fall through to the place lookup.
        if (!(inner instanceof ToolError) || !["unknown_country", "unknown_region"].includes(inner.code)) throw inner;
        if (inner.code === "unknown_region") best = inner;
      }
    }
    let p;
    try {
      p = resolvePlace(where);
    } catch {
      throw best;
    }
    if (!p.country) throw best;
    return resolveRegion(p.country, p.province ? stateCode(p.country, p.province) : undefined);
  }
}
