// The preview's feedback overlay, on every page of the local preview only (scripts/preview/workers/site.mjs adds it; zaisma.com
// never has it). Julius presses Feedback, clicks a thing or drags a box over an area, and writes a comment; it's saved with the
// page, the screen size, light or dark, the scroll, the spot, the component and rule under it (the layout inspector's
// window.zaismaInspect, which the preview's site entry loads first when the site has it, else the element's class) and a snapshot of the page as he saw it, for the pictures
// (feedback-pictures.mjs). Open comments show as pins; a session's replies show in the list, where he answers back or closes one.
// In a frame (the gallery's Screens page) it has no button of its own: the top page hands it the clicks and boxes over it, and a
// comment there keeps the frame's own page and size. It never starts in headless Chrome, so the measuring check and the pictures never
// see it. Everything is in a shadow root, so page styles don't reach it and its styles don't reach the page.
(() => {
  if (/HeadlessChrome/.test(navigator.userAgent) || window.__zaismaPreviewFeedback) return;
  // What the top page calls on a frame's overlay, so a click or a box over a frame lands in it (below).
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
  const describedAs = (described) => (described.component ? `<b>${esc(described.component)}</b>${described.layout_rule ? ` · ${esc(described.layout_rule)}` : ""}` : described.element_class ? `<b>.${esc(described.element_class.split(/\s+/).join("."))}</b>` : `<b>${esc(described.tag ?? "")}</b>`);
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

  // Over a same-origin frame with its own overlay, that overlay shows the spot and takes the comment, in its own coordinates.
  function frameAt(x, y) {
    for (const { frame } of frames()) {
      const rect = frame.getBoundingClientRect();
      const left = rect.left + frame.clientLeft, top = rect.top + frame.clientTop;
      const overlay = frame.contentWindow.__zaismaPreviewFeedback;
      if (overlay?.pick && x >= left && x < left + frame.clientWidth && y >= top && y < top + frame.clientHeight) return { overlay, left, top };
    }
    return null;
  }
  let hoveredFrame = null;
  function clearHover() {
    hoveredFrame?.clearHover();
    hoveredFrame = null;
    hideMarks();
  }
  function hoverAt(x, y) {
    const inFrame = frameAt(x, y);
    if (hoveredFrame && hoveredFrame !== inFrame?.overlay) hoveredFrame.clearHover();
    hoveredFrame = inFrame?.overlay ?? null;
    if (inFrame) return hideMarks(), inFrame.overlay.hoverAt(x - inFrame.left, y - inFrame.top);
    const element = elementAt(x, y);
    const described = describe(element);
    showMark((described.componentElement ?? element).getBoundingClientRect(), false, chipText(described));
  }
  /** A click at x, y, or a dragged box (rect, null for a click). */
  function pick(rect, x, y) {
    clearHover();
    const atX = rect ? rect.left + rect.width / 2 : x, atY = rect ? rect.top + rect.height / 2 : y;
    const inFrame = frameAt(atX, atY);
    if (inFrame) {
      // The frame shows the form; the top page waits, and goes back to picking when it's saved or cancelled.
      setMode("off");
      return inFrame.overlay.pick(rect && { left: rect.left - inFrame.left, top: rect.top - inFrame.top, width: rect.width, height: rect.height }, x - inFrame.left, y - inFrame.top);
    }
    const element = elementAt(atX, atY);
    startWriting(rect ?? (describe(element).componentElement ?? element).getBoundingClientRect(), element);
  }
  overlayApi.hoverAt = hoverAt;
  overlayApi.clearHover = hideMarks;
  overlayApi.pick = pick;
  const dragRect = (start, event) => {
    const left = Math.min(start.x, event.clientX), top = Math.min(start.y, event.clientY);
    return { left, top, width: Math.abs(event.clientX - start.x), height: Math.abs(event.clientY - start.y) };
  };

  function startWriting(rect, element) {
    const described = describe(element);
    // Only what's on screen: a tall pane's box ends at the bottom of the viewport.
    const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    const clipped = { left, top, width: Math.max(1, Math.min(innerWidth, rect.left + rect.width) - left), height: Math.max(1, Math.min(innerHeight, rect.top + rect.height) - top) };
    let snapshotHtml = null;
    try {
      snapshotHtml = snapshot();
    } catch {}
    state.draft = { rect: clipped, described, snapshotHtml };
    state.mode = "writing";
    render();
    showMark(clipped, false, "");
    root.querySelector("textarea")?.focus();
  }

  async function save(text) {
    const { rect, described, snapshotHtml } = state.draft;
    const comment = {
      page_url: pageUrl(),
      is_in_frame: isInFrame,
      viewport_width_px: innerWidth,
      viewport_height_px: innerHeight,
      scroll_x_px: scrollX,
      scroll_y_px: scrollY,
      theme: theme(),
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
    ui.innerHTML = parts.join("");
    wire();
  }

  function renderPins() {
    const here = numbered().filter(({ comment }) => comment.page_url === pageUrl() && comment.status === "open" && Math.abs(comment.viewport_width_px - innerWidth) < 2);
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
    return `<div class="box bar"><span>Click a thing or drag a box</span><button class="small" data-action="list">List${count ? ` (${count})` : ""}</button></div>`;
  }

  function writingCard() {
    const { rect, described } = state.draft;
    const isPhone = innerWidth < PHONE_WIDTH_PX;
    const below = rect.top + rect.height + 10, cardHeight = 190;
    const top = below + cardHeight < innerHeight ? below : Math.max(10, rect.top - cardHeight - 10);
    const left = Math.min(Math.max(10, rect.left), innerWidth - 330);
    return `<div class="box card" style="${isPhone ? "" : `left:${left}px;top:${top}px`}">
<div class="label">${describedAs(described)}${described.element_text ? ` · “${esc(described.element_text)}”` : ""}</div>
<textarea placeholder="What should change?" data-field="text"></textarea>
<div class="row"><span class="label spacer">${innerWidth} × ${innerHeight} · ${theme()}</span><button class="small" data-action="cancel">Cancel</button><button class="small primary" data-action="save">Save</button></div>
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
    const text = ui.querySelector("[data-field=text]");
    if (text) text.onkeydown = (event) => (event.metaKey || event.ctrlKey) && event.key === "Enter" && act("save");
    const reply = ui.querySelector("[data-field=reply]");
    if (reply) reply.onkeydown = (event) => (event.metaKey || event.ctrlKey) && event.key === "Enter" && act("reply");
  }

  async function act(action, button) {
    if (action === "launcher") return setMode(state.mode === "off" ? "picking" : "off");
    if (action === "pick") return (state.threadId = null), setMode("picking");
    if (action === "list") return (state.threadId = null), setMode("panel");
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
