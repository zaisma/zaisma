#!/usr/bin/env node
// The preview's Workers in one runtime, with nothing else around it (run.mjs starts this). Each Worker is bundled by wrangler's own bundler
// in a process that ends (the command a deploy runs, as a dry run), and only again when a file in it changes; Miniflare runs the bundles.
// wrangler dev kept a bundler and its watcher, a second runtime for its proxy and a copy of every bundle in memory for the whole life of a
// preview: 763 MB of a 1.8 GB preview, and about 1.1 GB after an edit, against about 95 MB for this process (measured on an 8 GB Mac, Nov 4, 2026).
//   node servers.mjs --port <port> --persist-to <folder> --config <wrangler config>…
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { createRequire, SourceMap } from "node:module";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WRANGLER = join(ROOT, "node_modules/wrangler/wrangler-dist/cli.js");
// The Miniflare wrangler itself runs on, so the two never differ.
const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = createRequire(WRANGLER)("miniflare");
const argumentAfter = (name) => process.argv[process.argv.indexOf(name) + 1];
const configFiles = process.argv.flatMap((value, index) => (process.argv[index - 1] === "--config" ? [value] : []));
const port = Number(argumentAfter("--port"));
const persistTo = argumentAfter("--persist-to");
const BUILT = join(persistTo, "built");
const WATCHED_FOLDERS = ["apps", "packages", "scripts/preview", "brand"].map((folder) => join(ROOT, folder));
// A bundler takes 300 to 450 MB while it runs: two at a time keeps a change to a shared package to a few seconds without holding much more.
const BUNDLERS_AT_ONCE = 2;
const startedAtMs = Date.now();

const configOf = (configFile) => JSON.parse(readFileSync(configFile, "utf8"));
const builtFolder = (configFile) => join(BUILT, basename(configFile, ".json"));
const hashOf = (text) => createHash("sha256").update(text).digest("hex");
/** What a bundle depends on in its config: everything but the settings, which change with the preview's port and don't reach it. */
const bundleSettingsHash = (configFile) => hashOf(JSON.stringify({ ...configOf(configFile), vars: null }));
const stampsOf = (files) =>
  Object.fromEntries(
    files.flatMap((file) => {
      try {
        const { size, mtimeMs } = statSync(file);
        return [[file, `${size}:${mtimeMs}`]];
      } catch {
        return [];
      }
    }),
  );
/** Every file under these folders with one of these names. */
function filesNamed(names, folders) {
  const found = [];
  for (const folder of folders) {
    if (!existsSync(folder)) continue;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".wrangler") found.push(...filesNamed(names, [join(folder, entry.name)]));
      } else if (names.has(entry.name)) found.push(join(folder, entry.name));
    }
  }
  return found;
}
const LEFT_OUT_OF_MODULES = new Set(["README.md", "meta.json", "stamps.json"]);
/** The bundle's files besides its main one: the Text and other modules wrangler put beside it, named <hash>-<name>. */
function otherModules(configFile) {
  const mainName = `${basename(configOf(configFile).main).replace(/\.[a-z]+$/, "")}.js`;
  return readdirSync(builtFolder(configFile)).filter((file) => file !== mainName && !LEFT_OUT_OF_MODULES.has(file) && !file.endsWith(".map"));
}

/** Bundles this Worker, unless nothing it's made from changed since the last time. Answers whether it did. */
async function bundle(configFile) {
  const folder = builtFolder(configFile);
  const stampFile = join(folder, "stamps.json");
  const settingsHash = bundleSettingsHash(configFile);
  if (existsSync(stampFile)) {
    const kept = JSON.parse(readFileSync(stampFile, "utf8"));
    if (kept.settings_hash === settingsHash && JSON.stringify(stampsOf(Object.keys(kept.stamps))) === JSON.stringify(kept.stamps)) return false;
  }
  const output = [];
  const exitCode = await new Promise((done) => {
    const bundler = spawn(process.execPath, ["--no-warnings", WRANGLER, "deploy", "--dry-run", "--config", configFile, "--outdir", folder, "--metafile", join(folder, "meta.json")], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "0", WRANGLER_SEND_METRICS: "false" } });
    bundler.stdout.on("data", (chunk) => output.push(chunk));
    bundler.stderr.on("data", (chunk) => output.push(chunk));
    bundler.once("close", done);
  });
  if (exitCode !== 0) throw new Error(`Bundling ${basename(configFile)} failed:\n${Buffer.concat(output)}`);
  const inputs = Object.keys(JSON.parse(readFileSync(join(folder, "meta.json"), "utf8")).inputs).map((file) => resolve(dirname(configFile), file.replace(/^[a-z-]+:/, "")));
  // The bundler's list leaves out the files that became modules of their own, like the games Worker's scripts it serves as text.
  const moduleNames = new Set(otherModules(configFile).map((file) => file.replace(/^[0-9a-f]{40}-/, "")));
  const moduleFiles = moduleNames.size ? filesNamed(moduleNames, WATCHED_FOLDERS) : [];
  writeFileSync(stampFile, JSON.stringify({ settings_hash: settingsHash, stamps: stampsOf([...inputs, ...moduleFiles]) }));
  return true;
}

/** Bundles what changed; answers the Workers it bundled. Every Worker is tried, and the first failure thrown after. */
async function bundleAll() {
  const waiting = [...configFiles];
  const bundled = [];
  const failures = [];
  const bundleNext = async () => {
    for (let configFile; (configFile = waiting.shift()); ) {
      try {
        if (await bundle(configFile)) bundled.push(configFile);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: BUNDLERS_AT_ONCE }, bundleNext));
  if (failures.length) throw Object.assign(failures[0], { bundled });
  return bundled;
}

/** Miniflare's options for each Worker, from its wrangler config: read in a process that ends, since loading wrangler takes 200 MB. */
function workerOptionsFromConfigs() {
  const file = join(BUILT, "options.json");
  const settingsHash = hashOf(configFiles.map((configFile) => readFileSync(configFile, "utf8")).join());
  if (existsSync(file)) {
    const kept = JSON.parse(readFileSync(file, "utf8"));
    if (kept.settings_hash === settingsHash) return kept.options;
  }
  const script = `const { unstable_getMiniflareWorkerOptions: optionsOf } = require(${JSON.stringify(WRANGLER)});
    process.stdout.write(JSON.stringify(${JSON.stringify(configFiles)}.map((configFile) => optionsOf(configFile).workerOptions)));`;
  const result = spawnSync(process.execPath, ["--no-warnings", "-e", script], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Reading the Workers' settings failed:\n${result.stderr}`);
  const options = JSON.parse(result.stdout);
  writeFileSync(file, JSON.stringify({ settings_hash: settingsHash, options }));
  return options;
}

// The servers' log names places in the bundles; these name them in the source, as wrangler dev did. A map is read only when there's an
// error to place, and let go soon after.
const SOURCE_MAP_KEPT_MS = 30_000;
const sourceMaps = new Map();
let forgetSourceMaps = null;
function placeInSource(file, line, column) {
  const configFile = configFiles.find((candidate) => existsSync(join(builtFolder(candidate), `${file}.map`)));
  if (!configFile) return null;
  if (!sourceMaps.has(file)) sourceMaps.set(file, new SourceMap(JSON.parse(readFileSync(join(builtFolder(configFile), `${file}.map`), "utf8"))));
  clearTimeout(forgetSourceMaps);
  forgetSourceMaps = setTimeout(() => sourceMaps.clear(), SOURCE_MAP_KEPT_MS);
  const entry = sourceMaps.get(file).findEntry(line - 1, column - 1);
  return entry?.originalSource ? `${entry.originalSource.replace(/^(\.\.\/)+/, "")}:${entry.originalLine + 1}:${entry.originalColumn + 1}` : null;
}
const withPlacesInSource = (message) =>
  message.replace(/\b([\w-]+\.js):(\d+):(\d+)/g, (place, file, line, column) => {
    try {
      return placeInSource(file, Number(line), Number(column)) ?? place;
    } catch {
      return place;
    }
  });

function miniflareOptions() {
  const optionsOfWorkers = workerOptionsFromConfigs();
  return convertV4MiniflareOptions({
    rootPath: ROOT,
    host: "localhost",
    port,
    resourcePersistencePath: join(persistTo, "v3"),
    resourceTmpPath: join(persistTo, "tmp"),
    unsafeTriggerHandlers: true,
    unsafeDevRegistryPath: process.env.WRANGLER_REGISTRY_PATH,
    log: new Log(LogLevel.INFO),
    handleStructuredLogs: ({ level, message }) => (level === "error" || level === "warn" ? console.error : console.log)(level === "error" ? withPlacesInSource(message) : message),
    workers: configFiles.map((configFile, index) => {
      const { modulesRules, ...options } = optionsOfWorkers[index];
      const config = configOf(configFile);
      const folder = builtFolder(configFile);
      const isEmpty = (value) => value === null || (Array.isArray(value) && !value.length) || (typeof value === "object" && value !== null && !Array.isArray(value) && !Object.keys(value).length);
      return {
        ...Object.fromEntries(Object.entries(options).filter(([, value]) => !isEmpty(value))),
        rootPath: ROOT,
        name: config.name,
        modulesRoot: folder,
        modules: [{ type: "ESModule", path: join(folder, `${basename(config.main).replace(/\.[a-z]+$/, "")}.js`) }, ...otherModules(configFile).map((file) => ({ type: file.endsWith(".wasm") ? "CompiledWasm" : file.endsWith(".bin") ? "Data" : "Text", path: join(folder, file) }))],
      };
    }),
  });
}

mkdirSync(BUILT, { recursive: true });
const inputsOf = (configFile) => {
  try {
    return Object.keys(JSON.parse(readFileSync(join(builtFolder(configFile), "stamps.json"), "utf8")).stamps);
  } catch {
    return [];
  }
};
const assetFolders = configFiles.flatMap((configFile) => configOf(configFile).assets?.directory ?? []);

// A file a bundle is made from changed: bundle that Worker again and load the new bundles. A change that doesn't bundle (a mistake being
// fixed) leaves the last good bundles running, and says why in the log.
let miniflare = null;
let reloadTimer = null;
let reloading = Promise.resolve();
let areAssetsChanged = false;
let whenFileChanges = null;
function reload() {
  reloading = reloading
    .then(async () => {
      const beganAtMs = Date.now();
      const bundled = await bundleAll().catch((error) => {
        console.error(error.message);
        return error.bundled ?? [];
      });
      if (!miniflare || (!bundled.length && !areAssetsChanged)) return;
      areAssetsChanged = false;
      await miniflare.setOptions(miniflareOptions());
      console.log(`[servers] Reloaded ${bundled.map((configFile) => basename(configFile, ".json")).join(", ") || "the files it serves"} in ${Date.now() - beganAtMs} ms`);
    })
    .catch((error) => console.error(error.message));
}
// Nothing edits files on GitHub's runners, and watching a folder takes a watcher for each folder under it there.
if (!process.env.CI) {
  for (const folder of WATCHED_FOLDERS) {
    if (!existsSync(folder)) continue;
    watch(folder, { recursive: true }, (_event, file) => {
      if (!file || file.split(sep).some((part) => part === "node_modules" || part === ".wrangler")) return;
      const changed = join(folder, file);
      whenFileChanges?.();
      const isAsset = assetFolders.some((assetFolder) => changed.startsWith(assetFolder + sep));
      if (isAsset) areAssetsChanged = true;
      if (!isAsset && !configFiles.some((configFile) => inputsOf(configFile).includes(changed))) return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(reload, 100);
    });
  }
}

// What won't bundle at the start runs its last good bundle, or waits for the mistake to be fixed when it has none.
const hasEveryBundle = () => configFiles.every((configFile) => existsSync(join(builtFolder(configFile), "stamps.json")));
for (;;) {
  try {
    const bundled = await bundleAll();
    if (bundled.length) console.log(`[servers] Bundled ${bundled.map((configFile) => basename(configFile, ".json")).join(", ")} in ${Date.now() - startedAtMs} ms`);
    break;
  } catch (error) {
    console.error(error.message);
    if (hasEveryBundle()) break;
    if (process.env.CI) process.exit(1);
    console.error("[servers] Waiting for a change to try again.");
    await new Promise((done) => (whenFileChanges = done));
    whenFileChanges = null;
  }
}
miniflare = new Miniflare(miniflareOptions());
await miniflare.ready;
console.log(`[servers] Up in ${Date.now() - startedAtMs} ms`);

const stop = () => miniflare.dispose().finally(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
