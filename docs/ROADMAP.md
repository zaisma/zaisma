# Roadmap

The live plan of what gets built, in what order. `docs/DECISIONS.md` says *how* each thing works; this file says *when* and *where it stands*. Update it whenever work starts, lands or moves.

## Now

Who a player is came first, and that chain is live (Julius, Oct 16, 2026). Nothing else changes a shape every later item builds on, so First is empty and the rest goes side by side: first the shapes other work builds on or that cost more once games rely on them (social settings for friends and profiles, usernames for every page that shows a name, saves without Zaisma screens for the SDK, game server reach for webhooks to the game server), then the dashboard sections and developer home the dashboard work waits on (Julius, Oct 17, 2026).

**First:** nothing.

**Next:**

1. Game server reach and secrets (Game servers)
2. Game dashboard sections (Developer dashboard)
3. Developer home (Developer dashboard)

## Phases

Phases are milestones on one timeline, each named for the goal that finishes it: Phase 0 is reached before Phase 1, Phase 1 before Phase 2. Every slice says which phase it counts toward, and slices move between phases freely.

### Phase 0: Alpha

**Goal:** Zaisma hosts games safely: uploads (admin only), scans before publishing, a sandboxed game domain, game pages, reports and takedowns.

**Reached:** Oct 11, 2026, live on zaisma.com.

### Phase 1: Beta

**Goal:** open Zaisma to outside developers and players, with what both expect out of the box. **The beta bar:** a developer can publish any web game from their AI tool in one prompt, add multiplayer and saves, and see who plays; a player can tap a link, play on phone or computer, invite friends, keep progress and stay safe.

**Gates:** Ready for outreach.

Ready for outreach comes first: no outreach, no listings for other developers' games and no inviting developers until it's done, because first impressions are hard to undo. The longest waits are outside our control (sign-ups for image matching and NCMEC), so those start early. Everything meets at Open the public beta: the seed games use everything, and the beta opens there.

### Phase 2: 1.0

**Goal:** Zaisma leaves the beta: developers earn from their games within days of the beta opening, and Zaisma pays its own way from hosting and optional plans.

### Later

Not a phase: slices that aren't on the timeline yet. A slice gets a phase when it's picked for one; until then its Must or Nice is a first guess.

## How to read this

- **Phases** are milestones in order (above). A phase is reached when every must slice in it is done and settled and its goal holds. Weekly releases start with the beta, and everything after it ships in small pieces as each one is ready.
- **Groups** (`##`) hold **areas** (`###`). An area is one part of Zaisma, with a goal, and it holds its slices from every phase, so it's never "done". An area can be empty until we build something there; new work goes into the area it serves, a new area gets a goal line, and an area that grows past 30 slices splits in two.
- **Slices** are one row each: a piece of work that lands on its own. Work that continues gets its next slice as a new row, never a longer note on an old one. Notes say what the slice is and, once it's done, when it went live, like `Live Oct 16, 2026 (#167, migration 0040)`; how it works is in `docs/DECISIONS.md` and the pull request.
- **Phase** says which milestone a slice counts toward: Alpha, Beta, 1.0, or Later.
- **Status:** `done`, `doing`, `next`, `planned`, `idea`. `next` is only for the slices in Now, in Now's order, and for a slice of Julius's or Gleb's that's up next for them. `doing` means someone has started it; for a slice in Now it's set on main when its session starts, so the roadmap page shows it as being built. Julius's and Gleb's slices that are `next` or `doing` show on the page under Waiting on people.
- **Settled** `yes` means Julius and Claude have talked the slice through (what it is, its design and its scope) and Julius said it's settled. Only his word sets it. A settled slice is ready to build, and its pull request merges and ships without him, except for a preview he still looks at. A slice that isn't settled gets talked through in its own session first, and then that session builds it. Settled is apart from status: a `done` slice that isn't settled was built without that talk, and it isn't checked off until Julius settles it. Slices only Julius or Gleb do have nothing to settle.
- **Must** slices finish their phase. **Nice** slices ship if they're ready and otherwise move to a later phase without holding anything up.
- **Julius** and **Gleb** mark slices only that person does (money, accounts, sign-ups, legal filings). Gleb can sign for Zaisma LLC.
- **Needs** lists the slices that must land first, by name, separated by commas (so slice names never contain commas). Slices without needs can start any time.
- **First** in Now lists the slices that go before every other slice: others build on their shape, or they get dearer the longer they wait. Nothing else starts until they land. **Next** in Now is the order for the rest, and those slices can be built side by side in their own sessions. Places in Now count straight through both.
- **First** under an area's goal names the slice that goes before every other slice in that area (an area-wide Need). The line goes when that slice is done.
- **Gates** under a phase name slices that mark a point on the way to it, like Ready for outreach. The roadmap page shows how far each one is.

## Publishing

Getting a game live and keeping it right.

### Uploads and scans

**Goal:** any web game's files get in quickly, from an AI, a terminal or the browser, and are checked before anyone plays them.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Alpha | Must | yes | Upload a game (admin only) | | Zip upload in admin |
| done | Alpha | Must | yes | Scan before publishing | | File checks, malware and phishing rules, AI review; image matching placeholder holds every game |
| done | Beta | Must | yes | Upload command | Developer accounts | File by file, up to 2 GB per game, only changed files. `npx @zaisma/cli` (source in packages/cli), files up to 500 MB |
| planned | Beta | Must | | Scan only what changed; per-developer budgets | Upload command | A daily limit on AI-reviewed uploads per free account (higher with Pro), about 20 updates per game per day |
| planned | Beta | Must | | `zaisma check` and automatic fixes | Upload command | Pulls in outside scripts, unpacks compressed builds |
| planned | Beta | Must | yes | Uploads only for people Julius adds | Developer accounts | Until the beta only Julius, Gleb and accounts Julius adds make games; everyone else still signs in and plays, and Your games says publishing opens with the beta (Julius, Oct 16, 2026) |
| planned | Later | Nice | | One-command switch from Wavedash | | |

### Versions and releases

**Goal:** developers choose which version players get and when, roll back in a click, and tell players what changed.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Drafts and publishing | Upload command | Preview links, publish now or later, roll back; keep the live version plus the last 5. Unpublished drafts deleted after 30 days, unused files after a day |
| done | Beta | Must | yes | Patch notes | | Version notes become patch notes in the game page's Updates tab |
| planned | Beta | Must | | Game update posts | Patch notes | Developers post a title, a short text and an optional image (checked like covers) |
| planned | Beta | Must | | Export everything | Developer accounts, Game database import and export | One command (and MCP tool) exports a game: files, versions, database, saves, stats, reports and updates |

### Who can play

**Goal:** developers decide who gets into their game: everyone, only people with the link, testers, accounts only, or more.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Game visibility | Developer accounts | Draft, listed, unlisted or private; separate from review status. Unlisted is noindex and never in any shelf. Draft and private games open only through preview and tester links |
| done | Beta | Must | yes | Tester links | Game visibility | Secret, named, revocable links (zaisma.com/t/…) that open the live version whatever the visibility; guests can use them and multiplayer works through them. Inviting specific accounts comes later |
| planned | Beta | Must | yes | Private means you and your testers | Game visibility | The dashboard's "Only me" label for private games says that testers can play too |
| done | Beta | Must | yes | Accounts-only games | Account passes | Live Oct 16, 2026 (#160, migration 0037): a game setting (account_requirement) for guests welcome, accounts for multiplayer or accounts for the whole game, in the API, MCP and dashboard; guests of such a game get no player passes; the game page says "Needs a Zaisma account" before Play and asks guests to sign in; site copy no longer says every game plays as a guest |
| planned | Beta | Must | | Accounts-only rooms | Accounts-only games | One room takes only accounts, set from the SDK or the game server, on Zaisma rooms and the developer's own server |
| planned | Later | Nice | | Account levels games can require | Accounts-only games, Protect your account | A game asks for more than an account before Play or at a step, like a serious MMO slowing down banned players' new accounts: built only from what Zaisma already knows (account age, a passkey or an email, time played, no Zaisma ban), never IDs or phone numbers; levels of `account_requirement` or yes/no facts in the pass (Julius, Oct 17, 2026) |
| planned | Later | Nice | | Minimum age band per game | Social modes and age bands, Accounts-only games | The developer keeps a game from younger bands even when its content suits everyone; Zaisma enforces it like `account_requirement` and games never learn the band. Content above the shared floor, blocked for some bands, is a decision of its own (Julius, Oct 17, 2026) |

### Game pages

**Goal:** each game's page shows what it is and what it needs, and every link to it shares well.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Alpha | Must | yes | Directory and game pages | | |
| done | Beta | Must | yes | Game details and device labels | Developer accounts | Labels, covers, square covers and screenshots on the game page, scanned and approved, with "Play anyway" on other devices |
| planned | Beta | Must | yes | Device notes and required screenshots | Game details and device labels | Controls and screen orientation show on the game page only as a note when they don't fit ("Needs a keyboard", "Best in landscape"), not as icons; a game is listed only with at least one screenshot |
| planned | Beta | Must | | Developer links on game pages | Registered links | Steam, itch.io, Discord, website, socials: the registered links marked for the game page |
| done | Beta | Must | yes | Game page controls | | Share, Full screen and a menu (about, Report) beside the game; invites live in the game via `Zaisma.invite` |
| planned | Beta | Must | | Share cards for every game and room link | Game details and device labels | Cover, title, "Play now" |
| planned | Beta | Must | | Search-friendly game pages | | |
| planned | Beta | Nice | | QR codes | | |
| planned | Later | Nice | | Embeds for developers' sites | | |

### Developer dashboard

**Goal:** the dashboard shows and does everything the API does, laid out for each game.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Developer dashboard | Drafts and publishing | zaisma.com/dashboard on the same API as the MCP: games, folder upload in the browser, versions with preview, publish, publish later and roll back, details, visibility, images, reports, stats and history |
| next | Beta | Must | yes | Developer home | Design system, Developer dashboard | zaisma.com/dashboard: your games as cards with status and alerts, make a game, and a link to developer settings (Julius, Oct 16, 2026) |
| next | Beta | Must | yes | Game dashboard sections | Design system, Developer dashboard | Each game's dashboard split into sections with a fixed layout each: Overview (status, alerts, upload, live version, plays, recent history), Versions (with tester links), Details (with images), Players and stats, Database; title and who can play on every section; tabs on phones (Julius, Oct 16, 2026) |
| planned | Beta | Must | yes | Custom game dashboard | Game dashboard sections | Each developer reorders, hides and shows a game's sections, per game; Overview stays first and always shows alerts (Julius, Oct 16, 2026) |
| planned | Beta | Must | yes | Developer settings | Developer home, Webhooks for developers | A page of its own, linked from the developer home, for what applies across all games: webhooks as a simple list (address, events, last delivery; add, send a test, delete) and a link to API keys on the account page; sign-in apps, hosting credit and teams join it (Julius, Oct 16, 2026) |
| planned | Beta | Must | yes | Sign-in apps in the dashboard | Sign in with Zaisma, Developer settings | A simple list of sign-in apps on the developer settings page (name, redirect addresses; make one, replace its secret, delete), on the same API |

### Teams

**Goal:** a game can belong to a team with roles, not only to one person.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Games have owners | Sign-in | A person now, a team later |
| planned | Later | Must | | Teams | | Owner, publisher and developer roles |

## Developer tools

How developers and their AI work with Zaisma.

### API and MCP

**Goal:** everything a developer can see or do, their AI can too, through one API and the MCP.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Developer accounts | | Any account owns games; API keys on the account page; one developer API for the MCP, upload command and dashboard (docs/DEVELOPER-API.md) |
| done | Beta | Must | yes | Developer MCP | Drafts and publishing | Create, edit, upload, publish, roll back, scans, reports and stats at zaisma.com/mcp, signed in with an API key; small games upload through the MCP, bigger builds through the upload command |
| done | Beta | Must | yes | Support tools in the MCP | Developer MCP | "Why is my game held?": game history and scan findings in the MCP |
| planned | Beta | Must | | Logs in the MCP | Support tools in the MCP | A game's logs readable by the developer's AI, beside its history and findings |
| planned | Beta | Must | | MCP sign-in without a key | Developer MCP | OAuth, so claude.ai and other apps that can't send a key can connect after the developer signs in. Developer MCP: Zaisma's own OAuth server (the one Sign in with Zaisma will use), with a consent page and connected apps listed beside API keys; an app signed in this way can't make API keys. Admin MCP: Cloudflare Access's managed OAuth, no code (Julius: turn on Managed OAuth on the admin application in Zero Trust) |
| done | Beta | Must | yes | Scoped API keys | Developer accounts | Live Oct 17, 2026 (#198, migration 0045): keys limited to some games and to a level (read, upload, publish, full) or custom per-area access, for CI and collaborators; read and upload keys can't post on the forum. Made only on the account page (Julius, Oct 16, 2026) |
| planned | Later | Nice | | Game assets through the API | | Covers, screenshots and details downloadable, so developers' own AI makes press kits and launch posts (replaces Zaisma-made press kits and drafted posts) |

### Nothing for an AI to guess

**Goal:** every name, ID, input, error and next step an AI meets says what it is, inside and out ("Nothing for an AI to guess" in DECISIONS.md, rules in docs/NAMING.md). The naming baseline has been empty since Oct 15, 2026; new names follow the rules, and `test/node/naming.test.ts` checks them.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Names: games and versions | | Live Oct 15, 2026 (#133, migration 0030, CLI 0.2.0): games, versions, images, tester links, stats, reports and history, their columns, the dashboard, the API and MCP with an output schema on every tool, and the naming tests (`test/node/naming.test.ts` and its baseline) |
| done | Beta | Must | yes | Names: the forum | | Live Oct 15, 2026 (#134, migration 0031, CLI 0.3.0): forum topics and posts with the API's column names, closed inputs, and the first feedback calls retired |
| done | Beta | Must | yes | Errors: developer API and MCP | | Live Oct 15, 2026 (#135, CLI 0.3.1): every error answers `{ code, message, field, fix, retry_after_sec }` from one list of codes (`ERROR_CODES`, listed in docs/DEVELOPER-API.md); every change answers with `next_steps`; closed inputs and arguments everywhere; good and bad examples on the tools that are easy to get wrong |
| done | Beta | Must | yes | IDs that say their kind | | Live Oct 15, 2026 (#138, migration 0032): every ID Zaisma makes says its kind (`version_…`, `topic_…`, `game_…`), existing IDs and the files named by them moved, and an ID of the wrong kind gets `wrong_id_kind`. Guests' player IDs move with Names: SDK and game server |
| done | Beta | Must | yes | Names: last sweep of the insides | | Live Oct 15, 2026 (#147, migration 0034): rooms, scans, reports and triage, accounts, saves, plays and the game server's insides follow docs/NAMING.md, with their columns and stored JSON; the naming baseline is empty |
| done | Beta | Must | yes | Errors: holds and takedowns | Errors: developer API and MCP | Live Oct 16, 2026 (#148, migration 0035, CLI 0.3.2): every hold, rejection and takedown says why as a `review_reason` (a code from one list, a plain message, the content rule and a fix) on games, versions, images, scan findings and the history, the same in the dashboard, API, MCP and upload command. Bills get the same when Hosting billing ships |
| done | Beta | Must | yes | CLI closed flags and JSON output | | Live Oct 16, 2026 (#154, CLI 0.4.0): the upload command's outward side: `zaisma show` is `zaisma visibility`, each command refuses flags and choices it doesn't take, `--json` prints the API's answers and errors as-is, exit codes tell done, failed, a wrong command, held, rejected and still scanning apart, and `--scheduled-publish-at` takes only ISO times with a zone |
| done | Beta | Must | yes | API and MCP parity test | Checks on every pull request | Live Oct 16, 2026 (#155): a test holds every developer API call (`API_ROUTES`, the only calls the router answers) to an MCP tool that makes it, and every tool to a real call; the calls without a tool are named with why |

### SDK and engines

**Goal:** the SDK has one typed reference and coded errors, and games made with common engines and libraries work with few changes.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Names: SDK and game server | | Live Oct 15, 2026 (#139): the SDK, game server API, room lists and room messages (`type` and `data`) follow docs/NAMING.md, error codes are snake_case, guests' IDs are `player_…`, and unknown options and events are refused with the valid ones (a game server with one doesn't start and says why in its errors) |
| done | Beta | Must | yes | SDK types | Names: SDK and game server | Live Oct 16, 2026 (#151): the SDK's one reference is its types (`packages/sdk/zaisma.d.ts`, served beside it as `_zaisma/v1.d.ts`): every call, option, event and error code. A test holds them to what the SDK takes and hands out, the example games type-check against them, and the naming check reads them and the packages' JavaScript |
| done | Beta | Must | yes | SDK error codes | SDK types | Live Oct 16, 2026 (#152): every error the SDK throws has an `error.code` from `ErrorCode` in `zaisma.d.ts`, so a game's AI branches on codes instead of messages; a test holds every code to the list |
| planned | Beta | Nice | | Drop-in Socket.IO and PeerJS | Client SDK | So existing multiplayer prototypes work with few changes |

### Webhooks

**Goal:** Zaisma tells a developer's own systems what happened, as signed events.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Webhooks for developers | Developer MCP, AI report triage | Live Oct 16, 2026 (#167, migration 0040): signed events (Standard Webhooks) to addresses the developer sets through the API and MCP: bug reports, scans, the version players get, holds and takedowns, with retries and a delivery list. E.g. a GitHub issue for every bug report |
| planned | Beta | Must | | Room events in webhooks | Webhooks for developers | Game server errors, stopped loops and rooms that reach the month's free hours, sent to webhooks; rooms write them to D1 for the site to send |
| planned | Beta | Must | yes | Webhooks to the game server | Webhooks for developers, Game server reach and secrets | A webhook can point at the game's own game server on Zaisma, whose `onWebhook` turns events into a Discord post or a GitHub issue with the developer's own tokens, so developers with no server of their own get them too. The same code runs on their own server (Julius, Oct 16, 2026) |

### Docs and examples

**Goal:** developers and any AI learn the whole workflow from the docs, one skill and working example games.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| planned | Beta | Must | | Zaisma skill for every AI | Developer MCP, `zaisma check` and automatic fixes, Errors: holds and takedowns, Names: SDK and game server | Right before the beta opens and not earlier, so it doesn't go stale. Teaches the whole workflow to any AI: the MCP's prompts and resources (the SDK reference, docs/NAMING.md, the error codes), a skill in the open SKILL.md format installed with `npx @zaisma/cli`, `llms.txt` and troubleshooting pages by error code, and a Claude plugin with the MCP and the skill |
| planned | Beta | Must | | Developer page | Design system | Publishing, the dashboard and docs in one place for game developers, off the home page |
| done | Beta | Must | yes | Two demo games | Room invite links | Real-time arena, turn-based four in a row |
| planned | Beta | Must | yes | Demo games become developer examples | Two demo games, At least 5 seed games | When the seed games land, Arena and Four in a Row go unlisted and the developer page and docs link them as the real-time and turn-based multiplayer examples (Julius, Oct 16, 2026) |
| planned | Later | Nice | | Tools on the developer page | | Free, open-source developer tools (engines, asset pipelines, level editors, Claude Code skills, MCP servers). Browser tools go through the same upload, scan and hosting as games, marked as a tool; others link to their repository. Open source only, same content rules, no cut. Seeded with Zaisma's own skill, `zaisma check` and the SDK |

### Developer forum

**Goal:** developers and their AI report bugs, gaps and ideas and get answers from Zaisma and each other, in public unless it's private.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Feedback from developers' AI | Developer MCP, AI report triage | Live Oct 14, 2026: bugs, gaps, feature requests and questions filed by developers' AI (MCP, API, upload command) or by hand; threads, known issues with workarounds and the developers affected, AI sorting, blanked secrets, about 100 posts a day per account |
| done | Beta | Must | yes | Developer forum | Feedback from developers' AI | Live Oct 14, 2026 (migrations 0026 to 0029) at zaisma.com/forum: every topic public, anything private a message to Zaisma, categories and tags, AI marks, replies, votes, answers, Helpful and Report, markdown, images, @mentions, known-issue phases, ranked search, misplaced flags and an AI check on every public post |
| planned | Beta | Must | | Denser forum queue in admin | Developer forum | A denser admin queue for working through topics and messages |

## Game services

What a running game can use, on Zaisma and on its developer's own servers.

### Rooms

**Goal:** players join rooms and play together, on Zaisma's rooms or the developer's own servers, cheaply and fairly.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Player passes | | Signed guest passes any server can check, published keys |
| done | Beta | Must | yes | Game server API and relay | | Server-client by default; messages-only relay for simple games |
| done | Beta | Must | yes | Rooms on rooms.zaisma.com | Player passes, Game server API and relay | Durable Objects with hibernation; limits, takedowns end rooms |
| done | Beta | Must | yes | Games can reach our rooms and their own servers | Rooms on rooms.zaisma.com | Own servers set per game and listed on the game page |
| planned | Beta | Must | yes | Developers set their own servers | Games can reach our rooms and their own servers, Developer dashboard | Up to 5 per game from the dashboard, API, MCP and upload command, live at once and named on the game page; no approval by Zaisma (Julius, Oct 16, 2026) |
| done | Beta | Must | yes | Client SDK | Rooms on rooms.zaisma.com | `joinRoom`, invite links, reconnecting |
| done | Beta | Nice | yes | Lobbies and matches | Room names and labels | Live Oct 12, 2026: data brought into a room (`joinRoom({ data })`) and a game server making a room for some of its players and moving them there (`room.reserve`) |
| done | Beta | Must | yes | Kick and move players | Lobbies and matches | Live Oct 13, 2026: `room.kick` with keep out, `canJoin`, `room.moveTo` with `onMoved`, the SDK following moves, the host kicking in relay games and the next player becoming host |
| done | Beta | Must | yes | canJoin refuses with refusalMessage | Names: SDK and game server | Live Oct 15, 2026 (#143, rooms deployed): a game server's `canJoin` answers `true` (or nothing), `false` or `{ refusalMessage }`; any other answer, like a string, turns the player away and shows in the game server's errors at once |
| done | Beta | Must | yes | Idle and away players | Kick and move players | Live Oct 14, 2026, built the honest-clients way: dead connections drop within a minute, "Still there?" after 10 minutes without input, hidden games go away in real-time rooms, seats held for 5 minutes (`holdFor`, `away`, `onAway`, `onBack`), and idle players don't count as playing |
| done | Beta | Must | yes | Room connection limits | | Live Oct 13, 2026: opening a room connection is limited per internet address (60 a minute) |
| done | Beta | Must | yes | Room-count protection | Play-count protection | Live Oct 14, 2026: a player pass needs a key from Cloudflare's check on Play, up to 5 passes per key over 6 hours, so bots can't fill rooms or fake "playing now" |
| planned | Beta | Nice | | Closest rooms by measurement | Idle and away players | The SDK measures its connection to the regions that have rooms and quick join prefers the fastest; the server's order by location stays for everyone else |

### Room lists and invites

**Goal:** players find a room to join, or land in one from a link.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Room invite links | Client SDK | Tap a link, land in the match as a guest |
| done | Beta | Must | yes | Room browsing | Room invite links | Live Oct 12, 2026: a Rooms tab on each game's page, "playing now" under the title, and the same list for the game (`Zaisma.rooms.list`, `quickJoin`, `linked`); developers choose where rooms are listed |
| planned | Beta | Must | yes | Rooms tab copy for games that don't join you | Room browsing | "Press Play and the game finds you one" shows only for games that join players automatically |
| done | Beta | Must | yes | Room names and labels | Room browsing | Live Oct 12, 2026: names and up to 4 labels, label filters, Zaisma's text filter on names typed by players, reportable names; `Zaisma.filterText` for games |
| planned | Beta | Nice | | Find players across rooms | Kick and move players, Player safety in rooms | A small directory per game: the game server asks which room its players are in and messages another room, for friends lists, parties and join a friend. Blocks always apply; teens are findable only by friends by default. Moves to Phase 3 if not ready |
| planned | Beta | Nice | | Own servers list their rooms | Room browsing | Rooms on a developer's own servers show in the same list: their server checks in with Zaisma every minute |

### Game servers

**Goal:** a game's own server code runs on Zaisma with full access for the developer, and the same code runs on their own server.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Run a game server yourself | Game server API and relay, Player passes | Node runner; same code as our rooms |
| done | Beta | Must | yes | Developers' own game servers run safely | Upload command, Rooms on rooms.zaisma.com, Julius: Workers Paid plan | Live Oct 13, 2026: a `zaisma-server/` folder or one `zaisma-server.js` runs on our rooms in a Dynamic Worker with no internet, never served to players; a match stopped twice ends; developers see its errors with the line |
| done | Beta | Must | yes | Game server endpoints | Developers' own game servers run safely | Live Oct 16, 2026 (#169, migration 0041): the game server's `onRequest` answers `Zaisma.server.request` outside rooms (leaderboards, a shop, daily rewards), with the game database behind it, on Zaisma and in the Node runner. Free per game: 1 million requests a month (Julius, Oct 16, 2026) |
| done | Beta | Must | yes | Game server schedules | Game server endpoints | Live Oct 16, 2026 (#170, migration 0043): the game server's `schedules` (crons in UTC) run `onSchedule` outside rooms (daily resets, persistent worlds), on Zaisma and in the Node runner. Free per game: up to 10 schedules, each at most once a minute, with no monthly count (Julius, Oct 16, 2026) |
| next | Beta | Must | | Game server reach and secrets | Developers' own game servers run safely | Game servers can call the addresses the developer lists (their own servers, payment providers, Discord, GitHub), with secrets set per game and never shown again. Still nothing of ours inside |
| planned | Later | Nice | | Bigger game servers | | Cloudflare Containers; check outbound data charges first |

### Game database

**Goal:** each game has its own database that the developer fully controls, from game server code, the API and the dashboard.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Game database for game servers | Rooms on rooms.zaisma.com | Live Oct 16, 2026 (#163, no migration): a SQLite database per game as `room.database` (plain SQL and batches), in Zaisma rooms and as a local file on the developer's own server. Free per game: 500,000 rows written and 500 million read a month, 500 MB; until Hosting billing, past them writes stop and reads keep working (Julius, Oct 16, 2026) |
| done | Beta | Must | yes | Game database through the API | Game database for game servers | Live Oct 16, 2026 (#164, no migration, CLI 0.5.0): the developer and their AI run SQL, list tables and see use against the free limits, through the API, MCP (`get_database`, `query_database`, `batch_database`) and `zaisma database` |
| done | Beta | Must | yes | Game database import and export | Game database through the API | Live Oct 17, 2026 (#199, no migration): the whole database out and in as SQLite's SQL dump through the API, MCP and `zaisma database export` and `import` (a `.sqlite` file from the CLI) |
| planned | Beta | Must | yes | Game database console | Game database import and export | The dashboard's database page on the same API: one SQL box beside the tables, where clicking a table writes and runs its query; each table's SQL, export, import and the month's use; changes go through SQL, no cell editing (Julius, Oct 17, 2026) |
| planned | Beta | Must | yes | Game database restore to a time | Game database import and export | Roll a game's database back to any minute in the last 30 days, and undo that, through the API, MCP, CLI and the dashboard's console |

### Saves

**Goal:** progress follows a player across devices, and developers handle saves their own way when they want to.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Cloud saves | Sign-in, Client SDK | Mirrors the game's own browser saves (localStorage and IndexedDB), no code needed; the player chooses when two devices disagree |
| done | Beta | Must | yes | "Keep your progress" | Cloud saves | Turns a guest into an account after 5 minutes of play with progress, without a reload |
| done | Beta | Must | yes | Save history | Cloud saves | Up to 5 earlier versions per game; players go back from their account or the game menu |
| done | Beta | Must | yes | Saves through the API | Cloud saves, Developer accounts | Live Oct 17, 2026 (#200, migration 0044, CLI 0.7.0): developers list, read, change (some keys or the whole save) and reset their game's saves by player ID, and read and restore earlier versions (API and MCP); a change keeps a copy first and reloads an open game with no dialog. Saves and the game database stay separate |
| done | Beta | Must | yes | Saves without Zaisma screens | Cloud saves, Save history | Live Oct 17, 2026 (#207, migration 0046): no conflict chooser (the progress played most recently wins, the other kept as an earlier version), no restoring or list of copies on the account page or game menu; the "Keep your progress" card gets a game setting to turn it off |
| planned | Beta | Must | | Saves in the SDK | Saves without Zaisma screens, "Keep your progress" | `Zaisma.saves.onConflict`, `getHistory()` and `restore()` for games that want their own conflict or rollback screens, `Zaisma.saves.onDeveloperChange` for games that take a developer's change their own way (in place, with their own message or their own reload) instead of Zaisma's reload, and `Zaisma.player.offerAccount()` |

### In-game purchases

**Goal:** players buy in any game with one saved card, and the money goes to the developer with no cut.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| planned | Beta | Must | yes | Registered links | Developer accounts | So developers can earn with their own payments from day one: the game opens its registered links with `Zaisma.links.open` behind a "You're leaving Zaisma" card over the game; guests and under-18 accounts open only trusted store, payment and video domains, never chat apps (Julius, Oct 17, 2026) |
| planned | 1.0 | Must | | Zaisma buy sheet | | Cards, Apple Pay, Google Pay; saved card works in every game |
| planned | 1.0 | Must | | Owned items and receipts | | On the account, in the player pass, signed receipts |
| planned | 1.0 | Must | | Live purchases | | Exactly-once delivery to the game and game server |
| planned | 1.0 | Must | | Purchase notifications for developers' servers | | Through webhooks. Also links purchases to games' own accounts |
| planned | 1.0 | Must | | Purchase rules | | Honest labels, real prices, refund policies, no loot boxes |
| planned | 1.0 | Nice | | Local payment methods | | PayPal where available, Pix, iDEAL |
| planned | 1.0 | Nice | | Optional Bitcoin | | Lightning and on-chain, paid straight to developers' wallets |
| planned | 1.0 | Nice | | Family controls and "Ask a parent to buy" | | Opt-in |
| planned | 1.0 | Nice | | Tips for developers | | |
| planned | Later | Nice | | Subscriptions in the buy sheet | | |

### Play stats

**Goal:** developers see who plays, from numbers that can't be faked.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Basic play stats | | Live Oct 13, 2026: plays, session length and players coming back, counted by the game page with no player IDs; in the dashboard, API and MCP |
| done | Beta | Must | yes | Play-count protection | Basic play stats | Live Oct 13, 2026: Cloudflare's invisible check on Play, a ticket per play, a minute on screen; shelves skip cloud networks; spike alerts and a content rule against faking plays |
| planned | Beta | Nice | | Stats export and game events | Basic play stats | Daily counts through the API to export, and games counting their own events (`Zaisma.track`, no player IDs) next to plays |
| planned | Later | Nice | | Tracked share links | | Counts per link, nothing about players |

## Players

Who a player is, who they play with and how they find games.

### Sign-in

**Goal:** making an account and signing back in is quick and safe, and works without an email.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Sign-in | | Emailed code, no passwords (replaced by Usernames and passwords). Supabase holds only the email; names and age bands live with the games. Delete account is instant |
| done | Beta | Must | yes | Passkeys | Sign-in | Face ID or fingerprint to sign back in, checked on our server; the email code stays for new accounts and lost devices |
| done | Beta | Nice | yes | Google and Discord sign-in | Sign-in, Age question | Through Supabase, with the age question still first for new accounts |
| planned | Beta | Must | yes | Sign-in on auth.zaisma.com | Google and Discord sign-in, Julius: own sign-in address | Google and Discord send players through auth.zaisma.com instead of a supabase.co address: the site, Google and Discord switched to the new address. Before the public beta |
| done | Beta | Must | yes | Sign-in from games | Accounts-only games | Live Oct 16, 2026 (#166, no migration): `Zaisma.player.signIn()` asks a guest to sign in beside the game, in a new tab, and the game gets the account and its passes without a reload |
| done | Beta | Must | yes | Usernames and passwords | Sign-in, Age question | Live Oct 17, 2026 (#209, migration 0047): making an account takes a birthday, a public unique username and a password, nothing else; email becomes an optional way back in; Cloudflare's invisible bot check on sign-up |
| planned | Beta | Must | yes | Protect your account | Usernames and passwords, Passkeys | Once there's saved progress to lose, a one-time "Protect your account" offers a passkey or an email; required before cards or parent links |
| planned | Beta | Must | | Account pages | Design system, Passkeys, Friends | Sign-in, account, saves, sign-in methods, /friends and the friend invite page, all polished in full Steel |
| planned | Beta | Must | | Julius: Supabase Pro | | $25/month, switched on at launch; the free plan pauses |
| planned | Beta | Must | | Julius: own sign-in address | Julius: Supabase Pro | Supabase's custom domain add-on ($10/month) for auth.zaisma.com, its DNS record in Cloudflare, then Google's brand check (free, a few days) so Google shows "Zaisma" and our logo. Before the public beta, not before (Julius, Oct 16, 2026) |

### Ages and identity

**Goal:** one player ID in every game, with an age band and as little else stored as possible.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Age question | Sign-in | Asked before the email, so we collect nothing from under-13s. Only the age band is kept; no ID checks |
| done | Beta | Must | yes | Account passes | Sign-in, Player passes | Live Oct 16, 2026 (#159, migration 0036): one player ID per account, the same in every game; signed-in players get passes that are proof only (the ID, the game, when it expires), taken by Zaisma rooms and the Node game server; a public profile lookup by player ID at rooms.zaisma.com/v1/players, in the API, MCP and SDK |
| idea | Later | | | Under-13 support | | Its own project, with verified parental consent |

### Sign in with Zaisma

**Goal:** developers' own sites and games can use Zaisma accounts.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Sign in with Zaisma | Account passes | Live Oct 16, 2026 (#161, migration 0038): OpenID Connect on zaisma.com for developers' own sites and games with their own accounts, sign-in apps through the API and MCP, a one-time consent page and the account page's list. The MCP's sign-in uses it next (MCP sign-in without a key) |

### Social settings

**Goal:** players choose who can reach them, within limits set by their age.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Social modes and age bands | Age question | Live Oct 16, 2026 (#162, migration 0039): three age bands (13–15, 16–17, 18+) and a social mode on every account, chosen at signup from 16 and changed on the account page; 13–15 start solo-focused and can switch only to friends-focused. The pass carries the social mode and an opaque chat group, never the age; `canChat(a, b)` in the game server package |
| done | Beta | Must | yes | Social settings | Social modes and age bands | Live Oct 17, 2026 (#208, migrations 0048 and 0049): a Social section on the account page: separate settings for chat, joining, what I'm playing, what I've played, online and friend requests, with the social modes as presets plus Custom and hard age limits; the page says "Anyone", never band groups (Julius, Oct 17, 2026) |

### Friends

**Goal:** players see their friends and what they're playing, and join them in a tap.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Friends | Sign-in, Social modes and age bands | Live Oct 16, 2026 (#168, migration 0042): the friend list and invites on zaisma.com, a link or code for one friend, never a stranger pressing Add. Passes carry friends for `canChat` |
| planned | Beta | Must | yes | Friends playing now | Friends, Social settings | /friends game-first: a strip of online friends, Playing now as big covers with friends' faces and Join, Join greyed with the reason on hover when it won't work, and Appear offline; "Alex and Mia are playing" with Join on game pages (Julius, Oct 17, 2026) |
| planned | Beta | Must | yes | Your friends played | Friends playing now | On /friends: covers of the games friends played lately, newest first, with their faces and a rough time like "this week" (Julius, Oct 17, 2026) |
| planned | Beta | Must | | Friends in games | Friends playing now | `Zaisma.friends`: the player's friends with their names and who's in this game now, for in-game friend lists, joining a friend and room invites; a game on its own servers gives its room link so Join works there too |
| planned | Beta | Must | yes | Room invites | Friends playing now, Friends in games | Invite a friend to your room without a link, from the game's own friend picker or /friends: a card with the cover, who it's from and Join that waits until the room ends or about an hour, for friends who sign in late (Julius, Oct 17, 2026) |
| planned | Beta | Must | | Friend requests | Friends | Open-and-social accounts take friend requests from anyone, like people they played with |
| planned | Beta | Must | | Friends on the home page | Home page, Friends playing now | Friends first on the home page, above last played |
| planned | Beta | Must | yes | Blocks follow the account | Player safety in rooms, Friends | A block lasts until undone, in every game: a wall both ways in rooms, friends and invites; never keeps anyone out of a room, but `quickJoin` prefers rooms without them; the game learns of a block between two of its players; a Blocked list on the friends page |

### Profiles and achievements

**Goal:** a player's page shows their games and what they've done, as much as they choose.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| planned | Beta | Must | yes | Profiles | Social settings, Usernames and passwords | zaisma.com/@username: name, bio and links (outside links only on 18+ profiles) over covers: a developer's own games first, Playing now, then Played with rough times; mutual friends but never the friend list, Add friend, and a plain "Mia's profile is private." behind a new who-can-see-my-profile setting (Julius, Oct 17, 2026) |
| planned | Later | Must | | Profile extras | Profiles | Custom and game-art pictures, profile art and badges, and hours played if the owner chooses to show them; achievements, mods and remixes you've made and your posts show there as they land |
| planned | Later | Must | | Achievements | | Steam-style: the developer defines them (name, description, icon checked like covers), the game or game server unlocks them (`Zaisma.achievements`), they show on the profile and game page; full API. Zaisma never makes badges for games |

### Chat and voice

**Goal:** players talk in games safely, with rules by age and nothing stored by Zaisma.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| planned | Beta | Must | | Chat rules | | In the content rules and the AI review: chat only for accounts, through Zaisma's chat hosting or with `canChat` and the filter on a developer's own server. Until those ship (Phase 3), games offer preset phrases and emotes |
| planned | Later | Must | | Chat filter | | Catches contact details in any disguise, slurs and sexual content aimed at teens; leaves scores, coordinates and ordinary words alone. Rules in the browser first, a small AI model only for unclear messages; a blocked message isn't sent and the sender sees why. Always on for under-18 accounts. Upgrades `Zaisma.filterText` |
| planned | Later | Must | | Text chat in rooms | Social modes and age bands, Chat filter, Julius: online safety risk assessment | Chat hosting for games: messages ride the room's own connection (included in room hosting), delivered only to players their social modes allow; the game draws the chat and moderates it. Reports attach the last messages from the reporter's screen; Zaisma stores no chat |
| planned | Later | Must | | Voice chat in rooms | | Through Cloudflare's media server, so players never see each other's addresses; the same social-mode rules as text, only the loudest few speakers heard. Off by default per game, with a cost caution when switched on; a voice player-hour counts as 2. Voice reports attach the last 30 seconds the reporter heard |

### Communities

**Goal:** each game has a place for its players and developer, on Zaisma or where they already gather.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| planned | Later | Must | | Game communities | | Like a Steam hub, switched on by the developer: developer updates, player posts (screenshots, clips, guides, questions) with comments. The developer picks their own moderators or points players to their Discord instead; posts readable through the API. Zaisma checks every post for safety before it shows |
| planned | Later | Must | | Zaisma in Discord | | Rooms that work through Discord's proxy, so developers can ship their own Activity; plus one Zaisma Activity for every game, using Discord's voice |
| planned | Later | Must | | Follow games and update notes | | Followers hear about new versions; developers post to their Discord or anywhere else through webhooks |

### Notifications

**Goal:** players hear about what matters to them, like a friend's invite or a game's update, and nothing else.

Nothing planned yet.

### Home and browsing

**Goal:** the pages players land on look finished and get them playing fast.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | | Design system | | Steel (docs/DESIGN.md): a console-style big-screen theme lit by the game on screen. Live on the home, game, dashboard and account pages; other pages move over as they're rebuilt. Left unsettled on purpose: Steel is the look while Phase 1 is built, and it's revisited near the end of Phase 1, before the beta, so it reflects the turns Zaisma's identity takes until then (Julius, Oct 16, 2026). Sorts of done items skip it until then |
| done | Beta | Must | yes | Home page | Design system, Continue playing | The last-played stage with Play and Details, Continue playing, and Popular, Trending, New and All games shelves. Cards are the developer's cover alone; only Play starts a game |
| done | Beta | Must | yes | Continue playing | | The games you played most recently, on the home page, sorted by recently played or updated, with an "Updated" badge |
| planned | Beta | Must | | Browse games | Design system | A proper games page with covers and genres until Phase 4 discovery |
| planned | Beta | Nice | | Last-played picture | Continue playing | A snapshot of the game when you left, shown in Continue playing; only you see it |
| planned | Later | Nice | | Install button | | Installable web app per game: icon, own window, offline |

### Discovery

**Goal:** good games get found, ranked by quality rather than clicks.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| planned | Beta | Must | | Games for your device first | Game details and device labels | Shelves and lists show games for the player's device first |
| planned | Later | Must | | Progress bar and front page | | Ranked by players coming back, playtime, real ratings, reports |
| planned | Later | Must | | "New and rising" shelf | | With its own quality bar |
| planned | Later | Must | | For you and today's queue | | Ranked from what you play by plain rules, not AI; each pick says why. A full-screen daily queue of 8 games, refresh for more |
| planned | Later | Must | | Ratings only from people who played | | Developers can reply, and read their ratings through the API |
| planned | Later | Must | | Search by genre and tags | | |
| planned | Later | Must | | Player lists and developer picks | | |
| planned | Later | Nice | | Scout badge | | |
| planned | Later | Nice | | Copycat grouping | | Reposted templates count as one game |

### Remixes and mods

**Goal:** players and developers build on each other's games, with credit.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| planned | Later | Must | | Remixes | | Opt-in, automatic credit, remix chains; optional 12-month unlock for abandoned games |
| planned | Later | Must | | Mods | | SDK mod API: Zaisma hosts, scans and versions mods; the game lists and switches them on its own way (`Zaisma.mods`), a game-page listing optional; invite links carry mods |
| planned | Later | Must | | Mods and remixes shelf | | On each game's Community tab, with the credit chain |

### Languages and accessibility

**Goal:** players anywhere can use Zaisma in their language and however they play.

Nothing planned yet.

## Safety

Keeping players safe and Zaisma within the law.

### Game sandbox

**Goal:** game content never reaches zaisma.com, players' accounts or other games.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Alpha | Must | yes | Sandboxed game server | | Separate game domain, strict CSP, no cookies |
| done | Beta | Must | yes | Serve each game on its own subdomain | Julius: buy the game domain | Live Oct 11, 2026: <slug>.zaismausercontent.com; workers.dev turned off |
| done | Beta | Must | | Julius: buy the game domain | | zaismausercontent.com, bought Oct 11, 2026 |
| planned | Beta | Nice | | Julius: Public Suffix List entry | | Needs 2+ years left on the registration and a `_psl` TXT record; the list may turn down projects without players, so apply after launch |

### Child safety

**Goal:** known child abuse images are caught before anyone sees them, and reported as the law requires.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Connect image matching | Gleb: sign up for Arachnid Shield | Live Oct 14, 2026: every picture and video in an upload (by name, by its first bytes, or as base64 in code), plus covers and screenshots, matched with Arachnid Shield before publishing; a match holds the version, keeps every file and sends an urgent alert; a daily job matches versions that passed before |
| done | Beta | Must | yes | Add PhotoDNA to image matching | Connect image matching, Julius: send PhotoDNA the LLC's records | Live Oct 16, 2026 (#186, no migration): a second list next to Arachnid Shield, either one holds; pictures are hashed in the photodna Worker's container and only hashes go to Microsoft. The daily job backfills every version that passed before. **License: AI agents never open the SDK's `*.dll`, `*.so.*`, `*.nupkg`, `*.wasm` or `photoDnaEdgeHashS.js`, and AI tools used on it must have training turned off;** agents may read its language wrappers, samples and `PhotoDnaEdgeHashGenerator.md`. The SDK stays out of the public repo. Julius puts the API key in Cloudflare as `PHOTODNA_KEY` on zaisma-site |
| planned | Beta | Must | | Report matches to NCMEC automatically | Connect image matching, Gleb: register with NCMEC | Until then Julius reports matches at report.cybertip.org. Microsoft recommends reporting through NCMEC's own API rather than PhotoDNA's |
| done | Beta | Must | | Gleb: sign up for Arachnid Shield | | Done Oct 14, 2026: the main image matcher, since PhotoDNA was declined. Free known-abuse-image matching from the Canadian Centre for Child Protection. Guide: [Safety sign-ups for Gleb](https://claude.ai/artifact/8hCVQPJaRzBcMgLiY3xNNU). |
| done | Beta | Nice | | Julius: turn on Cloudflare's CSAM Scanning Tool | | On for both domains (Oct 14, 2026); matches alert safety@zaisma.com. A backstop only: it sees content served through Cloudflare's cache, after it's live, and the games Worker serves files from R2 without the cache |
| done | Beta | Nice | | Julius: send PhotoDNA the LLC's records | Julius: form an LLC | Approved Oct 16, 2026. Sign in to the PhotoDNA Cloud Service console as pdna_account@zaisma.com for the API key and the Edge Hash SDK |
| next | Beta | Must | | Gleb: register with NCMEC | | Free; how platforms report child sexual abuse material, which US law requires. Register at esp.ncmec.org/registration (questions: ESPteam@ncmec.org) with safety@zaisma.com. Guide: [Safety sign-ups for Gleb](https://claude.ai/artifact/8hCVQPJaRzBcMgLiY3xNNU). |

### Reports and moderation

**Goal:** players report anything in a game, and Zaisma acts quickly and consistently.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Alpha | Must | yes | Report button and takedowns | | Reports store nothing about the reporter; audit log |
| done | Beta | Must | yes | Report redesign | | Live Oct 12, 2026: a plate beside the running game; reports carry the version, room, reported player and an optional picture. No single report takes an established game offline |
| done | Beta | Must | yes | AI report triage | Report redesign | Live Oct 12, 2026: reports sorted within minutes by severity, merged and summarized with a recommendation; bugs go to the developer by themselves. Child-safety reports are never sorted by AI |
| done | Beta | Must | yes | Report precedents | AI report triage | Live Oct 12, 2026: triage follows rulings a person made; dismissals marked for the AI alone happen without a person, with spot-checks. Child safety is never automatic and takedowns always need a person |
| done | Beta | Must | yes | Admin MCP | AI report triage | Live Oct 12, 2026 at zaisma.com/admin/mcp: reports, games and precedents in a Claude session, signed in through Cloudflare Access (docs/ADMIN-MCP.md) |
| done | Beta | Must | yes | Names: the admin MCP | | Live Oct 15, 2026 (#146, migration 0033): the admin MCP's tools, inputs and answers for reports, precedents and the forum queue follow docs/NAMING.md, with output schemas, closed inputs and coded errors (`ADMIN_ERROR_CODES`, listed in docs/ADMIN-MCP.md); precedents' columns moved with it |
| done | Beta | Must | yes | Player safety in rooms | Client SDK | Mute, block and report a player; a ready-made panel games put in their own menu |
| planned | Beta | Must | yes | Player reports Zaisma acts on | Player safety in rooms, AI report triage | Zaisma acts on real threats, sharing personal details, following after a block and anything sexual toward a teen. Other chat reports say mute or block and go to the game's moderators; cheating goes to the developer |
| planned | Beta | Must | | No-slop cover and title checks | Game details and device labels | AI review checks covers; real screenshots on every game page. Fake rewards and brands the developer doesn't own hold the game; other slop keeps it off the shelves until the cover is fixed |
| planned | 1.0 | Must | | Appeals queue | AI report triage | Takedown and ban appeals with AI summaries and a recommendation; one-click decisions |

### Content rules

**Goal:** the rules say plainly what's allowed, with examples, and cover the notices the law requires.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| planned | Beta | Must | yes | Content rules wording | Scan before publishing | The page as Julius approved it Oct 16, 2026 (exact wording in #191), in `CONTENT_RULES`, the AI review and triage too: no hate rule; private details about real people or real threats, with Fine and Not fine; personal details banned only inside games; chat follows age bands; crypto is Bitcoin only, with no paying players sats; what breaking a rule costs; when an account is closed. The privacy page's line about games follows |
| planned | Beta | Must | yes | Content rules examples | Content rules wording | Fine and Not fine under every rule, like the one about real people, so developers see where each line is. Julius reads them in the preview |
| planned | Beta | Must | yes | Defamation notices | | A private person a game falsely accuses of a crime sends a notice, like a copyright notice, and the game comes down until it's fixed. Public figures stay fair game for satire |
| planned | Beta | Nice | yes | Block a game in one country | | A legal notice from one country (the UK's hatred offences, say) blocks the game for players there, never everywhere |
| planned | Later | Must | | Julius: online safety risk assessment | | Written risk assessment and takedown process (UK Online Safety Act) for chat and public posts. Before text chat or communities open |

### Privacy and data

**Goal:** players see and take everything Zaisma keeps about them, and deleting an account reaches the games they played.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| planned | Beta | Must | | Download your data | Sign-in | A player downloads everything Zaisma keeps about their account, saves included as files; the legal right of access |
| planned | Beta | Must | | Account deletion reaches developers | Webhooks for developers, Game database through the API | An "account deleted" webhook to every game the player used, with a one-call helper to erase that player in the game database |

## Running Zaisma

The company, its money and its launch.

### Hosting plans and billing

**Goal:** Zaisma pays its own way from hosting and optional plans, never a cut of developers' sales.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Beta usage ceiling | Rooms on rooms.zaisma.com | Live Oct 13, 2026: until Hosting billing, each game's rooms stop at the free 1,000 player-hours a month; running matches finish and no new rooms open until the month resets. Julius approved Oct 13, 2026 |
| planned | Beta | Must | yes | Usage warning before the ceiling | Beta usage ceiling | The developer is told before a game reaches its free player-hours, not only after |
| planned | 1.0 | Must | | Hosting billing | | About 2x our Cloudflare cost; first 1,000 player-hours a month free per developer or team, no card needed. Above that, prepaid credit (about $10 minimum, optional automatic top-up): when it runs out, running matches finish but no new rooms open beyond the free tier; warnings at 20% and empty. Game databases past their free use the same way: $2 per million rows written, $0.002 per million read, $0.40 per GB-month (Julius, Oct 16, 2026). Credit pays only for Zaisma services and is never paid out. Bills readable in the API and MCP, with plain reasons and error codes. Starts the month payments go live |
| planned | 1.0 | Must | | Zaisma Pro | | About $10/month, only for what costs us more: custom domains (Cloudflare for SaaS, moved from Phase 6), more storage and seats, higher upload limit. Stats and scheduled releases stay free for everyone (Oct 14, 2026) |
| planned | 1.0 | Must | | Promoted games | | Labeled front-page slots, no tracking, priced by traffic |
| planned | 1.0 | Must | | Review deposits | | $5 / $25, refundable |
| planned | 1.0 | Nice | | Donation page | | GitHub Sponsors / Open Collective; a bonus, not the plan |
| planned | Later | Must | | Zaisma Plus | | About $5/month: badge, profile extras, new features first, early access to games whose developers opt in; half to developers by playtime |

### Support

**Goal:** players and developers get answers from their own records, and a person when it needs judgment.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| planned | 1.0 | Must | | AI support assistant | Errors: holds and takedowns | On zaisma.com for players and developers. Reads the same records (account, game status, scan report, receipts, saves, bills), answers from facts and takes safe actions (resend a code, re-run a scan, restore a save); hands judgment calls to a person |

### Company and legal

**Goal:** the company, accounts and filings Zaisma needs, mostly Julius's and Gleb's.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | | Julius: form an LLC | | Zaisma LLC, registered in Wyoming (Oct 13, 2026). Liability protection before outside uploads; a registered agent keeps a home address off public records |
| done | Beta | Must | | Julius: Workers Paid plan | | $5/month, live Oct 12, 2026; needed to run developers' game servers |
| done | Beta | Must | | Julius: alert and DMCA email delivery | | Fastmail whitelisted zaisma.com (Oct 14, 2026). support@, dmca@, privacy@, safety@, pdna_account@ and julius@ forward to Julius's Fastmail through Cloudflare Email Routing; site alerts send from alerts@ |
| doing | Beta | Must | | Gleb: register the DMCA agent | | Waiting on the company's Twilio phone number. $6 at copyright.gov as Zaisma LLC, agent email dmca@zaisma.com; then the agent details go on zaisma.com/dmca; renews every 3 years. Guide: [Safety sign-ups for Gleb](https://claude.ai/artifact/8hCVQPJaRzBcMgLiY3xNNU). |
| planned | 1.0 | Must | | Julius: register Zaisma LLC in Florida | | Julius runs Zaisma from Florida, so the Wyoming LLC must also register there as a foreign LLC (Sunbiz, about $125, then a yearly report by May 1). Done before Zaisma takes money (Julius, Oct 13, 2026) |

### Launch and outreach

**Goal:** the beta opens with games worth playing, and developers hear about it.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Alpha | Must | yes | First game: Shard Dodge | | |
| planned | Beta | Must | | At least 5 seed games | Zaisma skill for every AI, Two demo games | Made with Claude Code through our own publishing flow, different genres, multiplayer |
| planned | Beta | Nice | | 10 seed games | At least 5 seed games | The target in `docs/PLAN.md` |
| planned | Beta | Must | | Link-out listings | Ready for outreach | Games hosted elsewhere, credited and linked, marked "Plays on example.com", never embedded. Original games only, checked at listing and re-checked automatically. Added from admin with the developer's OK at first; later developers add and claim their own |
| planned | Beta | Must | | Ready for outreach | Design system, Home page, Friends on the home page, Profiles, Browse games, Account pages, Game dashboard sections, Custom game dashboard, Developer home | Julius decides; outreach and link-out listings start here |
| planned | Beta | Must | | Open the public beta | Connect image matching, Report matches to NCMEC automatically, Gleb: register the DMCA agent, Julius: form an LLC, Julius: alert and DMCA email delivery, Julius: Supabase Pro, Julius: own sign-in address, At least 5 seed games | And every other must item above. Uploads open to every account. Weekly releases and the weekly game jam start here |

### Events and game jams

**Goal:** regular events give developers a reason to make games and players a reason to come back.

Nothing planned yet.

### Reliability and operations

**Goal:** what's live stays up and checked, and shipping is one command.

| Status | Phase | Must/Nice | Settled | Slice | Needs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| done | Beta | Must | yes | Checks on every pull request | | Live Oct 16, 2026 (#149): tests and typecheck run by themselves on every pull request and push to main (`.github/workflows/check.yml`), so the naming, schema, error-code and ID checks hold without anyone remembering them; `npm run ship` stops when main's check failed |
