// kit/tool.mjs
//
// How a factory server declares its tools and builds its MCP server. defineTool refuses, at
// startup, any tool that breaks a factory rule (missing annotations or output schema, a long
// description, an unbounded string or array input), so a server that breaks one cannot even
// start. Handlers return plain data; the wrapper turns it into compact JSON text plus structured
// content, and turns thrown errors into short isError results that never carry a stack trace.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { UpstreamError } from "./http.mjs";

export const MAX_DESCRIPTION_CHARS = 400;
const NAME_RE = /^[a-z][a-z0-9_]{1,47}$/;
const ANNOTATION_KEYS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];

/** An error meant for the model: a stable code plus a sentence saying what to do instead. */
export class ToolError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

// Walks a zod schema and reports every string without a max length and every array without a max
// size. Bounded inputs stop a model (or an attacker steering one) from sending megabytes.
export function findUnboundedInputs(schema, path = "") {
  const out = [];
  const def = schema?._zod?.def;
  if (!def) return out;
  const checks = def.checks ?? [];
  const has = (kind) => checks.some((c) => c._zod?.def?.check === kind);
  switch (def.type) {
    case "string":
      if (!has("max_length") && !has("length_equals")) out.push(`${path || "(root)"}: string has no max length`);
      break;
    case "array":
      if (!has("max_length") && !has("length_equals")) out.push(`${path || "(root)"}: array has no max size`);
      out.push(...findUnboundedInputs(def.element, `${path}[]`));
      break;
    case "object":
      for (const [k, v] of Object.entries(def.shape)) out.push(...findUnboundedInputs(v, path ? `${path}.${k}` : k));
      break;
    case "optional":
    case "nullable":
    case "default":
    case "readonly":
      out.push(...findUnboundedInputs(def.innerType, path));
      break;
    case "union":
      for (const option of def.options) out.push(...findUnboundedInputs(option, path));
      break;
    default:
      break;
  }
  return out;
}

/**
 * @param {object} t
 * @param {string} t.name
 * @param {string} t.title
 * @param {string} t.description        at most MAX_DESCRIPTION_CHARS
 * @param {Record<string, z.ZodType>} t.input   zod raw shape
 * @param {Record<string, z.ZodType>} t.output  zod raw shape of the success result
 * @param {{readOnlyHint:boolean,destructiveHint:boolean,idempotentHint:boolean,openWorldHint:boolean}} t.annotations
 * @param {(args: any, ctx: any) => Promise<object>} t.handler
 */
export function defineTool(t) {
  const problems = [];
  if (!NAME_RE.test(t.name ?? "")) problems.push("name must be snake_case, 2-48 chars");
  if (!t.title) problems.push("title is required");
  if (!t.description) problems.push("description is required");
  else if (t.description.length > MAX_DESCRIPTION_CHARS) problems.push(`description is ${t.description.length} chars (max ${MAX_DESCRIPTION_CHARS})`);
  for (const k of ANNOTATION_KEYS) if (typeof t.annotations?.[k] !== "boolean") problems.push(`annotations.${k} must be set`);
  if (!t.output || Object.keys(t.output).length === 0) problems.push("output schema is required");
  if (typeof t.handler !== "function") problems.push("handler is required");
  problems.push(...findUnboundedInputs(z.object(t.input ?? {})).map((p) => `input ${p}`));
  if (problems.length) throw new Error(`Tool ${t.name ?? "(unnamed)"} breaks factory rules: ${problems.join("; ")}`);
  return Object.freeze({ ...t, input: t.input ?? {} });
}

/**
 * Output schemas say what a result is guaranteed to contain, never what it may not contain:
 * clients such as Claude Code and Cursor validate every result against the listed schema, so an
 * "additionalProperties: false" there turns any extra field (a note, a licence, a count of what was
 * left out) into a failed call. Every such closure is removed from output schemas.
 */
export function openObjects(schema) {
  if (Array.isArray(schema)) return schema.map(openObjects);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "additionalProperties" && v === false) continue;
    out[k] = openObjects(v);
  }
  return out;
}

function jsonSchema(shape, io) {
  const schema = z.toJSONSchema(z.object(shape), { target: "draft-7", io, unrepresentable: "any" });
  delete schema.$schema;
  return io === "output" ? openObjects(schema) : schema;
}

/** One tools/list entry: what a client (and usually the model) sees for the tool. */
export function listedTool(t) {
  return { name: t.name, title: t.title, description: t.description, inputSchema: jsonSchema(t.input, "input"), outputSchema: jsonSchema(t.output, "output"), annotations: t.annotations };
}

const errorResult = (code, message, details) => {
  const body = { error: { code, message, ...(details === undefined ? {} : { details }) } };
  return { content: [{ type: "text", text: JSON.stringify(body) }], isError: true };
};

export function wrapHandler(tool, ctx, log = (line) => process.stderr.write(`${line}\n`)) {
  return async (args) => {
    try {
      const data = await tool.handler(args, ctx);
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
    } catch (err) {
      if (err instanceof ToolError) return errorResult(err.code, err.message, err.details);
      if (err instanceof UpstreamError) return errorResult(err.code, `${err.message} No automatic retry beyond the built-in ones was sent.`);
      log(`${tool.name}: unexpected ${err?.name ?? "error"}: ${err?.message ?? String(err)}`);
      return errorResult("internal_error", "The tool failed unexpectedly. The failure was logged on the server; retrying with the same input will likely fail again.");
    }
  };
}

/**
 * @param {object} o
 * @param {string} o.name
 * @param {string} o.version
 * @param {string} [o.instructions]   sent to clients once at initialize
 * @param {ReturnType<typeof defineTool>[]} o.tools
 * @param {object} o.ctx   shared per-process state handed to every handler (fetcher, cache, ...)
 */
export function createServer({ name, version, instructions, tools, ctx }) {
  const names = new Set();
  for (const t of tools) {
    if (names.has(t.name)) throw new Error(`Duplicate tool name ${t.name}`);
    names.add(t.name);
  }
  const server = new McpServer({ name, version }, instructions ? { instructions } : undefined);
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  for (const t of sorted) {
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: t.input, outputSchema: t.output, annotations: t.annotations },
      wrapHandler(t, ctx),
    );
  }
  // The tool list is resent to the model on every turn, so it is built once here, in name order,
  // without the per-schema "$schema" URL and empty fields the SDK adds, and served as the same
  // bytes on every call so providers can cache it. setRequestHandler replaces the SDK's handler
  // (documented behaviour); calls still go through the SDK, which validates inputs and outputs.
  const listed = sorted.map(listedTool);
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: listed }));
  return server;
}
