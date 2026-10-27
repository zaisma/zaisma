// The test bench's Glass (bench/glass.ts) as one JavaScript module: the site's components, layout and game page, bundled from apps/site's
// source. The package build writes it to dist/bench/glass.js; in the repository, bin/local-play.js bundles it when the bench starts, so
// the bench always draws the design as the source has it.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../bench/glass.ts", import.meta.url));

// The site's Worker modules the game page's imports reach (cloudflare:workers, cloudflare:email) exist only on Cloudflare. Nothing the bench
// draws uses them, so they become empty classes of the same names.
const cloudflareStandIn = {
  name: "cloudflare-stand-in",
  setup(builder) {
    builder.onResolve({ filter: /^cloudflare:/ }, (given) => ({ path: given.path, namespace: "cloudflare-stand-in" }));
    builder.onLoad({ filter: /.*/, namespace: "cloudflare-stand-in" }, () => ({ contents: "export class WorkerEntrypoint {}\nexport class DurableObject {}\nexport class EmailMessage {}\n", loader: "js" }));
  },
};

/** Bundle bench/glass.ts into outFile. */
export async function buildBenchGlass(outFile) {
  await build({ entryPoints: [entry], outfile: outFile, bundle: true, format: "esm", platform: "node", target: "node22", logLevel: "error", plugins: [cloudflareStandIn], legalComments: "none" });
}
