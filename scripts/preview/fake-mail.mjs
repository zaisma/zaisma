// A stand-in mailbox, for local previews only: the site sends its email codes here (EMAIL_OUTBOX_URL)
// instead of real email. Open it to read each email as a player would get it, newest first.
//   POST /                 an email from the site: { from, to, subject, text, html }
//   GET  /                 the mailbox
//   GET  /latest?to=…      the newest email to an address, as JSON (the preview's seed reads codes here)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export function startFakeMail(port, stateFolder) {
  const mailFile = join(stateFolder, "mail.json");
  const emails = existsSync(mailFile) ? JSON.parse(readFileSync(mailFile, "utf8")) : [];
  const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);

  http
    .createServer(async (request, response) => {
      const url = new URL(request.url, `http://localhost:${port}`);
      if (request.method === "POST") {
        let body = "";
        for await (const chunk of request) body += chunk;
        emails.unshift({ ...JSON.parse(body), sent_at: new Date().toISOString() });
        emails.length = Math.min(emails.length, 200);
        writeFileSync(mailFile, JSON.stringify(emails));
        response.writeHead(200, { "content-type": "application/json" });
        return response.end("{}");
      }
      if (url.pathname === "/latest") {
        const email = emails.find((sent) => sent.to === url.searchParams.get("to"));
        response.writeHead(email ? 200 : 404, { "content-type": "application/json" });
        return response.end(JSON.stringify(email ?? { error: "No email to that address yet." }));
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Preview mailbox</title>
<meta http-equiv="refresh" content="10">
<body style="margin:0;padding:24px 16px;background:#16191d;color:#eceef0;font:15px/1.5 system-ui,sans-serif">
<div style="max-width:640px;margin:0 auto">
<h1 style="font-size:22px;margin:0 0 4px">Preview mailbox</h1>
<p style="color:#969ba4;margin:0 0 24px">Email the preview sent, newest first, as players would get it. Nothing here goes to a real address. It refreshes itself.</p>
${
  emails.length
    ? emails
        .map(
          (email) => `<section style="margin:0 0 28px">
  <p style="margin:0 0 8px;color:#c6c9ce"><strong style="color:#eceef0">${esc(email.subject)}</strong><br>To ${esc(email.to)}, from ${esc(email.from)}, ${esc(new Date(email.sent_at).toLocaleString())}</p>
  <iframe sandbox="allow-same-origin" title="${esc(email.subject)}" srcdoc="${esc(email.html)}" style="width:100%;height:340px;border:1px solid #2a2f36;border-radius:10px;background:#0b0d10"></iframe>
  <details style="margin-top:6px"><summary style="color:#969ba4;cursor:pointer">Plain text</summary><pre style="white-space:pre-wrap;color:#c6c9ce">${esc(email.text)}</pre></details>
  </section>`,
        )
        .join("")
    : `<p>No email yet. Try Forgot your password, or add an email on the account page.</p>`
}
</div></body>`);
    })
    .listen(Number(port), "127.0.0.1");
}

// Started inside run.mjs's process; or on its own: node fake-mail.mjs <port> …
if (process.argv[1] === fileURLToPath(import.meta.url)) startFakeMail(...process.argv.slice(2));
