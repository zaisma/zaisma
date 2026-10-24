# @zaisma/game-server

Write a game server once; run it in Zaisma's rooms or on your own Node server. Rooms, players, state sync, chat, the game's database and its requests behave the same in both.

```ts
// server.ts
import { defineGameServer } from "@zaisma/game-server";

export default defineGameServer({
  ticksPerSec: 20,
  setup: () => ({ scores: {} }),
  onJoin: (state, who, room) => ({ ...state, scores: { ...state.scores, [who.id]: 0 } }),
});
```

On your own server (Node 22.18 or later):

```
npx @zaisma/game-server@1 ./server.ts --game <your-game-slug> --port 8080
```

or from code:

```ts
import { startServer } from "@zaisma/game-server/node";
import gameServer from "./server.ts";

const running = startServer({ gameServer, gameSlug: "your-game-slug", port: 8080 });
// Later: await running.close(); every room saves first.
```

A mistake in your game server's code becomes a coded error in the game's logs, never a silent success, and the Node runner behaves the same as Zaisma's rooms. Versions follow semver: within 1.x the package only gains things.

- The game server, handler by handler: the "Game servers" section of the [README](https://github.com/zaisma/zaisma#readme) and [`docs/DEVELOPER-API.md`](https://github.com/zaisma/zaisma/blob/main/docs/DEVELOPER-API.md).
- Every name and option follows [`docs/NAMING.md`](https://github.com/zaisma/zaisma/blob/main/docs/NAMING.md).

MIT licensed.
