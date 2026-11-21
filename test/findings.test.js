import test from "node:test";
import assert from "node:assert/strict";
import { serverFindings, setupFindings } from "../src/findings.js";
import { countList } from "../src/count.js";

const S = { name: "s" };
const codes = (f) => f.map((x) => x.code);

test("order change between reads is a cache finding, sized as a cache write", () => {
  const a = [{ name: "a" }, { name: "b" }];
  const f = serverFindings(S, a, countList(a), { reads: [a, [...a].reverse()] });
  assert.ok(codes(f).includes("LIST_ORDER_UNSTABLE"));
  const x = f.find((y) => y.code === "LIST_ORDER_UNSTABLE");
  assert.equal(x.tokens, undefined);
  assert.equal(x.cacheTokens, countList(a).total);
});

test("content change between reads", () => {
  const a = [{ name: "a", description: "one" }];
  const b = [{ name: "a", description: "two" }];
  assert.ok(codes(serverFindings(S, a, countList(a), { reads: [a, b] })).includes("LIST_CONTENT_UNSTABLE"));
});

test("dates and UUIDs in definitions", () => {
  const t = [{ name: "a", description: "Data as of 2026-11-21." }, { name: "b", description: "id 123e4567-e89b-42d3-a456-426614174000" }];
  assert.equal(codes(serverFindings(S, t, countList(t))).filter((c) => c === "VOLATILE_TEXT").length, 2);
});

test("a version number is not a date", () => {
  const t = [{ name: "a", description: "Works with API v2.1.0 and 3.10." }];
  assert.ok(!codes(serverFindings(S, t, countList(t))).includes("VOLATILE_TEXT"));
});

test("large enum and repeated text are sized", () => {
  const enumTool = { name: "e", inputSchema: { type: "object", properties: { k: { type: "string", enum: Array.from({ length: 60 }, (_, i) => `v${i}`) } } } };
  const s = "Only use this tool when the user explicitly asks for it in the conversation.";
  const t = [enumTool, { name: "a", description: s }, { name: "b", description: s }, { name: "c", description: s }];
  const f = serverFindings(S, t, countList(t));
  assert.ok(f.find((x) => x.code === "LARGE_ENUM").tokens > 50);
  assert.ok(f.find((x) => x.code === "REPEATED_TEXT").tokens > 20);
});

test("deep schemas count properties and items, not every JSON object", () => {
  const leaf = { type: "string" };
  let deep = leaf;
  for (let i = 0; i < 6; i++) deep = { type: "object", properties: { x: deep } };
  const shallow = { type: "object", properties: { a: { type: "object", properties: { b: { anyOf: [{ type: "string" }, { type: "number" }] } } } } };
  assert.ok(codes(serverFindings(S, [{ name: "d", inputSchema: deep }], countList([{ name: "d", inputSchema: deep }]))).includes("DEEP_SCHEMA"));
  assert.ok(!codes(serverFindings(S, [{ name: "s", inputSchema: shallow }], countList([{ name: "s", inputSchema: shallow }]))).includes("DEEP_SCHEMA"));
});

test("setup: duplicate names across servers and context share", () => {
  const big = { name: "big", description: "x ".repeat(30000) };
  const r = [
    { server: { name: "one" }, tools: [{ name: "search" }, big], count: countList([{ name: "search" }, big]) },
    { server: { name: "two" }, tools: [{ name: "search" }], count: countList([{ name: "search" }]) },
  ];
  const f = setupFindings(r, { window: 200000 });
  assert.ok(codes(f).includes("DUPLICATE_TOOL_NAME"));
  assert.ok(codes(f).includes("CONTEXT_SHARE"));
});
