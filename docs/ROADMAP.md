# Roadmap

The live plan of what gets built, in what order. `docs/DECISIONS.md` says *how* each thing works; this file says *when* and *where it stands*. Update it whenever work starts, lands or moves.

**Now:** Phase 1 (Beta), multiplayer track. Room bot protections and Idle and away players are live (Oct 14, 2026), the latter built the honest-clients way (see "The direction" in DECISIONS.md).

## How to read this

- **Phases** run in order. Phase 1 is everything the public beta needs; nothing else blocks launch. After the beta, phases 3 to 6 can swap order if players or developers ask for something sooner.
- **Must** items finish the phase. **Nice** items ship if they're ready and otherwise move to a later phase without holding anything up.
- **Status:** `done`, `doing`, `next`, `planned`, `idea`.
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

**Order of work.** Four tracks run side by side; within a track, the **Needs** column says what has to land first. The longest waits are outside our control (sign-ups for image matching and NCMEC), so the launch prerequisites start first. The build tracks meet at the end: developers' own game servers need multiplayer and publishing, and the seed games use everything.

### Launch prerequisites (Julius and Gleb, start first)

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| done | Must | Julius: buy the game domain | | zaismausercontent.com, bought Oct 11, 2026 |
| done | Must | Serve each game on its own subdomain | Julius: buy the game domain | Live Oct 11, 2026: <slug>.zaismausercontent.com; workers.dev turned off |
| doing | Nice | Julius: send PhotoDNA the LLC's records | Julius: form an LLC | Sent Oct 13, 2026; waiting on Microsoft. Their records check found nothing under Julius's own name, so Julius replied on the same thread (to pdnasup@microsoft.com) with Zaisma LLC's full legal name, its Wyoming registration link and the articles of organization. If no answer by Oct 20, send a short follow-up on that thread. Arachnid Shield covers the beta until then |
| done | Must | Gleb: sign up for Arachnid Shield | | Done Oct 14, 2026. Now the main image matcher, since PhotoDNA was declined: free known-abuse-image matching from the Canadian Centre for Child Protection (Project Arachnid), self-serve API key at projectarachnid.ca. Sign up with safety@zaisma.com; Gleb sends Julius the API key privately. Paid fallbacks: Thorn's Safer, directly or through Hive (quote only). Step-by-step guide: [Safety sign-ups for Gleb](https://claude.ai/artifact/8hCVQPJaRzBcMgLiY3xNNU). |
| done | Nice | Julius: turn on Cloudflare's CSAM Scanning Tool | | On for both domains (Oct 14, 2026); matches alert safety@zaisma.com (Cloudflare Email Routing to Julius). Free, one switch per domain (zaisma.com and zaismausercontent.com) plus an alert email. Only sees content served through Cloudflare's cache, after it's live, so it's a backstop, not the check before publishing. The games Worker serves files straight from R2 without the cache, so on zaismausercontent.com it would see almost nothing until images go through the cache |
| next | Must | Gleb: register with NCMEC | | Free; how platforms report child sexual abuse material, which US law requires. Contact email safety@zaisma.com. Step-by-step guide: [Safety sign-ups for Gleb](https://claude.ai/artifact/8hCVQPJaRzBcMgLiY3xNNU). |
| done | Must | Julius: form an LLC | | Zaisma LLC, registered in Wyoming (Oct 13, 2026). Liability protection before outside uploads (we host their files); a registered agent keeps your home address off public records. Also what PhotoDNA needs to continue |
| next | Must | Gleb: register the DMCA agent | | $6 at copyright.gov as Zaisma LLC, agent email dmca@zaisma.com; then the agent details go on the DMCA page. Step-by-step guide: [Safety sign-ups for Gleb](https://claude.ai/artifact/8hCVQPJaRzBcMgLiY3xNNU). |
| done | Must | Julius: alert and DMCA email delivery | | Fastmail whitelisted zaisma.com (Oct 14, 2026). support@, dmca@, privacy@, safety@, pdna_account@ and julius@ all forward to Julius's Fastmail through Cloudflare Email Routing; site alerts send from alerts@ |
| doing | Must | Connect image matching | Gleb: sign up for Arachnid Shield, Gleb: register with NCMEC | Every image in an upload is checked before publishing with Arachnid Shield (PhotoDNA added once the LLC's records go through); matches are held, reported to NCMEC within minutes and alerted to Julius. Until then every game waits for manual approval. Matching built and in the local preview (Oct 14, 2026): every picture and video in an upload, found by name, by its first bytes whatever it's called, or written into code as base64, plus covers and screenshots; a match holds the version (it can't be approved), skips the AI, keeps every file and sends an urgent alert. Versions that passed before matching are matched once by a daily job, and a live game that matches is hidden at once. Goes live once merged and the ARACHNID_SHIELD_KEY secret is set. Reporting to NCMEC automatically waits for Gleb's registration; until then Julius reports matches at report.cybertip.org |
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
| done | Must | Kick and move players | Lobbies and matches | Live Oct 13, 2026: `room.kick` (with keep out), turning players away at the door (`canJoin`), kicks carried into the matches a lobby starts, the host kicking and handing over in relay games, `room.moveTo` (the target room holds a seat for a minute and tells the sending room who went, in `onMoved`), and the SDK following any move by itself unless the game listens for it. `room.kick` removes a player, optionally keeping them out of that room for the rest of the match, and tells them why; in relay games the host can kick. `room.moveTo` sends players to another room of the same game that already exists (back to a party's match, between areas of an open world); the target room gets their data and can say no. The SDK follows a move by default, and the game can step in (a loading screen). Discord needs the same piece later. Also: a game server can turn a player away at the door with a reason (a room password, a full team), players kicked from a lobby stay out of the match it starts, and in relay games the next player becomes host when the host leaves |
| done | Must | Idle and away players | Kick and move players | Live Oct 14, 2026: pings answered without waking the room drop dead connections about a minute after they go quiet, the SDK says goodbye as the page goes, asks "Still there?" with a small plate after 10 minutes without input (`idleAfter`, or `joinRoom({ idle })` with the relay), and in real-time rooms a game hidden for 2 minutes is away. Players who walk away or lose their connection leave the match with their seat held for 5 minutes (`holdFor`), `away: "lobby"` sends them to the room that made this one, and `onAway`/`onBack` let the game decide; they aren't counted as playing, held seats count toward full, and a room where everyone's away stops ticking. Room lists and the game page leave out the room a player just left. Time in the room still counts toward hosting as before (the pricing question below). Players who walk away stop holding seats and running matches. A small ping every 30 seconds that doesn't wake the room drops dead connections (closed laptops, lost signal) after about a minute; a game tab hidden for a couple of minutes in a real-time room leaves as "away"; no input for 10 minutes (the game can change this or turn it off) shows "Still there?" for 30 seconds. Leaving a match never leaves the game: the game picks hold the seat (default, a few minutes), send to its lobby room, or handle it itself, and a returning player is offered their old room if it has space. Idle and away players don't count as playing now or toward how full a room looks, and a room where everyone is idle stops running. Not charging developers for idle time is a pricing question for Hosting billing. Honest clients do the fast part (Julius approved Oct 14, 2026): the SDK says goodbye when the page hides or closes, so the room drops the player at once and the ping is only the backstop; the game page drops the room a player just left from its own list straight away, so nobody sees their own ghost while room lists catch up (they can lag about 15 seconds) |
| planned | Nice | Closest rooms by measurement | Idle and away players | Honest clients pick better rooms: the SDK measures its connection to the regions that have rooms and quick join prefers the fastest, instead of guessing from location. The server's own order by location stays for everyone else |
| planned | Nice | Find players across rooms | Kick and move players, Player safety in rooms | A small directory per game: the game server asks which room its players are in and sends messages to another room ("your friend wants in"), for in-game friends lists, parties and join a friend. Only within one game and only from the game server; blocks always apply; players can appear offline, and teens are findable only by friends by default. Lasting friends lists need signed-in players or the game's own accounts. Moves to Phase 3 if not ready |
| planned | Nice | Own servers list their rooms | Room browsing | Rooms on a developer's own servers show in the same list: their server checks in with Zaisma every minute. For games that outgrow our rooms (more players, bigger servers), so moving off doesn't empty their Rooms tab |
| planned | Must | Game database | Rooms on rooms.zaisma.com | A real database for each game, part of its hosting: tables and queries, read and written straight from its game servers, with full access for the developer and their AI (query it, change its tables, fix data, import and export everything); no Zaisma forms in between. The same calls use a local database file on the developer's own server, so self-hosting keeps working and the data can leave with them. What games keep there is theirs: ban lists, moderators, leaderboards, shared worlds. Free up to a limit per game, then priced with a margin like rooms from the same prepaid credit (Julius approved in principle Oct 13, 2026; the limits come to him with the numbers when it's built). Limits keep it from becoming free file hosting |
| planned | Must | Saves through the API | Cloud saves, Developer accounts | Developers read, fix and export their game's saves by player ID (API and MCP); every developer change keeps a history copy first so the player can go back. Saves and the game database stay separate (DECISIONS.md) |
| planned | Must | Save screens games can take over | Cloud saves, "Keep your progress" | The conflict chooser and the "Keep your progress" card stay the default for games with no code; SDK games handle conflicts themselves (`Zaisma.saves.onConflict`), turn the card off or offer an account when they like (`Zaisma.player.offerAccount()`) |
| planned | Must | Account deletion reaches developers | Webhooks for developers, Game database | An "account deleted" webhook to every game the player used; developers erase that player's data on their side, with a one-call helper in their game database |
| planned | Must | Game server endpoints and schedules | Developers' own game servers run safely | A game's server code can also answer plain requests (an endpoint per game: leaderboards, a shop or daily rewards in a single-player game) and run on a schedule (daily resets, persistent worlds), with the game database behind it. The same code runs on the developer's own server |
| planned | Must | Game server reach and secrets | Developers' own game servers run safely | Game servers can call the developer's own listed servers (and payment providers they use), with secrets set per game in the dashboard, MCP or API and never shown again. Still nothing of ours inside |

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
| planned | Must | Zaisma accounts in games | Sign-in, Player passes | One ID everywhere. Passes become proof only: the ID, guest or account, the game, when it expires (guests also get their generated name). A public profile lookup any game or server can call, returning what a stranger sees; teens show little more than a name. Games ask players to sign in when they like and choose guests, accounts only or a mix, for a room, multiplayer or the whole game; the game page says "Needs a Zaisma account" before Play when the whole game does. Ships with Sign in with Zaisma (moved up from Phase 3): one OAuth server for developers' own sites and servers, games with their own accounts and the MCP sign-in without a key. Site copy that says every game plays as a guest changes when this ships |
| planned | Must | Social modes and age bands | Age question | Three age bands (13–15, 16–17, 18+); older teen accounts are asked again. Every account has a social mode: solo-focused, friends-focused or open and social. 13–15 start solo-focused and can switch only to friends-focused, by hand; 16–17 and 18+ choose at signup (friends-focused by default) and can change later. Open and social stays within the same band group. Friends by invitation in solo- and friends-focused. The pass carries an opaque chat group and the player's friends, never the age; `canChat(a, b)` for developers' own servers |

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
| planned | Must | No-slop cover and title checks | Game details and device labels | AI review checks covers; real screenshots on every game page. Fake rewards and brands the developer doesn't own hold the game; other slop only keeps it off the shelves until the cover is fixed |
| planned | Must | Chat rules |  | In the content rules and the AI review: chat only for accounts, through Zaisma's chat hosting or with `canChat` and the filter on a developer's own server. Until those ship (Phase 3), games offer preset phrases and emotes |
| done | Must | Developer MCP | Drafts and publishing | Create, edit, upload, publish, roll back, scans, reports, stats at zaisma.com/mcp, signed in with an API key; small games upload through the MCP, bigger builds through the upload command |
| planned | Must | MCP sign-in without a key | Developer MCP | OAuth, so claude.ai and other apps that can't send a key can connect after the developer signs in. The same OAuth server as Sign in with Zaisma |
| planned | Must | Webhooks for developers | Developer MCP, AI report triage | Moved up from Nice (Oct 14, 2026): one signed event stream to an address the developer sets for every event (bug reports, scans, publishes, room events, deleted accounts, later purchases), e.g. a GitHub issue for every bug report. Follower alerts, Discord posts and purchase notifications all go out this way. Until then their AI checks for new bug reports with `since` |
| planned | Must | Scoped API keys | Developer accounts | Keys limited to one game, read-only or upload-only, for CI and collaborators |
| planned | Must | Export everything | Developer accounts, Game database | One command (and MCP tool) exports a game: files, versions, database, saves, stats, reports and updates |
| planned | Must | Registered links | Developer accounts | Moved up from Phase 2 (Oct 14, 2026), so developers can earn with their own payments from day one: links to their store, Patreon, Steam or Discord, opened by `Zaisma.links` with a leaving-Zaisma notice |
| doing | Must | Support tools in the MCP | Developer MCP | "Why is my game held?", scan reports, logs, bills: developers' own AI answers their questions. Game history and scan findings are in; bills and logs next |
| doing | Must | Feedback from developers' AI | Developer MCP, AI report triage | Bugs, gaps, feature requests and questions about Zaisma itself, filed by developers' AI assistants (MCP `send_feedback`, the API, `npx @zaisma/cli feedback`) or by hand in the dashboard. The MCP tells AIs to file whenever they hit a bug or a limit, after checking what's there. Each item is a thread the developer and their AI can add to, with screenshots, and reopen; known issues (title, workaround, roadmap item, developers affected) are open to every developer and their AI, who add their own case instead of filing twice. Every post says whether the developer or their AI wrote it. Each new item answers at once with known issues that match and their workarounds, and AI sorts the rest like reports: duplicates merged with a count of developers affected, severity, area. Secrets in the text are blanked, and about 100 posts a day per account. Developers hear when it's fixed (`feedback_news` in list_games). Julius works through them in the admin MCP and dashboard, links them to roadmap items, and can copy a cleaned-up issue to public GitHub. In progress: filing, threads, known issues, the API, MCP, upload command and admin MCP are live (Oct 14, 2026); AI sorting is built (Oct 14, 2026); the dashboard and admin page are next |
| planned | Must | Errors that explain themselves | | Every hold, takedown, bill and failed upload has a plain reason, a rule, a fix and an error code that links to docs |
| planned | Must | Docs for AI tools | | `llms.txt` and troubleshooting pages by error code, so any AI can answer questions about Zaisma |
| done | Must | Developer dashboard | Drafts and publishing | The same API as the MCP; keep it simple for the beta. zaisma.com/dashboard: your games, folder upload in the browser, versions with preview, publish, publish later and roll back, details, visibility, images, reports, stats and history |
| planned | Must | `zaisma check` and automatic fixes | Upload command | Pulls in outside scripts, unpacks compressed builds |
| planned | Must | Claude Code skill | Developer MCP, `zaisma check` and automatic fixes | Teaches the whole workflow |
| done | Must | Basic play stats | | Live Oct 13, 2026. Plays, session length, players coming back. Counted by the game page (no code in the game, no player IDs: only counts per game per day); in the dashboard, API and MCP |
| done | Must | Play-count protection | Basic play stats | Live Oct 13, 2026. Counted plays are the official numbers: Cloudflare's invisible check on Play, a ticket per play, a minute on screen; shelves skip cloud networks and cap any one provider; spike alerts and actions in admin; a content rule against faking plays. Before outreach |
| planned | Nice | Stats export and game events | Basic play stats | Daily counts through the API to export, and games counting their own events (`Zaisma.track`, no player IDs) next to plays |
| done | Must | Room-count protection | Play-count protection | Live Oct 14, 2026 (the strict version Julius approved): a Zaisma player pass needs a key from Cloudflare's check on Play, which the game page hands only to its own game; up to 5 passes per key over 6 hours. So bots can't fill rooms or fake "playing now", which counts only players with passes. The developer's own plays and tester links get keys too (never counted); a browser the check can't confirm plays alone but not online, and a game opened outside its zaisma.com page gets no passes. Tested live with a real browser |
| done | Must | Room connection limits | | Live Oct 13, 2026: opening a room connection is limited per internet address (60 a minute), like passes and new rooms, so a script claiming to be a game's page can't keep waking rooms |
| done | Must | Beta usage ceiling | Rooms on rooms.zaisma.com | Live Oct 13, 2026. Until Hosting billing exists, each game's rooms stop at the free tier (1,000 player-hours a month): running matches finish and keep taking players, an empty room takes back only its own players, and no new rooms open until the month resets or billing goes live. Developers see the month's hours in the dashboard, MCP and API. Bounds our cost from bots and runaway games. Julius approved Oct 13, 2026 |
| done | Must | Developers' own game servers run safely | Upload command, Rooms on rooms.zaisma.com, Julius: Workers Paid plan | Live Oct 13, 2026. Developers set multiplayer to their own game server (dashboard, MCP or API) and upload a `zaisma-server/` folder (index.js plus the files it imports, no build step) or one bundled `zaisma-server.js`; it runs on our rooms in a Dynamic Worker with no internet and nothing of ours, never served to players. Cloudflare stops an endless loop only after about 2 seconds, so a match stopped twice ends. Developers see its errors (with the line), stopped loops and ended matches. Tested live: 20 ticks a second for minutes, about 14 ms round trips, under 1 ms of CPU a call (under $1 per 1,000 player-hours for a busy real-time game) |
| planned | Nice | Drop-in Socket.IO and PeerJS | Client SDK | So existing multiplayer prototypes work with few changes |

### Polish before outreach (build track 5)

The platform works but looks and feels rough. No outreach, no listings for other developers' games and no inviting developers until this is done: first impressions are hard to undo.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| doing | Must | Design system | | Steel, from the brand, now a full theme like a console's big-screen mode: the ground, gunmetal plates and chrome, lit by the game on screen (its art blurred behind every page, changing as you point at games). Live on the home, game, dashboard and account pages (docs/DESIGN.md); remaining pages move over as they are rebuilt |
| planned | Must | Friends | Sign-in, Social modes and age bands | Friend list, invites, see what friends are playing and join them; by invitation in solo- and friends-focused modes, open requests in open and social; teen-safe defaults. Games get the same list and presence (`Zaisma.friends`). Moved up from Phase 3 to land with the home page |
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
| planned | Must | Link-out listings | Ready for outreach | Games hosted elsewhere, credited and linked, marked "Plays on example.com", never embedded. Original games only. Checked at listing and re-checked automatically. Added from admin with the developer's OK at first; once developer accounts exist, developers add and claim their own from the dashboard or MCP |
| planned | Nice | QR codes | | |
| planned | Must | Open the public beta | Connect image matching, Gleb: register the DMCA agent, Julius: form an LLC, Gleb: alert and DMCA email delivery, Julius: Supabase Pro, At least 5 seed games | And every other must item above. Weekly releases and the weekly game jam start here |

## Phase 2: Earn

Goal: developers can make money within days of the beta.

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| planned | Must | Julius: register Zaisma LLC in Florida | Julius runs Zaisma from Florida, so the Wyoming LLC must also register there as a foreign LLC (Sunbiz, about $125, then a yearly report by May 1). Moved after the beta (Julius, Oct 13, 2026); done before Zaisma takes money. Without it the LLC can be fined and can't sue in Florida courts |
| planned | Must | Zaisma buy sheet | Cards, Apple Pay, Google Pay; saved card works in every game |
| planned | Must | Owned items and receipts | On the account, in the player pass, signed receipts |
| planned | Must | Live purchases | Exactly-once delivery to the game and game server |
| planned | Must | Purchase notifications for developers' servers | Through webhooks. Also links purchases to games' own accounts |
| planned | Must | Purchase rules | Honest labels, real prices, refund policies, no loot boxes |
| planned | Must | Hosting billing | About 2x our Cloudflare cost; first 1,000 player-hours a month free per developer or team, no card needed. Above that, prepaid credit (about $10 minimum, optional automatic top-up): when it runs out, running matches finish but no new rooms open beyond the free tier; warnings at 20% and empty. Credit pays only for Zaisma services and is never paid out. Starts the month payments go live |
| planned | Must | AI support assistant | Errors that explain themselves | On zaisma.com for players and developers. Reads the same records (account, game status, scan report, receipts, saves, bills), answers from facts and takes safe actions (resend a code, re-run a scan, restore a save); hands judgment calls to a person |
| planned | Must | Appeals queue | AI report triage | Takedown and ban appeals with AI summaries and a recommendation; one-click decisions |
| planned | Must | Zaisma Pro | About $10/month, only for what costs us more: custom domains (Cloudflare for SaaS, moved from Phase 6), more storage and seats, higher upload limit. Stats and scheduled releases stay free for everyone (Oct 14, 2026) |
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
| planned | Must | Zaisma in Discord | Rooms that work through Discord's proxy, so developers can ship their own Activity; plus one Zaisma Activity for every game, using Discord's voice |
| planned | Must | Game communities | Like a Steam hub, switched on by the developer: developer updates, player posts (screenshots, clips, guides, questions) with comments. The developer picks their own moderators or points players to their Discord instead; posts readable through the API. Zaisma checks every post for safety before it shows |
| planned | Must | Mods and remixes shelf | On each game's Community tab, with the credit chain |
| planned | Must | Profiles | Games you play, achievements, mods and remixes you've made, your posts; private to friends for teens by default |
| planned | Must | Achievements | Steam-style: the developer defines them (name, description, icon checked like covers), the game or game server unlocks them (`Zaisma.achievements`), they show on the profile and game page; full API. Zaisma never makes badges for games |
| planned | Must | Chat filter | Catches contact details in any disguise, slurs and sexual content aimed at teens; leaves scores, coordinates and ordinary words alone. Rules in the browser first, a small AI model only for unclear messages; a blocked message isn't sent and the sender sees why. Always on for under-18 accounts. Upgrades `Zaisma.filterText` |
| planned | Must | Text chat in rooms | Chat hosting for games: messages ride the room's own connection (included in room hosting), delivered only to players their social modes allow; the game draws the chat and moderates it. Reports attach the last messages from the reporter's screen; Zaisma stores no chat. Needs Social modes and age bands, Chat filter and the risk assessment |
| planned | Must | Voice chat in rooms | Through Cloudflare's media server, so players never see each other's addresses; the same social-mode rules as text, only the loudest few speakers heard. Off by default per game, with a cost caution when switched on; a voice player-hour counts as 2. Voice reports attach the last 30 seconds the reporter heard |
| planned | Must | Julius: online safety risk assessment | Written risk assessment and takedown process (UK Online Safety Act) for chat and public posts. Before text chat or communities open |
| planned | Nice | Install button | Installable web app per game: icon, own window, offline |

## Phase 4: Discover

Goal: good games get found, ranked by quality rather than clicks, and developers get the rest of the marketing kit.

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| planned | Must | Progress bar and front page | Ranked by players coming back, playtime, real ratings, reports |
| planned | Must | "New and rising" shelf | With its own quality bar |
| planned | Must | For you and today's queue | Ranked from what you play by plain rules, not AI; each pick says why. A full-screen daily queue of 8 games, refresh for more |
| planned | Must | Ratings only from people who played | Developers can reply, and read their ratings through the API |
| planned | Must | Search by genre and tags | |
| planned | Must | Player lists and developer picks | |
| planned | Must | Follow games and update notes | Followers hear about new versions; developers post to their Discord or anywhere else through webhooks |
| planned | Must | Zaisma Plus | About $5/month: badge, profile extras, new features first, early access to games whose developers opt in; half to developers by playtime |
| planned | Nice | Scout badge | |
| planned | Nice | Copycat grouping | Reposted templates count as one game |
| planned | Nice | Embeds for developers' sites | |
| planned | Nice | Tools on the developer page | Free, open-source developer tools (engines, asset pipelines, level editors, Claude Code skills, MCP servers). Browser tools go through the same upload, scan and hosting as games, marked as a tool; others link to their repository. Open source only, same content rules, no cut. Seeded with Zaisma's own skill, `zaisma check` and the SDK |
| planned | Nice | Tracked share links | Counts per link, nothing about players |
| planned | Nice | Game assets through the API | Covers, screenshots and details downloadable, so developers' own AI makes press kits and launch posts (replaces Zaisma-made press kits and drafted posts) |

## Phase 5: Create together

Goal: players and developers build on each other's games.

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| planned | Must | Remixes | Opt-in, automatic credit, remix chains; optional 12-month unlock for abandoned games |
| planned | Must | Teams | Owner, publisher and developer roles |
| planned | Must | Mods | SDK mod API: Zaisma hosts, scans and versions mods; the game lists and switches them on its own way (`Zaisma.mods`), a game-page listing optional; invite links carry mods |

## Phase 6: Grow

Goal: room for games that outgrow the defaults.

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| planned | Nice | Bigger game servers | Cloudflare Containers; check outbound data charges first |
| planned | Nice | One-command switch from Wavedash | |
| planned | Nice | Subscriptions in the buy sheet | |

## Parked ideas

Not planned; revisit only if there's a reason.

| Status | Item | Notes |
| --- | --- | --- |
| idea | Under-13 support | Its own project, with verified parental consent |
