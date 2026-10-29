// Build what npm publishes (npm run build -w packages/game-server): dist/ holds the package as
// @zaisma/game-server 1.x ships it, built JavaScript with its types. The repository runs the same
// code from TypeScript source; only this folder is published, by the Publish game server workflow.
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDir = join(packageDir, "../..");
const distDir = join(packageDir, "dist");
const source = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));

rmSync(distDir, { recursive: true, force: true });
mkdirSync(join(distDir, "bin"), { recursive: true });

const tsc = join(repositoryDir, "node_modules/typescript/bin/tsc");
execFileSync(process.execPath, [tsc, "-p", join(packageDir, "tsconfig.build.json")], { cwd: packageDir, stdio: "inherit" });

// The runner and its parts import the source by its TypeScript file names; built, those are JavaScript.
for (const file of ["node.js", "node-parts.js", "fast-lane.js", "node.d.ts", "local-play.js", "local-play-bench.js", "local-play-runner.js", "local-play-certificate.js", "local-play.d.ts", "local-play-bench.d.ts"]) {
  const text = readFileSync(join(packageDir, "bin", file), "utf8");
  writeFileSync(join(distDir, "bin", file), text.replace(/(\.\.\/src\/[a-z-]+)\.ts"/g, '$1.js"'));
}
// The test bench's Glass, bundled from the site's components (scripts/bench.mjs), and the font its pages name.
const { buildBenchGlass } = await import("./bench.mjs");
await buildBenchGlass(join(distDir, "bench/glass.js"));
// The brand folder the site serves (logos, favicons, the loader, the font with its license), without its design sources.
cpSync(join(repositoryDir, "brand"), join(distDir, "bench/brand"), { recursive: true, filter: (source) => !/\.afdesign$/.test(source) });
// play-locally serves the same SDK as Zaisma: its files go beside bin/, where bin/local-play.js looks for them.
mkdirSync(join(distDir, "sdk"), { recursive: true });
for (const file of ["zaisma.js", "zaisma.d.ts", "saves.js", "relay.js", "picture.js"]) copyFileSync(join(repositoryDir, "packages/sdk", file), join(distDir, "sdk", file));
copyFileSync(join(packageDir, "README.md"), join(distDir, "README.md"));
copyFileSync(join(repositoryDir, "LICENSE"), join(distDir, "LICENSE"));

writeFileSync(
  join(distDir, "package.json"),
  `${JSON.stringify(
    {
      name: source.name,
      version: source.version,
      description: "Run your Zaisma game server: the same rooms on Zaisma or on your own server.",
      license: "MIT",
      homepage: "https://zaisma.com",
      repository: { type: "git", url: "git+https://github.com/zaisma/zaisma.git", directory: "packages/game-server" },
      bugs: "https://github.com/zaisma/zaisma/issues",
      keywords: ["zaisma", "games", "browser-games", "multiplayer", "game-server", "websocket"],
      type: "module",
      exports: {
        ".": { types: "./src/index.d.ts", default: "./src/index.js" },
        "./node": { types: "./bin/node.d.ts", default: "./bin/node.js" },
        "./package.json": "./package.json",
      },
      bin: { "zaisma-game-server": "bin/node.js" },
      engines: source.engines,
      dependencies: source.dependencies,
      // The fast lane's WebTransport server (bin/fast-lane.js): optional peers, installed by developers who use
      // --webtransport-port and loaded only then, so nobody else downloads them or runs their install script.
      peerDependencies: source.peerDependencies,
      peerDependenciesMeta: source.peerDependenciesMeta,
    },
    null,
    2,
  )}\n`,
);
console.log(`Built ${source.name} ${source.version} in ${distDir}`);
