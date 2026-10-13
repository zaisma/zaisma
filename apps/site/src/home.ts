import { PLAYED_KEEP, gameBySlug, mergePlayed, readPlayers, recentlyPlayed, recordPlayed, type Game } from "@zaisma/core";
import { currentSession } from "./auth.ts";
import type { Env } from "./env.ts";
import { esc, html, layout, metalButton, playerLine, raw, type Raw } from "./html.ts";

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
  /** The square cover phones show instead, if the developer added one. */
  square: string | null;
  /** When the version players get now went live. */
  updated: number | null;
  /** When the game first went live. */
  since: number | null;
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
         (SELECT MIN(published_at) FROM versions WHERE game_id = games.id) AS since,
         (SELECT id FROM game_images WHERE game_id = games.id AND kind = 'cover' AND status = 'approved' ORDER BY created_at DESC LIMIT 1) AS cover,
         (SELECT id FROM game_images WHERE game_id = games.id AND kind = 'square' AND status = 'approved' ORDER BY created_at DESC LIMIT 1) AS square
       FROM games
       LEFT JOIN owners ON owners.id = games.owner_id
       LEFT JOIN accounts ON accounts.id = owners.account_id
       LEFT JOIN versions ON versions.id = games.current_version_id
       WHERE games.status = 'live' AND games.visibility = 'listed' AND games.current_version_id IS NOT NULL
       ORDER BY COALESCE(versions.published_at, games.updated_at) DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{ slug: string; title: string; description: string; owner_id: string | null; devices: string; players: string; game_server: string | null; connect_hosts: string; developer: string | null; published_at: number | null; since: number | null; cover: string | null; square: string | null }>();
  return results.map((r) => ({
    slug: r.slug,
    title: r.title,
    description: r.description,
    developer: r.developer,
    owner_id: r.owner_id,
    cover: r.cover ? `/img/${r.cover}` : null,
    square: r.square ? `/img/${r.square}` : null,
    updated: r.published_at,
    since: r.since,
    modes: playerLine(readPlayers(r.players), Boolean(r.game_server)),
    devices: r.devices ? r.devices.split(",") : [],
  }));
}

const DAY = 86_400_000;
/** Games per shelf, and the fewest that make a shelf worth showing. */
const SHELF = 12;
const SHELF_MIN = 2;

/**
 * Popular, trending and new, the same for everyone, by plain rules from play counts (plays.ts), not
 * AI. Popular: the most players in the last 7 days. Trending: more players in the last 3 days than
 * the 14 before would suggest, at least half as many again. New: first went live in the last 60 days, newest first. A shelf with too few games is left out.
 */
export async function shelves(env: Env, games: ShowGame[], now = Date.now()): Promise<{ popular: ShowGame[]; trending: ShowGame[]; fresh: ShowGame[] }> {
  const day = (ago: number) => new Date(now - ago * DAY).toISOString().slice(0, 10);
  const { results } = await env.DB
    .prepare(
      `SELECT games.slug,
         SUM(CASE WHEN play_days.day >= ?1 THEN play_days.players ELSE 0 END) AS week,
         SUM(CASE WHEN play_days.day >= ?2 THEN play_days.players ELSE 0 END) AS recent,
         SUM(CASE WHEN play_days.day < ?2 THEN play_days.players ELSE 0 END) AS before
       FROM play_days JOIN games ON games.id = play_days.game_id
       WHERE play_days.day >= ?3 AND games.status = 'live' AND games.visibility = 'listed'
       GROUP BY games.slug`,
    )
    .bind(day(6), day(2), day(16))
    .all<{ slug: string; week: number; recent: number; before: number }>();
  const bySlug = new Map(games.map((g) => [g.slug, g]));
  const pick = (slugs: string[]) => {
    const list = slugs.map((s) => bySlug.get(s)).filter((g): g is ShowGame => Boolean(g)).slice(0, SHELF);
    return list.length >= SHELF_MIN ? list : [];
  };
  const popular = pick(results.filter((r) => r.week >= 3).sort((a, b) => b.week - a.week).map((r) => r.slug));
  // Over 3 days, what the 14 before would suggest, plus 10 so a handful of players can't trend.
  const usual = (r: { before: number }) => (r.before / 14) * 3;
  const trending = pick(
    results
      .filter((r) => r.recent >= 10 && r.recent >= usual(r) * 1.5)
      .sort((a, b) => b.recent / (usual(b) + 10) - a.recent / (usual(a) + 10))
      .map((r) => r.slug),
  );
  const fresh = pick(
    games
      .filter((g) => g.since && g.since >= now - 60 * DAY)
      .sort((a, b) => b.since! - a.since!)
      .map((g) => g.slug),
  );
  return { popular, trending, fresh };
}

/**
 * A game card: the developer's cover and nothing else, since a studio's art carries its own name and
 * logo. It opens the game's page; only a Play button starts a game. A game without a cover gets its
 * title engraved on a plate. `flag` is a small note on the art, like "Updated".
 */
export function tile(g: ShowGame, opts: { flag?: string } = {}): Raw {
  return raw(card(g, opts.flag));
}

/**
 * The card's HTML, shared with the home page's script (CARD_JS does the same in the browser). Phones
 * show square cards: the square cover when there is one, otherwise the landscape cover whole (never
 * cropped, so no logo is cut off) over a blurred copy of itself.
 */
function card(g: Pick<ShowGame, "slug" | "title" | "cover" | "square">, flag?: string, label = g.title): string {
  const art = !g.cover
    ? `<span class="named"><span>${esc(g.title)}</span></span>`
    : g.square
      ? `<picture><source media="(max-width:640px)" srcset="${esc(g.square)}"><img src="${esc(g.cover)}" alt="" loading="lazy"></picture>`
      : `<span class="fill" style="--fill:url(${esc(g.cover)})"></span><img src="${esc(g.cover)}" alt="" loading="lazy">`;
  return `<div class="hit block"${g.cover ? ` data-art="${esc(g.cover)}"` : ""}><a class="tile${g.cover && !g.square ? " wide" : ""}" href="/g/${esc(g.slug)}" aria-label="${esc(label)}"><span class="pic">${art}${flag ? `<span class="flag">${esc(flag)}</span>` : ""}</span></a></div>`;
}

export async function home(env: Env): Promise<Response> {
  const games = await showcase(env);
  const { popular, trending, fresh } = await shelves(env, games);
  const shelf = (id: string, title: string, list: ShowGame[]) =>
    list.length ? html`<section aria-labelledby="${id}"><div class="sec-head"><h2 id="${id}">${title}</h2></div><div class="row-tiles">${list.map((g) => tile(g))}</div></section>` : "";
  const featured = games.find((g) => g.cover) ?? games[0];
  const data = games.map(({ owner_id: _, ...g }) => g);
  return layout(env, {
    title: "Zaisma: every kind of game, one link away",
    art: featured?.cover ?? null,
    nav: "home",
    body: html`<style>${raw(HOME_STYLES)}</style>
${env.SUPABASE_URL
      ? html`<section class="guest note" id="guest" hidden><span><strong>You're playing as a guest.</strong> Your progress stays on this device. Make an account to keep it everywhere.</span><a class="btn" href="/join">Make an account</a></section>`
      : ""}
${featured
      ? html`<section class="stage" id="stage" aria-labelledby="stage-title">
<a class="art" id="stage-pic" href="/g/${featured.slug}" tabindex="-1" aria-hidden="true">${featured.cover ? html`<img src="${featured.cover}" alt="">` : ""}</a>
<div class="info plate bevel-l">
<h1 id="stage-title">${featured.title}</h1>
<p class="by" id="stage-by">${[featured.developer, featured.modes].filter(Boolean).join(" · ")}</p>
<a class="updated" id="stage-updated" hidden></a>
<p class="desc" id="stage-desc">${featured.description}</p>
<div class="go-row">${metalButton("Play", { href: `/g/${featured.slug}?play`, big: true, block: true, play: true })}<a class="btn ghost big" id="stage-details" href="/g/${featured.slug}">Details</a></div>
</div>
</section>`
      : html`<h1>Every kind of game. One link away.</h1><p class="empty">The first games are on their way.</p>`}
<section class="continue" id="continue" aria-labelledby="continue-title" hidden>
<div class="sec-head"><h2 id="continue-title">Continue playing</h2>
<div class="seg" role="group" aria-label="Sort"><button type="button" data-sort="played" aria-pressed="true">Recently played</button><button type="button" data-sort="updated" aria-pressed="false">Recently updated</button></div></div>
<div class="row-tiles" id="continue-tiles"></div>
</section>
${shelf("popular-title", "Popular", popular)}
${shelf("trending-title", "Trending", trending)}
${shelf("new-title", "New", fresh)}
${games.length
      ? html`<section aria-labelledby="games-title"><div class="sec-head"><h2 id="games-title">${popular.length || trending.length || fresh.length ? "All games" : "Games"}</h2></div>
<div class="grid">${games.map((g) => tile(g))}</div></section>`
      : ""}
<script>const GAMES=${raw(JSON.stringify(data).replace(/</g, "\\u003c"))};${raw(HOME_SCRIPT)}</script>`,
  });
}

/**
 * Recently played, for signed-in players.
 *   GET  /api/me/played          [{ slug, at }], newest first
 *   POST /api/me/played/:slug    remember that they just pressed Play
 *   POST /api/me/played          { played: [{ slug, at }] } from this device's list, when a guest makes an account
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
  if (!m[1] && request.method === "POST") {
    let body: { played?: unknown };
    try {
      body = await request.json();
    } catch {
      return json({ error: "Bad list" }, 400, session.cookies);
    }
    const list = Array.isArray(body.played) ? body.played.slice(0, PLAYED_KEEP) : [];
    const now = Date.now();
    const played: { gameId: string; at: number }[] = [];
    for (const p of list as { slug?: unknown; at?: unknown }[]) {
      const game = typeof p?.slug === "string" ? await gameBySlug(env.DB, p.slug) : null;
      const at = Number(p?.at);
      if (game && playable(game) && Number.isFinite(at) && at > 0) played.push({ gameId: game.id, at: Math.min(at, now) });
    }
    await mergePlayed(env.DB, account.id, played);
    return json({ ok: true }, 200, session.cookies);
  }
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
/* The stage: the game's art in a machined bezel, its details on a plate beside it. */
.stage{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(300px,1fr);align-items:stretch;filter:drop-shadow(0 26px 50px rgba(0,0,0,.55))}
.stage .art{position:relative;display:block;aspect-ratio:16/9;padding:3px;background:linear-gradient(135deg,#5a5f69 0%,#1a1c20 38%,#121417 70%,#3a3e46 100%)}
.stage .art img{width:100%;height:100%;object-fit:cover;display:block;box-shadow:0 0 0 1px #000}
.stage .art:empty::after{content:"";position:absolute;inset:3px;background:url(/zaisma-mark-metal.svg) center/22% no-repeat,var(--grain) 0 0/200px 200px,linear-gradient(135deg,#23272e,#14161a);opacity:.9}
.stage .info{padding:34px 32px 30px;display:flex;flex-direction:column;gap:12px;box-shadow:var(--rim)}
.stage h1{margin:0;font-size:clamp(34px,3.6vw,54px)}
.stage [hidden]{display:none!important}
.stage .by{margin:0;color:var(--muted);font-size:15px}
.stage .desc{margin:4px 0 0;color:var(--text-2);font-size:16px;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
.stage .updated{align-self:flex-start;display:inline-flex;align-items:center;gap:8px;min-height:34px;padding:0 12px;text-decoration:none;font-family:var(--display);font-size:13px;font-weight:600;color:var(--ok-text);
  background:linear-gradient(180deg,#24331f,#1a2417);box-shadow:inset 1px 1px 0 rgba(185,231,166,.15),inset -1px -1px 0 #000}
.stage .updated::before{content:"";width:7px;height:7px;background:var(--ok);box-shadow:0 0 8px rgba(95,211,141,.7)}
.stage .go-row{margin-top:auto;padding-top:22px;display:flex;gap:12px}
.stage .go-row>.hit{flex:1}
/* A scrolling row clips what spills out of it, so it leaves room for a card lifted by the pointer
   (bigger, in a chrome frame): padding all round, taken back by the margin so the cards still line up. */
.row-tiles{display:flex;gap:22px;overflow-x:auto;padding:16px 16px 34px;margin:-16px -16px -16px;scroll-padding-inline:16px;scroll-snap-type:x proximity}
.row-tiles>.hit{flex:0 0 300px;scroll-snap-align:start}
.continue[hidden]{display:none}
/* Phones and tablets: one machined piece, like a big game card. The art takes the Z's cut corner
   (its bezel running along the cut), and the nameplate sits flush underneath it. */
@media (max-width:860px){
  /* minmax(0,…) so Play and Details can't push the stage past the screen's edge. */
  .stage{grid-template-columns:minmax(0,1fr)}
  .stage .go-row .btn.big{padding:0 20px}
  .stage .art{clip-path:polygon(0 0,calc(100% - 28px) 0,100% 28px,100% 100%,0 100%);
    background:linear-gradient(to top right,transparent calc(50% - 1.5px),rgba(255,255,255,.34) calc(50% - 1.5px),rgba(255,255,255,.34) 50%,transparent 50%) top right/28px 28px no-repeat,linear-gradient(135deg,#5a5f69 0%,#1a1c20 38%,#121417 70%,#3a3e46 100%)}
  .stage .art img{clip-path:polygon(0 0,calc(100% - 26px) 0,100% 26px,100% 100%,0 100%)}
  .stage .info{--cut:0px;clip-path:none;padding:16px 18px 18px;gap:6px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),var(--rim)}
  .stage h1{font-size:clamp(28px,8vw,40px)}
  .stage .by{font-size:14px}
  .stage .desc{-webkit-line-clamp:3;font-size:15px}
  .stage .go-row{padding-top:12px}
}
@media (max-width:640px){.row-tiles{gap:14px}.row-tiles>.hit{flex-basis:164px}}
`;

// Fills in the player's own part: the game they played last on the stage, then the others in
// Continue playing (cards like tile(): the cover, opening the game's page).
const HOME_SCRIPT = `
(()=>{const bySlug=Object.fromEntries(GAMES.map(g=>[g.slug,g]));const KEY="zaisma:played";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const card=(g,flag,label)=>{const art=!g.cover?'<span class="named"><span>'+esc(g.title)+'</span></span>':g.square?'<picture><source media="(max-width:640px)" srcset="'+esc(g.square)+'"><img src="'+esc(g.cover)+'" alt="" loading="lazy"></picture>':'<span class="fill" style="--fill:url('+esc(g.cover)+')"></span><img src="'+esc(g.cover)+'" alt="" loading="lazy">';
return '<div class="hit block"'+(g.cover?' data-art="'+esc(g.cover)+'"':"")+'><a class="tile'+(g.cover&&!g.square?" wide":"")+'" href="/g/'+esc(g.slug)+'" aria-label="'+esc(label)+'"><span class="pic">'+art+(flag?'<span class="flag">'+esc(flag)+'</span>':"")+'</span></a></div>'};
const ago=t=>{const m=Math.max(1,Math.round((Date.now()-t)/60000));return m<60?m+" min ago":m<1440?Math.round(m/60)+" h ago":Math.round(m/1440)===1?"yesterday":Math.round(m/1440)+" days ago"};
let played=[];try{played=JSON.parse(localStorage.getItem(KEY)||"[]")}catch{}
const signedIn=/(^|; )(__Host-)?zaisma_in=1/.test(document.cookie);const guest=document.getElementById("guest");if(guest&&!signedIn)guest.hidden=false;
let sort="played";
function render(){const list=played.filter(p=>bySlug[p.slug]).sort((a,b)=>b.at-a.at);if(!list.length)return;
const last=list[0],g=bySlug[last.slug],fresh=g.updated&&g.updated>last.at;
const stage=document.getElementById("stage");if(stage){
stage.querySelector("#stage-pic").href="/g/"+g.slug;if(g.cover){const amb=document.getElementById("ambient");if(window.zaismaArt)zaismaArt(g.cover);else if(amb){amb.dataset.art=g.cover;const on=amb.children[0];on.dataset.u=g.cover;on.style.setProperty("--art","url('"+g.cover+"')");on.className="on";amb.children[1].className=""}}stage.querySelector("#stage-pic").innerHTML=g.cover?'<img src="'+esc(g.cover)+'" alt="">':"";
stage.querySelector("#stage-title").textContent=g.title;
stage.querySelector("#stage-by").textContent=[g.developer,"played "+ago(last.at)].filter(Boolean).join(" · ");
const up=stage.querySelector("#stage-updated");up.hidden=!fresh;if(fresh){up.href="/g/"+g.slug+"#updates";up.textContent="Updated "+ago(g.updated)}
stage.querySelector("#stage-desc").hidden=true;
const btn=stage.querySelector(".metal");btn.href="/g/"+g.slug+"?play";btn.querySelector("span").textContent="Continue";stage.querySelector("#stage-details").href="/g/"+g.slug}
// The game on the stage isn't repeated underneath.
const others=stage?list.slice(1):list;if(!others.length)return;
const rest=sort==="played"?others:others.slice().sort((a,b)=>(bySlug[b.slug].updated||0)-(bySlug[a.slug].updated||0));
document.getElementById("continue-tiles").innerHTML=rest.map(p=>{const t=bySlug[p.slug],up=t.updated&&t.updated>p.at;return card(t,up?"Updated":"",t.title+(up?", updated":""))}).join("");
document.getElementById("continue").hidden=false}
document.querySelectorAll("#continue [data-sort]").forEach(b=>b.onclick=()=>{sort=b.dataset.sort;document.querySelectorAll("#continue [data-sort]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));render()});
render();
if(signedIn)fetch("/api/me/played").then(r=>r.ok?r.json():null).then(d=>{if(!d)return;const m=new Map(played.map(p=>[p.slug,p.at]));for(const p of d.played)m.set(p.slug,Math.max(m.get(p.slug)||0,p.at));played=[...m].map(([slug,at])=>({slug,at}));render()}).catch(()=>{})})();`;
