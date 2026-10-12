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

// Steel: the design system. Rules and reasons in docs/DESIGN.md.
const STYLES = `
@font-face{font-family:Jost;src:url(/fonts/jost.woff2) format("woff2");font-weight:100 900;font-display:swap}
:root{color-scheme:dark;--bg:#111214;--panel:#1b1c1f;--panel-2:#16171a;--raised:#2c2e33;--pic:#2a2b30;--line:#2c2e33;--line-2:#3a3c42;--text:#ececec;--text-2:#c9cace;--muted:#9b9da3;--accent:#ececec;--danger:#ff6b6b;--ok:#5fd38d;--ok-text:#b9e7a6;--ok-bg:#24301f;--warn:#f2c14e;--display:Jost,system-ui,sans-serif}
*{box-sizing:border-box}
*{scrollbar-width:thin;scrollbar-color:#3a3c42 transparent}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}
::-webkit-scrollbar-thumb{background:#2c2e33;border:3px solid transparent;background-clip:padding-box}
::-webkit-scrollbar-thumb:hover{background-color:#4a4c53}
html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
h1,h2,h3{font-family:var(--display);font-weight:600;letter-spacing:-.005em}
h1{font-size:clamp(30px,5vw,44px);line-height:1.05;margin:0 0 10px}
h2{font-size:26px;line-height:1.15;margin:40px 0 16px}
h3{font-size:19px;margin:0 0 6px}
p.lead{color:var(--muted);margin:0 0 28px;font-size:18px}
header.top{border-bottom:1px solid var(--line)}
header.top .in{max-width:1240px;margin:0 auto;padding:12px 24px;display:flex;flex-wrap:wrap;align-items:center;gap:12px 24px}
header.top .logo{display:flex;padding:6px 0}
header.top .logo img{height:28px;display:block}
header.top nav{display:flex;gap:20px;font-size:15px;font-weight:600}
header.top nav a{text-decoration:none;color:var(--muted)}
header.top nav a:hover,header.top nav a[aria-current]{color:var(--text)}
header.top .end{margin-left:auto;display:flex;gap:12px;align-items:center}
main{max-width:1240px;margin:0 auto;padding:32px 24px 64px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px}
.card{display:block;background:var(--panel);padding:18px;text-decoration:none}
.card:hover{background:#202125}
.card h3{margin:0 0 6px;font-size:18px}
.card p{margin:0;color:var(--muted);font-size:14px}
.empty{color:var(--muted);padding:40px 0}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 18px;background:var(--raised);color:var(--text);border:0;font:inherit;font-size:15px;font-weight:700;cursor:pointer;text-decoration:none}
.btn:hover{background:#35373d}
.btn.light{background:var(--accent);color:#111214}
.btn.ghost{background:transparent;color:var(--text);box-shadow:inset 0 0 0 1px var(--line-2)}
.btn.ghost:hover{box-shadow:inset 0 0 0 1px #55585f}
.btn.danger{background:var(--danger);color:#111}
.btn.big{min-height:56px;padding:0 32px;font-size:18px;font-weight:800}
.btn svg{width:16px;height:16px;flex:none}
.bevel-s{clip-path:polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,0 100%)}
.bevel{clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%)}
.bevel-l{clip-path:polygon(0 0,calc(100% - 36px) 0,100% 36px,100% 100%,0 100%)}
.edge{box-shadow:0 0 0 2px #000,-2px -2px 0 2px #fff}
/* Metal: the Z's plate. It tilts toward the cursor (less the bigger it is) and a fixed light's
   reflection slides across it. The hover area (.hit) never tilts, so edges can't flicker. */
.hit{display:inline-flex}
.hit.block{display:flex;flex-direction:column}
.metal{position:relative;overflow:hidden;background:linear-gradient(180deg,#e2e2e2 0%,#a9aaad 55%,#6d6e72 100%);color:#0b0b0c;box-shadow:inset 2px 2px 0 #fff,inset -2px -2px 0 #000;transform:perspective(800px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));transition:transform 160ms ease-out}
.metal:hover{background:linear-gradient(180deg,#e2e2e2 0%,#a9aaad 55%,#6d6e72 100%)}
.metal::before{content:"";position:absolute;top:-60%;left:0;width:72px;height:220%;pointer-events:none;background:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,.12) 22%,rgba(255,255,255,.55) 42%,rgba(255,255,255,.85) 50%,rgba(255,255,255,.55) 58%,rgba(255,255,255,.12) 78%,rgba(255,255,255,0) 100%);transform:translateX(calc(var(--gx,0px) - 36px)) rotate(15deg);opacity:0;transition:transform 160ms ease-out,opacity 220ms}
.metal>*{position:relative;z-index:1}
.metal.lit::before{opacity:calc(.9 * var(--gf,1))}
.metal.lit{text-shadow:0 1px 0 rgba(255,255,255,.8)}
.metal.lit svg{filter:drop-shadow(0 1px 0 rgba(255,255,255,.8))}
.tile{position:relative;overflow:hidden;display:flex;flex-direction:column;background:var(--panel);transform:perspective(800px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));transition:transform 160ms ease-out}
.tile::before,.tile .pic::before,.tile .pic::after{content:"";position:absolute;top:-60%;left:0;height:220%;pointer-events:none;opacity:0;transition:transform 160ms ease-out,opacity 220ms}
.tile::before{width:200px;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.04) 35%,rgba(255,255,255,.07) 50%,rgba(255,255,255,.04) 65%,rgba(255,255,255,0));transform:translateX(calc(var(--gx,0px) - 100px)) rotate(15deg)}
.tile .pic{position:relative;overflow:hidden;display:block;aspect-ratio:16/9;background:var(--pic)}
.tile .pic img{width:100%;height:100%;object-fit:cover;display:block}
.tile .pic::after{width:160px;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.08) 35%,rgba(255,255,255,.12) 50%,rgba(255,255,255,.08) 65%,rgba(255,255,255,0));transform:translateX(calc(var(--gx,0px) - 80px)) rotate(15deg)}
.tile .pic::before{width:18px;z-index:1;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.35) 30%,rgba(255,255,255,.55) 50%,rgba(255,255,255,.35) 70%,rgba(255,255,255,0));transform:translateX(calc(var(--gx,0px) - 9px)) rotate(15deg)}
.tile.lit::before,.tile.lit .pic::after{opacity:calc(.5 * var(--gf,1))}
.tile.lit .pic::before{opacity:calc(.8 * var(--gf,1))}
.tile .body{padding:12px;display:flex;align-items:center;gap:10px}
.tile .name{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;font-weight:600;font-size:15px}
.tile .name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tile .name small{color:var(--muted);font-size:12px;font-weight:500}
.tile .go{flex:none;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;background:var(--raised)}
.tile .go:hover{background:#35373d}
.tile .go svg{width:12px;height:14px}
.badge{display:inline-flex;align-items:center;gap:6px;color:var(--ok-text);font-size:12px;font-weight:600}
.badge::before{content:"";width:6px;height:6px;background:var(--ok)}
.pill{display:inline-block;padding:1px 9px;font-size:12px;box-shadow:inset 0 0 0 1px var(--line-2)}
.pill.live,.pill.approved,.pill.info{color:var(--ok)}
.pill.held,.pill.scanning,.pill.pending,.pill.hold{color:var(--warn)}
.pill.removed,.pill.rejected,.pill.reject{color:var(--danger)}
.note{background:var(--panel-2);padding:14px 16px;color:var(--muted)}
.note strong{color:var(--text)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.seg{display:inline-flex;background:var(--panel);padding:3px}
.seg button,.seg a{min-height:40px;padding:0 16px;border:0;background:transparent;color:var(--muted);font:inherit;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
.seg [aria-pressed=true],.seg [aria-current]{background:var(--line-2);color:#fff}
form.stack{display:grid;gap:14px;max-width:560px}
form.stack>.btn,form.stack>.hit{justify-self:start}
label{display:grid;gap:6px;font-size:14px;color:var(--muted)}
input,textarea,select{background:var(--panel);color:var(--text);border:1px solid var(--line);padding:0 12px;min-height:44px;font:inherit}
textarea{min-height:100px;padding:10px 12px}
input:focus,textarea:focus,select:focus{border-color:#55585f;outline:none}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500}
footer{border-top:1px solid var(--line)}
footer .in{max-width:1240px;margin:0 auto;padding:22px 24px;color:var(--muted);font-size:14px;display:flex;gap:20px;flex-wrap:wrap}
.narrow{max-width:520px}
.error{color:var(--danger);margin:0 0 14px}
.muted{color:var(--muted);font-size:14px}
.small{font-size:12px}
.hint{font-size:12px;color:var(--muted)}
fieldset{border:0;padding:0;margin:0}
legend{font-size:14px;color:var(--muted);margin-bottom:8px}
.birth label{flex:1;min-width:90px}
details summary{cursor:pointer;color:var(--muted)}
details[open] summary{margin-bottom:10px}
pre{white-space:pre-wrap;word-break:break-word;background:var(--panel);padding:12px;font-size:13px}
dialog{background:var(--panel);color:var(--text);border:0;padding:0}
dialog::backdrop{background:rgba(0,0,0,.6)}
@media (prefers-reduced-motion:reduce){.metal,.tile{transition:none}}
`;

// Runs the metal hover on every page: one listener for all .hit areas, at most one update per frame.
const METAL_SCRIPT = `(()=>{if(!matchMedia("(hover:hover)").matches)return;const still=matchMedia("(prefers-reduced-motion:reduce)").matches;let cur=null,x=0,y=0,raf=0;
const off=h=>{const el=h.firstElementChild;if(!el)return;el.classList.remove("lit");["--rx","--ry","--gx","--gf"].forEach(p=>el.style.removeProperty(p))};
const paint=()=>{raf=0;if(!cur)return;const el=cur.firstElementChild;if(!el)return;const r=cur.getBoundingClientRect();
const nx=Math.min(1,Math.max(0,(x-r.left)/r.width))-.5,ny=Math.min(1,Math.max(0,(y-r.top)/r.height))-.5;
const max=Math.max(3,Math.min(13,2400/Math.hypot(r.width,r.height))),sweep=-nx*1.5+ny*.4;
el.style.setProperty("--ry",(still?0:nx*2*max).toFixed(2)+"deg");el.style.setProperty("--rx",(still?0:-ny*1.2*max).toFixed(2)+"deg");
el.style.setProperty("--gx",(r.width/2+sweep*r.width*.75).toFixed(1)+"px");el.style.setProperty("--gf",Math.max(.25,1-Math.abs(sweep)*.55).toFixed(2));el.classList.add("lit")};
addEventListener("pointermove",e=>{const h=e.target.closest?e.target.closest(".hit"):null;if(h!==cur){if(cur)off(cur);cur=h}if(!cur)return;x=e.clientX;y=e.clientY;if(!raf)raf=requestAnimationFrame(paint)},{passive:true});
document.documentElement.addEventListener("pointerleave",()=>{if(cur)off(cur);cur=null})})();`;

const PLAY_ICON = '<svg viewBox="0 0 14 16" aria-hidden="true"><path d="M1 1v14l12-7z" fill="currentColor"/></svg>';

/** The metal primary button. `href` makes a link, otherwise a button with the given id. */
export function metalButton(label: string, opts: { href?: string; id?: string; big?: boolean; block?: boolean; play?: boolean; type?: string }): Raw {
  const cls = `btn metal bevel${opts.big ? " big" : ""}`;
  const inner = html`${opts.play ? raw(PLAY_ICON) : ""}<span>${label}</span>`;
  const el = opts.href
    ? html`<a class="${cls}" href="${opts.href}">${inner}</a>`
    : html`<button class="${cls}" type="${opts.type ?? "button"}"${opts.id ? raw(` id="${opts.id}"`) : ""}>${inner}</button>`;
  return html`<span class="hit${opts.block ? " block" : ""}">${el}</span>`;
}

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

// Pages stay cacheable for everyone, so the header learns about sign-in from a readable hint cookie.
const ACCOUNT_LINK = `<a id="account-link" class="btn ghost" href="/signin">Sign in</a><script>if(/(^|; )(__Host-)?zaisma_in=1/.test(document.cookie)){var a=document.getElementById("account-link");a.href="/account";a.textContent="Account"}</script>`;

export function layout(env: Env, opts: { title: string; body: Raw; bare?: boolean; admin?: boolean; private?: boolean }): Response {
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
    : html`<header class="top"><div class="in">
  <a class="logo" href="/" aria-label="Zaisma home"><img src="/zaisma-wordmark-metal.svg" alt="Zaisma"></a>
  <nav>${opts.admin ? html`<a href="/admin">Admin</a><a href="/admin/audit">Audit log</a>` : html`<a href="/">Home</a>`}</nav>
  <div class="end">${env.SUPABASE_URL ? raw(ACCOUNT_LINK) : ""}</div>
</div></header>
<main>${opts.body}</main>
<footer><div class="in"><span>Zaisma™, open source</span><a href="/legal/content-rules">Content rules</a><a href="/legal/privacy">Privacy</a><a href="/legal/dmca">Copyright (DMCA)</a><a href="https://github.com/zaisma/zaisma">GitHub</a></div></footer>`}
<script>${raw(METAL_SCRIPT)}</script>
</body>
</html>`;
  return new Response(doc.html, { headers: securityHeaders(env, opts.admin || opts.private ? { "Cache-Control": "no-store" } : {}) });
}

export function message(env: Env, title: string, text: string, status = 200): Response {
  const res = layout(env, { title, body: html`<h1>${title}</h1><p class="lead">${text}</p><a class="btn ghost" href="/">Back to games</a>` });
  return new Response(res.body, { status, headers: res.headers });
}
