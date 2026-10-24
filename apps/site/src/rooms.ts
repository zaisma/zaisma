import { checkText, gameBySlug, hasSpace, hasWatchSpace, isQuickJoining, leaveOut, listRooms, readLabelParameter, readLeftParameter, type Game, type ListedRoom, type RoomList } from "@zaisma/core";
import type { Env } from "./env.ts";
import { html, securityHeaders, type Raw } from "./html.ts";
import { cutButton, textButton } from "./components/actions.ts";
import { emptyState, listRows, type ListRow } from "./components/data.ts";
import { cutField, selectField, tabSwitch, type SwitchTab } from "./components/inputs.ts";
import { row, stack, type ControlMarkup, type LayoutItem } from "./components/layout.ts";
import { readingText } from "./components/reading.ts";
import { playingNowCounts } from "./plays.ts";

/**
 * Room browsing on the game page (docs/DECISIONS.md): the game's listed rooms, so players can jump
 * into a match. Rooms keep their own rows up to date (apps/rooms/src/room.ts); the page shows the room's
 * name and labels, where it runs (its country, in words) and how full it is, never who's in it. Join is
 * an ordinary room link, so the game decides what happens next, as with invites.
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
 * The Rooms section's contents, also sent on its own to refresh it (into #rooms-list): the region switch and label filters, the rooms as
 * list rows (the first ten, the rest hidden until Show all), and what's past them. Its first element carries what the page's script reads:
 * data-count (the number by Rooms), data-playing (for "playing now") and data-shown (the region and labels it shows). "Press Play and the
 * game finds you one" only for a game that joins players by itself (isQuickJoining).
 */
export function roomsPanel(game: Pick<Game, "slug" | "quick_joined_at_ms">, list: RoomList, picked: Record<string, string> = {}, ticketPlayerCount = 0): Raw {
  const slug = game.slug;
  const open = list.rooms.filter((room) => room.isOpen);
  const { playerCount, closedRoomCount } = list.playing;
  const region = list.region ? list.regions.find((entry) => entry.region === list.region) : null;
  const items: LayoutItem[] = [];
  // Regions to pick from, once rooms run in more than one: each with how many rooms it has. The page's script reads data-region.
  if (list.regions.length > 1 || (list.region && list.regions.length)) {
    const tabs: SwitchTab[] = [
      { label: "All", isCurrent: !list.region, extra: html` data-region=""` },
      ...list.regions.map((entry) => ({ label: entry.name, badgeCount: entry.roomCount, isCurrent: list.region === entry.region, extra: html` data-region="${entry.region}"` })),
    ];
    items.push({ kind: "control", markup: tabSwitch({ label: "Region", switchSize: "small", isFramed: true, tabs }) });
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
  const filtered = Object.keys(picked).length > 0;
  const hiddenRoomCount = open.length - FIRST_ROOM_COUNT;
  const empty = filtered
    ? "No open rooms like that right now. Pick something else, or press Play to start."
    : region || list.region
      ? `No open rooms in ${region?.name ?? "that region"} right now. Pick another region, or press Play to start.`
      : closedRoomCount
        ? "Every room is in a match that isn't taking new players. Press Play to start a new one."
        : "Nobody's in an open room right now. Press Play to start.";
  items.push(
    open.length
      ? { kind: "block", markup: listRows({ id: "rooms-rows", label: "Open rooms", rows: open.map((room, roomIndex) => roomRow(slug, room, roomIndex >= FIRST_ROOM_COUNT)) }) }
      : { kind: "block", markup: emptyState({ title: "No open rooms", text: empty }) },
  );
  // Show all: the page's script shows the hidden rows (#rooms-rows > li[hidden]) and hides this.
  if (hiddenRoomCount > 0) items.push({ kind: "control", id: "rooms-all", markup: textButton(`Show ${plural(hiddenRoomCount, "more room", "more rooms")}`, { type: "button", icon: "chevron-down" }) });
  const notes = [
    list.moreOpenRoomCount > 0 ? `And ${plural(list.moreOpenRoomCount, "more room", "more rooms")} with fewer players.${isQuickJoining(game) ? " Press Play and the game finds you one." : ""}` : "",
    closedRoomCount && open.length ? `Plus ${plural(closedRoomCount, "match", "matches")} in progress that ${closedRoomCount === 1 ? "isn't" : "aren't"} taking new players.` : "",
  ].filter(Boolean);
  if (notes.length) items.push({ kind: "words", markup: readingText({ markup: html`${notes.map((note) => html`<p>${note}</p>`)}` }) });
  return stack({ items, dataAttributes: { count: String(tabCount(list)), playing: String(Math.max(playerCount, ticketPlayerCount)), shown: shownKey(list.region, picked) } });
}

/** Which region and labels a panel shows, so the page knows when to load another. */
export const shownKey = (region: string | null, picked: Record<string, string>) => `${region ?? ""}|${JSON.stringify(Object.entries(picked).sort())}`;

/**
 * A room's row: its name and labels (or how full it is, when it has neither), then how full, how many watch and where it runs, in words;
 * Join (or Full), Watch for a room that takes spectators, and Report for a room with a name or labels to report. The code stays in the links.
 */
function roomRow(slug: string, room: ListedRoom, isLater: boolean): ListRow {
  const filled = `${room.playerCount} of ${room.maximumPlayerCount} ${room.maximumPlayerCount === 1 ? "player" : "players"}`;
  const { name, labels } = shownText(room);
  const labelValues = labels.map(([, labelValue]) => labelValue);
  const title = [name, ...labelValues].filter(Boolean).join(" · ") || filled;
  const detail = [title === filled ? "" : filled, room.spectatorCount > 0 ? `${room.spectatorCount} watching` : "", room.location?.countryName ?? ""].filter(Boolean).join(" · ");
  const said = [name, labelValues.join(", ")].filter(Boolean).join(", ");
  const actions: ControlMarkup[] = [
    ...(hasSpace(room) ? [cutButton("Join", { href: `/g/${slug}?room=${room.roomCode}`, isSmall: true })] : []),
    ...(hasWatchSpace(room) ? [cutButton("Watch", { href: `/g/${slug}?room=${room.roomCode}&watch=1`, isSmall: true })] : []),
    // The page's script (report.ts) opens the report with the room's code and what it's called.
    ...(said ? [cutButton(`Report the room “${said}”`, { type: "button", icon: "flag", isLabelHidden: true, isSmall: true, dataAttributes: { "report-room": room.roomCode, "room-name": said } })] : []),
  ];
  return { title, detail: detail || undefined, end: hasSpace(room) ? undefined : "Full", action: actions.length > 1 ? actions : actions[0], isHidden: isLater || undefined };
}

/** A box for a room code a friend shared. It opens the same room link an invite does. The page's script reads #room-code. */
export function codeBox(slug: string): Raw {
  const field = cutField({ id: "room-code", name: "room", label: "Have a room code?", type: "text", placeholder: "ABC234", autocomplete: "off", pattern: "[2-9A-HJ-NP-Za-hj-np-z]{6}", isRequired: true });
  return html`<form method="get" action="/g/${slug}">${row({ widths: "lead-fills", items: [{ kind: "control", markup: field }, { kind: "control", markup: cutButton("Join", { type: "submit" }) }] })}</form>`;
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
