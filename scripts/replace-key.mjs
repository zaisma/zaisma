#!/usr/bin/env node
// Replaces a key Zaisma holds, without breaking any game server. Cloudflare's secrets can't be read back, so each
// replaceable key has two fixed secrets, and a marker secret says which one is in use: this reads the names
// (`wrangler secret list`), flips the marker, and overwrites the slot not in use. New values go straight into
// wrangler and are never printed.
//
//   node scripts/replace-key.mjs status                 what's in use and what's missing
//   node scripts/replace-key.mjs setup                  puts every key that's missing
//   node scripts/replace-key.mjs swap <key> [--leaked]  the other slot starts signing or sealing
//   node scripts/replace-key.mjs new-spare <key>        a new key in the slot not in use
//   node scripts/replace-key.mjs chat-group             a new CHAT_GROUP_KEY
//
// <key> is pass, sign-in or stored-secrets. --dry says what it would do and changes nothing; --json answers in JSON.
//
// A swap on its own leaves the old key checking what it signed, so nothing breaks. Run new-spare a day later for pass
// (passes last a day), an hour later for sign-in (tokens last an hour), and for stored-secrets once the site's cron has
// moved every value across (minutes): it refuses until then. A leaked pass or sign-in key: swap --leaked, which
// overwrites the old slot at once, so what it signed stops checking; players get a new pass, and game servers fetch the
// keys again on a key they don't know. A leaked stored secrets key: swap, then new-spare once it lets you.
//
// PLAYER_TAG_KEY isn't here: a new one changes every tag a developer's server may keep.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { missingShipTokenHelp, useShipToken } from "./ship-token.mjs";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const CHECKOUT = join(SCRIPTS, "..");

export const STORED_WORKERS = ["zaisma-rooms", "zaisma-games", "zaisma-site"];

export const KEYS = {
  pass: { workerNames: ["zaisma-rooms"], first: "PASS_SIGNING_KEY", second: "SECOND_PASS_SIGNING_KEY", marker: "IS_SECOND_PASS_SIGNING_KEY_IN_USE", valueKind: "pass_key" },
  "sign-in": { workerNames: ["zaisma-site"], first: "SIGN_IN_SIGNING_KEY", second: "SECOND_SIGN_IN_SIGNING_KEY", marker: "IS_SECOND_SIGN_IN_SIGNING_KEY_IN_USE", valueKind: "sign_in_key" },
  "stored-secrets": { workerNames: STORED_WORKERS, first: "STORED_SECRETS_KEY", second: "SECOND_STORED_SECRETS_KEY", marker: "IS_SECOND_STORED_SECRETS_KEY_IN_USE", valueKind: "random_bytes" },
};

const CHAT_GROUP_KEY = "CHAT_GROUP_KEY";

/** One thing to do: put a secret, delete one, or copy new stored secrets keys for the password manager. */
const put = (workerNames, secretName, valueKind) => ({ step: "put", workerNames, secretName, valueKind });
const remove = (workerNames, secretName) => ({ step: "delete", workerNames, secretName });

/** Which slot of a key is in use, by its marker's name in a Worker's list of secret names. */
export function slotInUse(key, namesByWorker) {
  return (namesByWorker[key.workerNames[0]] ?? []).includes(key.marker) ? "second" : "first";
}

const isOnEveryWorker = (key, secretName, namesByWorker) => key.workerNames.every((workerName) => (namesByWorker[workerName] ?? []).includes(secretName));

/** What's missing from production. A stored secrets key on only some Workers can't be mended: it can't be read back to copy. */
export function setupSteps(namesByWorker) {
  const steps = [];
  const stored = KEYS["stored-secrets"];
  for (const secretName of [stored.first, stored.second]) {
    const holders = stored.workerNames.filter((workerName) => (namesByWorker[workerName] ?? []).includes(secretName));
    if (holders.length && holders.length < stored.workerNames.length) throw new Error(`${secretName} is on ${holders.join(", ")} only, and can't be read back to copy. Delete it from them, then run setup again.`);
    if (!holders.length) steps.push(put(stored.workerNames, secretName, "random_bytes"));
  }
  if (!isOnEveryWorker(KEYS.pass, KEYS.pass.second, namesByWorker)) steps.push(put(KEYS.pass.workerNames, KEYS.pass.second, "pass_key"));
  if (!isOnEveryWorker(KEYS["sign-in"], KEYS["sign-in"].second, namesByWorker)) steps.push(put(KEYS["sign-in"].workerNames, KEYS["sign-in"].second, "sign_in_key"));
  if (!isOnEveryWorker(KEYS.pass, CHAT_GROUP_KEY, namesByWorker)) steps.push(put(KEYS.pass.workerNames, CHAT_GROUP_KEY, "random_bytes"));
  return steps;
}

/** A swap: the marker flips, on the site last for stored secrets, since every Worker opens both slots either way. */
export function swapSteps(keyName, namesByWorker, { isLeaked = false } = {}) {
  const key = KEYS[keyName];
  if (isLeaked && keyName === "stored-secrets") throw new Error("A leaked stored secrets key can't be overwritten until every value has moved off it: swap without --leaked, then new-spare once it lets you.");
  const inUse = slotInUse(key, namesByWorker);
  // A swap that stopped partway: the first Worker has flipped, so this finishes it rather than flipping that one back.
  const unflipped = key.workerNames.filter((workerName) => (namesByWorker[workerName] ?? []).includes(key.marker) !== (inUse === "second"));
  if (unflipped.length) return [inUse === "second" ? put(unflipped, key.marker, "true") : remove(unflipped, key.marker)];
  const nextName = inUse === "first" ? key.second : key.first;
  if (!isOnEveryWorker(key, nextName, namesByWorker)) throw new Error(`${nextName} isn't on every Worker it needs: run setup first.`);
  const steps = [inUse === "first" ? put(key.workerNames, key.marker, "true") : remove(key.workerNames, key.marker)];
  if (isLeaked) steps.push(put(key.workerNames, inUse === "first" ? key.first : key.second, key.valueKind));
  return steps;
}

/** A new key in the slot not in use. Overwriting a stored secrets slot that still seals values would lose them. */
export function newSpareSteps(keyName, namesByWorker, { sealedCountInSpare = 0 } = {}) {
  const key = KEYS[keyName];
  const spareSlot = slotInUse(key, namesByWorker) === "first" ? "second" : "first";
  if (keyName === "stored-secrets" && sealedCountInSpare > 0) throw new Error(`${sealedCountInSpare} values are still sealed with the ${spareSlot} slot. The site's cron moves 500 per table every 5 minutes: run this again once it has.`);
  return [put(key.workerNames, spareSlot === "first" ? key.first : key.second, key.valueKind)];
}

function wrangler(args, input) {
  const result = spawnSync("npx", ["wrangler", ...args], { cwd: CHECKOUT, encoding: "utf8", input, env: { ...process.env, FORCE_COLOR: "0" } });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function secretNames(workerName) {
  const listed = wrangler(["secret", "list", "--name", workerName, "--format", "json"]);
  if (listed.exitCode !== 0) throw new Error(`Couldn't list ${workerName}'s secrets: ${listed.output.trim()}`);
  return JSON.parse(listed.stdout).map((secret) => secret.name);
}

function secretNamesByWorker() {
  return Object.fromEntries(STORED_WORKERS.map((workerName) => [workerName, secretNames(workerName)]));
}

/** How many values are sealed with a slot, on the live database. Before migration 0222 there are none. */
function sealedCount(slot) {
  const counted = wrangler(["d1", "execute", "zaisma", "--remote", "--json", "--command", `SELECT (SELECT count(*) FROM webhooks WHERE sealed_signing_secret LIKE '${slot}.%') + (SELECT count(*) FROM tester_links WHERE sealed_token LIKE '${slot}.%') AS sealed_count`]);
  if (counted.exitCode !== 0) {
    if (counted.output.includes("no such column")) return 0;
    throw new Error(`Couldn't count what's sealed: ${counted.output.trim()}`);
  }
  return JSON.parse(counted.stdout)[0].results[0].sealed_count;
}

function newValue(valueKind) {
  if (valueKind === "true") return "true";
  if (valueKind === "random_bytes") return randomBytes(32).toString("base64");
  const script = valueKind === "pass_key" ? "rooms-key.mjs" : "sign-in-key.mjs";
  const made = spawnSync(process.execPath, [join(SCRIPTS, script)], { encoding: "utf8" });
  if (made.status !== 0 || !made.stdout) throw new Error(`${script} failed: ${made.stderr}`);
  return made.stdout;
}

/**
 * Does the steps, the same new value on every Worker a step names. New stored secrets keys go to the clipboard for the
 * password manager, never to the screen: a restore from outside Cloudflare can't open what they sealed without them.
 */
function run(steps) {
  const newStoredKeys = {};
  for (const step of steps) {
    const value = step.step === "put" ? newValue(step.valueKind) : null;
    if (step.step === "put" && step.secretName.endsWith("STORED_SECRETS_KEY")) newStoredKeys[step.secretName] = value;
    for (const workerName of step.workerNames) {
      const done = step.step === "put" ? wrangler(["secret", "put", step.secretName, "--name", workerName], value) : wrangler(["secret", "delete", step.secretName, "--name", workerName]);
      if (done.exitCode !== 0) throw new Error(`${step.step} ${step.secretName} on ${workerName} failed: ${done.output.trim()}`);
    }
  }
  if (!Object.keys(newStoredKeys).length) return { isCopiedToClipboard: false };
  const copied = spawnSync("pbcopy", [], { input: JSON.stringify(newStoredKeys) });
  if (copied.status !== 0) throw new Error("The new stored secrets keys are in place, but couldn't be copied to the clipboard. They can't be read back: delete them and run this again on a Mac.");
  return { isCopiedToClipboard: true };
}

function describe(step) {
  return `${step.step} ${step.secretName} on ${step.workerNames.join(", ")}`;
}

async function main() {
  const given = process.argv.slice(2);
  const isDry = given.includes("--dry");
  const isJson = given.includes("--json");
  const isLeaked = given.includes("--leaked");
  const [command, keyName, ...rest] = given.filter((word) => !word.startsWith("--"));
  const unknownFlag = given.find((word) => word.startsWith("--") && !["--dry", "--json", "--leaked"].includes(word));
  const say = (answer, words) => console.log(isJson ? JSON.stringify(answer, null, 2) : words);
  const takesKey = command === "swap" || command === "new-spare";
  if (unknownFlag || rest.length || !["status", "setup", "swap", "new-spare", "chat-group"].includes(command) || (takesKey ? !Object.hasOwn(KEYS, keyName ?? "") : keyName) || (isLeaked && command !== "swap")) {
    throw new Error("Use: status, setup, swap <pass|sign-in|stored-secrets> [--leaked], new-spare <pass|sign-in|stored-secrets> or chat-group, with --dry or --json.");
  }

  // The token ship deploys with, never wrangler's sign-in, which is one per Mac and may be on another account.
  if (!useShipToken()) throw new Error(missingShipTokenHelp());
  const namesByWorker = secretNamesByWorker();
  if (command === "status") {
    const keys = Object.fromEntries(Object.entries(KEYS).map(([name, key]) => [name, { slot_in_use: slotInUse(key, namesByWorker), is_second_slot_set: isOnEveryWorker(key, key.second, namesByWorker) }]));
    const missing = setupSteps(namesByWorker).map(describe);
    return say({ keys, missing }, [...Object.entries(keys).map(([name, key]) => `${name}: ${key.slot_in_use} slot in use, second slot ${key.is_second_slot_set ? "set" : "not set"}`), missing.length ? `Missing: ${missing.join("; ")}` : "Nothing missing."].join("\n"));
  }

  let steps;
  if (command === "setup") steps = setupSteps(namesByWorker);
  if (command === "swap") steps = swapSteps(keyName, namesByWorker, { isLeaked });
  if (command === "chat-group") steps = [put(KEYS.pass.workerNames, CHAT_GROUP_KEY, "random_bytes")];
  if (command === "new-spare") {
    const spareSlot = slotInUse(KEYS[keyName], namesByWorker) === "first" ? "second" : "first";
    steps = newSpareSteps(keyName, namesByWorker, { sealedCountInSpare: keyName === "stored-secrets" ? sealedCount(spareSlot) : 0 });
  }
  const planned = steps.map(describe);
  if (isDry) return say({ is_dry: true, steps: planned }, planned.length ? planned.join("\n") : "Nothing to do.");
  const { isCopiedToClipboard } = run(steps);
  say({ steps: planned, is_copied_to_clipboard: isCopiedToClipboard }, [...(planned.length ? planned : ["Nothing to do."]), ...(isCopiedToClipboard ? ["The new stored secrets keys are on the clipboard: paste them into the password manager now. They can't be read back."] : [])].join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
