# Zaisma plan

Oct 11, 2026 · @Julius Ivsan

**Zaisma** (ZAI-zmuh), from the Lithuanian *žaismas*, play. Every kind of game. One link away. Domain: zaisma.com · Code: github.com/zaisma

## What it is

Click a link and you're in the game: no account, no app download, in any browser. That's the headline. Behind it is an open, low-fee home for radically creative games made with AI tools, with one optional account for friends, saves and purchases, and developers keeping their revenue. It launches as a 13+ side project on rented cloud services.

- **For players:** tap a friend's link and play as a guest in seconds, on phone or laptop. Make an account only to keep progress, add friends or buy something.
- **For developers:** publish any web game in one prompt from Claude Code or any other AI tool, in any art style, world or genre. Accounts, friends, saves, multiplayer and payments come built in.
- **Versus Roblox:** no required app, no shared avatar or blocky world, no engine lock-in, and no cut of game revenue, and every line of the platform open source.

## Wedge and growth loop

We win by being the default "publish" step for games made in Claude Code, then letting every shared game link recruit new players.

1. **Creator MCP + toolkit.** An MCP server any AI tool can connect to after the creator signs in: create games, edit details, upload, publish, roll back, and check scans, reports and stats. A small upload command sends builds straight to us, and a Claude Code skill teaches the whole workflow. A small JavaScript toolkit adds login, friends, saves and multiplayer to any game.
2. **Instant play links.** Every game and every multiplayer room has a link. Anyone who taps it joins as a guest in seconds, in the browser, with no signup and no download. After a good session we offer "keep your progress" to turn the guest into an account.
3. **Friends pull friends.** "Join my room" links put new players onto the platform; once they have an account, every other game is one tap away.
4. **Developers pull players.** Developers already post their AI-made games on X, Reddit and Discord. Each post points at our link, not a zip file or a GitHub page.

## Money: free for developers, funded by supporters

Listing and selling are free: no listing fee and no payment cut. Multiplayer on our servers is billed at cost; developers who run their own servers pay us nothing. The platform is fully open source and costs us about a tenth of a cent per player per month after multiplayer billing, covered by donations, sponsors and promoted game slots. Developers choose their own payment method; our Stripe checkout is an optional free convenience.

| Monthly players | Total cost | Paid back by multiplayer billing | Our net cost | Covered by |
| --- | --- | --- | --- | --- |
| 1,000 | $65 | $1 | $65 | Julius or \~13 donors at $5 |
| 10,000 | $100 | $35 | $65 | \~13 donors, or 1 promoted slot for 2 weeks |
| 100,000 | $490 | $385 | $105 | \~21 donors, or 1 promoted slot |
| 1,000,000 | $5,000 | $3,890 | $1,120 | \~225 donors, or 5 promoted slots |

Estimates assume 30% of players make accounts, 4 multiplayer hours per player a month in 8-player real-time rooms, and 300 MB per game. Multiplayer is about 80% of the cost at scale.

**Hosting on our servers, at cost.** Our rooms are for convenience, not to be the cheapest or fastest servers anywhere. Developers pay what Cloudflare charges us: about $1 per 1,000 player-hours of real-time multiplayer. Bills under $5 roll to the next month, so small games effectively pay nothing. Game files, accounts, friends and saves stay free.

**Where the money comes from**

- **Donations and sponsors:** GitHub Sponsors and Open Collective from players and developers; company sponsors for the open-source toolkit.
- **Promoted games:** developers can pay for a front-page slot, like Roblox's old sponsored game ads. 25 slots at $50/week covers 1 million players.
- **Supporter badge:** players who donate get a profile badge.
- **Self-hosting:** any game can move to its own servers whenever it wants, so our biggest costs leave with the games that outgrow us.

Bitcoin and other payment methods are the developer's choice; the platform holds no player money.

## Stack and monthly cost

The whole platform runs on rented services for about $5/month while building and about $30/month at public launch. No servers to buy.

| Piece | Service | Free allowance | Cost when we outgrow it |
| --- | --- | --- | --- |
| Game files | [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/) | 10 GB storage, 10M reads/month, bandwidth always free | $0.015/GB-month; $0.36 per million reads |
| Multiplayer rooms | [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) | 100,000 requests/day on the free plan | Workers Paid: $5/month minimum, includes 1M requests + 400,000 GB-s |
| Accounts, friends, saves | [Supabase](https://supabase.com/pricing) | 50,000 monthly active users, 500 MB database | Pro: $25/month for 100,000 users, then $0.00325 per user |
| Payments | [Stripe Connect](https://stripe.com/connect/pricing) | No platform fees when Stripe bills developers directly | Developers pay 2.9% + 30¢ per card charge |

**Multiplayer at scale is cheap if built right.** Cloudflare's own example of 100 rooms with 100 players each, all month, costs about $21/month when rooms use WebSocket hibernation. The same load without hibernation costs hundreds, so the SDK must use it from day one.

**Bring your own servers, any time.** Our rooms are a convenient default, billed at cost, never a requirement. A game can run its own servers from day one or move off ours when it takes off, for performance or customization. Accounts, guest IDs, friends and room links keep working: the toolkit hands each player a signed pass that the developer's own server can check, and a room link can point at any server. Moving takes a config change, not a rewrite.

Supabase's free plan pauses after a week without traffic, so we move to Pro ($25) at public launch. Cloudflare Workers Paid ($5/month) is needed before the beta, because running developers' game servers safely uses Dynamic Workers.

## Rules for a 13+ launch

Launching at 13+ keeps us outside the strictest child-privacy law, as long as we never knowingly collect data from under-13s. These rules ship with version one.

- **Age question at signup.** Ask birth date; block under-13s and don't store their data. Keep only the age band, never the birth date; no ID or face checks. COPPA covers services that collect data from children under 13, and the FTC's updated rule has applied since April 22, 2026 ([Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/tag/coppa)).
- **Teen-safe defaults.** For 13–17: friend requests only from people they've played with, chat off or preset phrases, profiles private.
- **Developer payouts through Stripe Standard accounts.** These allow sellers from age 13 if a parent or guardian owns the account; Stripe's Express and Custom accounts require 18+ ([Stripe](https://support.stripe.com/questions/age-requirement-to-create-a-stripe-account)).
- **Player purchases by teens.** Purchases go through the Zaisma buy sheet with clear prices and receipts to the card owner. No default spending cap; optional family controls and "Ask a parent to buy".
- **Content and takedowns.** Any game can list, but we remove illegal content and copyright-infringing remixes on notice. Register a DMCA agent and add a report button to every game page.
- **Under-13 later.** Expanding to younger players needs verified parental consent; plan it as its own project once revenue covers it.

**Guest play rules.** Guests get a temporary ID used only to run the game session, no chat, no purchases and no profile. The age gate appears when a guest makes an account, so guest play stays instant without collecting personal data.

## Build order

The live roadmap, with every item and its status, is [`docs/ROADMAP.md`](ROADMAP.md). In short, the beta comes as soon as Phase 1's must-have items are done, then weekly releases. Being first matters more than being complete, but the beta has to meet what creators and players expect out of the box.

0. **Safe hosting** (done): upload, scan, sandboxed game domain, directory, reports and takedowns.
1. **Beta:** launch prerequisites (zaisma.gg, image matching, DMCA agent, paid plans), guest multiplayer and invite links, accounts and cloud saves, the creator MCP and one-prompt publishing, launch content and share cards. **Open the public beta.**
2. **Earn:** the Zaisma buy sheet, owned items, purchase rules, at-cost multiplayer billing, deposits, donations.
3. **Play together:** friends, Zaisma in Discord.
4. **Discover:** the progress bar, real ratings, player lists, follows and the rest of the creator marketing kit.
5. **Create together:** remixes, teams, mods, the Tools tab.
6. **Grow:** bigger game servers, custom game domains, the Wavedash switch, subscriptions.

## First 100 games and targets

The goal for the first 90 days after beta: 100 listed games and 10,000 monthly players, most arriving through guest links.

- **Seed 10 games ourselves** with Claude Code, each a different style and genre, all multiplayer with guest links. They prove the "anything goes" pitch on day one.
- **Recruit 90 developers** from people already posting AI-made games on X, Reddit (r/aigamedev, r/IndieDev), Discord and itch.io. Offer free hosting, a featured slot and one-prompt publishing.
- **Weekly game jam** with a theme and a front-page feature for winners; each entry is a new listing and every share is a guest link.

| Metric | 90-day target |
| --- | --- |
| Games listed | 100 |
| Monthly players (guests + accounts) | 10,000 |
| Guests who make an account | 15% |
| Games with paid items | 10 |

## Tools tab (after launch)

After the beta (Phase 5), Zaisma adds a Tools tab for free, open-source developer tools: asset pipelines, engines, level editors, Claude Code skills and plugins. Games lead the launch so the player crowd forms first; tools then make more and better games.

- **Rules:** the same as games. Free to list, no cut, scanned before going live, same progress bar for the front page.
- **Requirement:** a tool must be open source to be listed.
- **Why:** creators already build tools for each other with Claude. Every good tool on Zaisma brings its users' next games with it.

## Competitors and how we win

The closest competitor is Wavedash: browser games by link, accounts, friends and lobbies, with a 10% + $0.50 fee per purchase. Zaisma wins on openness, price, freedom and real multiplayer.

|  | Wavedash | Astrocade | Zaisma |
| --- | --- | --- | --- |
| Focus | Polished indie games for the browser | AI-made casual games on its own creation tool | Every kind of game, any engine, including AI-made |
| Fee | 10% + $0.50 per purchase | Creators paid by playtime | No cut |
| Payments | Their checkout only; crypto banned | Platform-run | Any method, including Bitcoin |
| Multiplayer | Direct player-to-player only | Not stated | Real servers at cost, or bring your own |
| Open source | Toolkits only | Not stated | Everything, MIT license |
| Scale | $4.3M seed; beta since Dec 2025 | 10M monthly players; $56M raised | Pre-beta, building in public |

One-command switch from Wavedash goes on the roadmap after the beta, along with bigger game servers at cost (Cloudflare Containers), playing inside Discord and custom game domains: developers can point their own domain at their game (Cloudflare for SaaS; the first 100 domains cost us nothing).

## License and name

Everything is MIT licensed: anyone can copy, fork or run their own Zaisma. The name is shown as Zaisma™ from day one, which costs nothing; a US trademark filing (about $350) follows once donations cover it, only to stop anyone else from claiming the name and forcing a rename.

## Sources

- [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Supabase pricing](https://supabase.com/pricing)
- [Stripe Connect pricing](https://stripe.com/connect/pricing)
- [Stripe age requirements](https://support.stripe.com/questions/age-requirement-to-create-a-stripe-account)
- [COPPA amendments, Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/tag/coppa)

* [Wavedash docs](https://docs.wavedash.com/getting-started/introduction)
* [GamesBeat: Wavedash seed round](https://gamesbeat.com/wavedash-raises-4-3m-to-bring-high-end-pc-games-to-browsers/)
* [GamesBeat: Astrocade hits 10M monthly players](https://gamesbeat.com/?p=336386)
