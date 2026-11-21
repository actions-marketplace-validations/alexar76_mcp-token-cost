// Where a tool list sits among the MCP tool lists HISTOR observes (data/distribution.json).
//
// The population is one tool list per owner: each npm or PyPI package, and each remote host (its heaviest list).
// A publisher that serves near-identical lists on thousands of endpoints weighs as one, not thousands.
import fs from "node:fs";

let cached;
export function distribution() {
  if (cached !== undefined) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(new URL("../data/distribution.json", import.meta.url), "utf8"));
  } catch {
    cached = null;
  }
  return cached;
}

/** The share (0-100) of observed owners (packages and remote hosts) whose tool list costs less, or null. */
export function percentile(tokens) {
  const curve = distribution()?.allTotalPercentiles;
  if (!Array.isArray(curve) || !curve.length) return null;
  let p = 0;
  while (p < curve.length && curve[p] < tokens) p++;
  return Math.max(0, Math.min(100, p - 1));
}

export function summary() {
  const d = distribution();
  if (!d) return null;
  const t = d.all?.total ?? {};
  return {
    median: t.p50,
    p90: t.p90,
    p99: t.p99,
    owners: d.counts?.owners ?? t.n,
    servers: d.counts?.servers ?? t.n,
    dataset: d.source?.dataset,
    createdAt: d.source?.createdAt,
  };
}
