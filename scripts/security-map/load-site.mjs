import { join } from "node:path";
import { build } from "esbuild";

/**
 * The site's own declarations of its doors, read from the code itself: API_ROUTES and apiRoutesAt
 * (apps/site/src/developer.ts), the MCP's TOOLS (mcp.ts) and the admin MCP's ADMIN_TOOLS (admin-mcp.ts).
 * A plain import can't load them (TypeScript parameter properties, and Workers' cloudflare: modules), so
 * they're bundled with esbuild the way vitest.config.ts loads them for the Node tests, with the same
 * stand-in for cloudflare:email, and imported from the bundle's text. A new route is on the map as soon
 * as it compiles.
 */
export async function loadSiteModule(repoRoot) {
  const siteSource = join(repoRoot, "apps/site/src");
  const bundled = await build({
    stdin: {
      contents: `export { API_ROUTES, apiRoutesAt } from "./developer.ts";\nexport { TOOLS } from "./mcp.ts";\nexport { ADMIN_TOOLS } from "./admin-mcp.ts";\n`,
      resolveDir: siteSource,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
    alias: { "cloudflare:email": join(repoRoot, "test/node/cloudflare-email.ts") },
  });
  const moduleText = bundled.outputFiles[0].text;
  const { API_ROUTES, apiRoutesAt, TOOLS, ADMIN_TOOLS } = await import(`data:text/javascript;base64,${Buffer.from(moduleText).toString("base64")}`);
  return { API_ROUTES, apiRoutesAt, TOOLS, ADMIN_TOOLS };
}
