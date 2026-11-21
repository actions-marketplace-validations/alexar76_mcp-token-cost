import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "../src/snapshot.js";

const BIN = fileURLToPath(new URL("../bin/mcp-token-cost.js", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../fixtures/server.mjs", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mct-cli-"));
const run = (args, env = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1", GITHUB_STEP_SUMMARY: "", ...env } });
const stdioArg = `"${process.execPath}" "${FIXTURE}"`;

test("scan a saved tools/list as JSON", () => {
  const f = path.join(tmp, "tools.json");
  fs.writeFileSync(f, JSON.stringify({ tools: [{ name: "a", description: "Alpha." }, { name: "b" }] }));
  const r = run(["scan", "--tools", f, "--format", "json"]);
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  assert.equal(m.totals.tools, 2);
  assert.equal(m.totals.tokens, m.servers[0].total);
});

test("scan a stdio server, text report", () => {
  const r = run(["--stdio", stdioArg, "--name", "fx"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /MCP tool definitions: [\d,]+ tokens/);
  assert.match(r.stdout, /fx/);
  assert.match(r.stdout, /REPEATED_TEXT/);
});

test("html and sarif reports", () => {
  const h = path.join(tmp, "r.html");
  assert.equal(run(["--stdio", stdioArg, "--format", "html", "--out", h]).status, 0);
  const page = fs.readFileSync(h, "utf8");
  assert.match(page, /<title>MCP token cost<\/title>/);
  assert.doesNotMatch(page, /<script/);
  const s = run(["--stdio", stdioArg, "--format", "sarif"]);
  const sarif = JSON.parse(s.stdout);
  assert.equal(sarif.version, "2.1.0");
  assert.ok(sarif.runs[0].results.length > 0);
});

test("--fail-on exits 1 when a finding reaches the level", () => {
  assert.equal(run(["--stdio", stdioArg, "--fail-on", "low"]).status, 1);
  assert.equal(run(["--stdio", stdioArg, "--fail-on", "high"]).status, 0);
  assert.equal(run(["--stdio", stdioArg, "--fail-on", "high"], { FIXTURE_MODE: "shuffle" }).status, 1);
});

test("snapshot then check: pass, then fail after the list grows", () => {
  const base = path.join(tmp, "base.json");
  assert.equal(run(["snapshot", "--stdio", stdioArg, "--name", "fx", "-o", base]).status, 0);
  assert.equal(run(["check", "--baseline", base, "--stdio", stdioArg, "--name", "fx"]).status, 0);
  const snap = JSON.parse(fs.readFileSync(base, "utf8"));
  snap.servers.fx.total = Math.round(snap.servers.fx.total / 2);
  fs.writeFileSync(base, JSON.stringify(snap));
  const r = run(["check", "--baseline", base, "--stdio", stdioArg, "--name", "fx"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAILED/);
});

test("check: each measure on its own, noise floor, budget", () => {
  const a = { servers: { s: { total: 1000, parts: { description: 400, inputSchema: 500 }, tools: {} } } };
  const grow = (d, i) => ({ servers: { s: { total: 1000 + d + i, parts: { description: 400 + d, inputSchema: 500 + i }, tools: {} } } });
  assert.equal(check(a, grow(-200, 200)).ok, false); // schemas +40 %, total unchanged
  assert.equal(check(a, grow(0, 40)).ok, true); // under the 50-token floor
  assert.equal(check(a, grow(0, 0), { budget: 900 }).ok, false);
});

test("help and version", () => {
  assert.match(execFileSync(process.execPath, [BIN, "--help"], { encoding: "utf8" }), /Usage/);
  assert.match(execFileSync(process.execPath, [BIN, "--version"], { encoding: "utf8" }), /^\d+\.\d+\.\d+/);
});
