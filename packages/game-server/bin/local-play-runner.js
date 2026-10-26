// The game server of the local bench (local-play.js), as a process of its own: a change to the game server's files
// stops this process (every room saves first) and starts a new one, so the new code is read from scratch.
// Not a command: local-play.js starts it with one JSON argument and hears ZAISMA_LOCAL_RUNNER_READY when it listens.
import { pathToFileURL } from "node:url";
import { relay } from "../src/internal.ts";
import { localDatabase } from "./node-parts.js";
import { startServer } from "./node.js";

const config = JSON.parse(process.argv[2] ?? "{}");
try {
  const gameServer = config.entry ? (await import(pathToFileURL(config.entry).href)).default : relay;
  const running = startServer({
    gameServer,
    gameSlug: config.gameSlug,
    port: config.port,
    origins: [config.origin],
    issuerUrl: config.issuerUrl,
    database: localDatabase(config.databaseFile),
    roomStateFile: config.roomStateFile,
    // onPurchase and onRefund hear purchases through the stand-in developer API on the bench's rooms.
    zaismaKey: config.zaismaKey,
    developerApiUrl: config.developerApiUrl,
  });
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => running.close().then(() => process.exit(0)));
  const isListening = () => console.log("ZAISMA_LOCAL_RUNNER_READY");
  if (running.httpServer.listening) isListening();
  else running.httpServer.once("listening", isListening);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
