// One self-contained HTML page: no scripts, no external files, light and dark.
import { fmt, usd, pct } from "./model.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const CSS = `
:root{--bg:#fafaf8;--fg:#1d1d1b;--muted:#6b6b66;--line:#e4e3de;--card:#fff;--desc:#4f7cac;--schema:#c97b3d;--name:#7a9a5b;--struct:#b3b1a8;--high:#b42318;--medium:#b54708;--low:#175cd3;--info:#6b6b66}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--muted:#9c9a92;--line:#2c2b29;--card:#1e1e1c;--desc:#7aa5d6;--schema:#e0a06a;--name:#9cc07b;--struct:#5c5a55;--high:#f97066;--medium:#fdb022;--low:#84adff;--info:#9c9a92}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1040px;margin:0 auto;padding:32px 16px 64px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 10px}
.muted{color:var(--muted)}.big{font-size:44px;font-weight:700;letter-spacing:-.02em;line-height:1.1}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:20px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}.card b{display:block;font-size:22px}
.meter{height:10px;background:var(--line);border-radius:5px;overflow:hidden;margin:8px 0}.meter span{display:block;height:100%;background:var(--fg)}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.wrap{overflow-x:auto}
.stack{display:flex;height:12px;border-radius:3px;overflow:hidden;min-width:120px;background:var(--line)}.stack i{display:block}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 12px;vertical-align:middle}
.sev{font-size:11px;font-weight:700;text-transform:uppercase;padding:2px 6px;border-radius:4px;border:1px solid currentColor}
.high{color:var(--high)}.medium{color:var(--medium)}.low{color:var(--low)}.info{color:var(--info)}
td .muted{font-size:13px;white-space:nowrap}li{margin:6px 0}code{font-size:13px}footer{margin-top:40px;font-size:13px;color:var(--muted)}`;

function stack(parts, total) {
  if (!parts || !total) return "";
  const seg = (v, col) => (v ? `<i style="width:${((v / total) * 100).toFixed(2)}%;background:var(${col})"></i>` : "");
  return `<div class="stack" title="names ${parts.name} · descriptions ${parts.description} · schemas ${parts.inputSchema} · structure ${parts.structure}">${seg(parts.name, "--name")}${seg(parts.description, "--desc")}${seg(parts.inputSchema, "--schema")}${seg(parts.structure, "--struct")}</div>`;
}

export function render(m) {
  const t = m.totals;
  const rows = m.servers
    .map((s) =>
      s.error
        ? `<tr><td>${esc(s.name)}<div class="muted">${esc(s.client ?? "")}</div></td><td colspan="5" class="high">could not read: ${esc(s.error)}</td></tr>`
        : `<tr><td>${esc(s.name)}<div class="muted">${esc(s.source)}</div></td><td class="n">${s.tools}</td><td class="n"><b>${fmt(s.total)}</b></td><td>${stack(s.parts, s.total)}</td><td class="n">${pct(s.percentile)}</td><td class="n">${s.claude ? fmt(s.claude.tokens) : "–"}</td></tr>`,
    )
    .join("");
  const tools = m.heaviestTools
    .map((x) => `<tr><td class="n">${fmt(x.total)}</td><td>${esc(x.server)} › <code>${esc(x.name)}</code>${x.properties?.[0] ? `<div class="muted">heaviest property <code>${esc(x.properties[0].key)}</code> ${fmt(x.properties[0].tokens)}</div>` : ""}</td><td>${stack(x.parts, x.total)}</td></tr>`)
    .join("");
  const money = m.money.map((r) => `<tr><td>${esc(r.model)}</td><td class="n">${usd(r.uncached)}</td><td class="n">${usd(r.cachedWarm)}</td><td class="n">${usd(r.cacheRewritten)}</td></tr>`).join("");
  const findings = m.findings.map((f) => `<li><span class="sev ${f.severity}">${f.severity}</span> <code>${esc(f.code)}</code> ${esc(f.server)}${f.tool ? ` › <code>${esc(f.tool)}</code>` : ""}<div>${esc(f.message)}</div></li>`).join("");
  const pop = m.population;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MCP token cost</title><style>${CSS}</style></head><body><main>
<h1>MCP tool token cost</h1><div class="muted">${esc(m.generatedAt)} · tokenizer ${esc(m.tokenizer)}</div>
<div class="cards">
<div class="card"><span class="muted">Full tool list</span><b>${fmt(t.sent)}</b><span class="muted">tokens</span></div>
<div class="card"><span class="muted">Share of a ${fmt(m.window)} window</span><b>${(t.windowShare * 100).toFixed(1)} %</b><div class="meter"><span style="width:${Math.min(100, t.windowShare * 100).toFixed(1)}%"></span></div></div>
<div class="card"><span class="muted">Servers · tools</span><b>${t.servers} · ${t.tools}</b>${t.failed ? `<span class="high">${t.failed} could not be read</span>` : ""}</div>
${t.claude != null ? `<div class="card"><span class="muted">Claude's count, with its tool-use prompt</span><b>${fmt(t.claude)}</b></div>` : ""}
${pop ? `<div class="card"><span class="muted">Typical MCP server</span><b>${fmt(pop.median)}</b><span class="muted">median of ${fmt(pop.owners)} in HISTOR</span></div>` : ""}
</div>
<h2>Servers</h2><div class="legend muted">Split:<i style="background:var(--name)"></i>names<i style="background:var(--desc)"></i>descriptions<i style="background:var(--schema)"></i>input schemas<i style="background:var(--struct)"></i>structure</div>
<div class="wrap"><table><thead><tr><th>Server</th><th>Tools</th><th>Tokens</th><th>Split</th><th>Rank</th><th>Claude</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="muted">Rank: the share of MCP packages and remote hosts HISTOR observes (one list each) whose list costs less.</p>
${tools ? `<h2>Heaviest tools</h2><div class="wrap"><table><thead><tr><th>Tokens</th><th>Tool</th><th>Split</th></tr></thead><tbody>${tools}</tbody></table></div>` : ""}
${money ? `<h2>Per 1,000 requests that send this list</h2><div class="wrap"><table><thead><tr><th>Model</th><th>Uncached</th><th>Cache kept warm</th><th>Cache rewritten every time</th></tr></thead><tbody>${money}</tbody></table></div><p class="muted">List prices. Clients may expose a different set of tools on each request.</p>` : ""}
<h2>Findings (${m.findings.length})</h2>${findings ? `<ul>${findings}</ul>` : `<p class="muted">None.</p>`}
<footer>mcp-token-cost · counted as each tool's {name, description, input_schema} in compact JSON${pop ? ` · population: <a href="${esc(pop.dataset)}">HISTOR snapshot ${esc(String(pop.createdAt).slice(0, 10))}</a> (CC BY 4.0)` : ""}</footer>
</main></body></html>
`;
}
