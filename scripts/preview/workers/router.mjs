// The preview's front door (run.mjs). The site, games, rooms and compress Workers all run in one wrangler dev, which
// listens on the site's port; run.mjs forwards the games and rooms ports to it, so a request's port says which Worker
// it's for. Each Worker sees the request as it was sent, its own port included. The every-few-minutes jobs
// (GET /__scheduled?cron=…, as wrangler's --test-scheduled answers them) go to that port's Worker's scheduled handler.
export default {
  async fetch(request, environment) {
    const url = new URL(request.url);
    const worker = url.port === environment.GAMES_PORT ? environment.GAMES : url.port === environment.ROOMS_PORT ? environment.ROOMS : environment.SITE;
    if (url.pathname === "/__scheduled" && worker !== environment.GAMES) {
      await worker.scheduled({ cron: url.searchParams.get("cron") ?? "", scheduledTime: Date.now() });
      return new Response("Ran scheduled event");
    }
    return worker.fetch(request);
  },
};
