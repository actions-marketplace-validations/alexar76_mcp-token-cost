// Look a server up in HISTOR (https://histor.modelmarket.dev, public, no key): its recorded tool list cost and the
// cost of its recent changes, without starting it. Counted the same way as mcp-token-cost counts (o200k_base).
const BASE = process.env.MCP_TOKEN_COST_HISTOR || "https://histor.modelmarket.dev";
const UA = { "user-agent": "mcp-token-cost/0.1.0 (+https://github.com/alexar76/mcp-token-cost)" };

async function get(path) {
  const res = await fetch(BASE + path, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HISTOR answered ${res.status}`);
  return res.json();
}

/** HISTOR's record for an endpoint (URL) or package locator (npm:x / pypi:x), or null. */
export async function lookup(locator) {
  const q = locator.replace(/^(npm|pypi):/, "").replace(/^https?:\/\//, "");
  const hits = await get(`/api/v1/servers?q=${encodeURIComponent(q)}&limit=25`);
  const list = hits?.servers ?? [];
  const norm = (s) => s.replace(/\/+$/, "").toLowerCase();
  const target = list.find((s) => norm(s.endpoint || "") === norm(locator));
  if (!target) return null;
  const cost = await get(`/api/v1/servers/${target.id}/cost?limit=10`);
  if (!cost?.current) return { server: target, current: null, changes: [] };
  return {
    server: { id: target.id, name: target.name, endpoint: target.endpoint, page: `${BASE}/servers/${target.id}`, lastObserved: cost.server?.lastObserved },
    toolSetDigest: cost.toolSetDigest ?? null,
    current: cost.current,
    changes: cost.changes ?? [],
  };
}

/** The tool definitions of a stored set (content-addressed, immutable), or null. */
export async function toolset(digest) {
  if (!digest) return null;
  const tools = await get(`/api/v1/toolsets/${encodeURIComponent(digest)}`);
  return Array.isArray(tools) ? tools : null;
}

/** HISTOR's per-tool cost, shaped like a local count so reports treat both alike. */
export function asCount(current) {
  const t = current.totals ?? {};
  return {
    tokenizer: current.tokenizer, tools: current.toolCount, total: t.sent,
    parts: { name: t.names, description: t.descriptions, inputSchema: t.inputSchemas, structure: t.structure },
    outputSchemas: t.outputSchemas ?? 0,
    perTool: (current.tools ?? []).map((r) => ({ name: r.name, total: r.sent, parts: r.parts,
      properties: Object.entries(r.properties ?? {}).map(([key, tokens]) => ({ key, tokens })).sort((a, b) => b.tokens - a.tokens) }))
      .sort((a, b) => b.total - a.total),
  };
}
