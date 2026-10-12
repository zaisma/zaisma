# Zaisma

Open-source, browser-first game platform: a Roblox alternative for every kind of game, including games made with AI tools. Tap a link and you're playing, as a guest, in any browser.

Founder: Julius. Side project, built in public. MIT licensed.

## Read first

- [`docs/PLAN.md`](docs/PLAN.md): what we're building, for whom, the money model, the stack, costs, 13+ rules, the build order, targets and competitors.
- [`docs/DECISIONS.md`](docs/DECISIONS.md): settled calls. Don't contradict them in code, copy or docs. If a task seems to need a change, stop and ask Julius with a short summary of exactly what would change.
- [`brand/README.md`](brand/README.md): logo files and usage rules.

## Current phase

**Weekend 1: safe game hosting.** Upload a web game, scan it before publishing (malware, illegal-image matching, AI review), serve it sandboxed on a separate game domain, list it on a simple directory page, report button and takedown flow.

Next: Weekend 2 (guest multiplayer rooms + invite links), Weekend 3 (accounts, saves, creator MCP and publishing, public beta). See the build order in `docs/PLAN.md`.

## Stack

- **Cloudflare Workers** for the API and site.
- **Cloudflare R2** for game files. Bandwidth is free; keep it that way (no egress-billed storage).
- **Cloudflare Durable Objects** for multiplayer rooms. Always use the WebSocket Hibernation API.
- **Supabase** for accounts, friends and saves (from Weekend 3).
- **Stripe Connect Standard** for the optional checkout (Week 6). Never take a platform fee.
- TypeScript everywhere. Keep dependencies few.

## Rules for code

- **Game content is untrusted.** Serve games only from the separate game domain, never zaisma.com. Sandbox iframes, strict CSP, no access to platform cookies or tokens.
- **No secrets in the repo.** It's public. Keys live in Cloudflare/Supabase settings and `.dev.vars` (gitignored).
- **Guests collect no personal data.** Guest IDs are temporary and only run the session.
- **Self-hosting must keep working.** Anything a game uses on our servers (rooms, player identity) needs a path that works on the developer's own server: signed player passes that any server can verify, room links that can point anywhere.
- **Cheap by design.** Check every feature against the cost targets in `docs/PLAN.md`. Multiplayer is ~80% of cost at scale.
- Ship small, working slices. Being first beats being complete.

## Working with Julius

- Make small decisions yourself and keep going. Don't ask him to do things you can do.
- Changes to pricing, positioning, who we serve or what we claim: show a short summary of exactly what changes and get his approval first.
- Flag only hard blockers in one line (illegal, would get accounts or the domain banned, clearly loses money), then keep going.
- Replies: concise, little jargon, no recap. End with the next step and anything you need from him.
- Commit messages: plain English, say what changed and why.
