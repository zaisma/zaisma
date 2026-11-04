import type { Game } from "@zaisma/core";
import type { Env } from "./env.ts";
import { blockSheet } from "./blocks.ts";
import { action, secondaryButton, primaryButton, toggleButton } from "./components/actions.ts";
import { listRows, pictureFrame, type ListRow } from "./components/data.ts";
import { icon } from "./components/foundations.ts";
import { stack, stackOfOne } from "./components/layout.ts";
import { saidCard } from "./components/layers.ts";
import { buySheet } from "./buy-sheet.ts";
import { gameScreens, standInGame, zaismaButton } from "./components/playing.ts";
import { friendAcceptedCard, friendRequestCard, friendRequestSheet } from "./friend-requests.ts";
import { STAND_IN_COVER_PICTURES } from "./generated/stand-in-placeholders.generated.ts";
import { linkAskSheet, linkClosedSheet } from "./game-links.ts";
import { html, layout, pageData, scriptTags, type Raw } from "./html.ts";
import { NO_EMPTY_NOTE } from "./markup.ts";
import { pageScript } from "./page-scripts.ts";
import { galleryPageName } from "./components/checked-pages.ts";
import { playingPeople, friendRequestRow, friendRows, type ListedFriend } from "./players-sheet.ts";
import { reportStep } from "./report.ts";
import { shareDialog } from "./share-cards.ts";
import { stillThereCard } from "./still-there.ts";
import { HINT_WORDS, ZAISMA_OVERLAY_SCRIPT, gameOverlay, keepProgressCard, rentedShareCard, roomCodeItems, signInAskCard, signedOutCard } from "./zaisma-overlay.ts";

/*
 * Over a game: everything of Zaisma's that shows over a running game, already showing, on real screen shapes, with nothing to play or trigger. Each state is a small real page (the frame below) from the
 * same components and the same overlay script as a game's page, in a frame the size of its screen, since the overlay's shape follows the screen it's on. Scaled down it would show the wrong layout.
 */

export const OVER_GAME_PATH = "/design/over-a-game";
const FRAME_PATH = `${OVER_GAME_PATH}/frame`;

/** What a state does once its frame has loaded. */
interface ShownState {
  isOverlayOpen?: boolean;
  tabValue?: string;
  stepName?: string;
  /** What's pressed, as a player would: Leave. */
  pressedIds?: string[];
  sheetId?: string;
  isFriendsTabHidden?: boolean;
  typingBarId?: string;
  popoverId?: string;
  shownIds?: string[];
  hiddenIds?: string[];
  words?: Record<string, string>;
  /** The Zaisma button down on a computer, as when pointed at. A touch screen always shows it. */
  isButtonPointed?: boolean;
  isButtonShown?: boolean;
  /** Notices that went by, in the Inbox. */
  hasMissedNotices?: boolean;
}

interface OverGameState {
  stateValue: string;
  title: string;
  shown: ShownState;
  /** The screens it shows on, where it isn't all of them: the hint is only for a mouse. */
  screenNames?: string[];
  /** Which moment of its sheet: a state a gallerySheet declares. Left out, its usual one. */
  sheetState?: string;
  card?: "hint" | "keep" | "sign-in" | "rented-share" | "friend-request" | "friends-now" | "still-there" | "saved";
  isPlayedAlone?: boolean;
  isGuest?: boolean;
  isLongRoom?: boolean;
}

const IN_ROOM: ShownState = { shownIds: ["room-here", "room-code-shown"], words: { "room-code-text": "K7PQ2M" } };

const OVER_GAME_PARTS: { partValue: string; states: OverGameState[] }[] = [
  {
    partValue: "zaisma-button",
    states: [
      { stateValue: "playing", title: "Playing: on a computer the game has the screen; a touch screen keeps the Zaisma button", shown: {} },
      { stateValue: "button-pointed", title: "The Zaisma button, pointed at", shown: { isButtonPointed: true } },
    ],
  },
  {
    partValue: "zaisma-overlay",
    states: [
      { stateValue: "room", title: "Room", shown: { ...IN_ROOM, isOverlayOpen: true } },
      { stateValue: "room-long", title: "Room, with a long list", isLongRoom: true, shown: { ...IN_ROOM, isOverlayOpen: true, shownIds: [...(IN_ROOM.shownIds ?? []), "players-find"] } },
      { stateValue: "played-alone", title: "A game played alone: it opens on This game, with no Room", isPlayedAlone: true, shown: { isOverlayOpen: true } },
      { stateValue: "friends-alone", title: "Friends, in a game played alone: all of them, nearest first", isPlayedAlone: true, shown: { isOverlayOpen: true, tabValue: "friends", shownIds: ["players-friends", "players-friends-all"] } },
      { stateValue: "player", title: "A player's choices", shown: { ...IN_ROOM, isOverlayOpen: true, stepName: "player", shownIds: ["players-player-profile-row", "players-player-friend-row"], words: { "players-player-title": "Leo_Marsh" } } },
      { stateValue: "player-request-sent", title: "A player's choices, with a friend request sent", shown: { ...IN_ROOM, isOverlayOpen: true, stepName: "player", shownIds: ["players-player-profile-row", "players-player-sent-row"], words: { "players-player-title": "Leo_Marsh" } } },
      { stateValue: "report", title: "Reporting a player", shown: { isOverlayOpen: true, stepName: "report", shownIds: ["report-reasons-player"], hiddenIds: ["report-reasons-game", "report-notices"], words: { "report-sub": "In room K7PQ2M. We don't record who you are." } } },
      { stateValue: "friends", title: "Friends, with requests waiting", shown: { isOverlayOpen: true, tabValue: "friends", shownIds: ["players-friends", "players-friends-all"] } },
      { stateValue: "typing-sideways", title: "Typing on a phone on its side: the field rises above the keyboard", shown: { ...IN_ROOM, isOverlayOpen: true, typingBarId: "bar-join-code" }, screenNames: ["phone-sideways"] },
      { stateValue: "room-guest", title: "Room, as a guest: no Friends tab", isGuest: true, shown: { ...IN_ROOM, isOverlayOpen: true, isFriendsTabHidden: true } },
      { stateValue: "this-game", title: "This game", shown: { isOverlayOpen: true, tabValue: "game", shownIds: ["save-line"], words: { "save-line": "Saved 2 min ago" } } },
      { stateValue: "this-game-guest", title: "This game, as a guest", isGuest: true, shown: { isOverlayOpen: true, tabValue: "game", shownIds: ["keep-link-row"], isFriendsTabHidden: true } },
      { stateValue: "inbox", title: "Inbox, with nothing missed", shown: { isOverlayOpen: true, tabValue: "inbox" } },
      { stateValue: "inbox-missed", title: "Inbox, with notices that went by", shown: { isOverlayOpen: true, tabValue: "inbox", hasMissedNotices: true } },
      { stateValue: "full-screen-iphone", title: "Full screen on an iPhone: the way to the Home Screen", shown: { isOverlayOpen: true, sheetId: "full-screen-sheet" }, screenNames: ["phone", "phone-sideways"] },
      { stateValue: "leave", title: "Leaving", shown: { isOverlayOpen: true, pressedIds: ["zaisma-leave"] } },
    ],
  },
  {
    partValue: "notices",
    states: [
      { stateValue: "hint", title: "The hint when play starts, on a computer: the Zaisma button shows itself", shown: { isButtonShown: true }, card: "hint", screenNames: ["computer"] },
      { stateValue: "keep", title: "Keep your progress", shown: {}, card: "keep" },
      { stateValue: "sign-in", title: "A game asking a guest to sign in", shown: {}, card: "sign-in" },
      { stateValue: "rented-share", title: "A game's rented share used, on a network that looks like a server", shown: {}, card: "rented-share" },
      { stateValue: "friend-request", title: "A friend request coming in", shown: { words: { "friend-request-card-name": "Mia_Plays" } }, card: "friend-request" },
      { stateValue: "friends-now", title: "A request accepted", shown: { words: { "friend-accepted-name": "Mia_Plays" } }, card: "friends-now" },
      { stateValue: "still-there", title: "The away timer", shown: {}, card: "still-there" },
      { stateValue: "saved", title: "Saved", shown: {}, card: "saved" },
      { stateValue: "signed-out", title: "Urgent: signed out while playing", shown: { popoverId: "signed-out" } },
    ],
  },
  {
    partValue: "sheets",
    states: [
      { stateValue: "block", title: "Confirming a block", shown: { sheetId: "block" } },
      { stateValue: "block-friend", title: "Confirming a block, of a friend", shown: { sheetId: "block" }, sheetState: "friend" },
      { stateValue: "friend-confirm", title: "Confirming a friend request", shown: { sheetId: "friend-request" } },
      { stateValue: "invite", title: "Invite: a room's code, link and QR code", shown: { sheetId: "share-dialog" }, sheetState: "invite" },
      { stateValue: "share", title: "Share: a game with no room", shown: { sheetId: "share-dialog" }, sheetState: "share" },
      { stateValue: "leaving-zaisma", title: "Leaving Zaisma for a game's link", shown: { sheetId: "link-ask" } },
      { stateValue: "buy", title: "Buying, one press", shown: { sheetId: "buy-sheet" }, sheetState: "one-press" },
      { stateValue: "buy-first-card", title: "Buying, a first card", shown: { sheetId: "buy-sheet" }, sheetState: "first-card" },
      { stateValue: "buy-guest", title: "Buying, as a guest", shown: { sheetId: "buy-sheet" }, sheetState: "guest" },
      { stateValue: "buy-declined", title: "Buying, declined", shown: { sheetId: "buy-sheet" }, sheetState: "declined" },
      { stateValue: "buy-bought", title: "Bought", shown: { sheetId: "buy-sheet" }, sheetState: "bought" },
    ],
  },
];

const ALL_STATES = OVER_GAME_PARTS.flatMap((part) => part.states);
const GAME_TITLE = "Neon Drift";
const STAND_IN_GAME = { title: GAME_TITLE, slug: "neon-drift" } as Game;

const player = (name: string, detail?: string, isFriend = false): ListRow => ({ lead: pictureFrame(name, "sm"), title: name, detail, press: {}, titleIcon: { icon: "friends", label: "Friend", isHidden: !isFriend }, action: toggleButton(action("mute", detail === "Muted" ? "Unmute" : "Mute"), { type: "button", isSmall: true, isLabelHidden: true, isPressed: detail === "Muted", isQuietWhenOff: true, dataAttributes: { "player-mute": "" } }) });
const FEW_PLAYERS = [player("Emma_Reyes", undefined, true), player("Leo_Marsh"), player("Noah_Berg", "Muted"), player("Sofia_Klein")];
const MANY_PLAYERS = [...FEW_PLAYERS, ...["Mia_Plays", "Liam_Fox", "Ava_Stone", "Lucas_Hale", "Ella_Moss", "Oscar_Lund", "Nora_Vance", "Hugo_Park", "Clara_Wren", "Felix_Nash", "Ida_Ross", "Max_Weber"].map((name) => player(name))];
const REQUEST_BUTTON = { type: "button", isSmall: true } as const;
const OFFLINE_FRIENDS: ListedFriend[] = [{ username: "Oscar_Lund", statusWords: "Offline", isAway: true }, { username: "Nora_Vance", statusWords: "Offline", isAway: true }];
const FRIENDS_IN_ROOM: ListedFriend[] = [
  { username: "Emma_Reyes", statusWords: "In your room" },
  { username: "Liam_Fox", statusWords: "In another room", door: { player_id: "player_liam", username: "Liam_Fox", room_code: "K7PQ2M", server_url: null, join_refusal: null, watch: null } },
  { username: "Ava_Stone", statusWords: "Playing Cave Crew" },
  { username: "Mia_Plays", statusWords: "Online" },
  ...OFFLINE_FRIENDS,
];
const FRIENDS_WHEN_ALONE: ListedFriend[] = [{ username: "Emma_Reyes", statusWords: "Playing this game" }, { username: "Ava_Stone", statusWords: "Playing Cave Crew" }, { username: "Mia_Plays", statusWords: "Online" }, ...OFFLINE_FRIENDS];

/** The first part of a frame's script: the page is a game's while it plays, before the overlay's script looks, so it says no hint of its own. */
const FRAME_START_SCRIPT = pageScript("over-a-game-start", `document.documentElement.classList.add("is-playing");
const overGame = JSON.parse(document.getElementById("over-a-game-data").textContent);
document.documentElement.setAttribute("data-theme-choice", overGame.theme);
document.documentElement.setAttribute("data-theme", overGame.theme);`);

/** The rest: it does what a player or a game would have, so the state shows by itself. */
const FRAME_SHOW_SCRIPT = pageScript("over-a-game-show", `(function showWhenReady() {
  if (!window.zaismaLayers) return setTimeout(showWhenReady, 50);
  // Nothing in a frame takes the focus from the page around it as its sheets open: what's inert can't hold it, and a frame is only looked at.
  document.body.inert = true;
  document.querySelectorAll("dialog").forEach((sheet) => { sheet.inert = true; });
  const $ = (id) => document.getElementById(id);
  const shown = overGame.shown;
  const corner = $("zaisma-button");
  corner.showPopover();
  if (shown.isButtonPointed || shown.isButtonShown || overGame.isTouchScreen) corner.classList.add("is-shown");
  if (shown.isButtonPointed) corner.classList.add("is-pointed");
  Object.entries(shown.words || {}).forEach(([id, words]) => { const el = $(id); if (el) el.textContent = words; });
  (shown.shownIds || []).forEach((id) => { const el = id.endsWith("-row") ? $(id.slice(0, -4)) : $(id); if (el) (id.endsWith("-row") ? el.closest("li") : el).hidden = false; });
  (shown.hiddenIds || []).forEach((id) => { const el = $(id); if (el) el.hidden = true; });
  if (shown.hasMissedNotices) [["", "Mia_Plays joined the room."], ["", "Saved to your account."], ["keep", "Your progress is only saved in this browser."]].forEach(([id, words]) => {
    const card = document.createElement("aside");
    card.className = "playing-card";
    card.id = id;
    card.innerHTML = "<div class='playing-card-in'><p></p>" + (id ? "<button></button>" : "") + "</div>";
    card.querySelector("p").textContent = words;
    dispatchEvent(new CustomEvent("zaisma:card-left", { detail: { card } }));
  });
  const sheet = $("players");
  if (shown.isFriendsTabHidden) sheet.querySelector('[data-sheet-tab-to="friends"]').hidden = true;
  if (shown.isOverlayOpen) $("zaisma-open").click();
  if (shown.tabValue) sheet.querySelector('[data-sheet-tab-to="' + shown.tabValue + '"]').click();
  if (shown.stepName) zaismaLayers.step(sheet, shown.stepName);
  // No game answers here, so a player's Mute flips on its own.
  document.addEventListener("click", (event) => { const mute = event.target.closest("[data-player-mute]"); if (mute) mute.setAttribute("aria-pressed", mute.getAttribute("aria-pressed") === "true" ? "false" : "true"); });
  (shown.pressedIds || []).forEach((id) => $(id).click());
  if (shown.sheetId) $(shown.sheetId).showModal();
  if (shown.popoverId) $(shown.popoverId).showPopover();
  if (shown.typingBarId) { const typed = $(shown.typingBarId); typed.focus({ preventScroll: true }); window.zaismaTypingBar.lift(typed); }
})();`);

function cardOf(state: OverGameState): Raw | string {
  const accountCard = { title: GAME_TITLE, joinHref: "#", signInHref: "#", isShown: true };
  switch (state.card) {
    case "hint": return saidCard("over-a-game-card", HINT_WORDS, true);
    case "keep": return keepProgressCard(accountCard);
    case "sign-in": return signInAskCard(accountCard);
    case "rented-share": return rentedShareCard("#", true);
    case "friend-request": return friendRequestCard(true);
    case "friends-now": return friendAcceptedCard(true);
    case "still-there": return stillThereCard(true);
    case "saved": return saidCard("over-a-game-card", "Saved to your account.", true);
    default: return "";
  }
}

/** GET /design/over-a-game/frame?state=&screen=&theme=: one state over the stand-in game. */
export function overGameFrame(env: Env, url: URL): Response | null {
  const state = ALL_STATES.find((each) => each.stateValue === url.searchParams.get("state"));
  if (!state) return null;
  const screenName = url.searchParams.get("screen");
  const people = playingPeople({
    gameOrigin: "https://games.zaisma.test",
    slug: STAND_IN_GAME.slug,
    title: GAME_TITLE,
    hasZaismaRooms: !state.isPlayedAlone,
    isPlayedAlone: Boolean(state.isPlayedAlone),
    canSignIn: true,
    signInPath: "#",
    roomItems: state.isPlayedAlone ? [] : roomCodeItems(),
    shownPlayers: state.isPlayedAlone ? [] : state.isLongRoom ? MANY_PLAYERS : FEW_PLAYERS,
    shownFriends: friendRows("neon-drift", state.isPlayedAlone ? FRIENDS_WHEN_ALONE : FRIENDS_IN_ROOM, state.isPlayedAlone ? [] : [friendRequestRow("Clara_Wren", true), friendRequestRow("Hugo_Park", false)]),
  });
  const gameBody = stack({ items: [
    { kind: "words", markup: html`<p id="save-line" hidden></p>` },
    { kind: "block", markup: listRows({ whenEmpty: NO_EMPTY_NOTE, isCompact: true, label: GAME_TITLE, rows: [
      { id: "keep-link", isHidden: true, title: "Keep your progress", lead: icon("save"), href: "#" },
      { title: "Report this game", lead: icon("flag"), href: "#" },
      { title: "Content rules", lead: icon("rules"), href: "#", isNewTab: true },
    ] }) },
  ] });
  const body = html`<main>${zaismaButton()}
${gameOverlay({ title: GAME_TITLE, people, gameBody, reportStep: reportStep(STAND_IN_GAME, { isMultiplayer: !state.isPlayedAlone }), isPlayedAlone: Boolean(state.isPlayedAlone) })}
${people.templates}
${shareDialog.inState(state.sheetState)}
${linkAskSheet.inState()}
${linkClosedSheet.inState()}
${blockSheet.inState(state.sheetState)}
${friendRequestSheet.inState(state.sheetState)}
${buySheet.inState(state.sheetState)}
${signedOutCard("#")}
${cardOf(state)}
${pageData("over-a-game-data", { shown: state.shown, isTouchScreen: screenName !== "computer", theme: url.searchParams.get("theme") === "dark" ? "dark" : "light" })}
${scriptTags(FRAME_START_SCRIPT, ZAISMA_OVERLAY_SCRIPT, FRAME_SHOW_SCRIPT)}</main>
${standInGame()}`;
  return layout(env, { title: `${state.title} · Over a game · Design · Zaisma`, body, isBare: true, stage: html``, isFramedBySelf: true, pageShape: "full", checkedPage: galleryPageName({ group: "over-a-game", subgroup: OVER_GAME_PARTS.find((part) => part.states.includes(state))!.partValue }) });
}

/** Each frame loads as it comes near the window, so the page's hundred frames never run at once. */
export const OVER_GAME_SCRIPT = pageScript("over-a-game", `(() => {
  const near = new IntersectionObserver((seen) => seen.forEach((each) => {
    if (!each.isIntersecting) return;
    near.unobserve(each.target);
    each.target.src = each.target.dataset.frameSrc;
  }), { rootMargin: "400px" });
  document.querySelectorAll("iframe[data-frame-src]").forEach((frame) => near.observe(frame));
})();`);

/** What a part's page of the gallery shows after its components: each state a Tray, on its four screens, loading as they're scrolled to. */
export function overGameStates(subgroup: string | undefined, theme: "light" | "dark"): Raw {
  const part = OVER_GAME_PARTS.find((each) => each.partValue === subgroup);
  return html`${part?.states.map((state) => html`<div class="component-section" id="${state.stateValue}" data-rail-mark="${state.title.split(":")[0]}">${gameScreens({ title: state.title, framePath: `${FRAME_PATH}?state=${state.stateValue}&theme=${theme}`, screenNames: state.screenNames })}</div>`) ?? ""}`;
}

export const OVER_GAME_STATE_COUNT = ALL_STATES.length;
