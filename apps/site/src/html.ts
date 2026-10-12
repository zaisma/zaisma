import { describePlayers, type Players } from "@zaisma/core";
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
.tile .name{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;font-weight:600;font-size:15px;text-decoration:none}
.tile .name:hover span{text-decoration:underline}
.tile .name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tile .name small{color:var(--muted);font-size:12px;font-weight:500}
.tile .go{flex:none;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;background:var(--raised)}
.tile .go:hover{background:#35373d}
.tile .go svg{width:12px;height:14px}
.modes{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.modes li{display:flex;align-items:center;gap:10px;font-size:15px;color:var(--text)}
.modes svg{width:20px;height:20px;flex:none}
.modes small{color:var(--muted);font-size:14px}
.modes small::before{content:"· ";}
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
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-bottom:12px}
.shots img{width:100%;aspect-ratio:16/9;object-fit:cover;background:var(--pic);display:block}
.shots p{margin:6px 0}
code.key{display:block;word-break:break-all;user-select:all;color:var(--text);font-size:13px}
.keys{list-style:none;padding:0;margin:0 0 12px}
.keys li{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.hint{font-size:12px;color:var(--muted)}
fieldset{border:0;padding:0;margin:0}
legend{font-size:14px;color:var(--muted);margin-bottom:8px}
.birth label{flex:1;min-width:90px}
details summary{cursor:pointer;color:var(--muted)}
details[open] summary{margin-bottom:10px}
pre{white-space:pre-wrap;word-break:break-word;background:var(--panel);padding:12px;font-size:13px}
dialog{background:var(--panel);color:var(--text);border:0;padding:0}
dialog::backdrop{background:rgba(0,0,0,.6)}
/* Working: a small square turning, only after the player presses something. */
.spin{width:12px;height:12px;flex:none;border:2px solid currentColor;border-right-color:transparent;animation:spin .8s linear infinite}
.metal .spin{display:inline-block;margin-right:10px;vertical-align:-1px}
[aria-busy=true]{cursor:progress}
[aria-busy=true] svg{display:none}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.metal,.tile{transition:none}.spin{animation-duration:2.4s}}
/* ---- Theme: forged steel. Depth, brushed metal and the game's own art, like a console's big-screen mode. ---- */
:root{--bg:#0c0e11;--gun-1:#262a31;--gun-2:#1a1d22;--gun-3:#14161a;--rim:rgba(255,255,255,.08);--rim-dark:rgba(0,0,0,.65)}
html{background:#0c0e11}
body{position:relative;isolation:isolate;background:
  radial-gradient(1100px 520px at 18% -8%,rgba(150,165,190,.10),transparent 70%),
  repeating-linear-gradient(90deg,rgba(255,255,255,.012) 0 1px,transparent 1px 3px),
  linear-gradient(180deg,#101317 0%,#0c0e11 60%);background-attachment:fixed}
/* The featured game's art, blurred behind the top of the page. */
.ambient{position:absolute;inset:0 0 auto 0;height:min(900px,95vh);z-index:-1;pointer-events:none;overflow:hidden;
  -webkit-mask-image:linear-gradient(180deg,#000 0%,rgba(0,0,0,.6) 45%,transparent 100%);mask-image:linear-gradient(180deg,#000 0%,rgba(0,0,0,.6) 45%,transparent 100%)}
.ambient::before{content:"";position:absolute;inset:-80px;background:var(--art) center/cover no-repeat;filter:blur(60px) saturate(1.4) brightness(.8);opacity:1}
header.top{position:sticky;top:0;z-index:20;border-bottom:0;background:linear-gradient(180deg,rgba(38,42,49,.92),rgba(22,24,29,.92)),repeating-linear-gradient(90deg,rgba(255,255,255,.02) 0 1px,transparent 1px 3px);
  -webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 1px 0 #000,0 2px 0 rgba(255,255,255,.04),0 10px 30px rgba(0,0,0,.35)}
header.top nav a{position:relative;padding:8px 2px}
header.top nav a[aria-current]::after{content:"";position:absolute;left:0;right:0;bottom:-13px;height:3px;background:linear-gradient(180deg,#f2f2f2,#8d8f94);box-shadow:0 0 12px rgba(220,225,235,.35)}
h1,h2{text-shadow:0 2px 0 rgba(0,0,0,.55),0 -1px 0 rgba(255,255,255,.06)}
.sec-head h2,section>h2,.more h2{display:flex;align-items:center;gap:16px}
.sec-head h2::after,.more h2::after{content:"";flex:1;min-width:40px;height:2px;background:linear-gradient(90deg,rgba(220,224,230,.35),rgba(220,224,230,0));box-shadow:0 1px 0 rgba(0,0,0,.6)}
.sec-head{flex-wrap:wrap}
.sec-head h2{flex:1 1 auto}
/* Gunmetal: cards, panels and notes have a face, a lit edge and a shadow. */
.card,.note,.way,.dev-card,.track>li,.updates li,.tile,.stage,.drop,.confirm{background:linear-gradient(180deg,var(--gun-1),var(--gun-2));
  box-shadow:inset 1px 1px 0 var(--rim),inset -1px -1px 0 var(--rim-dark),0 12px 28px rgba(0,0,0,.35)}
.tile .body{background:linear-gradient(180deg,#22252b,#17191d);box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.tile .name span{font-family:var(--display);font-weight:600;font-size:16px;letter-spacing:.005em}
/* Big-screen focus: the card under the cursor (or keyboard) lifts into a bright metal frame. */
.hit.block{transition:transform 180ms ease-out}
.hit.block:hover,.hit.block:focus-within{transform:translateY(-4px);z-index:2}
.hit.block:hover .tile,.hit.block:focus-within .tile{box-shadow:0 0 0 2px #d9dce0,0 0 0 3px #000,0 0 28px rgba(205,215,230,.28),0 18px 40px rgba(0,0,0,.5)}
.tile .go{background:linear-gradient(180deg,#3a3e46,#272a30);box-shadow:inset 1px 1px 0 rgba(255,255,255,.12),inset -1px -1px 0 #000}
.tile .go:hover{background:linear-gradient(180deg,#e6e6e6,#9fa1a5);color:#0b0b0c}
/* Buttons are gunmetal plates; fields are cut into the metal. */
.btn:not(.metal):not(.light):not(.danger){background:linear-gradient(180deg,#3a3e46,#262930);box-shadow:inset 1px 1px 0 rgba(255,255,255,.12),inset -1px -1px 0 #000,0 4px 10px rgba(0,0,0,.3)}
.btn:not(.metal):not(.light):not(.danger):hover{background:linear-gradient(180deg,#454a53,#2d3037)}
.btn.ghost{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0))!important;box-shadow:inset 0 0 0 1px #4a4e56,inset 1px 1px 0 1px rgba(255,255,255,.05),0 4px 10px rgba(0,0,0,.25)!important}
.btn.ghost:hover{box-shadow:inset 0 0 0 1px #7a7e86,0 4px 10px rgba(0,0,0,.25)!important}
.metal{box-shadow:inset 2px 2px 0 #fff,inset -2px -2px 0 #000,0 8px 22px rgba(0,0,0,.45),0 0 0 1px #000}
input,textarea,select{background:#0f1114;border-color:#2a2d33;box-shadow:inset 0 2px 6px rgba(0,0,0,.6),0 1px 0 rgba(255,255,255,.05)}
.seg{background:#0f1114;box-shadow:inset 0 2px 6px rgba(0,0,0,.6),0 1px 0 rgba(255,255,255,.05)}
.seg [aria-pressed=true],.seg [aria-current]{background:linear-gradient(180deg,#4a4e57,#30333a);box-shadow:inset 1px 1px 0 rgba(255,255,255,.15),inset -1px -1px 0 #000}
.badge{color:#c8f0b4}
.pill{box-shadow:inset 0 0 0 1px #3d4148;background:rgba(0,0,0,.25)}
footer{border-top:0;background:linear-gradient(180deg,#121418,#0b0c0e);box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 -1px 0 #000}
@media (prefers-reduced-motion:reduce){.hit.block{transition:none}.hit.block:hover,.hit.block:focus-within{transform:none}}

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

// A button that sends a form or opens a page shows it's working and can't be pressed twice.
// Pages that handle a form themselves (preventDefault) are left alone.
const BUSY_SCRIPT = `(()=>{const busy=b=>{if(!b||b.getAttribute("aria-busy")==="true")return;b.setAttribute("aria-busy","true");const s=document.createElement("span");s.className="spin";s.setAttribute("aria-hidden","true");(b.matches(".metal")?b.lastElementChild||b:b).prepend(s);
setTimeout(()=>{if(b.tagName==="BUTTON")b.disabled=true},0)};
addEventListener("submit",e=>{if(!e.defaultPrevented&&e.target.method!=="dialog")busy(e.submitter||e.target.querySelector("button[type=submit],button:not([type])"))});
addEventListener("click",e=>{const a=e.target.closest&&e.target.closest("a.btn,a.metal,a.go");if(!a||e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||a.target==="_blank")return;const u=new URL(a.href,location.href);if(u.origin!==location.origin||(u.pathname===location.pathname&&u.search===location.search))return;busy(a)});
addEventListener("pageshow",e=>{if(e.persisted)document.querySelectorAll("[aria-busy=true]").forEach(b=>{b.removeAttribute("aria-busy");b.disabled=false;b.querySelectorAll(".spin").forEach(s=>s.remove())})})})();`;

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

export function layout(env: Env, opts: { title: string; body: Raw; bare?: boolean; admin?: boolean; private?: boolean; nav?: "dashboard"; art?: string | null }): Response {
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
${ambient(opts.art)}
${opts.bare
    ? opts.body
    : html`${siteHeader(env, opts)}
<main>${opts.body}</main>
${siteFooter()}`}
<script>${raw(METAL_SCRIPT)}${raw(BUSY_SCRIPT)}</script>
</body>
</html>`;
  return new Response(doc.html, { headers: securityHeaders(env, opts.admin || opts.private ? { "Cache-Control": "no-store" } : {}) });
}

/** A game's art, blurred behind the top of the page. Pages change it with --art on .ambient. */
export function ambient(art: string | null | undefined): Raw {
  return html`<div class="ambient" id="ambient" aria-hidden="true"${art ? raw(` style="--art:url('${esc(art)}')"`) : ""}></div>`;
}

/** The site's header, also used on its own by pages that lay themselves out (the game page). */
export function siteHeader(env: Env, opts: { admin?: boolean; nav?: "dashboard" } = {}): Raw {
  return html`<header class="top"><div class="in">
  <a class="logo" href="/" aria-label="Zaisma home"><img src="/zaisma-wordmark-metal.svg" alt="Zaisma"></a>
  <nav>${opts.admin ? html`<a href="/admin">Admin</a><a href="/admin/audit">Audit log</a>` : opts.nav === "dashboard" ? html`<a href="/">Home</a><a href="/dashboard" aria-current="page">Your games</a>` : html`<a href="/">Home</a>`}</nav>
  <div class="end">${env.SUPABASE_URL ? raw(ACCOUNT_LINK) : ""}</div>
</div></header>`;
}

export function siteFooter(): Raw {
  return html`<footer><div class="in"><span>Zaisma™, open source</span><a href="/legal/content-rules">Content rules</a><a href="/legal/privacy">Privacy</a><a href="/legal/dmca">Copyright (DMCA)</a><a href="/dashboard">For game developers</a><a href="https://github.com/zaisma/zaisma">GitHub</a></div></footer>`;
}

export function message(env: Env, title: string, text: string, status = 200): Response {
  const res = layout(env, { title, body: html`<h1>${title}</h1><p class="lead">${text}</p><a class="btn ghost" href="/">Back to games</a>` });
  return new Response(res.body, { status, headers: res.headers });
}

const stroke = (paths: string) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const MODE_ICONS = {
  single: stroke('<circle cx="10" cy="6.5" r="3"/><path d="M4.5 17c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5"/>'),
  local: stroke('<circle cx="6.5" cy="7" r="2.5"/><circle cx="13.5" cy="7" r="2.5"/><path d="M2 16.5c0-2.5 2-4.5 4.5-4.5 1.3 0 2.5.5 3.3 1.4M18 16.5c0-2.5-2-4.5-4.5-4.5-1.3 0-2.5.5-3.3 1.4"/>'),
  online: stroke('<circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c2.3 2.2 2.3 12.8 0 15M10 2.5c-2.3 2.2-2.3 12.8 0 15"/>'),
};

/**
 * How a game is played, as icons with words: "Single-player", "Local co-op · 2–4 players".
 * Games that haven't said but run on our servers show "Online multiplayer".
 */
export function playerModes(players: Players | null, onlineServer: boolean): Raw {
  const modes = players ? describePlayers(players) : onlineServer ? [{ mode: "online" as const, label: "Online multiplayer", count: null }] : [];
  if (!modes.length) return html``;
  return html`<ul class="modes">${modes.map((m) => html`<li>${raw(MODE_ICONS[m.mode])}<span>${m.label}</span>${m.count ? html`<small>${m.count}</small>` : ""}</li>`)}</ul>`;
}

/** The same, as one short line for cards: "Single-player · Online co-op". */
export function playerLine(players: Players | null, onlineServer: boolean): string {
  return players ? describePlayers(players).map((m) => m.label).join(" · ") : onlineServer ? "Online multiplayer" : "";
}
