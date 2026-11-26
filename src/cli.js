// mcp-token-cost: what your MCP servers cost in tokens before you type a word.
import fs from "node:fs";
import path from "node:path";
import { discover, packageLocator } from "./config.js";
import { listTools } from "./mcp.js";
import { countList, countText } from "./count.js";
import { serverFindings, setupFindings } from "./findings.js";
import { lookup, asCount, toolset } from "./histor.js";
import { claudeCount, DEFAULT_MODEL } from "./claude.js";
import { build, fmt } from "./report/model.js";
import * as text from "./report/text.js";
import * as markdown from "./report/markdown.js";
import * as html from "./report/html.js";
import * as sarif from "./report/sarif.js";
import { snapshot, check, renderCheck, FORMAT } from "./snapshot.js";

export const VERSION = "0.1.0";

const HELP = `mcp-token-cost ${VERSION}: what your MCP servers cost in tokens before you type a word

Usage
  mcp-token-cost [scan] [options]        every server in your MCP client configs (Claude Desktop, Claude Code,
                                         Cursor, VS Code, Windsurf, Gemini CLI, Codex)
  mcp-token-cost scan --stdio "npx -y @playwright/mcp"     one server you start
  mcp-token-cost scan --url https://example.com/mcp        one remote server
  mcp-token-cost scan --tools tools.json                   a saved tools/list answer
  mcp-token-cost lookup npm:@playwright/mcp                HISTOR's record: cost now and per release, nothing started
  mcp-token-cost snapshot [source] -o mcp-tokens.json      save a baseline
  mcp-token-cost check --baseline mcp-tokens.json [source] fail CI when a list grows past the limit
  mcp-token-cost diff before.json after.json

Source options
  --config FILE        read this config (repeatable) instead of the known client locations
  --only a,b           only these servers;  --skip a,b  all but these
  --offline            start nothing: take each server's list from HISTOR's public record (npx/uvx packages, URLs)
  --no-histor          do not fall back to HISTOR when a server cannot be started
  --header "K: V"      header for --url (repeatable)
  --timeout SECONDS    per server (default 45)
  --reads N            tools/list reads per server, to catch lists that change between reads (default 2)

Report options
  --format text|json|markdown|html|sarif   (default text; html writes a file)
  --out FILE           write the report here
  --top N              heaviest tools to show (default 10)
  --window N           context window to compare with (default 200000)
  --price USD          your input price per million tokens instead of the built-in list
  --model ID           only this model's row in the money table
  --claude             also count with Claude's tokenizer (Anthropic token counting API; sends the definitions
                       to Anthropic; needs a key or an ant login). --claude-model ID (default ${DEFAULT_MODEL})
  --fail-on high|medium|low   exit 1 when a finding at or above this severity is found

Check options
  --baseline FILE  --max-increase 10%  --noise 50  --budget TOKENS  --update (rewrite the baseline)

Counting: each tool as {name, description, input_schema} in compact JSON, tokenizer o200k_base. That is exact for
the GPT-4o family and an estimate elsewhere (for Claude roughly 15-20 % low: use --claude).`;

function parseArgs(argv) {
  const args = { _: [], config: [], header: [] };
  const multi = new Set(["config", "header"]);
  const flags = new Set(["offline", "no-histor", "claude", "update", "help", "version", "json"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] === "-o" ? "--out" : argv[i] === "-h" ? "--help" : argv[i];
    if (!a.startsWith("--")) {
      args._.push(a);
      continue;
    }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    if (flags.has(k)) {
      args[k] = true;
      continue;
    }
    const v = inline ?? argv[++i];
    if (v === undefined) throw new Error(`--${k} needs a value`);
    if (multi.has(k)) args[k].push(v);
    else args[k] = v;
  }
  return args;
}

/** Split a command line the way a shell would for simple quoting. */
export function splitCommand(line) {
  const out = [];
  let cur = "";
  let q = null;
  let has = false;
  for (const ch of line) {
    if (q) {
      if (ch === q) q = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
    } else cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}

function sources(args) {
  if (args.stdio) {
    const [command, ...rest] = splitCommand(args.stdio);
    return { servers: [{ client: "command line", name: args.name || path.basename(rest.find((r) => !r.startsWith("-")) || command), transport: "stdio", command, args: rest, env: {} }], looked: [] };
  }
  if (args.url) {
    const headers = Object.fromEntries(args.header.map((h) => h.split(/:\s*(.*)/s)).map(([k, v]) => [k, v ?? ""]));
    return { servers: [{ client: "command line", name: args.name || new URL(args.url).host, transport: "http", url: args.url, headers }], looked: [] };
  }
  if (args.tools) {
    const raw = JSON.parse(fs.readFileSync(args.tools, "utf8"));
    const tools = Array.isArray(raw) ? raw : raw.tools ?? raw.result?.tools ?? [];
    return { servers: [{ client: "file", name: args.name || path.basename(args.tools, ".json"), transport: "file", tools }], looked: [] };
  }
  const found = discover({ files: args.config });
  let servers = found.servers;
  const only = args.only ? new Set(args.only.split(",").map((s) => s.trim())) : null;
  const skip = args.skip ? new Set(args.skip.split(",").map((s) => s.trim())) : null;
  servers = servers.filter((s) => (!only || only.has(s.name)) && (!skip || !skip.has(s.name)));
  // The same server configured in two clients is counted once.
  const seen = new Set();
  servers = servers.filter((s) => {
    const key = s.error ? `${s.file}` : s.transport === "http" ? `url:${s.url}` : `cmd:${s.command} ${s.args.join(" ")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { servers, looked: found.looked };
}

async function readServer(server, args, log) {
  const timeoutMs = Number(args.timeout ?? 45) * 1000;
  const reads = Math.max(1, Number(args.reads ?? 2));
  if (server.error) return { server: { ...server, name: server.name ?? path.basename(server.file) }, error: server.error };
  if (server.transport === "file") {
    return { server, source: "file", tools: server.tools, reads: [server.tools], count: countList(server.tools), instructionsTokens: 0 };
  }
  const locator = server.transport === "http" ? server.url : packageLocator(server);
  const fromHistor = async (why) => {
    if (!locator) throw new Error(why || "not a public package or URL, so HISTOR cannot have it");
    const rec = await lookup(locator);
    if (!rec?.current) throw new Error(`${why ? why + "; " : ""}HISTOR has no tool list for ${locator}`);
    const source = `HISTOR ${String(rec.server.lastObserved ?? "").slice(0, 10)}${why ? " (live read failed)" : ""}`;
    const tools = await toolset(rec.toolSetDigest).catch(() => null);
    if (tools) return { server, source, histor: { ...rec.server, recordedTokens: rec.current.totals?.sent }, tools, reads: [tools], count: countList(tools), instructionsTokens: 0, liveError: why ?? null };
    return { server, source, histor: rec.server, tools: null, reads: [], count: asCount(rec.current), instructionsTokens: 0, liveError: why ?? null };
  };
  if (args.offline) return fromHistor();
  try {
    log(`reading ${server.name} …`);
    const res = await listTools(server, { timeoutMs, reads });
    return { server, source: server.transport === "http" ? "live (HTTP)" : "live (stdio)", tools: res.tools, reads: res.reads, count: countList(res.tools), instructionsTokens: countText(res.instructions || ""), serverInfo: res.serverInfo };
  } catch (e) {
    if (args["no-histor"] || !locator) return { server, error: e.message };
    try {
      return await fromHistor(e.message);
    } catch (e2) {
      return { server, error: e2.message };
    }
  }
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

async function run(args, log) {
  const { servers, looked } = sources(args);
  if (!servers.length) {
    const where = looked.map((l) => `  ${l.client}: ${l.file}`).join("\n");
    throw new Error(`no MCP servers found. Looked in:\n${where}\nPass --config FILE, --stdio "command", --url URL or --tools FILE.`);
  }
  const results = await pool(servers, 4, (s) => readServer(s, args, log));
  if (args.claude) {
    const said = new Set();
    for (const r of results) {
      if (r.error || !r.tools) continue;
      try {
        r.claude = await claudeCount(r.tools, { model: args["claude-model"] });
      } catch (e) {
        if (!said.has(e.message)) process.stderr.write(`mcp-token-cost: no Claude count: ${e.message}\n`);
        said.add(e.message);
      }
    }
  }
  const findings = [];
  for (const r of results) if (!r.error && r.tools) findings.push(...serverFindings(r.server, r.tools, r.count, { reads: r.reads }));
  findings.push(...setupFindings(results.filter((r) => !r.error), { window: Number(args.window ?? 200000) }));
  return { results, findings };
}

function emit(out, file) {
  if (file) {
    fs.writeFileSync(file, out);
    process.stderr.write(`wrote ${file}\n`);
  } else process.stdout.write(out);
}

function summaryFile(md) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) {
    try {
      fs.appendFileSync(f, md + "\n");
    } catch {}
  }
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (args.version) return void console.log(VERSION);
  const cmd = ["scan", "lookup", "snapshot", "check", "diff", "help"].includes(args._[0]) ? args._.shift() : "scan";
  if (args.help || cmd === "help") return void console.log(HELP);
  const quiet = args.format && args.format !== "text";
  const log = (m) => (!quiet && process.stderr.isTTY ? process.stderr.write(`\r\x1b[2K${m}`) : null);

  if (cmd === "lookup") {
    const locator = args._[0];
    if (!locator) throw new Error("lookup needs npm:<package>, pypi:<package> or a URL");
    const rec = await lookup(locator);
    if (!rec) throw new Error(`HISTOR has no server ${locator}`);
    if (args.format === "json") return emit(JSON.stringify(rec, null, 2) + "\n", args.out);
    const c = rec.current ? asCount(rec.current) : null;
    const L = [`${rec.server.endpoint}  (${rec.server.page})`];
    L.push(c ? `${fmt(c.total)} tokens, ${c.tools} tools: names ${fmt(c.parts.name)}, descriptions ${fmt(c.parts.description)}, input schemas ${fmt(c.parts.inputSchema)} · observed ${String(rec.server.lastObserved).slice(0, 10)}` : "no tool list recorded");
    if (rec.changes.length) {
      L.push("", "Recent changes (before → after, full-list tokens):");
      for (const ch of rec.changes) {
        const t = ch.totals?.sent ?? {};
        const v = ch.toPackageVersion ? ` (${ch.fromPackageVersion ?? "?"} → ${ch.toPackageVersion})` : "";
        const tools = ch.toolCount && ch.toolCount.delta ? `, tools ${ch.toolCount.before} → ${ch.toolCount.after}` : "";
        L.push(`  ${String(ch.observedAt ?? "").slice(0, 10)}  ${fmt(t.before)} → ${fmt(t.after)} (${t.delta > 0 ? "+" : ""}${fmt(t.delta)})${tools}${v}`);
      }
    }
    if (c) L.push("", "Heaviest tools:", ...c.perTool.slice(0, Number(args.top ?? 10)).map((t) => `  ${fmt(t.total).padStart(7)}  ${t.name}`));
    return emit(L.join("\n") + "\n", args.out);
  }

  if (cmd === "diff") {
    const [a, b] = args._.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
    if (!a || !b) throw new Error("diff needs two snapshot files");
    const res = check(a, b, { maxIncrease: args["max-increase"], noise: Number(args.noise ?? 50) });
    return emit(renderCheck(res, { markdown: args.format === "markdown" }), args.out);
  }

  const result = await run(args, log);
  log("");

  if (cmd === "snapshot") {
    const snap = snapshot(result.results);
    const out = args.out || "mcp-tokens.json";
    fs.writeFileSync(out, JSON.stringify(snap, null, 2) + "\n");
    const failed = result.results.filter((r) => r.error);
    process.stderr.write(`wrote ${out}: ${Object.keys(snap.servers).length} servers${failed.length ? `; could not read ${failed.map((r) => r.server.name).join(", ")}` : ""}\n`);
    return failed.length ? 2 : 0;
  }

  if (cmd === "check") {
    if (!args.baseline) throw new Error("check needs --baseline FILE (make one with: mcp-token-cost snapshot -o FILE)");
    const base = JSON.parse(fs.readFileSync(args.baseline, "utf8"));
    if (base.format !== FORMAT) throw new Error(`${args.baseline} is not a ${FORMAT} snapshot`);
    const snap = snapshot(result.results);
    const res = check(base, snap, { maxIncrease: args["max-increase"], noise: Number(args.noise ?? 50), budget: args.budget });
    summaryFile(renderCheck(res, { markdown: true }));
    emit(renderCheck(res, { markdown: args.format === "markdown" }), args.out);
    if (args.update && res.ok !== null) fs.writeFileSync(args.baseline, JSON.stringify(snap, null, 2) + "\n");
    return res.ok ? 0 : 1;
  }

  const model = build(result, { top: Number(args.top ?? 10), window: Number(args.window ?? 200000), price: args.price, model: args.model });
  const format = args.format || "text";
  let out;
  if (format === "json") out = JSON.stringify(model, null, 2) + "\n";
  else if (format === "markdown") out = markdown.render(model);
  else if (format === "sarif") out = sarif.render(model);
  else if (format === "html") out = html.render(model);
  else out = text.render(model);
  emit(out, args.out || (format === "html" ? "mcp-token-cost.html" : undefined));
  summaryFile(markdown.render(model));
  const rank = { info: 3, low: 2, medium: 1, high: 0 };
  if (args["fail-on"] && model.findings.some((f) => rank[f.severity] <= rank[args["fail-on"]])) return 1;
  return 0;
}
