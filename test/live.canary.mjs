// Weekly canary (.github/workflows/canary.yml): the tools on the real clock, with the time zone
// database of the Node that runs them. The server is offline, so this catches what ages: the
// clock itself, and a tz database too old to know this year's daylight-saving changes.
import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.mjs";

const client = new Client({ name: "canary", version: "0" });
const [a, b] = InMemoryTransport.createLinkedPair();
await Promise.all([buildServer().connect(a), client.connect(b)]);
await client.listTools();

test("live: today, this year's DST change in New York, this year's holidays", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const now = await client.callTool({ name: "world_time", arguments: { places: ["UTC"] } });
  assert.equal(now.structuredContent.results[0].date, today);
  const year = Number(today.slice(0, 4));
  // US daylight time starts on the second Sunday of March at 02:00: 02:30 that day never happens.
  const march = new Date(Date.UTC(year, 2, 1));
  const secondSunday = 1 + ((7 - march.getUTCDay()) % 7) + 7;
  const gap = await client.callTool({ name: "world_time", arguments: { places: ["UTC"], time: `${year}-03-${String(secondSunday).padStart(2, "0")} 02:30`, from: "America/New_York" } });
  assert.equal(gap.structuredContent.status, "skipped");
  const h = await client.callTool({ name: "holidays", arguments: { where: "US", year } });
  assert.ok(h.structuredContent.results.some((x) => x.date === `${year}-07-04`));
  await client.close();
});
