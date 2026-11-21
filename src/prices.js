// What a tool list costs in money per 1,000 requests, uncached and with a prompt cache.
import fs from "node:fs";

export function prices() {
  return JSON.parse(fs.readFileSync(new URL("../data/prices.json", import.meta.url), "utf8"));
}

/** Rows for each model (or one custom price): uncached, cached under 5 minutes apart, cache rewritten every request. */
export function moneyRows(tokens, { price, model, requests = 1000 } = {}) {
  const table = prices();
  const models = price != null
    ? [{ label: `custom $${price}/M`, input: Number(price), cacheWrite: Number(price) * 1.25, cacheRead: null }]
    : Object.entries(table.models).filter(([id]) => !model || id === model).map(([, m]) => m);
  return models.map((m) => {
    const perM = tokens / 1e6;
    return {
      model: m.label,
      uncached: perM * m.input * requests,
      cachedWarm: m.cacheRead == null ? null : perM * (m.cacheWrite + m.cacheRead * (requests - 1)),
      cacheRewritten: perM * m.cacheWrite * requests,
    };
  });
}
