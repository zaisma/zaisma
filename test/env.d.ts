import type { D1Migration } from "cloudflare:test";
import type { Env as SiteEnv } from "../apps/site/src/env.ts";

declare global {
  namespace Cloudflare {
    interface Env extends SiteEnv {
      TEST_MIGRATIONS: D1Migration[];
      /** The pass key the rooms stand-in signs receipts with (vitest.config.ts). */
      TEST_PASS_SIGNING_KEY: string;
    }
  }
}
