import { afterAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REQUEST_LIMITS, ROOM_LIMITS } from "../../packages/game-server/src/internal.ts";

const runner = join(import.meta.dirname, "../../packages/game-server/bin/node.js");
const folder = mkdtempSync(join(tmpdir(), "zaisma-runner-"));
const started: ChildProcess[] = [];
afterAll(() => {
  for (const child of started) child.kill();
  rmSync(folder, { recursive: true, force: true });
});

async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The runner as its own process, like a developer starts it, so a crash shows as the process ending. */
async function startRunner() {
  const port = await freePort();
  const child = spawn("node", [runner, "relay", "--game", "arena", "--port", String(port), "--origin", "", "--database-file", join(folder, `${port}.sqlite`), "--room-state-file", join(folder, `${port}-rooms.sqlite`)], { stdio: "ignore" });
  started.push(child);
  let exitCode: number | null = null;
  child.on("exit", (code) => (exitCode = code ?? -1));
  for (let tries = 0; tries < 100; tries++) {
    const answers = await new Promise<boolean>((resolve) => {
      const probe = new WebSocket(`ws://127.0.0.1:${port}/v1/rooms/arena/ABCDEF`);
      probe.on("open", () => (probe.close(), resolve(true)));
      probe.on("error", () => resolve(false));
    });
    if (answers) break;
    await sleep(100);
  }
  return { port, hasExited: () => exitCode !== null };
}

describe("The Node runner, for a message over its size limit", () => {
  it("closes that one connection and keeps running for everyone else", async () => {
    const { port, hasExited } = await startRunner();
    const tooBig = "a".repeat(REQUEST_LIMITS.maximumPassSizeBytes + ROOM_LIMITS.maximumJoinDataSizeBytes + 8 * 1024);
    const sender = new WebSocket(`ws://127.0.0.1:${port}/v1/rooms/arena/ABCDEF`);
    sender.on("error", () => {});
    const closeCode = new Promise<number>((resolve) => sender.on("close", (code) => resolve(code)));
    await new Promise((resolve) => sender.on("open", resolve));
    sender.send(tooBig);
    expect(await closeCode).toBe(1009);
    await sleep(300);
    expect(hasExited()).toBe(false);
    // A new connection still gets in.
    const another = new WebSocket(`ws://127.0.0.1:${port}/v1/rooms/arena/ABCDEF`);
    await new Promise<void>((resolve, reject) => {
      another.on("open", () => resolve());
      another.on("error", reject);
    });
    another.close();
  }, 20_000);
});
