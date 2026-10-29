# Zaisma

Open-source, browser-first game platform: any web game, from any engine, plays from one link, as a guest, in any browser. No cut, no red tape, all open source. MIT licensed.

## Docs

- [`docs/DEVELOPER-API.md`](docs/DEVELOPER-API.md): the developer API behind the MCP, upload command and dashboard. Keep it in step with `apps/site/src/developer.ts`.
- [`docs/NAMING.md`](docs/NAMING.md): how names, values, inputs, errors and examples work in the API, MCP, SDK and game server. Follow it for every field, option and tool.
- [`docs/ADMIN-MCP.md`](docs/ADMIN-MCP.md): the admin MCP for reports and precedents, and how to connect it. Keep it in step with `apps/site/src/admin-mcp.ts`.
- [`docs/COVERS.md`](docs/COVERS.md): the cover guide: the lines covers, screenshots and titles keep to show in Zaisma's lists, and what good covers do. Keep it in step with `apps/site/src/cover-guide.ts`.
- [`docs/BACKGROUNDS.md`](docs/BACKGROUNDS.md): the background guide: what reads well under Zaisma's glass, and the stand-in backgrounds whose sources are open to start from. Keep it in step with `apps/site/src/background-guide.ts`.
- [`docs/DESIGN.md`](docs/DESIGN.md): Glass, the design system: rules, tokens, glass, shapes and components. Follow it for every page.
- [`brand/README.md`](brand/README.md): logo files and usage rules.

## Stack

- **Cloudflare Workers** for the API and site.
- **Cloudflare R2** for game files. Bandwidth is free; keep it that way (no egress-billed storage).
- **Cloudflare Durable Objects** for multiplayer rooms. Always use the WebSocket Hibernation API.
- **Supabase** for sign-in only (password hashes, and the email when a player adds one). Account details live in D1; cloud saves live in R2 (`zaisma-saves`).
- **Stripe Connect Standard** for the optional buy sheet. Never take a platform fee.
- TypeScript everywhere. Keep dependencies few.

## Rules for code

- **Game content is untrusted.** Serve games only from the separate game domain, never zaisma.com. Sandbox iframes, strict CSP, no access to platform cookies or tokens.
- **No secrets in the repo.** It's public. Keys live in Cloudflare/Supabase settings and `.dev.vars` (gitignored).
- **Guests collect no personal data.** Guest IDs are temporary and only run the session.
- **Self-hosting must keep working.** Anything a game uses on our servers (rooms, player identity) needs a path that works on the developer's own server: signed player passes that any server can verify, room links that can point anywhere.
- **Nothing for an AI to guess.** Names in the API, MCP, SDK, game server and Zaisma's own code (columns, types, functions, variables) follow `docs/NAMING.md`: whole words, the kind of value and its unit in the name, one type per field, one name per meaning. Close inputs, and answer with structured errors and the next call. `test/node/naming.test.ts` checks the code and the migrations.
- **Cheap by design.** Multiplayer is most of the cost at scale; keep rooms hibernating and storage free of egress fees.
- **Pages are only gallery components, layout included:** no page styles. `npm run layout:check` must pass for any page change: while you work, `-- --only <path>` for the pages you changed, and the full run once before you push.
- **Checks pass before a pull request.** Locally, `npm run check`: the typecheck, the Node tests your change can reach and your change's own Workers test files, one Workers run on a machine at a time; every other Workers test is left to GitHub. GitHub's check (`.github/workflows/check.yml`) runs the tests a pull request's change reaches (from the repository's graph), its new and changed test files ten times, and the typecheck; the merge queue and main run the full suite, the tests split across four runners, and `npm run ship` counts only those runs. A change to `docs/`, `.claude/`, `CLAUDE.md` or `README.md` alone runs only the tests that read them, in about half a minute. A test never reads today's date from the real clock or sleeps a fixed time (`test/node/test-clock.test.ts`).
- **Shipping** is `npm run ship`, after a pull request merges: it deploys exactly GitHub's main from its own clean copy, never the checkout it's run from.

@~/zaisma-private/ops/CLAUDE.md
