import { fmt, usd, pct } from "./model.js";

const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c(1, s);
const dim = (s) => c(2, s);
const red = (s) => c(31, s);
const yellow = (s) => c(33, s);
const cyan = (s) => c(36, s);
const pad = (s, w, right) => (right ? String(s).padStart(w) : String(s).padEnd(w));
const bar = (share, width = 24) => "█".repeat(Math.round(Math.min(1, share) * width)).padEnd(width, "·");
const SEV = { high: () => red("HIGH"), medium: () => yellow("MED "), low: () => cyan("LOW "), info: () => dim("INFO") };

export function render(m) {
  const out = [];
  const t = m.totals;
  const claude = t.claude != null ? `; Claude counts ${fmt(t.claude)} with its tool-use prompt` : "";
  out.push(bold(`MCP tool definitions: ${fmt(t.sent)} tokens on every request`) + dim(`  (${m.tokenizer}${claude})`));
  out.push(
    `${bar(t.windowShare)} ${(t.windowShare * 100).toFixed(1)} % of a ${fmt(m.window)}-token window · ` +
      `${t.servers} server${t.servers === 1 ? "" : "s"}, ${t.tools} tools` +
      (t.instructions ? `, ${fmt(t.instructions)} tokens of server instructions` : ""),
  );
  if (m.population) {
    out.push(dim(`A typical MCP server costs ${fmt(m.population.median)} tokens (median of ${fmt(m.population.owners)} packages and remote hosts in HISTOR, one list each, ${String(m.population.createdAt).slice(0, 10)}); 90th percentile ${fmt(m.population.p90)}.`));
  }
  out.push("");
  const nameW = Math.max(6, ...m.servers.map((s) => s.name.length)) + 1;
  out.push(bold(pad("Server", nameW) + pad("Tools", 7, true) + pad("Tokens", 9, true) + pad("Desc.", 8, true) + pad("Schemas", 9, true) + pad("Rank", 7, true) + "  Source"));
  for (const s of m.servers) {
    if (s.error) {
      out.push(pad(s.name, nameW) + red(`  could not read: ${s.error}`));
      continue;
    }
    out.push(pad(s.name, nameW) + pad(s.tools, 7, true) + pad(fmt(s.total), 9, true) + pad(fmt(s.parts?.description), 8, true) + pad(fmt(s.parts?.inputSchema), 9, true) + pad(pct(s.percentile), 7, true) + "  " + dim(s.source));
  }
  out.push(dim(`Rank: the share of observed MCP packages and remote hosts whose list costs less (p90 = heavier than 90 % of them).`));
  out.push("");
  if (m.heaviestTools.length) {
    out.push(bold("Heaviest tools"));
    for (const tl of m.heaviestTools) {
      const prop = tl.properties?.[0] ? dim(` · heaviest property ${tl.properties[0].key} ${fmt(tl.properties[0].tokens)}`) : "";
      out.push(`  ${pad(fmt(tl.total), 7, true)}  ${tl.server} › ${tl.name}` + dim(`  (description ${fmt(tl.parts?.description)}, schema ${fmt(tl.parts?.inputSchema)})`) + prop);
    }
    out.push("");
  }
  if (m.money.length) {
    out.push(bold("Per 1,000 requests that send this list") + dim("  (list prices; clients that load tools on demand send less)"));
    for (const r of m.money) {
      out.push(`  ${pad(r.model, 20)} ${pad(usd(r.uncached), 9, true)} uncached · ${pad(usd(r.cachedWarm), 8, true)} cache kept warm · ${pad(usd(r.cacheRewritten), 8, true)} cache rewritten every time`);
    }
    out.push("");
  }
  if (m.findings.length) {
    out.push(bold(`Findings (${m.findings.length})`) + (m.savings ? dim(`  the sized ones add up to ~${fmt(m.savings)} tokens per request`) : ""));
    for (const f of m.findings.slice(0, 30)) {
      out.push(`  ${SEV[f.severity]()} ${f.code}  ${f.server}${f.tool ? ` › ${f.tool}` : ""}`);
      out.push(`       ${f.message}`);
    }
    if (m.findings.length > 30) out.push(dim(`  … ${m.findings.length - 30} more with --format json`));
  } else {
    out.push(dim("No findings."));
  }
  return out.join("\n") + "\n";
}
