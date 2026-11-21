import { fmt, usd, pct } from "./model.js";

const cell = (s) => String(s).replace(/\|/g, "\\|");

export function render(m, { title = "MCP tool token cost" } = {}) {
  const t = m.totals;
  const L = [`## ${title}`, ""];
  L.push(`**${fmt(t.sent)} tokens** of tool definitions on every request, ${(t.windowShare * 100).toFixed(1)} % of a ${fmt(m.window)}-token window (${m.tokenizer}${t.claude != null ? `; Claude: ${fmt(t.claude)}` : ""}).`);
  if (m.population) L.push("", `A typical MCP server costs ${fmt(m.population.median)} tokens (median of ${fmt(m.population.owners)} packages and remote hosts in HISTOR, one list each, ${String(m.population.createdAt).slice(0, 10)}).`);
  L.push("", "| Server | Tools | Tokens | Descriptions | Input schemas | Rank among MCP servers |", "|---|---:|---:|---:|---:|---:|");
  for (const s of m.servers) {
    L.push(s.error ? `| ${cell(s.name)} | – | could not read: ${cell(s.error)} | | | |` : `| ${cell(s.name)} | ${s.tools} | ${fmt(s.total)} | ${fmt(s.parts?.description)} | ${fmt(s.parts?.inputSchema)} | ${pct(s.percentile)} |`);
  }
  if (m.heaviestTools.length) {
    L.push("", "<details><summary>Heaviest tools</summary>", "", "| Tokens | Tool | Description | Schema |", "|---:|---|---:|---:|");
    for (const x of m.heaviestTools) L.push(`| ${fmt(x.total)} | ${cell(x.server)} › \`${cell(x.name)}\` | ${fmt(x.parts?.description)} | ${fmt(x.parts?.inputSchema)} |`);
    L.push("", "</details>");
  }
  if (m.money.length) {
    L.push("", "| Per 1,000 requests | Uncached | Cache kept warm | Cache rewritten every time |", "|---|---:|---:|---:|");
    for (const r of m.money) L.push(`| ${r.model} | ${usd(r.uncached)} | ${usd(r.cachedWarm)} | ${usd(r.cacheRewritten)} |`);
  }
  if (m.findings.length) {
    L.push("", `### Findings (${m.findings.length})`, "");
    for (const f of m.findings) L.push(`- **${f.severity}** \`${f.code}\` ${cell(f.server)}${f.tool ? ` › \`${cell(f.tool)}\`` : ""}: ${f.message}`);
  }
  return L.join("\n") + "\n";
}
