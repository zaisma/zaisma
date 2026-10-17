# Ideas inbox

Ideas waiting for a decision. Nothing here is decided or scheduled. When Julius decides one, it moves to `docs/DECISIONS.md` and `docs/ROADMAP.md` and is removed from here.

## Games that ask for more than an account (Oct 17, 2026)

Zaisma provides the accounts for every game, so a developer could ask for more than "an account": a level of account security or standing before a player plays, straight from Play or at a step in the game. For a serious MMO that doesn't want banned players, or players who lost and want to restart, making new accounts freely.

- **What's settled pulls the other way on identity:** no ID, face scans or third-party age checks, ever; phone numbers are never asked for; sign-up takes a birthday, a username and a password; and "what stops a banned player coming back is that a new account starts with nothing". So any level has to be built from what Zaisma already knows, not from collecting more.
- **What it could be built from, without storing anything new:** how old the account is, whether it has a passkey or an email ("Protect your account" already asks for one once there's progress), time played on Zaisma, and that Zaisma hasn't banned it.
- **A natural shape:** `account_requirement` (today none, multiplayer, whole_game) gains levels, like "an account at least 7 days old" or "with a passkey or an email". As with accounts-only games, the page says so before Play, and the backstop is the pass: players who don't meet it get none. "Games decide who plays; Zaisma proves who's who" fits: Zaisma proves a fact, the game decides. Or the pass carries yes/no facts (`is_protected`, an account-age band) and the game decides for itself, which is more of a building block.
- Bans and restarts stay the game's ("Bans, moderators and roles belong to the developer"); this only makes a fresh account slower to be worth anything.
- **Open questions:** whether an email counts for much when emails are free (one email per account helps); whether a passkey proves anything beyond "this device"; whether the facts go in the pass (any server checks them) or stay a Zaisma gate; how a player learns what they're missing and how to get it.

## Games a developer keeps from some age bands (Oct 17, 2026)

A developer can make a game unavailable to some age bands (13–15, 16–17, 18+) by their own choice, even when its content is fine for everyone: a game for adults, or one that just doesn't want young teens. Separately, content that isn't safe for a band is blocked for that band whatever the developer picks.

- **Settled calls it touches:** accounts keep only the band, never a birthday; games never learn a player's age ("Never shared: … age", and the pass carries "never the age"); "Zaisma has no adult content", and the content rules are one floor for every game.
- **A natural shape:** a minimum band per game (`minimum_age_band`), enforced by Zaisma like `account_requirement`: the page says so before Play, players under it get no passes, and the game learns only that the player was let in, never the band. It needs an account (guests have no band), so a game with a minimum band is accounts-only, or guests answer the age question first.
- **Content that's unsafe for a band** is a bigger change: today there's no content above the floor, so blocking by band means a tier above it (say, stronger violence at 16+) with rules of its own in the content rules, the scan and the AI review. Worth deciding apart from the developer's own choice.
- **Discovery:** whether a game kept from a band is hidden from that band's lists, or shown with "16 and up".
- **Open questions:** whether anyone lying about their age changes the picture ("someone who lies about their age takes that risk on themselves"); whether rooms and passes on a developer's own server honour the minimum (self-hosting must keep working: the pass would need to say the player met it); how this sits with the Under-13 support idea later.

## Earn-sats games (Oct 16, 2026)

Games that pay players sats for playing, a well-known genre in the Bitcoin community (THNDR, Zebedee). Dropped for now (Julius, Oct 16, 2026): the honest ones are funded by rewarded ads, and Zaisma games have none, so what's left would be a developer's own pocket or the scam kind (deposits, withdrawal traps, paid entries, referral pyramids), sold as "earn Bitcoin" to 13-year-olds. Revisit only if an honest way to pay for it exists, like sponsors, and players never pay in.

## Demos for upcoming games (Oct 12, 2026)

Zaisma as the place for playable demos of upcoming or existing games, especially Steam releases. AI makes a web demo quick to build, and a link-to-play demo beats a download.

- A **Demo** label on listings, plus "Coming to Steam" or similar.
- An end-of-demo screen (SDK call) and the game page both point to the wishlist, Steam page or wherever the developer wants. Tracked links show how many wishlists came from Zaisma.
- Fits the planned developer links and "Wishlist on Steam" button. Timing idea: Steam Next Fest.
- Open questions: the demo must show the real game (no-slop rules); demos of engine games need a web build.

## Launch marketing blitz (Oct 12, 2026)

Hit every front at once at launch.

- Personal messages to developers posting clips of their games: Claude drafts each one from the developer's own posts, Julius reads and sends it himself at a human pace, as the founder. No automated or bulk messaging.
- Aevon's AI receptionist answers inbound calls and messages for Zaisma (inbound only, as it works today), taking support load off our shoulders.
- Posts on Reddit, forums and social media; our own accounts posting clips and resharing developers.
- The pitch writes itself: AI-friendly, fully open source, 0% cut.
- **AI-readable docs:** a developer asks their AI "tell me about Zaisma" and gets every selling point, how hard integration is, the strings attached (none) and an FAQ. An `llms.txt`, a clear docs site, and an "about Zaisma" answer in the MCP.
- Open questions: many subreddits and the Roblox forums ban self-promotion, so check each community's rules before posting.

## Player profiles and achievements (Oct 12, 2026)

- Profile pictures, banners and frames, custom or unlocked by playing. Deep customization like Steam profiles.
- Display names: a name set from the profile and shown beside @username, which stays the account's unique name (Oct 16, 2026, from the Sign-in talk).
- Games award achievements that show on profiles, link back to the game, and can unlock real rewards (a profile picture, banner or frame).
- Friends see each other's profiles: games played, achievements.
- Games show names and profile pictures on leaderboards through the SDK.
- Open questions: teen profiles are private by default; uploaded pictures need scanning; achievements that unlock rewards need to be hard to fake.

## A personality, not corporate slop (Oct 12, 2026)

- The UI should be as creative as the logo. The home screen is the games.
- Sign-up opens full screen: a monochrome gray 3D cube-mesh city, like a Mirror's Edge loading screen, with a simple sign-up form beside it.
- A voice players and developers actually relate to, like early Discord's proud gamer attitude. Never "powering imagination" style corporate copy.
- Open questions: what the personality is in one line; any new public tagline or claim needs Julius's approval. Keep the 3D scene cheap on phones (a pre-rendered image or short loop rather than live 3D).

## Automatic game jams judged by players (Oct 12, 2026)

- Jams run automatically: weekly, monthly, quarterly and yearly. The theme is revealed when entries open; anyone can join for free.
- **The brief scales with the length,** so the time goes into quality and polish instead of scrambling to meet the theme:
  - *Weekly:* a small, clear goal plus a twist (for example "a one-button game", theme "gravity"), easy to meet on day one.
  - *Monthly:* a harder technical goal plus a theme (for example "a 3D game set in one room" or "HD-2D, theme: tides").
  - *Quarterly and yearly:* the ambitious showcase events.
- **Players vote.** Jam entries get their own shelf, and only people who actually played long enough can vote; longer play could count for more. Games have to win the click and then keep players engaged.
- Last jam's winner is shown at the top of the shelf. Optional ladder: weekly winners earn a spot or badge going into the monthly.
- Entries must be created after the theme is revealed, checked from when the game and its first version were made.
- Open questions: stopping vote rigging (alt accounts, bots); measuring playtime on our page rather than trusting the game; capping how much playtime counts so long grindy games don't win by default; prizes (featuring and badges first; money prizes bring contest law and minors' rules).

## Clips (Oct 12, 2026)

Parked: the game page doesn't need a Clip button. Phones and computers already record the screen; the only thing we'd add is "save the last 30 seconds", which means recording in the background all the time (battery and frame rate on cheap devices) for a feature most players never use, and it mainly serves short-video marketing.

- If it comes back: an opt-in SDK call games choose to use, recorded and shared on the player's device, never uploaded.
- Open questions: is there real demand from developers; can it run without hurting frame rate on low-end phones.
