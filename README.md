# World Time

<!-- badges:start -->
[![CI](https://github.com/arhancanli/world-time-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/arhancanli/world-time-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/world-time-mcp)](https://www.npmjs.com/package/world-time-mcp)
[![downloads](https://img.shields.io/npm/dw/world-time-mcp)](https://www.npmjs.com/package/world-time-mcp)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/arhancanli/world-time-mcp/badge)](https://scorecard.dev/viewer/?uri=github.com/arhancanli/world-time-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
<!-- badges:end -->

Time and calendar answers agents get wrong. Language models do date arithmetic from memory: they
put London one hour off in the weeks when the US has changed its clocks and the UK has not, convert
a time that a daylight-saving change skips, count Christmas as a working day, or put Saudi Arabia's
weekend on Saturday and Sunday. World Time answers from the time zone database built into Node
and holiday rules for 207 countries and their states:

- **Places the way people write them:** "Portland, Maine", "Munich", "Japan", "PST", "UTC+5:30" or
  "America/New_York". Every answer names the zone it used; a country with several offsets says so.
- **Daylight saving handled, not guessed:** a local time that a spring-forward change skips, or a
  fall-back change repeats, is flagged with both readings. "EST" written in July is noted as EDT.
- **Holidays and business days:** public holidays by country, state or city, substitute days,
  multi-day holidays one row per day, each country's own weekend (Friday and Saturday in Saudi
  Arabia), and business-day counts that list what they skipped.
- **Meetings across zones:** windows inside everyone's working hours over up to two weeks, skipping
  each person's weekend and holidays, or the closest time when nothing fits.

Everything runs locally: no network call, no key, answers in milliseconds. Holidays on the Islamic
calendar are astronomical estimates (the official day follows a moon sighting and can move by one)
and are marked `estimated`.

Built and maintained by [Arhan Canli](https://github.com/arhancanli).

## Install

<!-- install:start -->
[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=world-time&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIndvcmxkLXRpbWUtbWNwIl19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=world-time&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22world-time-mcp%22%5D%7D)
[![Install in Goose](https://block.github.io/goose/img/extension-install-dark.svg)](https://block.github.io/goose/extension?cmd=npx&arg=-y&arg=world-time-mcp&id=world-time&name=World%20Time&description=Time%20and%20calendar%20answers%20agents%20get%20wrong%3A%20the%20time%20anywhere%20by%20city%2C%20country%20or%20zone%2C%20DST-safe%20conversions%20that%20flag%20skipped%20and%20repeated%20hours%2C%20public%20holidays%20for%20200%2B%20countries%20and%20their%20regions%2C%20business-day%20arithmetic%20with%20each%20country's%20own%20weekend%2C%20and%20meeting%20slots%20across%20time%20zones.%20Works%20offline%2C%20no%20key.)

Needs Node.js 20 or newer. No account or key.

**Claude Code**

```sh
claude mcp add world-time -- npx -y world-time-mcp
```

**Claude Desktop**: download `world-time-mcp-<version>.mcpb` from the [latest release](https://github.com/arhancanli/world-time-mcp/releases/latest) and open it. The bundle is signed; verify it with `gh attestation verify <file> --repo arhancanli/world-time-mcp`.

**Any other client** (Windsurf, Zed, Cline, Continue and others), in its MCP config file:

```json
{
  "mcpServers": {
    "world-time": {
      "command": "npx",
      "args": [
        "-y",
        "world-time-mcp"
      ]
    }
  }
}
```

**Docker**

```sh
docker build -t world-time-mcp https://github.com/arhancanli/world-time-mcp.git && docker run -i --rm world-time-mcp
```

**Hosted (Streamable HTTP)**: `node src/server.mjs --http` serves stateless MCP at `POST /mcp` (port from `PORT`, default 3000).
<!-- install:end -->

## Example

<!-- example:start -->
An agent calls `world_time` with:

```json
{
  "places": [
    "London",
    "Dubai"
  ],
  "time": "2026-03-08 02:30",
  "from": "New York"
}
```

and gets back (recorded from the live server on 2026-09-26):

```json
{
  "utc": "2026-03-08 07:30",
  "from": {
    "place": "New York, US",
    "zone": "America/New_York",
    "date": "2026-03-08",
    "time": "03:30",
    "weekday": "Sunday",
    "utc_offset": "-04:00",
    "dst": true,
    "abbreviation": "EDT"
  },
  "status": "skipped",
  "note": "02:30 does not exist in New York, US on 2026-03-08: clocks jump forward past it. Converted 03:30, the time a clock shows at that moment.",
  "results": [
    {
      "place": "London, GB",
      "zone": "Europe/London",
      "date": "2026-03-08",
      "time": "07:30",
      "weekday": "Sunday",
      "utc_offset": "+00:00",
      "dst": false,
      "abbreviation": "GMT",
      "next_change": "2026-03-29 01:00 to +01:00"
    },
    {
      "place": "Dubai, AE",
      "zone": "Asia/Dubai",
      "date": "2026-03-08",
      "time": "11:30",
      "weekday": "Sunday",
      "utc_offset": "+04:00",
      "dst": false,
      "abbreviation": "GST"
    }
  ]
}
```
<!-- example:end -->

## Tools

<!-- tools:start -->
| Tool | What it does |
| --- | --- |
| `business_days` | Adds business days to a date (add: 10 or -5) or counts them to an end date, skipping the local weekend (Fri-Sat in Saudi Arabia) and public holidays. |
| `date_info` | Weekday, ISO week, day of year and leap year of a date ('today' = UTC); optionally the date after adding '+1 month' (month ends clamp) and the days until another date. |
| `holidays` | Holidays of a country, state or city for a year, or whether one date is a working day, with the next holidays. 207 countries; Islamic-calendar dates are estimates. |
| `meeting_slots` | Use for any meeting across time zones: windows inside everyone's working hours (09:00-17:00 unless given) over up to 14 days, skipping weekends and holidays, else the closest time. |
| `world_time` | Time now in up to 20 places, or a local time in `from` converted to them ('2026-03-08 02:30', '9am'). Flags times DST skips or repeats; gives each place's offset and next clock change. Places: city, country, zone, PST, UTC+4. |
<!-- tools:end -->

## How it behaves

- Offline and read-only: no network call at all (`factory.allowHosts` is empty), nothing written,
  nothing logged except unexpected failures (to stderr, without your inputs).
- Time zones come from the ICU database inside Node, so they are as current as your Node release.
- Business days: the start date is never counted when adding (1 business day after Friday is
  Monday); when counting between two dates, both ends count if they are working days. A holiday
  that starts in the afternoon (Christmas Eve from 14:00 in Germany) leaves the day a working day
  and is noted.
- Weekends come from the Unicode CLDR week data; pass `weekend` to override one.
- Results are compact JSON with a matching output schema.

## Benchmark

<!-- bench:start -->
Measured 2026-09-26 with gpt-5.4-mini, 13 fixed tasks graded by fixed checks (`bench/tasks.json`, raw results in `bench/results/`).

| Server | Correct | Input tokens | Output tokens | Tool calls | Median time |
| --- | --- | --- | --- | --- | --- |
| This server | 13/13 | 24880 | 573 | 14 | 1.9 s |
| mcp-server-time, the official reference time server | 8/13 | 9843 | 565 | 15 | 1.7 s |
<!-- bench:end -->

## Performance

<!-- perf:start -->
Measured 2026-09-26 from Dubai, home connection against the live upstream, Node 24.19.0 (`bench/perf.json`, `scripts/perf.mjs` in the factory).

| Call | First call | Repeat | Result size |
| --- | --- | --- | --- |
| world_time: now in 5 places (city, ambiguous city, country, abbreviation, offset) | 7 ms | 1.5 ms | 1,123 chars |
| world_time: a time the spring-forward change skips | 5 ms | 0.6 ms | 718 chars |
| holidays: Saudi Arabia 2026 (multi-day Eid, estimated) | 7 ms | 0.3 ms | 918 chars |
| business_days: 5 business days in Saudi Arabia across Eid | 7 ms | 0.2 ms | 450 chars |
| meeting_slots: New York, London, Berlin over Christmas | 27 ms | 8.2 ms | 400 chars |
| date_info: Jan 31 plus one month, days to Christmas | 2 ms | 0.2 ms | 269 chars |

First call: a fresh server process, including the TLS connection and the upstream's own time. Repeat: the same call again, answered from the in-process cache, so it shows this server's own overhead.

Tool definitions the model reads on every turn (name, description, input schema): 2,924 characters, against 1,002 for mcp-server-time, the official reference time server. The full tool list, with the output schemas and annotations clients use to validate results, is 4,632 characters (1,208 for the alternative).
<!-- perf:end -->

## Data sources

- Time zones: the [IANA time zone database](https://www.iana.org/time-zones), as shipped in Node's
  ICU.
- Holidays: [date-holidays](https://github.com/commenthol/date-holidays) (ISC; holiday data
  CC BY 3.0), rules for 207 countries and their states and regions.
- Cities: [city-timezones](https://github.com/kevinroberts/city-timezones) (MIT), about 7,300
  cities with population, province and zone.
- Weekends: [Unicode CLDR](https://cldr.unicode.org/) week data, as shipped in Node.

Confirm holidays that matter legally with the official calendar: governments declare extra days
off, and some holidays move.

## More MCP servers by Arhan Canli

<!-- family:start -->
- [Web Reader](https://github.com/arhancanli/web-reader-mcp): Reads web pages and PDFs as clean Markdown: main content, the sections that answer a query.
- [Actions Check](https://github.com/arhancanli/actions-check-mcp): Checks GitHub Actions workflows: outdated actions, old Node runtimes, retired runners, injection.
- [Citation Check](https://github.com/arhancanli/citation-check-mcp): Verifies citations: finds fabricated or mismatched references and retractions, returns clean BibTeX.
- [Contact Check](https://github.com/arhancanli/contact-check-mcp): Validates and formats phone numbers, email addresses and postal addresses for any country.
- [Cron Check](https://github.com/arhancanli/cron-check-mcp): Explains cron expressions, lists next run times in any time zone, converts between cron dialects.
- [Domain Health](https://github.com/arhancanli/domain-health-mcp): Email and domain checks: SPF lookup limits, DKIM keys, DMARC, DNS records, registration expiry.
- [Drug Label](https://github.com/arhancanli/drug-label-mcp): FDA drug label answers with section citations, RxNorm name resolution, recalls and shortages.
- [End of Life](https://github.com/arhancanli/end-of-life-mcp): Is this version still supported? EOL dates, latest patch and upgrade target for 470+ products.
- [The whole collection](https://github.com/arhancanli/mcp-factory#servers), 7 more
<!-- family:end -->

## License

MIT, Copyright (c) 2026 Arhan Canli.
