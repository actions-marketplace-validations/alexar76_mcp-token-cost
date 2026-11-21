import test from "node:test";
import assert from "node:assert/strict";
import { countTool, countList, definition } from "../src/count.js";

// Reference numbers from HISTOR's Python method (histor/toolcost.py: tiktoken o200k_base, encode_ordinary,
// json.dumps(ensure_ascii=False, separators=(",", ":"))), computed 2026-11-21.
const TOOLS = [
  { name: "read_file", description: "Read a file from the workspace. Use this tool only for files inside the project folder.", inputSchema: { type: "object", properties: { path: { type: "string", description: "Path relative to the project root" } }, required: ["path"] } },
  { name: "emoji_тест", description: "Décrit 🙂 <|endoftext|> text", inputSchema: { type: "object", properties: { q: { type: "string", minimum: 1 } } } },
  { name: "no_schema" },
];
const REF = { read_file: [56, 4, 19, 28], "emoji_тест": [42, 6, 13, 18], no_schema: [15, 4, 1, 5] };

test("per-tool counts match HISTOR's reference to the token", () => {
  for (const t of TOOLS) {
    const r = countTool(t);
    const [total, name, desc, schema] = REF[t.name];
    assert.deepEqual([r.total, r.parts.name, r.parts.description, r.parts.inputSchema], [total, name, desc, schema], t.name);
    assert.equal(r.parts.structure, total - name - desc - schema);
  }
});

test("special-token text counts as text instead of throwing", () => {
  assert.doesNotThrow(() => countTool(TOOLS[1]));
});

test("a list costs the sum of its tools, heaviest first", () => {
  const c = countList(TOOLS);
  assert.equal(c.total, 56 + 42 + 15);
  assert.equal(c.tools, 3);
  assert.deepEqual(c.perTool.map((r) => r.name), ["read_file", "emoji_тест", "no_schema"]);
  assert.equal(c.parts.name + c.parts.description + c.parts.inputSchema + c.parts.structure, c.total);
});

test("a missing schema is sent as {type: object}", () => {
  assert.deepEqual(definition({ name: "x" }).input_schema, { type: "object" });
});

test("a repeated name still costs and is told apart", () => {
  const c = countList([TOOLS[2], TOOLS[2]]);
  assert.equal(c.total, 30);
  assert.deepEqual(c.perTool.map((r) => r.name).sort(), ["no_schema", "no_schema#2"]);
});

test("properties are ranked by weight", () => {
  const r = countTool({ name: "t", inputSchema: { type: "object", properties: { a: { type: "string" }, b: { type: "string", enum: ["x", "y", "z", "w"] } } } });
  assert.equal(r.properties[0].key, "b");
});
