// The test bench's page in Glass (bin/local-play.js serves it): the site's own components, layout and buy sheet, taken from apps/site's
// source when the package is built (scripts/bench.mjs bundles this file) and when the repository runs the bench, so the bench is never a
// copy of the design that can go stale. The page is the game page as a player plays on it: the playing bar beside the game, with the bench's
// own buttons in it, and the real buy sheet, whose calls the bench stands in for. Nothing here runs in a game or on Zaisma's servers.
import { html, layout, scriptTags, type Raw } from "../../../apps/site/src/html.ts";
import type { Env } from "../../../apps/site/src/env.ts";
import { pageScriptResponse } from "../../../apps/site/src/page-scripts.ts";
import { pageStyleResponse } from "../../../apps/site/src/page-styles.ts";
import { BUY_SHEET_SCRIPT, buySheet, buySheetData } from "../../../apps/site/src/buy-sheet.ts";
import { playingBar } from "../../../apps/site/src/components/playing.ts";
import { cutButton, textButton } from "../../../apps/site/src/components/actions.ts";
import { dropdown, sheet } from "../../../apps/site/src/components/panes.ts";
import { checkField, selectField } from "../../../apps/site/src/components/choices.ts";
import { codeField, qrCode } from "../../../apps/site/src/components/inputs.ts";
import { cutField } from "../../../apps/site/src/components/fields.ts";
import { emptyState, listRows } from "../../../apps/site/src/components/data.ts";
import { row, stack, type LayoutItem } from "../../../apps/site/src/components/layout.ts";

/** What the bench knows when it draws a tab's page or one of its sheets. */
export interface BenchView {
  gameSlug: string;
  /** The tab's player number, 0 before the page has given it one. */
  playerNumber: number;
  /** Who the tab plays as: "guest" or an account's id. */
  playingAs: string;
  accounts: { id: string; username: string; whoCanChat: string }[];
  friends: [string, string][];
  blocks: { blocker: string; blocked: string }[];
  items: { itemName: string; title: string; itemKind: string; priceText: string }[];
  ownedItems: Record<string, string[]>;
  purchaseDelivery: string;
  nextPlayerNumber: number;
  /** The room the tab is in, its link and who's in it; null when it's in none. */
  room: { code: string; link: string; playerNames: string[] } | null;
  /** The bench's address for a phone on the same Wi-Fi, null when it answers only on this computer. */
  networkUrl: string | null;
  /** What the bench said, newest last: "Only on Zaisma" lines, once each. */
  logLines: string[];
}

/** The frame's sandbox and permissions, the game page's (local-play-bench.js holds them to apps/site/src/pages.ts). */
export interface FrameAttributes {
  sandbox: string;
  allow: string;
}

// layout() reads a few of the site Worker's settings; the bench is none of them, so these keep it to the page alone.
const BENCH_ENV = { SITE_ORIGIN: "http://localhost", GAME_ORIGIN: "http://localhost", ROOMS_ORIGIN: "http://localhost", GAME_HOST_MODE: "path", GAME_DOMAIN: "" } as unknown as Env;

const nameOf = (view: BenchView, id: string) => view.accounts.find((account) => account.id === id)?.username ?? id;
const playingName = (view: BenchView) => (view.playingAs === "guest" ? "Guest" : nameOf(view, view.playingAs));

/** The page for a tab: the game page while playing, with the bench's buttons in its bar. */
export async function benchPageHtml(view: BenchView, frame: FrameAttributes): Promise<string> {
  const controls = [
    cutButton(playingName(view), { id: "bench-who", type: "button", icon: "person", isSmall: true, controls: "bench-who-menu", isExpanded: false }),
    cutButton("Add a player", { id: "bench-add", href: view.room ? `/?room=${view.room.code}` : "/", icon: "plus", isLabelHidden: true, isSmall: true }),
    cutButton("Friends and blocks", { id: "bench-friends-open", type: "button", icon: "friends", isLabelHidden: true, isSmall: true, controls: "bench-friends" }),
    cutButton("Items", { id: "bench-items-open", type: "button", icon: "card", isLabelHidden: true, isSmall: true, controls: "bench-items" }),
    // The room's code, as the game page's bar shows it once the player is in one.
    cutButton(view.room ? view.room.code : "Room", { id: "bench-room-open", type: "button", icon: "hash", isSmall: true, controls: "bench-room" }),
    cutButton("Phone", { id: "bench-phone-open", type: "button", icon: "phone", isLabelHidden: true, isSmall: true, controls: "bench-phone" }),
    cutButton("Log", { id: "bench-log-open", type: "button", icon: "info", isLabelHidden: true, isSmall: true, controls: "bench-log", reactionCount: view.logLines.length }),
  ];
  const whoMenu = dropdown({
    id: "bench-who-menu",
    label: "Play as",
    head: { title: view.playerNumber ? `Player ${view.playerNumber}` : "This tab", note: "Who this tab plays as. The game starts again as them." },
    items: [
      { label: "Guest", href: "#", icon: "person", isCurrent: view.playingAs === "guest", dataAttributes: { "bench-as": "guest" } },
      ...view.accounts.map((account) => ({ label: account.username, href: "#", icon: "person" as const, isCurrent: view.playingAs === account.id, dataAttributes: { "bench-as": account.id } })),
    ],
  });
  const benchSheet = (id: string, title: string, name: SheetName) => sheet({ id, title, closeLabel: "Close", placement: "foot", isCompact: true, body: html`<div id="${id}-body">${sheetMarkup(name, view)}</div>` });
  // As on the game page: the bar, menus and sheets in <main>, the game's frame beside it in the body (the playing styles show those alone).
  const body = html`<main>${playingBar({ title: `${view.gameSlug}: test bench`, controls })}
${whoMenu}
${benchSheet("bench-friends", "Friends and blocks", "friends")}
${benchSheet("bench-items", "Items", "items")}
${benchSheet("bench-room", "Room", "room")}
${benchSheet("bench-phone", "Open it on a phone", "phone")}
${benchSheet("bench-log", "Log", "log")}
${buySheet({ joinHref: "#", signInHref: "#", coverUrl: null })}
${buySheetData({ slug: view.gameSlug, tester_token: null, place: "game_page", stripe_mode: "stand_in", stripe_publishable_key: null, is_preview: false, asked: null, opener_origin: null })}</main>
<iframe class="game-frame" id="game" title="${view.gameSlug}" sandbox="${frame.sandbox}" allow="${frame.allow}" allowfullscreen referrerpolicy="no-referrer"></iframe>
<script src="/bench/frame.js" defer></script>
${scriptTags(BUY_SHEET_SCRIPT)}
<script src="/bench/bench.js" defer></script>`;
  const page = await layout(BENCH_ENV, { title: `Player ${view.playerNumber || ""}: test bench for ${view.gameSlug}`.replace("Player : ", ""), checkedPage: "Game page", isBare: true, body }).text();
  // Playing from the start: the page shows the bar and the game, as the game page does once Play is pressed.
  return page.replace("<html lang=\"en\"", "<html lang=\"en\" class=\"is-playing\"");
}

export type SheetName = "friends" | "items" | "room" | "phone" | "log";

/** One of the bench's sheets, drawn afresh from the bench's state each time it opens or changes. */
export function benchSheetBody(name: SheetName, view: BenchView): string {
  return String(sheetMarkup(name, view));
}

function sheetMarkup(name: SheetName, view: BenchView): Raw {
  const words = (text: string): LayoutItem => ({ kind: "words", markup: html`<p>${text}</p>` });
  if (name === "friends") {
    const items: LayoutItem[] = [words("Between the bench's made-up accounts. A game sees only what Zaisma gives it: each account's pass lists its friends and blocks as player tags, never names.")];
    const me = view.accounts.find((account) => account.id === view.playingAs);
    if (me) {
      items.push({
        kind: "control",
        markup: selectField({ name: "bench-chat", id: "bench-chat", label: `${me.username} lets chat with`, pickedValue: me.whoCanChat, dataAttributes: { "bench-account": me.id }, choices: [{ choiceValue: "nobody", label: "Nobody" }, { choiceValue: "friends", label: "Friends" }, { choiceValue: "anyone", label: "Anyone" }] }),
      });
    }
    view.accounts.forEach((first, firstIndex) => {
      for (const second of view.accounts.slice(firstIndex + 1)) {
        const isFriend = view.friends.some((pair) => pair.includes(first.id) && pair.includes(second.id));
        const blocks = (blocker: string, blocked: string) => view.blocks.some((block) => block.blocker === blocker && block.blocked === blocked);
        items.push({ kind: "words", markup: html`<h3>${first.username} and ${second.username}</h3>` });
        items.push({ kind: "block", markup: checkField({ name: "bench-friend", id: `bench-friend-${first.id}-${second.id}`, checkValue: `${first.id}:${second.id}`, label: "Friends", isChecked: isFriend }) });
        items.push({ kind: "block", markup: checkField({ name: "bench-block", id: `bench-block-${first.id}-${second.id}`, checkValue: `${first.id}:${second.id}`, label: `${first.username} blocks ${second.username}`, isChecked: blocks(first.id, second.id) }) });
        items.push({ kind: "block", markup: checkField({ name: "bench-block", id: `bench-block-${second.id}-${first.id}`, checkValue: `${second.id}:${first.id}`, label: `${second.username} blocks ${first.username}`, isChecked: blocks(second.id, first.id) }) });
      }
    });
    items.push(words("A pass is made when a player joins: reload a player's game, or leave and join the room again, to bring a change into it."));
    return stack({ items });
  }
  if (name === "items") {
    const items: LayoutItem[] = [words(view.purchaseDelivery === "game_server" ? "Purchases go to your game server's onPurchase." : "Purchases come to the game's Zaisma.items events.")];
    if (!view.items.length) items.push({ kind: "block", markup: emptyState({ title: "No items yet", text: "Add one below. A game lists them with Zaisma.items.list() and opens the buy sheet with Zaisma.items.buy()." }) });
    for (const listedItem of view.items) {
      items.push({ kind: "words", markup: html`<h3>${listedItem.title}</h3><p>${listedItem.itemName}, ${listedItem.itemKind}, ${listedItem.priceText}</p>` });
      for (const account of view.accounts) {
        items.push({ kind: "block", markup: checkField({ name: "bench-owned", id: `bench-owned-${account.id}-${listedItem.itemName}`, checkValue: `${account.id}:${listedItem.itemName}`, label: `${account.username} owns it`, isChecked: (view.ownedItems[account.id] ?? []).includes(listedItem.itemName) }) });
      }
      items.push({ kind: "control", markup: textButton("Remove this item", { type: "button", name: "bench-remove-item", buttonValue: listedItem.itemName }) });
    }
    items.push({ kind: "words", markup: html`<h3>Add an item</h3>` });
    items.push({ kind: "control", markup: cutField({ name: "item_name", id: "bench-item-name", label: "Item name", type: "text", placeholder: "gold-board", autocomplete: "off" }) });
    items.push({ kind: "control", markup: cutField({ name: "title", id: "bench-item-title", label: "Title", type: "text", placeholder: "Gold board", autocomplete: "off" }) });
    items.push({
      kind: "block",
      markup: row({
        widths: "equal",
        items: [
          { kind: "control", markup: cutField({ name: "price", id: "bench-item-price", label: "Price in cents", type: "text", text: "199", autocomplete: "off" }) },
          { kind: "control", markup: selectField({ name: "item_kind", id: "bench-item-kind", label: "Kind", pickedValue: "permanent", choices: [{ choiceValue: "permanent", label: "Permanent" }, { choiceValue: "consumable", label: "Consumable" }] }) },
        ],
      }),
    });
    items.push({ kind: "control", markup: cutButton("Add the item", { id: "bench-item-add", type: "button" }) });
    return stack({ items });
  }
  if (name === "room") {
    if (!view.room) return stack({ items: [{ kind: "block", markup: emptyState({ title: "Not in a room", text: "Join or make a room in the game, and its link shows here." }) }] });
    return stack({
      items: [
        { kind: "block", markup: codeField({ label: "This room", code: view.room.code, id: "bench-room-code" }) },
        words("Anyone on this computer joins by opening this link, as the next player."),
        { kind: "block", markup: codeField({ label: "Room link", code: view.room.link, id: "bench-room-link" }) },
        { kind: "words", markup: html`<h3>In the room</h3><p>${view.room.playerNames.length ? view.room.playerNames.join(", ") : "Only you so far."}</p>` },
      ],
    });
  }
  if (name === "phone") {
    if (!view.networkUrl) return stack({ items: [words("The bench answers only on this computer. To play on a phone on the same Wi-Fi, stop it and start it again with --on-network.")] });
    return stack({
      items: [
        { kind: "block", markup: qrCode({ id: "bench-phone-qr", label: "The bench's address", caption: view.networkUrl, imageUrl: `/bench/qr.svg?text=${encodeURIComponent(view.networkUrl)}` }) },
        words("Over the home network the bench is plain http, so the camera, microphone and other features a browser allows only on secure pages won't work on the phone."),
      ],
    });
  }
  if (!view.logLines.length) return stack({ items: [{ kind: "block", markup: emptyState({ title: "Nothing yet", text: "What Zaisma does that the bench doesn't shows up here, once each." }) }] });
  return listRows({ label: "Log", rows: view.logLines.map((line) => ({ title: line })) });
}

/** The site's stylesheet, scripts and font by the paths the page names, or null for a path that isn't one of them. */
export async function siteAsset(path: string): Promise<{ httpStatus: number; headers: Record<string, string>; body: Uint8Array } | null> {
  for (const answer of [pageScriptResponse(path), pageStyleResponse(path)]) {
    if (answer.status === 404) continue;
    return { httpStatus: answer.status, headers: Object.fromEntries(answer.headers.entries()), body: new Uint8Array(await answer.arrayBuffer()) };
  }
  return null;
}
