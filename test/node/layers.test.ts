import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LAYERS_SCRIPT, MAXIMUM_PAGE_NOTICE_COUNT, NOTICE_STAY_MS, STALE_INFORMATION_MS } from "../../apps/site/src/components/layers.ts";

/**
 * The one owner of what appears over a page or a game (components/layers.ts), in a stand-in browser: just enough of the DOM for its
 * queue and its stack (elements with classes and attributes, simple selectors with no combinators, dialogs, popovers, events), with
 * the test's own clock.
 */

type Listener = (event: FakeEvent) => void;
interface FakeEvent {
  type: string;
  target: FakeElement | null;
  detail?: unknown;
  clientX?: number;
  clientY?: number;
  defaultPrevented?: boolean;
  preventDefault(): void;
  [name: string]: unknown;
}

const event = (type: string, target: FakeElement | null, more: Record<string, unknown> = {}): FakeEvent => ({ type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...more });

/** One simple selector (a tag, classes, attributes, :not(…), :popover-open), with no combinators: those match nothing here. */
function matchesSimple(element: FakeElement, selector: string): boolean {
  const parts = /^([a-z]+)?((?:\.[\w-]+|\[[^\]]+\]|:not\([^)]*\)|:popover-open)*)$/.exec(selector.trim());
  if (!parts) return false;
  if (parts[1] && parts[1] !== element.tagName) return false;
  for (const token of parts[2]!.match(/\.[\w-]+|\[[^\]]+\]|:not\([^)]*\)|:popover-open/g) ?? []) {
    if (token.startsWith(".") && !element.classList.contains(token.slice(1))) return false;
    if (token === ":popover-open" && !element.isPopoverOpen) return false;
    if (token.startsWith(":not(") && token.slice(5, -1).split(",").some((inner) => matchesSimple(element, inner))) return false;
    if (token.startsWith("[")) {
      const [, name, value] = /^\[([\w-]+)(?:=["']([^"']*)["'])?\]$/.exec(token)!;
      if (!element.hasAttribute(name!) || (value !== undefined && element.getAttribute(name!) !== value)) return false;
    }
  }
  return true;
}

class FakeElement {
  tagName: string;
  id = "";
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  listeners: Record<string, Listener[]> = {};
  isPopoverOpen = false;
  offsetHeight = 40;
  offsetWidth = 300;
  textContent = "";
  /** A made one answers any part asked for with a stand-in, so its words have somewhere to go. */
  isStubbing = false;
  stubs = new Map<string, FakeElement>();
  style = { values: new Map<string, string>(), minHeight: "", setProperty(name: string, value: string) { this.values.set(name, value); }, removeProperty(name: string) { this.values.delete(name); } };
  classList = {
    names: new Set<string>(),
    add: (...names: string[]) => names.forEach((name) => this.classList.names.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classList.names.delete(name)),
    contains: (name: string) => this.classList.names.has(name),
    toggle: (name: string, isOn?: boolean) => ((isOn ?? !this.classList.names.has(name)) ? this.classList.names.add(name) : this.classList.names.delete(name)),
  };
  constructor(tagName: string, attributes: Record<string, string> = {}) {
    this.tagName = tagName;
    for (const [name, value] of Object.entries(attributes)) this.setAttribute(name, value);
  }
  get hidden() { return this.attributes.has("hidden"); }
  set hidden(isHidden: boolean) { if (isHidden) this.attributes.set("hidden", ""); else this.attributes.delete("hidden"); }
  get isConnected() { return true; }
  setAttribute(name: string, value: string) {
    if (name === "class") value.split(/\s+/).filter(Boolean).forEach((each) => this.classList.add(each));
    else if (name === "id") this.id = value;
    else this.attributes.set(name, value);
  }
  getAttribute(name: string) { return name === "id" ? this.id : this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  matches(selector: string) { return selector.split(",").some((each) => matchesSimple(this, each)); }
  closest(selector: string): FakeElement | null { return this.matches(selector) ? this : this.parent ? this.parent.closest(selector) : null; }
  descendants(): FakeElement[] { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  querySelectorAll(selector: string) { return this.descendants().filter((each) => each.matches(selector)); }
  querySelector(selector: string) {
    const found = this.querySelectorAll(selector)[0];
    if (found || !this.isStubbing) return found ?? null;
    if (!this.stubs.has(selector)) this.stubs.set(selector, new FakeElement("span"));
    return this.stubs.get(selector)!;
  }
  appendChild(child: FakeElement) { child.parent = this; this.children.push(child); return child; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((each) => each !== this); this.parent = null; }
  contains(other: FakeElement | null): boolean { return Boolean(other) && (other === this || this.descendants().includes(other!)); }
  addEventListener(type: string, listener: Listener) { (this.listeners[type] ??= []).push(listener); }
  removeEventListener(type: string, listener: Listener) { this.listeners[type] = (this.listeners[type] ?? []).filter((each) => each !== listener); }
  fire(type: string) { (this.listeners[type] ?? []).forEach((listener) => listener(event(type, this))); }
  focus() {}
  getBoundingClientRect() { return { left: 100, right: 400, top: 100, bottom: 300, width: 300, height: 200 }; }
  showPopover() { this.isPopoverOpen = true; }
  hidePopover() { this.isPopoverOpen = false; }
}

/** The page: its queue and stack loaded fresh, a game playing on it or not. */
function loadPage({ isPlaying = false } = {}) {
  const documentListeners: Record<string, Listener[]> = {};
  const windowListeners: Record<string, Listener[]> = {};
  const root = Object.assign(new FakeElement("html"), { clientWidth: 1200 });
  if (isPlaying) root.classList.add("is-playing");
  const body = root.appendChild(new FakeElement("body"));
  const main = body.appendChild(new FakeElement("main"));
  const fire = (type: string, target: FakeElement | null, more: Record<string, unknown> = {}) => {
    const fired = event(type, target, more);
    (documentListeners[type] ?? []).forEach((listener) => listener(fired));
    return fired;
  };
  // A dialog of its own for this page, so the script wraps its methods afresh.
  class Dialog extends FakeElement {
    open = false;
    showModal() { this.open = true; this.attributes.set("open", ""); }
    close() { this.open = false; this.attributes.delete("open"); fire("close", this); }
  }
  const document = {
    documentElement: root,
    body,
    fullscreenElement: null as FakeElement | null,
    activeElement: null,
    createElement: () => {
      const template = { content: { firstElementChild: null as FakeElement | null } };
      Object.defineProperty(template, "innerHTML", {
        set(markup: string) {
          const [, tagName, attributeText] = /^<([a-z]+)([^>]*)>/.exec(markup)!;
          const made = new FakeElement(tagName!);
          for (const [, name, value] of attributeText!.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) made.setAttribute(name!, value ?? "");
          made.isStubbing = true;
          template.content.firstElementChild = made;
        },
      });
      return template;
    },
    querySelector: (selector: string) => (selector === "main" ? main : root.querySelector(selector)),
    querySelectorAll: (selector: string) => root.querySelectorAll(selector),
    getElementById: (id: string) => root.descendants().find((each) => each.id === id) ?? null,
    addEventListener: (type: string, listener: Listener) => void (documentListeners[type] ??= []).push(listener),
  };
  const coveredChanges: unknown[] = [];
  const window: Record<string, unknown> = {
    innerHeight: 800,
    scrollX: 0,
    scrollY: 0,
    CSS: { supports: () => true },
    // Where a hanging pane goes (panes.ts's PLACE_SCRIPT), standing in: under the button.
    zaismaPlace: (rect: { left: number; bottom: number }) => ({ leftPx: rect.left, topPx: rect.bottom + 8, isAbove: false, isAtEnd: false }),
    addEventListener: (type: string, listener: Listener) => void (windowListeners[type] ??= []).push(listener),
    dispatchEvent: (fired: { type: string; detail: { coveredBy: unknown } }) => void (fired.type === "zaisma:covered" && coveredChanges.push(fired.detail.coveredBy)),
  };
  const warnings: string[] = [];
  const browser = {
    window,
    document,
    HTMLDialogElement: Dialog,
    getComputedStyle: () => ({ getPropertyValue: () => "8px" }),
    matchMedia: () => ({ matches: false }),
    // A browser that draws a sheet's first frame on time (one with overlay): it opens at once, with no frames to wait for.
    CSS: { supports: () => true },
    console: { warn: (text: string) => warnings.push(text) },
  };
  new Function(...Object.keys(browser), LAYERS_SCRIPT)(...Object.values(browser));
  const layers = window.zaismaLayers as {
    say(options: Record<string, unknown>): { leave(): void } | null;
    show(card: FakeElement): unknown;
    leave(card: FakeElement): void;
    step(sheet: FakeElement, stepName: string, options?: { isBackShown: boolean }): void;
    coveredBy: string | null;
    openSheets: FakeElement[];
  };
  return {
    layers,
    document,
    coveredChanges,
    warnings,
    /** A playing card the page put there, hidden until its turn. */
    card(id: string, noticeUrgency: string) {
      return main.appendChild(new FakeElement("aside", { class: "playing-card glass", id, "data-notice-urgency": noticeUrgency, hidden: "" }));
    },
    /** An urgent card: a popover the queue shows over everything. */
    urgent(id: string, sheetsToClose: string[] = []) {
      return main.appendChild(new FakeElement("aside", { class: "playing-card urgent-card glass", id, "data-notice-urgency": "urgent", popover: "manual", ...(sheetsToClose.length ? { "data-sheets-to-close": sheetsToClose.join(" ") } : {}) }));
    },
    sheet(id: string) {
      const sheet = main.appendChild(new Dialog("dialog", { class: "sheet glass", id }));
      return sheet as Dialog;
    },
    /** The notices showing on the page, by their words, oldest first. */
    shownNotices: () => main.children.filter((each) => each.matches(".notice") && !each.hidden && !each.classList.contains("is-leaving")).map((each) => each.querySelector(".notice-text")!.textContent),
    shownCards: () => main.children.filter((each) => each.matches(".playing-card") && !each.hidden).map((each) => (each.isStubbing ? each.querySelector("p")!.textContent : each.id)),
    fire,
  };
}

describe("the queue for notices and the cards over a game", () => {
  beforeEach(() => void vi.useFakeTimers({ now: new Date("2026-10-27T12:00:00Z") }));
  afterEach(() => void vi.useRealTimers());

  it("lets information leave after 4 s, and waits while it's pointed at or touched, then starts its whole time again", () => {
    const page = loadPage();
    page.layers.say({ text: "Saved" });
    expect(page.shownNotices()).toEqual(["Saved"]);
    vi.advanceTimersByTime(NOTICE_STAY_MS - 1);
    expect(page.shownNotices()).toEqual(["Saved"]);
    vi.advanceTimersByTime(1);
    expect(page.shownNotices()).toEqual([]);

    page.layers.say({ text: "Copied" });
    const notice = page.document.querySelectorAll(".notice").find((each) => !each.classList.contains("is-leaving"))!;
    notice.fire("pointerenter");
    vi.advanceTimersByTime(NOTICE_STAY_MS * 3);
    expect(page.shownNotices()).toEqual(["Copied"]);
    notice.fire("pointerleave");
    vi.advanceTimersByTime(NOTICE_STAY_MS - 1);
    expect(page.shownNotices()).toEqual(["Copied"]);
    vi.advanceTimersByTime(1);
    expect(page.shownNotices()).toEqual([]);
  });

  it("shows three notices on a page and queues a fourth until one leaves; a problem stays, and the same words twice are one notice", () => {
    const page = loadPage();
    page.layers.say({ text: "Couldn't reach Zaisma.", tone: "problem" });
    page.layers.say({ text: "Couldn't reach Zaisma.", tone: "problem" });
    const saved = page.layers.say({ text: "Saved" })!;
    page.layers.say({ text: "Copied" });
    page.layers.say({ text: "Removed" });
    expect(MAXIMUM_PAGE_NOTICE_COUNT).toBe(3);
    expect(page.shownNotices()).toEqual(["Couldn't reach Zaisma.", "Saved", "Copied"]);
    saved.leave();
    expect(page.shownNotices()).toEqual(["Couldn't reach Zaisma.", "Copied", "Removed"]);
    vi.advanceTimersByTime(NOTICE_STAY_MS * 2);
    expect(page.shownNotices()).toEqual(["Couldn't reach Zaisma."]);
  });

  it("over a game shows one card at a time, asks before information, the next 300 ms after one leaves", () => {
    const page = loadPage({ isPlaying: true });
    const sheet = page.sheet("players");
    sheet.showModal();
    page.layers.say({ text: "Your progress now saves to your account." });
    const keep = page.card("keep", "ask");
    page.layers.show(keep);
    // A sheet is open: nothing but urgent shows.
    expect(page.shownCards()).toEqual([]);
    sheet.close();
    vi.advanceTimersByTime(400);
    expect(page.shownCards()).toEqual(["keep"]);
    page.layers.leave(keep);
    expect(page.shownCards()).toEqual([]);
    vi.advanceTimersByTime(299);
    expect(page.shownCards()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(page.shownCards()).toEqual(["Your progress now saves to your account."]);
  });

  it("drops information that waited more than 10 s for a sheet to close, never an ask or a problem", () => {
    const page = loadPage({ isPlaying: true });
    const sheet = page.sheet("buy-sheet");
    sheet.showModal();
    page.layers.say({ text: "Saved" });
    page.layers.say({ text: "Couldn't save to your account.", tone: "problem" });
    page.layers.show(page.card("still-there", "ask"));
    vi.advanceTimersByTime(STALE_INFORMATION_MS + 1);
    sheet.close();
    vi.advanceTimersByTime(400);
    expect(page.shownCards()).toEqual(["still-there"]);
    page.layers.leave(page.document.getElementById("still-there")!);
    vi.advanceTimersByTime(300);
    expect(page.shownCards()).toEqual(["Couldn't save to your account."]);
    page.layers.leave(page.document.querySelectorAll(".playing-card").find((each) => !each.hidden)!);
    vi.advanceTimersByTime(1000);
    expect(page.shownCards()).toEqual([]);
  });

  it("shows urgent over an open sheet and in full screen, closing the sheets it names first", () => {
    const page = loadPage({ isPlaying: true });
    const buy = page.sheet("buy-sheet");
    const confirm = page.sheet("buy-confirm-you");
    const players = page.sheet("players");
    buy.showModal();
    confirm.showModal();
    const signedOut = page.urgent("buy-signed-out", ["buy-sheet", "buy-confirm-you"]);
    page.layers.say({ cardId: "buy-signed-out" });
    expect(signedOut.isPopoverOpen).toBe(true);
    expect(page.layers.openSheets).toEqual([]);
    vi.advanceTimersByTime(400);
    expect([buy.open, confirm.open]).toEqual([false, false]);
    // A sheet opened while it's up goes under it: shown again, so it's last in the top layer.
    const raised = vi.spyOn(signedOut, "showPopover");
    players.showModal();
    expect(raised).toHaveBeenCalledTimes(1);
    expect(signedOut.isPopoverOpen).toBe(true);
    // In full screen too.
    page.document.fullscreenElement = new FakeElement("iframe");
    page.fire("fullscreenchange", null);
    expect(raised).toHaveBeenCalledTimes(2);
  });

  it("tells the game what covers it, only when that changes", () => {
    const page = loadPage({ isPlaying: true });
    const sheet = page.sheet("players");
    const card = page.card("still-there", "ask");
    page.layers.show(card);
    sheet.showModal();
    sheet.showModal();
    sheet.close();
    vi.advanceTimersByTime(400);
    page.layers.leave(card);
    expect(page.coveredChanges).toEqual(["card", "sheet", "card", null]);
    expect(page.layers.coveredBy).toBeNull();
  });
});

describe("the stack of sheets", () => {
  beforeEach(() => void vi.useFakeTimers({ now: new Date("2026-10-27T12:00:00Z") }));
  afterEach(() => void vi.useRealTimers());

  it("goes two deep at most: a third replaces the top one, with a warning", () => {
    const page = loadPage();
    const [one, two, three] = [page.sheet("one"), page.sheet("two"), page.sheet("three")];
    one.showModal();
    two.showModal();
    three.showModal();
    expect([one.open, two.open, three.open]).toEqual([true, false, true]);
    expect(page.layers.openSheets.map((each) => each.id)).toEqual(["one", "three"]);
    expect(page.warnings).toEqual(["Sheets go two deep at most: #three replaces #two."]);
    // A confirm opened over another sheet is drawn a size smaller.
    expect(three.classList.contains("is-over-sheet")).toBe(true);
    expect(one.classList.contains("is-over-sheet")).toBe(false);
  });

  it("opens a sheet where its kind says: a small one hangs from the button that opened it, a task sheet never does", () => {
    const page = loadPage();
    const opener = page.document.body.appendChild(new FakeElement("button", { class: "cut-btn" }));
    const [small, task] = [page.sheet("share"), page.sheet("report")];
    small.classList.add("is-compact");
    page.fire("click", opener);
    small.showModal();
    expect(small.classList.contains("is-anchored")).toBe(true);
    small.close();
    vi.advanceTimersByTime(400);
    page.fire("click", opener);
    task.showModal();
    expect(task.classList.contains("is-anchored")).toBe(false);
    // A small one with no button behind it (a game asked for it) takes a task sheet's place.
    task.close();
    vi.advanceTimersByTime(400);
    page.fire("click", page.document.body);
    small.showModal();
    expect(small.classList.contains("is-anchored")).toBe(false);
  });

  it("closes only the top sheet on a press beside it or Esc", () => {
    const page = loadPage();
    const [under, over] = [page.sheet("under"), page.sheet("over")];
    under.showModal();
    over.showModal();
    // A press beside the one beneath does nothing (the browser sends presses to the top one anyway).
    page.fire("click", under, { clientX: 10, clientY: 10, detail: 1 });
    // Inside the top one, nothing; beside it, it closes.
    page.fire("click", over, { clientX: 200, clientY: 200, detail: 1 });
    vi.advanceTimersByTime(400);
    expect([under.open, over.open]).toEqual([true, true]);
    page.fire("click", over, { clientX: 10, clientY: 10, detail: 1 });
    vi.advanceTimersByTime(400);
    expect([under.open, over.open]).toEqual([true, false]);
    over.showModal();
    const cancel = page.fire("cancel", over);
    expect(cancel.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(400);
    expect([under.open, over.open]).toEqual([true, false]);
  });

  it("moves through a sheet's steps with Back, starts at one with no Back, and resets to the first as it closes", () => {
    const page = loadPage();
    const sheet = page.sheet("players");
    const steps = ["players", "player", "report"].map((stepName, index) => {
      const section = sheet.appendChild(new FakeElement("section", { class: "sheet-step", "data-sheet-step": stepName, ...(index ? { hidden: "" } : {}) }));
      section.appendChild(new FakeElement("button", { class: "cut-btn", "data-sheet-back": "" }));
      section.appendChild(new FakeElement("h2", { class: "sheet-title", id: `players-${stepName}-title` }));
      return section;
    });
    const shown = () => steps.filter((each) => !each.hidden).map((each) => each.getAttribute("data-sheet-step"));
    const back = (index: number) => steps[index]!.children[0]!;
    sheet.showModal();
    page.layers.step(sheet, "player");
    page.layers.step(sheet, "report");
    expect(shown()).toEqual(["report"]);
    expect(back(2).hidden).toBe(false);
    expect(sheet.getAttribute("aria-labelledby")).toBe("players-report-title");
    page.fire("click", back(2));
    expect(shown()).toEqual(["player"]);
    page.fire("click", back(1));
    expect(shown()).toEqual(["players"]);
    // Opened at Report from anywhere else: no Back.
    page.layers.step(sheet, "report", { isBackShown: false });
    expect(back(2).hidden).toBe(true);
    sheet.close();
    vi.advanceTimersByTime(400);
    expect(shown()).toEqual(["players"]);
  });
});
