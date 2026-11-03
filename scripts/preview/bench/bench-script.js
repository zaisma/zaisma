// The Screens bench's page: three screens that copy each other, the rail that presses states on them, and the light box. Each screen's own
// script (frame-script.js) says what's done there through window.zaismaBench and does what's asked through its window.zaismaBenchScreen.
(() => {
  const data = JSON.parse(document.getElementById("bench-data").textContent);
  const $ = (selector, within = document) => within.querySelector(selector);
  const $$ = (selector, within = document) => [...within.querySelectorAll(selector)];
  const GROUP = "main";
  const PHONE_ROOM_PX = 70, GAP_PX = 4, BEZEL_PX = 6;
  const SLOW_RATE = 0.25, REPLAY_PAUSE_MS = 450, CATCH_UP_MS = 800;

  const screens = Object.fromEntries($$("[data-bench-screen]").map((figure) => [figure.dataset.benchScreen, { figure, name: figure.dataset.benchScreen, widthPx: Number(figure.dataset.widthPx), heightPx: Number(figure.dataset.heightPx), frame: $("iframe", figure), view: $(".bench-view", figure), body: $(".bench-body", figure), address: null, pending: [] }]));
  for (const screen of Object.values(screens)) { screen.label = $(`[data-bench-screen-name="${screen.name}"]`); screen.bezelPx = screen.figure.classList.contains("is-phone") ? BEZEL_PX : 0; screen.followNote = $(`[data-bench-follow-note="${screen.name}"]`); }
  const allScreens = Object.values(screens);
  const stateOf = (key) => data.states.find((state) => `${state.placeValue}/${state.stateValue}` === key);
  const placeOf = (value) => data.places.find((place) => place.placeValue === value);

  const bench = { placeValue: "home", profile: "guest", address: "/", isSignedIn: false, pressed: new Set(), lastDone: null, leadName: null, isSlow: false, isDark: false, isMoving: false, isOnlyUnseen: false, seen: {} };
  let big = null;

  // Where each screen stands: the page's own marks, so its requests carry its profile.
  const addressFor = (screen, path, profile = bench.profile) => {
    const url = new URL(path, location.origin);
    url.searchParams.set("bench_screen", `${GROUP}.${screen.name}.${profile}.${bench.isMoving ? "moving" : "still"}`);
    return url.pathname + url.search + url.hash;
  };
  const screenWindow = (screen) => { try { return screen.frame.contentWindow; } catch { return null; } };
  const screenApi = (screen) => screenWindow(screen)?.zaismaBenchScreen ?? null;
  const load = (screen, path, profile, then) => {
    screen.pending = then ? [then] : [];
    screen.address = path;
    screen.frame.src = addressFor(screen, path, profile);
  };
  const followNote = (screen, isOn) => { if (screen.followNote) screen.followNote.hidden = !isOn; };

  // Sized to the window: the phone at real size when it fits, and the others from what's beside it.
  function fit() {
    const stage = $(".bench-stage");
    const room = stage.getBoundingClientRect();
    const bezelsPx = 2 * BEZEL_PX;
    const phoneScale = Math.min(1, (room.height - PHONE_ROOM_PX - bezelsPx) / screens.phone.heightPx);
    const besideWidth = room.width - screens.phone.widthPx * phoneScale - bezelsPx - GAP_PX;
    const fullHeight = screens.turned.heightPx * 0.75 + screens.laptop.heightPx * 0.57;
    const share = Math.min(1, (room.height - GAP_PX - bezelsPx) / fullHeight, besideWidth / (screens.laptop.widthPx * 0.57));
    const scales = { phone: phoneScale, turned: 0.75 * share, laptop: 0.57 * share };
    for (const screen of allScreens) {
      const scale = big?.screen === screen ? big.scale : scales[screen.name];
      screen.scale = scales[screen.name];
      screen.figure.style.setProperty("--screen-width", `${screen.widthPx * scales[screen.name]}px`);
      screen.figure.style.setProperty("--screen-height", `${screen.heightPx * scales[screen.name]}px`);
      screen.frame.style.transform = `scale(${scale})`;
      screen.label.textContent = `${screen.figure.dataset.benchName}, ${Math.round(scales[screen.name] * 100)}%`;
    }
    if (big) placeBig();
  }

  // The light box: the same frame, grown where it stands, so nothing in it reloads.
  const TOOLS_ROOM_PX = 72;
  function placeBig() {
    const stage = $(".bench-stage").getBoundingClientRect();
    const bezelsPx = 2 * big.screen.bezelPx;
    const scale = Math.min((stage.width - 2 * GAP_PX - bezelsPx) / big.screen.widthPx, (stage.height - TOOLS_ROOM_PX - GAP_PX - bezelsPx) / big.screen.heightPx);
    big.scale = scale;
    const widthPx = big.screen.widthPx * scale + bezelsPx, heightPx = big.screen.heightPx * scale + bezelsPx;
    const { body } = big.screen;
    body.style.left = `${stage.left + (stage.width - widthPx) / 2}px`;
    body.style.top = `${stage.top + (stage.height - TOOLS_ROOM_PX - heightPx) / 2}px`;
    body.style.width = `${widthPx}px`;
    body.style.height = `${heightPx}px`;
    big.screen.frame.style.transform = `scale(${scale})`;
  }
  function openBig(screen) {
    big = { screen, scale: 1, profile: bench.profile, isSlow: bench.isSlow, isDark: bench.isDark, lastDone: bench.lastDone, isChanged: false };
    document.body.classList.add("bench-is-big");
    screen.figure.classList.add("is-big");
    $(".bench-big-tools").hidden = false;
    setPressed($("[data-bench-big-slow]"), big.isSlow); setPressed($("[data-bench-big-dark]"), big.isDark);
    labelOf($("[data-bench-big-profile-button]")).textContent = big.profile === "guest" ? "Guest" : big.profile;
    placeBig();
  }
  function closeBig() {
    if (!big) return;
    const { screen, isChanged, profile } = big;
    big = null;
    document.body.classList.remove("bench-is-big");
    screen.figure.classList.remove("is-big");
    $(".bench-big-tools").hidden = true;
    for (const name of ["left", "top", "width", "height"]) screen.body.style.removeProperty(name);
    fit();
    // Back in step: its address, its person and what's showing.
    const others = allScreens.find((each) => each !== screen);
    if (isChanged || profile !== bench.profile) load(screen, others.address ?? bench.address, bench.profile, () => { for (const key of bench.pressed) enterOn(screen, stateOf(key)); });
    applyLook(screen);
  }

  const labelOf = (button) => $(".face span:not(.ico), .face", button);
  const setPressed = (button, isPressed) => button && button.setAttribute("aria-pressed", String(isPressed));
  const activeScreens = () => (big ? [big.screen] : allScreens);

  const lookOf = (screen) => ({ isSlow: big?.screen === screen ? big.isSlow : bench.isSlow, isDark: big?.screen === screen ? big.isDark : bench.isDark });
  function applyLook(screen) {
    const api = screenApi(screen);
    if (!api) return;
    const look = lookOf(screen);
    api.setTheme(look.isDark ? "dark" : "light");
    api.setPlaybackRate(look.isSlow ? SLOW_RATE : 1);
  }

  // A state's steps, one form or address at a time: each answer's page takes the next.
  async function stepThrough(screen, steps, ready) {
    let stepIndex = 0;
    const next = () => {
      const doc = screen.frame.contentDocument;
      if (stepIndex >= steps.length) return ready();
      const step = steps[stepIndex++];
      screen.pending = [next];
      if (step.path) { screen.frame.contentWindow.location.assign(step.path); return; }
      const form = [...doc.querySelectorAll("form")].find((each) => each.getAttribute("action") === step.formAction);
      if (!form) return ready();
      const word = Math.random().toString(36).slice(2, 10);
      for (const [name, value] of Object.entries(step.fieldValues)) {
        let field = form.elements.namedItem(name);
        if (!field) { field = doc.createElement("input"); field.type = "hidden"; field.name = name; form.append(field); }
        field.value = value.split(UNIQUE_WORD).join(word);
      }
      HTMLFormElement.prototype.submit.call(form);
    };
    next();
  }
  const UNIQUE_WORD = "{unique}";

  async function enterOn(screen, state) {
    const api = screenApi(screen);
    if (api) { await api.enterState(state); followNote(screen, false); }
  }

  // A press: enter it on every screen in play, on its page and as its person, then mark it seen.
  function arrive(state, then) {
    const profile = state.profile && bench.profile !== state.profile ? state.profile : null;
    const isOnPage = allScreens.every((screen) => screen.address === state.path);
    if (big) { arriveBig(state, then); return; }
    if (profile) { bench.profile = profile; forgetOnce(profile); drawProfile(); }
    if (profile || !isOnPage || state.isOwnPage) {
      if (state.isOwnPage || !isOnPage) { bench.pressed.clear(); }
      for (const screen of allScreens) load(screen, state.path, bench.profile, () => {
        if (state.stepsToTake) stepThrough(screen, state.stepsToTake, () => then?.(screen));
        else enterOn(screen, state).then(() => then?.(screen));
      });
      return;
    }
    for (const screen of allScreens) enterOn(screen, state).then(() => then?.(screen));
  }
  function arriveBig(state, then) {
    const screen = big.screen;
    big.isChanged = true;
    if (state.isOwnPage || screen.address !== state.path || (state.profile && big.profile !== state.profile)) {
      if (state.profile) big.profile = state.profile;
      load(screen, state.path, big.profile, () => {
        if (state.stepsToTake) stepThrough(screen, state.stepsToTake, () => then?.(screen));
        else enterOn(screen, state).then(() => then?.(screen));
      });
      return;
    }
    enterOn(screen, state).then(() => then?.(screen));
  }
  const forgetOnce = (profile) => { if (profile === "guest") fetch(`/__preview/bench/forget-profile?profile=${encodeURIComponent(profile)}`, { method: "POST" }); };

  function pressState(key) {
    const state = stateOf(key);
    const button = $(`[data-bench-state="${key}"]`);
    if (bench.pressed.has(key)) { bench.pressed.delete(key); setPressed(button, false); leave(state); bench.lastDone = { kind: "left", key }; return; }
    bench.pressed.add(key);
    setPressed(button, true);
    bench.lastDone = { kind: "state", key };
    if (big) big.lastDone = bench.lastDone;
    arrive(state, (screen) => { if (screen === screens.phone) noteSeen(state); });
  }
  function leave(state) {
    for (const screen of activeScreens()) {
      if (state.isOwnPage) load(screen, placeOf(state.placeValue).path, big?.screen === screen ? big.profile : bench.profile);
      else screenApi(screen)?.leaveState(state);
    }
  }

  // Seen marks: a state's look, kept against who saw it; green only while the piece still looks as it did.
  const seenKey = (state) => `${state.placeValue}/${state.stateValue}/${bench.isSignedIn ? "signed_in" : "guest"}`;
  // Read on the phone screen, for one look whichever screen's open. A piece on the page counts as seen while it looks as it did; a state only a form reaches, while the rules for its classes do.
  const seenHere = new Set();
  const matchingLooks = new Set();
  async function noteSeen(state) {
    const look = await screenApi(screens.phone)?.lookOf(state);
    if (!look) return;
    seenHere.add(seenKey(state));
    const answered = await fetch("/__preview/bench/seen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key_text: seenKey(state), look_text: look }) });
    bench.seen = await answered.json();
    drawRail();
  }
  async function checkLooks() {
    const api = screenApi(screens.phone);
    if (!api) return;
    matchingLooks.clear();
    for (const state of data.states.filter((each) => each.placeValue === bench.placeValue)) {
      for (const look of bench.seen[seenKey(state)] ?? []) if ((await api.lookOf(state, look)) === look) matchingLooks.add(seenKey(state));
    }
    drawRail();
  }
  const isSeen = (state) => seenHere.has(seenKey(state)) || matchingLooks.has(seenKey(state));

  const canSee = (state) => (state.seenBy === "both" || state.seenBy === (bench.isSignedIn ? "signed_in" : "guest"));
  function drawRail() {
    const shown = data.states.filter((state) => state.placeValue === bench.placeValue && canSee(state));
    let seenCount = 0;
    for (const button of $$("[data-bench-state]")) button.hidden = true;
    for (const state of shown) {
      const key = `${state.placeValue}/${state.stateValue}`, button = $(`[data-bench-state="${key}"]`), seen = isSeen(state);
      if (seen) seenCount += 1;
      button.classList.toggle("is-seen", seen);
      setPressed(button, bench.pressed.has(key));
      button.hidden = bench.isOnlyUnseen && seen;
    }
    for (const group of $$("[data-state-group]")) group.hidden = !$$("[data-bench-state]", group).some((button) => !button.hidden);
    labelOf($("[data-bench-seen]")).textContent = `Seen ${seenCount} of ${shown.length}`;
    labelOf($("[data-bench-place-button]")).textContent = placeOf(bench.placeValue)?.name ?? "Another page";
    drawProfile();
  }
  function drawProfile() {
    const place = placeOf(bench.placeValue);
    const button = $("[data-bench-profile-button]");
    labelOf(button).textContent = bench.profile === "guest" ? (bench.isSignedIn ? "Signed in here" : "Guest") : bench.isSignedIn ? bench.profile : "Signed out here";
    button.disabled = place?.seenBy === "guest";
    for (const choice of $$("[data-bench-profile]")) choice.hidden = place?.seenBy === "signed_in" && choice.dataset.benchProfile === "guest";
  }

  // Going somewhere: every screen, whatever was showing gone.
  function goToPlace(placeValue, thenKey) {
    const place = placeOf(placeValue);
    if (!place) return;
    bench.pressed.clear();
    bench.placeValue = placeValue;
    if (place.seenBy === "guest" && bench.profile !== "guest") { bench.profile = "guest"; forgetOnce("guest"); }
    if (place.seenBy === "signed_in" && bench.profile === "guest") bench.profile = place.profile ?? "Moss_Runner";
    for (const screen of allScreens) load(screen, place.path, bench.profile, thenKey ? () => {} : null);
    if (thenKey) pressStateWhenThere(thenKey);
    drawRail();
  }
  const pressStateWhenThere = (key) => { const state = stateOf(key); bench.placeValue = state.placeValue; pressState(key); };
  function switchProfile(profile) {
    if (big) { big.profile = profile; big.isChanged = true; labelOf($("[data-bench-big-profile-button]")).textContent = profile === "guest" ? "Guest" : profile; load(big.screen, big.screen.address ?? bench.address, profile); return; }
    bench.profile = profile;
    forgetOnce(profile);
    bench.pressed.clear();
    for (const screen of allScreens) load(screen, screen.address ?? bench.address, profile);
    drawRail();
  }

  // What a screen says it did. A press or a scroll in the lead goes to the others; a page change brings any that didn't follow along.
  window.zaismaBench = {
    heard(screenName, groupName, message) {
      const screen = screens[screenName];
      if (!screen) return;
      if (message.kind === "page") return heardPage(screen, message);
      if (message.kind === "open") { if (!big) openBig(screen); return; }
      if (big) { big.isChanged = true; if (message.kind === "click") big.lastDone = { kind: "click", message, address: screen.address }; return; }
      bench.leadName = screenName;
      if (message.kind === "click") bench.lastDone = { kind: "click", message, address: bench.address };
      for (const other of allScreens) {
        if (other === screen) continue;
        const isFollowed = screenApi(other)?.copy(message);
        if (message.kind !== "scroll") followNote(other, isFollowed === false);
      }
    },
    ready() {},
  };
  function heardPage(screen, { address, isSignedIn }) {
    const before = screen.address;
    screen.address = address;
    if (big?.screen === screen) return;
    if (screen.name === bench.leadName || bench.leadName === null) {
      if (address !== bench.address) bench.pressed.clear();
      bench.address = address;
      bench.isSignedIn = isSignedIn;
      const place = data.places.find((each) => new RegExp(each.pathPattern).test(address));
      bench.placeValue = place?.placeValue ?? null;
      drawRail();
    }
    if (bench.leadName === screen.name && before !== address) {
      setTimeout(() => {
        for (const other of allScreens) {
          if (other !== screen && other !== big?.screen && other.address !== bench.address) { followNote(other, false); load(other, bench.address, bench.profile); }
        }
      }, CATCH_UP_MS);
    }
    allScreens.forEach((each) => followNote(each, false));
  }

  for (const screen of allScreens) {
    screen.frame.addEventListener("load", () => {
      applyLook(screen);
      const pending = screen.pending;
      screen.pending = [];
      pending.forEach((run) => run());
      if (screen === screens.phone) { drawRail(); checkLooks(); }
    });
  }

  // The rail's presses, and a screen's black body or its name, which open it as a press on its page would.
  document.addEventListener("click", (event) => {
    const opening = event.target.closest?.("[data-bench-screen-name], .bench-body");
    if (opening) {
      const screen = screens[opening.dataset.benchScreenName ?? opening.closest("[data-bench-screen]").dataset.benchScreen];
      if (!big) openBig(screen);
      return;
    }
    const target = event.target.closest?.("button, a");
    if (!target) return;
    const { dataset } = target;
    if (dataset.benchState !== undefined) return pressState(dataset.benchState);
    if (dataset.benchPlace !== undefined) { closeMenus(); return goToPlace(dataset.benchPlace); }
    if (dataset.benchProfile !== undefined) { closeMenus(); return switchProfile(dataset.benchProfile); }
    if (dataset.benchBigProfile !== undefined) { closeMenus(); return switchProfile(dataset.benchBigProfile); }
    if (dataset.benchReplay !== undefined || dataset.benchBigReplay !== undefined) return replay();
    if (dataset.benchSlow !== undefined) { bench.isSlow = !bench.isSlow; setPressed(target, bench.isSlow); allScreens.forEach(applyLook); return; }
    if (dataset.benchBigSlow !== undefined) { big.isSlow = !big.isSlow; setPressed(target, big.isSlow); applyLook(big.screen); return; }
    if (dataset.benchDark !== undefined) { bench.isDark = !bench.isDark; setPressed(target, bench.isDark); allScreens.forEach(applyLook); return; }
    if (dataset.benchBigDark !== undefined) { big.isDark = !big.isDark; setPressed(target, big.isDark); applyLook(big.screen); return; }
    if (dataset.benchBigClose !== undefined) return closeBig();
    if (dataset.benchMoving !== undefined) { bench.isMoving = !bench.isMoving; setPressed(target, bench.isMoving); for (const screen of allScreens) load(screen, screen.address ?? bench.address, bench.profile); return; }
    if (dataset.benchSeen !== undefined) { bench.isOnlyUnseen = !bench.isOnlyUnseen; setPressed(target, bench.isOnlyUnseen); return drawRail(); }
    if (dataset.benchOnPhoneButton !== undefined) drawQrCode();
    if (dataset.benchFindState !== undefined) { closeFind(); return goToState(dataset.benchFindState); }
    if (dataset.benchFindPlace !== undefined) { closeFind(); return goToPlace(dataset.benchFindPlace); }
    if (dataset.benchFindProfile !== undefined) { closeFind(); return switchProfile(dataset.benchFindProfile); }
  });
  const closeMenus = () => { for (const menu of $$(".bench-rail [popover]:popover-open, .bench-big-tools [popover]:popover-open")) menu.hidePopover(); };

  function goToState(key) {
    const state = stateOf(key);
    if (bench.placeValue !== state.placeValue) { bench.placeValue = state.placeValue; bench.pressed.clear(); drawRail(); }
    if (!bench.pressed.has(key)) pressState(key);
  }

  function replay() {
    const done = big?.lastDone ?? bench.lastDone;
    const inPlay = activeScreens();
    if (!done) { for (const screen of inPlay) load(screen, screen.address ?? bench.address, big?.screen === screen ? big.profile : bench.profile); return; }
    const pauseMs = REPLAY_PAUSE_MS * (lookOf(inPlay[0]).isSlow ? 1 / SLOW_RATE : 1);
    if (done.kind === "click") {
      for (const screen of inPlay) load(screen, done.address, big?.screen === screen ? big.profile : bench.profile, () => screenApi(screen)?.copy(done.message));
      return;
    }
    const state = stateOf(done.key);
    if (state.isOwnPage) { for (const screen of inPlay) load(screen, state.path, big?.screen === screen ? big.profile : bench.profile, () => { if (state.stepsToTake) stepThrough(screen, state.stepsToTake, () => {}); else enterOn(screen, state); }); return; }
    for (const screen of inPlay) screenApi(screen)?.leaveState(state);
    setTimeout(() => { for (const screen of inPlay) enterOn(screen, state); }, pauseMs);
  }

  // The slider: every animation in the light box held where it's dragged to; let go at the end, they run on.
  const scrub = $("#bench-big-scrub");
  if (scrub) scrub.addEventListener("input", () => { if (big) screenApi(big.screen)?.scrub(Number(scrub.value) === 100 ? null : Number(scrub.value) / 100); });

  // The find box: every state, place and profile, or a /address to go to.
  const findBox = $("form.find input[type=search], form.find input");
  const findList = $("#bench-find-list");
  const closeFind = () => { if (findList.matches(":popover-open")) findList.hidePopover(); findBox.value = ""; };
  const MAXIMUM_FOUND = 14;
  const drawFound = () => {
    const typed = findBox.value.trim().toLowerCase();
    let count = 0;
    for (const row of $$("[role=menuitem]", findList)) {
      const isFound = typed.length > 0 && count < MAXIMUM_FOUND && row.textContent.toLowerCase().includes(typed);
      row.hidden = !isFound;
      if (isFound) count += 1;
    }
    if (count > 0 && !findList.matches(":popover-open")) findList.showPopover();
    if (count === 0 && findList.matches(":popover-open")) findList.hidePopover();
  };
  findBox.addEventListener("input", drawFound);
  findBox.closest("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const typed = findBox.value.trim();
    if (typed.startsWith("/")) { closeFind(); bench.pressed.clear(); for (const screen of activeScreens()) load(screen, typed, big?.screen === screen ? big.profile : bench.profile); return; }
    $("[role=menuitem]:not([hidden])", findList)?.click();
  });

  function drawQrCode() {
    const key = [...bench.pressed].at(-1);
    const url = new URL(big?.screen.address ?? bench.address, data.phoneOrigin);
    url.searchParams.set("bench_screen", `real.real.${big?.profile ?? bench.profile}.still`);
    if (key) url.searchParams.set("bench_state", key);
    $("#bench-qr").src = `/__preview/bench/qr?text=${encodeURIComponent(url.href)}`;
    const caption = $("#bench-qr-caption");
    if (caption) caption.textContent = url.href;
  }

  addEventListener("resize", fit);

  // The first look: what the address asks for.
  (async () => {
    bench.seen = await (await fetch("/__preview/bench/seen")).json();
    fit();
    const { placeValue, profile, stateValue, page } = data.asked;
    if (profile) bench.profile = profile;
    if (page) { for (const screen of allScreens) load(screen, page, bench.profile); bench.address = page; drawRail(); return; }
    const place = placeOf(placeValue ?? "home") ?? placeOf("home");
    const key = stateValue && stateOf(`${place.placeValue}/${stateValue}`) ? `${place.placeValue}/${stateValue}` : null;
    bench.placeValue = place.placeValue;
    if (key) { goToState(key); drawRail(); return; }
    goToPlace(place.placeValue);
  })();
})();
