// The test bench's Glass (bench/glass.ts) as one JavaScript module: the site's components, layout and buy sheet, bundled from apps/site's
// source. The package build writes it to dist/bench/glass.js; in the repository, bin/local-play.js bundles it when the bench starts, so
// the bench always draws the design as the source has it.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../bench/glass.ts", import.meta.url));

/** Bundle bench/glass.ts into outFile. */
export async function buildBenchGlass(outFile) {
  await build({ entryPoints: [entry], outfile: outFile, bundle: true, format: "esm", platform: "node", target: "node22", logLevel: "error", external: ["cloudflare:*"], legalComments: "none" });
}
