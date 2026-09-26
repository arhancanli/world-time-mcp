// A real MCP client on the server at a fixed moment (NOW), as the golden tests use it.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, createContext } from "../src/server.mjs";
import { NOW } from "./scenarios.mjs";

export async function connect(now = NOW) {
  const server = buildServer(createContext({ now: () => now }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "golden", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  // Like a real client: once the tools are listed, every result is validated against its schema.
  await client.listTools();
  return client;
}

export async function call(client, name, args) {
  const res = await client.callTool({ name, arguments: args });
  return { res, data: res.structuredContent ?? JSON.parse(res.content[0].text) };
}
