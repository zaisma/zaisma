import { gameBySlug, hasSpace, listRooms, type Game, type ListedRoom, type RoomList } from "@zaisma/core";
import type { Env } from "./env.ts";
import { html, raw, type Raw } from "./html.ts";

/**
 * Room browsing on the game page (docs/DECISIONS.md): the game's listed rooms, so players can jump
 * into a match. Rooms keep their own rows up to date (apps/rooms/src/room.ts); the page shows the code,
 * where the room runs and how full it is, never who's in it. Join is an ordinary room link, so the
 * game decides what happens next, as with invites.
 */

/** The game runs on Zaisma rooms and its developer lists them on the page. */
export const roomsOnPage = (game: Game) => Boolean(game.game_server) && game.room_browsing === "page";

export function pageRooms(env: Env, game: Game, request: Request): Promise<RoomList> {
  return listRooms(env.DB, game.id, { near: request.cf?.continent as string | undefined, cacheSeconds: Number(env.ROOM_LIST_CACHE_SECONDS ?? 10) });
}

/** Most rows the page shows; the list is sorted, so these are the best ones to join. */
const SHOWN = 20;

/** The number on the Rooms tab: rooms a player could join right now. */
export const joinable = (list: RoomList) => list.rooms.filter(hasSpace).length;

/** The Rooms panel's contents, also sent on its own to refresh the panel. */
export function roomsPanel(slug: string, list: RoomList): Raw {
  const open = list.rooms.filter((r) => r.open);
  const shown = open.slice(0, SHOWN);
  const more = open.length - shown.length;
  const { players, rooms, closed } = list.playing;
  const head = players
    ? html`<p class="rooms-head"><span class="badge">${players === 1 ? "1 player" : `${players} players`} on now</span><span class="muted">in ${rooms === 1 ? "1 room" : `${rooms} rooms`}</span></p>`
    : "";
  return html`<div class="rooms-in" data-joinable="${joinable(list)}">
${head}
${shown.length
    ? html`<ol class="rooms">${shown.map((r) => roomRow(slug, r))}</ol>`
    : html`<p class="note rooms-empty">${closed ? "Every room is in a match that isn't taking new players. Press Play to start a new one." : "Nobody's in an open room right now. Press Play to start."}</p>`}
${more > 0 ? html`<p class="muted rooms-more">${more === 1 ? "1 more room" : `${more} more rooms`} with fewer players.</p>` : ""}
${closed && shown.length ? html`<p class="muted rooms-more">Plus ${closed === 1 ? "1 match" : `${closed} matches`} in progress that ${closed === 1 ? "isn't" : "aren't"} taking new players.</p>` : ""}
</div>`;
}

function roomRow(slug: string, r: ListedRoom): Raw {
  const space = hasSpace(r);
  const filled = `${r.players} of ${r.max} ${r.max === 1 ? "player" : "players"}`;
  // A seat for each place in the room, lit for each player in it. Big rooms just say the numbers.
  const seats = r.max <= 16 ? html`<span class="seats" aria-hidden="true">${Array.from({ length: r.max }, (_, i) => raw(i < r.players ? '<i class="on"></i>' : "<i></i>"))}</span>` : "";
  return html`<li class="room plate">
<span class="code" title="Room code">${r.code}</span>
<span class="where">${r.location ? html`${raw(ICON_GLOBE)}<span>${r.location.name}${r.near ? html`<span class="near">, near you</span>` : ""}</span>` : ""}</span>
<span class="fill">${seats}<span>${filled}</span></span>
${space ? html`<a class="btn" href="/g/${slug}?room=${r.code}" aria-label="Join room ${r.code}">Join</a>` : html`<span class="full">Full</span>`}
</li>`;
}

/** GET /g/:slug/rooms: the Rooms panel on its own, for the page to refresh while it's on screen. */
export async function roomsFragment(env: Env, slug: string, request: Request): Promise<Response> {
  const game = await gameBySlug(env.DB, slug);
  const shown = game && game.status === "live" && game.current_version_id && game.visibility !== "draft" && game.visibility !== "private" && roomsOnPage(game);
  if (!shown) return new Response("", { status: 404, headers: { "Cache-Control": "no-store" } });
  const body = roomsPanel(game.slug, await pageRooms(env, game, request));
  return new Response(String(body), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, max-age=10" } });
}

const ICON_GLOBE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>`;
