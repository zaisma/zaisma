import { checkText, gameBySlug, hasSpace, isQuickJoining, leaveOut, listRooms, readLabelParameter, readLeftParameter, type Game, type ListedRoom, type RoomList } from "@zaisma/core";
import type { Env } from "./env.ts";
import { cutButton, textButton } from "./components/actions.ts";
import { selectField } from "./components/choices.ts";
import { emptyState } from "./components/data.ts";
import { cutField } from "./components/fields.ts";
import { tabSwitch } from "./components/switch.ts";
import { html, raw, securityHeaders, type Raw } from "./html.ts";
import { playingNowCounts } from "./plays.ts";

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
    cacheDurationSec: Number(env.ROOM_LIST_CACHE_SECONDS ?? 10),
  });
}

/** Rows shown before "Show more"; the list is sorted, so these are the best ones to join. */
const FIRST_ROOM_COUNT = 10;

/** The number on the Rooms tab: the rooms the list shows, full ones too, in the region and labels picked. */
export const tabCount = (list: RoomList) => (list.openRoomCount > 99 ? "99+" : String(list.openRoomCount));

const plural = (itemCount: number, one: string, many: string) => (itemCount === 1 ? `1 ${one}` : `${itemCount} ${many}`);

/** Text players may have typed, shown only if it passes Zaisma's text filter. */
const fine = (text: string) => checkText(text).isAllowed;

/** A room's name and labels as zaisma.com shows them: only what passes the filter. */
function shownText(room: ListedRoom): { name: string | null; labels: [string, string][] } {
  return { name: room.name && fine(room.name) ? room.name : null, labels: Object.entries(room.labels).filter(([labelName, labelValue]) => fine(labelName) && fine(labelValue)) };
}

/**
 * The Rooms panel's contents, also sent on its own to refresh the panel. "Press Play and the game finds
 * you one" only for a game that joins players by itself (isQuickJoining).
 */
export function roomsPanel(game: Pick<Game, "slug" | "quick_joined_at_ms">, list: RoomList, picked: Record<string, string> = {}, ticketPlayerCount = 0): Raw {
  const slug = game.slug;
  const open = list.rooms.filter((room) => room.isOpen);
  const { playerCount, roomCount, closedRoomCount } = list.playing;
  const region = list.region ? list.regions.find((entry) => entry.region === list.region) : null;
  const head = playerCount
    ? html`<p class="rooms-head"><b>${playerCount}</b> playing now in ${plural(roomCount, "room", "rooms")}</p>`
    : "";
  // Regions to pick from, once rooms run in more than one: each with how many rooms it has.
  const regions =
    list.regions.length > 1 || (list.region && list.regions.length)
      ? html`<div class="rooms-regions">${tabSwitch({
          label: "Region",
          switchSize: "small",
          tabs: [
            { label: "All", isCurrent: !list.region, extra: raw(' data-region=""') },
            ...list.regions.map((entry) => ({ label: entry.region, badgeCount: entry.roomCount, isCurrent: list.region === entry.region, extra: html` data-region="${entry.region}" title="${entry.name}"` })),
          ],
        })}</div>`
      : "";
  // Labels worth filtering by, with only the values that pass the filter.
  const filters = list.filters
    .filter((labelFilter) => fine(labelFilter.label))
    .map((labelFilter) => ({ label: labelFilter.label, values: labelFilter.values.filter(fine) }))
    .filter((labelFilter) => labelFilter.values.length > 1 || picked[labelFilter.label]);
  const filterBar = filters.length
    ? html`<div class="rooms-filters">${filters.map(
        (labelFilter, filterIndex) => html`<div class="rooms-filter" data-label-filter="${labelFilter.label}">${selectField({
          id: `rooms-filter-${filterIndex}`,
          name: `label_${filterIndex}`,
          label: labelFilter.label,
          choices: [{ label: "Any", choiceValue: "" }, ...labelFilter.values.map((labelValue) => ({ label: labelValue, choiceValue: labelValue }))],
          pickedValue: picked[labelFilter.label] ?? "",
        })}</div>`,
      )}</div>`
    : "";
  const filtered = Object.keys(picked).length > 0;
  const hiddenRoomCount = open.length - FIRST_ROOM_COUNT;
  const empty = filtered
    ? "No open rooms like that right now. Pick something else, or press Play to start."
    : region || list.region
    ? `No open rooms in ${region?.name ?? "that region"} right now. Pick another region, or press Play to start.`
    : closedRoomCount
      ? "Every room is in a match that isn't taking new players. Press Play to start a new one."
      : "Nobody's in an open room right now. Press Play to start.";
  return html`<div class="rooms-in" data-count="${tabCount(list)}" data-playing="${Math.max(playerCount, ticketPlayerCount)}" data-shown="${shownKey(list.region, picked)}">
${head}
${regions || filterBar ? html`<div class="rooms-pick">${regions}${filterBar}</div>` : ""}
${open.length ? html`<ol class="list-rows rooms" id="rooms-rows">${open.map((room, i) => roomRow(slug, room, i >= FIRST_ROOM_COUNT))}</ol>` : emptyState({ title: "No open rooms", text: empty })}
${hiddenRoomCount > 0 ? html`<div class="rooms-all">${textButton(`Show ${plural(hiddenRoomCount, "more room", "more rooms")}`, { type: "button" })}</div>` : ""}
${list.moreOpenRoomCount > 0 ? html`<p class="rooms-more">And ${plural(list.moreOpenRoomCount, "more room", "more rooms")} with fewer players.${isQuickJoining(game) ? " Press Play and the game finds you one." : ""}</p>` : ""}
${closedRoomCount && open.length ? html`<p class="rooms-more">Plus ${plural(closedRoomCount, "match", "matches")} in progress that ${closedRoomCount === 1 ? "isn't" : "aren't"} taking new players.</p>` : ""}
</div>`;
}

/** Which region and labels a panel shows, so the page knows when to load another. */
export const shownKey = (region: string | null, picked: Record<string, string>) => `${region ?? ""}|${JSON.stringify(Object.entries(picked).sort())}`;

function roomRow(slug: string, room: ListedRoom, later: boolean): Raw {
  const space = hasSpace(room);
  const filled = `${room.playerCount} of ${room.maximumPlayerCount} ${room.maximumPlayerCount === 1 ? "player" : "players"}`;
  const meter = html`<span class="seats" aria-hidden="true">${Array.from({ length: Math.min(room.maximumPlayerCount, MAXIMUM_SEAT_COUNT) }, (_, i) => raw(i < lit(room) ? '<i class="on"></i>' : "<i></i>"))}</span>`;
  const { name, labels } = shownText(room);
  const named = Boolean(name || labels.length);
  const tags = labels.length ? html`<span class="labels">${labels.map(([labelName, labelValue], i) => html`${i ? " · " : ""}<span title="${labelName}">${labelValue}</span>`)}</span>` : "";
  // A named room leads with its name, others with how full they are; labels go underneath. The code stays in the link.
  const main = html`<span class="title">${name ? html`<strong class="name">${name}</strong>` : html`<span class="count">${filled}</span>`}${tags}</span>`;
  const label = `Join ${name ? `“${name}”` : "a room"} with ${filled}${room.location ? ` in ${room.location.countryName}` : ""}`;
  const said = [name, labels.map(([, labelValue]) => labelValue).join(", ")].filter(Boolean).join(", ");
  return html`<li class="room${later ? " later" : ""}${named ? " named" : ""}"><div class="list-row">
<span class="list-row-words">${main}</span>
<span class="fill">${meter}${name ? html`<span class="small-count">${filled}</span>` : ""}</span>
<span class="where">${room.location ? html`<img class="flag" src="/flags/${room.location.countryCode.toLowerCase()}.png" alt="" width="20" height="15" loading="lazy"><abbr title="${room.location.countryName}">${room.location.countryCode}</abbr>` : ""}</span>
<span class="list-row-end">${space ? html`<span class="room-join" role="group" aria-label="${label}">${cutButton("Join", { href: `/g/${slug}?room=${room.roomCode}`, isSmall: true })}</span>` : html`<span class="full">Full</span>`}
${named ? html`<span class="report-room" data-report-room="${room.roomCode}" data-room-name="${said}">${cutButton(`Report the room “${said}”`, { type: "button", icon: "flag", isLabelHidden: true, isSmall: true })}</span>` : ""}</span>
</div></li>`;
}

/** Most seats the meter draws. A bigger room's seats each stand for a share of its places. */
const MAXIMUM_SEAT_COUNT = 16;

/** Seats lit: one per player, or the share that's full in a bigger room (one if anyone's in, all only when full). */
export function lit(room: { playerCount: number; maximumPlayerCount: number }): number {
  if (room.maximumPlayerCount <= MAXIMUM_SEAT_COUNT) return room.playerCount;
  if (room.playerCount >= room.maximumPlayerCount) return MAXIMUM_SEAT_COUNT;
  return Math.min(MAXIMUM_SEAT_COUNT - 1, Math.max(room.playerCount > 0 ? 1 : 0, Math.round((room.playerCount / room.maximumPlayerCount) * MAXIMUM_SEAT_COUNT)));
}

/** A box for a room code a friend shared. It opens the same room link an invite does. */
export function codeBox(slug: string): Raw {
  return html`<form class="code-join" method="get" action="/g/${slug}">${cutField({ id: "room-code", name: "room", label: "Have a room code?", type: "text", icon: "hash", placeholder: "ABC234", autocomplete: "off", isRequired: true })}${cutButton("Join", { type: "submit" })}</form>`;
}

/** GET /g/:slug/rooms: the Rooms panel on its own, for the page to refresh while it's on screen. */
export async function roomsFragment(env: Env, slug: string, request: Request): Promise<Response> {
  const game = await gameBySlug(env.DB, slug);
  const shown = game && game.review_status === "live" && game.live_version_id && game.visibility !== "draft" && game.visibility !== "private" && roomsOnPage(game);
  if (!shown) return new Response("", { status: 404, headers: { "Cache-Control": "no-store" } });
  const query = new URL(request.url).searchParams;
  const picked = readLabelParameter(query.get("labels")) ?? {};
  const list = await pageRooms(env, game, request, { region: query.get("region"), labels: picked });
  // The page says which room this player just left, so they don't see themselves in it while lists catch up.
  const left = readLeftParameter(query.get("left"));
  // "Playing now" under the title is the larger of the rooms' players and the browsers playing (plays.ts).
  const body = roomsPanel(game, left ? leaveOut(list, left) : list, picked, (await playingNowCounts(env)).get(game.id) ?? 0);
  return new Response(String(body), { headers: securityHeaders(env, { "Cache-Control": "private, max-age=10" }) });
}
