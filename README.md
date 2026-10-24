# Zaisma

**Play anything, from a link.**

Zaisma (ZAI-zmuh, from the Lithuanian *žaismas*, "play") is an open-source game platform for the browser.

**For players.** Tap a link and the game starts, in any browser, on any device. There's no account to make and nothing to download: you play as a guest, and your progress stays on that device. Make an account when you want to keep your progress everywhere and play with friends.

**For game developers.** Publish any web game, from any engine, by hand or straight from your AI through Zaisma's MCP server or upload command. Every version is checked for safety before players get it. Your game can use Zaisma's multiplayer rooms with a game server, cloud saves and player accounts, or your own servers: player passes and room links work there too. Zaisma takes no cut of what you sell.

**Open source.** All of Zaisma is under the MIT license. Read it, fork it, run your own.

## Status

Before the beta. Zaisma runs at zaisma.com, but only the people building it use it for now, and anything in it may still change.

## Design

[zaisma.com/design](https://zaisma.com/design): every component of Zaisma's look, live, rendered from the site's own code. The rules are in [`docs/DESIGN.md`](docs/DESIGN.md).

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
npm run test:affected   # only the tests your change can reach
```

To run your own Zaisma, create a D1 database, two R2 buckets (game files and cloud saves) and two queues (scans and compressed copies; names in the two `wrangler.jsonc` files), put the database ID in the three files, set your site, game and rooms addresses, protect `/admin` with Cloudflare Access, set the rooms Worker's `PASS_SIGNING_KEY`, `RECEIPT_SIGNING_KEY` and `PLAYER_TAG_KEY` secrets (`node scripts/rooms-key.mjs | npx wrangler secret put RECEIPT_SIGNING_KEY --config apps/rooms/wrangler.jsonc`, the same for the pass key, and `openssl rand -base64 32` makes the player tag key), point `SUPABASE_URL` at your Supabase project for accounts and set the site's `SUPABASE_SECRET_KEY` secret (the site is the only thing that talks to Supabase; turn its publishable key off), onboard your domain to Cloudflare Email Sending for email codes (and set `EMAIL_FROM`), set the site's `SIGN_IN_SIGNING_KEY` secret for Sign in with Zaisma: `node scripts/sign-in-key.mjs | npx wrangler secret put SIGN_IN_SIGNING_KEY --config apps/site/wrangler.jsonc`, and deploy `apps/rooms`, `apps/games`, `apps/compress` and `apps/site`, in that order (the site reaches games' databases through a service binding to the rooms Worker, `zaisma-rooms`).

### Multiplayer

Games include the SDK with `<script src="_zaisma/v1.js"></script>` and call `await Zaisma.joinRoom()`. Its reference is its types, [`packages/sdk/zaisma.d.ts`](packages/sdk/zaisma.d.ts) (served beside it as `_zaisma/v1.d.ts`): every call, option, event and error code, explained. Save it beside your game's folder (uploads take no `.ts` files) and put `/// <reference path="../zaisma.d.ts" />` (and in JavaScript, `// @ts-check`) at the top of your script, and your editor and AI get errors instead of guesses. A room link (`zaisma.com/g/<game>?room=CODE`) drops friends into the same match, as guests or signed in. A game that needs a Zaisma account for multiplayer or the whole game (its `account_requirement` setting) gives guests no passes (`error.code === "account_needed"`), and its page asks them to sign in. Any game can ask a guest to sign in while it runs with `await Zaisma.player.signIn()`: the page offers an account beside the game, signing in happens in a new tab so the game keeps running, and the next `Zaisma.player()` or `joinRoom()` is the account's. Player passes come from the game's zaisma.com page, which checks that a real browser opened it (Cloudflare's invisible check, started as the page opens so Play doesn't wait), so bots can't fill rooms: a game opened anywhere else, or a browser the check can't confirm, can't join (`error.code === "unchecked"`).

Multiplayer is server-client: the *client* is the game in the browser, the *game server* holds the official state and checks every move, and a *room* is one live match running one copy of the game server. A game server is a plain object:

```ts
export default {
  maximumPlayerCount: 8,   // up to 100
  ticksPerSec: 20,         // up to 60; leave out for turn-based games so the room sleeps between moves
  setup: (setupData) => ({ players: {} }),  // setupData: what room.reserve() passed, for a room another room made, else null
  onJoin(state, player, room, joinData, joinInfo) {}, // joinData: what the player's game passed to joinRoom({ joinData }), else null;
                                                       // joinInfo: { fromRoomCode, isReturning, isSpectator } (isReturning: back to a held seat)
  canJoin(state, player, room, joinData, joinInfo) {}, // true (or nothing) lets them in; false or { refusalMessage } turns them away
  onLeave(state, player, room, leaveInfo) {},  // leaveInfo.reason: left, lost, idle, hidden or kicked
  onMessage(state, player, message, room) {},
  onBytes(state, player, bytes, room) {},      // bytes a player's game sent (room.sendBytes), a Uint8Array
  onTick(state, tickDurationSec, room) {},     // tickDurationSec: seconds since the last tick
  onRequest(player, request, server) {},       // a request outside any room (Zaisma.server.request): answer it (below)
  schedules: [{ name: "daily-reset", cron: "0 0 * * *" }], // runs by itself, in UTC (below)
  onSchedule(run, server) {},                  // run.name: which schedule is due
};
// room.broadcast(message, { exceptPlayerId, delivery }), room.send(playerId, message, { delivery }), room.players, room.end(message),
// room.broadcastBytes(bytes, { exceptPlayerId, fromPlayerId, delivery }), room.sendBytes(playerId, bytes, { delivery }),
// room.setListed(false), room.setOpen(false), room.reserve({ playerIds, setupData }),
// await room.database.query(sql, values), await room.database.batch([{ sql, values }])  (the game database, below)
// await room.verifyReceipt(receipt)  (a purchase's signed receipt, checked; server.verifyReceipt the same)
```

Names follow [`docs/NAMING.md`](docs/NAMING.md): whole words, with the unit in the name. A game server with an option it doesn't take doesn't start, and says which ones it does take (`unknown_option`); the SDK refuses options and events it doesn't take the same way. Every message between a game and its room says its `type`, and a game's own messages travel in `data`; rooms count messages, not their size, so whole words cost nothing.

`canJoin` decides who comes in, before they join: answer `true` (or nothing) to let them in, `false` to turn them away, or `{ refusalMessage: "Wrong room password." }` to turn them away with a message they see (up to 200 characters). Any other answer, like a string, turns them away too, and shows in your game server's errors with what to answer instead. Only decide there; change the state in `onJoin`.

```ts
canJoin(state, player, room, joinData) {
  return joinData?.password === state.password || { refusalMessage: "Wrong room password." };
},
```

Each player's ping, measured by the room, is `room.pingDurationMs(playerId)` on the game server and `room.pingDurationMs` in their game, and both read the room's clock with `room.serverTimeMs()` (see "Room connections" in [`docs/DEVELOPER-API.md`](docs/DEVELOPER-API.md)).

A room takes up to 100 players at up to 60 ticks a second. Each player's game sends up to 30 messages a second (a burst of 60), so a game at 60 ticks sends two inputs in one message; the game server can still send every tick. Past 100 players, split a world into rooms and move players between them (`room.moveTo`).

**Bytes:** for snapshots and inputs where JSON is too big, a game sends bytes with `room.sendBytes(bytes)` (an `ArrayBuffer` or any typed array) and gets them with `room.on("bytes", (bytes, fromPlayerId) => {})`; the game server takes them in `onBytes` and sends them with `room.broadcastBytes(bytes)` and `room.sendBytes(playerId, bytes)`. `fromPlayerId` is the player they came from when the game server passes one player's bytes on (`room.broadcastBytes(bytes, { fromPlayerId: player.id })`, as the relay does), else `null`. Bytes have the same limits as messages: up to 16 KB each, counted together with them. The MCP's `get_stats` shows each game's room traffic per player and its biggest message types, with hints on what to send as bytes or send less.

**Sending only what changed:** turn on `stateSyncEnabled` and keep the world in the game server's state; each player then gets a full copy as they join and after that only what changed, after every tick (or every move, in a turn-based game), with no code to send it. `stateView(state, viewer, room)` cuts what each player sees: only what's near them in a big world, or without the other team's cards. In the game, `room.state` is the player's view and `room.smoothedState()` the same a moment (100 ms) behind, with positions moving evenly between updates. A player whose connection is backed up gets nothing until they've caught up, then a full copy. See `examples/arena`, and "State sync" in [`docs/DEVELOPER-API.md`](docs/DEVELOPER-API.md).

```ts
// A 100-player world where each player gets only the players within 800 units of them.
export default {
  maximumPlayerCount: 100,
  ticksPerSec: 30,
  stateSyncEnabled: true,
  setup: () => ({ players: {} }),
  onJoin(state, player) { state.players[player.id] = { name: player.name, x: 0, y: 0, health: 100 }; },
  onLeave(state, player) { delete state.players[player.id]; },
  stateView(state, viewer) {
    const me = state.players[viewer.id];
    const nearby = {};
    for (const [id, other] of Object.entries(state.players)) {
      if (me && Math.hypot(other.x - me.x, other.y - me.y) <= 800) nearby[id] = { name: other.name, x: Math.round(other.x), y: Math.round(other.y), health: other.health };
    }
    return { players: nearby };
  },
};
// In the game: requestAnimationFrame(function draw() { drawPlayers(room.smoothedState()?.players ?? {}); requestAnimationFrame(draw); });
```

**Messages that can be dropped:** `{ delivery: "latest_only" }` on any send, from the game server or the game, marks a message only the newest of matters, like positions every tick or where a player aims: while a player's connection is backed up, a newer one with the same `latestKey` (by default its `type`) replaces it, and the newest goes once they catch up. Zaisma's rooms carry them over the WebSocket today, and the same call moves to real datagrams once Cloudflare carries them. `get_stats` says which of your message types would gain from it (`latest_only_available`).

Games without server code can use the built-in `relay` (up to 16 players), which passes each message to everyone else as `{ fromPlayerId, data }`, and bytes with their `fromPlayerId`. See `examples/arena` (real-time) and `examples/four-in-a-row` (turn-based).

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
- **Sealed off:** nothing of Zaisma's but its own game's database and secrets, and other servers only on the hosts you list (below), so it talks to its players through `room` and its answers to their requests. State is plain JSON.
- **Private:** players never get its files; the game domain refuses `zaisma-server/` and `zaisma-server.js`.
- **Real-time rooms batch input:** in a room with `ticksPerSec`, the state stays inside the sandbox, and players' messages and bytes reach `onMessage` and `onBytes` just before the next `onTick`, in the order they came, with what they send going out then (at most a tick later). A handler that throws leaves the rest of the batch to run, and what it changed in the state before throwing stays, as on your own server, where they run as they come.
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
- **Errors** are a `DatabaseError` with a `code` and a `fix`: `bad_sql` (SQLite's own message, or more than one statement in a query), `bad_values`, `too_many_rows` (over 10,000 rows; page with `LIMIT`), `hosting_paused` (the game's hosting is paused this month, below), `database_full` (its storage, the database and kept rooms together, is at the 10 GB a game can have: it can change and delete rows but not grow) and `database_unavailable`.
- **Part of the game's hosting on Zaisma.** Rows written and read, and what it stores, count on the game's one hosting meter with its rooms and requests (see "Hosting" below). Every statement counts the rows SQLite touched, like Cloudflare's billing: an index makes lookups read fewer rows. When the game's hosting pauses, the database keeps answering for the hour running matches get, so their last saves land, then answers `hosting_paused` until it starts again.
- **You and your AI reach it too:** look at its tables and use, query it, fix data, change tables and roll it back to any minute in the last 30 days through the developer API, the MCP (`get_database`, `query_database`, `batch_database`, `restore_database`) or `zaisma database` in a terminal, with the same checks and limits (see "The game database" in [`docs/DEVELOPER-API.md`](docs/DEVELOPER-API.md)).
- **Take it out, bring it in:** the whole database goes out and in as SQLite's own SQL dump (`export_database`, `import_database`), or as a ready SQLite file from a terminal: `zaisma database export <game> game.sqlite` and `zaisma database import <game> game.sqlite`.
- **The same code on your own server:** the Node runner keeps the database in a local SQLite file (below), checked the same way, with no limits. Moving between Zaisma and your own server is one command each way: export to the file the runner uses, or import the runner's file.

#### Room browsing

Open rooms are listed on the game's page (how full each is and where it runs, never who's in it), with "playing now" under the title (every room counts, hidden ones too), and the game gets the same list to show its own way:

```js
const { rooms, playing, regions } = await Zaisma.rooms.list();   // how full each room is and where it runs, never who's in it
Zaisma.rooms.list({ region: "EU", labels: { Mode: "Classic" } }); // one region, or rooms with these labels
const room = await Zaisma.rooms.quickJoin();  // the linked room, else a busy room with space nearby, else a new one
Zaisma.joinRoom({ isListed: false });         // a new room that's never listed: a private match
Zaisma.joinRoom({ name: "Ana's castle", labels: { Mode: "Classic", Map: "Docks" } });  // name and label a new room
await Zaisma.filterText(typed);              // { isAllowed, reason, message, hasSwearing, text }: Zaisma's chat filter
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

**Kept rooms** are for worlds that last, like a survival server: a kept room doesn't end when everyone leaves, but sleeps with its state saved, costs nothing while it sleeps, and wakes as it was when someone joins, a day or a month later.

```ts
room.setKept(true);  // in your game server, like in setup or when players build their first base
```

A listed kept room stays on the game page's Rooms tab with nobody in it, like a server waiting for players (`Zaisma.rooms.list` says `isKept`). A world waking from its sleep runs `onRestored` with `restoreInfo.lostDurationSec` 0 and `restoreInfo.savedAt`, so you can grow crops for the time that passed, and it wakes on the game's live version, with `restoreInfo.savedVersionId` saying which one saved it. `room.end()` ends it for good, and `room.setKept(false)` makes it an ordinary room again. Saved worlds count toward the game's storage with its database, on its hosting meter: at the 10 GB a game can have, new rooms can't be kept until you make room, but kept rooms keep saving. List and delete them with `list_kept_rooms` and `delete_kept_room`, or `zaisma kept-rooms`. A room made with `room.reserve({ ..., isKept: true })` starts kept. On your own server the Node runner keeps them in `--room-state`.

`room.roomCode` tells the game server which room it's in, so a game with one shared world can keep only that room and turn players away from any other code, even from a changed page:

```ts
canJoin(state, player, room) { return room.roomCode === "WRLD22" || { refusalMessage: "Join the main world." }; },
onJoin(state, player, room) { room.setKept(true); },
```

Playing alone needs no room, so don't make one until others can join: time in a room counts toward hosting even with one player.

**Hosting.** Everything a game runs on Zaisma's servers (room time, game server CPU past the 25 CPU-seconds each player-hour includes, data Zaisma's relay sends its players, its database, and requests and schedule runs to its game server) counts on one meter, and every game gets a free allowance each month (UTC), about 2,500 player-hours of a game that only uses rooms. Your dashboard and `get_stats` show it as a percentage, with what used it. Past it, a game keeps going only when its developer has added hosting credit and given it a monthly budget (`monthly_budget_cents`; see "Hosting and credit" in [docs/DEVELOPER-API.md](docs/DEVELOPER-API.md)). Otherwise its hosting pauses until the month resets: no new rooms open (joining fails with `error.code === "hosting_paused"`), no new relayed connections or requests start, and matches already running get an hour to finish (`room.endsAt`, the game server's `onEnding`, the SDK's `ending` event). Game files, saves, sign-in, publishing and spectators are never on the meter, and your own servers never are.

#### Spectators

A game server that turns watching on lets people watch a match without playing, like a tournament's crowd or friends waiting for the next round:

```ts
export default {
  maximumSpectatorCount: 20,   // up to 100; leave it out, or 0, and nobody can watch
  onSpectatorJoin(state, spectator, room) { room.send(spectator.id, { type: "snapshot", state }); },  // catch them up
  onSpectatorLeave(state, spectator, room) {},
  onTick(state, tickDurationSec, room) {
    room.broadcast({ type: "positions", positions: state.positions });                       // players and spectators
    room.broadcast({ type: "hands", hands: state.hands }, { audience: "players" });          // never the spectators
    room.broadcast({ type: "commentary", text: state.commentary }, { audience: "spectators" });
  },
};
```

```js
const room = await Zaisma.joinRoom({ isSpectator: Zaisma.rooms.isLinkedAsSpectator });  // in the game
room.isSpectator;    // watching: room.send and room.sendBytes throw error.code "spectator_cannot_send"
room.spectatorCount; // how many watch; the "room" event says when it changes
```

A spectator gets everything the room sends everyone (`audience` picks who: `"everyone"`, the default, `"players"` or `"spectators"`, for `room.broadcast` and `room.broadcastBytes`), and `room.send(spectator.id, ...)` reaches one. They send nothing, so they can't bother players or dodge the room's limits; they're never in `room.players`, don't count toward `maximumPlayerCount` or "playing now", are never idle or away, and are free: watching isn't player time. `room.spectators` lists them, `joinInfo.isSpectator` tells `canJoin` a watcher is asking, and `room.kick` works on them too. A closed or full room can still be watched (watching a match under way is the point); a room with nobody playing can't (`no_room`), and one whose audience is full answers `watching_full`. When the last player leaves, the spectators are told the match ended.

On zaisma.com, Watch shows beside Join (friends playing, the Players plate, the Rooms tab) for games that take spectators, with the same rules as Join, and opens the game with `Zaisma.rooms.isLinkedAsSpectator` true. The Rooms tab and the Players plate say how many are watching, never who.

#### Players who walk away

Players who walk away stop holding seats and running matches, in every game, with no code:

- **Lost connections** (a closed laptop, lost signal): the SDK pings the room every 25 seconds without waking it, and a connection that stops answering is dropped about a minute later (within seconds in a real-time room). The SDK says goodbye as the page closes, so most players leave at once.
- **Idle:** after 10 minutes without input the SDK asks "Still there?" with a small plate at the top of the game for 30 seconds; no answer, and the player walks away. Rooms check for themselves too: a game that sends nothing at all for a minute past that counts as idle.
- **Hidden:** in a real-time room (one with `ticksPerSec`), a game hidden for 2 minutes counts as away.

A player whose connection drops stays in the match first, as away with reason `lost`, for 30 seconds while the SDK reconnects: `onAway` runs if your game server has one, every player's game sees `awayReason: "lost"` for them in `room.players`, and if they're back in time, `onBack` runs and they carry on where they were. Freeze their character meanwhile (in `onTick`, skip players whose `room.awayReason(playerId)` is `"lost"`), or do nothing and they stand still.

A player who walks away, or whose connection stays lost, leaves the match (`onLeave` with `leaveInfo.reason`) and the room holds their seat for 5 minutes: they come straight back to it with any input, or by reconnecting, and `onJoin` gets `joinInfo.isReturning`. Held seats count toward `maximumPlayerCount`, but players who walked away don't count as playing now or toward how full a room looks, and a room where everyone's away stops ticking. Once the seat runs out, the SDK offers their old room again if it has space. Zaisma never covers your game or sends anyone away from it for being idle.

When Zaisma restarts its rooms (every update to Zaisma does), a real-time match comes back where it was a few seconds before, and its players reconnect into it: the room saves its state every `stateSaveIntervalSec` (5 by default, 1 to 60), and `onRestored(state, restoreInfo, room)` runs once with `restoreInfo.lostDurationSec`, the seconds of play lost, so you can resync clocks or tell your players. Turn-based rooms save after every move, so they lose nothing. Publishing with `match_update_mode: "now"` moves every live match to the new version the same way, within seconds; your game server can hold it until the end of a round with `onVersionUpdate` ([Updates](docs/DEVELOPER-API.md#updates)).

Your game server picks what happens:

```ts
export default {
  idleCheck: "server",       // who checks: "server" (the default), "client" (each player's game decides), or "off"
  idleTimeoutSec: 300,       // seconds without input before "Still there?" (default 600)
  seatHoldDurationSec: 120,  // seconds a seat stays held (default 300, up to 1800; 0 for none)
  reconnectTimeoutSec: 30,   // seconds a player whose connection dropped stays in the match (default 30, up to 300; 0 to take them out at once)
  awayMode: "lobby",         // send players who walk away back to the room that made this one (room.reserve); "hold" is the default
  onAway(state, player, room, reason) {},  // reason "idle", "hidden" or "lost"; for idle and hidden, the player stays and you kick, move or keep them
  onBack(state, player, room) {},          // a player onAway kept, or whose connection dropped, came back: send them the full state
  stateSaveIntervalSec: 5,   // how often a real-time room saves its state, for a restart to come back with (default 5, 1 to 60)
  onRestored(state, restoreInfo, room) {}, // the room restarted with its saved state: restoreInfo.savedAt, lostDurationSec and savedVersionId
  onVersionUpdate(state, versionUpdate, room) {}, // a version published "now" is coming: call room.applyVersionUpdate() at a good moment, or it switches at versionUpdate.forcedAt
};
```

In the game, all of it is optional:

```js
room.on("connectionStatus", (connectionStatus) => {});        // "away" while out of the match
room.on("away", ({ reason, seatHoldDurationSec }) => {});     // reason: "idle" or "hidden"; the seat is held that long
room.on("idle", (isAsking) => {});            // ask "Still there?" your way: true to show it, false when answered or over
room.on("back", (back) => back.rejoin());     // back after the seat ran out: listening turns off rejoining by itself
room.on("players", (players) => {});          // each player's awayReason: "lost" while their connection dropped, "idle" or "hidden" if onAway kept them, else null
Zaisma.joinRoom({ idleCheckEnabled: false }); // no "Still there?" in this game (where idleCheck is "client", as with the relay, the room follows this)
```

Every number behind this (pings, timeouts, reconnecting, held seats, message limits, close codes) is in [Room connections](docs/DEVELOPER-API.md#room-connections).

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
- **Part of the game's hosting on Zaisma.** Each request, webhook event and schedule run counts on the game's hosting meter, and so does its CPU past the first 10 ms (see "Hosting" above). While the game's hosting is paused, requests answer `hosting_paused`. Your dashboard and `get_stats` show the month's count.
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
- **Up to 10 schedules on Zaisma.** Each run counts as a request on the game's hosting meter, and a paused game's schedules don't run. They run with the live version's game server, whatever the multiplayer setting, within a minute of it going live; a version without them stops them, and so does a game taken down. A game server with only schedules needs no `setup()` and runs no rooms. Your dashboard and `get_stats` show each schedule with its next and last run, the runs per day, and any errors with the schedule's name, file and line.
- **On your own server** the Node runner runs the same schedules at the same minutes while it's up, with `server.database` its local SQLite file, and prints a run's errors. A run due while it's down is missed.

#### Calling other servers, with secrets

A game's server can call your own server, a payment provider, Discord, GitHub or any other https API with plain `fetch()`, on the hosts you list for the game, and keep the tokens it needs as secrets:

```js
// zaisma-server/index.js: post each new top score to the game's Discord channel
export default {
  async onRequest(player, request, server) {
    if (request.type !== "score") return null;
    await fetch(server.secrets.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `${player.name} scored ${request.score}!` }),
    });
    return { isPosted: true };
  },
};
```

```sh
# the hosts it calls (or update_game with game_server_allowed_hosts), and the secret it uses
npx @zaisma/cli allowed-hosts <slug> discord.com
npx @zaisma/cli secrets set <slug> DISCORD_WEBHOOK_URL   # asks for the value; never shown again
```

- **Hosts:** `game_server_allowed_hosts`, up to 20 host names like `api.github.com`, or `"*.example.com"` for every name under example.com. Every call is https, never to an IP address or Zaisma's own domains, sends up to 5 MB and gets 10 seconds; redirects come back to your code rather than being followed, and a game makes up to about 600 calls a minute in each place. Live within a minute, with no approval by Zaisma; players don't see the list. A call to anything else throws an `OutsideCallError` with a `code` (like `host_not_allowed`) and a `fix`, which `get_stats` shows with your other errors.
- **Secrets:** names like `DISCORD_WEBHOOK_URL` (capitals, digits and underscores) with up to 8 KB of text, up to 50 a game, set with `set_secret`, the API or the upload command and never shown again, to anyone. Your game server reads them as `server.secrets` in `onRequest` and `onSchedule` and `room.secrets` in rooms; running rooms get a new value within a minute. Since your code reads them, anyone who can publish the game's code can use them. Never put a secret in the game's own files: players can read those.
- **On your own server** the Node runner calls out freely, and `server.secrets` is its environment variables, so the same code runs with `DISCORD_WEBHOOK_URL=… node packages/game-server/bin/node.js …`.

#### Run your game server yourself

The same game server runs on your own machine with Node 23.6 or later:

```sh
node packages/game-server/bin/node.js ./server.ts --game <your-game> --port 8080 --database ./zaisma-database.sqlite
```

`room.database` there is that SQLite file, made the first time the game uses it (`zaisma-database.sqlite` where you start it, unless `--database` says otherwise). Its rooms save their states in another, `--room-state` (`zaisma-room-states.sqlite` by default), so a restarted server brings its matches back as Zaisma's rooms do; stopping it (Ctrl-C, or a restart's SIGTERM) saves every room first, so nothing is lost.

Put it behind HTTPS, add its address (like `wss://play.example.com`) to the game's own servers on Zaisma (the dashboard's Your own servers, `update_game` with `own_server_urls`, or `zaisma own-servers <slug> wss://play.example.com`; live at once, and the game's menu names it), and join with `Zaisma.joinRoom({ serverUrl: "wss://play.example.com" })`. Players still arrive with Zaisma player passes: standard EdDSA JWTs (header `typ` `pass+jwt`, claim `pass_version_number` `1`) your server checks against the keys at `https://rooms.zaisma.com/.well-known/jwks.json`, with `verifyPass(pass, keys, { gameSlug })` from `@zaisma/game-server` or any language's JWT library. A pass proves only who the player is: its `sub` is the player's ID (`player_…`), `kind` is `account` (a signed-in Zaisma account, with the same ID in every game) or `guest` (a new ID for each pass), and `aud` is the game. A guest's pass also carries their generated `name`; an account's name comes from its public profile at `https://rooms.zaisma.com/v1/players/<id>`, which the Node runner looks up for you. Game servers see the same `kind` on every player.

An account's pass also says who it can chat with: `who_can_chat` (`nobody`, `friends` or `anyone`, the player's own setting) and, when `anyone`, an opaque `chat_group_id` (`chat_group_…`, different in every game). Zaisma never tells a game anyone's age; a game could guess which chat group is the younger one from its size. Friends and blocks come as opaque tags, never as a list of players anyone can read: `player_tag_id`, the account's own tag in this game (`player_tag_…`), and `friend_player_tag_ids`, its Zaisma friends' tags (up to 200). Ask `passesAreFriends(first, second)` from `@zaisma/game-server` with two checked passes: friends when each pass lists the other's tag, across rooms too. Before your server passes chat between two players, ask `canChat(first, second)`: guests and accounts set to `nobody` never chat, friends chat, and two accounts set to `anyone` also chat within the same chat group. A change of setting or friends reaches your server with the player's next pass. Then run each message through Zaisma's chat filter with `checkChat({ text, senderPass, receiverPasses })` (the passes as your server received them) and deliver it only when `isAllowed`: it stops contact details, personal details, slurs and sexual content on every message to or from an under-18 account, flags swearing (`hasSwearing`) for you to decide, and gives you the words to show the sender (`message`). It's free, and when Zaisma can't be reached it answers `unchecked`: don't deliver those. `checkChat` works on your own server only; in Zaisma rooms the room filters the chat it delivers itself, and `checkChat` throws `own_server_only` there.

Blocks come the same way: `block_player_tag_ids`, the tags of up to 100 accounts it has a block with, either way. Ask `passesHaveBlockBetween(first, second)` with two checked passes (one side's pass is enough, and neither says who made the block); `canChat` already says no across a block. A block is a wall both ways: deliver nothing from one to the other and keep them apart in your matchmaking when you can, but never keep either out of a room. In rooms, Zaisma's and the Node runner alike, `room.hasBlockBetween(firstPlayerId, secondPlayerId)` covers blocks from passes and blocks a player just made in the game, and each player's game hears which players in the room it has a block with, so `room.isMuted` hides their emotes both ways. `room.areFriends(firstPlayerId, secondPlayerId)` says the same of friends.

#### Friends in your game

`await Zaisma.friends.list()` gives a signed-in player their Zaisma friends who are playing your game right now, `{ friends: [{ id, name, username, roomCode, serverUrl, joinRefusal }] }`, so your game can draw its own list to join a friend's match, watch it or invite them: `roomCode` (and `serverUrl` on your own servers) when the player could join, else `joinRefusal` says why (`not_taking_joins`, `match_in_progress`, `room_full`, `no_room`). Friends who hide what they're playing, appear offline or play something else never reach your game, and neither does who's online. A guest gets `error.code === "account_needed"`. On your own servers, `joinRoom({ serverUrl })` tells Zaisma the room by itself, so friends' Join on zaisma.com works there too (a game with its own netcode calls `Zaisma.friends.setRoom({ serverUrl, roomCode })`, and `null` when the player leaves); Join opens your page with `?room=CODE&server=…`, which `joinRoom` and `quickJoin` follow, and your server keeps its own door. The server must be one of the game's own servers listed on its page.

### Connections between players

Peer-to-peer code (WebRTC, what PeerJS and Godot's WebRTC use) works on Zaisma unchanged, and players never learn each other's internet address: the games server puts a small script (`packages/sdk/relay.js`) first in every page, which sends every connection through Cloudflare's relay (TURN) with Zaisma's relay servers, whatever `iceServers` the game asks for. That also gets connections through school and office networks. Your signaling still runs where it does now (Zaisma rooms or one of the game's own servers, like PeerJS's server). A relay of your own stays when it's on one of the game's own servers; Zaisma's relay counts on the game's hosting meter (every 20 MB it sends your players costs what a player-hour in a room does), and starts no new connections while the game's hosting is paused, like rooms. There's no setting to connect directly, and the scan holds code that makes connections from a frame of its own to get around the relay (`relay_bypass`).

### Cloud saves

Signed-in players' progress follows them to any device, with no code in the game. The games server adds a small script (`packages/sdk/saves.js`) to each page of a game; it hands the game's localStorage to the Zaisma game page around it, which stores it with the player's account. Before the game starts, the account's save is put back in place. Games that keep their own saves can turn this off in admin. The developer and their AI read, change, reset and restore any player's save through the API, MCP and `zaisma saves` (see "Cloud saves" in `docs/DEVELOPER-API.md`), and a game that wants its own save screens gets the player's earlier versions, conflicts and the developer's changes through the SDK's `Zaisma.saves`, and picks the moment for the "Keep your progress" card with `Zaisma.player.offerAccount()`.

### Links to your own sites

A game opens its store, Patreon, Steam page or Discord with `await Zaisma.links.open("store")`, from a tap or key press: the links registered on the game (its `links`, in the dashboard, `update_game` or `zaisma links set`). Zaisma's page shows "You're leaving Zaisma" with the address over the game's corner, and the game hears `"opened"` or `"stayed"`. Guests and under-18 accounts open only links on trusted store, payment and video sites. See "Registered links" in `docs/DEVELOPER-API.md`.

### Items players own

A game lists what it sells or grants as items (`set_item`, or `zaisma items set <slug> items.json` from a file kept beside the game): permanent ones a player owns for good on every device, and consumables the game counts. Prices are the game's own, in any of Stripe's currencies with a price per country if you like, and Zaisma takes no cut. A player's pass lists the items they own, so `Zaisma.items.owns("skin_red-dragon")` in the game and `player.ownedItemNames` on any game server need no extra call, and every purchase or grant has a signed receipt a game server checks in one call, `room.verifyReceipt(receipt)` or `server.verifyReceipt(receipt)`, in Zaisma rooms or on your own server. See "Items and purchases" in `docs/DEVELOPER-API.md`.

### How games are kept safe

- Every upload is scanned before it goes live: file-type and executable checks, static malware checks, known-illegal-image matching and an AI review. Anything unclear waits for a person.
- Games run on a separate domain inside a sandboxed frame, with a strict Content Security Policy: no access to zaisma.com, no cookies, no outside scripts, and connections only to Zaisma rooms and the game's own listed servers. They open no pages themselves: only their registered links, through Zaisma's leaving card, each site checked against Cloudflare's malware and phishing list.
- Every game page has a Report button. Takedowns apply at once and are logged.
