# Ideas inbox

Ideas waiting for a decision. Nothing here is decided or scheduled. When Julius decides one, it moves to `docs/DECISIONS.md` and `docs/ROADMAP.md` and is removed from here.

## Demos for upcoming games (Oct 12, 2026)

Zaisma as the place for playable demos of upcoming or existing games, especially Steam releases. AI makes a web demo quick to build, and a link-to-play demo beats a download.

- A **Demo** label on listings, plus "Coming to Steam" or similar.
- An end-of-demo screen (SDK call) and the game page both point to the wishlist, Steam page or wherever the creator wants. Tracked links show how many wishlists came from Zaisma.
- Fits the planned creator links and "Wishlist on Steam" button. Timing idea: Steam Next Fest.
- Open questions: the demo must show the real game (no-slop rules); demos of engine games need a web build.

## Launch marketing blitz (Oct 12, 2026)

Hit every front at once at launch.

- Personal messages to creators posting clips of their games: Claude drafts each one from the creator's own posts, Julius reads and sends it himself at a human pace, as the founder. No automated or bulk messaging.
- Aevon's AI receptionist answers inbound calls and messages for Zaisma (inbound only, as it works today), taking support load off our shoulders.
- Posts on Reddit, forums and social media; our own accounts posting clips and resharing creators.
- The pitch writes itself: AI-friendly, fully open source, 0% cut.
- **AI-readable docs:** a developer asks their AI "tell me about Zaisma" and gets every selling point, how hard integration is, the strings attached (none) and an FAQ. An `llms.txt`, a clear docs site, and an "about Zaisma" answer in the MCP.
- Open questions: many subreddits and the Roblox forums ban self-promotion, so check each community's rules before posting.

## Player profiles and achievements (Oct 12, 2026)

- Profile pictures, banners and frames, custom or unlocked by playing. Deep customization like Steam profiles.
- Games award achievements that show on profiles, link back to the game, and can unlock real rewards (a profile picture, banner or frame).
- Friends see each other's profiles: games played, achievements.
- Games show names and profile pictures on leaderboards through the SDK.
- Open questions: teen profiles are private by default; uploaded pictures need scanning; achievements that unlock rewards need to be hard to fake.

## A personality, not corporate slop (Oct 12, 2026)

- The UI should be as creative as the logo. The home screen is the games.
- Sign-up opens full screen: a monochrome gray 3D cube-mesh city, like a Mirror's Edge loading screen, with a simple sign-up form beside it.
- A voice players and creators actually relate to, like early Discord's proud gamer attitude. Never "powering imagination" style corporate copy.
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
