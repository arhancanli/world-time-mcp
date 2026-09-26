#!/usr/bin/env node
// world-time: Time and calendar answers agents get wrong: the time anywhere by city, country or zone, DST-safe conversions that flag skipped and repeated hours, public holidays for 200+ countries and their regions, business-day arithmetic with each country's own weekend, and meeting slots across time zones. Works offline, no key.
//
// Tools live in src/tools/, one file each. The kit in src/kit/ is a copy of the factory kit
// (a drift test keeps it identical); it holds the network guard, the result wrapper and the
// stdio and HTTP entry points.
import { readFileSync } from "node:fs";
import { createServer, isMain, start } from "./kit/index.mjs";
import { businessDays } from "./tools/business-days.mjs";
import { dateInfo } from "./tools/date-info.mjs";
import { holidays } from "./tools/holidays.mjs";
import { meetingSlots } from "./tools/meeting-slots.mjs";
import { worldTime } from "./tools/world-time.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const SERVER_NAME = pkg.name;
export const SERVER_VERSION = pkg.version;
export const TOOLS = [worldTime, holidays, businessDays, meetingSlots, dateInfo];

export const INSTRUCTIONS = "Answer time and calendar questions with these tools, not from memory: world_time (time now or converted, DST gaps flagged), holidays, business_days, meeting_slots (any meeting across time zones) and date_info. Every result names the zone or region used.";

// No network: the time zone database (ICU, in Node), the holiday rules and the city list are local.
// now is injectable so tests run at a fixed moment.
export function createContext({ now } = {}) {
  return { now };
}

export function buildServer(ctx = createContext()) {
  return createServer({ name: SERVER_NAME, version: SERVER_VERSION, instructions: INSTRUCTIONS, tools: TOOLS, ctx });
}

if (isMain(import.meta.url)) start(() => buildServer(), SERVER_NAME);
