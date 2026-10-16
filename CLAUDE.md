# Zaisma

Open-source, browser-first game platform: a Roblox alternative for every kind of game, including games made with AI tools. Tap a link and you're playing, as a guest, in any browser.

Founder: Julius. Side project, built in public. MIT licensed.

## Read first

- [`docs/PLAN.md`](docs/PLAN.md): what we're building, for whom, the money model, the stack, costs, 13+ rules, the build order, targets and competitors.
- [`docs/ROADMAP.md`](docs/ROADMAP.md): the live roadmap: the Now list, then phases split into projects, each item with must/nice and where it stands.
- [`docs/IDEAS.md`](docs/IDEAS.md): ideas waiting for a decision. Not plans; never build from it without Julius deciding.
- [`docs/DECISIONS.md`](docs/DECISIONS.md): settled calls. Don't contradict them in code, copy or docs. If a task seems to need a change, stop and ask Julius with a short summary of exactly what would change.
- [`docs/DESIGN.md`](docs/DESIGN.md): Steel, the design system: rules, tokens, the metal hover and components. Follow it for every page.
- [`docs/DEVELOPER-API.md`](docs/DEVELOPER-API.md): the developer API behind the MCP, upload command and dashboard. Keep it in step with `apps/site/src/developer.ts`.
- [`docs/NAMING.md`](docs/NAMING.md): how names, values, inputs, errors and examples work in the API, MCP, SDK and game server. Follow it for every field, option and tool.
- [`docs/ADMIN-MCP.md`](docs/ADMIN-MCP.md): the admin MCP for reports and precedents, and how to connect it. Keep it in step with `apps/site/src/admin-mcp.ts`.
- [`brand/README.md`](brand/README.md): logo files and usage rules.

## Current phase

**Phase 1: Beta.** Phase 0 (safe hosting) is live. What's being built next, in order, is the Now list at the top of [`docs/ROADMAP.md`](docs/ROADMAP.md); take work from there unless Julius says otherwise. Julius usually works through the `coordinator` skill: one session that starts a `build-next` session for each free item in Now, up to a cap (2 by default, `/coordinator 3` for more) and in one of three modes (`both`, `build` while he's away, `talk` to settle the backlog), brings him their talks, previews and questions, and runs `whats-next` when Now runs dry. When Now is empty or Julius asks what's next, use the `whats-next` skill (`.claude/skills/whats-next/SKILL.md`). To start one item, use the `build-next` skill. `node scripts/roadmap-item.mjs <place in Now or name>` prints any item with what it needs, and `--now` lists Now with what's ready.

How the roadmap is kept, so nobody has to piece it together or guess:

- **Every item belongs to one project** (a `###` heading with a goal and a "Done when" line). New work goes into the project it serves; a new project gets both lines.
- **One row per slice.** When an item lands and work on it continues, mark the row `done` (with the date, PR and migration) and add the next slice as a new row. Never keep a row `doing` while growing its note.
- **A project is done only when every row is done and settled** and its "Done when" holds. Say so from the rows, not from memory.
- **`next` means the Now list.** Only items in Now are `next`, in Now's order; change Now and the statuses together, with Julius's OK for the order.
- **First goes before everything.** Now has two parts: **First**, the items nothing else starts before (others build on their shape, or they get dearer the longer they wait; usually empty), and **Next**, the rest in order, which can be built side by side in their own sessions. A project's own gate is a `**First:** <item>` line under its goal: every other row in it waits on that item, and the line goes when it's done. Only Julius puts items in First; the `whats-next` skill proposes them.
- **Settled means talked through with Julius.** The `Settled` column says `yes` only after Julius and Claude have gone through the item's design and scope and Julius said it's settled; only his word in chat sets it, never Claude's judgment, and a row that's split into slices keeps it only when he OKs the slices. Settled is apart from status. `done` only says it was built; a done row that isn't settled was built without his talk, and it isn't checked off until he settles it (`node scripts/roadmap-item.mjs --unsettled` lists them). Rows only a person does (`Julius: …`, `Gleb: …`) have nothing to settle. Settled items are ready to build, and their pull requests merge and ship without him (see "Merging" below). An item that isn't settled is talked through with the `talk-through` skill before anything is built. `build-next` does that first in the item's own session (also under the `coordinator`, where Julius opens that session while the others build), and once he says yes, the same session builds it.
- **Notes stay short:** what the item is, and when it went live. How it works goes in `docs/DECISIONS.md`, the docs or the PR. Item names never contain commas (Needs splits on them) and every name in Needs is an item's exact name.

Keep the roadmap current: when work starts, lands or moves, update its status in `docs/ROADMAP.md` in the same change. The roadmap page (https://claude.ai/artifact/5ES8sV8oDvQqzdg2aGXNzm) can't read GitHub, so it's republished in one step, **only right after a push to main** that changes `docs/ROADMAP.md` or `docs/roadmap.html` (a merge or a direct commit), always from `origin/main`, never from a checkout:

1. `git fetch origin`, then two plain commands into your scratchpad: `git show origin/main:docs/roadmap.html > <scratchpad>/roadmap.html` and `git show origin/main:docs/ROADMAP.md > <scratchpad>/ROADMAP.md`.
2. Publish `<scratchpad>/roadmap.html` as an Artifact to that URL, with `files: {"ROADMAP.md": {"from": "<scratchpad>/ROADMAP.md", "contentType": "text/plain"}}` (the wordmarks are kept).

If the publish is refused because another session published first, repeat both steps: origin/main is the truth, so never merge rows by hand. Never publish before the push, from a branch, or from the main checkout.

## Shipping

`npm run ship`, from any checkout, after a PR merges. It deploys exactly GitHub's main from its own clean copy (`.claude/ship` in the main checkout), never the checkout it's run from, so never deploy with `wrangler deploy` or `npm run deploy` yourself. In order: GitHub's check on that commit (waited for while it runs; a failed one is `SHIP FAIL`), pending D1 migrations, then rooms, games and site, then the CLI to npm when its version is new, then a live check of a game page, the MCP, game files and rooms. It also pulls the main checkout's `main` when that's a clean fast-forward. Its last line is one of:

- `SHIP PASS …`: live and checked.
- `SHIP WAITING …`: a pending migration deletes data (`DROP TABLE`, `DROP COLUMN`, `DELETE FROM`, `TRUNCATE`) and nothing was deployed. Those need Julius: start `npm run ship` in a Terminal tab (`run_in_terminal`), where wrangler asks him before applying; read the tab for the ✅ and the `SHIP PASS`. A CLI release waiting for npm sign-in works the same way.
- `SHIP FAIL …`: what failed and what's live; fix it, don't work around it.

Claude runs `npm run ship` itself. Migrations that only add or change (tables, columns, indexes, renames, backfills) apply by themselves; only ones that delete data wait for Julius (Julius, Oct 16, 2026). `npm run ship -- --dry` says what would ship without changing anything.

## Stack

- **Cloudflare Workers** for the API and site.
- **Cloudflare R2** for game files. Bandwidth is free; keep it that way (no egress-billed storage).
- **Cloudflare Durable Objects** for multiplayer rooms. Always use the WebSocket Hibernation API.
- **Supabase** for sign-in only (it holds the email). Account details live in D1; cloud saves live in R2 (`zaisma-saves`).
- **Stripe Connect Standard** for the optional buy sheet (Phase 2). Never take a platform fee.
- TypeScript everywhere. Keep dependencies few.

## Rules for code

- **Your game is your game.** Zaisma gives developers building blocks with full access, mostly optional, and charges only for things like hosting; no cut, no ifs or buts beyond misuse. Check every feature against "The direction" in `docs/DECISIONS.md` and prefer a building block over a Zaisma-run feature or screen.
- **Honest clients make it smooth; the server keeps the backstop.** Let the SDK and pages do extra work so honest players get an instant, seamless experience, but never let safety, fairness or money depend on a client: the server always keeps its own slower check. See "The direction" in `docs/DECISIONS.md`.
- **What a developer can see, their AI can see.** Anything the dashboard shows or does, and anything public, goes through the developer API and MCP with the same data; never build a feature on a page alone. Exceptions are deliberate and named (making API keys stays on the account page). See "The direction" in `docs/DECISIONS.md`.
- **Nothing for an AI to guess.** Names in the API, MCP, SDK, game server and Zaisma's own code (columns, types, functions, variables) follow `docs/NAMING.md`: whole words, the kind of value and its unit in the name, one type per field, one name per meaning, the same words inside and out. Close inputs, add good and bad examples where calls go wrong, and answer with structured errors and the next call. `test/node/naming.test.ts` checks the code and the migrations. See "The direction" in `docs/DECISIONS.md`.
- **What's live keeps working.** After the beta, the SDK and game server only gain things within v1, and the API and MCP rename or remove only as "The direction" in `docs/DECISIONS.md` says.
- **Game content is untrusted.** Serve games only from the separate game domain, never zaisma.com. Sandbox iframes, strict CSP, no access to platform cookies or tokens.
- **No secrets in the repo.** It's public. Keys live in Cloudflare/Supabase settings and `.dev.vars` (gitignored).
- **Guests collect no personal data.** Guest IDs are temporary and only run the session.
- **Self-hosting must keep working.** Anything a game uses on our servers (rooms, player identity) needs a path that works on the developer's own server: signed player passes that any server can verify, room links that can point anywhere.
- **Cheap by design.** Check every feature against the cost targets in `docs/PLAN.md`. Multiplayer is ~80% of cost at scale.
- Ship small, working slices. Being first beats being complete.
- **Checks pass before a pull request.** Run `npm test` and `npm run typecheck` before opening one; GitHub's check (`.github/workflows/check.yml`) runs both on every pull request and push to main, and `npm run ship` stops when it failed.

## Adding a building block

A building block is anything a developer or their AI uses: an API call or MCP tool, an SDK call or event, a game server option, a setting. Before calling one done, go through the places it can live; skip the ones that don't apply and say which in the PR.

1. **Design.** It fits "The direction" in `docs/DECISIONS.md`, the cost targets in `docs/PLAN.md` and the 13+ rules; its names come from the glossary in `docs/NAMING.md` first.
2. **Core and data.** Logic shared by more than one app goes in `packages/core`; a migration's columns follow `docs/NAMING.md`.
3. **API and MCP together.** The route in `apps/site/src/developer.ts`, the tool in `mcp.ts`, the answer's schema in `schemas.ts`, error codes in `ERROR_CODES`, `next_steps` on changes, examples where a call is easy to get wrong. The dashboard reads the same API.
4. **Inside games.** SDK calls and events in `packages/sdk/zaisma.js` and `zaisma.d.ts`; a game server option works the same in Zaisma rooms (`apps/rooms`) and on the developer's own server (`packages/game-server/bin/node.js`).
5. **The upload command**, when developers would do it from a terminal: a command or flag, closed like the API, with its answer under `--json`.
6. **Docs in the same change:** `docs/DEVELOPER-API.md`, the glossary, how it works in `docs/DECISIONS.md`, a forum category (`packages/core/src/forum.ts`) for a new area, and the example games when it changes how games are written.
7. **Tests and preview:** API and MCP answers checked against their schemas, game server options tested in both runtimes, and test data in `npm run preview` for anything a page shows.
8. **After the beta**, changing or removing it follows "What's live keeps working".

## Working with Julius

- Make small decisions yourself and keep going. Don't ask him to do things you can do.
- Changes to pricing, positioning, who we serve or what we claim: show a short summary of exactly what changes and get his approval first.
- Flag only hard blockers in one line (illegal, would get accounts or the domain banned, clearly loses money), then keep going.
- Replies: concise, little jargon, no recap. End with the next step and anything you need from him.
- Commit messages: plain English, say what changed and why.
- **Preview before live.** Anything a player or developer would see change on a page (new or changed screens, states, copy, layout) runs in the local preview first (`npm run preview`: site, games and a stand-in sign-in on localhost:8800, filled with test games; `-- --reset` for fresh data; `PREVIEW_PORT_OFFSET=100` runs it on localhost:8900 when another checkout has 8800, and any multiple of 100 works for more). Give Julius direct links to the pages and states to look at, iterate with him there, and only then merge and ship. This is the one approval he always gives himself. Small fixes he asks for directly can ship as before.
- **Merging.** A pull request for a **settled** roadmap item merges without asking once GitHub's check passes, it's up to date with main, and Julius has OK'd its preview when it had one; then `npm run ship` (each `build-next` session does this itself). Everything else is Julius's call: items that aren't settled, work that isn't a roadmap item, and changes to these rules. He clicks merge, or says "merge" in chat for that PR (a migration he ran isn't approval).
