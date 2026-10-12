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
/* Steel, forged. Three materials: the ground (deep brushed steel, lit from the top left, with the
   game's own art bleeding in from above), gunmetal plates (every surface: brushed face, lit rim,
   the Z's chamfered corner) and chrome (only the main action, focus and selection). */
:root{color-scheme:dark;
  --bg:#0b0d10;--panel:#1d2026;--panel-2:#16181c;--raised:#2a2e35;--pic:#1c1f25;--line:#23262c;--line-2:#363a42;
  --text:#eceef0;--text-2:#c6c9ce;--muted:#969ba4;--accent:#eceef0;
  --danger:#ff6b6b;--ok:#5fd38d;--ok-text:#b9e7a6;--ok-bg:#1f2b1c;--warn:#f2c14e;
  --display:Jost,system-ui,sans-serif;
  --face:linear-gradient(180deg,#262a31,#1b1e23);
  --face-hi:linear-gradient(180deg,#30353d,#22262c);
  --chrome:linear-gradient(180deg,#eef0f2 0%,#b9bcc1 46%,#7d8086 100%);
  --rim:inset 1px 1px 0 rgba(255,255,255,.09),inset -1px -1px 0 rgba(0,0,0,.7);
  --drop:0 14px 32px rgba(0,0,0,.42);
  --brush:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='320'%3E%3Cfilter id='b'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.0035 0.9' numOctaves='3' seed='7' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0.16 0 0 0 -0.045'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23b)'/%3E%3C/svg%3E");
  --grain:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0.09 0 0 0 -0.025'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E")}
*{box-sizing:border-box}
*{scrollbar-width:thin;scrollbar-color:#3a3e46 transparent}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}
::-webkit-scrollbar-thumb{background:#30343b;border:3px solid transparent;background-clip:padding-box}
::-webkit-scrollbar-thumb:hover{background-color:#4a4f58}
html{background:var(--bg)}
html,body{margin:0;color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
body{position:relative;isolation:isolate;min-height:100vh;display:flex;flex-direction:column;background:
  radial-gradient(1200px 560px at 14% -6%,rgba(160,175,200,.09),transparent 70%),
  var(--grain) 0 0/200px 200px,
  linear-gradient(180deg,#12151a 0%,#0b0d10 52%)}
a{color:inherit}
:focus-visible{outline:2px solid #e6e8eb;outline-offset:3px}
h1,h2,h3{font-family:var(--display);font-weight:600;letter-spacing:-.005em;text-shadow:0 2px 0 rgba(0,0,0,.6),0 -1px 0 rgba(255,255,255,.05)}
h1{font-size:clamp(32px,5vw,48px);line-height:1.04;margin:0 0 10px}
h2{font-size:26px;line-height:1.15;margin:44px 0 18px}
h3{font-size:19px;margin:0 0 6px}
p.lead{color:var(--muted);margin:0 0 28px;font-size:18px}

/* The game's art, blurred behind the whole screen, like a console's big-screen mode. Two layers so a
   new game fades in over the last. */
.ambient{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;
  -webkit-mask-image:linear-gradient(180deg,#000 0%,rgba(0,0,0,.62) 55%,rgba(0,0,0,.3) 100%);mask-image:linear-gradient(180deg,#000 0%,rgba(0,0,0,.62) 55%,rgba(0,0,0,.3) 100%)}
.ambient i{position:absolute;inset:-90px;background:var(--art,none) center/cover no-repeat;filter:blur(72px) saturate(1.15) brightness(.5);opacity:0;transition:opacity 650ms ease}
.ambient i.on{opacity:1}
.ambient::after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse 120% 90% at 50% 30%,transparent 35%,rgba(5,6,8,.6) 100%)}

/* The chamfer: the Z's cut corner on a plate, with its edge catching the light. Plates set --cut. */
.bevel-s{--cut:8px;clip-path:polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,0 100%)}
.bevel{--cut:14px;clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%)}
.bevel-l{--cut:36px;clip-path:polygon(0 0,calc(100% - 36px) 0,100% 36px,100% 100%,0 100%)}
.edge{box-shadow:0 0 0 2px #000,-2px -2px 0 2px #fff}

/* Gunmetal: every surface is a plate. */
.card,.note,.way,.dev-card,.track>li,.updates li,.drop,.plate,dialog,.tile .body{
  background:linear-gradient(to top right,transparent calc(50% - 1.5px),rgba(255,255,255,.3) calc(50% - 1.5px),rgba(255,255,255,.3) 50%,transparent 50%) top right/var(--cut,0px) var(--cut,0px) no-repeat,
    var(--brush) 0 0/320px 320px,var(--face);
  box-shadow:var(--rim),var(--drop)}

/* Header: a brushed bar across the top, the current page marked by a chrome rail. */
header.top{position:sticky;top:0;z-index:30;
  background:var(--brush) 0 0/320px 320px,linear-gradient(180deg,rgba(40,44,51,.94),rgba(24,26,31,.94));
  -webkit-backdrop-filter:blur(14px) saturate(1.2);backdrop-filter:blur(14px) saturate(1.2);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 1px 0 #000,0 2px 0 rgba(255,255,255,.035),0 12px 30px rgba(0,0,0,.38)}
header.top .in{max-width:1240px;min-height:64px;margin:0 auto;padding:0 24px;display:flex;flex-wrap:wrap;align-items:center;gap:0 28px}
header.top .logo{display:flex;padding:8px 0}
header.top .logo img{height:28px;display:block;filter:drop-shadow(0 2px 0 rgba(0,0,0,.6))}
header.top nav{display:flex;gap:26px;align-self:stretch;font-family:var(--display);font-size:16px;font-weight:500}
header.top nav a{position:relative;display:flex;align-items:center;text-decoration:none;color:var(--muted)}
header.top nav a:hover{color:var(--text)}
header.top nav a[aria-current]{color:var(--text)}
header.top nav a[aria-current]::after{content:"";position:absolute;left:-4px;right:-4px;bottom:0;height:3px;background:var(--chrome);box-shadow:0 0 14px rgba(225,230,240,.35)}
header.top .end{margin-left:auto;display:flex;gap:12px;align-items:center;padding:10px 0}
main{flex:1 0 auto;width:100%;max-width:1240px;margin:0 auto;padding:32px 24px 72px}
body>main.gp{flex:1 0 auto;width:100%}

/* A section heading is engraved, with a machined rule running out to the edge. */
.sec-head{display:flex;flex-wrap:wrap;align-items:center;gap:12px 18px;margin:48px 0 18px}
.sec-head h2,.rule-h{display:flex;align-items:center;gap:18px;flex:1 1 auto;margin:0}
.rule-h{margin:48px 0 18px}
.sec-head h2::after,.rule-h::after{content:"";flex:1;min-width:40px;height:1px;background:linear-gradient(90deg,rgba(230,233,238,.32),rgba(230,233,238,0));box-shadow:0 1px 0 rgba(0,0,0,.7)}
.engraved{height:2px;border:0;margin:0;background:linear-gradient(#000,#000) top/100% 1px no-repeat,linear-gradient(rgba(255,255,255,.06),rgba(255,255,255,.06)) bottom/100% 1px no-repeat}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:22px}
.card{display:block;padding:18px;text-decoration:none}
.card h3{margin:0 0 6px;font-size:18px}
.card p{margin:0;color:var(--muted);font-size:14px}
.empty{color:var(--muted);padding:40px 0}

/* Buttons: gunmetal plates with the cut corner; chrome for the one main action. */
.btn{--cut:10px;position:relative;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 20px;border:0;
  font:inherit;font-family:var(--display);font-size:15px;font-weight:600;letter-spacing:.01em;color:var(--text);cursor:pointer;text-decoration:none;
  clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%);
  background:linear-gradient(to top right,transparent calc(50% - 1.5px),rgba(255,255,255,.34) calc(50% - 1.5px),rgba(255,255,255,.34) 50%,transparent 50%) top right/10px 10px no-repeat,var(--brush) 0 0/320px 320px,var(--face-hi);
  box-shadow:inset 1px 1px 0 rgba(255,255,255,.13),inset -1px -1px 0 #000}
.btn:hover{background:linear-gradient(to top right,transparent calc(50% - 1.5px),rgba(255,255,255,.45) calc(50% - 1.5px),rgba(255,255,255,.45) 50%,transparent 50%) top right/10px 10px no-repeat,var(--brush) 0 0/320px 320px,linear-gradient(180deg,#3a3f48,#2a2e35)}
.btn:active{box-shadow:inset 1px 1px 0 rgba(0,0,0,.6),inset -1px -1px 0 rgba(255,255,255,.06)}
.btn.ghost{background:linear-gradient(to top right,transparent calc(50% - 1.5px),#5a5f68 calc(50% - 1.5px),#5a5f68 50%,transparent 50%) top right/10px 10px no-repeat,linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,0));box-shadow:inset 0 0 0 1px #4a4f58}
.btn.ghost:hover{background:linear-gradient(to top right,transparent calc(50% - 1.5px),#8a8f98 calc(50% - 1.5px),#8a8f98 50%,transparent 50%) top right/10px 10px no-repeat,linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.01));box-shadow:inset 0 0 0 1px #7d828b}
.btn.light{color:#0b0b0c;background:var(--chrome);box-shadow:inset 1px 1px 0 #fff,inset -1px -1px 0 #000}
.btn.light:hover{background:linear-gradient(180deg,#fff 0%,#c8cbd0 46%,#8a8d93 100%)}
.btn.danger{color:#fff;background:linear-gradient(180deg,#e2605f,#a33b3b);box-shadow:inset 1px 1px 0 rgba(255,255,255,.35),inset -1px -1px 0 #3d0f0f}
.btn.big{min-height:58px;padding:0 34px;font-size:19px;font-weight:700}
.btn svg{width:16px;height:16px;flex:none}

/* Chrome: the Z's plate. It tilts toward the cursor (less the bigger it is) and a fixed light's
   reflection slides across it. The hover area (.hit) never tilts, so edges can't flicker. */
.hit{display:inline-flex}
.hit.block{display:flex;flex-direction:column}
.metal,.metal:hover{position:relative;overflow:hidden;color:#0b0b0c;
  background:linear-gradient(to top right,transparent calc(50% - 2px),rgba(255,255,255,.95) calc(50% - 2px),rgba(255,255,255,.95) 50%,transparent 50%) top right/var(--cut,14px) var(--cut,14px) no-repeat,var(--chrome);
  box-shadow:inset 2px 2px 0 #fff,inset -2px -2px 0 #000;transform:perspective(800px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));transition:transform 160ms ease-out}
.hit:has(>.metal){filter:drop-shadow(0 10px 18px rgba(0,0,0,.5))}
.metal::before{content:"";position:absolute;top:-60%;left:0;width:72px;height:220%;pointer-events:none;background:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,.12) 22%,rgba(255,255,255,.55) 42%,rgba(255,255,255,.85) 50%,rgba(255,255,255,.55) 58%,rgba(255,255,255,.12) 78%,rgba(255,255,255,0) 100%);transform:translateX(calc(var(--gx,0px) - 36px)) rotate(15deg);opacity:0;transition:transform 160ms ease-out,opacity 220ms}
.metal>*{position:relative;z-index:1}
.metal.lit::before{opacity:calc(.9 * var(--gf,1))}

/* Game cards. The picture is only the developer's image; the nameplate below holds the rest.
   Pointing at a card (or tabbing to it) lifts it into a chrome frame, and the page takes its colors. */
.tile{position:relative;overflow:hidden;display:flex;flex-direction:column;background:#101215;box-shadow:0 0 0 1px #000,var(--drop);
  transform:perspective(800px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg)) scale(var(--s,1));transition:transform 180ms ease-out,box-shadow 180ms ease-out}
.hit.block:hover,.hit.block:focus-within{position:relative;z-index:2}
.hit.block:hover .tile,.hit.block:focus-within .tile{--s:1.035;box-shadow:0 0 0 2px #e9ebee,0 0 0 4px #000,0 0 34px rgba(215,224,238,.3),0 24px 48px rgba(0,0,0,.6)}
.tile::before,.tile .pic::before,.tile .pic::after{content:"";position:absolute;top:-60%;left:0;height:220%;pointer-events:none;opacity:0;transition:transform 160ms ease-out,opacity 220ms}
.tile::before{width:200px;z-index:2;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.04) 35%,rgba(255,255,255,.07) 50%,rgba(255,255,255,.04) 65%,rgba(255,255,255,0));transform:translateX(calc(var(--gx,0px) - 100px)) rotate(15deg)}
.tile .pic{position:relative;overflow:hidden;display:block;aspect-ratio:16/9;background:var(--grain) 0 0/200px 200px,linear-gradient(135deg,#23272e,#15171b)}
.tile .pic img{width:100%;height:100%;object-fit:cover;display:block}
.tile .pic:empty::after{content:"";position:absolute;inset:0;opacity:.18;background:url(/zaisma-mark-metal.svg) center/38% no-repeat;transform:none;top:0;height:auto;width:auto}
.tile .pic::after{width:160px;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.08) 35%,rgba(255,255,255,.12) 50%,rgba(255,255,255,.08) 65%,rgba(255,255,255,0));transform:translateX(calc(var(--gx,0px) - 80px)) rotate(15deg)}
.tile .pic::before{width:18px;z-index:1;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.35) 30%,rgba(255,255,255,.55) 50%,rgba(255,255,255,.35) 70%,rgba(255,255,255,0));transform:translateX(calc(var(--gx,0px) - 9px)) rotate(15deg)}
.tile.lit::before,.tile.lit .pic::after{opacity:calc(.5 * var(--gf,1))}
.tile.lit .pic::before{opacity:calc(.8 * var(--gf,1))}
.tile .pic:empty.lit::after,.tile.lit .pic:empty::after{opacity:.18}
.tile .body{padding:12px 12px 12px 14px;display:flex;align-items:center;gap:10px;box-shadow:inset 0 1px 0 rgba(255,255,255,.07),inset 0 -1px 0 rgba(0,0,0,.6)}
.tile .name{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;text-decoration:none}
.tile .name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--display);font-weight:600;font-size:16px;letter-spacing:.005em}
.tile .name:hover span{text-decoration:underline;text-underline-offset:3px}
.tile .name small{color:var(--muted);font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tile .go{--cut:8px;flex:none;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;color:var(--text);
  background:var(--brush) 0 0/320px 320px,var(--face-hi);box-shadow:inset 1px 1px 0 rgba(255,255,255,.13),inset -1px -1px 0 #000;transition:color 120ms}
.hit.block:hover .go,.hit.block:focus-within .go{color:#0b0b0c;background:var(--chrome);box-shadow:inset 1px 1px 0 #fff,inset -1px -1px 0 #000}
.tile .go svg{width:12px;height:14px}

/* How a game is played, devices and controls: icons with words. */
.modes{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.modes li{display:flex;align-items:center;gap:10px;font-size:15px;color:var(--text)}
.modes svg{width:20px;height:20px;flex:none;color:var(--text-2)}
.modes small{color:var(--muted);font-size:14px}
.modes small::before{content:"· ";}

.badge{display:inline-flex;align-items:center;gap:6px;color:var(--ok-text);font-family:var(--display);font-size:12px;font-weight:600;letter-spacing:.01em}
.badge::before{content:"";width:6px;height:6px;background:var(--ok);box-shadow:0 0 8px rgba(95,211,141,.6)}
.pill{display:inline-block;padding:2px 9px;font-family:var(--display);font-size:12px;font-weight:600;letter-spacing:.01em;background:rgba(0,0,0,.35);box-shadow:inset 0 1px 2px rgba(0,0,0,.6),0 1px 0 rgba(255,255,255,.05)}
.pill.live,.pill.approved,.pill.info{color:var(--ok)}
.pill.held,.pill.scanning,.pill.pending,.pill.hold{color:var(--warn)}
.pill.removed,.pill.rejected,.pill.reject{color:var(--danger)}
/* The report queue: how serious, and a red edge on the cases that can't wait. */
.pill.sev0,.pill.sev1{color:var(--danger)}
.pill.sev2{color:var(--warn)}
.pill.sev4{color:var(--muted)}
.case{display:grid;gap:10px;margin-bottom:12px}
.case p{margin:0}
.case .said{color:var(--text);font-size:16px}
.case.sev0,.case.sev1{box-shadow:inset 3px 0 0 var(--danger),var(--rim),var(--drop)}
.case .decide input[name=reason]{flex:1 1 280px}
.handled summary h2{display:inline;font-size:inherit}
.nowrap{white-space:nowrap}
.note{padding:14px 16px;color:var(--muted)}
.note strong{color:var(--text)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}

/* Toggles and fields are cut into the metal; the chosen one is a raised plate on a chrome rail. */
.seg{display:inline-flex;gap:2px;padding:3px;background:#0c0e11;box-shadow:inset 0 2px 6px rgba(0,0,0,.7),0 1px 0 rgba(255,255,255,.05)}
.seg button,.seg a{position:relative;min-height:40px;padding:0 16px;border:0;background:transparent;color:var(--muted);font:inherit;font-family:var(--display);font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}
.seg button:hover,.seg a:hover{color:var(--text)}
.seg [aria-pressed=true],.seg [aria-current]{color:#fff;background:var(--brush) 0 0/320px 320px,var(--face-hi);box-shadow:inset 1px 1px 0 rgba(255,255,255,.13),inset -1px -1px 0 #000}
.seg [aria-pressed=true]::after,.seg [aria-current]::after{content:"";position:absolute;left:8px;right:8px;bottom:3px;height:2px;background:var(--chrome)}
form.stack{display:grid;gap:14px;max-width:560px}
form.stack>.btn,form.stack>.hit{justify-self:start}
label{display:grid;gap:6px;font-size:14px;color:var(--muted)}
input,textarea,select{background:#0d0f12;color:var(--text);border:1px solid #000;padding:0 12px;min-height:44px;font:inherit;
  box-shadow:inset 0 2px 5px rgba(0,0,0,.65),0 1px 0 rgba(255,255,255,.06)}
textarea{min-height:100px;padding:10px 12px}
input:focus,textarea:focus,select:focus{outline:none;border-color:#000;box-shadow:inset 0 2px 5px rgba(0,0,0,.65),0 0 0 2px rgba(230,233,238,.55)}
input[type=checkbox]{box-shadow:none}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:9px 8px;vertical-align:top;background:linear-gradient(#000,#000) bottom/100% 1px no-repeat}
tr:not(:last-child) td{box-shadow:0 1px 0 rgba(255,255,255,.04)}
th{color:var(--muted);font-weight:500;font-family:var(--display)}

footer{background:var(--brush) 0 0/320px 320px,linear-gradient(180deg,#121418,#0a0b0d);box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 -1px 0 #000}
footer .in{max-width:1240px;margin:0 auto;padding:24px;color:var(--muted);font-size:14px;display:flex;gap:10px 22px;flex-wrap:wrap;align-items:center}
footer .mark{height:20px;width:auto;margin-right:2px;filter:drop-shadow(0 1px 0 #000)}
footer a{text-decoration:none}
footer a:hover{color:var(--text);text-decoration:underline;text-underline-offset:3px}
.narrow{--cut:36px;max-width:560px;margin:12px 0 0;padding:30px 30px 26px;clip-path:polygon(0 0,calc(100% - 36px) 0,100% 36px,100% 100%,0 100%);
  background:linear-gradient(to top right,transparent calc(50% - 1.5px),rgba(255,255,255,.3) calc(50% - 1.5px),rgba(255,255,255,.3) 50%,transparent 50%) top right/36px 36px no-repeat,var(--brush) 0 0/320px 320px,var(--face);box-shadow:var(--rim)}
.narrow>h1:first-child{margin-top:0}
.error{color:var(--danger);margin:0 0 14px}
.muted{color:var(--muted);font-size:14px}
.small{font-size:12px}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-bottom:12px}
.shots img{width:100%;aspect-ratio:16/9;object-fit:cover;background:var(--pic);display:block}
.shots p{margin:6px 0}
code.key{display:block;word-break:break-all;user-select:all;color:var(--text);font-size:13px}
.keys{list-style:none;padding:0;margin:0 0 12px}
.keys li{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;background:linear-gradient(#000,#000) bottom/100% 1px no-repeat}
.keys .btn{white-space:nowrap;flex:none}
.keys .why{display:block}
.ways{display:grid;gap:10px;max-width:560px;margin-bottom:14px}
.ways[hidden],.ways>[hidden]{display:none}
h1+.ways{margin-top:18px}
.ways>.btn svg{width:18px;height:18px}
.or{display:flex;align-items:center;gap:12px;margin:4px 0 0;color:var(--muted);font-size:13px}
.or::before,.or::after{content:"";flex:1;height:1px;background:#000;box-shadow:0 1px 0 rgba(255,255,255,.055)}
.hint{font-size:12px;color:var(--muted)}
fieldset{border:0;padding:0;margin:0}
legend{font-size:14px;color:var(--muted);margin-bottom:8px}
.birth label{flex:1;min-width:90px}
details summary{cursor:pointer;color:var(--muted)}
details[open] summary{margin-bottom:10px}
pre{white-space:pre-wrap;word-break:break-word;background:#0d0f12;padding:12px;font-size:13px;box-shadow:inset 0 2px 5px rgba(0,0,0,.65),0 1px 0 rgba(255,255,255,.06)}
dialog{color:var(--text);border:0;padding:0}
dialog::backdrop{background:rgba(0,0,0,.65);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}

/* Working: a small square turning, only after the player presses something. */
.spin{width:12px;height:12px;flex:none;border:2px solid currentColor;border-right-color:transparent;animation:spin .8s linear infinite}
.metal .spin{display:inline-block;margin-right:10px;vertical-align:-1px}
[aria-busy=true]{cursor:progress}
[aria-busy=true] svg{display:none}
@keyframes spin{to{transform:rotate(360deg)}}
@media (max-width:640px){main{padding:20px 16px 56px}header.top .in{padding:0 16px;gap:0 18px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.tile .name small{display:none}.tile .body{padding:8px 8px 8px 10px}.tile .name span{font-size:15px}}
@media (prefers-reduced-motion:reduce){.metal,.tile{transition:none}.hit.block:hover .tile,.hit.block:focus-within .tile{--s:1}.ambient i{transition:none}.spin{animation-duration:2.4s}}
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

// The page's colors follow the game being pointed at. Images load before they fade in.
const AMBIENT_SCRIPT = `(()=>{const a=document.getElementById("ambient");if(!a)return;const L=[...a.children];let home=a.dataset.art||"",shown=(L.find(l=>l.classList.contains("on"))||{dataset:{}}).dataset.u||"",t=0,want="";
const show=u=>{want=u;if(u===shown)return;if(!u){shown="";L.forEach(l=>l.classList.remove("on"));return}const img=new Image();img.onload=()=>{if(want!==u)return;shown=u;const off=L.find(l=>!l.classList.contains("on"))||L[0];off.dataset.u=u;off.style.setProperty("--art","url('"+u+"')");requestAnimationFrame(()=>L.forEach(l=>l.classList.toggle("on",l===off)))};img.src=u};
window.zaismaArt=u=>{home=u||"";show(home)};if(home!==shown)show(home);
const pick=e=>{const h=e.target.closest&&e.target.closest("[data-art]");clearTimeout(t);t=setTimeout(()=>show(h?h.dataset.art:home),h?80:500)};
addEventListener("pointerover",pick,{passive:true});addEventListener("focusin",pick)})();`;

// A button that sends a form or opens a page shows it's working and can't be pressed twice.
// Pages that handle a form themselves (preventDefault) are left alone.
const BUSY_SCRIPT = `(()=>{const busy=b=>{if(!b||b.getAttribute("aria-busy")==="true")return;b.setAttribute("aria-busy","true");const s=document.createElement("span");s.className="spin";s.setAttribute("aria-hidden","true");(b.matches(".metal")?b.lastElementChild||b:b).prepend(s);
setTimeout(()=>{if(b.tagName==="BUTTON")b.disabled=true},0)};
addEventListener("submit",e=>{if(!e.defaultPrevented&&e.target.method!=="dialog")busy(e.submitter||e.target.querySelector("button[type=submit],button:not([type])"))});
addEventListener("click",e=>{const a=e.target.closest&&e.target.closest("a.btn,a.metal,a.go");if(!a||e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||a.target==="_blank")return;const u=new URL(a.href,location.href);if(u.origin!==location.origin||(u.pathname===location.pathname&&u.search===location.search))return;busy(a)});
addEventListener("pageshow",e=>{if(e.persisted)document.querySelectorAll("[aria-busy=true]").forEach(b=>{b.removeAttribute("aria-busy");b.disabled=false;b.querySelectorAll(".spin").forEach(s=>s.remove())})})})();`;

const PLAY_ICON = '<svg viewBox="0 0 14 16" aria-hidden="true"><path d="M1 1v14l12-7z" fill="currentColor"/></svg>';

/** The metal primary button. `href` makes a link, otherwise a button with the given id. */
export function metalButton(label: string, opts: { href?: string; id?: string; big?: boolean; block?: boolean; play?: boolean; type?: string; data?: Record<string, string> }): Raw {
  const cls = `btn metal bevel${opts.big ? " big" : ""}`;
  const inner = html`${opts.play ? raw(PLAY_ICON) : ""}<span>${label}</span>`;
  const data = Object.entries(opts.data ?? {}).map(([k, v]) => html` data-${k}="${v}"`);
  const el = opts.href
    ? html`<a class="${cls}" href="${opts.href}"${data}>${inner}</a>`
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

export function layout(env: Env, opts: { title: string; body: Raw; bare?: boolean; admin?: boolean; private?: boolean; nav?: "dashboard" | "home"; art?: string | null }): Response {
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
<script>${raw(METAL_SCRIPT)}${raw(AMBIENT_SCRIPT)}${raw(BUSY_SCRIPT)}</script>
</body>
</html>`;
  return new Response(doc.html, { headers: securityHeaders(env, opts.admin || opts.private ? { "Cache-Control": "no-store" } : {}) });
}

/**
 * A game's art, blurred behind the top of the page. Pointing at a game card fades the page to that
 * game's art (cards carry data-art), and back to the page's own when the pointer moves on.
 */
export function ambient(art: string | null | undefined): Raw {
  return html`<div class="ambient" id="ambient" aria-hidden="true" data-art="${art ?? ""}"><i${art ? raw(` class="on" data-u="${esc(art)}" style="--art:url('${esc(art)}')"`) : ""}></i><i></i></div>`;
}

/** The site's header, also used on its own by pages that lay themselves out (the game page). */
export function siteHeader(env: Env, opts: { admin?: boolean; nav?: "dashboard" | "home" } = {}): Raw {
  return html`<header class="top"><div class="in">
  <a class="logo" href="/" aria-label="Zaisma home"><img src="/zaisma-wordmark-metal.svg" alt="Zaisma"></a>
  <nav>${opts.admin ? html`<a href="/admin">Admin</a><a href="/admin/reports">Reports</a><a href="/admin/audit">Audit log</a>` : opts.nav === "dashboard" ? html`<a href="/">Home</a><a href="/dashboard" aria-current="page">Your games</a>` : html`<a href="/"${opts.nav === "home" ? raw(' aria-current="page"') : ""}>Home</a>`}</nav>
  <div class="end">${env.SUPABASE_URL ? raw(ACCOUNT_LINK) : ""}</div>
</div></header>`;
}

export function siteFooter(): Raw {
  return html`<footer><div class="in"><img class="mark" src="/zaisma-mark-metal.svg" alt=""><span>Zaisma™, open source</span><a href="/legal/content-rules">Content rules</a><a href="/legal/privacy">Privacy</a><a href="/legal/dmca">Copyright (DMCA)</a><a href="/dashboard">For game developers</a><a href="https://github.com/zaisma/zaisma">GitHub</a></div></footer>`;
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
