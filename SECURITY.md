# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Email **qwezzy721@gmail.com** with the version, the
command you ran, what happened and what you expected. We answer within 48 hours and agree a fix and disclosure date
with you. We credit reporters in the release notes unless you ask us not to.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x (latest) | yes |

## What mcp-token-cost does on your machine

Knowing this is the threat model:

- **A scan starts the MCP servers in your client configs**, with the command, arguments and environment written
  there, the same way your MCP client starts them. Treat it like opening the client: do not scan a config you would
  not run. `--offline` starts nothing.
- It only sends `initialize`, `notifications/initialized` and `tools/list`. **It never calls a tool.** A server that
  asks the client something (roots, sampling) gets a "not supported" error.
- Servers are stopped after the read; each has a timeout (`--timeout`, default 45 s).
- **Network:** none of its own, except: `--offline` and the fallback for a server that cannot be started send a
  public package name or server URL to [HISTOR](https://histor.modelmarket.dev) to read its public record;
  `--claude` sends your tool definitions to Anthropic's token counting API. Headers you pass with `--url --header`
  go only to that URL.
- No telemetry, no update check, nothing written outside the files you name (`--out`, `-o`, `--update`).
- Reports may contain tool names, descriptions and server names from your setup. Review them before you publish a
  report or a SARIF file.

## In scope

Code execution, file writes or network traffic beyond what is listed above; a crafted `tools/list` answer, config
file or HISTOR response that crashes the tool, hangs it past its timeout or makes it write elsewhere; secrets from a
config (environment values, headers) appearing in a report.

## Out of scope

What the MCP servers you configured do when started (report that to their authors); vulnerabilities in Node.js or in
the single dependency `gpt-tokenizer` (report upstream, and tell us so we can update).
