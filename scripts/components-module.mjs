// Loads the site's components module (apps/site/src/components/index.ts) into a script: it is TypeScript, so it is bundled with
// esbuild and imported from memory. Used by minify-components.mjs and design-catalog.mjs.

import { join, resolve } from "node:path";
import { build } from "esbuild";

export const ROOT = resolve(import.meta.dirname, "..");
export const COMPONENTS_DIRECTORY = join(ROOT, "apps/site/src/components");

export async function loadComponentsModule() {
  const bundled = await build({ entryPoints: [join(COMPONENTS_DIRECTORY, "index.ts")], bundle: true, write: false, format: "esm", platform: "node", target: "node22", logLevel: "error" });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
}
