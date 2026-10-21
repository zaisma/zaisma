import { AGE_BAND_FLOOR_YEARS, accountById, checkIn, friendsNowOf, gameBySlug, joinRefusalText, leftGame, type Account, type FriendNow, type FriendsInGame } from "@zaisma/core";
import { currentSession } from "./auth.ts";
import type { Env } from "./env.ts";
import { tile } from "./home.ts";
import { cutButton } from "./components/actions.ts";
import { pictureRow } from "./components/data.ts";
import { accountPicture, html, raw, securityHeaders, type Raw } from "./html.ts";

/**
 * What friends see of each other right now (docs/DECISIONS.md, "What friends see of each other"):
 * the check-ins that say a player has zaisma.com open and which game they pressed Play on, the top
 * of /friends (Online, Playing now, Appear offline) and "Alex and Mia are playing" on game pages.
 *
 *   POST /api/presence                  a page on screen checks in: { game_slug } on a game page
 *                                       while playing, else {}; { left_game_slug } as it closes
 *   GET  /g/:slug/friends               the friends playing that game, for its page to show under
 *                                       the title: faces, "Alex and Mia are playing" and Join (empty when none)
 */
export async function handleFriendsNow(request: Request, env: Env, path: string): Promise<Response | null> {
  const playingMatch = path.match(/^\/g\/([a-z0-9-]+)\/friends$/);
  if (path !== "/api/presence" && !playingMatch) return null;
  if (path === "/api/presence" && request.method !== "POST") return new Response(null, { status: 405 });
  if (playingMatch && request.method !== "GET") return new Response(null, { status: 405 });
  // Only Zaisma's own pages check in.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(env.SITE_ORIGIN).origin) return new Response(null, { status: 403 });
  const session = await currentSession(request, env);
  if (!session) return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  const done = (response: Response) => {
    for (const cookie of session.cookies) response.headers.append("Set-Cookie", cookie);
    response.headers.set("Cache-Control", "no-store");
    return response;
  };

  if (playingMatch) {
    const game = await gameBySlug(env.DB, playingMatch[1]!);
    const account = game ? await accountById(env.DB, session.userId) : null;
    const here = game && account ? (await friendsNowOf(env.DB, account.id, AGE_BAND_FLOOR_YEARS[account.age_band])).playing.find((playing) => playing.game_id === game.id) : undefined;
    return done(new Response(here ? friendsHere(game!.slug, here).html : "", { headers: securityHeaders(env) }));
  }

  const text = await request.text();
  if (text.length > 1024) return done(new Response(null, { status: 413 }));
  let body: { game_slug?: unknown; left_game_slug?: unknown };
  try {
    body = JSON.parse(text || "{}") ?? {};
  } catch {
    return done(new Response(null, { status: 400 }));
  }
  const slugOf = (given: unknown) => (typeof given === "string" && /^[a-z0-9-]{1,80}$/.test(given) ? given : null);
  const leftSlug = slugOf(body.left_game_slug);
  if (leftSlug) {
    const game = await gameBySlug(env.DB, leftSlug);
    if (game) await leftGame(env.DB, session.userId, game.id);
    return done(new Response(null, { status: 204 }));
  }
  const gameSlug = slugOf(body.game_slug);
  const game = gameSlug ? await gameBySlug(env.DB, gameSlug) : null;
  await checkIn(env.DB, session.userId, game?.id ?? null);
  return done(new Response(null, { status: 204 }));
}

/** A friend's face, opening their profile. */
const face = (friend: FriendNow, pictureSize: "xs" | "sm" | "md") => html`<a class="face" href="/@${friend.name}" aria-label="${friend.name}">${accountPicture(friend.name, pictureSize)}</a>`;

/** The room link Join opens: the game page with the room, and the game's own server when it's on one, for joinRoom to follow. */
export const joinPath = (slug: string, join: { room_code: string; server_url: string | null }) => `/g/${slug}?room=${join.room_code}${join.server_url ? `&server=${encodeURIComponent(join.server_url)}` : ""}`;

/** Join: the room link a friend could have sent, or grayed with why it won't work (on hover, or a tap). */
export function joinButton(slug: string, join: NonNullable<FriendsInGame["join"]>): Raw {
  return join.refusal
    ? html`<span class="join-off" tabindex="0" role="button" aria-disabled="true" aria-label="Join: ${joinRefusalText(join)}" data-reason="${joinRefusalText(join)}"><span class="btn ghost">Join</span></span>`
    : html`<a class="btn" href="${joinPath(slug, join)}">Join</a>`;
}

/**
 * Join on the game page, in its new look: the room link as a small cut button, or the same lying flat when it won't work, with why said in
 * words under the friends (friendsHere). The /friends page keeps joinButton until it's rebuilt.
 */
export function friendJoinButton(slug: string, join: NonNullable<FriendsInGame["join"]>): Raw {
  return join.refusal ? cutButton("Join", { type: "button", isSmall: true, isDisabled: true }) : cutButton("Join", { href: joinPath(slug, join), isSmall: true });
}

/** Under a game page's title: the friends playing it, "Alex and Mia are playing", and Join; when Join won't work, why, under them. */
function friendsHere(slug: string, here: FriendsInGame): Raw {
  const names = here.friends.map((friend) => friend.name);
  const said = names.length === 1 ? `${names[0]} is playing` : names.length <= 3 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are playing` : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more are playing`;
  return html`${pictureRow(names, "sm")}<span class="friends-said">${said}</span>${here.join ? friendJoinButton(slug, here.join) : ""}${here.join?.refusal ? html`<p class="friends-why">${joinRefusalText(here.join)}</p>` : ""}`;
}

/** The top of /friends: who's online, what they're playing, and Appear offline. */
export async function friendsNowSection(env: Env, account: Account, friendCount: number): Promise<Raw> {
  const now = await friendsNowOf(env.DB, account.id, AGE_BAND_FLOOR_YEARS[account.age_band]);
  const isAppearingOffline = Boolean(account.is_appearing_offline);
  return html`<section class="now" aria-label="Online">
${now.online.length
    ? html`<ul class="online">${now.online.map((friend) => html`<li>${face(friend, "md")}<span>${friend.name}</span></li>`)}</ul>`
    : html`<p class="muted">${friendCount ? "None of your friends are online right now." : "Friends you add show here when they're online."}</p>`}
<form class="seg" method="post" action="/friends/appear-offline" aria-label="Your status">
<button type="submit" name="is_appearing_offline" value="0" aria-pressed="${String(!isAppearingOffline)}">Online</button>
<button type="submit" name="is_appearing_offline" value="1" aria-pressed="${String(isAppearingOffline)}">Appear offline</button>
</form>
${isAppearingOffline ? html`<p class="hint">You're hidden from Online and Playing now for everyone. You can still see your friends.</p>` : ""}
</section>
${now.playing.length
    ? html`<h2 class="rule-h" id="playing">Playing now</h2>
<ul class="playing">${now.playing.map(
        (playing) => html`<li>${playing.game
          ? tile({ slug: playing.game.slug, title: playing.game.title, cover: playing.game.cover_image_id ? `/img/${playing.game.cover_image_id}` : null, square: playing.game.square_image_id ? `/img/${playing.game.square_image_id}` : null })
          : html`<div class="hit block"><span class="tile"><span class="pic"><span class="named"><span>A game that isn't out yet</span></span></span></span></div>`}
<div class="who"><span class="faces">${playing.friends.map((friend) => face(friend, "sm"))}</span>${playing.game && playing.join ? joinButton(playing.game.slug, playing.join) : ""}</div></li>`,
      )}</ul>`
    : ""}
<style>${raw(NOW_STYLES)}</style>`;
}

/** A grayed Join: its reason shows on hover, or on a tap (which focuses it). */
export const JOIN_OFF_STYLES = `.join-off{position:relative;display:inline-flex;cursor:not-allowed;outline:none}
.join-off .btn{opacity:.45;pointer-events:none}
.join-off:hover .btn,.join-off:focus .btn{opacity:.6}
.join-off:hover::after,.join-off:focus::after{content:attr(data-reason);position:absolute;right:0;bottom:calc(100% + 8px);z-index:5;white-space:nowrap;padding:6px 10px;font-size:13px;font-weight:500;color:var(--text);background:#0c0e11;box-shadow:0 0 0 1px #4a4f58}`;

export const NOW_STYLES = `.now{display:flex;flex-direction:column;gap:14px;margin:8px 0 6px}
.now p{margin:0}
.online{list-style:none;margin:0;padding:0 0 4px;display:flex;gap:16px;overflow-x:auto}
.now .seg{align-self:flex-start}
.online li{display:flex;flex-direction:column;align-items:center;gap:6px;width:84px;flex:none;font-size:12px;color:var(--text-2)}
.online li span:last-child{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.face{display:inline-flex;text-decoration:none}
.playing{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:22px}
.playing .who{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;min-height:44px}
.faces{display:flex;flex-wrap:wrap;gap:6px}
${JOIN_OFF_STYLES}`;

