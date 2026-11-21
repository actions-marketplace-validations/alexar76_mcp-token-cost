// A small MCP client that only lists tools: initialize, notifications/initialized, tools/list (every page).
// stdio (newline-delimited JSON-RPC), streamable HTTP (JSON or SSE answers) and the older HTTP+SSE transport.
// It never calls a tool.
import { spawn } from "node:child_process";

const CLIENT = { name: "mcp-token-cost", version: "0.1.0" };
const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

function initParams(version) {
  return { protocolVersion: version, capabilities: {}, clientInfo: CLIENT };
}

async function listAll(request) {
  const tools = [];
  let cursor;
  for (let page = 0; page < 100; page++) {
    const result = await request("tools/list", cursor ? { cursor } : {});
    tools.push(...(Array.isArray(result?.tools) ? result.tools : []));
    cursor = result?.nextCursor;
    if (!cursor) break;
  }
  return tools;
}

/** Start a stdio server, list its tools, stop it. */
export function listStdio(server, { timeoutMs = 30000, reads = 1 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(server.command, server.args ?? [], {
      cwd: server.cwd,
      env: { ...process.env, ...(server.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
      // Windows resolves npx/uvx (.cmd shims) only through the shell; a full path to an executable runs directly.
      shell: process.platform === "win32" && !/[\\/]/.test(server.command),
    });
    let buffer = "";
    let stderr = "";
    let nextId = 1;
    const pending = new Map();
    let done = false;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const { reject: r } of pending.values()) r(new Error("closed"));
      try {
        child.stdin.end();
        child.kill();
      } catch {}
      err ? reject(err) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(`no answer within ${timeoutMs / 1000}s${stderr ? `: ${tail(stderr)}` : ""}`)), timeoutMs);
    child.on("error", (e) => finish(new Error(`could not start ${server.command}: ${e.message}`)));
    child.on("exit", (code) => finish(new Error(`exited with code ${code}${stderr ? `: ${tail(stderr)}` : ""}`)));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    child.stdout.on("data", (d) => {
      buffer += d;
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!line.startsWith("{")) continue; // a server that logs to stdout
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.method && msg.id !== undefined) {
          // the server asks us something (roots, sampling): decline
          send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "not supported by mcp-token-cost" } });
          continue;
        }
        const p = pending.get(String(msg.id));
        if (!p) continue;
        pending.delete(String(msg.id));
        msg.error ? p.reject(new Error(`${msg.error.code}: ${msg.error.message}`)) : p.resolve(msg.result);
      }
    });
    const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
    const request = (method, params) =>
      new Promise((res, rej) => {
        const id = nextId++;
        pending.set(String(id), { resolve: res, reject: rej });
        send({ jsonrpc: "2.0", id, method, params });
      });
    (async () => {
      const init = await request("initialize", initParams(VERSIONS[0]));
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      const runs = [];
      for (let k = 0; k < reads; k++) runs.push(await listAll(request));
      finish(null, { serverInfo: init?.serverInfo ?? null, instructions: init?.instructions ?? null, protocolVersion: init?.protocolVersion, tools: runs[0], reads: runs });
    })().catch((e) => finish(e));
  });
}

function tail(text) {
  return text.trim().split("\n").slice(-2).join(" ").slice(0, 300);
}

/** Read a fetch Response that may be JSON or an SSE stream; return the JSON-RPC message with this id. */
async function readAnswer(res, id) {
  const type = res.headers.get("content-type") || "";
  if (type.includes("text/event-stream")) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const event = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = event.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        if (!data) continue;
        try {
          const msg = JSON.parse(data);
          if (String(msg.id) === String(id)) {
            reader.cancel().catch(() => {});
            return msg;
          }
        } catch {}
      }
    }
    throw new Error("the stream ended without an answer");
  }
  const text = await res.text();
  const msg = JSON.parse(text);
  return Array.isArray(msg) ? msg.find((m) => String(m.id) === String(id)) : msg;
}

/** List the tools of a streamable HTTP server (falls back to the HTTP+SSE transport). */
export async function listHttp(server, { timeoutMs = 30000, reads = 1 } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", ...(server.headers ?? {}) };
  let session;
  let protocol;
  let nextId = 1;
  const post = async (method, params, notify = false) => {
    const id = notify ? undefined : nextId++;
    const res = await fetch(server.url, {
      method: "POST",
      headers: { ...headers, ...(session ? { "mcp-session-id": session } : {}), ...(protocol ? { "mcp-protocol-version": protocol } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", ...(notify ? {} : { id }), method, ...(params ? { params } : {}) }),
      signal,
    });
    session = res.headers.get("mcp-session-id") || session;
    if (notify) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    const msg = await readAnswer(res, id);
    if (!msg) throw new Error("no JSON-RPC answer");
    if (msg.error) throw new Error(`${msg.error.code}: ${msg.error.message}`);
    return msg.result;
  };
  let init;
  try {
    init = await post("initialize", initParams(VERSIONS[0]));
  } catch (e) {
    if ([404, 405].includes(e.status)) return listLegacySse(server, { timeoutMs, reads });
    throw e;
  }
  protocol = init?.protocolVersion;
  await post("notifications/initialized", undefined, true);
  const runs = [];
  for (let k = 0; k < reads; k++) runs.push(await listAll((m, p) => post(m, p)));
  if (session) fetch(server.url, { method: "DELETE", headers: { ...headers, "mcp-session-id": session }, signal: AbortSignal.timeout(3000) }).catch(() => {});
  return { serverInfo: init?.serverInfo ?? null, instructions: init?.instructions ?? null, protocolVersion: protocol, tools: runs[0], reads: runs };
}

/** The 2024-11-05 HTTP+SSE transport: GET opens the stream, which names the POST endpoint. */
async function listLegacySse(server, { timeoutMs, reads }) {
  const signal = AbortSignal.timeout(timeoutMs);
  const res = await fetch(server.url, { headers: { accept: "text/event-stream", ...(server.headers ?? {}) }, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let endpoint;
  const waiting = new Map();
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = (block.match(/^event:\s*(.*)$/m) || [])[1];
        const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
        if (ev === "endpoint") endpoint = new URL(data, server.url).toString();
        else if (data) {
          try {
            const msg = JSON.parse(data);
            const w = waiting.get(String(msg.id));
            if (w) {
              waiting.delete(String(msg.id));
              msg.error ? w.reject(new Error(`${msg.error.code}: ${msg.error.message}`)) : w.resolve(msg.result);
            }
          } catch {}
        }
      }
    }
  })();
  for (let t = 0; !endpoint && t < timeoutMs / 50; t++) await new Promise((r) => setTimeout(r, 50));
  if (!endpoint) throw new Error("the SSE stream named no endpoint");
  let nextId = 1;
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      waiting.set(String(id), { resolve, reject });
      fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", ...(server.headers ?? {}) }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), signal }).catch(reject);
    });
  const init = await request("initialize", initParams("2024-11-05"));
  await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", ...(server.headers ?? {}) }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), signal });
  const runs = [];
  for (let k = 0; k < reads; k++) runs.push(await listAll(request));
  reader.cancel().catch(() => {});
  pump.catch(() => {});
  return { serverInfo: init?.serverInfo ?? null, instructions: init?.instructions ?? null, protocolVersion: init?.protocolVersion, tools: runs[0], reads: runs };
}

export function listTools(server, opts) {
  return server.transport === "http" ? listHttp(server, opts) : listStdio(server, opts);
}
