import test from "node:test";
import assert from "node:assert/strict";
import { prices, moneyRows } from "../src/prices.js";
import { distribution, percentile, summary } from "../src/distribution.js";

// moneyRows: the dollars a tool list adds to 1,000 requests, from data/prices.json (list prices per million
// input tokens, as of its asOf date; cache write = 1.25 x input for the 5-minute cache).

const close = (a, b) => Math.abs(a - b) < 1e-9;

test("the price table names the three current models with a 1.25x five-minute cache write", () => {
  const { models } = prices();
  assert.deepEqual(Object.keys(models).sort(), ["claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5"]);
  for (const m of Object.values(models)) {
    assert.ok(close(m.cacheWrite, m.input * 1.25), m.label);
    assert.ok(m.cacheRead === null || m.cacheRead < m.input, m.label);
  }
});

test("10,000 tokens over 1,000 requests on Opus 5.5: uncached, warm cache and a cache rewritten each time", () => {
  const [row] = moneyRows(10_000, { model: "claude-opus-5-5" });
  // 0.01 M tokens x $4 x 1000 requests = $40; warm: one write ($5) + 999 reads ($0.20) of 0.01 M; rewritten: $5 x 1000.
  assert.equal(row.model, "Claude Opus 5.5");
  assert.ok(close(row.uncached, 40));
  assert.ok(close(row.cachedWarm, 0.01 * (5 + 0.2 * 999)));
  assert.ok(close(row.cacheRewritten, 50));
  assert.ok(row.cachedWarm < row.uncached && row.uncached < row.cacheRewritten);
});

test("a model without a stated cache read price has no warm-cache figure, never a guessed one", () => {
  const [row] = moneyRows(10_000, { model: "claude-haiku-5-5" });
  assert.equal(row.cachedWarm, null);
  assert.ok(close(row.uncached, 0.01 * 0.1 * 1000));
});

test("a custom price replaces the table and has no cache read price", () => {
  const rows = moneyRows(2_000_000, { price: "3", requests: 10 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].model, "custom $3/M");
  assert.ok(close(rows[0].uncached, 2 * 3 * 10));
  assert.ok(close(rows[0].cacheRewritten, 2 * 3.75 * 10));
  assert.equal(rows[0].cachedWarm, null);
});

test("no model filter gives every model; an unknown model gives none", () => {
  assert.equal(moneyRows(1000).length, 3);
  assert.deepEqual(moneyRows(1000, { model: "gpt-unknown" }), []);
  assert.ok(moneyRows(0).every((r) => r.uncached === 0 && r.cacheRewritten === 0));
});

// percentile/summary: where a tool list sits among HISTOR's observed owners (data/distribution.json).

test("the shipped distribution is a 101-point non-decreasing curve that agrees with its own summary", () => {
  const curve = distribution().allTotalPercentiles;
  assert.equal(curve.length, 101);
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i] >= curve[i - 1], `p${i}`);
  const s = summary();
  assert.equal(s.median, curve[50]);
  assert.equal(s.p99, curve[99]);
  assert.ok(s.owners > 0 && s.servers >= s.owners);
});

test("percentile is the share of owners whose list costs less, clamped to 0..100", () => {
  const curve = distribution().allTotalPercentiles;
  assert.equal(percentile(0), 0);
  assert.equal(percentile(curve[0]), 0);
  assert.equal(percentile(curve[100] + 1), 100);
  // Just above the median: about half the owners cost less.
  assert.equal(percentile(curve[50] + 1), 50);
  let last = -1;
  for (const t of [10, 100, 500, 1000, 5000, 20000, 100000, 1000000]) {
    const p = percentile(t);
    assert.ok(p >= last && p >= 0 && p <= 100, String(t));
    last = p;
  }
});
