# Roadmap

The live plan of what gets built, in what order. `docs/DECISIONS.md` says *how* each thing works; this file says *when* and *where it stands*. Update it whenever work starts, lands or moves.

**Now:** Phase 0 done. Phase 1 (Beta) next, starting with multiplayer.

## How to read this

- **Phases** run in order. Phase 1 is everything the public beta needs; nothing else blocks launch. After the beta, phases 3 to 6 can swap order if players or creators ask for something sooner.
- **Must** items finish the phase. **Nice** items ship if they're ready and otherwise move to a later phase without holding anything up.
- **Status:** `done`, `doing`, `next`, `planned`, `idea`.
- **Julius** marks things only Julius can do (money, accounts, sign-ups).
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

### Launch prerequisites

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| next | Must | Julius: buy zaisma.gg | Then switch the game server to one subdomain per game |
| next | Must | Julius: apply for PhotoDNA | Free, takes weeks. Or Cloudflare's CSAM tool once zaisma.gg exists |
| next | Must | Connect image matching | Until then every game waits for manual approval |
| next | Must | Julius: register the DMCA agent | $6 at copyright.gov, then fill in the DMCA page |
| doing | Must | Alert and DMCA email delivery | Waiting on Fastmail's reply; fallback is a second inbox |
| planned | Must | Julius: Workers Paid plan | $5/month; needed to run creators' game servers |
| planned | Must | Julius: Supabase Pro | $25/month at launch; the free plan pauses |

### Multiplayer

Detailed plan approved: guest passes, game server API, rooms, toolkit, demos.

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| next | Must | Player passes | Signed guest passes any server can check, published keys |
| next | Must | Game server API and relay | Server-client by default; messages-only relay for simple games |
| next | Must | Rooms on rooms.zaisma.com | Durable Objects with hibernation; limits, takedowns end rooms |
| next | Must | Client toolkit | `joinRoom`, invite links, reconnecting |
| next | Must | Room invite links | Tap a link, land in the match as a guest |
| next | Must | Floating Z button | Replaces the top bar: Invite, Clip, Full screen, More games, Report |
| next | Must | Mute, block and report-a-player | |
| next | Must | Games can reach our rooms and their own servers | Own servers set per game and listed on the game page |
| next | Must | Run a game server yourself | Node runner; same code as our rooms |
| next | Must | Two demo games | Real-time arena, turn-based four in a row |
| next | Nice | Clips | Recorded in the game, shared from the player's device, never uploaded |

### Accounts

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| planned | Must | Sign-in | Supabase |
| planned | Must | Age question | Keep only the age band; no ID checks |
| planned | Must | "Keep your progress" | Turns a guest into an account |
| planned | Must | Cloud saves | Mirrors the game's own browser saves, no code needed |
| planned | Must | Games have owners | Ready for teams later |

### Creator publishing

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| planned | Must | Creator accounts and dashboard | Every game, its visibility, review status, versions |
| planned | Must | Creator MCP | Create, edit, upload, publish, roll back, scans, reports, stats |
| planned | Must | Upload command | File by file, up to 2 GB per game, only changed files |
| planned | Must | `zaisma check` and automatic fixes | Pulls in outside scripts, unpacks compressed builds |
| planned | Must | Claude Code skill | Teaches the whole workflow |
| planned | Must | Drafts, preview links, publish, roll back | Keep the live version plus the last 5 |
| planned | Must | Draft, listed and unlisted games | Separate from review status |
| planned | Must | Creators' own game servers run safely | Dynamic Workers (needs Workers Paid) |
| planned | Must | Scan only what changed; per-creator budgets | Plus about 20 updates per game per day |
| planned | Must | No-slop cover and title checks | AI review checks covers; real screenshots on every game page |
| planned | Must | No free-text chat rule | In the content rules and the AI review |
| planned | Must | Device labels | Games for your device first; "Play anyway" for the rest |
| planned | Must | Basic play stats | Plays, session length, players coming back |
| planned | Nice | Drop-in Socket.IO and PeerJS | So existing multiplayer prototypes work with few changes |

### Launch content and reach

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| planned | Must | Share cards for every game and room link | Cover, title, "Play now" |
| planned | Must | Creator links on game pages | Steam, itch.io, Discord, website, socials |
| planned | Must | Search-friendly game pages | |
| planned | Must | At least 5 seed games | Made with Claude Code, different genres, multiplayer |
| planned | Nice | 10 seed games | The target in `docs/PLAN.md` |
| planned | Nice | QR codes | |
| planned | Must | Open the public beta | Weekly releases and the weekly game jam start here |

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

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| planned | Must | Friends | Friend list, invites, see what friends are playing; teen-safe defaults |
| planned | Must | Zaisma in Discord | One Discord Activity for every game; our voice chat for now |
| planned | Nice | Sign in with Zaisma | For games with their own accounts |
| planned | Nice | Install button | Installable web app per game: icon, own window, offline |

## Phase 4: Discover

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

| Status | Must/Nice | Item | Notes |
| --- | --- | --- | --- |
| planned | Must | Remixes | Opt-in, automatic credit, remix chains; optional 12-month unlock for abandoned games |
| planned | Must | Teams | Owner, publisher and developer roles |
| planned | Must | Mods | Toolkit mod API; scanned and versioned; invite links carry mods |
| planned | Nice | Tools tab | Free, open-source developer tools |

## Phase 6: Grow

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
