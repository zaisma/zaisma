# Zaisma

Open-source, browser-first game platform: any game you can imagine, one link from the players who'll love it. No cut, no red tape, all open source. Tap a link and you're playing, as a guest, in any browser. MIT licensed.

## Docs

- [`docs/DEVELOPER-API.md`](docs/DEVELOPER-API.md): the developer API behind the MCP, upload command and dashboard. Keep it in step with `apps/site/src/developer.ts`.
- [`docs/NAMING.md`](docs/NAMING.md): how names, values, inputs, errors and examples work in the API, MCP, SDK and game server. Follow it for every field, option and tool.
- [`docs/ADMIN-MCP.md`](docs/ADMIN-MCP.md): the admin MCP for reports and precedents, and how to connect it. Keep it in step with `apps/site/src/admin-mcp.ts`.
- [`docs/DESIGN.md`](docs/DESIGN.md): Steel, the design system: rules, tokens, the metal hover and components. Follow it for every page.
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
- **Checks pass before a pull request.** Run `npm test` and `npm run typecheck` before opening one; GitHub's check (`.github/workflows/check.yml`) runs both on every pull request and push to main, the tests split across six runners, and `npm run ship` stops when it failed. A change to `docs/`, `.claude/`, `CLAUDE.md` or `README.md` alone runs only the tests that read them, in about half a minute.
- **Shipping** is `npm run ship`, after a pull request merges: it deploys exactly GitHub's main from its own clean copy, never the checkout it's run from.

@~/zaisma-private/ops/CLAUDE.md
