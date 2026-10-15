import { checkText, gameBySlug, hasSpace, leaveOut, listRooms, readLabelParam, readLeftParam, type Game, type ListedRoom, type RoomList } from "@zaisma/core";
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
export const roomsOnPage = (game: Game) => game.multiplayer_mode !== "none" && game.room_browsing === "page";

export function pageRooms(env: Env, game: Game, request: Request, pick: { region?: string | null; labels?: Record<string, string> | null } = {}): Promise<RoomList> {
  return listRooms(env.DB, game.id, {
    country: request.cf?.country as string | undefined,
    continent: request.cf?.continent as string | undefined,
    region: pick.region,
    labels: pick.labels,
    cacheSeconds: Number(env.ROOM_LIST_CACHE_SECONDS ?? 10),
  });
}

/** Rows shown before "Show more"; the list is sorted, so these are the best ones to join. */
const FIRST = 10;

/** The number on the Rooms tab: the rooms the list shows, full ones too, in the region and labels picked. */
export const tabCount = (list: RoomList) => (list.openRoomCount > 99 ? "99+" : String(list.openRoomCount));

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** Text players may have typed, shown only if it passes Zaisma's text filter. */
const fine = (text: string) => checkText(text).ok;

/** A room's name and labels as zaisma.com shows them: only what passes the filter. */
function shownText(r: ListedRoom): { name: string | null; labels: [string, string][] } {
  return { name: r.name && fine(r.name) ? r.name : null, labels: Object.entries(r.labels).filter(([k, v]) => fine(k) && fine(v)) };
}

/** The Rooms panel's contents, also sent on its own to refresh the panel. */
export function roomsPanel(slug: string, list: RoomList, picked: Record<string, string> = {}): Raw {
  const open = list.rooms.filter((room) => room.isOpen);
  const { playerCount: players, roomCount: rooms, closedRoomCount: closed } = list.playing;
  const region = list.region ? list.regions.find((entry) => entry.region === list.region) : null;
  const head = players
    ? html`<p class="rooms-head"><span class="badge">${players} playing now</span><span class="muted">in ${plural(rooms, "room", "rooms")}</span></p>`
    : "";
  // Regions to pick from, once rooms run in more than one: each with how many rooms it has.
  const regions =
    list.regions.length > 1 || (list.region && list.regions.length)
      ? html`<div class="seg regions" role="group" aria-label="Region"><button type="button" data-region="" aria-pressed="${String(!list.region)}">All</button>${list.regions.map(
          (entry) => html`<button type="button" data-region="${entry.region}" title="${entry.name}" aria-pressed="${String(list.region === entry.region)}">${entry.region}<small>${entry.roomCount}</small></button>`,
        )}</div>`
      : "";
  // Labels worth filtering by, with only the values that pass the filter.
  const filters = list.filters
    .filter((f) => fine(f.label))
    .map((f) => ({ label: f.label, values: f.values.filter(fine) }))
    .filter((f) => f.values.length > 1 || picked[f.label]);
  const filterBar = filters.length
    ? html`<div class="filters">${filters.map(
        (f) => html`<label class="filter"><span>${f.label}</span><select data-label="${f.label}"><option value="">Any</option>${f.values.map(
          (v) => html`<option${picked[f.label] === v ? raw(" selected") : ""}>${v}</option>`,
        )}</select></label>`,
      )}</div>`
    : "";
  const filtered = Object.keys(picked).length > 0;
  const hidden = open.length - FIRST;
  const empty = filtered
    ? "No open rooms like that right now. Pick something else, or press Play to start."
    : region || list.region
    ? `No open rooms in ${region?.name ?? "that region"} right now. Pick another region, or press Play to start.`
    : closed
      ? "Every room is in a match that isn't taking new players. Press Play to start a new one."
      : "Nobody's in an open room right now. Press Play to start.";
  return html`<div class="rooms-in" data-count="${tabCount(list)}" data-playing="${players}" data-shown="${shownKey(list.region, picked)}">
${head}
${regions || filterBar ? html`<div class="rooms-pick">${regions}${filterBar}</div>` : ""}
${open.length ? html`<ol class="rooms">${open.map((r, i) => roomRow(slug, r, i >= FIRST))}</ol>` : html`<p class="note rooms-empty">${empty}</p>`}
${hidden > 0 ? html`<button class="btn ghost rooms-all" type="button">Show ${plural(hidden, "more room", "more rooms")}</button>` : ""}
${list.moreOpenRoomCount > 0 ? html`<p class="muted rooms-more">And ${plural(list.moreOpenRoomCount, "more room", "more rooms")} with fewer players. Press Play and the game finds you one.</p>` : ""}
${closed && open.length ? html`<p class="muted rooms-more">Plus ${plural(closed, "match", "matches")} in progress that ${closed === 1 ? "isn't" : "aren't"} taking new players.</p>` : ""}
</div>`;
}

/** Which region and labels a panel shows, so the page knows when to load another. */
export const shownKey = (region: string | null, picked: Record<string, string>) => `${region ?? ""}|${JSON.stringify(Object.entries(picked).sort())}`;

function roomRow(slug: string, r: ListedRoom, later: boolean): Raw {
  const space = hasSpace(r);
  const filled = `${r.playerCount} of ${r.maximumPlayerCount} ${r.maximumPlayerCount === 1 ? "player" : "players"}`;
  const meter = html`<span class="seats" aria-hidden="true">${Array.from({ length: Math.min(r.maximumPlayerCount, SEATS) }, (_, i) => raw(i < lit(r) ? '<i class="on"></i>' : "<i></i>"))}</span>`;
  const { name, labels } = shownText(r);
  const named = Boolean(name || labels.length);
  const tags = labels.length ? html`<span class="labels">${labels.map(([k, v], i) => html`${i ? " · " : ""}<span title="${k}">${v}</span>`)}</span>` : "";
  // A named room leads with its name, others with how full they are; labels go underneath. The code stays in the link.
  const main = html`<span class="title">${name ? html`<strong class="name">${name}</strong>` : html`<span class="count">${filled}</span>`}${tags}</span>`;
  const label = `Join ${name ? `“${name}”` : "a room"} with ${filled}${r.location ? ` in ${r.location.countryName}` : ""}`;
  const said = [name, labels.map(([, v]) => v).join(", ")].filter(Boolean).join(", ");
  return html`<li class="room plate${later ? " later" : ""}${named ? " named" : ""}">
<span class="main">${main}</span>
<span class="fill">${meter}${name ? html`<span class="small-count">${filled}</span>` : ""}</span>
<span class="where">${r.location ? html`<img class="flag" src="/flags/${r.location.countryCode.toLowerCase()}.png" alt="" width="20" height="15" loading="lazy"><abbr title="${r.location.countryName}">${r.location.countryCode}</abbr>` : ""}</span>
${space ? html`<a class="btn" href="/g/${slug}?room=${r.roomCode}" aria-label="${label}">Join</a>` : html`<span class="full">Full</span>`}
<span class="act">${named ? html`<button class="report-room" type="button" data-report-room="${r.roomCode}" data-room-name="${said}" title="Report this room's name" aria-label="Report the room “${said}”">${raw(ICON_REPORT)}</button>` : ""}</span>
</li>`;
}

// The same mark as Report in the game page's menu.
const ICON_REPORT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4"/><path d="M5 4h12l-2.5 4.5L17 13H5"/></svg>`;

/** Most seats the meter draws. A bigger room's seats each stand for a share of its places. */
const SEATS = 16;

/** Seats lit: one per player, or the share that's full in a bigger room (one if anyone's in, all only when full). */
export function lit(room: { playerCount: number; maximumPlayerCount: number }): number {
  if (room.maximumPlayerCount <= SEATS) return room.playerCount;
  if (room.playerCount >= room.maximumPlayerCount) return SEATS;
  return Math.min(SEATS - 1, Math.max(room.playerCount > 0 ? 1 : 0, Math.round((room.playerCount / room.maximumPlayerCount) * SEATS)));
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
  const shown = game && game.review_status === "live" && game.live_version_id && game.visibility !== "draft" && game.visibility !== "private" && roomsOnPage(game);
  if (!shown) return new Response("", { status: 404, headers: { "Cache-Control": "no-store" } });
  const query = new URL(request.url).searchParams;
  const picked = readLabelParam(query.get("labels")) ?? {};
  const list = await pageRooms(env, game, request, { region: query.get("region"), labels: picked });
  // The page says which room this player just left, so they don't see themselves in it while lists catch up.
  const left = readLeftParam(query.get("left"));
  const body = roomsPanel(game.slug, left ? leaveOut(list, left) : list, picked);
  return new Response(String(body), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, max-age=10" } });
}
