# Decisions

Settled calls. Don't reopen these in code or docs without Julius approving the change. Newest at the bottom.

## Who we serve

- **Developers first.** Players come through developers' games and shared links.
- **13+ at launch.** Age gate at signup (birth date; block and don't store under-13s). Under-13 support later, as its own project with verified parental consent.
- **Guests play with no account.** A temporary guest ID used only to run the session: no chat, no purchases, no profile, no personal data. The age gate appears when a guest makes an account.
- **Players can mute, block and report other players** in rooms, so one person can't ruin a match or follow someone between games. Blocks follow the account (or the session, for guests).
- **Teen-safe defaults for 13–17.** Friend requests only from people they've played with, chat off or preset phrases, private profiles, monthly spend cap.

## Money

- **No cut of game revenue.** Listing is free. Selling is free.
- **Developer's choice of payments.** Our checkout is an optional free convenience. Developers can use their own Stripe, Bitcoin or anything else. The platform never holds player money.
- **One Zaisma buy sheet; we own the buying experience, not the money.** A game calls `Zaisma.buy(item)` and our page shows the same sheet over every game: item, real price, buy. Apple Pay and Google Pay, plus a card saved once on the player's Zaisma account and usable in every game (Stripe clones it to each creator's account at purchase). Creators are the sellers through Stripe Connect Standard, so sales tax, refunds and chargebacks are theirs; Stripe Tax is offered (about 0.5%), or a seller-for-you service like Paddle through their own link. Owned items are stored with the player's account, so they work on every device; games check `Zaisma.owns(item)` and game servers check signed receipts like player passes. Purchase history, receipts and the teen spending cap live in the account. Creators can also grant items through the MCP or an API (for example, Patreon supporters). No Zaisma wallet or currency, and we're never the seller. Card fees make tiny purchases expensive (about 30¢ each), so creators are nudged toward items of $2–3 or more.
- **Multiplayer on our servers is billed at cost.** About $1 per 1,000 player-hours (what Cloudflare charges us). Bills under $5 roll over to the next month.
- **Bring your own servers, any time.** Our rooms are a default, never a requirement. Moving off them is a config change, not a rewrite.
- **No ads in games, at least through beta.** Ad scripts change after we scan them, track teens and are the main source of scams on web game sites, and ad-funded design drifts toward clickbait. Creators earn through purchases, our free checkout, and tips. (Idea parked for later, not decided: if donations and sponsors ever exceed costs, share the surplus with creators by playtime.)
- **Honest purchase labels.** Every game page says what a game sells ("Has purchases: cosmetics only"). Open question for Week 6: ban paid random rewards (loot boxes) for under-18s, which several countries already restrict.
- **Games open outside links only through Zaisma.** The sandbox blocks games from opening pages themselves. A game asks the toolkit to open a link, and our page opens it in a new tab with a short "You're leaving Zaisma" notice. Only links the creator registered for that game work (their store, Patreon, Bitcoin page, Steam, Discord), so games can't send players to random sites. This is how creators' own payment methods work from inside a game.
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

- **Progress bar to the front page.** Games earn front-page placement by clearing a visible bar built on quality: how many players come back, how long they play, ratings from people who actually played, and reports. Raw play counts never decide placement on their own, and there's no "Most played" shelf.
- **"New and rising" shelf** so new games get seen before they clear the bar, with a quality bar of its own.
- **No slop.** Zaisma never looks like a wall of clickbait. Cover images and titles can't use fake rewards or currency bait ("Free Robux"), famous characters or brands the creator doesn't own, or art that doesn't show the actual game; the AI review checks covers and holds games that break this. Every game page shows real screenshots or gameplay next to the cover. No swipe feed: it amplifies clickbait.
- **Discovery through people.** Player-made lists, creator picks, game jam winners and "New and rising", plus search by genre and tags.
- **Ratings only from people who played** for a few minutes, so there are no drive-by or fake reviews.
- **Copycats made visible.** Remixes show what they're based on, and the same template reposted with new skins counts as one game for discovery.

## Product scope

- **Browser only; no native desktop downloads.** Native downloads contradict "no app download", would make us a malware distributor the first time a scan misses something, and need code signing and per-OS builds. Instead every game gets an **Install** button: an installable web app (PWA) with its own icon, window and offline play, in the same sandbox. Developers with native builds link to their Steam or itch.io page from their game page.
- **Fit any game; never make creators rebuild for Zaisma.** Integration comes in optional layers, and a game can stop at any of them:
  - *Layer 0, no changes:* any web game that runs from an `index.html` uploads as is (Phaser, Three.js, Unity and Godot web exports, single-file AI games), with its own saves working. The upload command fixes common blockers itself: it downloads scripts loaded from outside sites into the game (so they're scanned) and unpacks pre-compressed engine builds. `zaisma check` (also an MCP tool) lists anything else that won't work and how to fix it.
  - *Layer 1, one script tag:* clips, cloud saves that mirror the game's own browser saves for signed-in players, and the right name and invite link in the Z menu, with no code.
  - *Layer 2, a few calls:* rooms, invite links and player names. Drop-in replacements for Socket.IO and PeerJS route existing multiplayer prototypes through our rooms with little code change.
  - *Layer 3, built around Zaisma:* game servers, accounts, friends, purchases, mods.

  No required engine, framework, avatar or world; the toolkit is small plain JavaScript. We provide data and the game draws its own screens (ready-made screens are optional). The skill and MCP do the adapting. Nothing locks creators in: passes are standard signed tokens, game servers are plain JavaScript over WebSockets, and off Zaisma the toolkit points at the creator's own server or falls back to solo. The fixed limits, stated upfront: the sandbox, no ads, no free-text chat for guests, and the Z button.
- **Custom game domains after beta.** Developers can point their own domain at their game (Cloudflare for SaaS: first 100 domains free, then about $0.10 each a month). Same scanning, sandbox and takedown rules.
- **Multiplayer rooms use WebSocket hibernation from day one** (Cloudflare Durable Objects). Without it, costs are 10x+.
- **Multiplayer is server-client by default.** The game server holds the official state and checks every move; a messages-only relay is there for simple games. While only Julius uploads, game servers are built into our rooms Worker. Once outside developers upload, they run in Cloudflare Dynamic Workers (needs Workers Paid, $5/month).
- **Multiplayer words: client, game server, room.** The *client* is the game in the player's browser. The *game server* is the developer's server-side code that holds the official game state. A *room* is one live match, running one copy of the game server. Use these game-dev terms in code, docs and copy (not "room script" or "backend").
- **Creator MCP first.** Creators manage everything from any AI tool through our MCP server, with a small upload command for builds (too big for MCP calls) and a Claude Code skill on top. The website dashboard and the MCP use the same API, so they always agree. Deleting or unpublishing a game needs confirmation.
- **Uploads are drafts.** Each upload is a version. Once it passes the scan, the creator gets a private preview link; nothing unscanned is shown to anyone. Details (name, description, cover, screenshots) are drafted and scanned too. The creator publishes now or schedules it, and can roll back to any kept version in one click. We keep the live version plus the last 5 approved; unpublished drafts are deleted after 30 days. Code history belongs in the creator's own Git.
- **Creators own many games; visibility and review are separate.** Visibility is the creator's: draft, listed (directory and search) or unlisted (anyone with the link). Review status is ours: live, under review or removed. Changing visibility never undoes a takedown. Teams come after beta (see below), but from Weekend 3 every game is owned by an owner that can later be a person or a team, so teams drop in without rebuilding the database.
- **Big games are welcome.** From Weekend 3 the upload command sends files one by one straight to storage (no zip through a Worker), stored by fingerprint so versions share unchanged files and updates only upload what changed. Limits: 2 GB per game (more on request), 500 MB per file, 20,000 files. Until then the Weekend 1 limits stay (25 MB zip, 100 MB unpacked). The toolkit and skill teach loading in pieces so big games start fast, and the game page shows the download size and warns phone players before big downloads.
- **Device labels.** Creators state devices (phone, tablet, computer), controls (touch, keyboard and mouse, gamepad) and screen (portrait, landscape, either). Games for the player's device come first; others show a note and "Play anyway", never a block.
- **Creator play stats built in.** Plays, session length and retention in the dashboard and MCP, so games don't need outside analytics (which the sandbox blocks anyway).
- **Play inside Discord, after beta; it's our voice chat for now.** One "Zaisma" Discord Activity opens any game, and everyone in the call lands in the same room. Discord handles voice, so we don't run chat ourselves. Games stay hosted, scanned and sandboxed by us; Discord just shows our page. Players can choose to share their Discord name, otherwise they play as guests. Needs Discord's app review and our rooms set up for Discord's proxy.
- **Bigger game servers at cost, after beta.** For games that outgrow rooms (more players, heavy physics, Godot or Unity server builds): Cloudflare Containers, each sealed in its own virtual machine, billed to the developer at what it costs us (about $3 per 1,000 player-hours for a 1-core server shared by 32 players; check outbound data charges first). Developers' own servers stay free for us and allowed from Weekend 2.
- **Remixes, soon after beta.** Creators can switch on "Allow remixes" (off by default). A **Remix** button (also an MCP tool) copies the game into a new draft for the remixer. The credit line "Based on <game> by <creator>" is automatic and can't be removed, and the game page shows the remix chain. Remixes share the original's stored files and only changed files are scanned, so a remix starts almost free. Remixing a game that doesn't allow it is handled as a copyright issue. Creators can also choose "If I stop updating this game for 12 months, allow remixes", so the community can keep abandoned games alive; credit still goes to them.
- **Teams, after beta.** A team owns games instead of a person, like GitHub organizations or Roblox groups. Roles: owner (members, payouts, transfer or delete games), publisher (publish, schedule, roll back) and developer (upload drafts, preview links). Games move between a person and a team without losing their link, players or history. The MCP acts as the member with their role, and the audit log records who did what. Review budgets and deposits belong to the team. The game page credits the team; members choose whether they're named. One payout account per team; splitting money is the team's business, since we never hold player money. Teams with 13–17 members follow the teen-safe defaults (invite links only, no private messages through Zaisma), and a teen's payout account must be parent-owned. Every team keeps at least one owner; if the last one leaves, the next publisher takes over.
- **Mods, in months 2–3.** The game creator opts in and decides what mods can change through a mod API in the toolkit. Mods are uploaded, scanned and versioned like games, listed on the game's page, and switched on by players. Creators can remove mods from their game; we can take down a mod without touching the game. Mods run inside the game's sandbox. In multiplayer, everyone in a room runs the same mods, and the invite link carries them. Remixes and mods are free at first, with tips for their makers.
- **Tools tab in months 2–3.** Free, open-source developer tools (asset pipelines, engines, editors, Claude Code skills). Same rules as games; a tool must be open source to list.

## Marketing for creators

- **Every tool we can give creators to market their games, free.** We take no cut, so helping creators find players is how we compete. All of it works within the no-ads, no-tracking rules.
  - *Weekend 3:* links on the game page (Steam, itch.io, Discord, website, socials, "Wishlist on Steam"); proper share cards (cover, title, "Play now") for every game link and room invite; search-friendly game pages; QR codes.
  - *Week 5, with discovery:* "Play on Zaisma" embeds for creators' own sites, with the Z button inside; tracked share links that count plays per link and never record anything about players; update notes on the game page, followers told about new versions, and updates posted to the creator's Discord; an automatic press kit; MCP tools that draft launch posts, store descriptions and tags and take screenshots, with the creator approving anything before it's posted.
  - Trailers are YouTube links, not uploads; video is costly to check and YouTube is where trailers get seen anyway.

## Release plan

- **Public beta after 3 weekends, then weekly releases**, plus a weekly game jam. Being first matters more than being complete.

## Brand

- **Logo: Julius's metal Z** (based on Futura) plus custom shard letters "aisma", lowercase z. Files and usage rules in [`brand/`](../brand/README.md).
- **Metal only on dark.** One-color black/white elsewhere; a small-size Z for 32 px and below; tri-color for special editions.
