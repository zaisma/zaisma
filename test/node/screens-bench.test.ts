import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHECKED_PAGES } from "../../apps/site/src/components/checked-pages.ts";
import { PHONE_BEZEL_PX_AT_FULL_SIZE } from "../../apps/site/src/components/screens.ts";
import { STEEL_PAGES } from "../../apps/site/src/steel-pages.ts";
import { BENCH_PLACES, PAGES_NOT_ON_THE_BENCH, MAXIMUM_BUTTONS_IN_A_PLACE, MAXIMUM_BUTTON_LABEL_LENGTH, PROFILE_WORDS, readyStates, statesWithNoButton } from "../../scripts/preview/bench/places.ts";
// @ts-expect-error: a Node script with no types of its own.
import { MIRROR_WINDOW_MS, cookieHeaderFor, jarAfter, jarKeyOf, makeMirror, markOf, parseMark, screenLocation, withoutMarks } from "../../scripts/preview/bench/bench-server.mjs";
// @ts-expect-error: a Node script with no types of its own.
import { SAFE_AREA_PX, phoneMediaText, phoneSafeAreaText } from "../../scripts/preview/bench/phone-media.mjs";
// @ts-expect-error: a Node script with no types of its own.
import { MAXIMUM_SEEN_LOOKS, seenAfter } from "../../scripts/preview/bench/bench-files.mjs";
// @ts-expect-error: a Node script with no types of its own.
import { SIGN_INS } from "../../scripts/preview/sign-ins.mjs";
// @ts-expect-error: a Node script with no types of its own.
import { arrivalProblems, comparableAddress, personBeforePress } from "../../scripts/bench-press-check.mjs";

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
    for (const state of states) if (state.profile && state.profile !== "guest") expect(usernames, state.label).toContain(state.profile);
    for (const username of usernames) expect(PROFILE_WORDS[username], username).toBeTruthy();
    for (const username of Object.keys(PROFILE_WORDS)) expect(usernames, username).toContain(username);
  });
  const namedOnTheBench = BENCH_PLACES.flatMap((place) => place.states.flatMap((state) => ("checkedPage" in state ? [state.checkedPage as string] : [])));
  const reasons = PAGES_NOT_ON_THE_BENCH.map((each) => each.name as string);
  it("give every named screen a button of its own or a written reason: an address a place shares counts for nothing", () => {
    // The gallery isn't on the bench: it has its own places in its own sidebar, and the bench's rail links to it.
    const screens = [...CHECKED_PAGES.filter((page) => !page.isGallery), ...STEEL_PAGES];
    expect(screens.map((page) => page.name).filter((name) => !namedOnTheBench.includes(name) && !reasons.includes(name))).toEqual([]);
  });
  it("hold a reason only where there's no button, and every reason to a screen that exists", () => {
    const screens = [...CHECKED_PAGES, ...STEEL_PAGES].map((page) => page.name);
    expect(reasons.filter((name) => namedOnTheBench.includes(name))).toEqual([]);
    expect(reasons.filter((name) => !screens.includes(name))).toEqual([]);
    for (const { reason } of PAGES_NOT_ON_THE_BENCH) expect(reason.length).toBeGreaterThan(0);
  });
  it("name each screen once, in one look", () => {
    const names = [...CHECKED_PAGES, ...STEEL_PAGES].map((page) => page.name);
    expect(names.length).toBe(new Set(names).size);
  });
  it("size a phone's bezel in the script as its styles do", () => {
    expect(readFileSync("scripts/preview/bench/bench-script.js", "utf8")).toContain(`BEZEL_PX_AT_FULL_SIZE = /*PHONE_BEZEL_PX_AT_FULL_SIZE*/${PHONE_BEZEL_PX_AT_FULL_SIZE};`);
  });
  it("stop a page on a turned phone at the notch's bar alone, so its other side reaches the screen's edge", () => {
    expect(readFileSync("scripts/preview/bench/bench-script.js", "utf8")).toContain("screen.frame.width = screen.widthPx - sideBarPx;");
    expect(readFileSync("apps/site/src/components/screens.ts", "utf8")).toContain('width="${String(options.widthPx - (options.sideBarPx ?? 0))}"');
  });
  it("list every state for everyone, and say who a press switches to when it needs someone", () => {
    const script = readFileSync("scripts/preview/bench/bench-script.js", "utf8");
    expect(script).not.toContain("state.seenBy");
    expect(script).not.toContain("canSee");
    expect(states.some((state) => "seenBy" in state)).toBe(false);
    const asPlaced = BENCH_PLACES.flatMap((place) => place.states.map((state) => ({ state, ready: states.find((each) => each.placeValue === place.placeValue && each.stateValue === state.stateValue)! })));
    for (const { state, ready } of asPlaced) {
      if (state.seenBy === "guest") expect(ready.profile, state.label).toBe("guest");
      if (state.seenBy === "signed_in") { expect(ready.profile ?? ready.signedInProfile, state.label).toBeTruthy(); expect(ready.profile, state.label).not.toBe("guest"); }
    }
  });
  it("fail a sheet with no button, and pass one with its own, a reason or a pattern", () => {
    expect(statesWithNoButton(["some-new-sheet"])).toEqual(["some-new-sheet"]);
    expect(statesWithNoButton(["still-there", "top-find-list", "webhook-webhook_anything-edit"])).toEqual([]);
  });
});

describe("every page's name", () => {
  it("is on a list, and every name on the list of pages in the old look is said by a page", () => {
    const source = filesUnder("apps/site/src").filter((path) => !path.endsWith("steel-pages.ts")).map((path) => readFileSync(path, "utf8")).join("\n");
    expect(STEEL_PAGES.map((page) => page.name).filter((name) => !source.includes(`"${name}"`))).toEqual([]);
  });
});

describe("the press check", () => {
  const state = { placeValue: "home", stateValue: "x", label: "X", stateKind: "opened", path: "/g/a?play" };
  const seen = { isButtonShown: true, isPressed: true, isComplete: true, address: "/g/a?play=&bench_screen=main.phone.guest.still", pageName: "Home", markedProfile: "guest", isSignedIn: false, isOpen: true, isControlThere: true, isAnyLayerOpen: true };
  it("passes a state that's there, however its address is written", () => {
    expect(comparableAddress("/g/a?play&b=1")).toBe(comparableAddress("/g/a?b=1&play=&bench_screen=main.phone.guest.still"));
    expect(arrivalProblems(state, seen)).toEqual([]);
    expect(arrivalProblems({ ...state, shownPageName: "Home", profile: "guest", opens: "a-sheet" }, seen)).toEqual([]);
  });
  it("fails each way a press can miss, saying what it saw", () => {
    const missed = (asked: object, given: object) => arrivalProblems({ ...state, ...asked }, { ...seen, ...given }).join();
    expect(missed({}, { isButtonShown: false })).toContain("left the rail");
    expect(missed({}, { isPressed: false })).toContain("came back up");
    expect(missed({ shownPageName: "Games" }, {})).toContain(`"Home", not "Games"`);
    expect(missed({ path: "/games" }, {})).toContain("not /games");
    expect(missed({ path: "/games", stepsToTake: [{ path: "/x" }] }, {})).toBe("");
    expect(missed({ profile: "Moss_Runner" }, {})).toContain("guest's, not Moss_Runner's");
    expect(missed({ profile: "guest" }, { isSignedIn: true })).toContain("signed in");
    expect(missed({ profile: "guest", stepsToTake: [{ path: "/signin/with/google" }] }, { isSignedIn: true })).toBe("");
    expect(missed({ signedInProfile: "Moss_Runner" }, {})).toContain("a guest's");
    expect(missed({ opens: "a-sheet" }, { isOpen: false })).toContain("#a-sheet isn't open");
    expect(missed({ presses: "#a" }, { isControlThere: false })).toContain("no #a");
    expect(missed({ setUpName: "A" }, { isAnyLayerOpen: false })).toContain("nothing opened");
  });
  it("presses a state as someone it doesn't need, so the press has to switch", () => {
    expect(personBeforePress({ profile: "guest" })).toBe("Moss_Runner");
    expect(personBeforePress({ profile: "Card_Keeper" })).toBe("guest");
    expect(personBeforePress({ signedInProfile: "Moss_Runner" })).toBe("guest");
    expect(personBeforePress({})).toBeNull();
  });
  it("runs at night and holds no ship, and not in a pull request", () => {
    const nightly = readFileSync(".github/workflows/nightly.yml", "utf8");
    const job = nightly.slice(nightly.indexOf("\n  bench-presses:"), nightly.indexOf("\n  # CI's warning line"));
    expect(job).toContain("npm run bench:check");
    expect(job).toContain("continue-on-error: true");
    expect(readFileSync(".github/workflows/check.yml", "utf8")).not.toContain("bench:check");
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
    const browser = "zaisma_session=julius; zaisma_in=1; zaisma_played=a,b; __Host-download_started=1";
    expect(cookieHeaderFor(browser, [["zaisma_session", "pin"], ["zaisma_in", "1"]], "laptop")).toBe("zaisma_played=a,b; __Host-download_started=1; zaisma_session=pin; zaisma_in=1; zaisma_device_kind=computer");
    expect(cookieHeaderFor(browser, [], "phone")).toBe("zaisma_played=a,b; __Host-download_started=1; zaisma_device_kind=phone");
    expect(cookieHeaderFor(browser, [], "real")).toBe("zaisma_played=a,b; __Host-download_started=1");
  });
  it("keep a jar to one address, since each address names its cookies and signs its tokens itself", () => {
    expect(jarKeyOf("http://localhost:8900", "Moss_Runner")).not.toBe(jarKeyOf("https://mac.example.ts.net:8900", "Moss_Runner"));
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
  it("keep a screen's mark on a redirect within the site, and leave any other address alone", async () => {
    const url = new URL("http://localhost:8800/signin/callback");
    const mark = parseMark("main.phone.guest.still");
    expect(await screenLocation("/join/username?next=%2F", url, mark)).toBe("/join/username?next=%2F&bench_screen=main.phone.guest.still");
    expect(await screenLocation("https://example.test/elsewhere", url, mark)).toBe("https://example.test/elsewhere");
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
