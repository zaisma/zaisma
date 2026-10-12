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
- **Platform costs are covered by donations, sponsors and promoted slots.** GitHub Sponsors / Open Collective, company sponsors, paid front-page slots (about $50/week), supporter badge. Break-even is the goal, not profit.

## Open source and name

- **Everything is MIT licensed.** Every line of the platform, including the backend.
- **Name: Zaisma** (from Lithuanian *žaismas*, play). Domain zaisma.com (Cloudflare). GitHub org: zaisma.
- **Trademark later, defensive only.** Show "Zaisma™" now; file a US trademark (about $350) once donations cover it, only to stop someone else claiming the name.
- **No IP lawfare.** We lead by being best, not by licensing tricks.

## Safety and moderation

- **Scan before publish.** Malware scan, known-illegal-image matching, AI review. Games go live within minutes when clean.
- **Moderation pays for itself.** A capped free review budget per developer, then refundable $5 / $25 deposits, so floods from bad actors cost them, not us.
- **Games are sandboxed** on a separate game domain, never on zaisma.com.
- **Report button on every game page**, DMCA agent registered, takedown on notice.
- **Game domain: zaisma.gg** long term. Until it's bought, games are served from the free `workers.dev` address. A real game domain (one subdomain per game) is required before outside developers can upload, because only separate subdomains stop games reading each other's storage.
- **Games can't load outside scripts or call outside servers.** The code that runs is the code we scanned, so developers bundle their libraries. Our room host gets allowed when multiplayer ships.
- **Weekend 1 uploads are admin-only** (Julius). Developer uploads open with accounts in Weekend 3.

## Discovery

- **Progress bar to the front page.** Games earn front-page placement by clearing a visible bar (plays, retention, reports).
- **"New and rising" shelf** so new games get seen before they clear the bar.

## Product scope

- **Browser first, desktop downloads too.** Desktop builds use the same toolkit.
- **Custom game domains after beta.** Developers can point their own domain at their game (Cloudflare for SaaS: first 100 domains free, then about $0.10 each a month). Same scanning, sandbox and takedown rules.
- **Multiplayer rooms use WebSocket hibernation from day one** (Cloudflare Durable Objects). Without it, costs are 10x+.
- **Multiplayer words: client, game server, room.** The *client* is the game in the player's browser. The *game server* is the developer's server-side code that holds the official game state. A *room* is one live match, running one copy of the game server. Use these game-dev terms in code, docs and copy (not "room script" or "backend").
- **Tools tab in months 2–3.** Free, open-source developer tools (asset pipelines, engines, editors, Claude Code skills). Same rules as games; a tool must be open source to list.

## Release plan

- **Public beta after 3 weekends, then weekly releases**, plus a weekly game jam. Being first matters more than being complete.

## Brand

- **Logo: Julius's metal Z** (based on Futura) plus custom shard letters "aisma", lowercase z. Files and usage rules in [`brand/`](../brand/README.md).
- **Metal only on dark.** One-color black/white elsewhere; a small-size Z for 32 px and below; tri-color for special editions.
