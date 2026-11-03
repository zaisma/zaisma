import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHECKED_PAGES, STRESS_ACCOUNTS } from "../../apps/site/src/components/checked-pages.ts";
import { BENCH_PLACES, CHECKED_PAGES_NOT_ON_THE_BENCH, MAXIMUM_BUTTONS_IN_A_PLACE, MAXIMUM_BUTTON_LABEL_LENGTH, PROFILE_WORDS, readyStates, statesWithNoButton } from "../../scripts/preview/bench/places.ts";
// @ts-expect-error: a Node script with no types of its own.
import { MIRROR_WINDOW_MS, cookieHeaderFor, jarAfter, makeMirror, markOf, parseMark, withoutMarks } from "../../scripts/preview/bench/bench-server.mjs";
// @ts-expect-error: a Node script with no types of its own.
import { SAFE_AREA_PX, phoneMediaText, phoneSafeAreaText } from "../../scripts/preview/bench/phone-media.mjs";
// @ts-expect-error: a Node script with no types of its own.
import { MAXIMUM_SEEN_LOOKS, seenAfter } from "../../scripts/preview/bench/bench-files.mjs";
// @ts-expect-error: a Node script with no types of its own.
import { SIGN_INS } from "../../scripts/preview/sign-ins.mjs";

const filesUnder = (folder: string): string[] => readdirSync(folder).flatMap((name) => { const path = join(folder, name); return statSync(path).isDirectory() ? (name === "generated" || name === "node_modules" ? [] : filesUnder(path)) : [path]; });

describe("the Screens bench stays off zaisma.com", () => {
  it("production's entry is the site's own, and nothing the site is built from reaches the preview's", () => {
    expect(readFileSync("apps/site/wrangler.jsonc", "utf8")).toMatch(/"main": "src\/index\.ts"/);
    for (const path of filesUnder("apps/site/src")) {
      const text = readFileSync(path, "utf8");
      expect(text, path).not.toMatch(/from "[^"]*scripts\/preview/);
      expect(text, path).not.toContain("/__preview/bench");
      expect(text, path).not.toContain("bench_screen");
    }
  });
  it("is only ever added by the preview's entry", () => {
    expect(readFileSync("scripts/preview/workers/site.mjs", "utf8")).toContain("withBench");
    for (const path of filesUnder("apps")) if (/\.(ts|mjs|js|jsonc?)$/.test(path)) expect(readFileSync(path, "utf8"), path).not.toContain("workers/site.mjs");
  });
});

describe("the bench's places and states", () => {
  const states = readyStates();
  it("hold no more buttons than a place's rail can show, with names that fit", () => {
    for (const place of BENCH_PLACES) {
      expect(place.states.length, place.name).toBeLessThanOrEqual(MAXIMUM_BUTTONS_IN_A_PLACE);
      for (const state of place.states) expect(state.label.length, state.label).toBeLessThanOrEqual(MAXIMUM_BUTTON_LABEL_LENGTH);
    }
  });
  it("give every state a value of its own, and only name accounts the preview has", () => {
    const usernames = (SIGN_INS as { username: string }[]).map((each) => each.username);
    expect(new Set(states.map((state) => `${state.placeValue}/${state.stateValue}`)).size).toBe(states.length);
    for (const state of states) if (state.profile) expect(usernames, state.label).toContain(state.profile);
    for (const username of usernames) expect(PROFILE_WORDS[username], username).toBeTruthy();
    for (const username of Object.keys(PROFILE_WORDS)) expect(usernames, username).toContain(username);
  });
  it("cover every page and state the layout check opens, or say why not", () => {
    const named = new Set<string>(BENCH_PLACES.flatMap((place) => place.states.flatMap((state) => ("checkedPage" in state ? [state.checkedPage] : []))));
    const placePaths = new Set(BENCH_PLACES.map((place) => place.path));
    const reasons = new Set<string>(CHECKED_PAGES_NOT_ON_THE_BENCH.map((each) => each.name));
    const stressAccounts = new Set<string>(STRESS_ACCOUNTS.map((each) => each.account));
    const missing = CHECKED_PAGES.filter((page) => !("isGallery" in page) && !("isOnSignInSite" in page))
      .filter((page) => !named.has(page.name) && !reasons.has(page.name) && !placePaths.has(page.path) && !("account" in page && stressAccounts.has(page.account as string)) && !("account" in page && page.path === "/games") && !/^Game page, long names$/.test(page.name));
    expect(missing.map((page) => page.name)).toEqual([]);
  });
  it("fail a sheet with no button, and pass one with its own, a reason or a pattern", () => {
    expect(statesWithNoButton(["some-new-sheet"])).toEqual(["some-new-sheet"]);
    expect(statesWithNoButton(["still-there", "top-find-list", "webhook-webhook_anything-edit"])).toEqual([]);
  });
});

describe("the bench's marks and cookies", () => {
  const url = (address: string) => new URL(`http://localhost:8900${address}`);
  it("read a mark from the address, or from a page of the same site on a marked screen", () => {
    expect(markOf(url("/?bench_screen=main.phone.Pin_Keeper.still"), null)).toMatchObject({ screenName: "phone", profile: "Pin_Keeper" });
    expect(markOf(url("/games"), "http://localhost:8900/?bench_screen=main.laptop.guest.moving")).toMatchObject({ screenName: "laptop", profile: "guest", backgrounds: "moving" });
    expect(markOf(url("/games"), "http://localhost:9999/?bench_screen=main.laptop.guest.still")).toBeNull();
    expect(markOf(url("/games"), "not an address")).toBeNull();
    expect(markOf(url("/games"), null)).toBeNull();
  });
  it("refuse anything but a mark, so an address can't name a stranger's cookie or a path", () => {
    for (const text of ["", "main.phone", "main.tablet.guest.still", "main.phone.a b.still", "main.phone.../etc.still", "main.phone.guest.fast"]) expect(parseMark(text), text).toBeNull();
  });
  it("never show the site the marks", () => {
    expect(withoutMarks(url("/g/x?play&bench_screen=main.phone.guest.still&bench_state=a/b")).search).toBe("?play=");
  });
  it("send the jar in place of the browser's own sign-in, keeping what the page's script wrote", () => {
    const browser = "zaisma_session=julius; zaisma_in=1; zaisma_played=a,b; __Host-zaisma_closed_news=1";
    expect(cookieHeaderFor(browser, [["zaisma_session", "pin"], ["zaisma_in", "1"]], "laptop")).toBe("zaisma_played=a,b; __Host-zaisma_closed_news=1; zaisma_session=pin; zaisma_in=1; zaisma_device_kind=computer");
    expect(cookieHeaderFor(browser, [], "phone")).toBe("zaisma_played=a,b; __Host-zaisma_closed_news=1; zaisma_device_kind=phone");
    expect(cookieHeaderFor(browser, [], "real")).toBe("zaisma_played=a,b; __Host-zaisma_closed_news=1");
  });
  it("keep a Set-Cookie in the jar, and take one out when it has expired", () => {
    const nowMs = Date.parse("2026-11-03T12:00:00Z");
    const jar = jarAfter([["a", "1"], ["b", "2"], ["c", "3"]], ["a=9; Path=/; HttpOnly", "b=; Max-Age=0", "c=3; Expires=Tue, 03 Nov 2026 11:00:00 GMT", "d=4; Max-Age=60"], nowMs);
    expect(jar).toEqual([["a", "9"], ["d", "4"]]);
  });
});

describe("one press on three screens", () => {
  const send = (mirror: ReturnType<typeof makeMirror>, screenName: string, nowMs: number, runs: string[], keyText = "main POST /buy") => mirror.answer({ keyText, screenName, nowMs, run: async () => { runs.push(screenName); return screenName; } });
  it("runs once, and the other screens get its answer", async () => {
    const mirror = makeMirror(), runs: string[] = [];
    const answers = await Promise.all([send(mirror, "phone", 0, runs), send(mirror, "turned", 10, runs), send(mirror, "laptop", 20, runs)]);
    expect(runs).toEqual(["phone"]);
    expect(answers).toEqual(["phone", "phone", "phone"]);
  });
  it("runs again for a second press on the same screen", async () => {
    const mirror = makeMirror(), runs: string[] = [];
    await send(mirror, "phone", 0, runs);
    await send(mirror, "phone", 10, runs);
    expect(runs).toEqual(["phone", "phone"]);
  });
  it("runs again once the moment has passed, and for another address", async () => {
    const mirror = makeMirror(), runs: string[] = [];
    await send(mirror, "phone", 0, runs);
    await send(mirror, "turned", MIRROR_WINDOW_MS + 1, runs);
    await send(mirror, "laptop", MIRROR_WINDOW_MS + 2, runs, "main POST /other");
    expect(runs).toEqual(["phone", "turned", "laptop"]);
  });
});

describe("a phone screen's rules", () => {
  it("answer as a phone in a compound query, and leave sizes alone", () => {
    const yes = "(min-width: 0px)", no = "(max-width: 0px)";
    expect(phoneMediaText("(pointer: coarse)")).toBe(yes);
    expect(phoneMediaText("(hover: none)")).toBe(yes);
    expect(phoneMediaText("(any-pointer: coarse)")).toBe(yes);
    expect(phoneMediaText("(hover: hover) and (pointer: fine) and (min-width: 761px)")).toBe(`${no} and ${no} and (min-width: 761px)`);
    expect(phoneMediaText("(hover:hover)")).toBe(no);
    expect(phoneMediaText("(max-width: 760px), (max-height: 500px)")).toBe("(max-width: 760px), (max-height: 500px)");
  });
});

describe("a phone screen's safe areas", () => {
  it("take the place of each env(), fallback and all, and leave the rest of a rule alone", () => {
    expect(phoneSafeAreaText("top: calc(6px + env(safe-area-inset-top, 0px)); color: red;", { top: 7, right: 0, bottom: 0, left: 0 })).toBe("top: calc(6px + 7px); color: red;");
    expect(phoneSafeAreaText("padding-left: max(var(--pad-frame), env(safe-area-inset-left, calc(1px + 2px)));", SAFE_AREA_PX.turned)).toBe("padding-left: max(var(--pad-frame), 59px);");
    expect(phoneSafeAreaText("padding-bottom: env(safe-area-inset-bottom);", SAFE_AREA_PX.phone)).toBe("padding-bottom: 34px;");
  });
});

describe("seen marks", () => {
  it("keep a piece's latest looks, once each", () => {
    let seen: Record<string, string[]> = {};
    for (const look of ["a", "b", "a", "c", "d", "e", "f"]) seen = seenAfter(seen, "playing/hint/guest", look);
    expect(seen["playing/hint/guest"]!.length).toBe(MAXIMUM_SEEN_LOOKS);
    expect(seen["playing/hint/guest"]!.at(-1)).toBe("f");
    expect(new Set(seen["playing/hint/guest"]).size).toBe(MAXIMUM_SEEN_LOOKS);
  });
});
