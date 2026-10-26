// The addresses a Worker names, request by request, in the preview (run.mjs). On the tailnet (PHONE_HOST) a Worker's settings
// (SITE_ORIGIN, GAME_ORIGIN, ROOMS_ORIGIN) name this Mac's tailnet name, as a phone sees it. A request sent to localhost or
// 127.0.0.1 (a session's checks in the app's browser pane, which asks before every step anywhere else) gets
// PREVIEW_LOCAL_SETTINGS in their place: the same settings at localhost, the games on 127.0.0.1, another site as in production.
// So every link, redirect, frame and room a Worker answers with is on the address its request came to, with nothing rewritten.
// What has no request of its own (scheduled jobs, queues, Durable Objects) keeps the tailnet's settings.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const localEnvironments = new WeakMap();

/** The environment a Worker answers this request with: at localhost, its settings at localhost; else as it was. */
export function environmentAt(request, environment) {
  if (!environment?.PREVIEW_LOCAL_SETTINGS || !LOCAL_HOSTS.has(new URL(request.url).hostname)) return environment;
  let local = localEnvironments.get(environment);
  if (!local) {
    const settings = JSON.parse(environment.PREVIEW_LOCAL_SETTINGS);
    local = new Proxy(environment, { get: (target, name) => (Object.hasOwn(settings, name) ? settings[name] : Reflect.get(target, name)) });
    localEnvironments.set(environment, local);
  }
  return local;
}
