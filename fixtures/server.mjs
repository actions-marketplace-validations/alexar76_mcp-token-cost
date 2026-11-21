#!/usr/bin/env node
// A stdio MCP server for tests. FIXTURE_MODE: "stable" (default), "shuffle" (order changes per read),
// "dated" (a description carries today's date), "logs" (prints a line to stdout before speaking).
const mode = process.env.FIXTURE_MODE || "stable";
const base = [
  { name: "read_file", description: "Read a file from the workspace. Use this tool only for files inside the project folder.", inputSchema: { type: "object", properties: { path: { type: "string", description: "Path relative to the project root" } }, required: ["path"] } },
  { name: "write_file", description: "Write a file in the workspace. Use this tool only for files inside the project folder.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "list_dir", description: "List a directory. Use this tool only for files inside the project folder.", inputSchema: { type: "object", properties: { path: { type: "string" }, sort: { type: "string", enum: Array.from({ length: 50 }, (_, i) => `key_${i}`) } } } },
];
let reads = 0;
if (mode === "logs") process.stdout.write("starting fixture server\n");
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n");
    if (msg.method === "initialize") reply({ protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" }, instructions: "Fixture server for tests." });
    else if (msg.method === "tools/list") {
      if (!msg.params?.cursor) reads++;
      let tools = base.map((t) => ({ ...t }));
      if (mode === "shuffle" && reads % 2 === 0) tools.reverse();
      if (mode === "dated") tools[0].description += ` Index refreshed 2026-11-21T10:${String(reads).padStart(2, "0")}:00Z.`;
      // two pages, to exercise nextCursor
      if (!msg.params?.cursor) reply({ tools: tools.slice(0, 2), nextCursor: "p2" });
      else reply({ tools: tools.slice(2) });
    } else if (msg.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no" } }) + "\n");
  }
});
