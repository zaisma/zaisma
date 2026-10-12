import type { ScanJob } from "@zaisma/core";
import { handleAdmin } from "./admin.ts";
import type { Env } from "./env.ts";
import { message } from "./html.ts";
import { gamePage, home, legal, reportForm, submitReport } from "./pages.ts";
import { handleScanBatch } from "./scan.ts";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    if (path === "/admin" || path.startsWith("/admin/")) return handleAdmin(request, env, path);
    if (method !== "GET" && method !== "HEAD" && method !== "POST") return new Response("Method not allowed", { status: 405 });

    if (path === "/" && method !== "POST") return home(env);

    const game = path.match(/^\/g\/([a-z0-9-]+)(\/report)?$/);
    if (game) {
      const [, slug, report] = game as unknown as [string, string, string | undefined];
      if (!report && method !== "POST") return gamePage(env, slug, url);
      if (report && method === "POST") return submitReport(env, request, slug, ctx);
      if (report) return reportForm(env, slug);
    }

    const legalPage = path.match(/^\/legal\/([a-z-]+)$/);
    if (legalPage && method !== "POST") {
      const res = legal(env, legalPage[1]!);
      if (res) return res;
    }

    if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /admin\n", { headers: { "Content-Type": "text/plain" } });
    return message(env, "Page not found", "There's nothing at this address.", 404);
  },

  async queue(batch, env): Promise<void> {
    await handleScanBatch(batch, env);
  },
} satisfies ExportedHandler<Env, ScanJob>;
