import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  NETWORK_LOOK_INTERVAL_SEC,
  NETWORK_RETRY_COUNT,
  deployWorkers,
  isNetworkFailure,
  isOnline,
  liveVersionIdOf,
  readShipProgress,
  runThroughInterruptions,
  waitForNetwork,
  // @ts-expect-error: a plain JavaScript script without types
} from "../../scripts/ship-resume.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { dockerForShip } from "../../scripts/photodna-sdk.mjs";
import { temporaryFolder } from "../temporary-folder.ts";

/** scripts/ship-resume.mjs: how npm run ship gets through a Mac that slept, Wi-Fi that dropped, or a ship that was killed. */

const ROOT = join(import.meta.dirname, "../..");
const WORKERS = ["rooms", "games", "photodna", "compress", "site"];
const COMMIT_SHA = "0123abc0123abc0123abc0123abc0123abc0123a";
const NETWORK_GONE = "✘ [ERROR] A request to the Cloudflare API (/accounts/x/workers/scripts/zaisma-site) failed.\n  getaddrinfo ENOTFOUND api.cloudflare.com";
const FAIL_7403 = "✘ [ERROR] A request to the Cloudflare API failed. [code: 7403]\nfetch failed";

type Answer = { exitCode: number; output: string; isInterrupted?: boolean };

/** A network that's down for the given number of looks, then up; and every wait taken, instead of sleeping. */
function fakeNetwork(downLookCount: number) {
  let lookCount = 0;
  const waitsSec: number[] = [];
  return {
    isNetworkUp: async () => lookCount++ >= downLookCount,
    wait: async (durationSec: number) => void waitsSec.push(durationSec),
    waitsSec,
    looks: () => lookCount,
  };
}

/** A step that answers each of answers in turn, counting its attempts. */
function scriptedStep(answers: Answer[]) {
  const attempts: number[] = [];
  return { attempt: async (retryIndex: number) => (attempts.push(retryIndex), answers[Math.min(attempts.length - 1, answers.length - 1)]!), attempts };
}

describe("isNetworkFailure", () => {
  it("knows what git, gh, wrangler, npm and fetch print when the network went away", () => {
    for (const output of [
      NETWORK_GONE,
      "fatal: unable to access 'https://github.com/zaisma/zaisma.git/': Could not resolve host: github.com",
      "error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com",
      "npm error code ECONNRESET\nnpm error network aborted",
      "TypeError: fetch failed",
      "write EPIPE",
      "Cannot connect to the Docker daemon at unix:///Users/julius/.colima/default/docker.sock. Is the docker daemon running?",
    ]) expect(isNetworkFailure(output), output).toBe(true);
  });

  it("never takes a real failure for one, even when it mentions the network", () => {
    for (const output of [FAIL_7403, "Authentication error [code: 10000]\nfetch failed", "✘ [ERROR] Build failed with 1 error: src/index.ts:3:1: ERROR: Expected \";\"", "SHIP check failed", ""]) expect(isNetworkFailure(output), output).toBe(false);
  });
});

describe("isOnline", () => {
  it("is online once any probe address answers anything, offline when none does", async () => {
    const asked: string[] = [];
    const oneAnswers = async (url: string) => (asked.push(url), url.includes("github") ? new Response(null, { status: 403 }) : Promise.reject(new TypeError("fetch failed")));
    expect(await isOnline({ fetchAnswer: oneAnswers })).toBe(true);
    expect(asked).toEqual(["https://api.cloudflare.com/client/v4/", "https://api.github.com/"]);
    expect(await isOnline({ fetchAnswer: async () => Promise.reject(new TypeError("fetch failed")) })).toBe(false);
  });
});

describe("waitForNetwork", () => {
  it("looks every interval until the network is back", async () => {
    const network = fakeNetwork(3);
    expect(await waitForNetwork({ isNetworkUp: network.isNetworkUp, wait: network.wait, lookCount: 10 })).toBe(true);
    expect(network.waitsSec).toEqual([NETWORK_LOOK_INTERVAL_SEC, NETWORK_LOOK_INTERVAL_SEC, NETWORK_LOOK_INTERVAL_SEC]);
  });

  it("gives up after its looks", async () => {
    const network = fakeNetwork(Infinity);
    expect(await waitForNetwork({ isNetworkUp: network.isNetworkUp, wait: network.wait, lookCount: 4 })).toBe(false);
    expect(network.waitsSec).toHaveLength(4);
  });
});

describe("runThroughInterruptions", () => {
  const options = (network: ReturnType<typeof fakeNetwork>, said: string[]) => ({
    isNetworkUp: network.isNetworkUp,
    wait: network.wait,
    waitForNetworkBack: () => waitForNetwork({ isNetworkUp: network.isNetworkUp, wait: network.wait, lookCount: 10 }),
    say: (line: string) => said.push(line),
  });

  it("runs a step again once the network that went away under it is back (a Mac that slept mid-deploy)", async () => {
    const said: string[] = [];
    // Down for the look after the failure and two more, then back.
    const network = fakeNetwork(3);
    const step = scriptedStep([{ exitCode: 1, output: NETWORK_GONE }, { exitCode: 0, output: "Current Version ID: 9f8e7d6c" }]);
    const answer = await runThroughInterruptions("deploying site", step.attempt, options(network, said));
    expect(answer).toEqual({ exitCode: 0, output: "Current Version ID: 9f8e7d6c" });
    expect(step.attempts).toEqual([0, 1]);
    expect(said).toEqual([`While deploying site, the network went away (getaddrinfo ENOTFOUND api.cloudflare.com); waiting for it to come back, then trying again (1 of ${NETWORK_RETRY_COUNT})…`, "The network is back."]);
  });

  it("never runs a real failure again: one while the network is up, or a 7403 while it's down", async () => {
    const buildFailed = scriptedStep([{ exitCode: 1, output: "✘ [ERROR] Build failed with 1 error" }]);
    expect(await runThroughInterruptions("deploying site", buildFailed.attempt, options(fakeNetwork(0), []))).toEqual({ exitCode: 1, output: "✘ [ERROR] Build failed with 1 error" });
    expect(buildFailed.attempts).toEqual([0]);
    const refused = scriptedStep([{ exitCode: 1, output: FAIL_7403 }]);
    const network = fakeNetwork(Infinity);
    expect((await runThroughInterruptions("applying migrations", refused.attempt, options(network, []))).isInterrupted).toBeUndefined();
    expect(refused.attempts).toEqual([0]);
    expect(network.looks()).toBe(0);
  });

  it("answers interrupted when the network stays away", async () => {
    const said: string[] = [];
    const step = scriptedStep([{ exitCode: 1, output: NETWORK_GONE }]);
    const answer = await runThroughInterruptions("deploying site", step.attempt, options(fakeNetwork(Infinity), said));
    expect(answer).toEqual({ exitCode: 1, output: NETWORK_GONE, isInterrupted: true });
    expect(step.attempts).toEqual([0]);
  });

  it("runs a step again after a blink, and calls it real when it keeps failing with the network up", async () => {
    const said: string[] = [];
    const network = fakeNetwork(0);
    const step = scriptedStep([{ exitCode: 1, output: "game page: fetch failed" }]);
    const answer = await runThroughInterruptions("checking the live site", step.attempt, options(network, said));
    expect(answer).toEqual({ exitCode: 1, output: "game page: fetch failed" });
    expect(step.attempts).toEqual([0, 1, 2, 3]);
    expect(said[0]).toBe(`While checking the live site, the network blinked (game page: fetch failed); trying again (1 of ${NETWORK_RETRY_COUNT})…`);
  });

  it("answers interrupted when the network is gone after the last try", async () => {
    // Up for the first three looks (blinks), down from then on.
    let lookCount = 0;
    const step = scriptedStep([{ exitCode: 1, output: NETWORK_GONE }]);
    const answer = await runThroughInterruptions("deploying site", step.attempt, { isNetworkUp: async () => lookCount++ < 3, wait: async () => {}, waitForNetworkBack: async () => true });
    expect(answer.isInterrupted).toBe(true);
    expect(step.attempts).toEqual([0, 1, 2, 3]);
  });
});

describe("liveVersionIdOf", () => {
  it("reads the one version that takes all the traffic", () => {
    expect(liveVersionIdOf(JSON.stringify({ id: "d1", versions: [{ version_id: "9f8e7d6c-1", percentage: 100 }] }))).toBe("9f8e7d6c-1");
    expect(liveVersionIdOf(JSON.stringify({ versions: [{ version_id: "a", percentage: 90 }, { version_id: "b", percentage: 10 }] }))).toBeNull();
    expect(liveVersionIdOf("✘ [ERROR] fetch failed")).toBeNull();
  });
});

describe("deployWorkers", () => {
  let folder: string;
  let progressPath: string;
  beforeEach(() => {
    folder = temporaryFolder("ship-resume-");
    progressPath = join(folder, "zaisma-ship-progress.json");
  });
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  const versionOf = (worker: string, commitSha = COMMIT_SHA) => `${worker}-${commitSha.slice(0, 7)}`;
  /** A ship of commitSha whose live versions are liveVersions. */
  async function ship(liveVersions: Record<string, string>, commitSha = COMMIT_SHA) {
    const deployed: string[] = [];
    const said: string[] = [];
    const answer = await deployWorkers({
      workers: WORKERS,
      commitSha,
      progressPath,
      say: (line: string) => said.push(line),
      readLiveVersionId: async (worker: string) => liveVersions[worker] ?? null,
      deployWorker: async (worker: string) => (deployed.push(worker), versionOf(worker, commitSha)),
    });
    return { ...answer, deployed, said };
  }

  it("picks a killed ship up where it stopped, deploying nothing twice", async () => {
    // A real process, killed outright while it deploys photodna.
    const moduleUrl = pathToFileURL(join(ROOT, "scripts/ship-resume.mjs")).href;
    const script = `
      const { deployWorkers } = await import(${JSON.stringify(moduleUrl)});
      await deployWorkers({
        workers: ${JSON.stringify(WORKERS)},
        commitSha: ${JSON.stringify(COMMIT_SHA)},
        progressPath: ${JSON.stringify(progressPath)},
        readLiveVersionId: async () => null,
        deployWorker: async (worker) => {
          if (worker === "photodna") process.kill(process.pid, "SIGKILL");
          return worker + "-" + ${JSON.stringify(COMMIT_SHA.slice(0, 7))};
        },
      });`;
    const killed = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    expect(killed.signal).toBe("SIGKILL");
    expect(readShipProgress(progressPath, COMMIT_SHA).version_ids).toEqual({ rooms: versionOf("rooms"), games: versionOf("games") });

    const rerun = await ship({ rooms: versionOf("rooms"), games: versionOf("games") });
    expect(rerun.keptWorkers).toEqual(["rooms", "games"]);
    expect(rerun.deployed).toEqual(["photodna", "compress", "site"]);
    expect(rerun.said).toEqual([`Keeping rooms: this commit's version ${versionOf("rooms").slice(0, 8)} is live already.`, `Keeping games: this commit's version ${versionOf("games").slice(0, 8)} is live already.`]);
    expect(Object.keys(readShipProgress(progressPath, COMMIT_SHA).version_ids)).toEqual(WORKERS);
  });

  it("deploys again a Worker whose live version isn't the one this commit's ship deployed", async () => {
    await ship({});
    const rerun = await ship({ rooms: versionOf("rooms"), games: "someone-elses", photodna: versionOf("photodna") });
    expect(rerun.deployed).toEqual(["games", "compress", "site"]);
  });

  it("starts over for another commit, and from a progress file it can't read", async () => {
    await ship({});
    const newCommitSha = "fedcba9876543210fedcba9876543210fedcba98";
    expect((await ship(Object.fromEntries(WORKERS.map((worker) => [worker, versionOf(worker)])), newCommitSha)).deployed).toEqual(WORKERS);
    expect(JSON.parse(readFileSync(progressPath, "utf8")).commit_sha).toBe(newCommitSha);
    writeFileSync(progressPath, "{ half written");
    expect(readShipProgress(progressPath, COMMIT_SHA)).toEqual({ commit_sha: COMMIT_SHA, version_ids: {}, applied_migrations: [] });
  });
});

describe("the Colima a ship started", () => {
  let folder = "";
  let markerFile = "";
  beforeEach(() => {
    folder = temporaryFolder("ship-colima-");
    markerFile = join(folder, "colima-started");
  });
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  /** A machine: whether Docker answers (colima start makes it, colima stop ends it), and each colima command. */
  const machine = (isDockerUp: boolean, { canStop = true } = {}) => {
    const state = { isDockerUp, colimaCalls: [] as string[] };
    const runs = (command: string, commandArguments: string[]) => {
      if (command === "colima") {
        state.colimaCalls.push(commandArguments[0]!);
        if (commandArguments[0] === "stop" && !canStop) return false;
        state.isDockerUp = commandArguments[0] === "start";
        return true;
      }
      return commandArguments[0] === "buildx" || state.isDockerUp;
    };
    return { state, runs };
  };

  it("stops it when this ship started it, once, after a pass or a failure", () => {
    const { state, runs } = machine(false);
    const docker = dockerForShip({ markerFile, runs });
    expect(docker.ensure()).toBeNull();
    expect(existsSync(markerFile)).toBe(true);
    docker.stopIfStarted();
    docker.stopIfStarted();
    expect(state.colimaCalls).toEqual(["start", "stop"]);
    expect(existsSync(markerFile)).toBe(false);
  });
  it("leaves it alone when it was already running, even after starting it again for a retry", () => {
    const { state, runs } = machine(true);
    const docker = dockerForShip({ markerFile, runs });
    expect(docker.ensure()).toBeNull();
    state.isDockerUp = false;
    expect(docker.ensure()).toBeNull();
    docker.stopIfStarted();
    expect(state.colimaCalls).toEqual(["start"]);
    expect(existsSync(markerFile)).toBe(false);
  });
  it("still stops it after this ship has to start it again when the Mac slept", () => {
    const { state, runs } = machine(false);
    const docker = dockerForShip({ markerFile, runs });
    docker.ensure();
    state.isDockerUp = false;
    docker.ensure();
    docker.stopIfStarted();
    expect(state.colimaCalls).toEqual(["start", "start", "stop"]);
  });
  it("has the run after an interruption start it again and stop it, as that run's own", () => {
    const { state, runs } = machine(false);
    const interrupted = dockerForShip({ markerFile, runs });
    interrupted.ensure();
    interrupted.stopIfStarted();
    const pickedUp = dockerForShip({ markerFile, runs });
    expect(pickedUp.ensure()).toBeNull();
    pickedUp.stopIfStarted();
    expect(state.colimaCalls).toEqual(["start", "stop", "start", "stop"]);
    expect(state.isDockerUp).toBe(false);
  });
  it("has the next ship stop what a ship that was killed left running", () => {
    const { state, runs } = machine(false);
    dockerForShip({ markerFile, runs }).ensure();
    const next = dockerForShip({ markerFile, runs });
    expect(next.ensure()).toBeNull();
    next.stopIfStarted();
    expect(state.colimaCalls).toEqual(["start", "stop"]);
    expect(existsSync(markerFile)).toBe(false);
  });
  it("keeps the marker when it won't stop, and says so, so the next ship tries again", () => {
    const { state, runs } = machine(false, { canStop: false });
    const said: string[] = [];
    const docker = dockerForShip({ markerFile, runs, say: (line: string) => said.push(line) });
    docker.ensure();
    docker.stopIfStarted();
    expect(said.at(-1)).toMatch(/Colima didn't stop/);
    expect(existsSync(markerFile)).toBe(true);
    expect(state.isDockerUp).toBe(true);
  });
  it("does nothing on a dry run, which never asks for Docker", () => {
    writeFileSync(markerFile, "left by a killed ship");
    const { state, runs } = machine(true);
    dockerForShip({ markerFile, runs }).stopIfStarted();
    expect(state.colimaCalls).toEqual([]);
  });
  it("is stopped by ship.mjs before its last line, on every way out", () => {
    const ship = readFileSync(join(ROOT, "scripts/ship.mjs"), "utf8");
    for (const start of ["const finish = (status, summary, exitCode) => {", "function finishInterrupted(label) {"]) expect(ship.slice(ship.indexOf(start)).split("say();")[0]).toContain("shipDocker.stopIfStarted();");
    expect(ship).toContain('process.on("exit", () => shipDocker.stopIfStarted());');
    expect(ship).toContain('worker === "photodna" ? shipDocker.ensure() : null');
    expect(ship).not.toContain("ensureDocker");
  });
});
