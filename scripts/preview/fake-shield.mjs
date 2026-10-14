// A stand-in for Arachnid Shield's image matching, for local previews only, so scans run with image
// matching connected and no real key. A file "matches known abuse material" only when its bytes contain
// the marker below (harmless test pictures made by run.mjs); everything else is clean. The second
// marker only matches once a "shield-knows-later" file is in the preview folder: a picture Shield
// learns about after the game passed.
import http from "node:http";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const MATCH_MARKER = "zaisma-preview-known-image";
export const LATER_MARKER = "zaisma-preview-known-later";

export function startFakeShield(port, state) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        if (req.method !== "POST" || req.url !== "/v1/media/") {
          res.writeHead(404, { "content-type": "application/json" });
          return res.end(JSON.stringify({ detail: "Not found." }));
        }
        if (!req.headers.authorization?.startsWith("Basic ")) {
          res.writeHead(401, { "content-type": "application/json" });
          return res.end(JSON.stringify({ detail: "Authentication credentials were not provided." }));
        }
        const match = body.includes(MATCH_MARKER) || (body.includes(LATER_MARKER) && existsSync(join(state, "shield-knows-later")));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            sha1_base32: "",
            sha256_hex: createHash("sha256").update(body).digest("hex"),
            size_bytes: body.length,
            classification: match ? "csam" : "no-known-match",
            match_type: match ? "exact" : null,
            near_match_details: [],
          }),
        );
      });
    });
    server.on("error", reject);
    server.listen(port, () => resolve(server));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await startFakeShield(Number(process.argv[2]), process.argv[3]);
