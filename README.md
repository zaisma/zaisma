# Zaisma

**Every kind of game. One link away.**

Zaisma (ZAI-zmuh, from the Lithuanian *žaismas*, "play") is an open-source game platform for the browser.

- **Play instantly.** Tap a link and you're in the game: no account, no download, any device.
- **Publish anything.** Any web game, any engine, any style, including games made with AI tools like Claude Code. Players can install any game for offline play.
- **Keep your revenue.** No cut of your sales. Use our free checkout, your own Stripe, or any payment method you like, including Bitcoin.
- **Multiplayer your way.** Use our rooms, free for small games and cheap after that, or run your own servers. Accounts, friends and invite links keep working either way.
- **Fully open.** Every line of the platform is MIT licensed. Read it, fork it, run your own.

## Status

Pre-beta. Building in public.

| Phase | What ships |
| --- | --- |
| 0. Safe hosting (live) | Scan before publish, sandboxed game domain, directory, reporting |
| 1. Beta | Guest multiplayer and invite links, accounts and cloud saves, the developer MCP for publishing from any AI tool. **Public beta.** |
| 2. Earn | The Zaisma buy sheet, purchases that follow players, hosting billing, Zaisma Pro, promoted games |
| 3. Play together | Friends, Zaisma in Discord |
| 4. Discover | Quality-ranked front page, real ratings, player lists, follows |
| 5. Create together | Remixes, teams, mods, the Tools tab |

The full, live roadmap is in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## License

[MIT](LICENSE). Zaisma is free and open. Copy it, fork it, run your own.

## Run it yourself

Zaisma is three Cloudflare Workers: `apps/site` (zaisma.com: directory, game pages, reports, admin, scanning), `apps/games` (the game domain: serves game files, sandboxed) and `apps/rooms` (rooms.zaisma.com: player passes and multiplayer rooms). Shared code is in `packages/core`, the game server API in `packages/game-server`, the browser SDK in `packages/sdk` and the demo games in `examples`.

```sh
npm install
cp apps/site/.dev.vars.example apps/site/.dev.vars
cp apps/games/.dev.vars.example apps/games/.dev.vars
cp apps/rooms/.dev.vars.example apps/rooms/.dev.vars   # then add a signing key (see the file)
npm run db:migrate:local
npm run dev:rooms   # http://localhost:8789
npm run dev:games   # http://localhost:8788
npm run dev:site    # http://localhost:8787, admin at /admin
npm test
```

To run your own Zaisma, create a D1 database, two R2 buckets (game files and cloud saves) and a queue (names in the two `wrangler.jsonc` files), put the database ID in the three files, set your site, game and rooms addresses, protect `/admin` with Cloudflare Access, set the rooms Worker's `PASS_SIGNING_KEY` secret, point `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` at your Supabase project for accounts (and set the site's `SUPABASE_SECRET_KEY` secret so accounts can be deleted, and its `SIGN_IN_SIGNING_KEY` secret for Sign in with Zaisma: `node scripts/sign-in-key.mjs | npx wrangler secret put SIGN_IN_SIGNING_KEY --config apps/site/wrangler.jsonc`), and deploy `apps/rooms`, `apps/games` and `apps/site`, in that order (the site reaches games' databases through a service binding to the rooms Worker, `zaisma-rooms`).

### Multiplayer

Games include the SDK with `<script src="_zaisma/v1.js"></script>` and call `await Zaisma.joinRoom()`. Its reference is its types, [`packages/sdk/zaisma.d.ts`](packages/sdk/zaisma.d.ts) (served beside it as `_zaisma/v1.d.ts`): every call, option, event and error code, explained. Save it beside your game's folder (uploads take no `.ts` files) and put `/// <reference path="../zaisma.d.ts" />` (and in JavaScript, `// @ts-check`) at the top of your script, and your editor and AI get errors instead of guesses. A room link (`zaisma.com/g/<game>?room=CODE`) drops friends into the same match, as guests or signed in. A game that needs a Zaisma account for multiplayer or the whole game (its `account_requirement` setting) gives guests no passes (`error.code === "account_needed"`), and its page asks them to sign in. Any game can ask a guest to sign in while it runs with `await Zaisma.player.signIn()`: the page offers an account beside the game, signing in happens in a new tab so the game keeps running, and the next `Zaisma.player()` or `joinRoom()` is the account's. Player passes come from the game's zaisma.com page, which checks that a real browser opened it (Cloudflare's invisible check, started as the page opens so Play doesn't wait), so bots can't fill rooms: a game opened anywhere else, or a browser the check can't confirm, can't join (`error.code === "unchecked"`).

Multiplayer is server-client: the *client* is the game in the browser, the *game server* holds the official state and checks every move, and a *room* is one live match running one copy of the game server. A game server is a plain object:

```ts
export default {
  maximumPlayerCount: 8,   // up to 16
  ticksPerSec: 20,         // leave out for turn-based games so the room sleeps between moves
  setup: (setupData) => ({ players: {} }),  // setupData: what room.reserve() passed, for a room another room made, else null
  onJoin(state, player, room, joinData, joinInfo) {}, // joinData: what the player's game passed to joinRoom({ joinData }), else null;
                                                       // joinInfo: { fromRoomCode, isReturning } (isReturning: back to a held seat)
  canJoin(state, player, room, joinData, joinInfo) {}, // true (or nothing) lets them in; false or { refusalMessage } turns them away
  onLeave(state, player, room, leaveInfo) {},  // leaveInfo.reason: left, lost, idle, hidden or kicked
  onMessage(state, player, message, room) {},
  onTick(state, tickDurationSec, room) {},     // tickDurationSec: seconds since the last tick
  onRequest(player, request, server) {},       // a request outside any room (Zaisma.server.request): answer it (below)
  schedules: [{ name: "daily-reset", cron: "0 0 * * *" }], // runs by itself, in UTC (below)
  onSchedule(run, server) {},                  // run.name: which schedule is due
};
// room.broadcast(message, { exceptPlayerId }), room.send(playerId, message), room.players, room.end(message),
// room.setListed(false), room.setOpen(false), room.reserve({ playerIds, setupData }),
// await room.database.query(sql, values), await room.database.batch([{ sql, values }])  (the game database, below)
```

Names follow [`docs/NAMING.md`](docs/NAMING.md): whole words, with the unit in the name. A game server with an option it doesn't take doesn't start, and says which ones it does take (`unknown_option`); the SDK refuses options and events it doesn't take the same way. Every message between a game and its room says its `type`, and a game's own messages travel in `data`; rooms count messages, not their size, so whole words cost nothing.

`canJoin` decides who comes in, before they join: answer `true` (or nothing) to let them in, `false` to turn them away, or `{ refusalMessage: "Wrong room password." }` to turn them away with a message they see (up to 200 characters). Any other answer, like a string, turns them away too, and shows in your game server's errors with what to answer instead. Only decide there; change the state in `onJoin`.

```ts
canJoin(state, player, room, joinData) {
  return joinData?.password === state.password || { refusalMessage: "Wrong room password." };
},
```

Games without server code can use the built-in `relay`, which passes each message to everyone else as `{ fromPlayerId, data }`. See `examples/arena` (real-time) and `examples/four-in-a-row` (turn-based).

#### Your game server on Zaisma

Put your game server in a `zaisma-server/` folder at the top of your upload and set multiplayer to "Your game server" (dashboard), or `multiplayer: "own"` (MCP or API). Zaisma's rooms run it for you:

```
index.html
zaisma-server/
  index.js        export default { setup, onJoin, onMessage, ... }
  physics.js      import { step } from "./physics.js" works in index.js
  levels/docks.js
```

- **Plain JavaScript ES modules:** `zaisma-server/index.js` default-exports the game server above, and can import the folder's other files by relative path: `.js` code, `.json` data (`import levels from "./levels.json"`) and `.wasm` WebAssembly, like a physics engine (`import mod from "./physics.wasm"` gives a `WebAssembly.Module`; `new WebAssembly.Instance(mod, imports)` starts it). Packages from npm (`import "lodash"`) and TypeScript need a build step: bundle into one `zaisma-server.js` at the top of the upload instead (`npx esbuild server.ts --format=esm --bundle --outfile=zaisma-server.js`). Up to 500 files and 5 MB.
- **Sealed off:** no internet and nothing of Zaisma's but its own game's database, so it only talks to its players through `room` and its answers to their requests. State is plain JSON.
- **Private:** players never get its files; the game domain refuses `zaisma-server/` and `zaisma-server.js`.
- **Kept in check:** an error in a handler loses that one message or tick and the match carries on. A handler that runs on too long (a loop that never ends) is stopped after about 2 seconds, freezing the match meanwhile, and a match stopped twice ends. Your dashboard and the MCP's `get_stats` show these errors with the file and line they came from.
- **Updates:** rooms keep the version they started with until they end; new rooms get the live version.

The same file runs on your own machine too (below), so you can test it there or move off Zaisma any time.

#### The game database

Every game has its own SQLite database, part of its hosting: shared by all its rooms, kept between matches, for what the game server owns or must trust (inventories, leaderboards, bans, worlds). Players' own progress belongs in cloud saves, which need no code. The game server uses it as `room.database` with plain SQL, in any handler that awaits it:

```js
async onJoin(state, player, room) {
  await room.database.query("CREATE TABLE IF NOT EXISTS scores (player_id TEXT PRIMARY KEY, best_score INTEGER NOT NULL)");
  const [mine] = await room.database.query("SELECT best_score FROM scores WHERE player_id = ?", [player.id]);
  room.send(player.id, { bestScore: mine?.best_score ?? 0 });
},
async onMessage(state, player, message, room) {
  if (message.type === "finished") {
    await room.database.query(
      "INSERT INTO scores VALUES (?, ?) ON CONFLICT (player_id) DO UPDATE SET best_score = max(best_score, excluded.best_score)",
      [player.id, state.scores[player.id]],
    );
  }
},
```

- **`query(sql, values)`** runs one statement and answers its rows as objects (`[]` when it returns none). `values` fill its `?`s in order: text, numbers, `null` or a `Uint8Array` (use 1 and 0 for true and false; store objects as `JSON.stringify` and read them with `JSON.parse` or SQLite's JSON functions). To see what an `INSERT`, `UPDATE` or `DELETE` changed, add `RETURNING`.
- **`batch([{ sql, values }, ...])`** runs up to 100 statements in one transaction, so they all happen or none do (moving an item between two inventories, say), and answers each one's rows. `BEGIN` and `COMMIT` aren't taken; batch is the transaction.
- **Errors** are a `DatabaseError` with a `code` and a `fix`: `bad_sql` (SQLite's own message, or more than one statement in a query), `bad_values`, `too_many_rows` (over 10,000 rows; page with `LIMIT`), `database_write_limit`, `database_read_limit`, `database_storage_limit` and `database_unavailable`.
- **Free on Zaisma up to 500,000 rows written and 500 million rows read a month, and 500 MB stored, per game.** Until hosting billing is ready, a game past its written rows can't write until the month resets (UTC), and one at its storage can change and delete rows but not grow; reads keep working. Past its read rows, it waits for the month too. Every statement counts the rows SQLite touched, like Cloudflare's billing: an index makes lookups read fewer rows.
- **You and your AI reach it too:** look at its tables and use, query it, fix data and change tables through the developer API, the MCP (`get_database`, `query_database`, `batch_database`) or `zaisma database` in a terminal, with the same checks and limits (see "The game database" in [`docs/DEVELOPER-API.md`](docs/DEVELOPER-API.md)).
- **The same code on your own server:** the Node runner keeps the database in a local SQLite file (below), checked the same way, with no limits. Copy the file to move the data.

#### Room browsing

Open rooms are listed on the game's page (how full each is and where it runs, never who's in it), with "playing now" under the title (every room counts, hidden ones too), and the game gets the same list to show its own way:

```js
const { rooms, playing, regions } = await Zaisma.rooms.list();   // how full each room is and where it runs, never who's in it
Zaisma.rooms.list({ region: "EU", labels: { Mode: "Classic" } }); // one region, or rooms with these labels
const room = await Zaisma.rooms.quickJoin();  // the linked room, else a busy room with space nearby, else a new one
Zaisma.joinRoom({ isListed: false });         // a new room that's never listed: a private match
Zaisma.joinRoom({ name: "Ana's castle", labels: { Mode: "Classic", Map: "Docks" } });  // name and label a new room
await Zaisma.filterText(typed);              // { isAllowed, reason, text }: Zaisma's text filter, if you want it
```

Rooms can have a name and up to 4 labels (like Mode and Map), set by your game server with `room.setInfo({ name, labels })`, by the room's first player with the relay, or when the room is made. Names and labels players type are fine; on zaisma.com they show only if they pass Zaisma's text filter (no links, handles, emails, phone numbers or contact apps; no slurs or sexual words), and players can report them. Inside your game they're yours to look after, under the content rules.

On the game server, `room.setListed(false)` hides a room (its code and links still work) and `room.setOpen(false)` closes it to new players once a match starts; players who were in it can still come back. With the relay, the room's first player can do the same from the game (`room.setListed`, `room.setOpen`, `room.setInfo`). In the dashboard, a game lists its rooms on the page and in the game, only in the game, or nowhere.

Join on the game page is an ordinary room link, so the game decides what comes first:

- **Straight in:** call `joinRoom()` or `quickJoin()` when the game starts; both follow the link.
- **A menu or character customizer first:** check `Zaisma.rooms.linkedRoomCode`, show your screen, then join with what the player picked: `joinRoom({ joinData: { character: "knight" } })` hands it to your game server's `canJoin` and `onJoin` (plain JSON, up to 4 KB; it comes from the player's browser, so check it like any message). If the room filled up meanwhile, `joinRoom` fails with `error.code === "full"` and `quickJoin` finds another.
- **Your own lobby:** list rooms only in the game and draw them yourself from `Zaisma.rooms.list()`.

#### Lobbies and matches

A room can make a room for some of its players and send them there, like a lobby starting a match:

```ts
const roomCode = room.reserve({ playerIds: [a.id, b.id], setupData: { map: "Docks", teams } });  // in your game server
```

```js
room.on("move", (move) => { room.leave(); move.join(); });  // in the game: go to the new room
```

The new room runs the same game server, and its `setup(setupData)` gets your setup data, so it can start the match already set up (players can read it but can't change it; up to 4 KB). It's ready before anyone hears its code, only the players named can join it (it's a closed room, until your server opens it), and it's hidden from room lists unless you pass `isListed: true` (with a `name` and `labels` if you like). To send players to a room that's already running instead, like the next area of an open world, use `room.moveTo(roomCode, { playerIds, joinData })`: the other room's `canJoin` decides, and `onMoved(state, moveResult, room)` hears `{ roomCode, movedPlayers, refusals }`. A room can reserve up to 20 rooms a minute. See `examples/four-in-a-row`: its "Find an opponent" waits in a lobby room until there's someone to play.

Playing alone needs no room, so don't make one until others can join: time in a room counts toward hosting even with one player. Each game gets 1,000 player-hours a month on Zaisma rooms free (the dashboard shows how much it has used). Until hosting billing is ready, that's also the most it can use: past it, new rooms don't open until the month resets (UTC) and joining fails with `error.code === "month_limit"`, while matches already running carry on.

#### Players who walk away

Players who walk away stop holding seats and running matches, in every game, with no code:

- **Lost connections** (a closed laptop, lost signal): the SDK pings the room every 25 seconds without waking it, and a connection that stops answering is dropped about a minute later. The SDK says goodbye as the page closes, so most players leave at once.
- **Idle:** after 10 minutes without input the SDK asks "Still there?" with a small plate at the top of the game for 30 seconds; no answer, and the player walks away. Rooms check for themselves too: a game that sends nothing at all for a minute past that counts as idle.
- **Hidden:** in a real-time room (one with `ticksPerSec`), a game hidden for 2 minutes counts as away.

A player who walks away or loses their connection leaves the match (`onLeave` with `leaveInfo.reason`) and the room holds their seat for 5 minutes: they come straight back to it with any input, or by reconnecting, and `onJoin` gets `joinInfo.isReturning`. Held seats count toward `maximumPlayerCount`, but players who walked away don't count as playing now or toward how full a room looks, and a room where everyone's away stops ticking. Once the seat runs out, the SDK offers their old room again if it has space. Zaisma never covers your game or sends anyone away from it for being idle.

Your game server picks what happens:

```ts
export default {
  idleCheck: "server",       // who checks: "server" (the default), "client" (each player's game decides), or "off"
  idleTimeoutSec: 300,       // seconds without input before "Still there?" (default 600)
  seatHoldDurationSec: 120,  // seconds a seat stays held (default 300, up to 1800; 0 for none)
  awayMode: "lobby",         // send players who walk away back to the room that made this one (room.reserve); "hold" is the default
  onAway(state, player, room, reason) {},  // or decide yourself: the player stays in the room, you kick, move or keep them
  onBack(state, player, room) {},          // a player onAway kept came back
};
```

In the game, all of it is optional:

```js
room.on("connectionStatus", (connectionStatus) => {});        // "away" while out of the match
room.on("away", ({ reason, seatHoldDurationSec }) => {});     // reason: "idle" or "hidden"; the seat is held that long
room.on("idle", (isAsking) => {});            // ask "Still there?" your way: true to show it, false when answered or over
room.on("back", (back) => back.rejoin());     // back after the seat ran out: listening turns off rejoining by itself
Zaisma.joinRoom({ idleCheckEnabled: false }); // no "Still there?" in this game (where idleCheck is "client", as with the relay, the room follows this)
```

Your own clients follow the same protocol: send the text `ping` every 30 seconds or so (the room answers `pong`), `{"type":"idle"}`, `{"type":"hidden"}` and `{"type":"shown"}` as they happen, and `{"type":"back"}` when the player returns. Errors from the room are `{"type":"error","code":"full","message":"This room is full."}`, with codes in lowercase snake_case: `full`, `closed`, `ended`, `kept_out`, `refused`, `month_limit`, `bad_pass`, `no_hello`, `bad_message`, `too_big`, `too_fast`, `not_allowed`, `game_unavailable`, `busy` and `no_room`.

#### Requests to your game server

Not everything needs a room. A game's own game server can also answer plain requests from the game, for a leaderboard, a shop or a daily reward, in single-player games too. Give it `onRequest`, and the game calls it with `Zaisma.server.request`:

```js
// zaisma-server/index.js (or zaisma-server.js)
export default {
  async onRequest(player, request, server) {
    await server.database.query("CREATE TABLE IF NOT EXISTS rewards (player_id TEXT PRIMARY KEY, claimed_date TEXT NOT NULL)");
    if (request.type === "claimDailyReward") {
      const today = new Date().toISOString().slice(0, 10);
      const [claimed] = await server.database.query("INSERT INTO rewards VALUES (?, ?) ON CONFLICT (player_id) DO UPDATE SET claimed_date = excluded.claimed_date WHERE claimed_date < excluded.claimed_date RETURNING player_id", [player.id, today]);
      return { isClaimed: Boolean(claimed) };
    }
    return { error: "unknown request" };
  },
};

// In the game:
const { isClaimed } = await Zaisma.server.request({ type: "claimDailyReward" });
```

- **`onRequest(player, request, server)`** answers what the game gets back: plain JSON, up to 1 MB, within 10 seconds. `player` is who sent it, from their player pass, so a player can't claim someone else's reward. `request` is the game's plain JSON, up to 16 KB, from the player's browser, so check it like any message and say what it's for in its `type`. There's no room and no state: what lasts goes in `server.database`, the same game database the game's rooms use.
- **Rooms or not:** a game server with only `onRequest` needs no `setup()` and runs no rooms; one with both does both. Requests work whatever the game's multiplayer setting, as long as its live version has the game server in its `zaisma-server/` folder or `zaisma-server.js`, run in the same sealed sandbox as its rooms.
- **Errors:** the game gets an `error.code`: `no_request_handler` (no `onRequest`), `game_server_error` (it threw, answered something that isn't plain JSON or over 1 MB, or took over 10 seconds; you see why with your game server's errors in the dashboard and `get_stats`, with the file and line), `request_limit`, `too_big`, `slow_down` (over about 120 a minute from one address) and the pass's own (`unchecked`, `account_needed`, `bad_pass`). A game server that keeps running on too long (a loop that never ends) is paused for a few minutes.
- **Free on Zaisma up to 1 million requests a month per game.** Until hosting billing is ready, past them requests answer `request_limit` until the month resets (UTC). Your dashboard and `get_stats` show the month's count.
- **On your own server** the Node runner answers the same requests at `POST /v1/requests/<game>` on its port, with `server.database` its local SQLite file: `Zaisma.server.request(request, { serverUrl: "https://play.example.com" })`. Any server can answer them the same way: the body is `{ pass, request }` as JSON (sent as `text/plain`, so browsers need no preflight), and the answer `{ answer }` or `{ error: { code, message } }`.

#### Schedules

A game's own game server can also run by itself, for a daily reset, a weekly leaderboard or a persistent world's turns. List its `schedules`, each a name and a cron, and `onSchedule` runs at each:

```js
// zaisma-server/index.js (or zaisma-server.js)
export default {
  schedules: [
    { name: "daily-reset", cron: "0 0 * * *" },    // every midnight, UTC
    { name: "world-turn", cron: "*/15 * * * *" },  // every 15 minutes
  ],
  async onSchedule(run, server) {
    if (run.name === "daily-reset") {
      // Safe to run twice: it only resets what's older than this run.
      await server.database.query("DELETE FROM daily_scores WHERE scored_at < ?", [run.scheduledAt]);
    }
    if (run.name === "world-turn") await server.database.query("UPDATE crops SET growth = min(growth + 1, 10)");
  },
};
```

- **`cron`** is the usual five fields, minute hour day-of-month month day-of-week, always in UTC: numbers, `*`, ranges (`1-5`), steps (`*/15`) and lists (`1,15`). `"0 4 * * 1"` is Mondays at 04:00. So a schedule runs at most once a minute; anything faster belongs in a room's `onTick`. A cron that doesn't read stops the game server starting, and says why.
- **`onSchedule(run, server)`** gets `run.name`, `run.cron` and `run.scheduledAt`, the minute it was due (an ISO time). There's no room, no player and no state: what lasts goes in `server.database`, the same game database the game's rooms and requests use. It has 30 seconds. A run can rarely come late or twice (after a restart), so make it safe to repeat, like a reset that checks `run.scheduledAt`.
- **Up to 10 schedules, free on Zaisma.** They run with the live version's game server, whatever the multiplayer setting, within a minute of it going live; a version without them stops them, and so does a game taken down. A game server with only schedules needs no `setup()` and runs no rooms. Your dashboard and `get_stats` show each schedule with its next and last run, the runs per day, and any errors with the schedule's name, file and line.
- **On your own server** the Node runner runs the same schedules at the same minutes while it's up, with `server.database` its local SQLite file, and prints a run's errors. A run due while it's down is missed.

#### Run your game server yourself

The same game server runs on your own machine with Node 23.6 or later:

```sh
node packages/game-server/bin/node.js ./server.ts --game <your-game> --port 8080 --database ./zaisma-database.sqlite
```

`room.database` there is that SQLite file, made the first time the game uses it (`zaisma-database.sqlite` where you start it, unless `--database` says otherwise).

Put it behind HTTPS, add its address (like `wss://play.example.com`) to the game's own servers on Zaisma, and join with `Zaisma.joinRoom({ serverUrl: "wss://play.example.com" })`. Players still arrive with Zaisma player passes: standard EdDSA JWTs your server checks against the keys at `https://rooms.zaisma.com/.well-known/jwks.json`, so any language's JWT library can check them too. A pass proves only who the player is: its `sub` is the player's ID (`player_…`), `kind` is `account` (a signed-in Zaisma account, with the same ID in every game) or `guest` (a new ID for each pass), and `aud` is the game. A guest's pass also carries their generated `name`; an account's name comes from its public profile at `https://rooms.zaisma.com/v1/players/<id>`, which the Node runner looks up for you. Game servers see the same `kind` on every player.

An account's pass also says who it can chat with, never its age: `social_mode` (`solo_focused`, `friends_focused` or `open_and_social`), when open and social an opaque `chat_group` (`chat_group_…`, different in every game), and `friend_player_ids`, the player IDs of its Zaisma friends (up to 200). Before your server passes chat between two players, ask `canChat(first, second)` from `@zaisma/game-server` with their checked passes: guests and solo-focused players never chat, friends chat when each pass lists the other, and open-and-social players also chat within the same chat group. A change of social mode or friends reaches your server with the player's next pass.

### Cloud saves

Signed-in players' progress follows them to any device, with no code in the game. The games server adds a small script (`packages/sdk/saves.js`) to each page of a game; it hands the game's localStorage to the Zaisma game page around it, which stores it with the player's account. Before the game starts, the account's save is put back in place. Games that keep their own saves can turn this off in admin.

### How games are kept safe

- Every upload is scanned before it goes live: file-type and executable checks, static malware checks, known-illegal-image matching and an AI review. Anything unclear waits for a person.
- Games run on a separate domain inside a sandboxed frame, with a strict Content Security Policy: no access to zaisma.com, no cookies, no outside scripts, and connections only to Zaisma rooms and the game's own listed servers.
- Every game page has a Report button. Takedowns apply instantly and are logged.
