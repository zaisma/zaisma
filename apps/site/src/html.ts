// The markup primitives come first, so the components this module imports find them ready (markup.ts).
export { Raw, accountPicture, esc, html, raw } from "./markup.ts";
import { Raw, esc, html, raw } from "./markup.ts";
import { PRESENCE_CHECK_IN_MS, describePlayModes, type PlayMode } from "@zaisma/core";
import { gameFrameSource, type Env } from "./env.ts";
import { pageScript, pageScriptPath, type PageScript } from "./page-scripts.ts";
import { COMPONENT_SCRIPT, COMPONENT_STYLES, HEADER_SCRIPT } from "./components/index.ts";
import { footer, header, rail, type HeaderTab } from "./components/navigation.ts";
import { cutButton } from "./components/actions.ts";
import { pictureFrame } from "./components/data.ts";
import { backdrop } from "./components/foundations.ts";
import type { SwitchTab } from "./components/inputs.ts";
import type { Viewer } from "./viewer.ts";

/** A page's scripts, as their files (page-scripts.ts). They run in order once the page is read. */
export const scriptTags = (...scripts: PageScript[]): Raw => raw(scripts.map((script) => `<script src="${pageScriptPath(script)}" defer></script>`).join(""));

/**
 * The same, for the page's <head>, holding its first paint until they've run: a page whose look the scripts finish (the
 * components' cuts, their light and the backdrop) then never shows half-drawn for a frame as it loads.
 */
export const headScriptTags = (...scripts: PageScript[]): Raw => raw(scripts.map((script) => `<script src="${pageScriptPath(script)}" defer blocking="render"></script>`).join(""));

/**
 * Values a page's scripts read, as a JSON block that never runs: a script takes it with
 * JSON.parse(document.getElementById(id).textContent). Every < is escaped, so nothing in it ends the block.
 */
export function pageData(id: string, values: unknown): Raw {
  return html`<script type="application/json" id="${id}">${raw(JSON.stringify(values).replace(/</g, "\\u003c"))}</script>`;
}

/** Structured data for search engines (schema.org JSON-LD): a data block browsers never run. */
export function structuredData(values: unknown): Raw {
  return raw(`<script type="application/ld+json">${JSON.stringify(values).replace(/</g, "\\u003c")}</script>`);
}

// Steel: the old design system, kept only for page bodies their own slices haven't rebuilt yet (main.steel, or a game
// page's div.steel). Everything in it is scoped to that body with :where(.steel), which adds no weight, so a page's own
// styles still win as before and nothing reaches the glass header, the footer or a rebuilt page.
const STEEL_RULES = `
/* Steel, forged. Three materials: the ground (deep brushed steel, lit from the top left), gunmetal plates (every surface: brushed face, lit rim,
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
*{scrollbar-width:thin;scrollbar-color:#3a3e46 transparent}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}
::-webkit-scrollbar-thumb{background:#30343b;border:3px solid transparent;background-clip:padding-box}
::-webkit-scrollbar-thumb:hover{background-color:#4a4f58}
:root{color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:
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

  background:var(--brush) 0 0/320px 320px,linear-gradient(180deg,rgba(40,44,51,.94),rgba(24,26,31,.94));
  -webkit-backdrop-filter:blur(14px) saturate(1.2);backdrop-filter:blur(14px) saturate(1.2);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 1px 0 #000,0 2px 0 rgba(255,255,255,.035),0 12px 30px rgba(0,0,0,.38)}

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

/* Game cards. Players' cards are the developer's cover alone; the dashboard's add a nameplate below.
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
a.tile{color:inherit;text-decoration:none}
.tile .pic picture{display:block;width:100%;height:100%}
.tile .fill{display:none}
/* Phones: players' cards are square. A game with only a landscape cover shows it whole, over a
   blurred copy of itself, so nothing of the developer's art is cut off. */
@media (max-width:640px){
  a.tile .pic{aspect-ratio:1}
  a.tile.wide .pic img{position:relative;object-fit:contain}
  a.tile.wide .fill{display:block;position:absolute;inset:-24px;background:var(--fill) center/cover no-repeat;filter:blur(18px) brightness(.5) saturate(1.15)}
}
/* A game with no cover: its title engraved on the plate, over a faint Z. */
.tile .named{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:14px 20px;text-align:center}
.tile .named::before{content:"";position:absolute;inset:0;background:url(/zaisma-mark-metal.svg) center/38% no-repeat;opacity:.1}
.tile .named span{position:relative;font-family:var(--display);font-weight:600;font-size:clamp(17px,1.9vw,23px);line-height:1.15;color:#c4c7cd;
  text-shadow:0 -1px 0 rgba(0,0,0,.85),0 1px 0 rgba(255,255,255,.09);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
/* A small note on a card's art, like Updated. */
.tile .flag{position:absolute;left:10px;top:10px;z-index:3;display:inline-flex;align-items:center;gap:7px;min-height:26px;padding:0 10px;font-family:var(--display);font-size:12px;font-weight:600;color:var(--ok-text);
  background:linear-gradient(180deg,#24331f,#1a2417);box-shadow:inset 1px 1px 0 rgba(185,231,166,.15),inset -1px -1px 0 #000,0 2px 10px rgba(0,0,0,.55)}
.tile .flag::before{content:"";width:6px;height:6px;background:var(--ok);box-shadow:0 0 8px rgba(95,211,141,.7)}

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
.case .decide{display:grid;gap:10px}
.case .decide input[name=reason]{flex:1 1 280px}
.case .precedent{display:grid;gap:8px;padding:10px 12px;background:rgba(0,0,0,.18);box-shadow:inset 0 1px 3px rgba(0,0,0,.5)}
.case .precedent details{display:grid;gap:10px}
.case .precedent details[open]>summary{margin-bottom:6px}
.case .precedent details>label{margin-top:8px}
.case label.check,.precedent-card label.check{display:flex;gap:8px;align-items:center;color:var(--text)}
.case textarea{min-height:56px}
.precedent-card{display:grid;gap:10px;max-width:720px}
.pill.spot{color:var(--warn)}
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
form.stack{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;max-width:560px}
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
.keys li.off .key-name{opacity:.55}
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
.hint.ok{color:var(--ok-text)}
.hint.bad{color:var(--danger)}
.suggest{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:-6px;font-size:13px;color:var(--muted)}
.suggest[hidden]{display:none}
.suggest .btn{min-height:32px;padding:0 12px;font-size:13px}
label.toggle{display:flex;flex-direction:row;gap:8px;align-items:center;margin-top:-6px;font-size:13px;justify-self:start;cursor:pointer}
label.toggle input{width:16px;height:16px;min-height:0;margin:0;flex:none;accent-color:#c9cace}
h3.sub{margin-top:28px}
.after-row{margin-top:10px}
fieldset{border:0;padding:0;margin:0}
legend{font-size:14px;color:var(--muted);margin-bottom:8px}
.birth label{flex:1;min-width:90px}
.choices{display:grid;gap:2px}
.choices[hidden]{display:none}
.choices .choices{padding-left:28px}
/* Choices side by side, as radio buttons in a segmented track; the chosen one is the raised plate on the chrome rail. */
.seg.picks{display:flex;flex-wrap:wrap;width:fit-content;max-width:100%}
.seg.picks label{position:relative;display:inline-flex;font-size:14px;color:var(--muted);cursor:pointer}
.seg.picks input{position:absolute;inset:0;width:100%;height:100%;min-height:0;margin:0;padding:0;opacity:0;cursor:pointer}
.seg.picks span{position:relative;display:inline-flex;align-items:center;min-height:36px;padding:0 14px;font-family:var(--display);font-weight:600}
.seg.picks label:hover span{color:var(--text)}
.seg.picks input:checked+span{color:#fff;background:var(--brush) 0 0/320px 320px,var(--face-hi);box-shadow:inset 1px 1px 0 rgba(255,255,255,.13),inset -1px -1px 0 #000}
.seg.picks input:checked+span::after{content:"";position:absolute;left:8px;right:8px;bottom:3px;height:2px;background:var(--chrome)}
.seg.picks input:focus-visible+span{box-shadow:inset 0 0 0 2px #e9ebee}
.seg.picks input:disabled{cursor:not-allowed}
.seg.picks input:disabled+span{opacity:.35}
/* A wizard: one plate in the middle of the screen, one step at a time; only its body scrolls. */
dialog.wizard{width:min(560px,calc(100vw - 24px));max-width:none;height:min(680px,calc(100dvh - 24px));max-height:none;margin:auto;flex-direction:column;overflow:hidden}
dialog.wizard[open]{display:flex}
dialog.wizard>form{display:flex;flex-direction:column;flex:1;min-height:0}
.wizard [hidden]{display:none!important}
.wizard-head{display:flex;align-items:flex-start;gap:12px;padding:24px 24px 16px;
  background:linear-gradient(#000,#000) bottom left/100% 1px no-repeat,linear-gradient(rgba(255,255,255,.055),rgba(255,255,255,.055)) bottom 1px left/100% 1px no-repeat}
.wizard-head>div{flex:1;min-width:0}
.wizard-head h2{margin:0;font-size:24px;line-height:1.15}
.wizard-sub{margin:6px 0 0;color:var(--muted);font-size:14px}
.wizard-x{flex:none;margin-right:30px}
.wizard-body{flex:1;min-height:0;overflow:auto;padding:18px 24px}
.wizard-body section{display:grid;gap:16px}
.wizard-body .error{margin:14px 0 0}
/* A short window (one question, not steps): as tall as what's in it. */
.wizard.short{height:fit-content}
.wizard.short>form,.wizard.short .wizard-body{flex:none}
.wizard-body.stack{display:grid;gap:14px;align-content:start}
.wizard-body.stack .error{margin:0}
.wizard-foot{justify-content:flex-end;padding:14px 24px 20px;
  background:linear-gradient(#000,#000) top left/100% 1px no-repeat,linear-gradient(rgba(255,255,255,.055),rgba(255,255,255,.055)) top 1px left/100% 1px no-repeat}
.area{display:grid;gap:8px;padding:0 0 16px;background:linear-gradient(#000,#000) bottom/100% 1px no-repeat}
.area:last-child{padding-bottom:0;background:none}
.area legend{float:left;margin:0;color:var(--text);font-family:var(--display);font-size:16px;font-weight:600}
.area .hint{clear:left;margin:0}
@media (max-width:640px){.wizard-head{padding:18px 18px 12px}.wizard-body{padding:14px 18px}.wizard-foot{padding:12px 18px 16px}.seg.picks span{padding:0 9px;font-size:13px}}
.choices .check{display:flex;flex-direction:row;gap:10px;align-items:flex-start;padding:8px 0;color:var(--text)}
.choices .check input{width:18px;height:18px;min-height:0;margin:2px 0 0;flex:none;accent-color:#c9cace}
.choices .check small{display:block;margin-top:3px;font-size:13px}
/* The Social section's settings show only under Custom. */
.social .social-settings{display:none;gap:14px}
.social:has(input[name=social_mode][value=custom]:checked) .social-settings{display:grid}
details summary{cursor:pointer;color:var(--muted)}
details[open] summary{margin-bottom:10px}
pre{white-space:pre-wrap;word-break:break-word;background:#0d0f12;padding:12px;font-size:13px;box-shadow:inset 0 2px 5px rgba(0,0,0,.65),0 1px 0 rgba(255,255,255,.06)}
dialog{color:var(--text);border:0;padding:0}
dialog::backdrop{background:rgba(0,0,0,.65);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}

/* Account pictures: initials on a plate in the account's own color, with the Z's cut corner. */
.av{--s:36px;position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;width:var(--s);height:var(--s);font-family:var(--display);font-weight:600;font-size:calc(var(--s) * .38);letter-spacing:.02em;color:hsl(var(--h) 40% 92%);
  background:linear-gradient(to top right,transparent calc(50% - 1px),rgba(255,255,255,.35) calc(50% - 1px),rgba(255,255,255,.35) 50%,transparent 50%) top right/6px 6px no-repeat,linear-gradient(180deg,hsl(var(--h) 32% 38%),hsl(var(--h) 34% 22%));
  clip-path:polygon(0 0,calc(100% - 6px) 0,100% 6px,100% 100%,0 100%);box-shadow:inset 1px 1px 0 rgba(255,255,255,.18),inset -1px -1px 0 rgba(0,0,0,.6);text-shadow:0 1px 0 rgba(0,0,0,.5)}
.av.xs{--s:20px}
.av.sm{--s:26px}
.av.md{--s:40px}
.av.z{background:var(--chrome)}
.av.z img{width:62%;height:auto;display:block}

/* Working: the Z building itself, only after the player presses something. Masked so it takes the text color. */
.spin{width:19px;height:14px;flex:none;background:currentColor;-webkit-mask:url(/loader/zaisma-loader.svg) center/contain no-repeat;mask:url(/loader/zaisma-loader.svg) center/contain no-repeat}
.metal .spin{display:inline-block;margin-right:10px;vertical-align:-2px}
[aria-busy=true]{cursor:progress}
[aria-busy=true] svg{display:none}
@keyframes spin-calm{50%{opacity:.4}}
@media (max-width:640px){.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.tile .name small{display:none}.tile .body{padding:8px 8px 8px 10px}.tile .name span{font-size:15px}}
@media (prefers-reduced-motion:reduce){.metal,.tile{transition:none}.hit.block:hover .tile,.hit.block:focus-within .tile{--s:1}.spin{-webkit-mask-image:url(/zaisma-mark-small-white.svg);mask-image:url(/zaisma-mark-small-white.svg);animation:spin-calm 2.4s ease-in-out infinite}}
`;

/** A style sheet with each rule's selectors changed by mapSelector. @media and @supports blocks are changed inside; @keyframes, @property and the like stay as they are. */
function mapSelectors(css: string, mapSelector: (selector: string) => string): string {
  let mapped = "";
  let ruleIndex = 0;
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  while (ruleIndex < text.length) {
    const openIndex = text.indexOf("{", ruleIndex);
    if (openIndex < 0) return mapped + text.slice(ruleIndex);
    let braceDepthCount = 1;
    let endIndex = openIndex + 1;
    for (; braceDepthCount > 0; endIndex++) braceDepthCount += text[endIndex] === "{" ? 1 : text[endIndex] === "}" ? -1 : 0;
    const prelude = text.slice(ruleIndex, openIndex).trim();
    const inside = text.slice(openIndex + 1, endIndex - 1);
    if (/^@(media|supports)\b/.test(prelude)) mapped += `${prelude}{${mapSelectors(inside, mapSelector)}}`;
    else if (prelude.startsWith("@")) mapped += `${prelude}{${inside}}`;
    else mapped += `${topLevelParts(prelude, ",").map((selector) => mapSelector(selector.trim())).join(",")}{${inside}}`;
    ruleIndex = endIndex;
  }
  return mapped;
}

/** Splits at each separator outside brackets and parentheses (the commas between selectors, not those inside :is(…)). */
function topLevelParts(text: string, separators: string): string[] {
  const parts: string[] = [];
  let bracketDepthCount = 0;
  let partStartIndex = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(" || text[i] === "[") bracketDepthCount++;
    else if (text[i] === ")" || text[i] === "]") bracketDepthCount--;
    else if (bracketDepthCount === 0 && separators.includes(text[i]!)) {
      parts.push(text.slice(partStartIndex, i));
      partStartIndex = i + 1;
    }
  }
  parts.push(text.slice(partStartIndex));
  return parts;
}

/** Steel's rules, inside Steel bodies only: :root becomes the body itself, and every other selector something inside it. */
const insideSteel = (selector: string) => (selector.startsWith(":root") ? `:where(.steel)${selector.slice(5)}` : `:where(.steel) ${selector}`);

/** The components' rules that hold on every page, Steel bodies too: boxes measured with their borders, hidden is hidden, words only for screen readers. */
const EVERYWHERE = new Set(["*", "*::before", "*::after", "[hidden]", ".sr"]);

/**
 * The components' rules, outside Steel bodies: an old body's own classes (its .rail, .tag, .count) keep their old look. A component
 * placed in an old body goes in an element of class not-steel. The condition joins the selector's last part, before any ::pseudo-element.
 */
function outsideSteel(selector: string): string {
  if (EVERYWHERE.has(selector)) return selector;
  const lastPart = topLevelParts(selector, " \n\t>+~").pop()!;
  const pieces = topLevelParts(lastPart, ":");
  // "a::before" splits into "a", "" and "before": the empty piece is where a pseudo-element starts.
  const pseudoElementIndex = pieces.findIndex((piece, i) => i > 0 && piece === "" && pieces[i + 1] !== undefined);
  const conditionIndex = pseudoElementIndex < 0 ? selector.length : selector.length - lastPart.length + pieces.slice(0, pseudoElementIndex).join(":").length;
  return `${selector.slice(0, conditionIndex)}:where(:not(.steel *), .not-steel, .not-steel *)${selector.slice(conditionIndex)}`;
}

const STEEL_STYLES = mapSelectors(STEEL_RULES, insideSteel);

/** Zaisma's look: the tokens and every component (components/), defined once in the gallery at /design. Read at the first page, once every component is defined. */
let systemStyles = "";
const SYSTEM_STYLES = (): string => (systemStyles ||= mapSelectors(COMPONENT_STYLES(), outsideSteel));

/**
 * A game's art, blurred behind the top of the page under the glass, and fading into the page below. Pointing at a game card
 * fades it to that game's art. Two layers, so a new game fades in over the last.
 */
const AMBIENT_STYLES = `
.ambient { position: absolute; inset: 0 0 auto; height: 620px; overflow: hidden; z-index: 0; pointer-events: none; --ambient-opacity: 0.55; }
.ambient i { position: absolute; inset: -60px; background: var(--art, none) center / cover no-repeat; filter: blur(48px) saturate(1.3); opacity: 0; transition: opacity 650ms ease; }
.ambient i.on { opacity: var(--ambient-opacity); }
.ambient::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 30%, var(--page)); }
@media (prefers-color-scheme: dark) { :root:not([data-theme-choice="light"]) .ambient { --ambient-opacity: 0.32; } }
[data-theme-choice="dark"] .ambient { --ambient-opacity: 0.32; }
@media (prefers-reduced-motion: reduce) { .ambient i { transition: none; } }
`;

/**
 * The shell every page shares: Zaisma's backdrop and the ambient behind, the floating glass header, the page, the footer.
 * A page body not yet rebuilt is a band of Steel under the header (main.steel), the width of the window.
 */
const SHELL_STYLES = `
/* The room the floating header takes at the top: the page starts below it, and a link to a part of the page stops below it. */
:root { --header-room: calc(var(--pad-pane) + 68px + var(--gap-block-block)); scroll-padding-top: var(--header-room); }
@media (max-width: 760px) { :root { --header-room: calc(var(--pad-pane) + env(safe-area-inset-top, 0px) + 122px + var(--gap-block-block)); } }
body { position: relative; margin: 0; min-height: 100vh; display: flex; flex-direction: column; font: var(--type-reading); color: var(--ink); background: var(--page);
  padding-top: var(--header-room); }
body > main { position: relative; flex: 1 0 auto; width: 100%; }
body > main:not(.steel) { width: min(1240px, calc(100% - 2 * var(--pad-pane))); margin: 0 auto; }
main.steel, .game-steel { position: relative; }
.game-steel { flex: 1 0 auto; }
main.steel { padding: 32px max(24px, calc((100% - 1240px) / 2 + 24px)) 72px; }
@media (max-width: 640px) { main.steel { padding: 20px 16px 56px; } }
/* A page's main action, until its page is rebuilt with one of its own (the forum's New topic). */
main.steel > .page-action { display: flex; justify-content: flex-end; margin: 0 0 18px; }
body > .foot { width: min(1240px, calc(100% - 2 * var(--pad-pane))); margin: var(--gap-block-block) auto var(--pad-pane); }
`;

// Every page's own script: the metal hover, the page's colors following the game pointed at, and
// buttons that show they're working.
// The metal hover: one listener for all .hit areas, at most one update per frame.
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

// A Steel button that sends a form or opens a page shows it's working and can't be pressed twice (the components have their own).
// Pages that handle a form themselves (preventDefault) are left alone. A link marked data-download
// opens no page, so it shows it's working only until its download starts: the response sets the
// readable download_started cookie (downloadStartedCookie), which the page watches for.
const BUSY_SCRIPT = `(()=>{const busy=b=>{if(!b||b.closest(".shell")||b.getAttribute("aria-busy")==="true")return;b.setAttribute("aria-busy","true");const s=document.createElement("span");s.className="spin";s.setAttribute("aria-hidden","true");(b.matches(".metal")?b.lastElementChild||b:b).prepend(s);
setTimeout(()=>{if(b.tagName==="BUTTON")b.disabled=true},0)};
const idle=b=>{b.removeAttribute("aria-busy");b.disabled=false;b.querySelectorAll(".spin").forEach(s=>s.remove())};
const started=/(?:^|; )((?:__Host-)?download_started)=1/;const forget=()=>{const m=document.cookie.match(started);if(m)document.cookie=m[1]+"=; Max-Age=0; Path=/"+(location.protocol==="https:"?"; Secure":"")};
const download=a=>{forget();busy(a);const from=Date.now(),i=setInterval(()=>{if(started.test(document.cookie)||Date.now()-from>120000){clearInterval(i);forget();idle(a)}},250)};
addEventListener("submit",e=>{if(!e.defaultPrevented&&e.target.method!=="dialog")busy(e.submitter||e.target.querySelector("button[type=submit],button:not([type])"))});
addEventListener("click",e=>{const a=e.target.closest&&e.target.closest("a.btn,a.metal");if(!a||e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||a.target==="_blank")return;const u=new URL(a.href,location.href);if(u.origin!==location.origin||(u.pathname===location.pathname&&u.search===location.search))return;if(a.hasAttribute("data-download"))download(a);else busy(a)});
addEventListener("pageshow",e=>{if(e.persisted)document.querySelectorAll("[aria-busy=true]").forEach(idle)})})();`;

const SITE_SCRIPT = pageScript("site", METAL_SCRIPT + AMBIENT_SCRIPT + BUSY_SCRIPT);

const PLAY_ICON = '<svg viewBox="0 0 14 16" aria-hidden="true"><path d="M1 1v14l12-7z" fill="currentColor"/></svg>';

/** The metal primary button. `href` makes a link, otherwise a button with the given id. */
export function metalButton(label: string, options: { href?: string; id?: string; isBig?: boolean; isFullWidth?: boolean; hasPlayIcon?: boolean; type?: string; dataAttributes?: Record<string, string> }): Raw {
  const classNames = `btn metal bevel${options.isBig ? " big" : ""}`;
  const inner = html`${options.hasPlayIcon ? raw(PLAY_ICON) : ""}<span>${label}</span>`;
  const dataAttributes = Object.entries(options.dataAttributes ?? {}).map(([name, attributeValue]) => html` data-${name}="${attributeValue}"`);
  const element = options.href
    ? html`<a class="${classNames}" href="${options.href}"${dataAttributes}>${inner}</a>`
    : html`<button class="${classNames}" type="${options.type ?? "button"}"${options.id ? raw(` id="${options.id}"`) : ""}>${inner}</button>`;
  return html`<span class="hit${options.isFullWidth ? " block" : ""}">${element}</span>`;
}

/** Cloudflare's invisible check (Turnstile), on pages that ask for it: its script and its frame. */
const CHECK_ORIGIN = "https://challenges.cloudflare.com";

/** formTargets: other sites a form on the page may end up at, like the app a Sign in with Zaisma consent page goes back to. */
export function securityHeaders(env: Env, extra: Record<string, string> = {}, hasTurnstileCheck = false, frames: string[] = [], formTargets: string[] = []): Headers {
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      // Only the site's own script files (page-scripts.ts), never an inline one: Strict scripts on zaisma.com.
      `script-src 'self'${hasTurnstileCheck ? ` ${CHECK_ORIGIN}` : ""}`,
      `frame-src ${gameFrameSource(env)}${hasTurnstileCheck ? ` ${CHECK_ORIGIN}` : ""}${frames.map((frame) => ` ${frame}`).join("")}`,
      `form-action 'self'${formTargets.map((target) => ` ${target}`).join("")}`,
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
      // What the policy blocks is reported (security-alerts.ts, recordBlockedScripts): report-to for today's browsers, report-uri for the rest.
      "report-uri /csp-reports",
      "report-to csp",
    ].join("; "),
    "Reporting-Endpoints": 'csp="/csp-reports"',
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    ...extra,
  });
  return headers;
}

// Pages stay cacheable for everyone, so the header learns about sign-in from a readable hint cookie.
/**
 * A signed-in player's page checks in while it's on screen, so friends see them online (friends-now.ts);
 * a game page says which game once Play is pressed (body data-presence-game), and that it left as it closes.
 */
const PRESENCE_SCRIPT = pageScript("presence", `(()=>{if(!/(^|; )(__Host-)?zaisma_in=1/.test(document.cookie))return;let last=0,off=false;const b=document.body;
const beat=()=>{if(off||document.visibilityState!=="visible")return;last=Date.now();const g=b.dataset.presenceGame;
fetch("/api/presence",{method:"POST",body:JSON.stringify(g?{game_slug:g}:{}),keepalive:true}).then(r=>{if(r.status===401)off=true}).catch(()=>{})};
beat();setInterval(beat,${PRESENCE_CHECK_IN_MS});document.addEventListener("visibilitychange",()=>{if(Date.now()-last>60000)beat()});
new MutationObserver(beat).observe(b,{attributes:true,attributeFilter:["data-presence-game"]});
addEventListener("pagehide",()=>{const g=b.dataset.presenceGame;if(g&&!off)navigator.sendBeacon("/api/presence",JSON.stringify({left_game_slug:g}))})})();`);

// Right after the header, before the page shows, so a signed-in player never sees Sign in flash on a page that doesn't know who's
// looking (message and legal pages, cached for everyone): the Sign in runner becomes a way to the account.
const ACCOUNT_LINK_SCRIPT = pageScript("account-link", `(()=>{if(/(^|; )(__Host-)?zaisma_in=1/.test(document.cookie)){const a=document.querySelector("header.top .end > a.run-wrap");if(a){a.href="/account";a.querySelector(".face > span:not([class])").textContent="Account"}}})();`);

/**
 * Light or dark: the page carries the player's choice (data-theme-choice on <html>, "system" for guests), and CSS follows it with no script.
 * This tells page scripts what's showing: zaismaTheme.now() is "light" or "dark", choice() the saved choice, and onChange(fn) hears the
 * device change. It also sets data-theme on <html> to what's showing. It isn't deferred, so data-theme is there before the first paint.
 */
const THEME_SCRIPT = pageScript("theme", `(function () {
  var root = document.documentElement, query = window.matchMedia("(prefers-color-scheme: dark)"), listeners = [];
  function choice() { var saved = root.getAttribute("data-theme-choice"); return saved === "light" || saved === "dark" ? saved : "system"; }
  function now() { return choice() === "system" ? (query.matches ? "dark" : "light") : choice(); }
  function apply() { var theme = now(); if (root.getAttribute("data-theme") === theme) return; root.setAttribute("data-theme", theme); listeners.forEach(function (listener) { listener(theme); }); }
  if (query.addEventListener) query.addEventListener("change", apply);
  window.zaismaTheme = { now: now, choice: choice, onChange: function (listener) { listeners.push(listener); } };
  apply();
})();
`);

/** Where a page is in the header: Home, or the developer tabs, which open out of the end of the tabs on developer pages. */
export type Nav = "home" | "developer" | "forum";

/** A page's search box in the header: where it sends, what's typed, and fields it keeps. */
export interface HeaderSearch {
  action: string;
  searchText: string;
  placeholder: string;
  label: string;
  keep?: Record<string, string>;
}

const ADMIN_TABS: [string, string][] = [
  ["Admin", "/admin"], ["Reports", "/admin/reports"], ["Feedback", "/admin/feedback"], ["Profiles", "/admin/profiles"], ["Publishing", "/admin/publishing"],
  ["Chat reviews", "/admin/chat-reviews"], ["Precedents", "/admin/precedents"], ["Audit log", "/admin/audit"],
];

export interface LayoutOptions {
  title: string;
  body: Raw;
  head?: Raw;
  /** The page lays itself out (the game page): only the body, with the header and footer it puts in itself. */
  isBare?: boolean;
  isAdmin?: boolean;
  isPrivate?: boolean;
  nav?: Nav;
  art?: string | null;
  hasTurnstileCheck?: boolean;
  search?: HeaderSearch;
  /** The page's main action, at the top of a Steel page until its page is rebuilt. */
  action?: Raw;
  frames?: string[];
  formTargets?: string[];
  /**
   * Who is looking (viewer.ts): their account's picture in the header and their light or dark. A page that already read the session
   * passes its account as { account }, so the session is read once. Left out, the header says Sign in until the page sees the signed-in cookie.
   */
  viewer?: Pick<Viewer, "account"> | null;
  /** The body is built in Zaisma's look: no Steel around it. */
  isRebuilt?: boolean;
}

export function layout(env: Env, options: LayoutOptions): Response {
  const colorTheme = options.viewer?.account?.color_theme ?? "system";
  const themeColors = colorTheme === "system" ? html`<meta name="theme-color" content="#EEF2F7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0D1015" media="(prefers-color-scheme: dark)">` : html`<meta name="theme-color" content="${colorTheme === "dark" ? "#0D1015" : "#EEF2F7"}">`;
  const page = html`<!doctype html>
<html lang="en" data-theme-choice="${colorTheme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${options.title}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/jost.woff2" as="font" type="font/woff2" crossorigin>
${themeColors}
${options.head ?? ""}
<script src="${pageScriptPath(THEME_SCRIPT)}"></script>
<style>${raw(SYSTEM_STYLES() + AMBIENT_STYLES + SHELL_STYLES + STEEL_STYLES)}</style>
${headScriptTags(COMPONENT_SCRIPT, HEADER_SCRIPT)}
</head>
<body>
${backdrop()}
${ambient(options.art)}
${options.isBare
    ? options.body
    : html`${siteHeader(env, options)}
<main${options.isRebuilt ? "" : raw(' class="steel"')}>${options.action && !options.isRebuilt ? html`<div class="page-action">${options.action}</div>` : ""}${options.body}</main>
${siteFooter()}`}
${env.SUPABASE_URL && !options.isAdmin ? scriptTags(SITE_SCRIPT, PRESENCE_SCRIPT) : scriptTags(SITE_SCRIPT)}
</body>
</html>`;
  const isPrivate = options.isAdmin || options.isPrivate || Boolean(options.viewer?.account);
  return new Response(page.html, { headers: securityHeaders(env, isPrivate ? { "Cache-Control": "no-store" } : {}, options.hasTurnstileCheck, options.frames, options.formTargets) });
}

/**
 * A game's art, blurred behind the top of the page. Pointing at a game card fades the page to that
 * game's art (cards carry data-art), and back to the page's own when the pointer moves on.
 */
export function ambient(art: string | null | undefined): Raw {
  return html`<div class="ambient" id="ambient" aria-hidden="true" data-art="${art ?? ""}"><i${art ? raw(` class="on" data-u="${esc(art)}" style="--art:url('${esc(art)}')"`) : ""}></i><i></i></div>`;
}

/**
 * The site's header (components/navigation.ts), also used on its own by pages that lay themselves out (the game page): Home, the
 * developer tabs open on developer pages, the page's search, and the viewer's account menu or Sign in. Admin pages have their own tabs.
 */
export function siteHeader(env: Env, options: { isAdmin?: boolean; nav?: Nav; search?: HeaderSearch; viewer?: Pick<Viewer, "account"> | null } = {}): Raw {
  const account = options.viewer?.account ?? null;
  const markup = header({
    current: options.isAdmin ? null : (options.nav ?? null),
    ownTabs: options.isAdmin ? ADMIN_TABS.map(([label, href]): SwitchTab => ({ label, href, isCurrent: false })) : undefined,
    search: options.search ? { ...options.search, name: "search_text" } : undefined,
    account: account ? { username: account.username, pictureMarkup: pictureFrame(account.username, "md") } : null,
    isOnDeveloperPage: !options.isAdmin && (options.nav === "developer" || options.nav === "forum"),
  });
  // A page that doesn't know who's looking swaps Sign in for the account once it sees the signed-in cookie.
  return options.viewer === undefined && env.SUPABASE_URL ? html`${markup}<script src="${pageScriptPath(ACCOUNT_LINK_SCRIPT)}"></script>` : markup;
}

export function siteFooter(): Raw {
  return html`${footer()}${rail("page")}`;
}

export function message(env: Env, title: string, text: string, httpStatus = 200): Response {
  const response = layout(env, { title, body: html`<h1>${title}</h1><p class="lead">${text}</p><div class="not-steel">${cutButton("Back to games", { href: "/" })}</div>` });
  return new Response(response.body, { status: httpStatus, headers: response.headers });
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
export function playerModes(playModes: PlayMode[] | null, onlineServer: boolean): Raw {
  const described = playModes ? describePlayModes(playModes) : onlineServer ? [{ mode: "online" as const, label: "Online multiplayer", playerCount: null }] : [];
  if (!described.length) return html``;
  return html`<ul class="modes">${described.map((playMode) => html`<li>${raw(MODE_ICONS[playMode.mode])}<span>${playMode.label}</span>${playMode.playerCount ? html`<small>${playMode.playerCount}</small>` : ""}</li>`)}</ul>`;
}

/** The same, as one short line for cards: "Single-player · Online co-op". */
export function playerLine(playModes: PlayMode[] | null, onlineServer: boolean): string {
  return playModes ? describePlayModes(playModes).map((playMode) => playMode.label).join(" · ") : onlineServer ? "Online multiplayer" : "";
}
