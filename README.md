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
| 1. Beta | Guest multiplayer and invite links, accounts and cloud saves, the creator MCP for publishing from any AI tool. **Public beta.** |
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

To run your own Zaisma, create a D1 database, two R2 buckets (game files and cloud saves) and a queue (names in the two `wrangler.jsonc` files), put the database ID in the three files, set your site, game and rooms addresses, protect `/admin` with Cloudflare Access, set the rooms Worker's `PASS_SIGNING_KEY` secret, point `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` at your Supabase project for accounts (and set the site's `SUPABASE_SECRET_KEY` secret so accounts can be deleted), and deploy `apps/rooms`, `apps/games` and `apps/site`.

### Multiplayer

Games include the SDK with `<script src="_zaisma/v1.js"></script>` and call `await Zaisma.joinRoom()`. A room link (`zaisma.com/g/<game>?room=CODE`) drops friends into the same match as guests.

Multiplayer is server-client: the *client* is the game in the browser, the *game server* holds the official state and checks every move, and a *room* is one live match running one copy of the game server. A game server is a plain object:

```ts
export default {
  maxPlayers: 8,           // up to 16
  tickRate: 20,            // leave out for turn-based games so the room sleeps between moves
  setup: () => ({ players: {} }),
  onJoin(state, player, room) {},
  onLeave(state, player, room) {},
  onMessage(state, player, msg, room) {},
  onTick(state, dt, room) {},
};
// room.broadcast(msg), room.send(playerId, msg), room.players, room.end()
```

Games without server code can use the built-in `relay`, which passes each message to everyone else. See `examples/arena` (real-time) and `examples/four-in-a-row` (turn-based).

#### Run your game server yourself

The same game server runs on your own machine with Node 23.6 or later:

```sh
node packages/game-server/bin/node.js ./server.ts --game <your-game> --port 8080
```

Put it behind HTTPS, add its address (like `wss://play.example.com`) to the game's own servers on Zaisma, and join with `Zaisma.joinRoom({ server: "wss://play.example.com" })`. Players still arrive with Zaisma player passes: standard EdDSA JWTs your server checks against the keys at `https://rooms.zaisma.com/.well-known/jwks.json`, so any language's JWT library can check them too.

### Cloud saves

Signed-in players' progress follows them to any device, with no code in the game. The games server adds a small script (`packages/sdk/saves.js`) to each page of a game; it hands the game's localStorage to the Zaisma game page around it, which stores it with the player's account. Before the game starts, the account's save is put back in place. Games that keep their own saves can turn this off in admin.

### How games are kept safe

- Every upload is scanned before it goes live: file-type and executable checks, static malware checks, known-illegal-image matching and an AI review. Anything unclear waits for a person.
- Games run on a separate domain inside a sandboxed frame, with a strict Content Security Policy: no access to zaisma.com, no cookies, no outside scripts, and connections only to Zaisma rooms and the game's own listed servers.
- Every game page has a Report button. Takedowns apply instantly and are logged.
