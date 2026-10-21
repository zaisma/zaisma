// The site Worker as the preview runs it: unchanged, except database calls are tried again when
// another preview server has the database locked (retry-when-locked.mjs), and developers' calls
// (DEV_LIMIT, FILE_LIMIT) have no rate limit, so seeding the test data never waits on a 429. Production
// keeps its limits: this file is only the preview's entry.
import site from "../../../apps/site/src/index.ts";
import { workerRetryingWhenLocked } from "./retry-when-locked.mjs";

export * from "../../../apps/site/src/index.ts";

const unlimited = { limit: async () => ({ success: true }) };
const unlimitedBindings = new Set(["DEV_LIMIT", "FILE_LIMIT"]);
const withoutDeveloperLimits = new WeakMap();

function unlimitedDeveloperCalls(environment) {
  let unlimitedEnvironment = withoutDeveloperLimits.get(environment);
  if (!unlimitedEnvironment) {
    unlimitedEnvironment = new Proxy(environment, { get: (target, name) => (unlimitedBindings.has(name) ? unlimited : Reflect.get(target, name)) });
    withoutDeveloperLimits.set(environment, unlimitedEnvironment);
  }
  return unlimitedEnvironment;
}

export default workerRetryingWhenLocked({ ...site, fetch: (request, environment, context) => site.fetch(request, unlimitedDeveloperCalls(environment), context) });
