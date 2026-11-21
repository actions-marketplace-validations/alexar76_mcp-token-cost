# Changelog

## Unreleased

## 0.1.0 — first release

- `scan`: every MCP server in the configs of Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Gemini CLI and
  Codex, or one server (`--stdio`, `--url`, `--tools`). Live over stdio, streamable HTTP and the older HTTP+SSE
  transport, or `--offline` from HISTOR's stored definitions; a server that cannot be started falls back to HISTOR.
- Counting: HISTOR's method (each tool `{name, description, input_schema}` in compact JSON, a list is the sum of its
  tools, parts as their JSON values), `o200k_base`; per tool, per part, heaviest schema property; server
  instructions on their own line. `--claude`: Claude's count through Anthropic's token counting API, including the
  tool-use system prompt.
- Rank of each server among 45,922 MCP packages and remote hosts (one list each) from HISTOR's snapshot of
  2026-11-16 (53,399 listed servers).
- Findings: `LIST_ORDER_UNSTABLE`, `LIST_CONTENT_UNSTABLE`, `VOLATILE_TEXT`, `CONTEXT_SHARE`, `DUPLICATE_TOOL_NAME`,
  `REPEATED_TEXT`, `LARGE_ENUM`, `LONG_DESCRIPTION`, `LARGE_SCHEMA`, `DEEP_SCHEMA`.
- Reports: text, JSON, Markdown (also the GitHub job summary), self-contained HTML, SARIF 2.1.0. Price per 1,000
  requests uncached, with a warm cache and with the cache rewritten.
- CI: `snapshot`, `check` (total, descriptions and input schemas each against `--max-increase`, `--noise`,
  `--budget`, `--update`), `diff`; `--fail-on`; a composite GitHub Action.
- `lookup`: HISTOR's record of a package or URL and the token cost of its recent changes.
