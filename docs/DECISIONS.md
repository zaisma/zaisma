# Decisions

Settled calls. Don't reopen these in code or docs without Julius approving the change. Newest at the bottom.

## Who we serve

- **Developers first.** Players come through developers' games and shared links.
- **13+ at launch.** Age gate at signup (birth date; block and don't store under-13s). Under-13 support later, as its own project with verified parental consent.
- **Guests play with no account.** A temporary guest ID used only to run the session: no chat, no purchases, no profile, no personal data. The age gate appears when a guest makes an account.
- **Teen-safe defaults for 13–17.** Friend requests only from people they've played with, chat off or preset phrases, private profiles, monthly spend cap.

## Money

- **No cut of game revenue.** Listing is free. Selling is free.
- **Developer's choice of payments.** Our Stripe Connect Standard checkout is an optional free convenience. Developers can use their own Stripe, Bitcoin or anything else. The platform never holds player money.
- **Multiplayer on our servers is billed at cost.** About $1 per 1,000 player-hours (what Cloudflare charges us). Bills under $5 roll over to the next month.
- **Bring your own servers, any time.** Our rooms are a default, never a requirement. Moving off them is a config change, not a rewrite.
- **No ads in games, at least through beta.** Ad scripts change after we scan them, track teens and are the main source of scams on web game sites, and ad-funded design drifts toward clickbait. Creators earn through purchases, our free checkout, and tips. (Idea parked for later, not decided: if donations and sponsors ever exceed costs, share the surplus with creators by playtime.)
- **Platform costs are covered by donations, sponsors and promoted slots.** GitHub Sponsors / Open Collective, company sponsors, paid front-page slots (about $50/week), supporter badge. Break-even is the goal, not profit.

## Open source and name

- **Everything is MIT licensed.** Every line of the platform, including the backend.
- **Name: Zaisma** (from Lithuanian *žaismas*, play). Domain zaisma.com (Cloudflare). GitHub org: zaisma.
- **Trademark later, defensive only.** Show "Zaisma™" now; file a US trademark (about $350) once donations cover it, only to stop someone else claiming the name.
- **No IP lawfare.** We lead by being best, not by licensing tricks.

## Safety and moderation

- **Scan before publish.** Malware scan, known-illegal-image matching, AI review. Every upload is scanned within minutes; the creator then publishes when ready.
- **Scan only what changed.** Files are fingerprinted, and an update reuses earlier results for unchanged files. Updates are limited per game per day (about 20) so a broken script can't upload in a loop.
- **Moderation pays for itself.** A capped free review budget per creator (not per game), then refundable $5 / $25 deposits, so floods from bad actors cost them, not us.
- **Games are sandboxed** on a separate game domain, never on zaisma.com.
- **Report button on every game page**, DMCA agent registered, takedown on notice.
- **Game domain: zaisma.gg** long term. Until it's bought, games are served from the free `workers.dev` address. A real game domain (one subdomain per game) is required before outside developers can upload, because only separate subdomains stop games reading each other's storage.
- **Games can't load outside scripts or call outside servers.** The code that runs is the code we scanned, so developers bundle their libraries. Our room host gets allowed when multiplayer ships.
- **Weekend 1 uploads are admin-only** (Julius). Developer uploads open with accounts in Weekend 3.
- **We only list games we host.** Every listed game's files are served by Zaisma, because our promise is that the code that runs is the code we scanned. Self-hosting means the multiplayer game server, never the game files. (Clearly marked outbound links to games hosted elsewhere could come after beta if creators ask.)
- **A Zaisma button on every game.** A small floating Z button in a corner, on our page above the game, opens Invite, Clip, Full screen, More games and Report. It fades while playing, stays in full screen, and the creator picks the corner; creators can't remove it. On custom domains our server adds it to the game page, and hiding or covering it breaks the content rules.
- **Same rules at every visibility.** Draft and unlisted games are scanned, reportable and bound by the content rules exactly like listed ones.

## Discovery

- **Progress bar to the front page.** Games earn front-page placement by clearing a visible bar (plays, retention, reports).
- **"New and rising" shelf** so new games get seen before they clear the bar.

## Product scope

- **Browser first, desktop downloads too.** Desktop builds use the same toolkit.
- **Custom game domains after beta.** Developers can point their own domain at their game (Cloudflare for SaaS: first 100 domains free, then about $0.10 each a month). Same scanning, sandbox and takedown rules.
- **Multiplayer rooms use WebSocket hibernation from day one** (Cloudflare Durable Objects). Without it, costs are 10x+.
- **Multiplayer is server-client by default.** The game server holds the official state and checks every move; a messages-only relay is there for simple games. While only Julius uploads, game servers are built into our rooms Worker. Once outside developers upload, they run in Cloudflare Dynamic Workers (needs Workers Paid, $5/month).
- **Multiplayer words: client, game server, room.** The *client* is the game in the player's browser. The *game server* is the developer's server-side code that holds the official game state. A *room* is one live match, running one copy of the game server. Use these game-dev terms in code, docs and copy (not "room script" or "backend").
- **Creator MCP first.** Creators manage everything from any AI tool through our MCP server, with a small upload command for builds (too big for MCP calls) and a Claude Code skill on top. The website dashboard and the MCP use the same API, so they always agree. Deleting or unpublishing a game needs confirmation.
- **Uploads are drafts.** Each upload is a version. Once it passes the scan, the creator gets a private preview link; nothing unscanned is shown to anyone. Details (name, description, cover, screenshots) are drafted and scanned too. The creator publishes now or schedules it, and can roll back to any kept version in one click. We keep the live version plus the last 5 approved; unpublished drafts are deleted after 30 days. Code history belongs in the creator's own Git.
- **Creators own many games; visibility and review are separate.** Visibility is the creator's: draft, listed (directory and search) or unlisted (anyone with the link). Review status is ours: live, under review or removed. Changing visibility never undoes a takedown. Co-owners and teams come after beta.
- **Big games are welcome.** From Weekend 3 the upload command sends files one by one straight to storage (no zip through a Worker), stored by fingerprint so versions share unchanged files and updates only upload what changed. Limits: 2 GB per game (more on request), 500 MB per file, 20,000 files. Until then the Weekend 1 limits stay (25 MB zip, 100 MB unpacked). The toolkit and skill teach loading in pieces so big games start fast, and the game page shows the download size and warns phone players before big downloads.
- **Device labels.** Creators state devices (phone, tablet, computer), controls (touch, keyboard and mouse, gamepad) and screen (portrait, landscape, either). Games for the player's device come first; others show a note and "Play anyway", never a block.
- **Creator play stats built in.** Plays, session length and retention in the dashboard and MCP, so games don't need outside analytics (which the sandbox blocks anyway).
- **Bigger game servers at cost, after beta.** For games that outgrow rooms (more players, heavy physics, Godot or Unity server builds): Cloudflare Containers, each sealed in its own virtual machine, billed to the developer at what it costs us (about $3 per 1,000 player-hours for a 1-core server shared by 32 players; check outbound data charges first). Developers' own servers stay free for us and allowed from Weekend 2.
- **Remixes, soon after beta.** Creators can switch on "Allow remixes" (off by default). A **Remix** button (also an MCP tool) copies the game into a new draft for the remixer. The credit line "Based on <game> by <creator>" is automatic and can't be removed, and the game page shows the remix chain. Remixes share the original's stored files and only changed files are scanned, so a remix starts almost free. Remixing a game that doesn't allow it is handled as a copyright issue.
- **Mods, in months 2–3.** The game creator opts in and decides what mods can change through a mod API in the toolkit. Mods are uploaded, scanned and versioned like games, listed on the game's page, and switched on by players. Creators can remove mods from their game; we can take down a mod without touching the game. Mods run inside the game's sandbox. In multiplayer, everyone in a room runs the same mods, and the invite link carries them. Remixes and mods are free at first, with tips for their makers.
- **Tools tab in months 2–3.** Free, open-source developer tools (asset pipelines, engines, editors, Claude Code skills). Same rules as games; a tool must be open source to list.

## Release plan

- **Public beta after 3 weekends, then weekly releases**, plus a weekly game jam. Being first matters more than being complete.

## Brand

- **Logo: Julius's metal Z** (based on Futura) plus custom shard letters "aisma", lowercase z. Files and usage rules in [`brand/`](../brand/README.md).
- **Metal only on dark.** One-color black/white elsewhere; a small-size Z for 32 px and below; tri-color for special editions.
