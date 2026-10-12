import { gameBySlug, readPlayers, recentlyPlayed, recordPlayed, type Game } from "@zaisma/core";
import { currentSession } from "./auth.ts";
import type { Env } from "./env.ts";
import { html, layout, metalButton, playerLine, raw, type Raw } from "./html.ts";

/**
 * The home page and what it needs. The page is the same for everyone (so it caches); the player's own
 * part, the game they played last and Continue playing, is filled in by the browser from what this
 * device remembers, plus the account's list when signed in.
 */

export interface ShowGame {
  slug: string;
  title: string;
  description: string;
  developer: string | null;
  owner_id: string | null;
  cover: string | null;
  /** When the version players get now went live. */
  updated: number | null;
  /** How it's played, in a few words: "Single-player · Online co-op". */
  modes: string;
  devices: string[];
}

/** Listed, live games with what their cards need, newest update first. */
export async function showcase(env: Env, limit = 200): Promise<ShowGame[]> {
  const { results } = await env.DB
    .prepare(
      `SELECT games.slug, games.title, games.description, games.owner_id, games.devices, games.players, games.game_server, games.connect_hosts,
         accounts.name AS developer, versions.published_at,
         (SELECT id FROM game_images WHERE game_id = games.id AND kind = 'cover' AND status = 'approved' ORDER BY created_at DESC LIMIT 1) AS cover
       FROM games
       LEFT JOIN owners ON owners.id = games.owner_id
       LEFT JOIN accounts ON accounts.id = owners.account_id
       LEFT JOIN versions ON versions.id = games.current_version_id
       WHERE games.status = 'live' AND games.visibility = 'listed' AND games.current_version_id IS NOT NULL
       ORDER BY COALESCE(versions.published_at, games.updated_at) DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{ slug: string; title: string; description: string; owner_id: string | null; devices: string; players: string; game_server: string | null; connect_hosts: string; developer: string | null; published_at: number | null; cover: string | null }>();
  return results.map((r) => ({
    slug: r.slug,
    title: r.title,
    description: r.description,
    developer: r.developer,
    owner_id: r.owner_id,
    cover: r.cover ? `/img/${r.cover}` : null,
    updated: r.published_at,
    modes: playerLine(readPlayers(r.players), Boolean(r.game_server)),
    devices: r.devices ? r.devices.split(",") : [],
  }));
}

const PLAY_ICON = raw('<svg viewBox="0 0 14 16" aria-hidden="true"><path d="M1 1v14l12-7z" fill="currentColor"/></svg>');

/** A game card: the developer's picture, the title, and Play. */
export function tile(g: ShowGame, opts: { href?: string; small?: Raw | string } = {}): Raw {
  const href = opts.href ?? `/g/${g.slug}`;
  return html`<div class="hit block"><div class="tile">
<a class="pic" href="${href}" tabindex="-1" aria-hidden="true">${g.cover ? html`<img src="${g.cover}" alt="" loading="lazy">` : ""}</a>
<div class="body"><a class="name" href="${href}"><span>${g.title}</span>${opts.small ?? (g.developer ? html`<small>${g.developer}</small>` : "")}</a>
<a class="go bevel-s" href="${href}?play" aria-label="Play ${g.title}">${PLAY_ICON}</a></div>
</div></div>`;
}

export async function home(env: Env): Promise<Response> {
  const games = await showcase(env);
  const featured = games.find((g) => g.cover) ?? games[0];
  const data = games.map(({ owner_id: _, ...g }) => g);
  return layout(env, {
    title: "Zaisma: every kind of game, one link away",
    art: featured?.cover ?? null,
    body: html`<style>${raw(HOME_STYLES)}</style>
${env.SUPABASE_URL
      ? html`<section class="guest note" id="guest" hidden><span><strong>You're playing as a guest.</strong> Your progress stays on this device. Make an account to keep it everywhere.</span><a class="btn" href="/join">Make an account</a></section>`
      : ""}
${featured
      ? html`<section class="stage bevel-l" id="stage" aria-labelledby="stage-title">
<a class="pic" id="stage-pic" href="/g/${featured.slug}" tabindex="-1" aria-hidden="true">${featured.cover ? html`<img src="${featured.cover}" alt="">` : ""}</a>
<div class="info">
<h1 id="stage-title">${featured.title}</h1>
<p class="by" id="stage-by">${[featured.developer, featured.modes].filter(Boolean).join(" · ")}</p>
<a class="updated" id="stage-updated" hidden></a>
<p class="desc" id="stage-desc">${featured.description}</p>
<div class="go-row">${metalButton("Play", { href: `/g/${featured.slug}?play`, big: true, play: true })}</div>
</div>
</section>`
      : html`<h1>Every kind of game. One link away.</h1><p class="empty">The first games are on their way.</p>`}
<section class="continue" id="continue" aria-labelledby="continue-title" hidden>
<div class="sec-head"><h2 id="continue-title">Continue playing</h2>
<div class="seg" role="group" aria-label="Sort"><button type="button" data-sort="played" aria-pressed="true">Recently played</button><button type="button" data-sort="updated" aria-pressed="false">Recently updated</button></div></div>
<div class="row-tiles" id="continue-tiles"></div>
</section>
${games.length
      ? html`<section aria-labelledby="games-title"><div class="sec-head"><h2 id="games-title">Games</h2></div>
<div class="grid">${games.map((g) => tile(g))}</div></section>`
      : ""}
<script>const GAMES=${raw(JSON.stringify(data).replace(/</g, "\\u003c"))};${raw(HOME_SCRIPT)}</script>`,
  });
}

/**
 * Recently played, for signed-in players.
 *   GET  /api/me/played          [{ slug, at }], newest first
 *   POST /api/me/played/:slug    remember that they just pressed Play
 */
export async function handlePlayed(request: Request, env: Env, path: string): Promise<Response | null> {
  const m = path.match(/^\/api\/me\/played(?:\/([a-z0-9-]+))?$/);
  if (!m) return null;
  const json = (data: unknown, status = 200, cookies: string[] = []) => {
    const res = Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
    for (const c of cookies) res.headers.append("Set-Cookie", c);
    return res;
  };
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Bad origin" }, 403);
  const session = await currentSession(request, env);
  if (!session) return json({ error: "Signed out" }, 401);
  const account = await env.DB.prepare("SELECT id FROM accounts WHERE id = ?").bind(session.userId).first<{ id: string }>();
  if (!account) return json({ error: "No account" }, 401, session.cookies);
  if (!m[1] && request.method === "GET") return json({ played: await recentlyPlayed(env.DB, account.id) }, 200, session.cookies);
  if (m[1] && request.method === "POST") {
    const game = await gameBySlug(env.DB, m[1]);
    if (!game || !playable(game)) return json({ error: "No such game" }, 404, session.cookies);
    await recordPlayed(env.DB, account.id, game.id);
    return json({ ok: true }, 200, session.cookies);
  }
  return json({ error: "Not here" }, 405, session.cookies);
}

/** Games players can open by their link. */
export function playable(g: Game): boolean {
  return g.status === "live" && Boolean(g.current_version_id) && (g.visibility === "listed" || g.visibility === "unlisted");
}

const HOME_STYLES = `
.guest{display:flex;flex-wrap:wrap;align-items:center;gap:12px 20px;margin-bottom:24px}
.guest[hidden]{display:none}
.guest span{flex:1 1 420px;min-width:0;font-size:15px}
.stage{position:relative;display:flex;justify-content:flex-end;min-height:clamp(380px,40vw,520px);overflow:hidden;background:#111317}
.stage .pic{position:absolute;inset:0;display:block;background:var(--pic)}
.stage .pic img{width:100%;height:100%;object-fit:cover;display:block}
.stage .info{position:relative;width:min(440px,100%);padding:36px 32px 32px 56px;display:flex;flex-direction:column;gap:10px;
  background:linear-gradient(90deg,rgba(13,15,18,0) 0%,rgba(13,15,18,.78) 22%,rgba(13,15,18,.92) 100%);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}
.stage h1{font-size:clamp(32px,4vw,52px)}
.stage [hidden]{display:none!important}
.stage h1{margin:0}
.stage .by{margin:0;color:var(--muted);font-size:15px}
.stage .desc{margin:6px 0 0;color:var(--text-2);display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
.stage .updated{align-self:flex-start;display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:0 10px;background:var(--ok-bg);color:var(--ok-text);text-decoration:none;font-size:13px;font-weight:600}
.stage .updated::before{content:"";width:7px;height:7px;background:var(--ok)}
.stage .updated[hidden]{display:none}
.stage .go-row{margin-top:auto;padding-top:20px}
.sec-head{display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px;margin:40px 0 18px}
.sec-head h2{margin:0}
.row-tiles{display:flex;gap:18px;overflow-x:auto;padding:4px 2px 8px;scroll-snap-type:x proximity}
.row-tiles>.hit{flex:0 0 240px;scroll-snap-align:start}
.continue[hidden]{display:none}
@media (max-width:760px){.stage{flex-direction:column;min-height:0}.stage .pic{position:relative;aspect-ratio:16/9}.stage .info{width:100%;padding:20px;background:linear-gradient(180deg,#1d2025,#15171b);backdrop-filter:none}}
@media (max-width:640px){.row-tiles>.hit{flex-basis:200px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.tile .name small{display:none}}
`;

// Fills in the player's own part: the game they played last on the stage, then Continue playing.
const HOME_SCRIPT = `
(()=>{const bySlug=Object.fromEntries(GAMES.map(g=>[g.slug,g]));const KEY="zaisma:played";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const ago=t=>{const m=Math.max(1,Math.round((Date.now()-t)/60000));return m<60?m+" min ago":m<1440?Math.round(m/60)+" h ago":Math.round(m/1440)===1?"yesterday":Math.round(m/1440)+" days ago"};
let played=[];try{played=JSON.parse(localStorage.getItem(KEY)||"[]")}catch{}
const signedIn=/(^|; )(__Host-)?zaisma_in=1/.test(document.cookie);const guest=document.getElementById("guest");if(guest&&!signedIn)guest.hidden=false;
let sort="played";
function render(){const list=played.filter(p=>bySlug[p.slug]).sort((a,b)=>b.at-a.at);if(!list.length)return;
const last=list[0],g=bySlug[last.slug],fresh=g.updated&&g.updated>last.at;
const stage=document.getElementById("stage");if(stage){
stage.querySelector("#stage-pic").href="/g/"+g.slug;const amb=document.getElementById("ambient");if(amb&&g.cover)amb.style.setProperty("--art","url('"+g.cover+"')");stage.querySelector("#stage-pic").innerHTML=g.cover?'<img src="'+esc(g.cover)+'" alt="">':"";
stage.querySelector("#stage-title").textContent=g.title;
stage.querySelector("#stage-by").textContent=[g.developer,"played "+ago(last.at)].filter(Boolean).join(" · ");
const up=stage.querySelector("#stage-updated");up.hidden=!fresh;if(fresh){up.href="/g/"+g.slug+"#updates";up.textContent="Updated "+ago(g.updated)}
stage.querySelector("#stage-desc").hidden=true;
const btn=stage.querySelector(".metal");btn.href="/g/"+g.slug+"?play";btn.querySelector("span").textContent="Continue"}
const rest=sort==="played"?list:list.slice().sort((a,b)=>(bySlug[b.slug].updated||0)-(bySlug[a.slug].updated||0));
document.getElementById("continue-tiles").innerHTML=rest.map(p=>{const t=bySlug[p.slug],up=t.updated&&t.updated>p.at,h="/g/"+esc(t.slug);
return '<div class="hit block"><div class="tile"><a class="pic" href="'+h+'" tabindex="-1" aria-hidden="true">'+(t.cover?'<img src="'+esc(t.cover)+'" alt="" loading="lazy">':"")+'</a><div class="body"><a class="name" href="'+h+'"><span>'+esc(t.title)+'</span>'+(up?'<span class="badge">Updated</span>':'<small>Played '+ago(p.at)+'</small>')+'</a><a class="go bevel-s" href="'+h+'?play" aria-label="Continue '+esc(t.title)+'"><svg viewBox="0 0 14 16" aria-hidden="true"><path d="M1 1v14l12-7z" fill="currentColor"/></svg></a></div></div></div>'}).join("");
document.getElementById("continue").hidden=false}
document.querySelectorAll("#continue [data-sort]").forEach(b=>b.onclick=()=>{sort=b.dataset.sort;document.querySelectorAll("#continue [data-sort]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));render()});
render();
if(signedIn)fetch("/api/me/played").then(r=>r.ok?r.json():null).then(d=>{if(!d)return;const m=new Map(played.map(p=>[p.slug,p.at]));for(const p of d.played)m.set(p.slug,Math.max(m.get(p.slug)||0,p.at));played=[...m].map(([slug,at])=>({slug,at}));render()}).catch(()=>{})})();`;
