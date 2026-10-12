// A stand-in for Supabase Auth, for local previews only: any email, code 123456.
// Each email always gets the same user ID, so a preview account survives restarts.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";

/** keyFile keeps the signing key between runs, so sign-ins survive a restart. */
export async function startFakeAuth(port, keyFile) {
  const origin = `http://localhost:${port}`;
  const ec = { name: "ECDSA", namedCurve: "P-256" };
  let privateJwk = keyFile && existsSync(keyFile) ? JSON.parse(readFileSync(keyFile, "utf8")) : null;
  if (!privateJwk) {
    privateJwk = await crypto.subtle.exportKey("jwk", (await crypto.subtle.generateKey(ec, true, ["sign", "verify"])).privateKey);
    if (keyFile) writeFileSync(keyFile, JSON.stringify(privateJwk));
  }
  const keys = { privateKey: await crypto.subtle.importKey("jwk", privateJwk, ec, false, ["sign"]) };
  const { d: _, key_ops: __, ...jwk } = privateJwk;
  const b64 = (b) => Buffer.from(b).toString("base64url");
  const idFor = (email) => {
    const h = createHash("sha256").update(`preview:${email}`).digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };
  async function tokens(id, email) {
    const now = Math.floor(Date.now() / 1000);
    const head = b64(JSON.stringify({ alg: "ES256", kid: "preview", typ: "JWT" }));
    const body = b64(JSON.stringify({ sub: id, email, aud: "authenticated", iss: `${origin}/auth/v1`, exp: now + 3600, iat: now }));
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(`${head}.${body}`));
    // The refresh token carries the email, so sessions survive a restart of this stand-in.
    return { access_token: `${head}.${body}.${b64(sig)}`, refresh_token: `r-${b64(email)}`, user: { id, email } };
  }
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const b = raw ? JSON.parse(raw) : {};
    const send = (status, obj) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    const path = new URL(req.url, origin).pathname.replace("/auth/v1", "");
    if (path === "/.well-known/jwks.json") return send(200, { keys: [{ ...jwk, kid: "preview", alg: "ES256" }] });
    if (path === "/otp") return send(200, {});
    if (path === "/verify") return b.token === "123456" ? send(200, await tokens(idFor(b.email), b.email)) : send(403, { code: "otp_expired" });
    if (path === "/token") {
      const email = Buffer.from(String(b.refresh_token).replace(/^r-/, ""), "base64url").toString();
      return email.includes("@") ? send(200, await tokens(idFor(email), email)) : send(400, { code: "refresh_token_not_found" });
    }
    if (path === "/logout") return send(204, {});
    if (path.startsWith("/admin/users/")) return send(200, {});
    send(404, {});
  });
  await new Promise((ok, fail) => server.once("error", fail).listen(port, "127.0.0.1", ok));
  return server;
}
