import { ROOM_PAGE_ROOM_COUNT, checkText, gameBySlug, hasSpace, isQuickJoining, leaveOut, listRooms, readLabelParameter, readLeftParameter, type Game, type ListedRoom, type RoomList } from "@zaisma/core";
import type { Env } from "./env.ts";
import { cutButton, textButton } from "./components/actions.ts";
import { selectField } from "./components/choices.ts";
import { toolRow } from "./components/panes.ts";
import { country, table, type TableColumn } from "./components/data.ts";
import { cutField } from "./components/fields.ts";
import type { IconName } from "./components/foundations.ts";
import { html, securityHeaders, type Raw } from "./html.ts";
import { playingNowCounts } from "./plays.ts";

/**
 * Room browsing on the game page (docs/DECISIONS.md): the game's listed rooms, so players can jump
 * into a match. Rooms keep their own rows up to date (apps/rooms/src/room.ts); the page shows each
 * room's name, code and labels, the country it runs in (its flag) and how full it is, never who's in it. Join is an
 * ordinary room link, so the game decides what happens next, as with invites.
 */

/** The game runs on Zaisma rooms and its developer lists them on the page. */
export const roomsOnPage = (game: Game) => game.multiplayer_mode !== "none" && game.room_browsing === "page";

/** The page's rooms, a page of open rooms at a time (ROOM_PAGE_ROOM_COUNT), the first unless it asks for another. */
export function pageRooms(env: Env, game: Game, request: Request, pick: { region?: string | null; labels?: Record<string, string> | null; pageNumber?: number } = {}): Promise<RoomList> {
  return listRooms(env.DB, game.id, {
    pageNumber: pick.pageNumber ?? 1,
    country: request.cf?.country as string | undefined,
    continent: request.cf?.continent as string | undefined,
    region: pick.region,
    labels: pick.labels,
    cacheDurationSec: Number(env.ROOM_LIST_CACHE_SECONDS ?? 10),
  });
}

/** The number on the Rooms tab: the rooms the list shows, full ones too, in the region and labels picked. */
export const tabCount = (list: RoomList) => (list.openRoomCount > 99 ? "99+" : String(list.openRoomCount));

const plural = (itemCount: number, one: string, many: string) => (itemCount === 1 ? `1 ${one}` : `${itemCount} ${many}`);

/** Text players may have typed, shown only if it passes Zaisma's text filter. */
const fine = (text: string) => checkText(text).isAllowed;

/** A room's name and labels as zaisma.com shows them: only what passes the filter. */
function shownText(room: ListedRoom): { name: string | null; labels: [string, string][] } {
  return { name: room.name && fine(room.name) ? room.name : null, labels: Object.entries(room.labels).filter(([labelName, labelValue]) => fine(labelName) && fine(labelValue)) };
}

/** Each continent's globe, marking its region in the picker. */
const CONTINENT_ICONS: Record<string, IconName> = { AF: "globe-africa", AN: "globe-antarctica", AS: "globe-asia", EU: "globe-europe", NA: "globe-north-america", OC: "globe-oceania", SA: "globe-south-america" };

/** Label columns the table shows at most, in the order rooms carry them. */
const MAXIMUM_LABEL_COLUMN_COUNT = 3;

/** "267 playing now in 78 rooms", under the Rooms heading; the page brings it up to date from the panel's data-room-players and data-room-count. */
export function roomsPlayingLine(list: RoomList): Raw | string {
  const { playerCount, roomCount } = list.playing;
  return playerCount ? html`<b>${playerCount.toLocaleString("en-US")}</b> playing now in ${plural(roomCount, "room", "rooms")}` : "";
}

/**
 * The Rooms panel's contents, also sent on its own to refresh the panel: the region and label pickers, then the open rooms as a table to
 * compare and join from, scrolling inside its own height. "Press Play and the game finds you one" only for a game that joins players by
 * itself (isQuickJoining).
 */
export function roomsPanel(game: Pick<Game, "slug" | "quick_joined_at_ms">, list: RoomList, picked: Record<string, string> = {}, ticketPlayerCount = 0, pageNumber = 1): Raw {
  const open = list.rooms.filter((room) => room.isOpen);
  const { playerCount, roomCount, closedRoomCount } = list.playing;
  const region = list.region ? list.regions.find((entry) => entry.region === list.region) : null;
  // Regions to pick from, once rooms run in more than one: each its continent's globe, its name and how many rooms it has.
  const regions =
    list.regions.length > 1 || (list.region && list.regions.length)
      ? html`<div class="rooms-filter" data-region-filter>${selectField({
          id: "rooms-region",
          name: "region",
          label: "Region",
          isSmall: true,
          choices: [
            { label: "All", choiceValue: "", icon: "globe" },
            ...list.regions.map((entry) => ({ label: entry.name, choiceValue: entry.region, icon: CONTINENT_ICONS[entry.region] ?? "globe", badgeCount: entry.roomCount })),
          ],
          pickedValue: list.region ?? "",
        })}</div>`
      : "";
  // Labels worth filtering by, with only the values that pass the filter.
  const filters = list.filters
    .filter((labelFilter) => fine(labelFilter.label))
    .map((labelFilter) => ({ label: labelFilter.label, values: labelFilter.values.filter(fine) }))
    .filter((labelFilter) => labelFilter.values.length > 1 || picked[labelFilter.label]);
  const filterFields = filters.map(
    (labelFilter, filterIndex) => html`<div class="rooms-filter" data-label-filter="${labelFilter.label}">${selectField({
      id: `rooms-filter-${filterIndex}`,
      name: `label_${filterIndex}`,
      label: labelFilter.label,
      choices: [{ label: "Any", choiceValue: "" }, ...labelFilter.values.map((labelValue) => ({ label: labelValue, choiceValue: labelValue }))],
      pickedValue: picked[labelFilter.label] ?? "",
      isSmall: true,
    })}</div>`,
  );
  const filtered = Object.keys(picked).length > 0;
  const empty = filtered
    ? "No open rooms like that right now. Pick something else, or press Play to start."
    : region || list.region
    ? `No open rooms in ${region?.name ?? "that region"} right now. Pick another region, or press Play to start.`
    : closedRoomCount
      ? "Every room is in a match that isn't taking new players. Press Play to start a new one."
      : "Nobody's in an open room right now. Press Play to start.";
  return html`<div class="rooms-in" data-count="${tabCount(list)}" data-playing="${Math.max(playerCount, ticketPlayerCount)}" data-room-players="${playerCount}" data-room-count="${roomCount}" data-shown="${shownKey(list.region, picked)}">
${toolRow({ items: [regions, ...filterFields].filter(Boolean) as Raw[], end: cutButton("Refresh the rooms", { id: "rooms-refresh", type: "button", icon: "refresh", isLabelHidden: true, isSmall: true }) })}
${roomsTable(game.slug, open, region?.name ?? null, { firstRowNumber: (pageNumber - 1) * ROOM_PAGE_ROOM_COUNT + 1, totalRowCount: list.openRoomCount }, empty)}
${open.length && isQuickJoining(game) ? html`<p class="rooms-more">Or press Play and the game finds you one.</p>` : ""}
${closedRoomCount && open.length ? html`<p class="rooms-more">Plus ${plural(closedRoomCount, "match", "matches")} in progress that ${closedRoomCount === 1 ? "isn't" : "aren't"} taking new players.</p>` : ""}
</div>`;
}

/** Which region and labels a panel shows, so the page knows when to load another. */
export const shownKey = (region: string | null, picked: Record<string, string>) => `${region ?? ""}|${JSON.stringify(Object.entries(picked).sort())}`;

/**
 * The open rooms as a Table: each room's code first, a Room column when any room has a name, a column for each label they carry (Mode, Map),
 * the country each runs in (a Country's flag), how full it is, then Join (or Full) with, for a named room, a flat Report beside it: the head
 * column, staying at the right as the table scrolls sideways, so Join is always in reach on a phone. The columns are
 * even, so they stay put as the list refreshes. Never who's in it. Its code shows, for telling a friend which room.
 */
function roomsTable(slug: string, rooms: ListedRoom[], regionName: string | null, rowSlice: { firstRowNumber: number; totalRowCount: number }, emptyText: string): Raw {
  const shown = rooms.map((room) => ({ room, ...shownText(room) }));
  const hasNames = shown.some((each) => each.name);
  const labelNames = [...new Set(shown.flatMap((each) => each.labels.map(([labelName]) => labelName)))].slice(0, MAXIMUM_LABEL_COLUMN_COUNT);
  const hasPlaces = rooms.some((room) => room.location);
  const columns: TableColumn[] = [
    { label: "Code", widthPx: 84 },
    ...(hasNames ? [{ label: "Room", widthPx: 160 }] : []),
    ...labelNames.map((labelName) => ({ label: labelName, widthPx: hasNames ? 84 : undefined })),
    ...(hasPlaces ? [{ label: "Where", widthPx: 64 }] : []),
    { label: "Players", isNumeric: true, widthPx: 88, isSortable: true },
    { label: "Join", isLabelHidden: true },
  ];
  const rows = shown.map(({ room, name, labels }) => {
    const filled = `${room.playerCount} of ${room.maximumPlayerCount}`;
    const said = [name, labels.map(([, labelValue]) => labelValue).join(", ")].filter(Boolean).join(", ");
    const joinLabel = `Join ${name ? `“${name}”` : "a room"} with ${filled} ${room.maximumPlayerCount === 1 ? "player" : "players"}${room.location ? ` in ${room.location.countryName}` : ""}`;
    const labelOf = new Map(labels);
    const join = hasSpace(room) ? html`<span role="group" aria-label="${joinLabel}">${cutButton("Join", { href: `/g/${slug}?room=${room.roomCode}`, isSmall: true })}</span>` : "Full";
    // A named room can be reported: its Report is a flat icon beside Join, quieter than it.
    const report = name ? textButton(`Report the room “${said}”`, { type: "button", icon: "flag", isLabelHidden: true, dataAttributes: { "report-room": room.roomCode, "room-name": said } }) : "";
    return [
      html`<code>${room.roomCode}</code>`,
      ...(hasNames ? [name ?? ""] : []),
      ...labelNames.map((labelName) => labelOf.get(labelName) ?? ""),
      ...(hasPlaces ? [room.location ? country({ countryCode: room.location.countryCode, countryName: room.location.countryName, isNameHidden: true }) : ""] : []),
      filled,
      report ? html`<div class="control-row">${join}${report}</div>` : join,
    ];
  });
  return table({ id: "rooms-table", label: regionName ? `Open rooms in ${regionName}` : "Open rooms", columns, rows, rowSlice, emptyText, isCompact: true, isEven: true, headColumn: "last" });
}

/** A box for a room code a friend shared. It opens the same room link an invite does. */
export function codeBox(slug: string): Raw {
  return html`<form class="control-row code-join" method="get" action="/g/${slug}">${cutField({ id: "room-code", name: "room", label: "Join a room by its code", type: "text", icon: "hash", placeholder: "Room code", autocomplete: "off", isRequired: true, isLabelHidden: true })}${cutButton("Join", { type: "submit" })}</form>`;
}

/** GET /g/:slug/rooms: the Rooms panel on its own, for the page to refresh while it's on screen. */
export async function roomsFragment(env: Env, slug: string, request: Request): Promise<Response> {
  const game = await gameBySlug(env.DB, slug);
  const shown = game && game.review_status === "live" && game.live_version_id && game.visibility !== "draft" && game.visibility !== "private" && roomsOnPage(game);
  if (!shown) return new Response("", { status: 404, headers: { "Cache-Control": "no-store" } });
  const query = new URL(request.url).searchParams;
  const picked = readLabelParameter(query.get("labels")) ?? {};
  // The page of open rooms the table is on, from 1.
  const pageNumber = Math.max(1, Math.min(10_000, Number.parseInt(query.get("page") ?? "1", 10) || 1));
  const list = await pageRooms(env, game, request, { region: query.get("region"), labels: picked, pageNumber });
  // The page says which room this player just left, so they don't see themselves in it while lists catch up.
  const left = readLeftParameter(query.get("left"));
  // "Playing now" under the title is the larger of the rooms' players and the browsers playing (plays.ts).
  const body = roomsPanel(game, left ? leaveOut(list, left) : list, picked, (await playingNowCounts(env)).get(game.id) ?? 0, pageNumber);
  return new Response(String(body), { headers: securityHeaders(env, { "Cache-Control": "private, max-age=10" }) });
}
