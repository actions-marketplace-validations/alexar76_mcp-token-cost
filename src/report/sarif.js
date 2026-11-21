const LEVEL = { high: "error", medium: "warning", low: "note", info: "note" };

export function render(m, { file = "mcp.json" } = {}) {
  const ids = [...new Set(m.findings.map((f) => f.code))];
  const rules = ids.map((id) => ({ id, shortDescription: { text: id.toLowerCase().replace(/_/g, " ") } }));
  const doc = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "mcp-token-cost", version: "0.1.0", informationUri: "https://github.com/alexar76/mcp-token-cost", rules } },
        results: m.findings.map((f) => ({
          ruleId: f.code,
          level: LEVEL[f.severity],
          message: { text: `${f.server}${f.tool ? ` › ${f.tool}` : ""}: ${f.message}` },
          locations: [{ physicalLocation: { artifactLocation: { uri: file } } }],
          properties: { server: f.server, tool: f.tool ?? null, tokens: f.tokens ?? null },
        })),
      },
    ],
  };
  return JSON.stringify(doc, null, 2) + "\n";
}
