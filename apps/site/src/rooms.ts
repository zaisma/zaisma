import { checkText, gameBySlug, hasSpace, hasWatchSpace, leaveOut, listRoomPage, MAXIMUM_PAGE_ROOM_COUNT, readIsHidingFullRoomsParameter, readLabelParameter, readLeftParameter, readRoomOrderParameter, type Game, type ListedRoom, type RoomOrder, type RoomPage } from "@zaisma/core";
import type { Env } from "./env.ts";
import { html, securityHeaders, type Raw } from "./html.ts";
import { secondaryButton } from "./components/actions.ts";
import { emptyState, listRows, type ListRow } from "./components/data.ts";
import { checkField, cutField, selectField, tabSwitch, type SwitchTab } from "./components/inputs.ts";
import { row, stack, type ControlMarkup, type LayoutItem } from "./components/layout.ts";
import { loadMore } from "./components/navigation.ts";
import { playingNowCounts } from "./plays.ts";

/**
 * Room browsing on the game page (docs/DECISIONS.md): the game's listed rooms, so players can jump
 * into a match. Rooms keep their own rows up to date (apps/rooms/src/room.ts); the page shows the room's
 * name and labels, where it runs (its country, in words) and how full it is, never who's in it. Join is
 * an ordinary room link, so the game decides what happens next, as with invites.
 */

/** The game runs on Zaisma rooms and its developer lists them on the page. */
export const roomsOnPage = (game: Game) => game.multiplayer_mode !== "none" && game.room_browsing === "page";

/**
 * A page of the game's rooms: the first rows (rowCount, SHOWN_ROOM_COUNT unless a refresh keeps more shown), or the page that starts at
 * cursor (LOAD_MORE_ROOM_COUNT rooms), in the region and with the labels picked, in the order picked and with full rooms left out or not.
 */
export function pageRooms(env: Env, game: Game, request: Request, pick: { region?: string | null; labels?: Record<string, string> | null; roomOrder?: RoomOrder | null; isHidingFullRooms?: boolean; cursor?: string | null; rowCount?: number } = {}): Promise<RoomPage> {
  return listRoomPage(env.DB, game.id, {
    country: request.cf?.country as string | undefined,
    continent: request.cf?.continent as string | undefined,
    region: pick.region,
    labels: pick.labels,
    roomOrder: pick.roomOrder,
    isHidingFullRooms: pick.isHidingFullRooms,
    cursor: pick.cursor,
    pageRoomCount: pick.rowCount ?? (pick.cursor ? LOAD_MORE_ROOM_COUNT : SHOWN_ROOM_COUNT),
    cacheDurationSec: Number(env.ROOM_LIST_CACHE_SECONDS ?? 10),
  });
}

/** Rows the list holds when the page opens, and the most rows in view before it scrolls inside itself; it's sorted, so these are the best ones to join. */
const SHOWN_ROOM_COUNT = 6;

/** Rooms each press of Load more adds. */
const LOAD_MORE_ROOM_COUNT = 20;

/** The most rows a refresh keeps showing: past it, the page's script stops replacing the list by itself, so the rooms the player loaded stay. */
export const MAXIMUM_REFRESHED_ROOM_COUNT = MAXIMUM_PAGE_ROOM_COUNT;

/** The orders the list can be in, as the order select says them. */
const ROOM_ORDER_CHOICES: { label: string; choiceValue: RoomOrder }[] = [
  { label: "Best to join", choiceValue: "best_to_join" },
  { label: "Most players", choiceValue: "most_players" },
  { label: "Fewest players", choiceValue: "fewest_players" },
];

/** The number on the Rooms tab: the rooms the list shows, full ones too, in the region and labels picked. */
export const tabCount = (list: Pick<RoomPage, "openRoomCount">) => (list.openRoomCount > 99 ? "99+" : String(list.openRoomCount));

/** Text players may have typed, shown only if it passes Zaisma's text filter. */
const fine = (text: string) => checkText(text).isAllowed;

/** A room's name and labels as zaisma.com shows them: only what passes the filter. */
function shownText(room: ListedRoom): { name: string | null; labels: [string, string][] } {
  return { name: room.name && fine(room.name) ? room.name : null, labels: Object.entries(room.labels).filter(([labelName, labelValue]) => fine(labelName) && fine(labelValue)) };
}

/**
 * The Rooms section's contents, also sent on its own to refresh it (into #rooms-list): the region switch and label filters, the rooms as
 * list rows (the first page: open rooms best first, then matches in progress) and a Load more under them while there are more. Its first
 * element carries what the page's script reads: data-count (the number by Rooms), data-playing (for "playing now") and data-shown (the
 * region, labels, order and full-rooms setting it shows).
 */
export function roomsPanel(game: Pick<Game, "slug">, list: RoomPage, picked: Record<string, string> = {}, ticketPlayerCount = 0): Raw {
  const slug = game.slug;
  const { playerCount } = list.playing;
  const region = list.region ? list.regions.find((entry) => entry.region === list.region) : null;
  const items: LayoutItem[] = [];
  // Regions to pick from, once rooms run in more than one: each with how many rooms it has. The page's script reads data-region.
  if (list.regions.length > 1 || (list.region && list.regions.length)) {
    const tabs: SwitchTab[] = [
      { label: "All", isCurrent: !list.region, extra: html` data-region=""` },
      ...list.regions.map((entry) => ({ label: entry.name, badgeCount: entry.roomCount, isCurrent: list.region === entry.region, extra: html` data-region="${entry.region}"` })),
    ];
    items.push({ kind: "control", markup: tabSwitch({ label: "Region", switchSize: "small", tabs }) });
  }
  // Labels worth filtering by, with only the values that pass the filter. The page's script reads data-label on the field a pick changes.
  const filters = list.filters
    .filter((labelFilter) => fine(labelFilter.label))
    .map((labelFilter) => ({ label: labelFilter.label, values: labelFilter.values.filter(fine) }))
    .filter((labelFilter) => labelFilter.values.length > 1 || picked[labelFilter.label]);
  if (filters.length) {
    const fields = filters.map((labelFilter, filterIndex): LayoutItem => ({
      kind: "control",
      markup: selectField({
        id: `rooms-label-${filterIndex}`,
        name: `room_label_${filterIndex}`,
        label: labelFilter.label,
        choices: [{ label: "Any", choiceValue: "" }, ...labelFilter.values.map((labelValue) => ({ label: labelValue, choiceValue: labelValue }))],
        pickedValue: picked[labelFilter.label] ?? "",
        dataAttributes: { label: labelFilter.label },
      }),
    }));
    items.push({ kind: "block", markup: row({ widths: "fit", items: fields }) });
  }
  // The order and the full-rooms box, once there's more than one room to order (or one is in use, so it can be undone). The page's script
  // reads them by their names, room_order and is_hiding_full_rooms.
  const { roomOrder, isHidingFullRooms } = list;
  if (list.rooms.length > 1 || roomOrder !== "best_to_join" || isHidingFullRooms) {
    items.push(
      {
        kind: "block",
        markup: row({
          widths: "fit",
          items: [
            { kind: "control", markup: selectField({ id: "rooms-order", name: "room_order", label: "Sort by", choices: ROOM_ORDER_CHOICES, pickedValue: roomOrder }) },
            { kind: "block", markup: checkField({ id: "rooms-hide-full", name: "is_hiding_full_rooms", checkValue: "true", label: "Hide full rooms", isChecked: isHidingFullRooms }) },
          ],
        }),
      },
    );
  }
  const filtered = Object.keys(picked).length > 0;
  const empty = filtered
    ? "No open rooms like that right now. Pick something else, or press Play to start."
    : isHidingFullRooms
      ? "No open rooms with space right now. Show full rooms too, or press Play to start."
    : region || list.region
        ? `No open rooms in ${region?.name ?? "that region"} right now. Pick another region, or press Play to start.`
        : "Nobody's in an open room right now. Press Play to start.";
  items.push(
    { kind: "block", markup: listRows({ id: ROOMS_LIST_ID, label: "Open rooms", shownRowCount: SHOWN_ROOM_COUNT, rows: list.rooms.map((room) => roomRow(slug, room)), whenEmpty: emptyState({ title: "No open rooms", text: empty }) }) },
  );
  if (list.nextCursor) items.push({ kind: "block", markup: moreRooms(slug, list, picked) });
  return stack({ items, dataAttributes: { count: String(tabCount(list)), playing: String(Math.max(playerCount, ticketPlayerCount)), shown: shownKey(list.region, picked, roomOrder, isHidingFullRooms) } });
}

/** The rooms' list on the page, which Load more adds the next rooms to. */
const ROOMS_LIST_ID = "rooms-rows";

/** Load more under the rooms: the next page's address carries the region, labels, order and full-rooms setting the list shows. */
const moreRooms = (slug: string, list: RoomPage, picked: Record<string, string>): Raw => {
  const query = new URLSearchParams({ cursor: list.nextCursor! });
  if (list.region) query.set("region", list.region);
  if (Object.keys(picked).length) query.set("labels", JSON.stringify(picked));
  if (list.roomOrder !== "best_to_join") query.set("room_order", list.roomOrder);
  if (list.isHidingFullRooms) query.set("is_hiding_full_rooms", "true");
  return loadMore({ href: `/g/${slug}/rooms?${query}`, label: "Load more", listId: ROOMS_LIST_ID });
};

/** Which region, labels, order and full-rooms setting a panel shows, so the page knows when to load another. The page's script builds the same key (roomsKey). */
export const shownKey = (region: string | null, picked: Record<string, string>, roomOrder: RoomOrder, isHidingFullRooms: boolean) => `${region ?? ""}|${JSON.stringify(Object.entries(picked).sort())}|${roomOrder}|${isHidingFullRooms}`;

/** The order and full-rooms setting a request asks for (room_order, is_hiding_full_rooms): anything else is the default. */
export const readRoomPick = (query: URLSearchParams) => ({ roomOrder: readRoomOrderParameter(query.get("room_order")), isHidingFullRooms: readIsHidingFullRoomsParameter(query.get("is_hiding_full_rooms")) });

/**
 * A room's row: its name and labels (or how full it is, when it has neither), then how full, how many watch and where it runs, in words;
 * Join (or Full), Watch for a room that takes spectators, and Report for a room with a name or labels to report. A match in progress that
 * isn't taking new players ends in "In a match", with Join shown grayed and off; Watch stays live where it takes spectators. The code stays
 * in the links.
 */
function roomRow(slug: string, room: ListedRoom): ListRow {
  const filled = `${room.playerCount} of ${room.maximumPlayerCount} ${room.maximumPlayerCount === 1 ? "player" : "players"}`;
  const { name, labels } = shownText(room);
  const labelValues = labels.map(([, labelValue]) => labelValue);
  const title = [name, ...labelValues].filter(Boolean).join(" · ") || filled;
  const detail = [title === filled ? "" : filled, room.spectatorCount > 0 ? `${room.spectatorCount} watching` : "", room.location?.countryName ?? ""].filter(Boolean).join(" · ");
  const said = [name, labelValues.join(", ")].filter(Boolean).join(", ");
  const actions: ControlMarkup[] = [
    ...(hasSpace(room) ? [secondaryButton("Join", { href: `/g/${slug}?room=${room.roomCode}`, isSmall: true })] : room.isOpen ? [] : [secondaryButton("Join", { type: "button", isSmall: true, isDisabled: true })]),
    ...(hasWatchSpace(room) ? [secondaryButton("Watch", { href: `/g/${slug}?room=${room.roomCode}&watch=1`, isSmall: true })] : []),
    // The page's script (report.ts) opens the report with the room's code and what it's called.
    ...(said ? [secondaryButton(`Report the room “${said}”`, { type: "button", icon: "flag", isLabelHidden: true, isSmall: true, dataAttributes: { "report-room": room.roomCode, "room-name": said } })] : []),
  ];
  return { title, detail: detail || undefined, end: hasSpace(room) ? undefined : room.isOpen ? "Full" : "In a match", action: actions.length > 1 ? actions : actions[0] };
}

/** What a field for a room code takes: its six capitals and numbers (no 0, 1, I or O), so nothing else can be typed or pasted in. */
export const ROOM_CODE_TYPING = { characterPattern: "[2-9A-HJ-NP-Z]", maximumCharacterCount: 6, isUppercase: true } as const;

/** A box for a room code a friend shared. It opens the same room link an invite does. The page's script reads #room-code. */
export function codeBox(slug: string): Raw {
  const field = cutField({ id: "room-code", name: "room", label: "Have a room code?", type: "text", placeholder: "ABC234", autocomplete: "off", ...ROOM_CODE_TYPING, pattern: "[2-9A-HJ-NP-Z]{6}", isRequired: true });
  return html`<form method="get" action="/g/${slug}">${row({ widths: "lead-fills", items: [{ kind: "control", markup: field }, { kind: "control", markup: secondaryButton("Join", { type: "submit" }) }] })}</form>`;
}

/**
 * GET /g/:slug/rooms: the Rooms panel on its own, for the page to refresh while it's on screen: its first rows (shown_row_count of them, so a
 * refresh keeps the rooms already loaded). With cursor, only the page that starts there: its rows in a list of the panel's id and the Load
 * more for the page after, which Load more adds to the list.
 */
export async function roomsFragment(env: Env, slug: string, request: Request): Promise<Response> {
  const game = await gameBySlug(env.DB, slug);
  const shown = game && game.review_status === "live" && game.live_version_id && game.visibility !== "draft" && game.visibility !== "private" && roomsOnPage(game);
  if (!shown) return new Response("", { status: 404, headers: { "Cache-Control": "no-store" } });
  const query = new URL(request.url).searchParams;
  const picked = readLabelParameter(query.get("labels")) ?? {};
  const headers = securityHeaders(env, { "Cache-Control": "private, max-age=10" });
  const cursor = query.get("cursor");
  if (cursor !== null) {
    const next = await pageRooms(env, game, request, { region: query.get("region"), labels: picked, ...readRoomPick(query), cursor });
    const rows = listRows({ whenEmpty: emptyState({ title: "No more rooms", text: "That's every open room." }), id: ROOMS_LIST_ID, label: "Open rooms", rows: next.rooms.map((room) => roomRow(slug, room)) });
    return new Response(String(html`${rows}${next.nextCursor ? moreRooms(slug, next, picked) : ""}`), { headers });
  }
  const shownRowCount = Math.floor(Number(query.get("shown_row_count")));
  const rowCount = Number.isFinite(shownRowCount) ? Math.max(SHOWN_ROOM_COUNT, Math.min(MAXIMUM_REFRESHED_ROOM_COUNT, shownRowCount)) : SHOWN_ROOM_COUNT;
  const list = await pageRooms(env, game, request, { region: query.get("region"), labels: picked, ...readRoomPick(query), rowCount });
  // The page says which room this player just left, so they don't see themselves in it while lists catch up.
  const left = readLeftParameter(query.get("left"));
  // "Playing now" under the title is the larger of the rooms' players and the browsers playing (plays.ts).
  const body = roomsPanel(game, left ? leaveOut(list, left) : list, picked, (await playingNowCounts(env)).get(game.id) ?? 0);
  return new Response(String(body), { headers });
}
