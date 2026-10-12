# Roadmap

The live plan of what gets built, in what order. `docs/DECISIONS.md` says *how* each thing works; this file says *when* and *where it stands*. Update it whenever work starts, lands or moves.

**Now:** Phase 0 done. Phase 1 (Beta) next, starting with multiplayer.

## How to read this

- **Phases** run in order. Phase 1 is everything the public beta needs; nothing else blocks launch. After the beta, phases 3 to 6 can swap order if players or creators ask for something sooner.
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

Goal: open Zaisma to outside creators and players, with what both expect out of the box. **The beta bar:** a creator can publish any web game from their AI tool in one prompt, add multiplayer and saves, and see who plays; a player can tap a link, play on phone or computer, invite friends, keep progress and stay safe.

**Order of work.** Four tracks run side by side; within a track, the **Needs** column says what has to land first. The longest waits are outside our control (PhotoDNA approval takes weeks), so Julius's track starts first. The build tracks meet at the end: creators' own game servers need multiplayer and publishing, and the seed games use everything.

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
| planned | Must | Julius: Workers Paid plan | | $5/month; needed to run creators' game servers |
| planned | Must | Julius: Supabase Pro | | $25/month, switched on at launch; the free plan pauses |
| planned | Nice | Julius: Public Suffix List entry | | Needs 2+ years left on the registration and a `_psl` TXT record; the list may turn down projects without players, so apply after launch |

### Multiplayer (build track 1)

Detailed plan approved: guest passes, game server API, rooms, SDK, demos.

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| doing | Must | Player passes | | Signed guest passes any server can check, published keys |
| doing | Must | Game server API and relay | | Server-client by default; messages-only relay for simple games |
| doing | Must | Rooms on rooms.zaisma.com | Player passes, Game server API and relay | Durable Objects with hibernation; limits, takedowns end rooms |
| doing | Must | Games can reach our rooms and their own servers | Rooms on rooms.zaisma.com | Own servers set per game and listed on the game page |
| doing | Must | Client SDK | Rooms on rooms.zaisma.com | `joinRoom`, invite links, reconnecting |
| doing | Must | Room invite links | Client SDK | Tap a link, land in the match as a guest |
| next | Must | Game page controls | | Invite, Clip, Full screen, More games, Report beside the game; nothing over it |
| next | Must | Player safety in rooms | Client SDK | Mute, block and report a player; ready-made panel games put in their own menu |
| doing | Must | Run a game server yourself | Game server API and relay, Player passes | Node runner; same code as our rooms |
| doing | Must | Two demo games | Room invite links | Real-time arena, turn-based four in a row |
| next | Nice | Clips | Client SDK, Game page controls | Recorded in the game, shared from the player's device, never uploaded |

### Accounts (build track 2)

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| planned | Must | Sign-in | | Supabase |
| planned | Must | Age question | Sign-in | Keep only the age band; no ID checks |
| planned | Must | Games have owners | Sign-in | Ready for teams later |
| planned | Must | Cloud saves | Sign-in, Client SDK | Mirrors the game's own browser saves, no code needed |
| planned | Must | "Keep your progress" | Cloud saves | Turns a guest into an account |

### Creator publishing (build track 3)

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| planned | Must | Creator accounts | Sign-in, Games have owners | |
| planned | Must | Upload command | Creator accounts | File by file, up to 2 GB per game, only changed files |
| planned | Must | Scan only what changed; per-creator budgets | Upload command | Plus about 20 updates per game per day |
| planned | Must | Drafts and publishing | Upload command | Preview links, publish now or later, roll back; keep the live version plus the last 5 |
| planned | Must | Game visibility | Creator accounts | Draft, listed or unlisted; separate from review status |
| planned | Must | Game details and device labels | Creator accounts | Covers and screenshots, scanned; games for your device first, "Play anyway" for the rest |
| planned | Must | No-slop cover and title checks | Game details and device labels | AI review checks covers; real screenshots on every game page |
| planned | Must | No free-text chat rule | | In the content rules and the AI review |
| planned | Must | Creator MCP | Drafts and publishing | Create, edit, upload, publish, roll back, scans, reports, stats |
| planned | Must | Creator dashboard | Drafts and publishing | The same API as the MCP; keep it simple for the beta |
| planned | Must | `zaisma check` and automatic fixes | Upload command | Pulls in outside scripts, unpacks compressed builds |
| planned | Must | Claude Code skill | Creator MCP, `zaisma check` and automatic fixes | Teaches the whole workflow |
| planned | Must | Basic play stats | Client SDK | Plays, session length, players coming back |
| planned | Must | Creators' own game servers run safely | Upload command, Rooms on rooms.zaisma.com, Julius: Workers Paid plan | Dynamic Workers; the biggest technical unknown in Phase 1, so prototype it early |
| planned | Nice | Drop-in Socket.IO and PeerJS | Client SDK | So existing multiplayer prototypes work with few changes |

### Launch content and reach (build track 4)

| Status | Must/Nice | Item | Needs | Notes |
| --- | --- | --- | --- | --- |
| planned | Must | Search-friendly game pages | | |
| planned | Must | Share cards for every game and room link | Game details and device labels | Cover, title, "Play now" |
| planned | Must | Creator links on game pages | Creator accounts | Steam, itch.io, Discord, website, socials |
| planned | Must | At least 5 seed games | Claude Code skill, Two demo games | Made with Claude Code through our own publishing flow, different genres, multiplayer |
| planned | Nice | 10 seed games | At least 5 seed games | The target in `docs/PLAN.md` |
| planned | Nice | QR codes | | |
| planned | Must | Open the public beta | Connect image matching, Julius: register the DMCA agent, Julius: form an LLC, Alert and DMCA email delivery, Julius: Supabase Pro, At least 5 seed games | And every other must item above. Weekly releases and the weekly game jam start here |

## Phase 2: Earn

Goal: creators can make money within days of the beta.

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| planned | Must | Zaisma buy sheet | Cards, Apple Pay, Google Pay; saved card works in every game |
| planned | Must | Owned items and receipts | On the account, in the player pass, signed receipts |
| planned | Must | Live purchases | Exactly-once delivery to the game and game server |
| planned | Must | Purchase notifications for creators' servers | Also links purchases to games' own accounts |
| planned | Must | Registered links | Creators' own payments and stores, with a leaving-Zaisma notice |
| planned | Must | Purchase rules | Honest labels, real prices, refund policies, no loot boxes |
| planned | Must | At-cost multiplayer billing | Starts the month payments go live; bills under $5 roll over |
| planned | Must | Review deposits | $5 / $25, refundable |
| planned | Must | Donation page | GitHub Sponsors / Open Collective |
| planned | Nice | Tips for creators | |
| planned | Nice | Optional Bitcoin | Lightning and on-chain, paid straight to creators' wallets |
| planned | Nice | Local payment methods | PayPal where available, Pix, iDEAL |
| planned | Nice | Family controls and "Ask a parent to buy" | Opt-in |

## Phase 3: Play together

Goal: playing with friends is effortless, wherever friends already hang out.

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| planned | Must | Friends | Friend list, invites, see what friends are playing; teen-safe defaults |
| planned | Must | Zaisma in Discord | One Discord Activity for every game; our voice chat for now |
| planned | Nice | Sign in with Zaisma | For games with their own accounts |
| planned | Nice | Install button | Installable web app per game: icon, own window, offline |

## Phase 4: Discover

Goal: good games get found, ranked by quality rather than clicks, and creators get the rest of the marketing kit.

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| planned | Must | Progress bar and front page | Ranked by players coming back, playtime, real ratings, reports |
| planned | Must | "New and rising" shelf | With its own quality bar |
| planned | Must | Ratings only from people who played | |
| planned | Must | Search by genre and tags | |
| planned | Must | Player lists and creator picks | |
| planned | Must | Follow games and update notes | Followers hear about new versions; posts to the creator's Discord |
| planned | Nice | Scout badge | |
| planned | Nice | Copycat grouping | Reposted templates count as one game |
| planned | Nice | Embeds for creators' sites | |
| planned | Nice | Tracked share links | Counts per link, nothing about players |
| planned | Nice | Press kits | |
| planned | Nice | AI-drafted launch posts | MCP tools; the creator approves before posting |

## Phase 5: Create together

Goal: players and creators build on each other's games.

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
| planned | Nice | Bigger game servers at cost | Cloudflare Containers; check outbound data charges first |
| planned | Nice | Custom game domains | Cloudflare for SaaS |
| planned | Nice | One-command switch from Wavedash | |
| planned | Nice | Subscriptions in the buy sheet | |

## Parked ideas

Not planned; revisit only if there's a reason.

| Status | Item | Notes |
| --- | --- | --- |
| idea | Share donation surplus with creators by playtime | Only if donations and sponsors exceed costs; Julius decides |
| idea | Outbound links to games hosted elsewhere | Clearly marked, new tab; only if creators ask |
| idea | Under-13 support | Its own project, with verified parental consent |
