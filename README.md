# mcp-token-cost

<!-- aicom-mirror-notice -->
> 🔄 Synced from the [AI-Factory monorepo](https://github.com/alexar76/aicom) (append-only history). **Pull requests are welcome** — merged PRs are imported back and re-synced here. [Issues](https://github.com/alexar76/mcp-token-cost/issues) · [Pull requests](https://github.com/alexar76/mcp-token-cost/pulls)

[![npm](https://img.shields.io/npm/v/mcp-token-cost?color=cb3837&logo=npm)](https://www.npmjs.com/package/mcp-token-cost)
[![test](https://github.com/alexar76/mcp-token-cost/actions/workflows/test.yml/badge.svg)](https://github.com/alexar76/mcp-token-cost/actions/workflows/test.yml)
[![node](https://img.shields.io/node/v/mcp-token-cost)](package.json)
[![license](https://img.shields.io/badge/license-Apache--2.0%20OR%20MIT-blue)](#license)
[![data](https://img.shields.io/badge/data-HISTOR%20CC%20BY%204.0-6b6b66)](https://histor.modelmarket.dev/datasets/)

Every MCP server you connect sends its tool definitions to the model on every request, before you type a word.
`mcp-token-cost` tells you how many tokens that is: per server, per tool, per part of a tool, against
45,922 MCP servers measured in public, with the things that quietly break your prompt cache.

```bash
npx mcp-token-cost
```

It reads the MCP config of Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Gemini CLI and Codex, lists each
server's tools the way your client does, and prints:

```text
MCP tool definitions: 28,632 tokens on every request  (o200k_base)
███····················· 14.3 % of a 200,000-token window · 5 servers, 93 tools
A typical MCP server costs 1,311 tokens (median of 45,922 packages and remote hosts in HISTOR, one list each, 2026-11-16); 90th percentile 8,200.

Server       Tools   Tokens   Desc.  Schemas   Rank  Source
notion          24   17,161     504   16,379    p96  HISTOR 2026-11-20
playwright      25    3,938     432    3,261    p78  HISTOR 2026-11-18
github          26    3,546     287    3,001    p76  HISTOR 2026-11-18
filesystem      16    2,925   1,098    1,674    p72  HISTOR 2026-11-18
context7         2    1,062     541      501    p43  HISTOR 2026-11-21
Rank: the share of observed MCP packages and remote hosts whose list costs less (p90 = heavier than 90 % of them).

Heaviest tools
    1,268  notion › API-update-page-markdown  (description 67, schema 1,189) · heaviest property update_content 177
    1,083  notion › API-post-search  (description 17, schema 1,056) · heaviest property filter 229
      876  notion › API-patch-page  (description 17, schema 848) · heaviest property cover 93
      806  notion › API-post-page  (description 17, schema 779) · heaviest property children 62
      756  notion › API-query-data-source  (description 18, schema 727) · heaviest property filter_properties 47

Per 1,000 requests that send this list  (list prices; clients that load tools on demand send less)
  Claude Opus 5.5        $114.53 uncached ·    $5.86 cache kept warm ·  $143.16 cache rewritten every time
  Claude Sonnet 5.5       $57.26 uncached ·    $2.93 cache kept warm ·   $71.58 cache rewritten every time
  Claude Haiku 5.5         $2.86 uncached ·        – cache kept warm ·    $3.58 cache rewritten every time

Findings (1)
  MED  CONTEXT_SHARE  (all)
       Tool definitions and instructions take 28,632 tokens, 14.3 % of a 200,000-token window, before the first message.
```

The demo above is `--offline` on a five-server config: nothing was started, every definition came from
[HISTOR](https://histor.modelmarket.dev)'s public record of that server.

## What it does that a token counter doesn't

| | mcp-token-cost | a per-server counter | a web calculator |
|---|---|---|---|
| Your whole setup, from your client's config | ✓ (7 clients) | one server per run | pick from a catalogue |
| Per tool, split into name / description / input schema / structure, heaviest schema property | ✓ | per tool, desc/schema | per tool |
| Where you stand among 45,922 measured servers | ✓ percentile per server | – | catalogue max/median |
| Prompt-cache breakers: order or content that changes between two reads, dates, UUIDs | ✓ | – | – |
| Waste: repeated sentences across tools, huge enums, deep schemas, duplicate tool names across servers | ✓ sized in tokens | – | – |
| Without running anything (`--offline`, from HISTOR's stored definitions) | ✓ | – | ✓ |
| Claude's own count, including its tool-use prompt (`--claude`) | ✓ | ✓ | – |
| CI: baseline, each measure checked on its own, noise floor, budget, job summary, GitHub Action | ✓ | baseline + threshold | – |
| Reports: text, JSON, Markdown, self-contained HTML, SARIF | ✓ | text, JSON | page |
| Price per 1,000 requests: uncached, cache kept warm, cache rewritten | ✓ | – | – |

## Install

Nothing to install: `npx mcp-token-cost`. Node 18.17 or newer. One dependency (`gpt-tokenizer`).

## Usage

```bash
npx mcp-token-cost                                   # every server in your client configs
npx mcp-token-cost --offline                         # same, but start nothing: definitions from HISTOR
npx mcp-token-cost --stdio "npx -y @playwright/mcp"  # one server you start
npx mcp-token-cost --url https://mcp.example.com/mcp --header "Authorization: Bearer $TOKEN"
npx mcp-token-cost --tools tools.json                # a saved tools/list answer
npx mcp-token-cost lookup npm:@playwright/mcp        # HISTOR's record and how each release changed the cost
npx mcp-token-cost --format html                     # writes mcp-token-cost.html
```

`--config FILE` (repeatable) reads a specific config; `--only` / `--skip` pick servers. A server that cannot be
started falls back to HISTOR's record when it is a public npm/PyPI package or a URL (say `--no-histor` to turn that
off); the report says which source each row came from.

### Claude's count

The default tokenizer is `o200k_base`, offline and exact for the GPT-4o family. For Claude it is an estimate:
Claude's tokenizer produces roughly 15-20 % more tokens on typical text. `--claude` asks Anthropic's free token
counting API for Claude's own number. It counts each server's request with and without its tools, so the figure
includes the system prompt Claude adds whenever a request carries tools. It sends your tool definitions to
Anthropic, and needs the SDK and a key or an `ant auth login`:

```bash
npx -p @anthropic-ai/sdk -p mcp-token-cost mcp-token-cost --claude [--claude-model claude-sonnet-5-5]
```

## In CI

Commit a baseline once, then check every change. Each measure (the total, the descriptions, the input schemas) is
checked on its own, so a schema that doubles fails even when shorter descriptions hide it in the total. Growth under
50 tokens never fails.

```bash
npx mcp-token-cost snapshot --stdio "node dist/index.js" -o mcp-tokens.json
npx mcp-token-cost check --baseline mcp-tokens.json --stdio "node dist/index.js" --max-increase 10% [--budget 8000] [--update]
```

GitHub Actions (the table lands in the job summary):

```yaml
- uses: alexar76/mcp-token-cost@v0.1.0
  with:
    stdio: node dist/index.js
    baseline: mcp-tokens.json
    max-increase: 10%
```

`--fail-on high|medium|low` fails a scan on findings, and `--format sarif` feeds code scanning.

## Findings

| Code | What it means |
|---|---|
| `LIST_ORDER_UNSTABLE` | Two `tools/list` reads in one session returned the same tools in another order. Tools come first in the prompt, so each new order is a full prompt-cache write. |
| `LIST_CONTENT_UNSTABLE` | Two reads returned different definitions: every refetch rewrites the cache from the tools onward. |
| `VOLATILE_TEXT` | A date, timestamp, UUID or session id inside a definition: it changes, and the cache with it. |
| `CONTEXT_SHARE` | The whole setup takes more than 10 % of the context window before the first message. |
| `DUPLICATE_TOOL_NAME` | Two servers offer a tool with the same name. |
| `REPEATED_TEXT` | The same sentence in three or more descriptions of one server: once in the server's instructions is enough. |
| `LARGE_ENUM` | An enum with more than 40 values. |
| `LONG_DESCRIPTION`, `LARGE_SCHEMA` | Over 500 / 1,500 tokens. |
| `DEEP_SCHEMA` | More than 5 levels of properties and items. |

Each sized finding says how many tokens per request fixing it would save.

## How it counts

Exactly the way [HISTOR](https://histor.modelmarket.dev) counts, so a local number, a HISTOR record and the
population curve agree to the token (checked in the test suite against HISTOR's Python reference): each tool is
sent as `{"name", "description", "input_schema"}` in compact JSON, a list costs the sum of its tools, and each part
is the JSON value as written. Server `instructions`, which clients put in the system prompt, are counted on their
own line.

The population curve (`data/distribution.json`) comes from HISTOR's weekly snapshot of 2026-11-16 (CC BY 4.0),
rebuilt with `tools/build_distribution.py`: every listed server with a current tool list, 53,399 of them (27,440 npm
and PyPI packages run in a sandbox, 25,959 remote endpoints). The rank counts one list per owner, each package and
each remote host (its heaviest list), 45,922 in all, so a publisher that serves near-identical lists on thousands of
endpoints weighs as one. Over those: median 1,311 tokens and 8 tools, 90th percentile 8,200 tokens, 99th 43,549,
largest 699,910.

## What it does not tell you

- **What your client actually sends.** Some clients load tools on demand or drop fields; this counts the full list.
- **The provider's own wrapping**, except with `--claude`.
- **Prices change.** The money table uses list prices in `data/prices.json` (dated); pass `--price` for yours.
- **Which servers are good.** The rank is a token count, not a quality score.

## Privacy

A scan starts your configured servers on your machine (as your client would) and talks to nothing else, except:
`--offline` and the fallback ask HISTOR for public records by package name or URL; `--claude` sends tool definitions
to Anthropic. No telemetry.

## License

Apache-2.0 OR MIT. The bundled distribution is derived from HISTOR snapshots (CC BY 4.0).
