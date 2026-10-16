# Roadmap

The live plan of what gets built, in what order. `docs/DECISIONS.md` says *how* each thing works; this file says *when* and *where it stands*. Update it whenever work starts, lands or moves.

## Now

Nothing is lined up: Julius picks what's built next. Nothing for an AI to guess is done (Oct 16, 2026), so the codebase's names, errors and holds are what new code builds on, and every pull request checks them. Waiting on people: Gleb: register with NCMEC, Gleb: register the DMCA agent, Julius: send PhotoDNA the LLC's records.

## How to read this

- **Phases** run in order. Phase 1 is everything the public beta needs; nothing else blocks launch. After the beta, phases 3 to 6 can swap order if players or developers ask for something sooner.
- **Projects** group the items of one piece of work inside a phase. Each has a goal and a **Done when** line; a project is done when every row in it is done. Later phases are one list each until their work starts, then they get projects too.
- **Items** are one row each: a slice of work that lands on its own. Work that continues gets its next slice as a new row, never a longer note on an old one. Notes say what the item is, and for a done item when it went live; how it works is in `docs/DECISIONS.md` and the pull request.
- **Status:** `done`, `doing`, `next`, `planned`, `idea`. `next` is only for the items in Now above, in the order Now gives.
- **Must** items finish the phase. **Nice** items ship if they're ready and otherwise move to a later phase without holding anything up.
- **Julius** and **Gleb** mark things only that person does (money, accounts, sign-ups, legal filings). Gleb can sign for Zaisma LLC.
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

**Order of work.** Projects run side by side; within them, the **Needs** column says what has to land first, and Now at the top says what's being built next. The longest waits are outside our control (sign-ups for image matching and NCMEC), so the launch prerequisites start first. Everything meets at Launch content and reach: the seed games use everything, and the beta opens there.

### Launch prerequisites

**Goal:** the accounts, sign-ups and legal pieces the beta needs, mostly Julius's and Gleb's. **Done when:** every must row is done.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| done | Must | Julius: buy the game domain | | zaismausercontent.com, bought Oct 11, 2026 |
| done | Must | Serve each game on its own subdomain | Julius: buy the game domain | Live Oct 11, 2026: <slug>.zaismausercontent.com; workers.dev turned off |
| done | Must | Julius: form an LLC | | Zaisma LLC, registered in Wyoming (Oct 13, 2026). Liability protection before outside uploads; a registered agent keeps a home address off public records |
| done | Must | Julius: Workers Paid plan | | $5/month, live Oct 12, 2026; needed to run developers' game servers |
| done | Must | Julius: alert and DMCA email delivery | | Fastmail whitelisted zaisma.com (Oct 14, 2026). support@, dmca@, privacy@, safety@, pdna_account@ and julius@ forward to Julius's Fastmail through Cloudflare Email Routing; site alerts send from alerts@ |
| done | Must | Gleb: sign up for Arachnid Shield | | Done Oct 14, 2026: the main image matcher, since PhotoDNA was declined. Free known-abuse-image matching from the Canadian Centre for Child Protection. Guide: [Safety sign-ups for Gleb](https://claude.ai/artifact/8hCVQPJaRzBcMgLiY3xNNU). |
| done | Nice | Julius: turn on Cloudflare's CSAM Scanning Tool | | On for both domains (Oct 14, 2026); matches alert safety@zaisma.com. A backstop only: it sees content served through Cloudflare's cache, after it's live, and the games Worker serves files from R2 without the cache |
| next | Must | Gleb: register with NCMEC | | Free; how platforms report child sexual abuse material, which US law requires. Contact email safety@zaisma.com. Guide: [Safety sign-ups for Gleb](https://claude.ai/artifact/8hCVQPJaRzBcMgLiY3xNNU). |
| doing | Must | Gleb: register the DMCA agent | | Waiting on the company's Twilio phone number. $6 at copyright.gov as Zaisma LLC, agent email dmca@zaisma.com; then the agent details go on zaisma.com/dmca; renews every 3 years. Guide: [Safety sign-ups for Gleb](https://claude.ai/artifact/8hCVQPJaRzBcMgLiY3xNNU). |
| doing | Nice | Julius: send PhotoDNA the LLC's records | Julius: form an LLC | Sent Oct 13, 2026; waiting on Microsoft. Julius replied on the same thread (pdnasup@microsoft.com) with Zaisma LLC's legal name, its Wyoming registration link and the articles of organization. If no answer by Oct 20, follow up on that thread. Arachnid Shield covers the beta until then |
| planned | Must | Julius: Supabase Pro | | $25/month, switched on at launch; the free plan pauses |
| planned | Nice | Julius: Public Suffix List entry | | Needs 2+ years left on the registration and a `_psl` TXT record; the list may turn down projects without players, so apply after launch |

### Nothing for an AI to guess

**Goal:** every name, ID, input, error and next step an AI meets says what it is, inside and out ("Nothing for an AI to guess" in DECISIONS.md, rules in docs/NAMING.md). Each slice is a clean change: old names stop working. **Done when:** every row is done and `test/naming-baseline.json` is empty.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| done | Must | Names: games and versions | | Live Oct 15, 2026 (#133, migration 0030, CLI 0.2.0): games, versions, images, tester links, stats, reports and history, their columns, the dashboard, the API and MCP with an output schema on every tool, and the naming tests (`test/node/naming.test.ts` and its baseline) |
| done | Must | Names: the forum | | Live Oct 15, 2026 (#134, migration 0031, CLI 0.3.0): forum topics and posts with the API's column names, closed inputs, and the first feedback calls retired |
| done | Must | Errors: developer API and MCP | | Live Oct 15, 2026 (#135, CLI 0.3.1): every error answers `{ code, message, field, fix, retry_after_sec }` from one list of codes (`ERROR_CODES`, listed in docs/DEVELOPER-API.md); every change answers with `next_steps`; closed inputs and arguments everywhere; good and bad examples on the tools that are easy to get wrong |
| done | Must | IDs that say their kind | | Live Oct 15, 2026 (#138, migration 0032): every ID Zaisma makes says its kind (`version_…`, `topic_…`, `game_…`), existing IDs and the files named by them moved, and an ID of the wrong kind gets `wrong_id_kind`. Guests' player IDs move with Names: SDK and game server |
| done | Must | Names: SDK and game server | | Live Oct 15, 2026 (#139): the SDK, game server API, room lists and room messages (`type` and `data`) follow docs/NAMING.md, error codes are snake_case, guests' IDs are `player_…`, and unknown options and events are refused with the valid ones (a game server with one doesn't start and says why in its errors) |
| done | Must | canJoin refuses with refusalMessage | Names: SDK and game server | Live Oct 15, 2026 (#143, rooms deployed): a game server's `canJoin` answers `true` (or nothing), `false` or `{ refusalMessage }`; any other answer, like a string, turns the player away and shows in the game server's errors at once |
| done | Must | Names: the admin MCP | | Live Oct 15, 2026 (#146, migration 0033): the admin MCP's tools, inputs and answers for reports, precedents and the forum queue follow docs/NAMING.md, with output schemas, closed inputs and coded errors (`ADMIN_ERROR_CODES`, listed in docs/ADMIN-MCP.md); precedents' columns moved with it |
| done | Must | Names: last sweep of the insides | | Live Oct 15, 2026 (#147, migration 0034): rooms, scans, reports and triage, accounts, saves, plays and the game server's insides follow docs/NAMING.md, with their columns and stored JSON; the naming baseline is empty |
| done | Must | Errors: holds and takedowns | Errors: developer API and MCP | Live Oct 16, 2026 (#148, migration 0035, CLI 0.3.2): every hold, rejection and takedown says why as a `review_reason` (a code from one list, a plain message, the content rule and a fix) on games, versions, images, scan findings and the history, the same in the dashboard, API, MCP and upload command. Bills get the same when Hosting billing ships |
| done | Must | Checks on every pull request | | Live Oct 16, 2026 (#149): tests and typecheck run by themselves on every pull request and push to main (`.github/workflows/check.yml`), so the naming, schema, error-code and ID checks hold without anyone remembering them; `npm run ship` stops when main's check failed |
| done | Must | SDK types | Names: SDK and game server | Live Oct 16, 2026 (#151): the SDK's one reference is its types (`packages/sdk/zaisma.d.ts`, served beside it as `_zaisma/v1.d.ts`): every call, option, event and error code. A test holds them to what the SDK takes and hands out, the example games type-check against them, and the naming check reads them and the packages' JavaScript |
| done | Must | SDK error codes | SDK types | Live Oct 16, 2026 (#152): every error the SDK throws has an `error.code` from `ErrorCode` in `zaisma.d.ts`, so a game's AI branches on codes instead of messages; a test holds every code to the list |

### Developer publishing

**Goal:** a developer publishes any web game from their AI tool, the terminal or the dashboard, and manages it after. **Done when:** every must row is done.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| done | Must | Developer accounts | | Any account owns games; API keys on the account page; one developer API for the MCP, upload command and dashboard (docs/DEVELOPER-API.md) |
| done | Must | Upload command | Developer accounts | File by file, up to 2 GB per game, only changed files. `npx @zaisma/cli` (source in packages/cli), files up to 500 MB |
| done | Must | Drafts and publishing | Upload command | Preview links, publish now or later, roll back; keep the live version plus the last 5. Unpublished drafts deleted after 30 days, unused files after a day |
| done | Must | Game visibility | Developer accounts | Draft, listed, unlisted or private; separate from review status. Unlisted is noindex and never in any shelf. Draft and private games open only through preview and tester links |
| done | Must | Tester links | Game visibility | Secret, named, revocable links (zaisma.com/t/…) that open the live version whatever the visibility; guests can use them and multiplayer works through them. Inviting specific accounts comes later |
| done | Must | Game details and device labels | Developer accounts | Labels, covers, square covers and screenshots on the game page, scanned and approved, with "Play anyway" on other devices |
| done | Must | Developer MCP | Drafts and publishing | Create, edit, upload, publish, roll back, scans, reports and stats at zaisma.com/mcp, signed in with an API key; small games upload through the MCP, bigger builds through the upload command |
| done | Must | Developer dashboard | Drafts and publishing | zaisma.com/dashboard on the same API as the MCP: games, folder upload in the browser, versions with preview, publish, publish later and roll back, details, visibility, images, reports, stats and history |
| done | Must | Support tools in the MCP | Developer MCP | "Why is my game held?": game history and scan findings in the MCP |
| planned | Must | Games for your device first | Game details and device labels | Shelves and lists show games for the player's device first |
| planned | Must | Logs in the MCP | Support tools in the MCP | A game's logs readable by the developer's AI, beside its history and findings |
| planned | Must | Scan only what changed; per-developer budgets | Upload command | A daily limit on AI-reviewed uploads per free account (higher with Pro), about 20 updates per game per day |
| planned | Must | `zaisma check` and automatic fixes | Upload command | Pulls in outside scripts, unpacks compressed builds |
| planned | Must | MCP sign-in without a key | Developer MCP | OAuth, so claude.ai and other apps that can't send a key can connect after the developer signs in. Developer MCP: Zaisma's own OAuth server (the one Sign in with Zaisma will use), with a consent page and connected apps listed beside API keys; an app signed in this way can't make API keys. Admin MCP: Cloudflare Access's managed OAuth, no code (Julius: turn on Managed OAuth on the admin application in Zero Trust) |
| planned | Must | Webhooks for developers | Developer MCP, AI report triage | One signed event stream to an address the developer sets (bug reports, scans, publishes, room events, deleted accounts, later purchases), e.g. a GitHub issue for every bug report. Until then their AI checks for new bug reports with `cursor` |
| planned | Must | Scoped API keys | Developer accounts | Keys limited to one game, read-only or upload-only, for CI and collaborators |
| planned | Must | Export everything | Developer accounts, Game database | One command (and MCP tool) exports a game: files, versions, database, saves, stats, reports and updates |
| planned | Must | Registered links | Developer accounts | So developers can earn with their own payments from day one: links to their store, Patreon, Steam or Discord, opened by `Zaisma.links` with a leaving-Zaisma notice |

### Developer forum

**Goal:** developers and their AI report bugs, gaps and ideas and get answers from Zaisma and each other, in public unless it's private. **Done when:** every must row is done.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| done | Must | Feedback from developers' AI | Developer MCP, AI report triage | Live Oct 14, 2026: bugs, gaps, feature requests and questions filed by developers' AI (MCP, API, upload command) or by hand; threads, known issues with workarounds and the developers affected, AI sorting, blanked secrets, about 100 posts a day per account |
| done | Must | Developer forum | Feedback from developers' AI | Live Oct 14, 2026 (migrations 0026 to 0029) at zaisma.com/forum: every topic public, anything private a message to Zaisma, categories and tags, AI marks, replies, votes, answers, Helpful and Report, markdown, images, @mentions, known-issue phases, ranked search, misplaced flags and an AI check on every public post |
| planned | Must | Denser forum queue in admin | Developer forum | A denser admin queue for working through topics and messages |

### Multiplayer

**Goal:** players join rooms from a link and play together, on Zaisma's rooms or the developer's own servers. **Done when:** every must row is done.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| done | Must | Player passes | | Signed guest passes any server can check, published keys |
| done | Must | Game server API and relay | | Server-client by default; messages-only relay for simple games |
| done | Must | Rooms on rooms.zaisma.com | Player passes, Game server API and relay | Durable Objects with hibernation; limits, takedowns end rooms |
| done | Must | Games can reach our rooms and their own servers | Rooms on rooms.zaisma.com | Own servers set per game and listed on the game page |
| done | Must | Client SDK | Rooms on rooms.zaisma.com | `joinRoom`, invite links, reconnecting |
| done | Must | Room invite links | Client SDK | Tap a link, land in the match as a guest |
| done | Must | Game page controls | | Share, Full screen and a menu (about, Report) beside the game; invites live in the game via `Zaisma.invite` |
| done | Must | Two demo games | Room invite links | Real-time arena, turn-based four in a row |
| done | Must | Room browsing | Room invite links | Live Oct 12, 2026: a Rooms tab on each game's page, "playing now" under the title, and the same list for the game (`Zaisma.rooms.list`, `quickJoin`, `linked`); developers choose where rooms are listed |
| done | Must | Room names and labels | Room browsing | Live Oct 12, 2026: names and up to 4 labels, label filters, Zaisma's text filter on names typed by players, reportable names; `Zaisma.filterText` for games |
| done | Nice | Lobbies and matches | Room names and labels | Live Oct 12, 2026: data brought into a room (`joinRoom({ data })`) and a game server making a room for some of its players and moving them there (`room.reserve`) |
| done | Must | Kick and move players | Lobbies and matches | Live Oct 13, 2026: `room.kick` with keep out, `canJoin`, `room.moveTo` with `onMoved`, the SDK following moves, the host kicking in relay games and the next player becoming host |
| done | Must | Idle and away players | Kick and move players | Live Oct 14, 2026, built the honest-clients way: dead connections drop within a minute, "Still there?" after 10 minutes without input, hidden games go away in real-time rooms, seats held for 5 minutes (`holdFor`, `away`, `onAway`, `onBack`), and idle players don't count as playing |
| done | Must | Room connection limits | | Live Oct 13, 2026: opening a room connection is limited per internet address (60 a minute) |
| done | Must | Room-count protection | Play-count protection | Live Oct 14, 2026: a player pass needs a key from Cloudflare's check on Play, up to 5 passes per key over 6 hours, so bots can't fill rooms or fake "playing now" |
| done | Must | Beta usage ceiling | Rooms on rooms.zaisma.com | Live Oct 13, 2026: until Hosting billing, each game's rooms stop at the free 1,000 player-hours a month; running matches finish and no new rooms open until the month resets. Julius approved Oct 13, 2026 |
| planned | Nice | Closest rooms by measurement | Idle and away players | The SDK measures its connection to the regions that have rooms and quick join prefers the fastest; the server's order by location stays for everyone else |
| planned | Nice | Find players across rooms | Kick and move players, Player safety in rooms | A small directory per game: the game server asks which room its players are in and messages another room, for friends lists, parties and join a friend. Blocks always apply; teens are findable only by friends by default. Moves to Phase 3 if not ready |
| planned | Nice | Own servers list their rooms | Room browsing | Rooms on a developer's own servers show in the same list: their server checks in with Zaisma every minute |
| planned | Nice | Drop-in Socket.IO and PeerJS | Client SDK | So existing multiplayer prototypes work with few changes |

### Game servers and data

**Goal:** a game's own server code and data run on Zaisma with full access for the developer, and the same code runs on their own server. **Done when:** every must row is done.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| done | Must | Run a game server yourself | Game server API and relay, Player passes | Node runner; same code as our rooms |
| done | Must | Developers' own game servers run safely | Upload command, Rooms on rooms.zaisma.com, Julius: Workers Paid plan | Live Oct 13, 2026: a `zaisma-server/` folder or one `zaisma-server.js` runs on our rooms in a Dynamic Worker with no internet, never served to players; a match stopped twice ends; developers see its errors with the line |
| planned | Must | Game database | Rooms on rooms.zaisma.com | A real database per game, part of its hosting: tables and queries from its game servers, full access for the developer and their AI (query, change tables, fix data, import and export). The same calls use a local file on the developer's own server. Free up to a limit per game, then priced with a margin like rooms (Julius approved in principle Oct 13, 2026; the limits come to him with the numbers) |
| planned | Must | Game server endpoints and schedules | Developers' own game servers run safely | Plain requests to the game's server code (leaderboards, a shop, daily rewards) and schedules (daily resets, persistent worlds), with the game database behind it; the same code runs on the developer's own server |
| planned | Must | Game server reach and secrets | Developers' own game servers run safely | Game servers can call the developer's own listed servers and payment providers, with secrets set per game and never shown again. Still nothing of ours inside |

### Accounts and saves

**Goal:** players keep their progress and identity across games and devices, with as little as possible about them stored. **Done when:** every must row is done.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| done | Must | Sign-in | | Emailed code, no passwords. Supabase holds only the email; names and age bands live with the games. Delete account is instant |
| done | Must | Age question | Sign-in | Asked before the email, so we collect nothing from under-13s. Only the age band is kept; no ID checks |
| done | Must | Games have owners | Sign-in | A person now, a team later |
| done | Must | Cloud saves | Sign-in, Client SDK | Mirrors the game's own browser saves (localStorage and IndexedDB), no code needed; the player chooses when two devices disagree |
| done | Must | "Keep your progress" | Cloud saves | Turns a guest into an account after 5 minutes of play with progress, without a reload |
| done | Must | Save history | Cloud saves | Up to 5 earlier versions per game; players go back from their account or the game menu |
| done | Must | Passkeys | Sign-in | Face ID or fingerprint to sign back in, checked on our server; the email code stays for new accounts and lost devices |
| done | Nice | Google and Discord sign-in | Sign-in, Age question | Through Supabase, with the age question still first for new accounts |
| planned | Must | Zaisma accounts in games | Sign-in, Player passes | One ID everywhere. Passes become proof only (the ID, the game, when it expires). A public profile lookup any game or server can call. Games choose guests, accounts only or a mix; the game page says "Needs a Zaisma account" before Play when the whole game does. Ships with Sign in with Zaisma: one OAuth server for developers' own sites, games with their own accounts and the MCP. Site copy that says every game plays as a guest changes when this ships |
| planned | Must | Social modes and age bands | Age question | Three age bands (13–15, 16–17, 18+); every account has a social mode (solo-focused, friends-focused, open and social). 13–15 start solo-focused and can switch only to friends-focused; open and social stays within the same band group. The pass carries an opaque chat group and friends, never the age; `canChat(a, b)` for developers' servers |
| planned | Must | Saves through the API | Cloud saves, Developer accounts | Developers read, fix and export their game's saves by player ID (API and MCP); every developer change keeps a history copy first. Saves and the game database stay separate |
| planned | Must | Save screens games can take over | Cloud saves, "Keep your progress" | The conflict chooser and the "Keep your progress" card stay the default; SDK games handle conflicts themselves (`Zaisma.saves.onConflict`) and offer an account when they like (`Zaisma.player.offerAccount()`) |
| planned | Must | Account deletion reaches developers | Webhooks for developers, Game database | An "account deleted" webhook to every game the player used, with a one-call helper to erase that player in the game database |

### Safety and moderation

**Goal:** players stay safe in every game and room, and Zaisma acts on reports quickly and consistently. **Done when:** every must row is done.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| done | Must | Connect image matching | Gleb: sign up for Arachnid Shield | Live Oct 14, 2026: every picture and video in an upload (by name, by its first bytes, or as base64 in code), plus covers and screenshots, matched with Arachnid Shield before publishing; a match holds the version, keeps every file and sends an urgent alert; a daily job matches versions that passed before |
| planned | Must | Report matches to NCMEC automatically | Connect image matching, Gleb: register with NCMEC | Until then Julius reports matches at report.cybertip.org. PhotoDNA joins the matching once the LLC's records go through |
| done | Must | Player safety in rooms | Client SDK | Mute, block and report a player; a ready-made panel games put in their own menu |
| done | Must | Report redesign | | Live Oct 12, 2026: a plate beside the running game; reports carry the version, room, reported player and an optional picture. No single report takes an established game offline |
| done | Must | AI report triage | Report redesign | Live Oct 12, 2026: reports sorted within minutes by severity, merged and summarized with a recommendation; bugs go to the developer by themselves. Child-safety reports are never sorted by AI |
| done | Must | Report precedents | AI report triage | Live Oct 12, 2026: triage follows rulings a person made; dismissals marked for the AI alone happen without a person, with spot-checks. Child safety is never automatic and takedowns always need a person |
| done | Must | Admin MCP | AI report triage | Live Oct 12, 2026 at zaisma.com/admin/mcp: reports, games and precedents in a Claude session, signed in through Cloudflare Access (docs/ADMIN-MCP.md) |
| planned | Must | No-slop cover and title checks | Game details and device labels | AI review checks covers; real screenshots on every game page. Fake rewards and brands the developer doesn't own hold the game; other slop keeps it off the shelves until the cover is fixed |
| planned | Must | Chat rules | | In the content rules and the AI review: chat only for accounts, through Zaisma's chat hosting or with `canChat` and the filter on a developer's own server. Until those ship (Phase 3), games offer preset phrases and emotes |

### Play stats

**Goal:** developers see who plays, from numbers that can't be faked. **Done when:** every must row is done.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| done | Must | Basic play stats | | Live Oct 13, 2026: plays, session length and players coming back, counted by the game page with no player IDs; in the dashboard, API and MCP |
| done | Must | Play-count protection | Basic play stats | Live Oct 13, 2026: Cloudflare's invisible check on Play, a ticket per play, a minute on screen; shelves skip cloud networks; spike alerts and a content rule against faking plays |
| planned | Nice | Stats export and game events | Basic play stats | Daily counts through the API to export, and games counting their own events (`Zaisma.track`, no player IDs) next to plays |

### Polish before outreach

**Goal:** the platform looks and feels finished. No outreach, no listings for other developers' games and no inviting developers until this is done: first impressions are hard to undo. **Done when:** Ready for outreach is done.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| done | Must | Design system | | Steel (docs/DESIGN.md): a console-style big-screen theme lit by the game on screen. Live on the home, game, dashboard and account pages; other pages move over as they're rebuilt |
| done | Must | Continue playing | | The games you played most recently, on the home page, sorted by recently played or updated, with an "Updated" badge |
| done | Must | Home page | Design system, Continue playing | The last-played stage with Play and Details, Continue playing, and Popular, Trending, New and All games shelves. Cards are the developer's cover alone; only Play starts a game |
| done | Must | Patch notes | | Version notes become patch notes in the game page's Updates tab |
| planned | Must | Game update posts | Patch notes | Developers post a title, a short text and an optional image (checked like covers) |
| planned | Must | Friends | Sign-in, Social modes and age bands | Friend list, invites, see what friends are playing and join them; by invitation in solo- and friends-focused modes; teen-safe defaults. Games get the same list (`Zaisma.friends`) |
| planned | Must | Friends on the home page | Home page, Friends | Friends first on the home page, above last played |
| planned | Must | Developer page | Design system | Publishing, the dashboard and docs in one place for game developers, off the home page |
| planned | Must | Browse games | Design system | A proper games page with covers and genres until Phase 4 discovery |
| planned | Must | Account pages | Design system, Passkeys | Sign-in, account, saves and sign-in methods, all polished |
| planned | Must | Game management | Design system, Developer dashboard | Upload, details, versions, visibility and stats that feel good to use |
| planned | Nice | Last-played picture | Continue playing | A snapshot of the game when you left, shown in Continue playing; only you see it |
| planned | Must | Ready for outreach | Design system, Home page, Friends on the home page, Browse games, Account pages, Game management | Julius decides; outreach and link-out listings start here |

### Launch content and reach

**Goal:** the beta opens with games worth playing and pages people find and share. **Done when:** Open the public beta is done.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| planned | Must | Search-friendly game pages | | |
| planned | Must | Share cards for every game and room link | Game details and device labels | Cover, title, "Play now" |
| planned | Must | Developer links on game pages | Developer accounts | Steam, itch.io, Discord, website, socials |
| planned | Must | Zaisma skill for every AI | Developer MCP, `zaisma check` and automatic fixes, Errors: holds and takedowns, Names: SDK and game server | Right before the beta opens and not earlier, so it doesn't go stale. Teaches the whole workflow to any AI: the MCP's prompts and resources (the SDK reference, docs/NAMING.md, the error codes), a skill in the open SKILL.md format installed with `npx @zaisma/cli`, `llms.txt` and troubleshooting pages by error code, and a Claude plugin with the MCP and the skill |
| planned | Must | At least 5 seed games | Zaisma skill for every AI, Two demo games | Made with Claude Code through our own publishing flow, different genres, multiplayer |
| planned | Nice | 10 seed games | At least 5 seed games | The target in `docs/PLAN.md` |
| planned | Must | Link-out listings | Ready for outreach | Games hosted elsewhere, credited and linked, marked "Plays on example.com", never embedded. Original games only, checked at listing and re-checked automatically. Added from admin with the developer's OK at first; later developers add and claim their own |
| planned | Nice | QR codes | | |
| planned | Must | Open the public beta | Connect image matching, Report matches to NCMEC automatically, Gleb: register the DMCA agent, Julius: form an LLC, Julius: alert and DMCA email delivery, Julius: Supabase Pro, At least 5 seed games | And every other must item above. Weekly releases and the weekly game jam start here |

## Phase 2: Earn

Goal: developers can make money within days of the beta.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| planned | Must | Julius: register Zaisma LLC in Florida | | Julius runs Zaisma from Florida, so the Wyoming LLC must also register there as a foreign LLC (Sunbiz, about $125, then a yearly report by May 1). Done before Zaisma takes money (Julius, Oct 13, 2026) |
| planned | Must | Zaisma buy sheet | | Cards, Apple Pay, Google Pay; saved card works in every game |
| planned | Must | Owned items and receipts | | On the account, in the player pass, signed receipts |
| planned | Must | Live purchases | | Exactly-once delivery to the game and game server |
| planned | Must | Purchase notifications for developers' servers | | Through webhooks. Also links purchases to games' own accounts |
| planned | Must | Purchase rules | | Honest labels, real prices, refund policies, no loot boxes |
| planned | Must | Hosting billing | | About 2x our Cloudflare cost; first 1,000 player-hours a month free per developer or team, no card needed. Above that, prepaid credit (about $10 minimum, optional automatic top-up): when it runs out, running matches finish but no new rooms open beyond the free tier; warnings at 20% and empty. Credit pays only for Zaisma services and is never paid out. Bills readable in the API and MCP, with plain reasons and error codes. Starts the month payments go live |
| planned | Must | AI support assistant | Errors: holds and takedowns | On zaisma.com for players and developers. Reads the same records (account, game status, scan report, receipts, saves, bills), answers from facts and takes safe actions (resend a code, re-run a scan, restore a save); hands judgment calls to a person |
| planned | Must | Appeals queue | AI report triage | Takedown and ban appeals with AI summaries and a recommendation; one-click decisions |
| planned | Must | Zaisma Pro | | About $10/month, only for what costs us more: custom domains (Cloudflare for SaaS, moved from Phase 6), more storage and seats, higher upload limit. Stats and scheduled releases stay free for everyone (Oct 14, 2026) |
| planned | Must | Promoted games | | Labeled front-page slots, no tracking, priced by traffic |
| planned | Must | Review deposits | | $5 / $25, refundable |
| planned | Nice | Donation page | | GitHub Sponsors / Open Collective; a bonus, not the plan |
| planned | Nice | Tips for developers | | |
| planned | Nice | Optional Bitcoin | | Lightning and on-chain, paid straight to developers' wallets |
| planned | Nice | Local payment methods | | PayPal where available, Pix, iDEAL |
| planned | Nice | Family controls and "Ask a parent to buy" | | Opt-in |

## Phase 3: Play together

Goal: playing with friends is effortless, wherever friends already hang out.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| planned | Must | Zaisma in Discord | | Rooms that work through Discord's proxy, so developers can ship their own Activity; plus one Zaisma Activity for every game, using Discord's voice |
| planned | Must | Game communities | | Like a Steam hub, switched on by the developer: developer updates, player posts (screenshots, clips, guides, questions) with comments. The developer picks their own moderators or points players to their Discord instead; posts readable through the API. Zaisma checks every post for safety before it shows |
| planned | Must | Mods and remixes shelf | | On each game's Community tab, with the credit chain |
| planned | Must | Profiles | | Games you play, achievements, mods and remixes you've made, your posts; private to friends for teens by default |
| planned | Must | Achievements | | Steam-style: the developer defines them (name, description, icon checked like covers), the game or game server unlocks them (`Zaisma.achievements`), they show on the profile and game page; full API. Zaisma never makes badges for games |
| planned | Must | Chat filter | | Catches contact details in any disguise, slurs and sexual content aimed at teens; leaves scores, coordinates and ordinary words alone. Rules in the browser first, a small AI model only for unclear messages; a blocked message isn't sent and the sender sees why. Always on for under-18 accounts. Upgrades `Zaisma.filterText` |
| planned | Must | Text chat in rooms | Social modes and age bands, Chat filter, Julius: online safety risk assessment | Chat hosting for games: messages ride the room's own connection (included in room hosting), delivered only to players their social modes allow; the game draws the chat and moderates it. Reports attach the last messages from the reporter's screen; Zaisma stores no chat |
| planned | Must | Voice chat in rooms | | Through Cloudflare's media server, so players never see each other's addresses; the same social-mode rules as text, only the loudest few speakers heard. Off by default per game, with a cost caution when switched on; a voice player-hour counts as 2. Voice reports attach the last 30 seconds the reporter heard |
| planned | Must | Julius: online safety risk assessment | | Written risk assessment and takedown process (UK Online Safety Act) for chat and public posts. Before text chat or communities open |
| planned | Nice | Install button | | Installable web app per game: icon, own window, offline |

## Phase 4: Discover

Goal: good games get found, ranked by quality rather than clicks, and developers get the rest of the marketing kit.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| planned | Must | Progress bar and front page | | Ranked by players coming back, playtime, real ratings, reports |
| planned | Must | "New and rising" shelf | | With its own quality bar |
| planned | Must | For you and today's queue | | Ranked from what you play by plain rules, not AI; each pick says why. A full-screen daily queue of 8 games, refresh for more |
| planned | Must | Ratings only from people who played | | Developers can reply, and read their ratings through the API |
| planned | Must | Search by genre and tags | | |
| planned | Must | Player lists and developer picks | | |
| planned | Must | Follow games and update notes | | Followers hear about new versions; developers post to their Discord or anywhere else through webhooks |
| planned | Must | Zaisma Plus | | About $5/month: badge, profile extras, new features first, early access to games whose developers opt in; half to developers by playtime |
| planned | Nice | Scout badge | | |
| planned | Nice | Copycat grouping | | Reposted templates count as one game |
| planned | Nice | Embeds for developers' sites | | |
| planned | Nice | Tools on the developer page | | Free, open-source developer tools (engines, asset pipelines, level editors, Claude Code skills, MCP servers). Browser tools go through the same upload, scan and hosting as games, marked as a tool; others link to their repository. Open source only, same content rules, no cut. Seeded with Zaisma's own skill, `zaisma check` and the SDK |
| planned | Nice | Tracked share links | | Counts per link, nothing about players |
| planned | Nice | Game assets through the API | | Covers, screenshots and details downloadable, so developers' own AI makes press kits and launch posts (replaces Zaisma-made press kits and drafted posts) |

## Phase 5: Create together

Goal: players and developers build on each other's games.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| planned | Must | Remixes | | Opt-in, automatic credit, remix chains; optional 12-month unlock for abandoned games |
| planned | Must | Teams | | Owner, publisher and developer roles |
| planned | Must | Mods | | SDK mod API: Zaisma hosts, scans and versions mods; the game lists and switches them on its own way (`Zaisma.mods`), a game-page listing optional; invite links carry mods |

## Phase 6: Grow

Goal: room for games that outgrow the defaults.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| planned | Nice | Bigger game servers | | Cloudflare Containers; check outbound data charges first |
| planned | Nice | One-command switch from Wavedash | | |
| planned | Nice | Subscriptions in the buy sheet | | |

## Parked ideas

Not planned; revisit only if there's a reason.

| Status | Item | Notes |
| --- | --- | --- |
| idea | Under-13 support | Its own project, with verified parental consent |
