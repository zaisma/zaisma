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
  // Who each user ID is, for the admin calls (kept next to the key, so it survives restarts).
  const usersFile = keyFile && keyFile.replace(/[^/]+$/, "auth-users.json");
  const users = usersFile && existsSync(usersFile) ? JSON.parse(readFileSync(usersFile, "utf8")) : {};
  const idFor = (email) => {
    const h = createHash("sha256").update(`preview:${email}`).digest("hex");
    const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
    if (users[id] !== email) {
      users[id] = email;
      if (usersFile) writeFileSync(usersFile, JSON.stringify(users));
    }
    return id;
  };
  // signedInAt (seconds) is when they last proved who they are, like Supabase's amr claim.
  async function tokens(id, email, signedInAt = Math.floor(Date.now() / 1000)) {
    const now = Math.floor(Date.now() / 1000);
    const head = b64(JSON.stringify({ alg: "ES256", kid: "preview", typ: "JWT" }));
    const body = b64(JSON.stringify({ sub: id, email, aud: "authenticated", iss: `${origin}/auth/v1`, exp: now + 3600, iat: now, amr: [{ method: "otp", timestamp: signedInAt }] }));
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(`${head}.${body}`));
    // The refresh token carries the email and sign-in time, so sessions survive a restart of this stand-in.
    return { access_token: `${head}.${body}.${b64(sig)}`, refresh_token: `r-${b64(email)}.${signedInAt}`, user: { id, email } };
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
    if (path === "/verify" && b.token_hash) {
      const email = Buffer.from(String(b.token_hash).replace(/^h-/, ""), "base64url").toString();
      return email.includes("@") ? send(200, await tokens(idFor(email), email)) : send(403, { code: "otp_expired" });
    }
    if (path === "/verify") return b.token === "123456" ? send(200, await tokens(idFor(b.email), b.email)) : send(403, { code: "otp_expired" });
    if (path === "/token") {
      const [who, at] = String(b.refresh_token).replace(/^r-/, "").split(".");
      const email = Buffer.from(who, "base64url").toString();
      return email.includes("@") ? send(200, await tokens(idFor(email), email, Number(at) || 0)) : send(400, { code: "refresh_token_not_found" });
    }
    if (path === "/admin/generate_link") return send(200, { hashed_token: `h-${b64(b.email)}`, email: b.email });
    if (req.method === "GET" && path.startsWith("/admin/users/")) {
      const email = users[decodeURIComponent(path.slice("/admin/users/".length))];
      return email ? send(200, { id: path.slice("/admin/users/".length), email }) : send(404, {});
    }
    if (path === "/logout") return send(204, {});
    if (path.startsWith("/admin/users/")) return send(200, {});
    send(404, {});
  });
  await new Promise((ok, fail) => server.once("error", fail).listen(port, "127.0.0.1", ok));
  return server;
}
