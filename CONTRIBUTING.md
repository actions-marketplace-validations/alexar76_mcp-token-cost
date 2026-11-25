<!-- satellite-contributing -->
# Contributing

Issues and pull requests are welcome in this repository. Its history is append-only: a merged pull request is
imported into the monorepo the project is developed in and synced back here, so your commit keeps its place.

## Before you start

Open an issue first for anything larger than a fix, so we agree on the change before you write it. A new client
config, a new finding or a change to how tokens are counted always needs one.

## Development

```bash
git clone https://github.com/alexar76/mcp-token-cost && cd mcp-token-cost
npm ci
npm test                       # node --test, no network
node bin/mcp-token-cost.js --stdio "node fixtures/server.mjs"
```

Node 18.17 or newer. Keep runtime dependencies at one (`gpt-tokenizer`); `@anthropic-ai/sdk` stays an optional peer.

## Rules that keep the numbers comparable

- **Counting follows HISTOR's method to the token.** `test/count.test.js` pins reference numbers computed with
  HISTOR's Python implementation. A change that moves them changes every comparison with the population curve and
  with HISTOR records, so it needs an issue and a matching change on HISTOR's side.
- **A finding has a code, a severity, a message that says what to do, and a test that fails without it.** Size it in
  tokens (`tokens`) only when fixing it would remove those tokens from the measured list. A prompt-cache cost goes in
  `cacheTokens`.
- **A new client config** goes in `src/config.js` with its documented location and a parser test in
  `test/config.test.js`. Cite the client's documentation in the pull request.
- **The scanner never calls a tool** and starts nothing in `--offline` mode. Pull requests that change that will not
  be merged.
- `data/distribution.json` is rebuilt only with `tools/build_distribution.py` from a published HISTOR snapshot; say
  which one in the pull request.

## Pull requests

Branch from `main`, keep the change focused, add or update tests, and update `CHANGELOG.md` under "Unreleased".
Describe what you measured before and after when the change affects counts or findings.

Security problems: see [SECURITY.md](SECURITY.md), not a public issue.
