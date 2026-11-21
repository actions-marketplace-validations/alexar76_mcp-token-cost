import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readConfig, parseCodexToml, packageLocator, discover } from "../src/config.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mct-"));
const write = (name, body) => {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, typeof body === "string" ? body : JSON.stringify(body));
  return f;
};

test("Claude Desktop / Cursor style mcpServers, disabled entries skipped", () => {
  const f = write("a.json", { mcpServers: { pw: { command: "npx", args: ["-y", "@playwright/mcp@latest"] }, off: { command: "x", disabled: true }, remote: { url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer t" } } } });
  const s = readConfig("Test", f, "mcpServers");
  assert.deepEqual(s.map((x) => [x.name, x.transport]), [["pw", "stdio"], ["remote", "http"]]);
  assert.equal(s[1].headers.Authorization, "Bearer t");
});

test("VS Code uses servers", () => {
  const f = write("b.json", { servers: { gh: { type: "http", url: "https://api.example.com/mcp" } } });
  assert.equal(readConfig("VS Code", f, "vscode")[0].url, "https://api.example.com/mcp");
});

test("Claude Code user file: top level and this project's servers", () => {
  const f = write("c.json", { mcpServers: { a: { command: "a" } }, projects: { "/work/p": { mcpServers: { b: { command: "b" } } } } });
  assert.deepEqual(readConfig("Claude Code (user)", f, "claudeCode", "/work/p").map((x) => x.name), ["a", "b"]);
});

test("Codex TOML tables", () => {
  const t = parseCodexToml(`model = "x"\n[mcp_servers.docs]\ncommand = "npx"\nargs = ["-y", "@upstash/context7-mcp"]\n[mcp_servers.docs.env]\nKEY = "v"\n[other]\ncommand = "no"\n`);
  assert.deepEqual(t, { docs: { command: "npx", args: ["-y", "@upstash/context7-mcp"], env: { KEY: "v" } } });
});

test("bad JSON is reported, not thrown", () => {
  const f = write("d.json", "{ nope");
  assert.equal(readConfig("X", f, "mcpServers")[0].error, "not valid JSON");
});

test("package locators for HISTOR", () => {
  const L = (command, args) => packageLocator({ transport: "stdio", command, args });
  assert.equal(L("npx", ["-y", "@playwright/mcp@latest"]), "npm:@playwright/mcp");
  assert.equal(L("npx", ["-y", "server-x@1.2.3", "--port", "1"]), "npm:server-x");
  assert.equal(L("uvx", ["mcp-server-fetch"]), "pypi:mcp-server-fetch");
  assert.equal(L("uvx", ["--from", "pkg[extra]==1.0", "cmd"]), "pypi:pkg");
  assert.equal(L("pnpm", ["dlx", "@a/b"]), "npm:@a/b");
  assert.equal(L("node", ["dist/index.js"]), null);
});

test("discover with explicit files", () => {
  const f = write("e.json", { mcpServers: { a: { command: "a" } } });
  const d = discover({ files: [f] });
  assert.equal(d.servers.length, 1);
});
