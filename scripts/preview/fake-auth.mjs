// A stand-in for Supabase Auth, for local previews only: any email, code 123456; passwords as set.
// "Continue with Google/Discord" opens a stand-in page that asks which email to sign in as.
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
  // Passwords too, in plain text: preview accounts only, never real ones.
  const usersFile = keyFile && keyFile.replace(/[^/]+$/, "auth-users.json");
  const saved = usersFile && existsSync(usersFile) ? JSON.parse(readFileSync(usersFile, "utf8")) : {};
  const users = saved.users ?? saved;
  const passwords = saved.passwords ?? {};
  const pendingEmails = {};
  const save = () => usersFile && writeFileSync(usersFile, JSON.stringify({ users, passwords }));
  // The user with this email, or a new one whose ID comes from it.
  const idFor = (email) => {
    const known = Object.keys(users).find((id) => users[id] === email);
    if (known) return known;
    const h = createHash("sha256").update(`preview:${email}`).digest("hex");
    const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
    users[id] = email;
    save();
    return id;
  };
  const subOf = (authorization) => JSON.parse(Buffer.from(String(authorization).replace(/^Bearer /, "").split(".")[1] ?? "", "base64url").toString() || "{}").sub;
  // signedInAt (seconds) is when they last proved who they are, like Supabase's amr claim.
  async function tokens(id, email, signedInAt = Math.floor(Date.now() / 1000), method = "otp") {
    const now = Math.floor(Date.now() / 1000);
    const head = b64(JSON.stringify({ alg: "ES256", kid: "preview", typ: "JWT" }));
    const body = b64(JSON.stringify({ sub: id, email, aud: "authenticated", iss: `${origin}/auth/v1`, exp: now + 3600, iat: now, amr: [{ method, timestamp: signedInAt }] }));
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(`${head}.${body}`));
    // The refresh token carries the user ID and sign-in time, so sessions survive a restart of this stand-in (and an email change).
    return { access_token: `${head}.${body}.${b64(sig)}`, refresh_token: `r-${b64(id)}.${signedInAt}`, user: { id, email } };
  }
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, origin);
    const b = raw && req.headers["content-type"]?.includes("json") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
    const send = (status, obj) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    const path = url.pathname.replace("/auth/v1", "");
    const page = (body) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>Stand-in sign-in</title><body style="font:16px system-ui;max-width:420px;margin:60px auto;padding:0 16px">${body}</body>`);
    };
    const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    if (path === "/settings") return send(200, { external: { email: true, google: true, discord: true } });
    if (path === "/authorize") {
      const q = url.searchParams;
      const name = q.get("provider") === "discord" ? "Discord" : "Google";
      const back = new URL(q.get("redirect_to"));
      back.searchParams.set("error", "access_denied");
      return page(`<h1>${name} (preview stand-in)</h1><p>On the live site this is ${name}'s own page. Pick the email ${name} would give us:</p>
<form method="post" action="/auth/v1/authorize/done"><input type="hidden" name="redirect_to" value="${esc(q.get("redirect_to"))}"><input type="hidden" name="challenge" value="${esc(q.get("code_challenge"))}">
<input name="email" type="email" value="player@gmail.test" required style="font:inherit;padding:8px;width:100%;box-sizing:border-box"><p><button style="font:inherit;padding:8px 16px">Continue</button> <a href="${esc(back)}">Cancel</a></p></form>`);
    }
    if (path === "/authorize/done") {
      const back = new URL(b.redirect_to);
      back.searchParams.set("code", `c-${b64(JSON.stringify({ email: b.email, challenge: b.challenge }))}`);
      res.writeHead(303, { location: back.href });
      return res.end();
    }
    if (path === "/token" && url.searchParams.get("grant_type") === "pkce") {
      try {
        const { email, challenge } = JSON.parse(Buffer.from(String(b.auth_code).replace(/^c-/, ""), "base64url").toString());
        if (createHash("sha256").update(String(b.code_verifier)).digest("base64url") !== challenge) throw new Error();
        return send(200, await tokens(idFor(email), email, undefined, "oauth"));
      } catch {
        return send(400, { code: "flow_state_not_found" });
      }
    }
    if (path === "/.well-known/jwks.json") return send(200, { keys: [{ ...jwk, kid: "preview", alg: "ES256" }] });
    if (path === "/otp") return send(200, {});
    if (path === "/token" && url.searchParams.get("grant_type") === "password") {
      const id = Object.keys(users).find((known) => users[known] === b.email);
      return id && passwords[id] === b.password ? send(200, await tokens(id, b.email, undefined, "password")) : send(400, { code: "invalid_credentials" });
    }
    if (path === "/user" && req.method === "PUT") {
      const id = subOf(req.headers.authorization);
      if (Object.values(users).includes(b.email)) return send(422, { code: "email_exists" });
      pendingEmails[id] = b.email;
      return send(200, { id });
    }
    if (path === "/verify" && b.type === "email_change") {
      const id = Object.keys(pendingEmails).find((known) => pendingEmails[known] === b.email);
      if (!id || b.token !== "123456") return send(403, { code: "otp_expired" });
      delete pendingEmails[id];
      users[id] = b.email;
      save();
      return send(200, await tokens(id, b.email));
    }
    if (path === "/admin/users" && req.method === "POST") {
      if (Object.values(users).includes(b.email)) return send(422, { code: "email_exists" });
      const id = idFor(b.email);
      passwords[id] = b.password;
      save();
      return send(200, { id, email: b.email });
    }
    if (req.method === "PUT" && path.startsWith("/admin/users/")) {
      const id = decodeURIComponent(path.slice("/admin/users/".length));
      if (b.password) passwords[id] = b.password;
      if (b.email) users[id] = b.email;
      save();
      return send(200, { id });
    }
    if (path === "/verify" && b.token_hash) {
      const email = Buffer.from(String(b.token_hash).replace(/^h-/, ""), "base64url").toString();
      return email.includes("@") ? send(200, await tokens(idFor(email), email)) : send(403, { code: "otp_expired" });
    }
    if (path === "/verify") return b.token === "123456" ? send(200, await tokens(idFor(b.email), b.email)) : send(403, { code: "otp_expired" });
    if (path === "/token") {
      const [who, at] = String(b.refresh_token).replace(/^r-/, "").split(".");
      const decoded = Buffer.from(who, "base64url").toString();
      // Older preview sessions carried the email instead.
      const id = decoded.includes("@") ? idFor(decoded) : decoded;
      return users[id] ? send(200, await tokens(id, users[id], Number(at) || 0)) : send(400, { code: "refresh_token_not_found" });
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
