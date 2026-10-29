// The game server of the local bench (local-play.js), as a process of its own: a change to the game server's files
// stops this process (every room saves first) and starts a new one, so the new code is read from scratch.
// Not a command: local-play.js starts it with one JSON argument and hears ZAISMA_LOCAL_RUNNER_READY when it listens.
import { createServer } from "node:net";
import { pathToFileURL } from "node:url";
import { ROOM_MESSAGE_LIMITS, checkRoomData, isRoomCode, relay } from "../src/internal.ts";
import { localDatabase } from "./node-parts.js";
import { startServer } from "./node.js";

// How startServer hands this runner its way to send room messages as the developer (node.js).
const LOCAL_BENCH_ROOM_MESSAGE = Symbol.for("zaisma.localBenchRoomMessage");

const config = JSON.parse(process.argv[2] ?? "{}");
try {
  // Said plainly before anything listens: the runner's own listen error would end this process with a stack trace.
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error) => reject(error?.code === "EADDRINUSE" ? new Error(`Port ${config.port} is already in use, so your game server can't start. Stop what's using it, or start the bench with another --port.`) : error));
    probe.listen(config.port, () => probe.close(resolve));
  });
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
  let stopping = null;
  const stop = () => (stopping ??= running.close().then(() => process.exit(0)));
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, stop);
  // The bench holds this pipe open while it runs: when it ends, however it ended, this game server stops too (rooms save first).
  process.stdin.once("close", stop);
  // The bench's sends to rooms come as JSON lines on the same pipe, { askNumber, message, roomCode }, each answered on a line of its own.
  let rest = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    rest += chunk;
    const lines = rest.split("\n");
    rest = lines.pop();
    for (const line of lines) {
      let asked;
      try {
        asked = JSON.parse(line);
      } catch {
        continue;
      }
      const checked = checkRoomData(asked?.message, ROOM_MESSAGE_LIMITS.maximumRoomMessageSizeBytes);
      const roomCode = typeof asked?.roomCode === "string" && isRoomCode(asked.roomCode) ? asked.roomCode : null;
      const sending = checked.isValid && asked.message !== null ? Promise.resolve().then(() => running[LOCAL_BENCH_ROOM_MESSAGE](checked.checkedData, roomCode)) : Promise.reject(new Error("message isn't plain JSON of up to 16 KB."));
      void sending.then(
        (answer) => console.log(`ZAISMA_LOCAL_RUNNER_ANSWER ${JSON.stringify({ askNumber: asked.askNumber, ...answer })}`),
        (error) => console.log(`ZAISMA_LOCAL_RUNNER_ANSWER ${JSON.stringify({ askNumber: asked.askNumber, errorMessage: error instanceof Error ? error.message : String(error) })}`),
      );
    }
  });
  process.stdin.resume();
  const isListening = () => console.log("ZAISMA_LOCAL_RUNNER_READY");
  if (running.httpServer.listening) isListening();
  else running.httpServer.once("listening", isListening);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
