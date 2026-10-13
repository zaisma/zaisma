# Roadmap

The live plan of what gets built, in what order. `docs/DECISIONS.md` says *how* each thing works; this file says *when* and *where it stands*. Update it whenever work starts, lands or moves.

**Now:** Phase 0 done. Phase 1 (Beta) next, starting with multiplayer.

## How to read this

- **Phases** run in order. Phase 1 is everything the public beta needs; nothing else blocks launch. After the beta, phases 3 to 6 can swap order if players or developers ask for something sooner.
- **Must** items finish the phase. **Nice** items ship if they're ready and otherwise move to a later phase without holding anything up.
- **Status:** `done`, `doing`, `next`, `planned`, `idea`.
- **Julius** marks things only Julius can do (money, accounts, sign-ups).
- **Needs** lists the items that must land first, by name, separated by commas (so item names never contain commas). Items without needs can start any time.
- **Weekly releases** start with the beta. Every phase after it ships in small pieces as each one is ready.

## Phase 0: Safe hosting (done)

Live on zaisma.com since Oct 11, 2026.

| Status | Item | Notes |
| --- | --- | --- |
| done | Upload a game (admin only) | Zip upload in admin |
| done | Scan before publishing | File checks, malware and phishing rules, AI review; image matching placeholder holds every game |
| done | Sandboxed game server | Separate game domain, strict CSP, no cookies |
| done | Directory and game pages | |
| done | Report button and takedowns | Reports store nothing about the reporter; audit log |
| done | First game: Shard Dodge | |

## Phase 1: Beta

Goal: open Zaisma to outside developers and players, with what both expect out of the box. **The beta bar:** a developer can publish any web game from their AI tool in one prompt, add multiplayer and saves, and see who plays; a player can tap a link, play on phone or computer, invite friends, keep progress and stay safe.

**Order of work.** Four tracks run side by side; within a track, the **Needs** column says what has to land first. The longest waits are outside our control (sign-ups for image matching and NCMEC), so Julius's track starts first. The build tracks meet at the end: developers' own game servers need multiplayer and publishing, and the seed games use everything.

### Launch prerequisites (Julius's track, start first)

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| done | Must | Julius: buy the game domain | | zaismausercontent.com, bought Oct 11, 2026 |
| done | Must | Serve each game on its own subdomain | Julius: buy the game domain | Live Oct 11, 2026: <slug>.zaismausercontent.com; workers.dev turned off |
| planned | Nice | Julius: reapply for PhotoDNA | Julius: form an LLC | Declined twice: Oct 12, 2026 (outlook.com address) and Oct 13, 2026 (didn't qualify as an established organization). Arachnid Shield takes its place for the beta; try again as the LLC once Zaisma has a track record |
| next | Must | Julius: sign up for Arachnid Shield | | Now the main image matcher, since PhotoDNA was declined: free known-abuse-image matching from the Canadian Centre for Child Protection (Project Arachnid), self-serve API key at projectarachnid.ca. Use a zaisma.com address. Paid fallbacks: Thorn's Safer, directly or through Hive (quote only) |
| next | Nice | Julius: turn on Cloudflare's CSAM Scanning Tool | | Free, one switch per domain (zaisma.com and zaismausercontent.com) plus an alert email. Only sees content served through Cloudflare's cache, after it's live, so it's a backstop, not the check before publishing. The games Worker serves files straight from R2 without the cache, so on zaismausercontent.com it would see almost nothing until images go through the cache |
| next | Must | Julius: register with NCMEC | | Free; how platforms report child sexual abuse material, which US law requires |
| next | Must | Julius: form an LLC | | Liability protection before outside uploads (we host their files); a registered agent keeps your home address off public records. Also lets us reapply for PhotoDNA as an established organization |
| next | Must | Julius: register the DMCA agent | | $6 at copyright.gov, then fill in the DMCA page |
| doing | Must | Alert and DMCA email delivery | | Fastmail limited mail from zaisma.com because the domain is new (their support, Oct 13, 2026: it lifts by itself within hours), so support@ forwards to iCloud for now; dmca@ and privacy@ next |
| planned | Must | Connect image matching | Julius: sign up for Arachnid Shield, Julius: register with NCMEC | Every image in an upload is checked before publishing with Arachnid Shield (PhotoDNA added later if approved); matches are held, reported to NCMEC within minutes and alerted to Julius. Until then every game waits for manual approval |
| done | Must | Julius: Workers Paid plan | | $5/month, live Oct 12, 2026; needed to run developers' game servers |
| planned | Must | Julius: Supabase Pro | | $25/month, switched on at launch; the free plan pauses |
| planned | Nice | Julius: Public Suffix List entry | | Needs 2+ years left on the registration and a `_psl` TXT record; the list may turn down projects without players, so apply after launch |

### Multiplayer (build track 1)

Detailed plan approved: guest passes, game server API, rooms, SDK, demos.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| done | Must | Player passes | | Signed guest passes any server can check, published keys |
| done | Must | Game server API and relay | | Server-client by default; messages-only relay for simple games |
| done | Must | Rooms on rooms.zaisma.com | Player passes, Game server API and relay | Durable Objects with hibernation; limits, takedowns end rooms |
| done | Must | Games can reach our rooms and their own servers | Rooms on rooms.zaisma.com | Own servers set per game and listed on the game page |
| done | Must | Client SDK | Rooms on rooms.zaisma.com | `joinRoom`, invite links, reconnecting |
| done | Must | Room invite links | Client SDK | Tap a link, land in the match as a guest |
| done | Must | Game page controls | | Share, Full screen and a menu (about, Report) beside the game; icons on phones, a side strip in landscape. Invites live in the game via `Zaisma.invite` |
| done | Must | Player safety in rooms | Client SDK | Mute, block and report a player; ready-made panel games put in their own menu |
| done | Must | Report redesign | | Live Oct 12, 2026: a plate beside the game (up from the bottom on phones) while it keeps running; games' player panels hand over to it; reports carry the version, room and reported player, and can include a picture of the game. No single report takes an established game offline: a brand-new game is hidden and a recent update goes back a version until a person looks. The ⋯ menu became a small drop-down |
| done | Must | AI report triage | Report redesign | Live Oct 12, 2026: every report is sorted within minutes by severity, merged with reports about the same problem and summarized with a recommendation. Bugs go to the developer by themselves; claims the game's files could show get them checked again once per version, and only a problem the code finds in the files can pause a game (never an established one). Child-safety reports are never sorted by AI. Decided in one click at /admin/reports; serious ones are emailed |
| done | Must | Report precedents | AI report triage | Live Oct 12, 2026: triage follows rulings a person made, and dismissals marked for the AI alone happen without a person (1 in 20 come back as spot-checks). New cases and challenges come with a drafted ruling, set or changed in the same click as the decision. 10 drafted from the content rules wait for Julius at /admin/precedents. Child safety is never automatic and takedowns always need a person |
| done | Must | Admin MCP | AI report triage | Live Oct 12, 2026 at zaisma.com/admin/mcp: reports, games and precedents in a Claude session, decided there. Signed in through Cloudflare Access with a service token (Julius: set one up, see docs/ADMIN-MCP.md). Child-safety reports can be read and decided, never with their pictures |
| done | Must | Run a game server yourself | Game server API and relay, Player passes | Node runner; same code as our rooms |
| done | Must | Two demo games | Room invite links | Real-time arena, turn-based four in a row |
| done | Must | Room browsing | Room invite links | Live Oct 12, 2026: a Rooms tab on each game's page (how full, the country flag, a region filter, a box for room codes; never who's in it), "playing now" under the title, and the same list for the game itself (`Zaisma.rooms.list`, `quickJoin`, `linked`). Developers list rooms on the page and in the game, only in the game, or nowhere; games hide single rooms and close a room once a match starts (players who were in it can come back) |
| done | Must | Room names and labels | Room browsing | Live Oct 12, 2026: names and up to 4 labels from the game or its players (a session name, a community map), with label filters on the game page and in `Zaisma.rooms.list`. Names typed by players show on zaisma.com only after Zaisma's text filter (no contact details, slurs or sexual words); named rooms can be reported, and the queue can hide a name. `Zaisma.filterText` for games. Wording approved Oct 12, 2026 |
| done | Nice | Lobbies and matches | Room names and labels | Live Oct 12, 2026: players bring data into a room (`joinRoom({ data })`, like the character they picked), and a game server makes a room for some of its players and moves them there with data the new room starts from (`room.reserve`), like a lobby starting a match. Only those players can join it, and it's ready before anyone hears its code. The Four in a Row example's "Find an opponent" uses it |
| planned | Nice | Own servers list their rooms | Room browsing | Rooms on a developer's own servers show in the same list: their server checks in with Zaisma every minute. For games that outgrow our rooms (more players, bigger servers), so moving off doesn't empty their Rooms tab |

### Accounts (build track 2)

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| done | Must | Sign-in | | Emailed code, no passwords. Supabase holds only the email; names and age bands live with the games. Delete account is instant |
| done | Must | Age question | Sign-in | Asked before the email, so we collect nothing from under-13s. Keep only the age band; no ID checks |
| done | Must | Games have owners | Sign-in | A person now, a team later; set in admin until developer accounts |
| done | Must | Cloud saves | Sign-in, Client SDK | Mirrors the game's own browser saves, no code needed: localStorage and IndexedDB, so Unity, Godot and localForage saves work. Stored in R2; the player chooses when two devices disagree. Developers can turn it off in the dashboard or MCP |
| done | Must | "Keep your progress" | Cloud saves | Turns a guest into an account. After 5 minutes of play with progress, a card offers an account; it opens in a new tab so the game keeps running, and the game's save goes to the new account without a reload. Recently played games come along too |
| done | Must | Save history | Cloud saves | Up to 5 earlier versions per game: one an hour while playing, plus one whenever progress is about to be replaced (the progress the player didn't pick, a save that shrinks to under half). Players go back from their account (Your saves) or the game menu |
| done | Must | Passkeys | Sign-in | Face ID or fingerprint to sign back in; the email code stays for new accounts and lost devices. Checked on our server (Supabase's own passkeys are still experimental); adding one needs a sign-in in the last 10 minutes |
| done | Nice | Google and Discord sign-in | Sign-in, Age question | Through Supabase. The age question still comes first for new accounts: someone new who skips it is forgotten and asked it before continuing. Buttons only show once a provider is switched on in Supabase |

### Developer publishing (build track 3)

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| done | Must | Developer accounts | Sign-in, Games have owners | Any account owns games; API keys on the account page; one developer API for the MCP, upload command and dashboard (docs/DEVELOPER-API.md) |
| done | Must | Upload command | Developer accounts | File by file, up to 2 GB per game, only changed files. `npx @zaisma/cli` (source in packages/cli), files up to 500 MB |
| planned | Must | Scan only what changed; per-developer budgets | Upload command | A daily limit on AI-reviewed uploads per free account (higher with Pro), about 20 updates per game per day |
| done | Must | Drafts and publishing | Upload command | Preview links, publish now or later, roll back; keep the live version plus the last 5. Unpublished drafts deleted after 30 days, unused files after a day |
| done | Must | Game visibility | Developer accounts | Draft, listed, unlisted or private; separate from review status. Unlisted is noindex and never in any shelf. Draft and private games open only through preview and tester links |
| done | Must | Tester links | Game visibility | Secret, named, revocable links (zaisma.com/t/…) that open the live version whatever the visibility; guests can use them and multiplayer works through them. Dashboard, MCP and API. Inviting specific accounts comes later |
| doing | Must | Game details and device labels | Developer accounts | Covers and screenshots, scanned; games for your device first, "Play anyway" for the rest. Labels, covers and screenshots show on the game page (approved by a person until image matching is connected), with "Play anyway" on other devices; sorting games for your device first is next |
| planned | Must | No-slop cover and title checks | Game details and device labels | AI review checks covers; real screenshots on every game page |
| planned | Must | No live chat or DMs between strangers rule | | In the content rules and the AI review; games may offer preset phrases and emotes |
| done | Must | Developer MCP | Drafts and publishing | Create, edit, upload, publish, roll back, scans, reports, stats at zaisma.com/mcp, signed in with an API key; small games upload through the MCP, bigger builds through the upload command |
| planned | Must | MCP sign-in without a key | Developer MCP | OAuth, so claude.ai and other apps that can't send a key can connect after the developer signs in |
| planned | Nice | Webhooks for developers | Developer MCP, AI report triage | Zaisma calls a web address the developer sets when something happens (a new bug report, a scan finished, a version published), signed so they can trust it; e.g. to open a GitHub issue for every bug report. Until then their AI checks for new bug reports with `since` |
| doing | Must | Support tools in the MCP | Developer MCP | "Why is my game held?", scan reports, logs, bills: developers' own AI answers their questions. Game history and scan findings are in; bills and logs next |
| planned | Must | Errors that explain themselves | | Every hold, takedown, bill and failed upload has a plain reason, a rule, a fix and an error code that links to docs |
| planned | Must | Docs for AI tools | | `llms.txt` and troubleshooting pages by error code, so any AI can answer questions about Zaisma |
| done | Must | Developer dashboard | Drafts and publishing | The same API as the MCP; keep it simple for the beta. zaisma.com/dashboard: your games, folder upload in the browser, versions with preview, publish, publish later and roll back, details, visibility, images, reports, stats and history |
| planned | Must | `zaisma check` and automatic fixes | Upload command | Pulls in outside scripts, unpacks compressed builds |
| planned | Must | Claude Code skill | Developer MCP, `zaisma check` and automatic fixes | Teaches the whole workflow |
| done | Must | Basic play stats | | Live Oct 13, 2026. Plays, session length, players coming back. Counted by the game page (no code in the game, no player IDs: only counts per game per day); in the dashboard, API and MCP |
| done | Must | Play-count protection | Basic play stats | Live Oct 13, 2026. Counted plays are the official numbers: Cloudflare's invisible check on Play, a ticket per play, a minute on screen; shelves skip cloud networks and cap any one provider; spike alerts and actions in admin; a content rule against faking plays. Before outreach |
| planned | Must | Room-count protection | Play-count protection | "Playing now", room lists and multiplayer stats count whoever is connected, so bots could fake a busy game or fill rooms so real players can't join. A player pass from Zaisma rooms needs a checked play ticket (a few passes per ticket, for rejoining), and "playing now" counts only those players. Games on their own servers hand out their own passes. Before other developers' multiplayer games go out, and before "playing now" feeds any ranking |
| done | Must | Developers' own game servers run safely | Upload command, Rooms on rooms.zaisma.com, Julius: Workers Paid plan | Live Oct 13, 2026. Developers set multiplayer to their own game server (dashboard, MCP or API) and upload a `zaisma-server/` folder (index.js plus the files it imports, no build step) or one bundled `zaisma-server.js`; it runs on our rooms in a Dynamic Worker with no internet and nothing of ours, never served to players. Cloudflare stops an endless loop only after about 2 seconds, so a match stopped twice ends. Developers see its errors (with the line), stopped loops and ended matches. Tested live: 20 ticks a second for minutes, about 14 ms round trips, under 1 ms of CPU a call (under $1 per 1,000 player-hours for a busy real-time game) |
| planned | Nice | Drop-in Socket.IO and PeerJS | Client SDK | So existing multiplayer prototypes work with few changes |

### Polish before outreach (build track 5)

The platform works but looks and feels rough. No outreach, no listings for other developers' games and no inviting developers until this is done: first impressions are hard to undo.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| doing | Must | Design system | | Steel, from the brand, now a full theme like a console's big-screen mode: the ground, gunmetal plates and chrome, lit by the game on screen (its art blurred behind every page, changing as you point at games). Live on the home, game, dashboard and account pages (docs/DESIGN.md); remaining pages move over as they are rebuilt |
| planned | Must | Friends | Sign-in | Friend list, invites, see what friends are playing and join them; requests only from people you've played with; teen-safe defaults. Moved up from Phase 3 to land with the home page |
| doing | Must | Home page | Design system, Friends, Continue playing, Game updates | Friends first, then last played, Continue playing, For you (once it exists), then Games for everyone: popular, trending, new. Live: the last-played stage with Play and Details, Continue playing, and Popular (most players this week), Trending (more players in the last 3 days than usual), New (first live in the last 60 days) and All games, each shelf once it has 2 games. Game cards are the developer's cover alone and open the game page; only Play starts a game. Developers can add a square cover that phones show instead (without one, the landscape cover shows whole). Friends and For you land with their own items |
| done | Must | Continue playing | | The games you played most recently, on the home page; sort by recently played or recently updated, with an "Updated" badge. On this device for guests, on your account when signed in |
| doing | Must | Game updates | | Developers post a title, a short text and an optional image (checked like covers); version notes become patch notes on the update's details page. Patch notes show in the game page's Updates tab; posts with a title and image next |
| planned | Must | Developer page | Design system | Publishing, the dashboard and docs in one place for game developers, off the home page |
| planned | Nice | Last-played picture | Continue playing | A snapshot of the game when you left, shown in Continue playing; only you see it |
| planned | Must | Browse games | Design system | A proper games page with covers and genres until Phase 4 discovery |
| planned | Must | Account pages | Design system, Passkeys | Sign-in, account, saves and sign-in methods (passkeys), all polished |
| planned | Must | Game management | Design system, Developer dashboard | Upload, details, versions, visibility and stats that feel good to use |
| planned | Must | Ready for outreach | Design system, Home page, Browse games, Account pages, Game management | Julius decides; outreach and link-out listings start here |

### Launch content and reach (build track 4)

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| planned | Must | Search-friendly game pages | | |
| planned | Must | Share cards for every game and room link | Game details and device labels | Cover, title, "Play now" |
| planned | Must | Developer links on game pages | Developer accounts | Steam, itch.io, Discord, website, socials |
| planned | Must | At least 5 seed games | Claude Code skill, Two demo games | Made with Claude Code through our own publishing flow, different genres, multiplayer |
| planned | Nice | 10 seed games | At least 5 seed games | The target in `docs/PLAN.md` |
| planned | Must | Link-out listings | Ready for outreach | Games hosted elsewhere, added from admin with the developer's OK: credited and linked, marked "Plays on example.com", never embedded. Original games only. Checked at listing and re-checked automatically. Developers can claim them once developer accounts exist |
| planned | Nice | QR codes | | |
| planned | Must | Open the public beta | Connect image matching, Julius: register the DMCA agent, Julius: form an LLC, Alert and DMCA email delivery, Julius: Supabase Pro, At least 5 seed games | And every other must item above. Weekly releases and the weekly game jam start here |

## Phase 2: Earn

Goal: developers can make money within days of the beta.

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| planned | Must | Zaisma buy sheet | Cards, Apple Pay, Google Pay; saved card works in every game |
| planned | Must | Owned items and receipts | On the account, in the player pass, signed receipts |
| planned | Must | Live purchases | Exactly-once delivery to the game and game server |
| planned | Must | Purchase notifications for developers' servers | Also links purchases to games' own accounts |
| planned | Must | Registered links | Developers' own payments and stores, with a leaving-Zaisma notice |
| planned | Must | Purchase rules | Honest labels, real prices, refund policies, no loot boxes |
| planned | Must | Hosting billing | About 2x our Cloudflare cost; first 1,000 player-hours a month free per developer or team, no card needed. Above that, prepaid credit (about $10 minimum, optional automatic top-up): when it runs out, running matches finish but no new rooms open beyond the free tier; warnings at 20% and empty. Credit pays only for Zaisma services and is never paid out. Starts the month payments go live |
| planned | Must | AI support assistant | Errors that explain themselves | On zaisma.com for players and developers. Reads the same records (account, game status, scan report, receipts, saves, bills), answers from facts and takes safe actions (resend a code, re-run a scan, restore a save); hands judgment calls to a person |
| planned | Must | Appeals queue | AI report triage | Takedown and ban appeals with AI summaries and a recommendation; one-click decisions |
| planned | Must | Zaisma Pro | About $10/month: deeper stats, custom domains, more storage and seats, priority review, higher upload limit, scheduled releases |
| planned | Must | Promoted games | Labeled front-page slots, no tracking, priced by traffic |
| planned | Must | Review deposits | $5 / $25, refundable |
| planned | Nice | Donation page | GitHub Sponsors / Open Collective; a bonus, not the plan |
| planned | Nice | Tips for developers | |
| planned | Nice | Optional Bitcoin | Lightning and on-chain, paid straight to developers' wallets |
| planned | Nice | Local payment methods | PayPal where available, Pix, iDEAL |
| planned | Nice | Family controls and "Ask a parent to buy" | Opt-in |

## Phase 3: Play together

Goal: playing with friends is effortless, wherever friends already hang out.

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| planned | Must | Zaisma in Discord | One Discord Activity for every game; our voice chat for now |
| planned | Must | Game communities | A Community tab per game: developer updates, player posts (screenshots, clips, guides, questions) with comments, every post checked by AI before it shows |
| planned | Must | Mods and remixes shelf | On each game's Community tab, with the credit chain |
| planned | Must | Profiles | Games you play, mods and remixes you've made, your posts; private to friends for teens by default |
| planned | Must | Julius: online safety risk assessment | Written risk assessment and takedown process for public posts (UK Online Safety Act) before communities open |
| planned | Nice | Sign in with Zaisma | For games with their own accounts |
| planned | Nice | Install button | Installable web app per game: icon, own window, offline |

## Phase 4: Discover

Goal: good games get found, ranked by quality rather than clicks, and developers get the rest of the marketing kit.

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| planned | Must | Progress bar and front page | Ranked by players coming back, playtime, real ratings, reports |
| planned | Must | "New and rising" shelf | With its own quality bar |
| planned | Must | For you and today's queue | Ranked from what you play by plain rules, not AI; each pick says why. A full-screen daily queue of 8 games, refresh for more |
| planned | Must | Ratings only from people who played | |
| planned | Must | Search by genre and tags | |
| planned | Must | Player lists and developer picks | |
| planned | Must | Follow games and update notes | Followers hear about new versions; posts to the developer's Discord |
| planned | Must | Zaisma Plus | About $5/month: badge, profile extras, new features first, early access to games whose developers opt in; half to developers by playtime |
| planned | Nice | Scout badge | |
| planned | Nice | Copycat grouping | Reposted templates count as one game |
| planned | Nice | Embeds for developers' sites | |
| planned | Nice | Tracked share links | Counts per link, nothing about players |
| planned | Nice | Press kits | |
| planned | Nice | AI-drafted launch posts | MCP tools; the developer approves before posting |

## Phase 5: Create together

Goal: players and developers build on each other's games.

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| planned | Must | Remixes | Opt-in, automatic credit, remix chains; optional 12-month unlock for abandoned games |
| planned | Must | Teams | Owner, publisher and developer roles |
| planned | Must | Mods | SDK mod API; scanned and versioned; invite links carry mods |
| planned | Nice | Tools tab | Free, open-source developer tools |

## Phase 6: Grow

Goal: room for games that outgrow the defaults.

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| planned | Nice | Bigger game servers | Cloudflare Containers; check outbound data charges first |
| planned | Nice | Custom game domains | Cloudflare for SaaS |
| planned | Nice | One-command switch from Wavedash | |
| planned | Nice | Subscriptions in the buy sheet | |

## Parked ideas

Not planned; revisit only if there's a reason.

| Status | Item | Notes |
| --- | --- | --- |
| idea | Under-13 support | Its own project, with verified parental consent |
