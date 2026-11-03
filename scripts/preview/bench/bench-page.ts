import { html, layout, pageData, type Raw } from "../../../apps/site/src/html.ts";
import type { Env } from "../../../apps/site/src/env.ts";
import { secondaryButton, toggleButton } from "../../../apps/site/src/components/actions.ts";
import { dropdown, sheet, type DropdownItem } from "../../../apps/site/src/components/panes.ts";
import { stackOfOne } from "../../../apps/site/src/components/layout.ts";
import { slider } from "../../../apps/site/src/components/inputs.ts";
import { qrCode } from "../../../apps/site/src/components/qr-code.ts";
import { searchField } from "../../../apps/site/src/components/fields.ts";
import { benchLayout, benchScreen, BENCH_SCREENS } from "../../../apps/site/src/components/screens.ts";
import { BENCH_PLACES, PROFILE_WORDS, readyStates, type StateKind } from "./places.ts";

const STATE_GROUPS: { stateKind: StateKind; title: string }[] = [
  { stateKind: "arrives", title: "Arrive by themselves" },
  { stateKind: "opened", title: "Opened by the player" },
];
const tiny = { type: "button", isTiny: true } as const;

/** Each place's buttons, shown only while you're there and can see them (bench-script.js). */
const stateButtons = (): Raw => html`${STATE_GROUPS.map(({ stateKind, title }) => html`<section class="bench-group" data-state-group="${stateKind}" hidden><h2 class="bench-group-name">${title}</h2><div class="bench-buttons">${
  readyStates().filter((state) => state.stateKind === stateKind).map((state) => toggleButton(state.label, { ...tiny, isPressed: false, isHidden: true, dataAttributes: { "bench-state": `${state.placeValue}/${state.stateValue}` } }))
}</div></section>`)}`;

interface Profiles { prepared: { username: string; about: string }[]; test_accounts: { username: string }[] }

const profileItems = (profiles: Profiles): DropdownItem[] => [
  { label: "Guest · nobody signed in", isButton: true, dataAttributes: { "bench-profile": "guest" } },
  ...(profiles.prepared.length ? [{ kind: "rule" as const }] : []),
  ...profiles.prepared.map(({ username, about }) => ({ label: `${username} · ${about}`, isButton: true, dataAttributes: { "bench-profile": username, "bench-prepared": "true" } })),
  { kind: "rule" as const },
  ...profiles.test_accounts.map(({ username }) => ({ label: `${username} · ${PROFILE_WORDS[username] ?? "a test account"}`, isButton: true, dataAttributes: { "bench-profile": username } })),
];

/** The find box's list: every state, place and profile in Zaisma, filtered as you type. */
const findItems = (profiles: Profiles): DropdownItem[] => [
  ...readyStates().map((state) => ({ label: `${state.label} · ${BENCH_PLACES.find((place) => place.placeValue === state.placeValue)!.name}`, isButton: true, dataAttributes: { "bench-find-state": `${state.placeValue}/${state.stateValue}` } })),
  ...BENCH_PLACES.map((place) => ({ label: `${place.name} · a place`, isButton: true, dataAttributes: { "bench-find-place": place.placeValue } })),
  ...[{ username: "guest" }, ...profiles.prepared, ...profiles.test_accounts].map(({ username }) => ({ label: `${username === "guest" ? "Guest" : username} · a profile`, isButton: true, dataAttributes: { "bench-find-profile": username } })),
];

/** GET /design/screens: the bench. ?place=&profile=&state= opens it there (what a session sends), and ?page=<path> any other page. */
export function benchPage(env: Env, url: URL, profiles: Profiles, phoneOrigin: string): Response {
  const rail = html`${searchField({ id: "bench-find", name: "find", action: "#", searchText: "", label: "Find a state, place or profile", placeholder: "Find, or a /address" })}
${dropdown({ id: "bench-find-list", label: "What it finds", items: findItems(profiles) })}
<div class="bench-menus">${secondaryButton("Home", { ...tiny, controls: "bench-places", isExpanded: false, dataAttributes: { "bench-place-button": "" } })}${secondaryButton("Guest", { ...tiny, controls: "bench-profiles", isExpanded: false, dataAttributes: { "bench-profile-button": "" } })}</div>
${dropdown({ id: "bench-places", label: "Places", items: BENCH_PLACES.map((place) => ({ label: place.name, isButton: true, dataAttributes: { "bench-place": place.placeValue } })) })}
${dropdown({ id: "bench-profiles", label: "Profiles", items: profileItems(profiles) })}
<div class="bench-seen"><span class="bench-group-name" data-bench-seen-count>Seen 0 of 0</span>${toggleButton("Not seen yet", { ...tiny, isPressed: false, dataAttributes: { "bench-seen": "" } })}</div>
${stateButtons()}
<div class="bench-rail-foot"><p class="bench-note">Tap a screen to open it. Buttons and links in it press as usual.</p>${secondaryButton("Gallery", { isTiny: true, href: "/design", icon: "chevron-back" })}</div>`;
  const tools = html`${secondaryButton("Replay", { ...tiny, dataAttributes: { "bench-replay": "" } })}${secondaryButton("Reset", { ...tiny, dataAttributes: { "bench-reset": "" } })}${toggleButton("Slow", { ...tiny, isPressed: false, dataAttributes: { "bench-slow": "" } })}${toggleButton("Dark", { ...tiny, isPressed: false, dataAttributes: { "bench-dark": "" } })}${secondaryButton("On my phone", { ...tiny, controls: "bench-on-phone", dataAttributes: { "bench-on-phone-button": "" } })}`;
  const phoneHeadEnd = toggleButton("Moving backgrounds", { ...tiny, icon: "image", isLabelHidden: true, isPressed: false, dataAttributes: { "bench-moving": "" } });
  const bigTools = html`${secondaryButton("Replay", { ...tiny, dataAttributes: { "bench-big-replay": "" } })}${secondaryButton("Reset", { ...tiny, dataAttributes: { "bench-reset": "" } })}${toggleButton("Slow", { ...tiny, isPressed: false, dataAttributes: { "bench-big-slow": "" } })}${slider({ id: "bench-big-scrub", name: "scrub", label: "Through the animation", minimumNumber: 0, maximumNumber: 100, stepNumber: 1, pickedNumber: 100, unit: "%" })}${toggleButton("Dark", { ...tiny, isPressed: false, dataAttributes: { "bench-big-dark": "" } })}${secondaryButton("Profile", { ...tiny, controls: "bench-big-profiles", isExpanded: false, dataAttributes: { "bench-big-profile-button": "" } })}${secondaryButton("Close", { ...tiny, dataAttributes: { "bench-big-close": "" } })}
${dropdown({ id: "bench-big-profiles", label: "This screen's profile", items: profileItems(profiles).map((item) => ("dataAttributes" in item && item.dataAttributes ? { ...item, dataAttributes: { "bench-big-profile": item.dataAttributes["bench-profile"]! } } : item)) })}`;
  const body = html`${benchLayout({ rail, tools, phoneHeadEnd, bigTools, screens: BENCH_SCREENS.map((screen) => benchScreen(screen)) })}
${sheet({ id: "bench-on-phone", title: "On my phone", isCompact: true, closeLabel: "Close", body: stackOfOne(qrCode({ id: "bench-qr", label: "QR code to this page on a phone", caption: "The same page, profile and state, on real hardware" })) })}
${pageData("bench-data", { places: BENCH_PLACES.map(({ placeValue, name, path, pathPattern, seenBy, profile }) => ({ placeValue, name, path, pathPattern, seenBy, profile })), states: readyStates(), asked: { placeValue: url.searchParams.get("place"), profile: url.searchParams.get("profile"), stateValue: url.searchParams.get("state"), page: url.searchParams.get("page") }, phoneOrigin })}
<script src="/__preview/bench/bench.js" defer></script>`;
  return layout(env, { title: "Screens · Design · Zaisma", body, isBare: true, stage: html``, checkedPage: "Screens", pageShape: "wide", frames: ["'self'"], isPrivate: true });
}
