// The preview's feedback overlay, on every page of the local preview only (scripts/preview/workers/site.mjs adds it; zaisma.com
// never has it). Julius presses Feedback, clicks a thing, drags a box over an area or picks This page, and writes a comment; it's saved with the
// page, the screen size, light or dark, the scroll, the spot, the component and rule under it (the layout inspector's
// window.zaismaInspect, which the preview's site entry loads first when the site has it, else the element's class), the seen picture
// (the page as he saw it, drawn on his own device the moment he picked the spot: below), and what he did on the page before (pointing,
// clicks, touches, keys and scrolling, never what goes into a password field) for the session to replay (feedback-pictures.mjs).
// Open comments show as pins; a session's replies show in the list, where he answers back or closes one. His box stays on what it
// was drawn over as the page scrolls, the comment field is big enough that a phone doesn't zoom in to it (and the page is back at its
// zoom after), and over an open sheet or menu the overlay moves into it, so he can comment on what's in it.
// In a frame (the gallery's Screens page) it has no button of its own: the top page asks it what's under a click or a box, as a
// comment on the frame's own page and size, and shows the spot and the form itself, at full size however small Screens draws the frame. It never starts in headless Chrome, so the measuring check and the pictures never
// see it. Everything is in a shadow root, so page styles don't reach it and its styles don't reach the page.
(() => {
  if (/HeadlessChrome/.test(navigator.userAgent) || window.__zaismaPreviewFeedback) return;
  // What the top page calls on a frame's overlay, to know what a click or a box over the frame is on (below).
  const overlayApi = (window.__zaismaPreviewFeedback = {});

  const API = "/__preview/feedback";
  const CHECK_EVERY_MS = 10_000;
  const DRAG_THRESHOLD_PX = 6;
  const PHONE_WIDTH_PX = 560;
  const SEEN_PICTURE_TIMEOUT_MS = 20_000;
  const isInFrame = window.top !== window;
  const MESSAGE = "zaisma-preview-feedback";

  const state = {
    mode: "off", // off | picking | writing | panel
    comments: [],
    openCommentCount: 0,
    draft: null, // { box, component, layout_rule, element_class, element_text, snapshot_html }
    threadId: null,
    isShowingClosed: false,
    notice: "",
  };

  const pageUrl = () => location.pathname + location.search + location.hash;
  const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
  const theme = () => {
    const shown = document.documentElement.getAttribute("data-theme");
    return shown === "light" || shown === "dark" ? shown : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  };

  // Same-origin frames on this page (the Screens page's), each with its page.
  function frames() {
    return [...document.querySelectorAll("iframe")].flatMap((frame) => {
      try {
        const frameLocation = frame.contentWindow.location;
        if (frameLocation.origin !== location.origin) return [];
        return [{ frame, url: frameLocation.pathname + frameLocation.search + frameLocation.hash }];
      } catch {
        return [];
      }
    });
  }
  const toTop = (message) => isInFrame && window.parent.postMessage({ [MESSAGE]: true, ...message }, location.origin);

  // ---- The overlay's own elements ----
  const host = document.createElement("zaisma-preview-feedback");
  // Inline and important: inside a sheet (below), the sheet's own rules for what's in it don't move or clip the overlay, nor do a popover's.
  host.style.cssText = "position:fixed!important;inset:0!important;width:auto!important;height:auto!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;overflow:visible!important;display:block!important;transform:none!important;opacity:1!important;pointer-events:none!important;z-index:2147483647!important";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
:host{all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;
  --surface:#1b1e23;--raised:#24282e;--text:#eceef0;--muted:#9aa0a8;--line:#353a42;--accent:#ff6a1f;--on-accent:#1a0c03;--shade:rgba(0,0,0,.45);color:var(--text)}
:host([data-theme=light]){--surface:#fff;--raised:#f2f3f5;--text:#16191d;--muted:#5d636b;--line:#d5d8dc;--shade:rgba(20,24,30,.18)}
*{box-sizing:border-box}
button,textarea{font:inherit;color:inherit}
button{cursor:pointer;border:0;background:none;padding:0}
.catcher{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;touch-action:none;display:none}
.picking .catcher{display:block}
.mark{position:fixed;pointer-events:none;margin:-4px 0 0 -4px;padding:4px;box-sizing:content-box;border:2px solid var(--accent);border-radius:6px;box-shadow:0 0 0 2px var(--surface),inset 0 0 0 1px var(--surface);background:color-mix(in srgb,var(--accent) 8%,transparent);display:none}
.mark.drag{border-style:dashed}
.chip{position:fixed;pointer-events:none;background:var(--accent);color:var(--on-accent);font-size:12px;font-weight:600;padding:2px 6px;border-radius:4px;white-space:nowrap;display:none;max-width:70vw;overflow:hidden;text-overflow:ellipsis}
.pin{position:fixed;pointer-events:auto;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50% 50% 50% 4px;background:var(--accent);color:var(--on-accent);font-weight:700;font-size:12px;display:grid;place-items:center;box-shadow:0 2px 8px var(--shade),0 0 0 2px var(--surface)}
.pin.unread::after{content:"";position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:50%;background:#3d8bff;box-shadow:0 0 0 2px var(--surface)}
.box{background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 32px var(--shade);pointer-events:auto}
.launcher{position:fixed;right:16px;bottom:16px;height:40px;padding:0 14px;display:flex;gap:8px;align-items:center;border-radius:20px;font-weight:600;font-size:13px;background:var(--surface);border:1px solid var(--line);box-shadow:0 4px 16px var(--shade);pointer-events:auto}
.launcher.on{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.count{min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--accent);color:var(--on-accent);font-size:12px;display:grid;place-items:center}
.launcher.on .count{background:var(--on-accent);color:var(--accent)}
.dot{width:8px;height:8px;border-radius:50%;background:#3d8bff}
.bar{position:fixed;top:12px;left:50%;transform:translateX(-50%);display:flex;gap:6px;align-items:center;padding:6px 6px 6px 14px;max-width:calc(100vw - 24px);font-size:13px}
.bar span{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.small{height:30px;padding:0 12px;border-radius:8px;font-weight:600;font-size:13px;background:var(--raised);white-space:nowrap}
.primary{background:var(--accent);color:var(--on-accent)}
.small:disabled{opacity:.5;cursor:default}
.card{position:fixed;width:320px;padding:12px;display:flex;flex-direction:column;gap:10px}
.panel{position:fixed;right:16px;bottom:68px;width:340px;max-height:min(70vh,600px);display:flex;flex-direction:column;overflow:hidden}
.phone .card,.phone .panel{left:0;right:0;bottom:0;top:auto;width:auto;border-radius:14px 14px 0 0;border-bottom:0}
.phone .panel{max-height:60vh}
.phone .launcher{right:12px;bottom:12px}
.head{display:flex;align-items:center;gap:8px;padding:12px 12px 10px;border-bottom:1px solid var(--line)}
.head strong{flex:1;font-size:14px}
.scroll{overflow:auto;padding:6px}
.foot{display:flex;gap:8px;justify-content:space-between;align-items:center;padding:10px 12px;border-top:1px solid var(--line)}
.item{display:flex;gap:10px;width:100%;text-align:left;padding:8px;border-radius:8px;align-items:flex-start}
.item:hover{background:var(--raised)}
.number{flex:none;width:22px;height:22px;border-radius:50% 50% 50% 3px;background:var(--accent);color:var(--on-accent);font-size:11px;font-weight:700;display:grid;place-items:center;margin-top:1px}
.closed .number{background:var(--raised);color:var(--muted)}
.item div{min-width:0;flex:1}
.line{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{display:block;color:var(--muted);font-size:12px}
.label{color:var(--muted);font-size:12px;overflow-wrap:anywhere}
.label b{color:var(--text);font-weight:600}
textarea{width:100%;min-height:76px;resize:vertical;padding:8px 10px;font-size:16px;border-radius:8px;border:1px solid var(--line);background:var(--raised);outline:none}
textarea:focus{border-color:var(--accent)}
.row{display:flex;gap:8px;justify-content:flex-end;align-items:center}
.row .spacer{flex:1}
.message{padding:8px 10px;border-radius:8px;background:var(--raised);white-space:pre-wrap;overflow-wrap:anywhere}
.message.session{background:color-mix(in srgb,#3d8bff 14%,var(--surface))}
.who{display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:2px}
.thread{display:flex;flex-direction:column;gap:8px;padding:6px}
.empty{padding:18px 12px;color:var(--muted);text-align:center}
.link{color:var(--muted);font-size:12px;text-decoration:underline}
.notice{position:fixed;left:50%;bottom:68px;transform:translateX(-50%);padding:8px 14px;font-size:13px;white-space:nowrap}
</style>
<div class="layer">
  <div class="catcher"></div>
  <div class="mark"></div>
  <div class="chip"></div>
  <div class="pins"></div>
  <div class="ui"></div>
</div>`;
  const layer = root.querySelector(".layer");
  const catcher = root.querySelector(".catcher");
  const mark = root.querySelector(".mark");
  const chip = root.querySelector(".chip");
  const pins = root.querySelector(".pins");
  const ui = root.querySelector(".ui");
  // The page's own shortcuts don't fire while he types here.
  for (const type of ["keydown", "keyup", "keypress"]) host.addEventListener(type, (event) => event.composedPath()[0]?.tagName === "TEXTAREA" && event.stopPropagation());

  // ---- What's under the pointer ----
  const elementAt = (x, y) => document.elementsFromPoint(x, y).find((element) => element !== host && element !== document.documentElement) ?? document.body;

  function describe(element) {
    let inspected = null;
    try {
      inspected = typeof window.zaismaInspect === "function" ? window.zaismaInspect(element) : null;
    } catch {}
    let classed = element;
    while (classed && classed !== document.body && !(typeof classed.className === "string" && classed.className.trim())) classed = classed.parentElement;
    const elementClass = classed && typeof classed.className === "string" ? classed.className.trim() : "";
    return {
      // The inspector's element is the component's own, to outline on a click.
      componentElement: inspected?.element instanceof Element ? inspected.element : null,
      component: inspected?.component ?? null,
      layout_rule: inspected?.layoutRule ?? null,
      element_class: elementClass,
      element_text: (inspected?.label || element.innerText || element.getAttribute?.("aria-label") || element.getAttribute?.("alt") || "").trim().replace(/\s+/g, " ").slice(0, 80),
      tag: element.tagName.toLowerCase(),
    };
  }
  const describedAs = (described) => (described.is_page_comment ? "<b>The whole page</b>" : described.component ? `<b>${esc(described.component)}</b>${described.layout_rule ? ` · ${esc(described.layout_rule)}` : ""}` : described.element_class ? `<b>.${esc(described.element_class.split(/\s+/).join("."))}</b>` : `<b>${esc(described.tag ?? "")}</b>`);
  const chipText = (described) => described.component ?? (described.element_class ? `.${described.element_class.split(/\s+/)[0]}` : described.tag);

  // ---- The "seen" picture: drawn on this device from the page as it is the moment he picks a spot ----
  // The page is copied at once (form values, scroll, inner scrolls, open sheets and menus, stuck headers, animations where they
  // were), its canvases a frame later (a WebGL canvas reads only in the frame it drew), and the copy is drawn by this browser itself
  // as an SVG image, with the page's styles, fonts and on-screen pictures carried inside it: his fonts, his screen, his state. A frame
  // from another site (a game) can't be read by the page: a moving background shows as its still, anything else as a marked
  // placeholder, and the comment says so (seen_picture_note). If this browser won't hand back what it drew, the SVG goes to the
  // feedback server, whose Chrome draws it.
  const TRANSPARENT_PICTURE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const MAXIMUM_PICTURE_SCALE = 2;
  const CANVAS_WAIT_FRAME_COUNT = 12;
  const MAXIMUM_INLINED_FILE_BYTES = 8 * 1024 * 1024;
  const URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/g;
  // A hidden page draws no frames: it waits a moment instead.
  const nextFrame = () => new Promise((done) => (requestAnimationFrame(() => done()), setTimeout(done, 100)));
  const waitMs = (ms) => new Promise((done) => setTimeout(done, ms));
  const matchesSafely = (element, selector) => {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  };
  const isOnScreen = (rect, marginPx = 0) => rect.width > 0 && rect.height > 0 && rect.right > -marginPx && rect.bottom > -marginPx && rect.left < innerWidth + marginPx && rect.top < innerHeight + marginPx;

  // Which canvases are WebGL, for the note when one hadn't drawn: only the contexts made after this script, the rest are a guess.
  const webglCanvases = new WeakSet();
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const context = getContext.call(this, type, ...rest);
    if (context && /webgl/.test(String(type))) webglCanvases.add(this);
    return context;
  };

  // Files the picture carries inside it (fonts, pictures), kept across comments.
  const inlined = new Map();
  function dataUrlOf(url) {
    if (!inlined.has(url)) {
      inlined.set(url, (async () => {
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`${response.status}`);
        const blob = await response.blob();
        if (blob.size > MAXIMUM_INLINED_FILE_BYTES) throw new Error("too big");
        return await new Promise((done, fail) => {
          const reader = new FileReader();
          reader.onload = () => done(reader.result);
          reader.onerror = () => fail(reader.error);
          reader.readAsDataURL(blob);
        });
      })().catch((error) => (inlined.delete(url), Promise.reject(error))));
    }
    return inlined.get(url);
  }
  const absoluteUrl = (raw, base) => {
    try {
      return new URL(raw, base).href;
    } catch {
      return null;
    }
  };
  /** CSS text with every url() made absolute, so the picture's files can be swapped in for them. */
  const absoluteUrls = (text, base) => text.replace(URL_PATTERN, (whole, double, single, bare) => {
    const raw = double ?? single ?? bare;
    if (!raw || raw.startsWith("data:") || raw.startsWith("#")) return whole;
    const url = absoluteUrl(raw, base);
    return url ? `url("${url}")` : whole;
  });
  const urlsIn = (value, into) => {
    for (const [, double, single, bare] of String(value).matchAll(URL_PATTERN)) {
      const url = double ?? single ?? bare;
      if (url && !url.startsWith("data:") && /^https?:/.test(url)) into.add(url);
    }
  };

  /** A stand-in for a canvas, picture, video or frame in the copy, the original's size where it was, keeping its class and style. */
  function standIn(original, tag) {
    const element = document.createElement(tag);
    for (const name of ["id", "class", "style"]) if (original.hasAttribute(name)) element.setAttribute(name, original.getAttribute(name));
    const computed = getComputedStyle(original);
    for (const [name, value] of [["display", computed.display === "inline" ? "inline-block" : computed.display], ["box-sizing", "border-box"], ["width", `${original.offsetWidth}px`], ["height", `${original.offsetHeight}px`]]) element.style.setProperty(name, value, "important");
    if (tag === "img") element.style.setProperty("object-fit", "fill", "important");
    return element;
  }
  function placeholder(original, words) {
    const element = standIn(original, "div");
    for (const [name, value] of [["display", "flex"], ["align-items", "center"], ["justify-content", "center"], ["padding", "12px"], ["overflow", "hidden"], ["background", "repeating-linear-gradient(135deg,#2a2e35 0 12px,#22252b 12px 24px)"], ["color", "#d5d8dc"], ["font", "600 13px/1.4 system-ui,-apple-system,sans-serif"], ["text-align", "center"], ["outline", "2px dashed #ff6a1f"], ["outline-offset", "-2px"]]) element.style.setProperty(name, value, "important");
    element.textContent = words;
    return element;
  }

  /**
   * The page copied as it is this moment: { copy, canvases, frames, pictures, urls, styledCopies, background }. Nothing here waits,
   * so the copy is the moment he picked.
   */
  function copyPage() {
    const originals = [document.documentElement, ...document.documentElement.querySelectorAll("*")];
    const copy = document.documentElement.cloneNode(true);
    const copies = [copy, ...copy.querySelectorAll("*")];
    if (copies.length !== originals.length) throw new Error("The page changed while it was copied.");
    const copyOf = new Map(originals.map((original, index) => [original, copies[index]]));
    const found = { copy, canvases: [], frames: [], pictures: [], urls: new Set(), styledCopies: [], pinned: new Set() };
    const removed = [];
    const shiftOf = new Map(); // an inner scroll's children, moved by its scroll
    const scrolling = document.scrollingElement;
    let topLayerCount = 0;
    for (const [index, original] of originals.entries()) {
      const twin = copies[index];
      const tag = original.localName;
      if (original === host || ["script", "noscript", "link", "style", "base", "source"].includes(tag) || (tag === "meta" && original.hasAttribute("http-equiv"))) {
        removed.push(twin);
        continue;
      }
      const computed = getComputedStyle(original);
      const rect = original.getBoundingClientRect();
      const shift = shiftOf.get(original);
      if (twin.getAttribute("style")?.includes("url(")) found.styledCopies.push(twin);

      // Where it sits: a stuck header where it was stuck, an inner scroll's children where it had scrolled them.
      if (computed.position === "sticky") {
        const inline = [original.style.getPropertyValue("position"), original.style.getPropertyPriority("position")];
        original.style.setProperty("position", "static", "important");
        const unstuck = original.getBoundingClientRect();
        original.style.setProperty("position", inline[0], inline[1]);
        if (!inline[0]) original.style.removeProperty("position");
        for (const [name, value] of [["position", "relative"], ["top", `${rect.top - unstuck.top}px`], ["left", `${rect.left - unstuck.left}px`], ["bottom", "auto"], ["right", "auto"]]) twin.style.setProperty(name, value, "important");
      }
      if (shift && computed.position !== "fixed" && (shift.x || shift.y)) {
        // By margins, not by positioning, which would paint it over what it was under.
        twin.style.setProperty("margin-top", `${(parseFloat(computed.marginTop) || 0) + shift.y}px`, "important");
        twin.style.setProperty("margin-left", `${(parseFloat(computed.marginLeft) || 0) + shift.x}px`, "important");
      }
      if (original !== scrolling && original !== document.documentElement && original !== document.body && (original.scrollTop || original.scrollLeft)) {
        // A margin moves the rest of a flow along with it, so only the first in the flow's direction takes that axis; a grid's items
        // and anything out of the flow each take their own.
        const display = computed.display, direction = computed.flexDirection;
        const isGrid = display.includes("grid"), isFlex = display.includes("flex");
        const flowAxis = isGrid ? null : isFlex && direction.startsWith("row") ? "x" : "y";
        let isFirst = true;
        for (const child of original.children) {
          const position = getComputedStyle(child).position;
          const isInFlow = position === "static" || position === "relative" || position === "sticky";
          const takes = (axis) => !isInFlow || axis !== flowAxis || isFirst;
          shiftOf.set(child, { x: takes("x") ? -original.scrollLeft : 0, y: takes("y") ? -original.scrollTop : 0 });
          if (isInFlow && getComputedStyle(child).display !== "none") isFirst = false;
        }
      }

      // An open sheet or menu (the top layer) where it was on screen, over the page, with a sheet's dimming behind it.
      const isTopLayer = (tag === "dialog" && original.open && matchesSafely(original, ":modal")) || matchesSafely(original, ":popover-open");
      if (isTopLayer && original.getClientRects().length) {
        topLayerCount += 1;
        twin.removeAttribute("popover");
        if (tag === "dialog") {
          twin.setAttribute("open", "");
          const backdrop = getComputedStyle(original, "::backdrop");
          const dimming = document.createElement("div");
          dimming.setAttribute("style", `position:fixed;inset:0;z-index:${2147480000 + topLayerCount * 2};background-color:${backdrop.backgroundColor};background-image:${backdrop.backgroundImage};opacity:${backdrop.opacity};backdrop-filter:${backdrop.backdropFilter || "none"};-webkit-backdrop-filter:${backdrop.webkitBackdropFilter || backdrop.backdropFilter || "none"}`);
          twin.before(dimming);
        }
        for (const [name, value] of [["position", "fixed"], ["inset", "auto"], ["left", `${rect.left}px`], ["top", `${rect.top}px`], ["width", `${rect.width}px`], ["height", `${rect.height}px`], ["box-sizing", "border-box"], ["max-width", "none"], ["max-height", "none"], ["margin", "0"], ["transform", "none"], ["translate", "none"], ["scale", "none"], ["z-index", String(2147480001 + topLayerCount * 2)], ["display", computed.display]]) twin.style.setProperty(name, value, "important");
        found.pinned.add(original);
      }

      // What he typed and chose, never a password.
      if (tag === "input") {
        if (original.type === "checkbox" || original.type === "radio") original.checked ? twin.setAttribute("checked", "") : twin.removeAttribute("checked");
        else if (original.type === "password") twin.setAttribute("value", "•".repeat(original.value.length));
        else if (original.type !== "file") twin.setAttribute("value", original.value);
      } else if (tag === "textarea") twin.textContent = original.value;
      else if (tag === "select") [...twin.options].forEach((option, at) => (original.options[at]?.selected ? option.setAttribute("selected", "") : option.removeAttribute("selected")));

      // Pictures, canvases, videos and frames on screen are filled in after; off screen, an empty box of their size.
      const isShown = isOnScreen(rect, 64);
      if (tag === "img") {
        twin.removeAttribute("srcset");
        twin.removeAttribute("sizes");
        twin.removeAttribute("loading");
        if (isShown && original.currentSrc && !original.currentSrc.startsWith("data:")) found.pictures.push({ copy: twin, url: original.currentSrc });
        else if (!original.currentSrc?.startsWith("data:")) twin.setAttribute("src", TRANSPARENT_PICTURE);
        if (!isShown) for (const [name, value] of [["width", `${original.offsetWidth}px`], ["height", `${original.offsetHeight}px`], ["box-sizing", "border-box"]]) twin.style.setProperty(name, value, "important");
      } else if (tag === "canvas" || tag === "video" || tag === "iframe" || tag === "embed" || tag === "object") {
        if (!isShown) twin.replaceWith(standIn(original, "div"));
        else if (tag === "canvas") found.canvases.push({ original, copy: twin });
        else if (tag === "video") {
          let still = null;
          try {
            const board = document.createElement("canvas");
            board.width = original.videoWidth;
            board.height = original.videoHeight;
            board.getContext("2d").drawImage(original, 0, 0);
            still = board.toDataURL("image/jpeg", 0.85);
          } catch {}
          const picture = still ? standIn(original, "img") : placeholder(original, "Video: not in this picture");
          if (still) picture.src = still;
          twin.replaceWith(picture);
        } else found.frames.push({ original, copy: twin, rect });
      }

      // The files its look needs, only for what's on screen.
      if (isOnScreen(rect) || original === document.documentElement || original === document.body) {
        for (const pseudo of [null, "::before", "::after"]) {
          const style = pseudo ? getComputedStyle(original, pseudo) : computed;
          if (pseudo && (style.content === "none" || style.content === "normal")) continue;
          for (const name of ["background-image", "mask-image", "-webkit-mask-image", "border-image-source", "list-style-image", "content"]) urlsIn(style.getPropertyValue(name), found.urls);
        }
      }
    }

    // Animations and transitions where they were this moment, not from their start.
    for (const animation of document.getAnimations?.() ?? []) {
      const target = animation.effect?.target;
      if (!target || animation.effect.pseudoElement || !copyOf.has(target)) continue;
      const twin = copyOf.get(target), computed = getComputedStyle(target);
      const names = new Set(animation.effect.getKeyframes().flatMap((keyframe) => Object.keys(keyframe)));
      for (const name of names) {
        if (["offset", "computedOffset", "easing", "composite"].includes(name)) continue;
        const property = name === "cssFloat" ? "float" : name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        if (found.pinned.has(target) && ["transform", "translate", "scale", "rotate"].includes(property)) continue;
        const value = computed.getPropertyValue(property);
        if (value) twin.style.setProperty(property, value, "important");
      }
    }
    for (const element of removed) element.remove();

    const backgroundOf = (element) => getComputedStyle(element).backgroundColor;
    const isClear = (color) => !color || color === "transparent" || /rgba\(.*,\s*0\)$/.test(color);
    found.background = [backgroundOf(document.documentElement), document.body ? backgroundOf(document.body) : ""].find((color) => !isClear(color)) ?? (theme() === "dark" ? "#000" : "#fff");
    // The browser draws the body's background under the whole page when the html has none; in the copy the html draws it, under
    // what sits behind the page (a fixed backdrop at a negative z-index), as the browser did.
    const body = copy.querySelector("body"), rootStyle = getComputedStyle(document.documentElement);
    if (body && document.body && isClear(rootStyle.backgroundColor) && rootStyle.backgroundImage === "none") {
      const bodyStyle = getComputedStyle(document.body);
      for (const name of ["background-color", "background-image", "background-size", "background-position", "background-repeat"]) copy.style.setProperty(name, bodyStyle.getPropertyValue(name), "important");
      body.style.setProperty("background", "none", "important");
    }
    return found;
  }

  /** Each canvas a frame or more later, after the page's own frame drew: a WebGL canvas reads blank once its frame is shown. */
  async function fillCanvases(canvases, notes) {
    const tiny = document.createElement("canvas");
    tiny.width = tiny.height = 4;
    const tinyContext = tiny.getContext("2d", { willReadFrequently: true });
    const isFlat = (canvas) => {
      try {
        tinyContext.clearRect(0, 0, 4, 4);
        tinyContext.drawImage(canvas, 0, 0, 4, 4);
        const pixels = tinyContext.getImageData(0, 0, 4, 4).data;
        for (let at = 4; at < pixels.length; at++) if (pixels[at] !== pixels[at % 4]) return false;
        return true;
      } catch {
        return false;
      }
    };
    const waiting = new Set(canvases);
    for (let frame = 0; frame <= CANVAS_WAIT_FRAME_COUNT && waiting.size; frame++) {
      await nextFrame();
      for (const canvas of [...waiting]) {
        const isLast = frame === CANVAS_WAIT_FRAME_COUNT;
        if (!isLast && canvas.original.width && isFlat(canvas.original)) continue;
        waiting.delete(canvas);
        let still = null;
        try {
          still = canvas.original.toDataURL();
        } catch {}
        if (isLast && webglCanvases.has(canvas.original)) notes.add("a WebGL canvas hadn't drawn while it was pictured, so it may show blank");
        const picture = still ? standIn(canvas.original, "img") : placeholder(canvas.original, "Canvas: not readable");
        if (still) picture.src = still;
        else notes.add("a canvas the page can't read is a placeholder");
        canvas.copy.replaceWith(picture);
      }
    }
  }

  /** Frames on screen: a frame of this site is pictured by its own overlay; a frame from another site can't be read. */
  async function fillFrames(frames, notes, scale) {
    await Promise.all(frames.map(async ({ original, copy, rect }) => {
      let picture = null;
      try {
        const overlay = original.contentWindow?.__zaismaPreviewFeedback;
        if (overlay?.pictureSeen) {
          const frameScale = original.offsetWidth ? (rect.width / original.offsetWidth) * scale : scale;
          const seen = await overlay.pictureSeen({ scale: Math.max(0.5, frameScale) });
          if (seen.pngBase64) picture = `data:image/png;base64,${seen.pngBase64}`;
          for (const note of seen.notes ?? []) notes.add(note);
        }
      } catch {}
      if (!picture && original.dataset?.backdropStill) {
        picture = await dataUrlOf(absoluteUrl(original.dataset.backdropStill, location.href)).catch(() => null);
        if (picture) notes.add("the moving background shows as its still");
      }
      if (picture) {
        const shown = standIn(original, "img");
        shown.src = picture;
        if (original.dataset?.backdropStill) shown.style.setProperty("object-fit", "cover", "important");
        return copy.replaceWith(shown);
      }
      const named = original.id === "game" ? "the game" : original.title ? `“${original.title}”` : "a frame";
      notes.add(`a frame from another site (${named}) is a marked placeholder: the page can't read it, the live picture has it`);
      copy.replaceWith(placeholder(original, `Another site's frame (${named}): not in this picture. The live picture shows it.`));
    }));
  }

  /** The page's styles as one sheet: media queries settled as they were on this screen, :root as the copy's html, sheets' url()s absolute. */
  function pageStyles(fontUrls) {
    const loadedFaces = [...(document.fonts ?? [])].filter((face) => face.status === "loaded");
    const plain = (text) => String(text ?? "").replace(/^["']|["']$/g, "").trim().toLowerCase();
    const ranges = (text) => String(text ?? "").toUpperCase().replace(/\s+/g, "");
    const isUsedFace = (rule) => {
      const family = plain(rule.style.getPropertyValue("font-family")), range = ranges(rule.style.getPropertyValue("unicode-range"));
      return loadedFaces.some((face) => plain(face.family) === family && (!range || !face.unicodeRange || ranges(face.unicodeRange) === range || ranges(face.unicodeRange) === "U+0-10FFFF"));
    };
    const rulesText = (rules, base) => {
      let text = "";
      for (const rule of rules) {
        const kind = rule.constructor?.name ?? "";
        if (kind === "CSSImportRule") {
          if (rule.styleSheet && (!rule.media?.mediaText || matchMedia(rule.media.mediaText).matches)) text += sheetText(rule.styleSheet);
        } else if (kind === "CSSMediaRule") {
          if (matchMedia(rule.media.mediaText).matches) text += rulesText(rule.cssRules, base);
        } else if (kind === "CSSSupportsRule") text += `@supports ${rule.conditionText}{${rulesText(rule.cssRules, base)}}`;
        else if (kind === "CSSLayerBlockRule") text += `@layer${rule.name ? ` ${rule.name}` : ""}{${rulesText(rule.cssRules, base)}}`;
        else if (kind === "CSSStartingStyleRule") continue;
        else if (kind === "CSSFontFaceRule") {
          if (!isUsedFace(rule)) continue;
          const faceText = absoluteUrls(rule.cssText, base);
          const first = /url\("([^"]+)"\)(\s*format\([^)]*\))?/.exec(faceText);
          if (!first) {
            text += faceText;
            continue;
          }
          fontUrls.add(first[1]);
          text += faceText.replace(/src\s*:[^;}]+/, `src: url("${first[1]}")${first[2] ?? ""}`);
        } else text += absoluteUrls(rule.cssText, base);
      }
      return text;
    };
    const sheetText = (sheet) => {
      if (sheet.disabled || (sheet.media?.mediaText && !matchMedia(sheet.media.mediaText).matches)) return "";
      try {
        return rulesText(sheet.cssRules, sheet.href ?? location.href);
      } catch {
        return "";
      }
    };
    const text = [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])].map(sheetText).join("\n");
    // In the picture the page's html isn't the document's root: it's the first thing in the SVG's foreignObject.
    return text.replace(/:root\b/g, ":where(html):first-child");
  }

  /** The picture, drawn here: { pngBase64 } or, when this browser won't read back what it drew, { svg } for the server to draw. */
  async function pictureSeen({ box = null, scale = Math.min(MAXIMUM_PICTURE_SCALE, Math.max(1, devicePixelRatio || 1)) } = {}) {
    const notes = new Set();
    const width = innerWidth, height = innerHeight, scrolledX = scrollX, scrolledY = scrollY;
    const found = copyPage();
    await fillCanvases(found.canvases, notes);
    await fillFrames(found.frames, notes, scale);
    const fontUrls = new Set();
    const css = pageStyles(fontUrls);
    const files = new Map();
    const wanted = [...fontUrls, ...found.urls, ...found.pictures.map((picture) => picture.url)];
    await Promise.all([...new Set(wanted)].map(async (url) => files.set(url, await dataUrlOf(url).catch(() => null))));
    const withFiles = (text) => text.replace(/url\("([^"]+)"\)/g, (whole, url) => (files.get(url) ? `url("${files.get(url)}")` : whole));
    for (const picture of found.pictures) picture.copy.setAttribute("src", files.get(picture.url) ?? TRANSPARENT_PICTURE);
    for (const twin of found.styledCopies) twin.setAttribute("style", withFiles(absoluteUrls(twin.getAttribute("style") ?? "", location.href)));
    const style = document.createElement("style");
    style.textContent = `${withFiles(css)}
*,*::before,*::after{animation:none!important;transition:none!important}
:where(html):first-child{position:relative!important;z-index:0!important;left:${-scrolledX}px!important;top:${-scrolledY}px!important;overflow:visible!important}
body{overflow:visible!important}`;
    const head = found.copy.querySelector("head") ?? found.copy;
    head.prepend(style);
    const markup = new XMLSerializer().serializeToString(found.copy);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${esc(found.background)}"/><foreignObject x="0" y="0" width="${width}" height="${height}">${markup}</foreignObject></svg>`;
    try {
      return { pngBase64: await drawn(svg, width, height, scale, box), notes: [...notes] };
    } catch {
      notes.add("drawn by the feedback server's Chrome from what this device copied, as this browser wouldn't read back its own drawing");
      return { svg, notes: [...notes] };
    }
  }

  /** The SVG drawn on a canvas at scale, with his box on it, as base64 PNG. Drawn twice: Safari leaves an SVG's pictures out the first time. */
  async function drawn(svg, width, height, scale, box) {
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await (image.decode ? image.decode() : new Promise((done, fail) => ((image.onload = done), (image.onerror = fail))));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    for (let pass = 0; pass < 2; pass++) {
      if (pass) await waitMs(120);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    }
    if (box) drawBox(context, box, scale, width, height);
    return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
  }
  /** His box as the server draws it on the other pictures: orange, a dark edge, the rest of the screen dimmed a little. */
  function drawBox(context, box, scale, width, height) {
    const rounded = (left, top, boxWidth, boxHeight, radius) => (context.roundRect ? context.roundRect(left, top, boxWidth, boxHeight, radius) : context.rect(left, top, boxWidth, boxHeight));
    const left = box.left - 3, top = box.top - 3, boxWidth = box.width + 6, boxHeight = box.height + 6;
    context.save();
    context.scale(scale, scale);
    context.beginPath();
    context.rect(0, 0, width, height);
    rounded(left, top, boxWidth, boxHeight, 4);
    context.fillStyle = "rgba(0,0,0,.12)";
    context.fill("evenodd");
    context.beginPath();
    rounded(left - 1, top - 1, boxWidth + 2, boxHeight + 2, 5);
    context.lineWidth = 2;
    context.strokeStyle = "rgba(0,0,0,.55)";
    context.stroke();
    context.beginPath();
    rounded(left + 1.5, top + 1.5, boxWidth - 3, boxHeight - 3, 3);
    context.lineWidth = 3;
    context.strokeStyle = "#ff6a1f";
    context.stroke();
    context.restore();
  }

  // ---- What he did on the page before commenting, for the replay: the last ones, a run of pointer moves or scrolls kept as its end ----
  const MAXIMUM_ACTION_COUNT = 40;
  const actions = [];
  const isOurs = (event) => event.composedPath().includes(host);
  const labelOf = (target) => (target instanceof Element && target !== document.documentElement ? chipText(describe(target)) : "");
  // An action's element is named only when a comment sends it: naming it runs the inspector and reads the layout, which in
  // WebKit held a tap's frame for most of a second and cut the start off whatever the tap set moving.
  const actionTargets = new WeakMap();
  const named = (entry) => (actionTargets.has(entry) ? { ...entry, element_label: labelOf(actionTargets.get(entry)) } : entry);
  function record(action, isRun, target) {
    const entry = { ...action, at_ms: Math.round(performance.now()) };
    if (target) actionTargets.set(entry, target);
    if (isRun && actions.at(-1)?.kind === action.kind && actions.at(-1)?.pointer_type === action.pointer_type) actions[actions.length - 1] = entry;
    else actions.push(entry);
    if (actions.length > MAXIMUM_ACTION_COUNT) actions.shift();
  }
  const pointerAction = (kind) => (event) => {
    if (isOurs(event) || !event.isPrimary) return;
    const pointerType = event.pointerType === "touch" || event.pointerType === "pen" ? "touch" : "mouse";
    // A touch only moves while it's down; a mouse's moves are where it points.
    if (kind === "move" && pointerType === "touch" && !event.pressure) return;
    record({ kind, x_px: event.clientX, y_px: event.clientY, pointer_type: pointerType, element_label: "" }, kind === "move", kind === "move" ? null : event.target);
  };
  addEventListener("pointermove", pointerAction("move"), { capture: true, passive: true });
  addEventListener("pointerdown", pointerAction("press"), { capture: true, passive: true });
  addEventListener("pointerup", pointerAction("release"), { capture: true, passive: true });
  addEventListener("keydown", (event) => {
    if (isOurs(event) || ["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key) || event.metaKey || event.ctrlKey) return;
    if (event.target?.type === "password") return;
    record({ kind: "key", key: event.key, element_label: "" }, false, event.target);
  }, { capture: true });
  addEventListener("scroll", (event) => event.target === document && record({ kind: "scroll", scroll_x_px: scrollX, scroll_y_px: scrollY }, true), { capture: true, passive: true });

  // ---- Talking to the feedback server ----
  async function call(method, path, body) {
    const response = await fetch(`${API}${path}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const answer = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(answer.error?.message ?? `The feedback server answered ${response.status}.`);
    return answer;
  }

  const shownPages = () => [pageUrl(), ...(isInFrame ? [] : frames().map(({ url }) => url))];
  let lastAnswer = "";
  async function refresh() {
    try {
      const query = shownPages().map((url) => `page_url=${encodeURIComponent(url)}`).join("&");
      const answer = await call("GET", `/comments?${query}`);
      const text = JSON.stringify(answer);
      if (text === lastAnswer) return;
      lastAnswer = text;
      state.comments = answer.comments;
      state.openCommentCount = answer.open_comment_count;
      render();
    } catch {}
  }

  // ---- Modes ----
  function setMode(mode) {
    state.mode = mode;
    if (mode !== "writing") state.draft = null;
    hideMarks();
    render();
  }
  const say = (notice) => {
    state.notice = notice;
    render();
    setTimeout(() => state.notice === notice && ((state.notice = ""), render()), 2400);
  };

  function hideMarks() {
    mark.style.display = "none";
    chip.style.display = "none";
  }
  function showMark(rect, isDrag, label) {
    Object.assign(mark.style, { display: "block", left: `${rect.left - 2}px`, top: `${rect.top - 2}px`, width: `${Math.max(rect.width, 2)}px`, height: `${Math.max(rect.height, 2)}px` });
    mark.classList.toggle("drag", isDrag);
    if (!label) return (chip.style.display = "none");
    chip.textContent = label;
    Object.assign(chip.style, { display: "block", left: `${Math.max(4, rect.left)}px`, top: `${rect.top > 32 ? rect.top - 30 : rect.top + rect.height + 10}px` });
  }

  // ---- Picking: click a thing, or drag a box ----
  let press = null;
  catcher.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    catcher.setPointerCapture(event.pointerId);
    press = { x: event.clientX, y: event.clientY, isDrag: false };
  });
  catcher.addEventListener("pointermove", (event) => {
    if (press) {
      if (!press.isDrag && Math.hypot(event.clientX - press.x, event.clientY - press.y) > DRAG_THRESHOLD_PX) press.isDrag = true;
      if (press.isDrag) showMark(dragRect(press, event), true, "");
      return;
    }
    hoverAt(event.clientX, event.clientY);
  });
  catcher.addEventListener("pointerup", (event) => {
    if (!press) return;
    const started = press;
    press = null;
    pick(started.isDrag ? dragRect(started, event) : null, event.clientX, event.clientY);
  });
  // Not when the catcher itself goes away as the form opens: the box stays on screen while he writes.
  catcher.addEventListener("pointerleave", () => !press && state.mode === "picking" && clearHover());

  // Over a same-origin frame with its own overlay, that overlay says what's there, in its own coordinates: Screens draws each frame
  // scaled down to its cell (its page keeps the screen's size), so a point goes in divided by the scale and a box comes out times it.
  function frameAt(x, y) {
    for (const { frame } of frames()) {
      const rect = frame.getBoundingClientRect();
      const scale = frame.offsetWidth ? rect.width / frame.offsetWidth : 1;
      const left = rect.left + frame.clientLeft * scale, top = rect.top + frame.clientTop * scale;
      const overlay = frame.contentWindow.__zaismaPreviewFeedback;
      if (overlay?.draftAt && x >= left && x < left + frame.clientWidth * scale && y >= top && y < top + frame.clientHeight * scale) return { overlay, frame, left, top, scale };
    }
    return null;
  }
  const intoFrame = (inFrame, rect) => rect && { left: (rect.left - inFrame.left) / inFrame.scale, top: (rect.top - inFrame.top) / inFrame.scale, width: rect.width / inFrame.scale, height: rect.height / inFrame.scale };
  const outOfFrame = (inFrame, rect) => ({ left: inFrame.left + rect.left * inFrame.scale, top: inFrame.top + rect.top * inFrame.scale, width: rect.width * inFrame.scale, height: rect.height * inFrame.scale });
  function clearHover() {
    hideMarks();
  }
  /** What's under x, y on this page: its box to outline and what to call it. */
  function markAt(x, y) {
    const element = elementAt(x, y);
    const described = describe(element);
    return { rect: (described.componentElement ?? element).getBoundingClientRect(), label: chipText(described) };
  }
  function hoverAt(x, y) {
    const inFrame = frameAt(x, y);
    const pointed = inFrame ? inFrame.overlay.markAt((x - inFrame.left) / inFrame.scale, (y - inFrame.top) / inFrame.scale) : markAt(x, y);
    showMark(inFrame ? outOfFrame(inFrame, pointed.rect) : pointed.rect, false, pointed.label);
  }
  /** A comment's draft for a click at x, y or a dragged box (rect, null for a click) on this page. */
  function draftAt(rect, x, y) {
    const atX = rect ? rect.left + rect.width / 2 : x, atY = rect ? rect.top + rect.height / 2 : y;
    const element = elementAt(atX, atY);
    const outlined = rect ? element : describe(element).componentElement ?? element;
    const shown = rect ?? outlined.getBoundingClientRect();
    return { ...draftOf(shown, element, false), anchor: anchorOf(shown, outlined) };
  }
  // The box stays on what it was drawn over as the page or a pane scrolls: where it is from that element's corner.
  const anchorOf = (rect, element) => {
    const at = element.getBoundingClientRect();
    return { element, offsetLeft: rect.left - at.left, offsetTop: rect.top - at.top, width: rect.width, height: rect.height };
  };
  const anchoredRect = (draft) => {
    if (!draft.anchor?.element?.isConnected) return draft.shownRect;
    const at = draft.anchor.element.getBoundingClientRect();
    return { left: at.left + draft.anchor.offsetLeft, top: at.top + draft.anchor.offsetTop, width: draft.anchor.width, height: draft.anchor.height };
  };
  /** A click at x, y, or a dragged box (rect, null for a click). */
  function pick(rect, x, y) {
    clearHover();
    const atX = rect ? rect.left + rect.width / 2 : x, atY = rect ? rect.top + rect.height / 2 : y;
    const inFrame = frameAt(atX, atY);
    if (!inFrame) return openDraft(draftAt(rect, x, y));
    // The frame's page and screen, shown here at full size.
    const draft = inFrame.overlay.draftAt(intoFrame(inFrame, rect), (x - inFrame.left) / inFrame.scale, (y - inFrame.top) / inFrame.scale);
    const shownRect = outOfFrame(inFrame, draft.rect);
    openDraft({ ...draft, shownRect, anchor: anchorOf(shownRect, inFrame.frame), frameOverlay: inFrame.overlay });
  }
  overlayApi.markAt = markAt;
  overlayApi.draftAt = draftAt;
  overlayApi.pictureSeen = (options) => pictureSeen(options);
  overlayApi.refresh = () => ((lastAnswer = ""), refresh());
  const dragRect = (start, event) => {
    const left = Math.min(start.x, event.clientX), top = Math.min(start.y, event.clientY);
    return { left, top, width: Math.abs(event.clientX - start.x), height: Math.abs(event.clientY - start.y) };
  };

  // What a comment says about where it is: this page, its screen, scroll and theme, the spot (only what's on screen), what's under it,
  // the seen picture, started this moment on this device, and what he did since it loaded (Feedback's own clicks aren't in it).
  function draftOf(rect, element, isPageComment) {
    const described = isPageComment ? { component: null, layout_rule: null, element_class: "", element_text: "", tag: "" } : describe(element);
    // Only what's on screen: a tall pane's box ends at the bottom of the viewport.
    const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    const clipped = { left, top, width: Math.max(1, Math.min(innerWidth, rect.left + rect.width) - left), height: Math.max(1, Math.min(innerHeight, rect.top + rect.height) - top) };
    const screen = { page_url: pageUrl(), is_in_frame: isInFrame, viewport_width_px: innerWidth, viewport_height_px: innerHeight, scroll_x_px: scrollX, scroll_y_px: scrollY, theme: theme() };
    let seenPicture;
    try {
      seenPicture = pictureSeen({ box: isPageComment ? null : clipped });
    } catch (error) {
      seenPicture = Promise.reject(error);
    }
    seenPicture = seenPicture.catch((error) => ({ notes: [`the seen picture couldn't be drawn on the device: ${error?.message ?? error}`] }));
    return { rect: clipped, described, seenPicture, isPageComment, recentActions: actions.map(named), screen };
  }
  // The form, by the spot it's about (shownRect: where that is on this page, when it's in a frame).
  function openDraft(draft) {
    state.draft = { shownRect: draft.rect, ...draft };
    state.mode = "writing";
    render();
    if (draft.isPageComment) hideMarks();
    else showMark(state.draft.shownRect, false, "");
    root.querySelector("textarea")?.focus();
  }
  const startWriting = (rect, element, isPageComment = false) => openDraft(draftOf(rect, element, isPageComment));

  async function save(text) {
    const { rect, described, seenPicture, isPageComment, recentActions, screen, frameOverlay } = state.draft;
    const seen = await Promise.race([seenPicture, waitMs(SEEN_PICTURE_TIMEOUT_MS).then(() => ({ notes: ["the seen picture took too long to draw on the device"] }))]);
    const comment = {
      ...screen,
      is_page_comment: isPageComment,
      recent_actions: recentActions,
      box: { left_px: rect.left, top_px: rect.top, width_px: rect.width, height_px: rect.height },
      component: described.component,
      layout_rule: described.layout_rule,
      element_class: described.element_class,
      element_text: described.element_text,
      seen_picture_note: seen.notes?.length ? `${seen.notes.join("; ")}.` : null,
      text,
    };
    const answer = await call("POST", "/comments", { comment, seen_picture_png_base64: seen.pngBase64 ?? null, seen_picture_svg: seen.svg ?? null });
    state.comments.push(answer.comment);
    lastAnswer = "";
    toTop({ changed: true, resume: true });
    frameOverlay?.refresh();
    resetZoom();
    setMode(isInFrame ? "off" : "picking");
    say("Saved. Click another thing, or Done.");
    refresh();
  }

  // ---- Drawing it ----
  const pageComments = () => state.comments.filter((comment) => shownPages().includes(comment.page_url));
  // Numbered within each page, so a frame's pin and the top page's list say the same number.
  const numbered = () => pageComments().map((comment, index, all) => ({ comment, number: all.slice(0, index + 1).filter((other) => other.page_url === comment.page_url).length }));
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const metaOf = (comment) => [`${comment.viewport_width_px} × ${comment.viewport_height_px}`, comment.theme, comment.is_in_frame && !isInFrame ? `in ${comment.page_url}` : "", comment.replies.length ? (comment.replies.length === 1 ? "1 reply" : `${comment.replies.length} replies`) : ""].filter(Boolean).join(" · ");

  function render() {
    host.setAttribute("data-theme", theme());
    layer.className = `layer ${state.mode === "picking" ? "picking" : ""} ${innerWidth < PHONE_WIDTH_PX ? "phone" : ""}`;
    renderPins();
    const parts = [];
    // On a phone the list and the form cover the button, and have their own Done and Cancel.
    const isCovered = innerWidth < PHONE_WIDTH_PX && (state.mode === "panel" || state.mode === "writing");
    if (!isInFrame && !isCovered) parts.push(launcher());
    if (state.mode === "picking" && !isInFrame) parts.push(bar());
    if (state.mode === "writing") parts.push(writingCard());
    if (state.mode === "panel" && !isInFrame) parts.push(state.threadId ? threadPanel() : listPanel());
    if (state.notice) parts.push(`<div class="box notice">${esc(state.notice)}</div>`);
    // A redraw (the phone's keyboard resizing the page, a reply arriving) keeps what's typed and where the cursor is.
    const typed = [...ui.querySelectorAll("textarea[data-field]")].map((field) => ({ name: field.dataset.field, value: field.value, isFocused: root.activeElement === field, start: field.selectionStart, end: field.selectionEnd }));
    ui.innerHTML = parts.join("");
    wire();
    for (const { name, value, isFocused, start, end } of typed) {
      const field = ui.querySelector(`[data-field=${name}]`);
      if (!field) continue;
      field.value = value;
      if (isFocused) field.focus(), field.setSelectionRange(start, end);
    }
  }

  function renderPins() {
    const here = numbered().filter(({ comment }) => comment.page_url === pageUrl() && comment.status === "open" && !comment.is_page_comment && Math.abs(comment.viewport_width_px - innerWidth) < 2);
    pins.innerHTML = here
      .map(({ comment, number }) => {
        const left = comment.box.left_px + comment.scroll_x_px - scrollX, top = comment.box.top_px + comment.scroll_y_px - scrollY;
        return `<button class="pin${comment.is_reply_unread ? " unread" : ""}" data-thread="${comment.comment_id}" style="left:${left}px;top:${top}px" title="${esc(comment.text)}">${number}</button>`;
      })
      .join("");
  }

  function launcher() {
    const open = pageComments().filter((comment) => comment.status === "open");
    const isUnread = open.some((comment) => comment.is_reply_unread);
    const isOn = state.mode !== "off";
    return `<button class="launcher${isOn ? " on" : ""}" data-action="launcher">${isOn ? "Done" : "Feedback"}${open.length ? `<span class="count">${open.length}</span>` : ""}${isUnread ? `<span class="dot" title="New replies"></span>` : ""}</button>`;
  }

  function bar() {
    const count = pageComments().length;
    const words = innerWidth < PHONE_WIDTH_PX ? "Tap or drag" : "Click a thing or drag a box";
    return `<div class="box bar"><span>${words}</span><button class="small" data-action="page">This page</button><button class="small" data-action="list">List${count ? ` (${count})` : ""}</button></div>`;
  }

  /** Where the form sits beside the spot on a wide screen (on a phone it's a sheet at the foot of the screen). */
  function cardPlace(rect, isPageComment) {
    const below = rect.top + rect.height + 10, cardHeight = 190;
    // A comment on the whole page has no spot: its form sits in the middle.
    const top = isPageComment ? Math.max(10, (innerHeight - cardHeight) / 2) : below + cardHeight < innerHeight ? below : Math.max(10, rect.top - cardHeight - 10);
    const left = isPageComment ? Math.max(10, (innerWidth - 320) / 2) : Math.min(Math.max(10, rect.left), innerWidth - 330);
    return { left, top };
  }

  function writingCard() {
    const { shownRect: rect, described, isPageComment, recentActions, screen } = state.draft;
    const isPhone = innerWidth < PHONE_WIDTH_PX;
    const { left, top } = cardPlace(rect, isPageComment);
    const replayed = recentActions.length ? ` · replays your last ${recentActions.length === 1 ? "action" : `${recentActions.length} actions`}` : "";
    return `<div class="box card" style="${isPhone ? "" : `left:${left}px;top:${top}px`}">
<div class="label">${isPageComment ? "<b>The whole page</b>" : describedAs(described)}${described.element_text ? ` · “${esc(described.element_text)}”` : ""}</div>
<textarea placeholder="${isPageComment ? "What's wrong or missing here?" : "What should change?"}" data-field="text"></textarea>
<div class="row"><span class="label spacer">${screen.viewport_width_px} × ${screen.viewport_height_px} · ${screen.theme}${replayed}</span><button class="small" data-action="cancel">Cancel</button><button class="small primary" data-action="save">Save</button></div>
</div>`;
  }

  function listPanel() {
    const all = numbered();
    const shown = all.filter(({ comment }) => state.isShowingClosed || comment.status === "open");
    const closedCount = all.length - all.filter(({ comment }) => comment.status === "open").length;
    const elsewhere = state.openCommentCount - all.filter(({ comment }) => comment.status === "open").length;
    return `<div class="box panel">
<div class="head"><strong>This page</strong><button class="small primary" data-action="pick">Comment</button><button class="small" data-action="close-panel">Done</button></div>
<div class="scroll">${
      shown.length
        ? shown
            .map(({ comment, number }) => `<button class="item${comment.status === "closed" ? " closed" : ""}" data-thread="${comment.comment_id}"><span class="number">${number}</span><div><span class="line">${esc(comment.text)}</span><span class="meta">${esc(metaOf(comment))}${comment.is_reply_unread ? " · <b style=\"color:#3d8bff\">new reply</b>" : ""}${comment.status === "closed" ? " · closed" : ""}</span></div></button>`)
            .join("")
        : `<div class="empty">${all.length ? "Every comment here is closed." : "No comments on this page yet. Press Comment, then click a thing or drag a box."}</div>`
    }</div>
<div class="foot"><span class="label">${elsewhere > 0 ? `${plural(elsewhere, "open comment")} on other pages` : ""}</span>${closedCount ? `<button class="link" data-action="toggle-closed">${state.isShowingClosed ? "Hide closed" : `Show closed (${closedCount})`}</button>` : ""}</div>
</div>`;
  }

  function threadPanel() {
    const found = numbered().find(({ comment }) => comment.comment_id === state.threadId);
    if (!found) return listPanel();
    const { comment, number } = found;
    const described = { ...comment, tag: "" };
    const messages = [{ author: "reviewer", text: comment.text }, ...comment.replies];
    return `<div class="box panel">
<div class="head"><button class="small" data-action="back">Back</button><strong>Comment ${number}</strong><button class="small" data-action="close-panel">Done</button></div>
<div class="scroll"><div class="thread">
<div class="label">${describedAs(described)} · ${esc(metaOf(comment))}</div>
${messages.map((message) => `<div class="message ${message.author}"><span class="who">${message.author === "session" ? "Claude" : "You"}</span>${esc(message.text)}</div>`).join("")}
<textarea placeholder="Answer back" data-field="reply"></textarea>
<div class="row"><button class="small" data-action="${comment.status === "open" ? "close-comment" : "open-comment"}">${comment.status === "open" ? "Close comment" : "Open again"}</button><span class="spacer"></span><button class="small primary" data-action="reply">Reply</button></div>
</div></div>
</div>`;
  }

  async function openThread(commentId) {
    state.threadId = commentId;
    state.mode = "panel";
    render();
    const comment = state.comments.find((found) => found.comment_id === commentId);
    if (comment?.is_reply_unread) {
      comment.is_reply_unread = false;
      await call("PATCH", `/comments/${commentId}`, { is_reply_unread: false }).catch(() => {});
      lastAnswer = "";
      render();
    }
  }

  function wire() {
    for (const button of root.querySelectorAll("[data-thread]")) {
      button.onclick = (event) => {
        event.stopPropagation();
        if (isInFrame) return toTop({ thread: button.dataset.thread });
        openThread(button.dataset.thread);
      };
    }
    for (const button of ui.querySelectorAll("[data-action]")) button.onclick = () => act(button.dataset.action, button);
    // Cmd or Ctrl + Enter saves. A listener, not onkeydown: a handler property that returns false cancels the key, and typing with it.
    const onSaveKey = (field, action) => ui.querySelector(`[data-field=${field}]`)?.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") act(action);
    });
    onSaveKey("text", "save");
    onSaveKey("reply", "reply");
  }

  async function act(action, button) {
    if (action === "launcher") return setMode(state.mode === "off" ? "picking" : "off");
    if (action === "pick") return (state.threadId = null), setMode("picking");
    if (action === "list") return (state.threadId = null), setMode("panel");
    if (action === "page") return startWriting({ left: 0, top: 0, width: innerWidth, height: innerHeight }, document.body, true);
    if (action === "close-panel") return (state.threadId = null), setMode("off");
    if (action === "back") return (state.threadId = null), render();
    if (action === "toggle-closed") return (state.isShowingClosed = !state.isShowingClosed), render();
    if (action === "cancel") return toTop({ resume: true }), resetZoom(), setMode(isInFrame ? "off" : "picking");
    if (button) button.disabled = true;
    try {
      if (action === "save") {
        const text = ui.querySelector("[data-field=text]").value.trim();
        if (!text) return say("Write what should change first.");
        await save(text);
      } else if (action === "reply") {
        const text = ui.querySelector("[data-field=reply]").value.trim();
        if (!text) return say("Write your answer first.");
        await call("POST", `/comments/${state.threadId}/replies`, { text });
        lastAnswer = "";
        resetZoom();
        await refresh();
      } else if (action === "close-comment" || action === "open-comment") {
        await call("PATCH", `/comments/${state.threadId}`, { status: action === "close-comment" ? "closed" : "open" });
        if (action === "close-comment") state.threadId = null;
        lastAnswer = "";
        await refresh();
        say(action === "close-comment" ? "Closed." : "Open again.");
      }
    } catch (error) {
      say(error.message);
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }

  // ---- Frames and the top page ----
  addEventListener("message", (event) => {
    if (event.origin !== location.origin || !event.data?.[MESSAGE]) return;
    if (!isInFrame && event.data.changed) (lastAnswer = ""), refresh();
    if (!isInFrame && event.data.resume && state.mode === "off") setMode("picking");
    if (!isInFrame && event.data.thread) openThread(event.data.thread);
  });

  addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || state.mode === "off") return;
    if (state.mode === "writing") return act("cancel");
    setMode("off");
  });
  // The box and its form follow what they're on as the page or anything in it scrolls; pins follow the page.
  let isFollowQueued = false;
  function follow() {
    if (isFollowQueued) return;
    isFollowQueued = true;
    requestAnimationFrame(() => {
      isFollowQueued = false;
      renderPins();
      if (state.mode !== "writing" || !state.draft || state.draft.isPageComment) return;
      state.draft.shownRect = anchoredRect(state.draft);
      showMark(state.draft.shownRect, false, "");
      const card = ui.querySelector(".card");
      if (card && innerWidth >= PHONE_WIDTH_PX) {
        const { left, top } = cardPlace(state.draft.shownRect, false);
        Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
      }
    });
  }
  addEventListener("scroll", follow, { capture: true, passive: true });
  addEventListener("resize", () => {
    if (state.draft && !state.draft.isPageComment) state.draft.shownRect = anchoredRect(state.draft);
    render();
    follow();
  });

  // After a comment, the page back at its own zoom: a phone that zoomed in to a field (or a pinch) zooms out again. iOS zooms back
  // out when the page's viewport stops allowing zoom for a moment; it's given back straight after.
  function resetZoom() {
    root.activeElement?.blur();
    const viewport = document.querySelector("meta[name=viewport]");
    if (!viewport || !window.visualViewport || visualViewport.scale <= 1.01) return;
    const content = viewport.getAttribute("content") ?? "";
    viewport.setAttribute("content", `${content.replace(/,?\s*(maximum|minimum)-scale=[^,]*/g, "")}, minimum-scale=1, maximum-scale=1`);
    setTimeout(() => viewport.setAttribute("content", content), 400);
  }

  // ---- Over sheets and menus ----
  // An open sheet (a modal dialog) or menu (a popover) is in the browser's top layer, over anything a z-index reaches, and a sheet makes
  // the rest of the page inert. So while one is open the overlay lives inside it (the sheet doesn't count its presses as outside, and
  // they aren't inert) and opens as a popover of its own after it, on top. Back on the page when it closes.
  const holders = []; // open sheets and menus, latest last
  const isHolder = (element) => element !== host && element.isConnected && ((element.localName === "dialog" && element.open && matchesSafely(element, ":modal")) || matchesSafely(element, ":popover-open"));
  const holderWatch = new MutationObserver(() => !host.isConnected && place());
  function place() {
    for (let at = holders.length - 1; at >= 0; at--) if (!isHolder(holders[at])) holders.splice(at, 1);
    const holder = holders.at(-1) ?? document.documentElement;
    const isOpen = matchesSafely(host, ":popover-open");
    if (host.parentNode !== holder) {
      if (isOpen) host.hidePopover();
      holder.appendChild(host);
    } else if (isOpen) host.hidePopover();
    holderWatch.disconnect();
    if (holder === document.documentElement || !host.showPopover) return host.removeAttribute("popover");
    host.setAttribute("popover", "manual");
    try {
      host.showPopover();
    } catch {}
    holderWatch.observe(holder, { childList: true });
  }
  function noteTopLayer(element) {
    if (element === host || !(element instanceof Element)) return;
    const at = holders.indexOf(element);
    if (at >= 0) holders.splice(at, 1);
    if (isHolder(element)) holders.push(element);
    if (host.isConnected) place();
  }
  // showModal and close() set and clear open; a menu says so with toggle.
  new MutationObserver((records) => records.forEach((record) => record.target.localName === "dialog" && noteTopLayer(record.target))).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["open"] });
  document.addEventListener("toggle", (event) => noteTopLayer(event.target), true);
  new MutationObserver(() => host.setAttribute("data-theme", theme())).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => host.setAttribute("data-theme", theme()));
  setInterval(() => document.visibilityState === "visible" && refresh(), CHECK_EVERY_MS);
  addEventListener("hashchange", () => ((lastAnswer = ""), refresh()));

  const start = () => {
    document.documentElement.appendChild(host);
    document.querySelectorAll("dialog[open], [popover]").forEach(noteTopLayer);
    render();
    refresh();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
