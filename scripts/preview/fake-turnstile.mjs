// A stand-in for Cloudflare's Turnstile siteverify, for local previews only, so the site's check on Play,
// sign-ups and email codes runs with no outside call. It answers as Cloudflare does for its published
// test secrets: "1x…AA" passes any token, "2x…AA" fails every one, and anything else is an invalid secret.
import http from "node:http";
import { fileURLToPath } from "node:url";

export function startFakeTurnstile(port) {
  const PASSES = "1x0000000000000000000000000000000AA";
  const FAILS = "2x0000000000000000000000000000000AA";
  http
    .createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const url = new URL(req.url, "http://localhost");
        if (req.method !== "POST" || url.pathname !== "/turnstile/v0/siteverify") {
          res.writeHead(404, { "content-type": "application/json" });
          return res.end(JSON.stringify({ success: false, "error-codes": ["not-found"] }));
        }
        const form = new URLSearchParams(Buffer.concat(chunks).toString());
        const secret = form.get("secret"), token = form.get("response");
        const errors = secret === PASSES || secret === FAILS ? (!token ? ["missing-input-response"] : secret === FAILS ? ["invalid-input-response"] : []) : ["invalid-input-secret"];
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: errors.length === 0, "error-codes": errors, challenge_ts: new Date().toISOString(), hostname: "example.com", action: "", cdata: "" }));
      });
    })
    .listen(port, "127.0.0.1");
}

// Started inside run.mjs's process; or on its own: node fake-turnstile.mjs <port> …
if (process.argv[1] === fileURLToPath(import.meta.url)) startFakeTurnstile(Number(process.argv[2]));
