import { gameBySlug, hasSpace, listRooms, type Game, type ListedRoom, type RoomList } from "@zaisma/core";
import type { Env } from "./env.ts";
import { html, raw, type Raw } from "./html.ts";

/**
 * Room browsing on the game page (docs/DECISIONS.md): the game's listed rooms, so players can jump
 * into a match. Rooms keep their own rows up to date (apps/rooms/src/room.ts); the page shows the code,
 * where the room runs (a country flag and code) and how full it is, never who's in it. Flags are
 * flag-icons (MIT), rendered small into brand/flags. Join is an ordinary room link, so the
 * game decides what happens next, as with invites.
 */

/** The game runs on Zaisma rooms and its developer lists them on the page. */
export const roomsOnPage = (game: Game) => Boolean(game.game_server) && game.room_browsing === "page";

export function pageRooms(env: Env, game: Game, request: Request, region: string | null = null): Promise<RoomList> {
  return listRooms(env.DB, game.id, {
    country: request.cf?.country as string | undefined,
    continent: request.cf?.continent as string | undefined,
    region,
    cacheSeconds: Number(env.ROOM_LIST_CACHE_SECONDS ?? 10),
  });
}

/** Rows shown before "Show more"; the list is sorted, so these are the best ones to join. */
const FIRST = 10;

/** The number on the Rooms tab: rooms a player could join right now, everywhere. */
export const tabCount = (list: RoomList) => (list.joinable > 99 ? "99+" : String(list.joinable));

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** The Rooms panel's contents, also sent on its own to refresh the panel. */
export function roomsPanel(slug: string, list: RoomList): Raw {
  const open = list.rooms.filter((r) => r.open);
  const { players, rooms, closed } = list.playing;
  const region = list.region ? list.regions.find((r) => r.code === list.region) : null;
  const head = players
    ? html`<p class="rooms-head"><span class="badge">${plural(players, "player", "players")} on now</span><span class="muted">in ${plural(rooms, "room", "rooms")}</span></p>`
    : "";
  // Regions to pick from, once rooms run in more than one: each with how many rooms it has.
  const regions =
    list.regions.length > 1 || (list.region && list.regions.length)
      ? html`<div class="seg regions" role="group" aria-label="Region"><button type="button" data-region="" aria-pressed="${String(!list.region)}">All</button>${list.regions.map(
          (r) => html`<button type="button" data-region="${r.code}" title="${r.name}" aria-pressed="${String(list.region === r.code)}">${r.code}<small>${r.rooms}</small></button>`,
        )}</div>`
      : "";
  const hidden = open.length - FIRST;
  const empty = region || list.region
    ? `No open rooms in ${region?.name ?? "that region"} right now. Pick another region, or press Play to start.`
    : closed
      ? "Every room is in a match that isn't taking new players. Press Play to start a new one."
      : "Nobody's in an open room right now. Press Play to start.";
  return html`<div class="rooms-in" data-joinable="${tabCount(list)}" data-shown="${list.region ?? ""}">
${head}
${regions}
${open.length ? html`<ol class="rooms">${open.map((r, i) => roomRow(slug, r, i >= FIRST))}</ol>` : html`<p class="note rooms-empty">${empty}</p>`}
${hidden > 0 ? html`<button class="btn ghost rooms-all" type="button">Show ${plural(hidden, "more room", "more rooms")}</button>` : ""}
${list.more > 0 ? html`<p class="muted rooms-more">And ${plural(list.more, "more room", "more rooms")} with fewer players. Press Play and the game finds you one.</p>` : ""}
${closed && open.length ? html`<p class="muted rooms-more">Plus ${plural(closed, "match", "matches")} in progress that ${closed === 1 ? "isn't" : "aren't"} taking new players.</p>` : ""}
</div>`;
}

function roomRow(slug: string, r: ListedRoom, later: boolean): Raw {
  const space = hasSpace(r);
  const filled = `${r.players} of ${r.max} ${r.max === 1 ? "player" : "players"}`;
  const meter = html`<span class="seats" aria-hidden="true">${Array.from({ length: Math.min(r.max, SEATS) }, (_, i) => raw(i < lit(r) ? '<i class="on"></i>' : "<i></i>"))}</span>`;
  // The code stays in the link; players with a code type it into the box above the list.
  const label = `Join a room with ${filled}${r.location ? ` in ${r.location.name}` : ""}`;
  return html`<li class="room plate${later ? " later" : ""}">
<span class="fill"><span class="count">${filled}</span>${meter}</span>
<span class="where">${r.location ? html`<img class="flag" src="/flags/${r.location.country.toLowerCase()}.png" alt="" width="20" height="15" loading="lazy"><abbr title="${r.location.name}">${r.location.country}</abbr>` : ""}</span>
${space ? html`<a class="btn" href="/g/${slug}?room=${r.code}" aria-label="${label}">Join</a>` : html`<span class="full">Full</span>`}
</li>`;
}

/** Most seats the meter draws. A bigger room's seats each stand for a share of its places. */
const SEATS = 16;

/** Seats lit: one per player, or the share that's full in a bigger room (one if anyone's in, all only when full). */
export function lit(r: { players: number; max: number }): number {
  if (r.max <= SEATS) return r.players;
  if (r.players >= r.max) return SEATS;
  return Math.min(SEATS - 1, Math.max(r.players > 0 ? 1 : 0, Math.round((r.players / r.max) * SEATS)));
}

/** A box for a room code a friend shared. It opens the same room link an invite does. */
export function codeBox(slug: string): Raw {
  return html`<form class="code-join" method="get" action="/g/${slug}">
<label for="room-code">Have a room code?</label>
<input id="room-code" name="room" required maxlength="6" minlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" pattern="[2-9A-HJ-NP-Za-hj-np-z]{6}" placeholder="ABC234" title="6 letters and numbers, like ABC234">
<button class="btn" type="submit">Join</button>
</form>`;
}

/** GET /g/:slug/rooms: the Rooms panel on its own, for the page to refresh while it's on screen. */
export async function roomsFragment(env: Env, slug: string, request: Request): Promise<Response> {
  const game = await gameBySlug(env.DB, slug);
  const shown = game && game.status === "live" && game.current_version_id && game.visibility !== "draft" && game.visibility !== "private" && roomsOnPage(game);
  if (!shown) return new Response("", { status: 404, headers: { "Cache-Control": "no-store" } });
  const body = roomsPanel(game.slug, await pageRooms(env, game, request, new URL(request.url).searchParams.get("region")));
  return new Response(String(body), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, max-age=10" } });
}
