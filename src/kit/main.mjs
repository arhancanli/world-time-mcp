// kit/main.mjs
//
// Entry points shared by every factory server: stdio for local installs (npx, Claude Desktop,
// Cursor, VS Code) and a stateless Streamable HTTP endpoint for hosting. Stateless means each POST
// builds a fresh server and transport, so any instance can answer any request and nothing
// leaks between callers.
import http from "node:http";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export const MAX_HTTP_BODY_BYTES = 1024 * 1024;

/** True when the importing module is the process entry point (works through npm bin symlinks). */
export function isMain(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return importMetaUrl === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

export async function runStdio(buildServer, label) {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  const stop = () => server.close().finally(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.stderr.write(`${label}: ready on stdio\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > MAX_HTTP_BODY_BYTES) {
        reject(Object.assign(new Error("too large"), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const sendJson = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

/** Returns the listening node http.Server. POST /mcp is MCP; GET /healthz is a liveness check. */
export function runHttp(buildServer, { port = Number(process.env.PORT ?? 3000), host = "0.0.0.0", label = "mcp" } = {}) {
  const httpServer = http.createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/healthz") return sendJson(res, 200, { ok: true });
    if (path !== "/mcp") return sendJson(res, 404, { error: "not found" });
    if (req.method !== "POST") return sendJson(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: this endpoint is stateless, use POST." }, id: null });
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      return sendJson(res, err.status ?? 400, { jsonrpc: "2.0", error: { code: -32700, message: err.status === 413 ? "Request body too large." : "Parse error." }, id: null });
    }
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      process.stderr.write(`${label}: http request failed: ${err?.message}\n`);
      if (!res.headersSent) sendJson(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal error." }, id: null });
    }
  });
  httpServer.listen(port, host, () => process.stderr.write(`${label}: listening on http://${host}:${httpServer.address().port}/mcp\n`));
  return httpServer;
}

/** `node server.mjs` -> stdio; `node server.mjs --http` or MCP_TRANSPORT=http -> HTTP. */
export function start(buildServer, label) {
  const wantsHttp = process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http";
  if (wantsHttp) return runHttp(buildServer, { label });
  return runStdio(buildServer, label).catch((err) => {
    process.stderr.write(`${label}: fatal: ${err?.message}\n`);
    process.exit(1);
  });
}
