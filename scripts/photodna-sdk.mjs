// The photodna Worker's build needs, shared by npm run ship (scripts/ship.mjs) and a restore
// (scripts/restore.mjs): Microsoft's PhotoDNA SDK file, on Julius's machine only, and Docker to build the
// container. The SDK's license keeps it out of this public repo and away from AI agents: this copies the one
// file the hasher runs into a checkout's apps/photodna/container/sdk/ (gitignored), after checking it against
// Microsoft's published SHA-384. Nothing here reads or shows its contents.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PHOTODNA_SDK_FOLDER = process.env.PHOTODNA_SDK_FOLDER || join(homedir(), "zaisma-private", "photodna-sdk");
const PHOTODNA_SDK_SCRIPT = "webassembly/photoDnaEdgeHashS.js";
const COLIMA_STOP_TIMEOUT_MS = 120_000;

/**
 * Puts the PhotoDNA hasher's SDK file into the checkout. Answers why it couldn't, or null when it's in
 * place. Without it the photodna Worker isn't built.
 */
export function placePhotoDnaSdk(checkoutFolder) {
  const zipNames = existsSync(PHOTODNA_SDK_FOLDER) ? readdirSync(PHOTODNA_SDK_FOLDER).filter((name) => /^PhotoDNA\.EdgeHashGeneration-[\d.]+\.zip$/.test(name)).sort() : [];
  const zipName = zipNames.at(-1);
  if (!zipName) return `no PhotoDNA.EdgeHashGeneration-<version>.zip in ${PHOTODNA_SDK_FOLDER} (download it from the PhotoDNA console, or set PHOTODNA_SDK_FOLDER)`;
  const zipPath = join(PHOTODNA_SDK_FOLDER, zipName);
  const script = spawnSync("unzip", ["-p", zipPath, PHOTODNA_SDK_SCRIPT], { maxBuffer: 256 * 1024 * 1024 });
  const published = spawnSync("unzip", ["-p", zipPath, `${PHOTODNA_SDK_SCRIPT}-sha384.txt`], { encoding: "utf8" });
  if (script.status !== 0 || !script.stdout.length) return `${zipName} has no ${PHOTODNA_SDK_SCRIPT}`;
  const digest = createHash("sha384").update(script.stdout).digest("base64");
  if (published.status !== 0 || !published.stdout.includes(digest)) return `${PHOTODNA_SDK_SCRIPT} in ${zipName} doesn't match Microsoft's SHA-384 next to it`;
  const sdkFolder = join(checkoutFolder, "apps", "photodna", "container", "sdk");
  mkdirSync(sdkFolder, { recursive: true });
  writeFileSync(join(sdkFolder, "photoDnaEdgeHashS.js"), script.stdout);
  return null;
}

const works = (command, commandArguments, options = {}) => spawnSync(command, commandArguments, { stdio: "ignore", ...options }).status === 0;

/**
 * wrangler builds the photodna container with Docker and its buildx plugin. On Julius's machine that's
 * Colima: started here if it's stopped. Answers why Docker can't build, or null.
 */
export function ensureDocker({ runs = works, onColimaStarted = () => {} } = {}) {
  if (!runs("docker", ["info"])) {
    if (!runs("colima", ["start"])) return "Docker isn't running and colima start didn't start it";
    onColimaStarted();
    if (!runs("docker", ["info"])) return "Docker isn't running and colima start didn't start it";
  }
  if (!runs("docker", ["buildx", "version"])) return "Docker's buildx plugin is missing (brew install docker-buildx, then link it into ~/.docker/cli-plugins)";
  return null;
}

/**
 * Docker for one ship, which stops the Colima it started when it ends: its VM takes 2 GB of an 8 GB Mac, outside the memory cap
 * (Julius, Nov 2, 2026). Colima that was already running at its first look stays running, even if the ship has to start it again after
 * the Mac slept. markerFile says a ship started it, so a ship killed before it could stop it (no stop runs) leaves the next one
 * to stop it. An interrupted ship stops it too, and the run that picks up starts it again: that run's own.
 */
export function dockerForShip({ markerFile, say = () => {}, runs = works }) {
  let hasLooked = false;
  let isStartedByShip = false;
  return {
    ensure() {
      const isFirstLook = !hasLooked;
      hasLooked = true;
      if (isFirstLook) isStartedByShip = existsSync(markerFile);
      return ensureDocker({
        runs,
        onColimaStarted: () => {
          if (!isFirstLook && !isStartedByShip) return;
          isStartedByShip = true;
          writeFileSync(markerFile, new Date().toISOString());
        },
      });
    },
    stopIfStarted() {
      if (!isStartedByShip) return;
      isStartedByShip = false;
      say("Stopping the Colima this ship started…");
      if (runs("colima", ["stop"], { timeout: COLIMA_STOP_TIMEOUT_MS })) rmSync(markerFile, { force: true });
      else say(`Colima didn't stop; the next ship tries again, or run colima stop.`);
    },
  };
}
