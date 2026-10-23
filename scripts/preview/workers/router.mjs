// The preview's front door (run.mjs). The site, games, rooms and compress Workers all run in one wrangler dev, which
// listens on the site's port; run.mjs forwards the games and rooms ports to it, so a request's port says which Worker
// it's for. Each Worker sees the request as it was sent, its own port included. The every-few-minutes jobs
// (GET /__scheduled?cron=…, as wrangler's --test-scheduled answers them) go to that port's Worker's scheduled handler.
// On a phone (PHONE_HOST), Tailscale Serve hands requests on over http, and run.mjs sends its own to localhost: the Workers
// see every one as sent to https://PHONE_HOST on its port, the address the preview is on, so they match SITE_ORIGIN and the Origin.
export default {
  async fetch(request, environment) {
    const url = new URL(request.url);
    if (environment.PHONE_HOST && (url.hostname !== environment.PHONE_HOST || url.protocol !== "https:")) {
      url.protocol = "https:";
      url.hostname = environment.PHONE_HOST;
      request = new Request(url, request);
      // Wrangler gives an Origin or Referer on the request's own name the request's http: they were sent as https.
      for (const name of ["origin", "referer"]) {
        const value = request.headers.get(name);
        if (value?.startsWith(`http://${environment.PHONE_HOST}:`)) request.headers.set(name, `https${value.slice(4)}`);
      }
    }
    const worker = url.port === environment.GAMES_PORT ? environment.GAMES : url.port === environment.ROOMS_PORT ? environment.ROOMS : environment.SITE;
    if (url.pathname === "/__scheduled" && worker !== environment.GAMES) {
      await worker.scheduled({ cron: url.searchParams.get("cron") ?? "", scheduledTime: Date.now() });
      return new Response("Ran scheduled event");
    }
    return worker.fetch(request);
  },
};
