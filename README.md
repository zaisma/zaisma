# Zaisma

**Every kind of game. One link away.**

Zaisma (ZAI-zmuh, from the Lithuanian *žaismas*, "play") is an open-source game platform for the browser.

- **Play instantly.** Tap a link and you're in the game: no account, no download, any device.
- **Publish anything.** Any web game, any engine, any style, including games made with AI tools like Claude Code. Players can install any game for offline play.
- **Keep your revenue.** No cut of your sales. Use our free checkout, your own Stripe, or any payment method you like, including Bitcoin.
- **Multiplayer your way.** Use our rooms at cost, or run your own servers. Accounts, friends and invite links keep working either way.
- **Fully open.** Every line of the platform is MIT licensed. Read it, fork it, run your own.

## Status

Pre-beta. Building in public.

| Phase | What ships |
| --- | --- |
| 0. Safe hosting (live) | Scan before publish, sandboxed game domain, directory, reporting |
| 1. Beta | Guest multiplayer and invite links, accounts and cloud saves, the creator MCP for publishing from any AI tool. **Public beta.** |
| 2. Earn | The Zaisma buy sheet, purchases that follow players, at-cost multiplayer billing |
| 3. Play together | Friends, Zaisma in Discord |
| 4. Discover | Quality-ranked front page, real ratings, player lists, follows |
| 5. Create together | Remixes, teams, mods, the Tools tab |

The full, live roadmap is in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## License

[MIT](LICENSE). Zaisma is free and open. Copy it, fork it, run your own.

## Run it yourself

Zaisma is two Cloudflare Workers: `apps/site` (zaisma.com: directory, game pages, reports, admin, scanning) and `apps/games` (the game domain: serves game files, sandboxed). Shared code is in `packages/core`.

```sh
npm install
cp apps/site/.dev.vars.example apps/site/.dev.vars
cp apps/games/.dev.vars.example apps/games/.dev.vars
npm run db:migrate:local
npm run dev:games   # http://localhost:8788
npm run dev:site    # http://localhost:8787, admin at /admin
npm test
```

To run your own Zaisma, create a D1 database, an R2 bucket and a queue (names in the two `wrangler.jsonc` files), put the database ID in both files, set your site and game addresses, protect `/admin` with Cloudflare Access, and `npm run deploy -w apps/games && npm run deploy -w apps/site`.

### How games are kept safe

- Every upload is scanned before it goes live: file-type and executable checks, static malware checks, known-illegal-image matching and an AI review. Anything unclear waits for a person.
- Games run on a separate domain inside a sandboxed frame, with a strict Content Security Policy: no access to zaisma.com, no cookies, no outside scripts or servers.
- Every game page has a Report button. Takedowns apply instantly and are logged.
