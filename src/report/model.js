// The numbers every report shows, computed once from a run.
import { percentile, summary } from "../distribution.js";
import { moneyRows } from "../prices.js";

export function build(run, opts = {}) {
  const window = opts.window ?? 200000;
  const servers = run.results
    .map((r) => ({
      name: r.server.name,
      client: r.server.client,
      source: r.source,
      error: r.error ?? null,
      tools: r.count?.tools ?? 0,
      total: r.count?.total ?? 0,
      parts: r.count?.parts ?? null,
      instructions: r.instructionsTokens ?? 0,
      claude: r.claude ?? null,
      percentile: r.count ? percentile(r.count.total) : null,
      histor: r.histor ?? null,
    }))
    .sort((a, b) => b.total - a.total);
  const ok = servers.filter((s) => !s.error);
  const total = ok.reduce((s, x) => s + x.total, 0);
  const instructions = ok.reduce((s, x) => s + x.instructions, 0);
  const claudeTotal = ok.length && ok.every((s) => s.claude) ? ok.reduce((s, x) => s + x.claude.tokens, 0) : null;
  const allTools = run.results
    .filter((r) => !r.error && r.count)
    .flatMap((r) => r.count.perTool.map((t) => ({ ...t, server: r.server.name })))
    .sort((a, b) => b.total - a.total);
  const order = { high: 0, medium: 1, low: 2, info: 3 };
  const findings = [...(run.findings ?? [])].sort((a, b) => order[a.severity] - order[b.severity] || (b.tokens ?? 0) - (a.tokens ?? 0));
  const savings = findings.reduce((s, f) => s + (f.tokens ?? 0), 0);
  return {
    generatedAt: new Date().toISOString(),
    tokenizer: "o200k_base",
    window,
    servers,
    totals: {
      servers: servers.length,
      failed: servers.length - ok.length,
      tools: ok.reduce((s, x) => s + x.tools, 0),
      tokens: total,
      instructions,
      sent: total + instructions,
      claude: claudeTotal,
      windowShare: (total + instructions) / window,
    },
    money: moneyRows(total + instructions, { price: opts.price, model: opts.model }),
    heaviestTools: allTools.slice(0, opts.top ?? 10),
    findings,
    savings,
    population: summary(),
  };
}

export const fmt = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
export const usd = (n) => (n == null ? "–" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
export const pct = (p) => (p == null ? "–" : `p${p}`);
