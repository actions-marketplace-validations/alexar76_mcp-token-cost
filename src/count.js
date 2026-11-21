// Token counts of an MCP tool list, as a client sends it to a model.
//
// The method is HISTOR's (histor/toolcost.py), so a local count, a HISTOR record and the population curve agree to
// the token: each tool is sent as {"name", "description", "input_schema"} in compact JSON (a missing schema counts
// as {"type":"object"}); a list costs the sum of its tools; a part (name, description, input schema) is counted as
// the JSON value it is written as, and "structure" is the keys and punctuation left over.
// The tokenizer is o200k_base (offline; exact for the GPT-4o family, an estimate for other models: for Claude it
// undercounts by roughly 15-20 %, so use --claude for Claude's own count). Special-token text counts as text.
import { encode } from "gpt-tokenizer/encoding/o200k_base";

export const TOKENIZER = "o200k_base";

const ORDINARY = { allowedSpecial: new Set(), disallowedSpecial: new Set() };
const n = (text) => (text ? encode(text, ORDINARY).length : 0);
const json = (value) => JSON.stringify(value);

/** The definition a client sends for one tool. */
export function definition(tool) {
  return { name: tool.name ?? null, description: tool.description || "", input_schema: tool.inputSchema || { type: "object" } };
}

/** One tool: its total and where the tokens are. */
export function countTool(tool) {
  const def = definition(tool);
  const total = n(json(def));
  const name = n(json(def.name));
  const description = n(json(def.description));
  const inputSchema = n(json(def.input_schema));
  const out = { name: String(def.name), total, parts: { name, description, inputSchema, structure: total - name - description - inputSchema } };
  out.outputSchema = tool.outputSchema && typeof tool.outputSchema === "object" ? n(json(tool.outputSchema)) : 0;
  const props = def.input_schema && typeof def.input_schema === "object" ? def.input_schema.properties : null;
  if (props && typeof props === "object" && !Array.isArray(props)) {
    // Each top-level property as written in the schema, "key":{...}: which field is heavy.
    out.properties = Object.entries(props)
      .map(([key, value]) => ({ key, tokens: n(json(String(key)) + ":" + json(value)) }))
      .sort((a, b) => b.tokens - a.tokens);
  }
  return out;
}

/** A whole list: the sum of its tools, split by part, plus the list as served (`listed`). */
export function countList(tools) {
  const list = (Array.isArray(tools) ? tools : []).filter((t) => t && typeof t === "object");
  const seen = new Map();
  const rows = list.map((t) => {
    const row = countTool(t);
    const k = (seen.get(row.name) ?? 0) + 1;
    seen.set(row.name, k);
    if (k > 1) row.name = `${row.name}#${k}`; // a repeated name still costs
    return row;
  });
  rows.sort((a, b) => b.total - a.total || (a.name < b.name ? -1 : 1));
  const parts = { name: 0, description: 0, inputSchema: 0, structure: 0 };
  for (const r of rows) for (const k of Object.keys(parts)) parts[k] += r.parts[k];
  return {
    tokenizer: TOKENIZER,
    tools: rows.length,
    total: rows.reduce((s, r) => s + r.total, 0),
    parts,
    outputSchemas: rows.reduce((s, r) => s + r.outputSchema, 0),
    listed: n(json(tools ?? [])),
    perTool: rows,
  };
}

export const countText = n;
