// The photodna Worker's build needs, shared by npm run ship (scripts/ship.mjs) and a restore
// (scripts/restore.mjs): Microsoft's PhotoDNA SDK file, on Julius's machine only, and Docker to build the
// container. The SDK's license keeps it out of this public repo and away from AI agents: this copies the one
// file the hasher runs into a checkout's apps/photodna/container/sdk/ (gitignored), after checking it against
// Microsoft's published SHA-384. Nothing here reads or shows its contents.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PHOTODNA_SDK_FOLDER = process.env.PHOTODNA_SDK_FOLDER || join(homedir(), "zaisma-private", "photodna-sdk");
const PHOTODNA_SDK_SCRIPT = "webassembly/photoDnaEdgeHashS.js";

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

/**
 * wrangler builds the photodna container with Docker and its buildx plugin. On Julius's machine that's
 * Colima: started here if it's stopped. Answers why Docker can't build, or null.
 */
export function ensureDocker() {
  const works = (command, commandArguments) => spawnSync(command, commandArguments, { stdio: "ignore" }).status === 0;
  if (!works("docker", ["info"]) && (!works("colima", ["start"]) || !works("docker", ["info"]))) return "Docker isn't running and colima start didn't start it";
  if (!works("docker", ["buildx", "version"])) return "Docker's buildx plugin is missing (brew install docker-buildx, then link it into ~/.docker/cli-plugins)";
  return null;
}
