// Baselines for CI: what each server's list cost when you last accepted it, and a check against it.
export const FORMAT = "mcp-token-cost/v1";

export function snapshot(results) {
  const servers = {};
  for (const r of results) {
    if (r.error || !r.count) continue;
    servers[r.server.name] = {
      total: r.count.total,
      parts: r.count.parts,
      instructions: r.instructionsTokens ?? 0,
      tools: Object.fromEntries(r.count.perTool.map((t) => [t.name, t.total])),
    };
  }
  return { format: FORMAT, tokenizer: "o200k_base", createdAt: new Date().toISOString(), servers };
}

function parsePercent(v, dflt) {
  if (v == null) return dflt;
  const n = Number(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : dflt;
}

/**
 * Compare a run with a baseline. Each measure is checked on its own (total, descriptions, input schemas), so a
 * schema that doubles fails even when shorter descriptions hide it in the total. Growth under `noise` tokens never
 * fails. `budget` caps the sum of all servers.
 */
export function check(baseline, current, { maxIncrease = "10%", noise = 50, budget } = {}) {
  const limit = parsePercent(maxIncrease, 10);
  const rows = [];
  const failures = [];
  const names = new Set([...Object.keys(baseline.servers ?? {}), ...Object.keys(current.servers ?? {})]);
  for (const name of [...names].sort()) {
    const a = baseline.servers?.[name];
    const b = current.servers?.[name];
    if (!b) {
      rows.push({ server: name, status: "missing", before: a?.total ?? null, after: null });
      failures.push(`${name}: in the baseline but not read now`);
      continue;
    }
    if (!a) {
      rows.push({ server: name, status: "new", before: null, after: b.total });
      continue;
    }
    const measures = [
      ["total", a.total, b.total],
      ["descriptions", a.parts?.description, b.parts?.description],
      ["input schemas", a.parts?.inputSchema, b.parts?.inputSchema],
    ];
    let status = "ok";
    for (const [label, x, y] of measures) {
      if (x == null || y == null) continue;
      const grow = y - x;
      const rel = x > 0 ? (grow / x) * 100 : grow > 0 ? Infinity : 0;
      if (grow > noise && rel > limit) {
        status = "failed";
        failures.push(`${name}: ${label} ${x} → ${y} tokens (+${grow}, +${rel === Infinity ? "∞" : rel.toFixed(1)} % > ${limit} %)`);
      }
    }
    const added = Object.keys(b.tools).filter((t) => !(t in a.tools));
    const removed = Object.keys(a.tools).filter((t) => !(t in b.tools));
    const moved = Object.keys(b.tools)
      .filter((t) => t in a.tools && b.tools[t] !== a.tools[t])
      .map((t) => ({ tool: t, before: a.tools[t], after: b.tools[t], delta: b.tools[t] - a.tools[t] }))
      .sort((p, q) => Math.abs(q.delta) - Math.abs(p.delta));
    rows.push({ server: name, status, before: a.total, after: b.total, delta: b.total - a.total, added, removed, moved: moved.slice(0, 10) });
  }
  const totalAfter = Object.values(current.servers ?? {}).reduce((s, x) => s + x.total + (x.instructions ?? 0), 0);
  if (budget != null && totalAfter > Number(budget)) failures.push(`all servers: ${totalAfter} tokens > budget ${budget}`);
  return { ok: failures.length === 0, failures, rows, totalAfter, limitPercent: limit, noise };
}

export function renderCheck(res, { markdown = false } = {}) {
  const L = [];
  if (markdown) {
    L.push(`## MCP tool token check: ${res.ok ? "passed" : "failed"}`, "", "| Server | Before | After | Change | Status |", "|---|---:|---:|---:|---|");
    for (const r of res.rows) L.push(`| ${r.server} | ${r.before ?? "–"} | ${r.after ?? "–"} | ${r.delta == null ? "–" : (r.delta > 0 ? "+" : "") + r.delta} | ${r.status} |`);
    if (res.failures.length) L.push("", ...res.failures.map((f) => `- ${f}`));
    for (const r of res.rows) if (r.added?.length || r.removed?.length || r.moved?.length) {
      L.push("", `<details><summary>${r.server}</summary>`, "");
      if (r.added.length) L.push(`Added: ${r.added.map((t) => `\`${t}\``).join(", ")}`);
      if (r.removed.length) L.push(`Removed: ${r.removed.map((t) => `\`${t}\``).join(", ")}`);
      for (const mv of r.moved) L.push(`- \`${mv.tool}\` ${mv.before} → ${mv.after} (${mv.delta > 0 ? "+" : ""}${mv.delta})`);
      L.push("", "</details>");
    }
  } else {
    L.push(res.ok ? "MCP tool token check passed" : "MCP tool token check FAILED");
    for (const r of res.rows) L.push(`  ${r.server.padEnd(28)} ${String(r.before ?? "–").padStart(8)} → ${String(r.after ?? "–").padStart(8)}  ${r.status}`);
    for (const f of res.failures) L.push(`  ✗ ${f}`);
    L.push(`  limit +${res.limitPercent} % per measure, growth under ${res.noise} tokens ignored`);
  }
  return L.join("\n") + "\n";
}
