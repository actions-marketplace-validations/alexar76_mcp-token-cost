// What in a tool list costs more than it needs to, or breaks the prompt cache.
// Each finding: {code, severity: "high"|"medium"|"low"|"info", server, tool?, message, tokens?}.
// "tokens" is the estimated reduction in the measured list when a finding can be sized.
import { countText } from "./count.js";

const VOLATILE = [
  [/\b20\d\d-[01]\d-[0-3]\d(?:[T ][0-2]\d:[0-5]\d(?::[0-5]\d)?(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d)?)?\b/, "a date or timestamp"],
  [/\b(?:today|current date|current time|now) is\b/i, "the current date or time"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i, "a UUID"],
  [/\b1[6-9]\d{8}(?:\d{3})?\b/, "a Unix timestamp"],
  [/\b(?:session|request|nonce|token)[ _-]?id[:=]\s*[\w-]{8,}/i, "a session or request id"],
];

function canonical(tools) {
  return JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema ?? {} })));
}

/** Nesting of a JSON Schema as a model reads it: object properties and array items, combinators at the same level. */
function depth(schema, d = 0) {
  if (!schema || typeof schema !== "object" || d > 50) return d;
  let max = d;
  if (schema.properties && typeof schema.properties === "object") for (const v of Object.values(schema.properties)) max = Math.max(max, depth(v, d + 1));
  if (schema.items && typeof schema.items === "object") max = Math.max(max, depth(schema.items, d + 1));
  for (const k of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(schema[k])) for (const v of schema[k]) max = Math.max(max, depth(v, d));
  return max;
}

function enums(node, path = "", out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node.enum)) out.push({ path: path || "(root)", size: node.enum.length, tokens: countText(JSON.stringify(node.enum)) });
  for (const [k, v] of Object.entries(node)) if (v && typeof v === "object" && k !== "enum") enums(v, path ? `${path}.${k}` : k, out);
  return out;
}

function sentences(text) {
  return (text || "").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 40);
}

/** Findings for one server's tool list. `reads` is every tools/list answer read in this run. */
export function serverFindings(server, tools, count, { reads = [], limits = {} } = {}) {
  const L = { description: 500, schema: 1500, enumSize: 40, depth: 5, ...limits };
  const f = [];
  const name = server.name;

  // 1. The list changed between two reads in one session: the prompt cache is rewritten on every refetch.
  if (reads.length > 1) {
    const [a, b] = [canonical(reads[0]), canonical(reads[1])];
    if (a !== b) {
      const sameSet = canonical([...reads[0]].sort((x, y) => (x.name > y.name ? 1 : -1))) === canonical([...reads[1]].sort((x, y) => (x.name > y.name ? 1 : -1)));
      f.push({
        code: sameSet ? "LIST_ORDER_UNSTABLE" : "LIST_CONTENT_UNSTABLE", severity: "high", server: name, cacheTokens: count.total,
        message: sameSet
          ? "Two tools/list reads returned the same tools in a different order. Tool definitions come first in the prompt, so every new order is a full prompt-cache write of this list."
          : "Two tools/list reads in one session returned different definitions. Every refetch rewrites the prompt cache from the tools onward.",
      });
    }
  }
  // 2. Text that changes by itself.
  for (const t of tools) {
    const text = `${t.description ?? ""} ${JSON.stringify(t.inputSchema ?? {})}`;
    for (const [re, what] of VOLATILE) {
      const m = text.match(re);
      if (m) {
        f.push({ code: "VOLATILE_TEXT", severity: "medium", server: name, tool: t.name,
          message: `The definition contains ${what} ("${m[0].slice(0, 40)}"). If it changes between sessions or releases, the prompt cache is rewritten from the tools onward.` });
        break;
      }
    }
  }
  // 3. Heavy parts.
  for (const r of count.perTool) {
    if (r.parts.description > L.description)
      f.push({ code: "LONG_DESCRIPTION", severity: "low", server: name, tool: r.name, tokens: r.parts.description - L.description,
        message: `Description is ${r.parts.description} tokens (limit ${L.description}). Examples and long usage notes can move to the server's instructions or docs.` });
    if (r.parts.inputSchema > L.schema)
      f.push({ code: "LARGE_SCHEMA", severity: "low", server: name, tool: r.name, tokens: r.parts.inputSchema - L.schema,
        message: `Input schema is ${r.parts.inputSchema} tokens (limit ${L.schema})${r.properties?.[0] ? `; heaviest property "${r.properties[0].key}" ${r.properties[0].tokens}` : ""}.` });
  }
  for (const t of tools) {
    for (const e of enums(t.inputSchema)) if (e.size > L.enumSize)
      f.push({ code: "LARGE_ENUM", severity: "low", server: name, tool: t.name, tokens: e.tokens,
        message: `Enum at ${e.path} lists ${e.size} values (${e.tokens} tokens). A free string with validation server-side, or a lookup tool, costs a few tokens.` });
    const d = depth(t.inputSchema);
    if (d > L.depth) f.push({ code: "DEEP_SCHEMA", severity: "info", server: name, tool: t.name, message: `Input schema nests ${d} levels of properties and items. Deep arguments are where models most often send malformed input.` });
  }
  // 4. The same sentence in many tools of one server.
  const seen = new Map();
  for (const t of tools) for (const s of new Set(sentences(t.description))) seen.set(s, (seen.get(s) ?? 0) + 1);
  for (const [s, k] of seen) if (k >= 3) {
    const each = countText(s);
    f.push({ code: "REPEATED_TEXT", severity: "low", server: name, tokens: each * (k - 1),
      message: `The same sentence appears in ${k} tool descriptions (${each} tokens each): "${s.slice(0, 80)}${s.length > 80 ? "…" : ""}". Once in the server's instructions is enough.` });
  }
  return f;
}

/** Findings across the whole setup. */
export function setupFindings(results, { window = 200000 } = {}) {
  const f = [];
  const owners = new Map();
  for (const r of results) for (const t of r.tools ?? []) {
    if (!owners.has(t.name)) owners.set(t.name, []);
    owners.get(t.name).push(r.server.name);
  }
  for (const [tool, servers] of owners) if (new Set(servers).size > 1)
    f.push({ code: "DUPLICATE_TOOL_NAME", severity: "medium", server: [...new Set(servers)].join(", "), tool,
      message: `"${tool}" is offered by ${new Set(servers).size} servers. A client that loads both may expose them under different names.` });
  const total = results.reduce((s, r) => s + (r.count?.total ?? 0) + (r.instructionsTokens ?? 0), 0);
  const share = total / window;
  if (share > 0.1)
    f.push({ code: "CONTEXT_SHARE", severity: share > 0.25 ? "high" : "medium", server: "(all)",
      message: `The full tool list and server instructions total ${total.toLocaleString("en-US")} tokens, ${(share * 100).toFixed(1)} % of a ${window.toLocaleString("en-US")}-token window.` });
  return f;
}
