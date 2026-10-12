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

**Order of work.** Four tracks run side by side; within a track, the **Needs** column says what has to land first. The longest waits are outside our control (PhotoDNA approval takes weeks), so Julius's track starts first. The build tracks meet at the end: developers' own game servers need multiplayer and publishing, and the seed games use everything.

### Launch prerequisites (Julius's track, start first)

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| done | Must | Julius: buy the game domain | | zaismausercontent.com, bought Oct 11, 2026 |
| done | Must | Serve each game on its own subdomain | Julius: buy the game domain | Live Oct 11, 2026: <slug>.zaismausercontent.com; workers.dev turned off |
| doing | Must | Julius: apply for PhotoDNA | | Applied Oct 12, 2026 as a sole proprietor; in review. Free, approval takes weeks. Check whether the 30-day subscription renews by itself |
| next | Must | Julius: register with NCMEC | | Free; how platforms report child sexual abuse material, which US law requires |
| next | Must | Julius: form an LLC | | Liability protection before outside uploads (we host their files and indemnify Microsoft); a registered agent keeps your home address off public records. Moving PhotoDNA to the LLC needs Microsoft's consent or a new application |
| next | Must | Julius: register the DMCA agent | | $6 at copyright.gov, then fill in the DMCA page |
| doing | Must | Alert and DMCA email delivery | | Waiting on Fastmail's reply; fallback is a second inbox |
| planned | Must | Connect image matching | Julius: apply for PhotoDNA, Julius: register with NCMEC | Matches are held and reported to NCMEC automatically through the PhotoDNA API within minutes (the terms require 72 hours), with an alert to Julius. Connector public unless Microsoft's materials turn out to be confidential. Until then every game waits for manual approval |
| planned | Must | Julius: Workers Paid plan | | $5/month; needed to run developers' game servers |
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
| next | Must | Report redesign | | Opens over the game, never leaves it; designed for Zaisma, not a generic form; quick enough that players actually use it. Every report is triaged by AI (see "AI report triage") Design with Julius first |
| planned | Must | AI report triage | Report redesign | AI sorts every report by severity, merges duplicates, gathers the evidence (game version, scan report, room and player IDs) and handles the safe outcomes itself: re-checks the game, tells the developer about bugs, holds clear rule breaks. Bans, takedowns and appeals get a summary and a recommendation for a one-click human decision; child-safety reports always go to a person first |
| done | Must | Run a game server yourself | Game server API and relay, Player passes | Node runner; same code as our rooms |
| done | Must | Two demo games | Room invite links | Real-time arena, turn-based four in a row |
| planned | Must | Room browsing | Room invite links | Open rooms on each game's page with player counts; games can hide all or some rooms from browsing (matchmaking, invite-only, rejoin-only) |

### Accounts (build track 2)

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| done | Must | Sign-in | | Emailed code, no passwords. Supabase holds only the email; names and age bands live with the games. Delete account is instant |
| done | Must | Age question | Sign-in | Asked before the email, so we collect nothing from under-13s. Keep only the age band; no ID checks |
| done | Must | Games have owners | Sign-in | A person now, a team later; set in admin until developer accounts |
| doing | Must | Cloud saves | Sign-in, Client SDK | Mirrors the game's own browser saves, no code needed. Stored in R2; the player chooses when two devices disagree. localStorage first, then IndexedDB |
| planned | Must | "Keep your progress" | Cloud saves | Turns a guest into an account |
| planned | Must | Save history | Cloud saves | Keep the last few versions of every cloud save, so "my progress is gone" fixes itself |
| planned | Must | Passkeys | Sign-in | Face ID or fingerprint to sign back in; the email code stays for new accounts and lost devices |
| planned | Nice | Google and Discord sign-in | Sign-in, Age question | The age question still comes first for new accounts |

### Developer publishing (build track 3)

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| planned | Must | Developer accounts | Sign-in, Games have owners | |
| planned | Must | Upload command | Developer accounts | File by file, up to 2 GB per game, only changed files |
| planned | Must | Scan only what changed; per-developer budgets | Upload command | A daily limit on AI-reviewed uploads per free account (higher with Pro), about 20 updates per game per day |
| planned | Must | Drafts and publishing | Upload command | Preview links, publish now or later, roll back; keep the live version plus the last 5 |
| planned | Must | Game visibility | Developer accounts | Draft, listed, unlisted or private; separate from review status. Unlisted is noindex and never in any shelf |
| planned | Must | Tester links | Game visibility | Secret, named, revocable links that open a private game; guests can use them |
| doing | Must | Game details and device labels | Developer accounts | Covers and screenshots, scanned; games for your device first, "Play anyway" for the rest |
| planned | Must | No-slop cover and title checks | Game details and device labels | AI review checks covers; real screenshots on every game page |
| planned | Must | No live chat or DMs between strangers rule | | In the content rules and the AI review; games may offer preset phrases and emotes |
| planned | Must | Developer MCP | Drafts and publishing | Create, edit, upload, publish, roll back, scans, reports, stats |
| planned | Must | Support tools in the MCP | Developer MCP | "Why is my game held?", scan reports, logs, bills: developers' own AI answers their questions |
| planned | Must | Errors that explain themselves | | Every hold, takedown, bill and failed upload has a plain reason, a rule, a fix and an error code that links to docs |
| planned | Must | Docs for AI tools | | `llms.txt` and troubleshooting pages by error code, so any AI can answer questions about Zaisma |
| planned | Must | Developer dashboard | Drafts and publishing | The same API as the MCP; keep it simple for the beta |
| planned | Must | `zaisma check` and automatic fixes | Upload command | Pulls in outside scripts, unpacks compressed builds |
| planned | Must | Claude Code skill | Developer MCP, `zaisma check` and automatic fixes | Teaches the whole workflow |
| planned | Must | Basic play stats | Client SDK | Plays, session length, players coming back |
| planned | Must | Developers' own game servers run safely | Upload command, Rooms on rooms.zaisma.com, Julius: Workers Paid plan | Dynamic Workers; the biggest technical unknown in Phase 1, so prototype it early |
| planned | Nice | Drop-in Socket.IO and PeerJS | Client SDK | So existing multiplayer prototypes work with few changes |

### Polish before outreach (build track 5)

The platform works but looks and feels rough. No outreach, no listings for other developers' games and no inviting developers until this is done: first impressions are hard to undo.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| doing | Must | Design system | | Steel, from the brand: type, colors, spacing, the bevel and metal highlights, used by every page. Home page layout being mocked up with Julius |
| planned | Must | Friends | Sign-in | Friend list, invites, see what friends are playing and join them; requests only from people you've played with; teen-safe defaults. Moved up from Phase 3 to land with the home page |
| planned | Must | Home page | Design system, Friends, Continue playing, Game updates | Friends first, then last played, Continue playing, For you (once it exists), then Games for everyone: popular, trending, new. Play in one tap |
| planned | Must | Continue playing | | The games you played most recently, on the home page; sort by recently played or recently updated, with an "Updated" badge. On this device for guests, on your account when signed in |
| planned | Must | Game updates | | Developers post a title, a short text and an optional image (checked like covers); version notes become patch notes in an expanded view |
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
| planned | Must | Hosting billing | About 2x our Cloudflare cost; first 1,000 player-hours a month free per developer or team; starts the month payments go live |
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
