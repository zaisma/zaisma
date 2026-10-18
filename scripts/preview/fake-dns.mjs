// A stand-in for Cloudflare's DNS over HTTPS with its malware filter (1.1.1.2), for local previews
// only, so registered links' sites are checked with no outside call. Sites under scam-prizes.example
// are "listed for malware or phishing" (answered 0.0.0.0, as Cloudflare does); everything else is clean.
import http from "node:http";

const port = Number(process.argv[2]);
http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const host = url.searchParams.get("name") ?? "";
    if (url.pathname !== "/dns-query" || !host) {
      res.writeHead(400, { "content-type": "application/dns-json" });
      return res.end(JSON.stringify({ Status: 1 }));
    }
    const isListed = host === "scam-prizes.example" || host.endsWith(".scam-prizes.example");
    res.writeHead(200, { "content-type": "application/dns-json" });
    res.end(JSON.stringify({ Status: 0, Answer: [{ name: host, type: 1, TTL: 300, data: isListed ? "0.0.0.0" : "93.184.216.34" }] }));
  })
  .listen(port, "127.0.0.1");
