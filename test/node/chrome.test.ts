// openChrome's Chrome ends with the node process that started it: on exit without close(), on SIGTERM (still ending the process as
// SIGTERM), and, after SIGKILL, at the next openChrome, which leaves a live owner's Chrome alone (packages/cli/chrome.mjs).
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { findChrome, openChrome } from "../../packages/cli/chrome.mjs";

const ROOT = join(import.meta.dirname, "../..");
const chromePath = findChrome([join(ROOT, ".wrangler/chrome"), join(ROOT, "chrome")]);
const CHROME_MODULE = pathToFileURL(join(ROOT, "packages/cli/chrome.mjs")).href;

/** A node process that opens Chrome with its own profile prefix, says its folder, then exits without close() ("exit") or waits to be stopped. */
const OWNER_SCRIPT = `
const { readdirSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { openChrome } = await import(${JSON.stringify(CHROME_MODULE)});
await openChrome(process.env.CHROME_PATH, process.env.PROFILE_PREFIX);
console.log(JSON.stringify({ folder: join(tmpdir(), readdirSync(tmpdir()).find((entry) => entry.startsWith(process.env.PROFILE_PREFIX))) }));
if (process.argv.includes("exit")) process.exit(0);
setInterval(() => {}, 1000);
`;

type Owner = { child: ChildProcess; folder: string; ended: Promise<{ code: number | null; signal: NodeJS.Signals | null }> };

async function startOwner(name: string, ending: "exit" | "wait"): Promise<Owner> {
  const prefix = `zaisma-chrome-test-${name}-${process.pid}-`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", OWNER_SCRIPT, ending], { env: { ...process.env, CHROME_PATH: chromePath!, PROFILE_PREFIX: prefix }, stdio: ["ignore", "pipe", "inherit"] });
  const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const folder = await new Promise<string>((resolve, reject) => {
    let output = "";
    child.stdout!.on("data", (chunk) => {
      output += chunk;
      if (output.includes("\n")) resolve(JSON.parse(output.split("\n")[0]!).folder);
    });
    ended.then(() => reject(new Error(`${name}'s owner ended before Chrome opened`)));
  });
  expect(folder.startsWith(join(tmpdir(), prefix))).toBe(true);
  return { child, folder, ended };
}

/** The processes whose command line names the folder's profile: Chrome and every helper it started. */
function chromeProcessCount(folder: string) {
  const listed = spawnSync("ps", ["-A", "-o", "command="], { encoding: "utf8" }).stdout;
  return listed.split("\n").filter((command) => command.includes(`--user-data-dir=${join(folder, "profile")}`)).length;
}

const waitUntilGone = (folder: string) => vi.waitFor(() => expect({ processes: chromeProcessCount(folder), isFolderLeft: existsSync(folder) }).toEqual({ processes: 0, isFolderLeft: false }), { timeout: 10_000, interval: 100 });

describe.skipIf(!chromePath || process.platform === "win32" || typeof WebSocket !== "function")("openChrome's Chrome ends with its owner", () => {
  it("is gone when the owner exits without close()", async () => {
    const owner = await startOwner("exit", "exit");
    expect((await owner.ended).code).toBe(0);
    await waitUntilGone(owner.folder);
  }, 60_000);

  it("is gone when the owner is stopped with SIGTERM, which still ends the owner as SIGTERM", async () => {
    const owner = await startOwner("term", "wait");
    expect(chromeProcessCount(owner.folder)).toBeGreaterThan(0);
    owner.child.kill("SIGTERM");
    expect((await owner.ended).signal).toBe("SIGTERM");
    await waitUntilGone(owner.folder);
  }, 60_000);

  it("is swept by the next openChrome when the owner was killed with SIGKILL, and a live owner's Chrome is left alone", async () => {
    const [killed, alive] = await Promise.all([startOwner("kill", "wait"), startOwner("alive", "wait")]);
    killed.child.kill("SIGKILL");
    await killed.ended;
    expect(existsSync(killed.folder)).toBe(true);
    const chrome = await openChrome(chromePath!, `zaisma-chrome-test-sweeper-${process.pid}-`);
    try {
      await waitUntilGone(killed.folder);
      expect(chromeProcessCount(alive.folder)).toBeGreaterThan(0);
    } finally {
      await chrome.close();
      alive.child.kill("SIGTERM");
      await alive.ended;
    }
    await waitUntilGone(alive.folder);
  }, 60_000);
});
