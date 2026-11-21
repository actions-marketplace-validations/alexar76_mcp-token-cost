import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { listStdio, listHttp } from "../src/mcp.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/server.mjs", import.meta.url));
const stdio = (mode) => ({ transport: "stdio", command: process.execPath, args: [FIXTURE], env: { FIXTURE_MODE: mode } });

test("stdio: every page of tools/list, instructions, server info", async () => {
  const r = await listStdio(stdio("stable"), { reads: 2 });
  assert.deepEqual(r.tools.map((t) => t.name), ["read_file", "write_file", "list_dir"]);
  assert.equal(r.reads.length, 2);
  assert.equal(r.instructions, "Fixture server for tests.");
  assert.equal(r.serverInfo.name, "fixture");
});

test("stdio: a server that logs to stdout first still works", async () => {
  const r = await listStdio(stdio("logs"));
  assert.equal(r.tools.length, 3);
});

test("stdio: a command that does not exist is an error, not a hang", async () => {
  await assert.rejects(listStdio({ transport: "stdio", command: "/nonexistent/cmd-xyz", args: [] }, { timeoutMs: 5000 }));
});

const TOOLS = [{ name: "search", description: "Search.", inputSchema: { type: "object" } }];

function server(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}

async function body(req) {
  let b = "";
  for await (const c of req) b += c;
  return b ? JSON.parse(b) : null;
}

test("streamable HTTP: JSON answers and a session id", async () => {
  let session;
  const s = await server(async (req, res) => {
    const msg = await body(req);
    if (req.method === "DELETE") return res.end();
    if (!msg.id && msg.id !== 0) return res.writeHead(202).end();
    if (msg.method === "initialize") res.setHeader("mcp-session-id", "abc");
    else session = req.headers["mcp-session-id"];
    const result = msg.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "h" } } : { tools: TOOLS };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
  });
  const r = await listHttp({ transport: "http", url: `http://127.0.0.1:${s.address().port}/mcp` });
  s.close();
  assert.equal(r.tools[0].name, "search");
  assert.equal(session, "abc");
});

test("streamable HTTP: an SSE answer", async () => {
  const s = await server(async (req, res) => {
    const msg = await body(req);
    if (req.method === "DELETE" || msg.id === undefined) return res.writeHead(202).end();
    const result = msg.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: {} } : { tools: TOOLS };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: {} })}\n\n`);
    res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n\n`);
  });
  const r = await listHttp({ transport: "http", url: `http://127.0.0.1:${s.address().port}/mcp` });
  s.close();
  assert.equal(r.tools.length, 1);
});

test("older HTTP+SSE transport after a 405 on POST", async () => {
  let stream;
  const s = await server(async (req, res) => {
    if (req.method === "GET" && req.url === "/sse") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`event: endpoint\ndata: /messages?s=1\n\n`);
      stream = res;
      return;
    }
    if (req.method === "POST" && req.url === "/sse") return res.writeHead(405).end();
    const msg = await body(req);
    res.writeHead(202).end();
    if (msg.id === undefined) return;
    const result = msg.method === "initialize" ? { protocolVersion: "2024-11-05", capabilities: {} } : { tools: TOOLS };
    stream.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n\n`);
  });
  const r = await listHttp({ transport: "http", url: `http://127.0.0.1:${s.address().port}/sse` }, { timeoutMs: 5000 });
  stream?.end();
  s.closeAllConnections?.();
  s.close();
  assert.equal(r.tools[0].name, "search");
});
