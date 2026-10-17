# Building blocks, not Zaisma-run features

The principle behind "Your game is your game" and "Zaisma is the player's layer; the game is the developer's" in [`DECISIONS.md`](../DECISIONS.md). This file is its casebook: what the principle means, how to test a feature against it, and every real call made under it, so the next decision is made with confidence instead of guessed. Every case is a real Zaisma call. When a talk settles a new one, it's added here in the same change.

## The rule

**Zaisma provides hosting, plumbing, proof of who's who, and the safety floor. The game decides every rule, every screen and what everything means.** If any game would want something to work differently, it's the developer's call, and Zaisma gives them the tool instead of making the call for them.

## Why it exists

Developers come to Zaisma to publish their game, not a game partly made by Zaisma. Every screen, rule or default Zaisma adds inside a game is something the developer didn't choose and may have to fight. Roblox is the opposite: the platform shapes every game, and every game feels like Roblox. The money model depends on this too: Zaisma earns from services like hosting, never from a cut, so it has no reason to own anything in the game (Oct 13 and 14, 2026).

The pull the other way is constant. A Zaisma-run feature always looks helpful ("players can restore their save!"), and it's quicker to build one screen than a building block. That's how the save screens crept in, and why this file exists (Julius, Oct 16, 2026).

## The test

Go through these in order. The first one that applies decides.

1. **Does it decide a game rule?** What progress means, whether a player can go back, which progress wins, who's banned, who can play, what's for sale and at what price, which badges exist, who can talk to whom beyond the safety floor. → **The game's.** Zaisma provides the tool (an API, an SDK call, a setting) and nothing more.
2. **Does it draw on or over the game frame?** → **Not allowed,** unless the player opened it themselves, or it's on the list of things Zaisma runs below (safety or money needing one screen that looks the same in every game).
3. **Would some genre want it different?** Horror (no going back to an area), roguelikes (death is final), MMOs (no rerolling a character), competitive games (no undo), narrative games (choices stick). → **Zaisma doesn't do it.** At most it's a default that changes no rule, and the developer turns it off with a setting, not only with code.
4. **Can the developer do everything it does through the API, MCP or SDK?** → If not, **it isn't a building block yet.** Build that part first.
5. **Is the only reason that Roblox, Steam or itch.io does it this way?** → **Not a reason.** Find the reason or drop it.

When a feature passes all five, it's a building block. When it fails one, the answer is almost always: keep the plumbing on Zaisma's side, and move the screen or the rule into the game through the SDK.

## What Zaisma runs, and why

These are the only things Zaisma runs itself. Each has a named reason; anything else needs a talk with Julius first.

- **The safety floor:** scanning, mute, block and report, the report plate, the text filter for under-18 accounts, social modes, teen privacy, Zaisma's own account bans, the "You're leaving Zaisma" notice on outside links. The law and player safety need these to work the same in every game.
- **The buy sheet:** one screen for paying in every game, because card details and player trust need one screen players recognize. The developer still sets the item and the price, and is the seller.
- **What follows the player outside the game frame:** account, friends, library, profile, ratings, and showing achievements. Each piece is about playing, controlled by the developer for their own game and open to them through the API.
- **The developer forum:** it's about Zaisma itself, not about any game.

## Cases

### Passes

- **Cloud saves mirror the game's own browser save,** with no code and nothing on screen. The game behaves exactly as it does in one browser, and progress follows the player to other devices. A game with its own saves turns it off. Kept as plumbing when the save screens went (Julius, Oct 16, 2026).
- **Saves through the API:** the developer lists, reads, changes, resets and restores their players' saves. The backstop copies are theirs to use, not a player feature (Julius, Oct 16, 2026).
- **The game database is real tables and queries,** used from the game's servers, with full access for the developer and their AI. No Zaisma key-and-value screens (Oct 14, 2026).
- **Bans, moderators and roles are the game's own lists** by player ID, in its database or on its servers. Zaisma keeps only its own account bans, which are safety (Oct 14, 2026).
- **Chat:** Zaisma hosts the connection and keeps the safety floor (filter, mute, block, report); the game draws the chat box and makes the rules. Zaisma stores no chat.
- **Invites:** the game knows when to invite ("waiting for players"), so it calls `Zaisma.invite(room)`. Zaisma doesn't pop an invite screen on its own.
- **Achievements:** the developer defines and unlocks them; Zaisma shows them on the profile, outside the frame, and never invents badges for a game (Oct 14, 2026).
- **Who plays:** the game chooses guests, accounts or a mix, per room, for multiplayer or for the whole game. Zaisma's player pass only proves who the player is (Julius, Oct 16, 2026).
- **Moving and kicking players** is the game server's: `room.kick`, `room.reserve`, `room.moveTo`. Zaisma follows the move; the game decides it.
- **Leaderboards** live in the game's own database, served by its game server. There's no Zaisma leaderboard screen.

### Fails, and what we did instead

- **Restoring a save from the account page or the game menu.** It let a player undo a roguelike death or reroll an MMO character from outside the game, breaking the game's rules. *Instead:* copies are a backstop only the developer reaches (API and MCP), and a game that wants rollback builds it with `Zaisma.saves.getHistory()` and `restore()` (Julius, Oct 16, 2026).
- **A "Which progress do you want?" chooser over the game.** Zaisma UI deciding a game rule. *Instead:* the progress played most recently wins, the other is kept as a copy, and an SDK game can ask its players itself with `Zaisma.saves.onConflict` (Julius, Oct 16, 2026).
- **A save manager on the account page,** listing every game's copies. Players can't do anything meaningful with it; only the game knows what its saves mean. *Instead:* nothing. A data download for the whole account covers the legal right to see your data (Julius, Oct 16, 2026).
- **A floating logo, a watermark or "more games" while someone plays.** *Instead:* a slim bar beside the game, menus only when the player opens them, and the whole screen in full screen.
- **A Zaisma chat box, platform currency or avatar inside games.** *Instead:* hosting for the game's own chat, the developer's own items through the buy sheet, the game's own characters.
- **Key-and-value data screens** in place of a database. *Instead:* a real database with tables and queries (Oct 14, 2026).
- **A game's own servers set only by a Zaisma admin.** A gate on a building block, on a page only Zaisma sees, and the check behind it was hollow: a person approving `play.example.com` sees a name, never what the server sends. *Instead:* developers set them from the dashboard, API, MCP and upload command, live at once and named on the game page, and the promise says only what we can check: every file we host is scanned (Julius, Oct 16, 2026).

### Close calls, and the ruling

- **Discord posts and GitHub issues for developers with no server.** The decisions promised both, but only developers running a server could have them, and most AI-made games are one HTML file. Zaisma making the Discord and GitHub formats itself would be the direct way, but it means holding developers' tokens and running two services' formats, with every next service a request to us. *Ruling:* a webhook can point at the game's own game server on Zaisma; the developer's code makes the post with their own tokens, for any service, and the same code runs on their own server (Julius, Oct 16, 2026).
- **A block that keeps the blocked player out of your rooms.** Safety, but Zaisma deciding who plays in a developer's game, and one player's preference enforced on another (block the best player and he can't join your lobby; one person locks a stranger out of a whole world). *Ruling:* a block is a wall both ways and the blocker's own preference: Zaisma's room picks steer the blocker away, the game learns of the block and can do the same, and nobody is ever removed or turned away for it (Julius, Oct 16, 2026).
- **Join a friend, on in every game by default.** Zaisma letting players into a game's rooms from /friends looks like Zaisma deciding who plays. But Join is only the room link the friend could have sent, and most AI-made games would never switch on a "joinable" flag. *Ruling:* on by default for games on Zaisma rooms, hidden rooms included; the game turns it off per game or per room, closes rooms and turns players away at its door, and Join shows the reason when it won't work (Julius, Oct 17, 2026).
- **Room invites inside games.** A Zaisma friend picker over the game would be the quick way to invite without a link. *Ruling:* the game draws its own picker from `Zaisma.friends` and sends through the SDK; outside the frame, /friends offers Invite on online friends, and the friend's card lands on their Zaisma pages, with the game they're in deciding whether to show it (Julius, Oct 17, 2026).
- **The "Keep your progress" card.** A Zaisma card beside the game (not inside it) that offers guests an account after 5 minutes with progress. It changes no game rule, and without it a guest's progress silently stays in one browser, since most AI-made games will never add the SDK call. *Ruling:* on by default, and a game setting turns it off (Julius, Oct 16, 2026).
- **The report plate.** A Zaisma screen beside a running game. *Ruling:* allowed, because it's safety: every report must look the same and carry the room. Games can put the Report button in their own menu with the SDK's panel.
- **The "You're leaving Zaisma" notice.** *Ruling:* allowed, because it's safety. The game still decides which of its registered links to open, and when. It's a card over the game's top corner that appears only after the player's own tap, like the sign-in ask, so the player decides while still looking at the game (Julius, Oct 17, 2026).
- **A Zaisma list of trusted domains for guests and teens.** A gate on a building block: a developer's own site opens only for signed-in adults until its domain is on Zaisma's list. *Ruling:* allowed, because it's safety with a clear test (a well-known store, payment or video site where strangers can't message players), kept by domain rather than by page, and seeded with the payment sites before the beta so developers' own payments reach every player. Guests and teens get the same rule, so it never punishes honest players, and the card never says why a link didn't open (Julius, Oct 17, 2026).
- **Room browsing on the game page.** A Zaisma screen, but outside the frame and about playing. *Ruling:* allowed, and the developer chooses where the game's rooms are listed (Oct 12, 2026).
- **The buy sheet.** A Zaisma screen over every game. *Ruling:* allowed, because card details and trust need one screen; the developer stays the seller and sets the item and price.
- **Zaisma acting on reports about trash talk and cheating.** Moderating how players talk to each other, and whether they cheat, decides a game rule; Zaisma only owns the safety floor. *Ruling:* chat between players is the game's and its moderators', with mute and block always there. Zaisma acts only where block can't help: real threats, sharing someone's personal details, following someone after they've blocked you, and anything sexual toward a teen. Cheating reports go to the developer (Julius, Oct 16, 2026).
- **A content rule against hate.** A rule with no line a developer can see makes edgy games hedge or never get made. *Ruling:* no hate rule. Real people are fair game for mocking and satire; what's out is private details that let players find or reach someone, and real threats (Julius, Oct 16, 2026).
