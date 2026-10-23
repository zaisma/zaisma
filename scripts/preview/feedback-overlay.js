// The preview's feedback overlay, on every page of the local preview only (scripts/preview/workers/site.mjs adds it; zaisma.com
// never has it). Julius presses Feedback, clicks a thing, drags a box over an area or picks This page, and writes a comment; it's saved with the
// page, the screen size, light or dark, the scroll, the spot, the component and rule under it (the layout inspector's
// window.zaismaInspect, which the preview's site entry loads first when the site has it, else the element's class) and a snapshot of the page as he saw it, for the pictures
// (feedback-pictures.mjs), with what he did on the page before (pointing, clicks, touches, keys and scrolling, never what goes
// into a password field) for the session to replay. Open comments show as pins; a session's replies show in the list, where he answers back or closes one.
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
textarea{width:100%;min-height:76px;resize:vertical;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--raised);outline:none}
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

  // ---- The page as he saw it, for the "seen" picture: form values, open details, open popovers and readable canvases kept, scripts removed ----
  function snapshot() {
    const clone = document.documentElement.cloneNode(true);
    const pairs = (selector) => {
      const originals = document.documentElement.querySelectorAll(selector);
      const copies = clone.querySelectorAll(selector);
      return [...originals].map((original, index) => [original, copies[index]]).filter(([, copy]) => copy);
    };
    for (const [original, copy] of pairs("input")) {
      if (original.type === "checkbox" || original.type === "radio") original.checked ? copy.setAttribute("checked", "") : copy.removeAttribute("checked");
      else if (original.type === "password") copy.setAttribute("value", "x".repeat(original.value.length));
      else if (original.type !== "file") copy.setAttribute("value", original.value);
    }
    for (const [original, copy] of pairs("textarea")) copy.textContent = original.value;
    for (const [original, copy] of pairs("select")) [...copy.options].forEach((option, index) => (original.options[index]?.selected ? option.setAttribute("selected", "") : option.removeAttribute("selected")));
    for (const [original, copy] of pairs("[popover], dialog")) {
      const isShowing = (original.matches(":popover-open") || (original.tagName === "DIALOG" && original.open)) && original.getClientRects().length;
      if (!isShowing) continue;
      const rect = original.getBoundingClientRect();
      copy.removeAttribute("popover");
      if (copy.tagName === "DIALOG") copy.setAttribute("open", "");
      copy.setAttribute("style", `${copy.getAttribute("style") ?? ""};position:fixed;inset:auto;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;margin:0;z-index:2147483646;display:${getComputedStyle(original).display}`);
    }
    for (const [original, copy] of pairs("canvas")) {
      try {
        const picture = document.createElement("img");
        picture.src = original.toDataURL();
        for (const name of ["class", "style", "id", "width", "height"]) if (original.hasAttribute(name)) picture.setAttribute(name, original.getAttribute(name));
        const rect = original.getBoundingClientRect();
        picture.style.width ||= `${rect.width}px`;
        picture.style.height ||= `${rect.height}px`;
        copy.replaceWith(picture);
      } catch {}
    }
    clone.querySelectorAll("script, zaisma-preview-feedback").forEach((element) => element.remove());
    const head = clone.querySelector("head");
    if (head) head.insertAdjacentHTML("afterbegin", `<base href="${esc(location.href)}">`);
    return `<!doctype html>${clone.outerHTML}`;
  }

  // ---- What he did on the page before commenting, for the replay: the last ones, a run of pointer moves or scrolls kept as its end ----
  const MAXIMUM_ACTION_COUNT = 40;
  const actions = [];
  const isOurs = (event) => event.composedPath().includes(host);
  const labelOf = (target) => (target instanceof Element && target !== document.documentElement ? chipText(describe(target)) : "");
  function record(action, isRun) {
    const entry = { ...action, at_ms: Math.round(performance.now()) };
    if (isRun && actions.at(-1)?.kind === action.kind && actions.at(-1)?.pointer_type === action.pointer_type) actions[actions.length - 1] = entry;
    else actions.push(entry);
    if (actions.length > MAXIMUM_ACTION_COUNT) actions.shift();
  }
  const pointerAction = (kind) => (event) => {
    if (isOurs(event) || !event.isPrimary) return;
    const pointerType = event.pointerType === "touch" || event.pointerType === "pen" ? "touch" : "mouse";
    // A touch only moves while it's down; a mouse's moves are where it points.
    if (kind === "move" && pointerType === "touch" && !event.pressure) return;
    record({ kind, x_px: event.clientX, y_px: event.clientY, pointer_type: pointerType, element_label: kind === "move" ? "" : labelOf(event.target) }, kind === "move");
  };
  addEventListener("pointermove", pointerAction("move"), { capture: true, passive: true });
  addEventListener("pointerdown", pointerAction("press"), { capture: true, passive: true });
  addEventListener("pointerup", pointerAction("release"), { capture: true, passive: true });
  addEventListener("keydown", (event) => {
    if (isOurs(event) || ["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key) || event.metaKey || event.ctrlKey) return;
    if (event.target?.type === "password") return;
    record({ kind: "key", key: event.key, element_label: labelOf(event.target) }, false);
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
      if (overlay?.draftAt && x >= left && x < left + frame.clientWidth * scale && y >= top && y < top + frame.clientHeight * scale) return { overlay, left, top, scale };
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
    return draftOf(rect ?? (describe(element).componentElement ?? element).getBoundingClientRect(), element, false);
  }
  /** A click at x, y, or a dragged box (rect, null for a click). */
  function pick(rect, x, y) {
    clearHover();
    const atX = rect ? rect.left + rect.width / 2 : x, atY = rect ? rect.top + rect.height / 2 : y;
    const inFrame = frameAt(atX, atY);
    if (!inFrame) return openDraft(draftAt(rect, x, y));
    // The frame's page and screen, shown here at full size.
    const draft = inFrame.overlay.draftAt(intoFrame(inFrame, rect), (x - inFrame.left) / inFrame.scale, (y - inFrame.top) / inFrame.scale);
    openDraft({ ...draft, shownRect: outOfFrame(inFrame, draft.rect), frameOverlay: inFrame.overlay });
  }
  overlayApi.markAt = markAt;
  overlayApi.draftAt = draftAt;
  overlayApi.refresh = () => ((lastAnswer = ""), refresh());
  const dragRect = (start, event) => {
    const left = Math.min(start.x, event.clientX), top = Math.min(start.y, event.clientY);
    return { left, top, width: Math.abs(event.clientX - start.x), height: Math.abs(event.clientY - start.y) };
  };

  // What a comment says about where it is: this page, its screen, scroll and theme, the spot (only what's on screen), what's under it,
  // a snapshot of the page as he saw it and what he did since it loaded (Feedback's own clicks aren't in it).
  function draftOf(rect, element, isPageComment) {
    const described = isPageComment ? { component: null, layout_rule: null, element_class: "", element_text: "", tag: "" } : describe(element);
    // Only what's on screen: a tall pane's box ends at the bottom of the viewport.
    const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    const clipped = { left, top, width: Math.max(1, Math.min(innerWidth, rect.left + rect.width) - left), height: Math.max(1, Math.min(innerHeight, rect.top + rect.height) - top) };
    let snapshotHtml = null;
    try {
      snapshotHtml = snapshot();
    } catch {}
    const screen = { page_url: pageUrl(), is_in_frame: isInFrame, viewport_width_px: innerWidth, viewport_height_px: innerHeight, scroll_x_px: scrollX, scroll_y_px: scrollY, theme: theme() };
    return { rect: clipped, described, snapshotHtml, isPageComment, recentActions: actions.slice(), screen };
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
    const { rect, described, snapshotHtml, isPageComment, recentActions, screen, frameOverlay } = state.draft;
    const comment = {
      ...screen,
      is_page_comment: isPageComment,
      recent_actions: recentActions,
      box: { left_px: rect.left, top_px: rect.top, width_px: rect.width, height_px: rect.height },
      component: described.component,
      layout_rule: described.layout_rule,
      element_class: described.element_class,
      element_text: described.element_text,
      text,
    };
    const answer = await call("POST", "/comments", { comment, snapshot_html: snapshotHtml });
    state.comments.push(answer.comment);
    lastAnswer = "";
    toTop({ changed: true, resume: true });
    frameOverlay?.refresh();
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

  function writingCard() {
    const { shownRect: rect, described, isPageComment, recentActions, screen } = state.draft;
    const isPhone = innerWidth < PHONE_WIDTH_PX;
    const below = rect.top + rect.height + 10, cardHeight = 190;
    // A comment on the whole page has no spot: its form sits in the middle.
    const top = isPageComment ? Math.max(10, (innerHeight - cardHeight) / 2) : below + cardHeight < innerHeight ? below : Math.max(10, rect.top - cardHeight - 10);
    const left = isPageComment ? Math.max(10, (innerWidth - 320) / 2) : Math.min(Math.max(10, rect.left), innerWidth - 330);
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
    if (action === "cancel") return toTop({ resume: true }), setMode(isInFrame ? "off" : "picking");
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
  addEventListener("scroll", () => renderPins(), { passive: true });
  addEventListener("resize", () => render());
  new MutationObserver(() => host.setAttribute("data-theme", theme())).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => host.setAttribute("data-theme", theme()));
  setInterval(() => document.visibilityState === "visible" && refresh(), CHECK_EVERY_MS);
  addEventListener("hashchange", () => ((lastAnswer = ""), refresh()));

  const start = () => {
    document.documentElement.appendChild(host);
    render();
    refresh();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
