import { gameFrameSource, type Env } from "./env.ts";

/** Escape text for HTML. Every value from a user or a game goes through this. */
export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Tagged template: interpolations are escaped unless wrapped in raw(). */
export class Raw {
  constructor(readonly html: string) {}
  toString() {
    return this.html;
  }
}
export const raw = (html: string) => new Raw(html);

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0]!;
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1]!;
  });
  return new Raw(out);
}

function render(v: unknown): string {
  if (v instanceof Raw) return v.html;
  if (Array.isArray(v)) return v.map(render).join("");
  if (v === null || v === undefined || v === false) return "";
  return esc(v);
}

const STYLES = `
:root{color-scheme:dark;--bg:#111214;--panel:#1b1c1f;--line:#2c2e33;--text:#ececec;--muted:#9b9da3;--accent:#e9e9e9;--danger:#ff6b6b;--ok:#5fd38d;--warn:#f2c14e}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:inherit}
header.top{display:flex;align-items:center;gap:16px;padding:14px 20px;border-bottom:1px solid var(--line)}
header.top .logo img{height:26px;display:block}
header.top nav{margin-left:auto;display:flex;gap:16px;font-size:14px;color:var(--muted)}
header.top nav a{text-decoration:none}
main{max-width:1100px;margin:0 auto;padding:28px 16px 64px}
h1{font-size:28px;line-height:1.2;margin:0 0 8px}
h2{font-size:20px;margin:32px 0 12px}
p.lead{color:var(--muted);margin:0 0 28px;font-size:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
.card{display:block;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;text-decoration:none;min-height:130px}
.card:hover{border-color:#55585f}
.card h3{margin:0 0 6px;font-size:18px}
.card p{margin:0;color:var(--muted);font-size:14px}
.empty{color:var(--muted);padding:40px 0}
.btn{display:inline-flex;align-items:center;gap:6px;background:var(--accent);color:#111;border:0;border-radius:8px;padding:8px 14px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none}
.btn.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}
.btn.danger{background:var(--danger);color:#111}
form.stack{display:grid;gap:14px;max-width:560px}
label{display:grid;gap:6px;font-size:14px;color:var(--muted)}
input,textarea,select{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:10px;font:inherit}
textarea{min-height:100px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500}
.pill{display:inline-block;border-radius:999px;padding:1px 9px;font-size:12px;border:1px solid var(--line)}
.pill.live,.pill.approved,.pill.info{color:var(--ok)}
.pill.held,.pill.scanning,.pill.pending,.pill.hold{color:var(--warn)}
.pill.removed,.pill.rejected,.pill.reject{color:var(--danger)}
.note{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px;color:var(--muted)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
footer{border-top:1px solid var(--line);padding:20px;color:var(--muted);font-size:13px;display:flex;gap:16px;flex-wrap:wrap;justify-content:center}
pre{white-space:pre-wrap;word-break:break-word;background:var(--panel);padding:12px;border-radius:8px;font-size:13px}
`;

export function securityHeaders(env: Env, extra: Record<string, string> = {}): Headers {
  const h = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      `frame-src ${gameFrameSource(env)}`,
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    ...extra,
  });
  return h;
}

export function layout(env: Env, opts: { title: string; body: Raw; bare?: boolean; admin?: boolean }): Response {
  const doc = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#111214">
<style>${raw(STYLES)}</style>
</head>
<body>
${opts.bare
    ? opts.body
    : html`<header class="top">
  <a class="logo" href="/"><img src="/zaisma-wordmark-metal.svg" alt="Zaisma"></a>
  <nav>${opts.admin ? html`<a href="/admin">Admin</a><a href="/admin/audit">Audit log</a>` : ""}<a href="/">Games</a></nav>
</header>
<main>${opts.body}</main>
<footer><span>Zaisma™ · open source, MIT</span><a href="/legal/content-rules">Content rules</a><a href="/legal/dmca">Copyright (DMCA)</a><a href="https://github.com/zaisma/zaisma">GitHub</a></footer>`}
</body>
</html>`;
  return new Response(doc.html, { headers: securityHeaders(env, opts.admin ? { "Cache-Control": "no-store" } : {}) });
}

export function message(env: Env, title: string, text: string, status = 200): Response {
  const res = layout(env, { title, body: html`<h1>${title}</h1><p class="lead">${text}</p><a class="btn ghost" href="/">Back to games</a>` });
  return new Response(res.body, { status, headers: res.headers });
}
