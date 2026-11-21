// Find the MCP servers a person has configured, in the clients that keep a config file.
//
// Every entry becomes {client, file, name, transport: "stdio"|"http", command, args, env, cwd, url, headers}.
// Nothing here starts a process or opens a connection.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = os.homedir();
const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config");

/** Known config locations: [client, file, kind]. kind selects the parser. */
export function knownLocations(cwd = process.cwd()) {
  const claudeDesktop =
    process.platform === "darwin"
      ? path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
      : process.platform === "win32"
        ? path.join(appData, "Claude", "claude_desktop_config.json")
        : path.join(xdg, "Claude", "claude_desktop_config.json");
  return [
    ["Claude Desktop", claudeDesktop, "mcpServers"],
    ["Claude Code (project)", path.join(cwd, ".mcp.json"), "mcpServers"],
    ["Claude Code (user)", path.join(home, ".claude.json"), "claudeCode"],
    ["Cursor (project)", path.join(cwd, ".cursor", "mcp.json"), "mcpServers"],
    ["Cursor (user)", path.join(home, ".cursor", "mcp.json"), "mcpServers"],
    ["VS Code (workspace)", path.join(cwd, ".vscode", "mcp.json"), "vscode"],
    ["Windsurf", path.join(home, ".codeium", "windsurf", "mcp_config.json"), "mcpServers"],
    ["Gemini CLI (project)", path.join(cwd, ".gemini", "settings.json"), "mcpServers"],
    ["Gemini CLI (user)", path.join(home, ".gemini", "settings.json"), "mcpServers"],
    ["Codex", path.join(process.env.CODEX_HOME || path.join(home, ".codex"), "config.toml"), "codexToml"],
  ];
}

function entry(client, file, name, spec) {
  if (!spec || typeof spec !== "object") return null;
  const url = spec.url || spec.serverUrl || spec.httpUrl;
  if (typeof url === "string" && /^https?:\/\//i.test(url)) {
    return { client, file, name, transport: "http", url, headers: spec.headers && typeof spec.headers === "object" ? spec.headers : {} };
  }
  if (typeof spec.command === "string" && spec.command) {
    return {
      client, file, name, transport: "stdio", command: spec.command,
      args: Array.isArray(spec.args) ? spec.args.map(String) : [],
      env: spec.env && typeof spec.env === "object" ? spec.env : {},
      cwd: typeof spec.cwd === "string" ? spec.cwd : undefined,
    };
  }
  return null;
}

function fromMap(client, file, map, skipDisabled = true) {
  if (!map || typeof map !== "object") return [];
  return Object.entries(map)
    .filter(([, spec]) => !(skipDisabled && spec && (spec.disabled === true || spec.enabled === false)))
    .map(([name, spec]) => entry(client, file, name, spec))
    .filter(Boolean);
}

/** A minimal reader for Codex's [mcp_servers.<name>] tables: command, args, env, url. */
export function parseCodexToml(text) {
  const servers = {};
  let current = null;
  let sub = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s+|\s+$/g, "");
    if (!line || line.startsWith("#")) continue;
    const table = line.match(/^\[([^\]]+)\]$/);
    if (table) {
      const parts = table[1].split(".").map((p) => p.trim().replace(/^"|"$/g, ""));
      if (parts[0] === "mcp_servers" && parts[1]) {
        current = servers[parts[1]] ??= {};
        sub = parts[2] === "env" ? "env" : parts[2] === "http_headers" ? "headers" : null;
      } else {
        current = null;
      }
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^("?[\w.-]+"?)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1].replace(/^"|"$/g, "");
    let value;
    try {
      value = JSON.parse(kv[2].replace(/'/g, '"'));
    } catch {
      continue;
    }
    if (sub) (current[sub] ??= {})[key] = value;
    else current[key] = value;
  }
  return servers;
}

/** Servers in one file, parsed as `kind`. Returns [] when the file is absent or unreadable. */
export function readConfig(client, file, kind, cwd = process.cwd()) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  if (kind === "codexToml") return fromMap(client, file, parseCodexToml(text));
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return [{ client, file, error: "not valid JSON" }];
  }
  if (kind === "vscode") return fromMap(client, file, json.servers ?? json.mcp?.servers);
  if (kind === "claudeCode") {
    const out = fromMap(client, file, json.mcpServers);
    const project = json.projects?.[cwd];
    if (project) out.push(...fromMap("Claude Code (local)", file, project.mcpServers));
    return out;
  }
  return fromMap(client, file, json.mcpServers ?? json.servers);
}

/** Every configured server the known clients hold, or those in the files given. */
export function discover({ files = [], cwd = process.cwd() } = {}) {
  const locations = files.length
    ? files.map((f) => [path.basename(f), path.resolve(f), f.endsWith(".toml") ? "codexToml" : "mcpServers"])
    : knownLocations(cwd);
  const found = [];
  const looked = [];
  for (const [client, file, kind] of locations) {
    const servers = readConfig(client, file, kind, cwd);
    looked.push({ client, file, servers: servers.length });
    found.push(...servers);
  }
  return { servers: found, looked };
}

/**
 * The package a stdio entry launches, when it is a public registry package: npm:<name> or pypi:<name>.
 * Used to look a server up in HISTOR without starting it.
 */
export function packageLocator(server) {
  if (server.transport !== "stdio") return null;
  const cmd = path.basename(server.command).replace(/\.(cmd|exe)$/i, "");
  const args = server.args.filter((a) => !/^-/.test(a));
  const strip = (spec) => spec.replace(/@[^@/]+$/, "").replace(/==.*$/, "");
  if (["npx", "bunx", "pnpx"].includes(cmd) && args[0]) return `npm:${strip(args[0])}`;
  if (cmd === "pnpm" && server.args[0] === "dlx" && args[1]) return `npm:${strip(args[1])}`;
  if (cmd === "npm" && server.args[0] === "exec" && args[1]) return `npm:${strip(args[1])}`;
  if (["uvx", "pipx"].includes(cmd)) {
    const a = cmd === "pipx" && server.args[0] === "run" ? args[1] : args[0];
    const from = server.args.indexOf("--from");
    const spec = from >= 0 ? server.args[from + 1] : a;
    return spec ? `pypi:${strip(spec).replace(/\[.*\]$/, "")}` : null;
  }
  return null;
}
