import { html, raw, type EmptyNoteMarkup, type Raw, NO_EMPTY_NOTE } from "../markup.ts";
import { component } from "./component.ts";
import { tertiaryButton } from "./actions.ts";
import { CUT_LINE, EDGE_LIGHT, glassPane, groove, picture, tag, type ShownPicture } from "./foundations.ts";
import { lengthWords, videoPlayer } from "./video-player.ts";
import { paneParts, stackOfOne, track } from "./layout.ts";
import { STAND_IN_ACCOUNT_PICTURES, STAND_IN_COVER_PICTURES } from "../generated/stand-in-placeholders.generated.ts";

/*
 * Game media: a game's screenshots and videos in a row of carved wells on its page, and a light box that steps through all of them. A video
 * is the game's own file, or a YouTube video, which loads nothing from YouTube until it's pressed.
 */

/** One thing in a game's media. */
export type GameMediaItem =
  | { mediaKind: "picture"; picture: ShownPicture }
  /** A video file of the game's own: its first frame, or a picture its developer picked, stands for it until it plays. */
  | { mediaKind: "video"; poster: ShownPicture; videoUrl: string; playDurationSec: number; isTrailer?: boolean }
  /** A YouTube video: its poster is a picture Zaisma keeps, so the page asks YouTube for nothing until it's pressed. */
  | { mediaKind: "youtube"; poster: ShownPicture; youtubeVideoId: string; playDurationSec: number; isTrailer?: boolean };

export interface GameMediaOptions {
  /** Unique on the page: the row's, and its light box's (<id>-viewer). */
  id: string;
  gameTitle: string;
  /** In the order they show: a trailer first. */
  items: GameMediaItem[];
  /** In the row's place while it has none: an Empty state. */
  whenEmpty: EmptyNoteMarkup;
}


const posterOf = (mediaItem: GameMediaItem): ShownPicture => (mediaItem.mediaKind === "picture" ? mediaItem.picture : mediaItem.poster);


/** What a screen reader says for one: "Screenshot 2 of 8", "Trailer, 1:42, 1 of 8". */
const itemLabel = (mediaItem: GameMediaItem, itemIndex: number, itemCount: number): string =>
  mediaItem.mediaKind === "picture" ? `Screenshot ${itemIndex + 1} of ${itemCount}` : `${mediaItem.isTrailer ? "Trailer" : mediaItem.mediaKind === "youtube" ? "YouTube video" : "Video"}, ${lengthWords(mediaItem.playDurationSec)}, ${itemIndex + 1} of ${itemCount}`;

/**
 * One in the row: its picture in a carved well, a game card's well (square, cut only by the edge rule; pointed at, its foot lights; pressed,
 * it sinks in place), a video's length in a glass tag at its bottom right. It opens the light box on itself.
 */
function mediaWell(options: GameMediaOptions, mediaItem: GameMediaItem, itemIndex: number): Raw {
  const mark = mediaItem.mediaKind === "picture" ? "" : html`<span class="cover-mark at-length">${tag(lengthWords(mediaItem.playDurationSec), "glass", { icon: "play" })}</span>`;
  return html`<button type="button" class="media-well cover-art carving holds-art" data-cut-line="0" data-cut-square data-edge-light="bottom" data-lights aria-controls="${options.id}-viewer" data-media-to="${String(itemIndex)}" aria-label="${itemLabel(mediaItem, itemIndex, options.items.length)}">${CUT_LINE}<span class="cover-picture carving-art" data-cut-line="0">${picture(posterOf(mediaItem), { shownSizes: "(max-width: 760px) 100vw, 480px", largestPx: 1440 })}</span>${EDGE_LIGHT}${mark}</button>`;
}

/** One mediaItem shown large in the light box: a picture whole, a video in a Video player, or a YouTube video in YouTube's player over its poster. */
function mediaSlide(options: GameMediaOptions, mediaItem: GameMediaItem, itemIndex: number): Raw {
  const hidden = itemIndex ? raw(" hidden") : "";
  const large = (shown: ShownPicture, label: string) => picture(shown, { label, hasOwnShape: true, className: "media-large", shownSizes: "(max-width: 760px) 100vw, 960px", largestPx: 1920 });
  const label = itemLabel(mediaItem, itemIndex, options.items.length);
  const frame = (inside: Raw) => html`<div class="media-frame carving" data-cut-line="0" data-cut-square>${CUT_LINE}${inside}</div>`;
  if (mediaItem.mediaKind === "picture") return html`<div class="media-slide" data-media-slide="${String(itemIndex)}"${hidden}>${frame(large(mediaItem.picture, `${options.gameTitle}, ${label}`))}</div>`;
  if (mediaItem.mediaKind === "youtube") {
    return html`<div class="media-slide" data-media-slide="${String(itemIndex)}" data-youtube-video-id="${mediaItem.youtubeVideoId}" data-media-length="${String(mediaItem.playDurationSec)}" data-youtube-title="${options.gameTitle}, ${label}"${hidden}>${frame(large(mediaItem.poster, `${options.gameTitle}, ${label}`))}</div>`;
  }
  return html`<div class="media-slide" data-media-slide="${String(itemIndex)}"${hidden}>${videoPlayer({ videoUrl: mediaItem.videoUrl, poster: mediaItem.poster, playDurationSec: mediaItem.playDurationSec, label: `${options.gameTitle}, ${label}` })}</div>`;
}

/**
 * The light box for a game's media: one glass pane over the dimmed page. Its head is one slim line: the game's name, how far along the row it is, and Close; what's
 * shown is carved into it, whole and as large as the window allows; its foot is the strip of all of them, scrolling sideways on its rail,
 * the one shown with a groove along its foot that fills as it plays or waits to move on. The arrow keys and a swipe step too; a press beside
 * the pane, Close or Esc leaves. It comes in as a layer: nothing grows out of the well that opened it.
 */
export function gameMediaViewer(options: GameMediaOptions): Raw {
  const itemCount = options.items.length;
  const strip = options.items.map((mediaItem, itemIndex) => html`<button type="button" class="media-thumb cover-art carving holds-art" data-cut-line="0" data-cut-square data-media-to="${String(itemIndex)}"${itemIndex ? "" : raw(' aria-current="true"')} aria-label="${itemLabel(mediaItem, itemIndex, itemCount)}">${CUT_LINE}<span class="cover-picture carving-art" data-cut-line="0">${picture(posterOf(mediaItem), { shownSizes: "(max-width: 520px) 96px, 128px", largestPx: 384 })}</span>${groove({ kind: "media-thumb-time", filledPct: 0 })}</button>`);
  const close = tertiaryButton("Close", { type: "submit", formMethod: "dialog", icon: "close", isLabelHidden: true, isSmall: true });
  const placeWords = itemCount > 1 ? html`<span class="media-count" aria-live="polite"><span data-media-at>1</span> of ${String(itemCount)}</span>` : "";
  const parts = paneParts({
    head: { words: html`<div class="media-head"><h2 class="media-title">${options.gameTitle}</h2>${placeWords}</div>`, end: close },
    body: html`<div class="media-shown">${options.items.map((mediaItem, itemIndex) => mediaSlide(options, mediaItem, itemIndex))}</div>`,
    foot: itemCount > 1 ? { start: { kind: "block", markup: html`<div class="media-strip" data-fades-sideways data-side-rail>${strip}</div>` } } : undefined,
  });
  return html`<dialog class="sheet light-box on-pane" id="${options.id}-viewer" aria-label="${options.gameTitle}: screenshots and videos" data-media-viewer><form class="light-box-in" method="dialog">${glassPane({ paneWidth: "fit", body: parts })}</form></dialog>`;
}

/** A game's media on its page: the row of wells, and the light box they open. */
export function gameMedia(options: GameMediaOptions): Raw {
  // One alone isn't a row: its well takes the width, with no rail kept for scrolling that can't happen.
  if (options.items.length === 1) return html`<div class="game-media">${mediaWell(options, options.items[0]!, 0)}${gameMediaViewer(options)}</div>`;
  return html`<div class="game-media">${track({ whenEmpty: options.whenEmpty, id: `${options.id}-track`, itemSize: "cover", label: "Screenshots and videos", items: options.items.map((mediaItem, itemIndex) => ({ kind: "block" as const, markup: mediaWell(options, mediaItem, itemIndex) })) })}${options.items.length ? gameMediaViewer(options) : ""}</div>`;
}

/** The origin a page that shows a YouTube video lets frame it (securityHeaders' frames): YouTube's player that keeps no cookies. */
export const YOUTUBE_FRAME_ORIGIN = "https://www.youtube-nocookie.com";

/**
 * The light box steps through the media: opened from a well or the strip, it shows that one; the arrow keys and a swipe step on; the count
 * and the strip follow. Opened from a well, it moves on by itself: a video at its end (YouTube's too), a screenshot after 6 s (held only
 * while the page is out of sight), stopping at the last; any step of the player's own (the strip, a key, a swipe) stops it, and so does asking for less
 * motion. Leaving one (or the light box) pauses its video and takes a YouTube player out, so nothing plays
 * unseen. A game's own video plays in its Video player.
 * A YouTube video's player loads only as it's landed on in the light box, from YouTube's cookie-free player; the page itself never asks YouTube for anything.
 */
export const GAME_MEDIA_SCRIPT = `/* game media */(function () {
  function slides(viewer) { return Array.prototype.slice.call(viewer.querySelectorAll("[data-media-slide]")); }
  function at(viewer) { var shown = viewer.querySelector("[data-media-slide]:not([hidden])"); return shown ? Number(shown.getAttribute("data-media-slide")) : 0; }
  function leave(slide) {
    var video = slide.querySelector("video:not(.video-stand-in)"); if (video) video.pause();
    var frame = slide.querySelector("iframe"); if (frame) frame.remove();
  }
  // Shown, a video's player is there to press: its own, or YouTube's, loaded as it's landed on. Picked, it plays at once.
  // Moving on, the one coming in slides a little in from the side it comes from as it fades up: on from the right, back from the left.
  var SLIDE_IN_PX = 32;
  function show(viewer, to, isPicked) {
    var all = slides(viewer); if (!all.length) return;
    to = (to + all.length) % all.length;
    var from = at(viewer), comes = to === from || !viewer.open ? 0 : to > from ? 1 : -1;
    all.forEach(function (slide, slideIndex) { if (slideIndex !== to) { leave(slide); slide.hidden = true; } else slide.hidden = false; });
    var shown = all[to], player = shown.querySelector("video:not(.video-stand-in)"); shown.shownMs = 0; shown.youtubeShare = 0;
    if (comes && shown.animate && !isCalm) shown.animate([{ opacity: 0, transform: "translateX(" + comes * SLIDE_IN_PX + "px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: "cubic-bezier(0.2, 0, 0, 1)" });
    if (shown.hasAttribute("data-youtube-video-id")) youtube(shown, isPicked);
    else if (player && isPicked) player.play().catch(function () {});
    var placeWords = viewer.querySelector("[data-media-at]"); if (placeWords) placeWords.textContent = String(to + 1);
    viewer.querySelectorAll(".media-thumb").forEach(function (thumb) {
      var isOn = Number(thumb.getAttribute("data-media-to")) === to;
      thumb.querySelector(".media-thumb-time").style.setProperty("--groove-filled", "0");
      if (isOn) { thumb.setAttribute("aria-current", "true"); thumb.scrollIntoView({ block: "nearest", inline: "nearest" }); } else thumb.removeAttribute("aria-current");
    });
  }
  // A YouTube video's player over its poster (seen while it loads), from YouTube's cookie-free player, playing at once when picked.
  function youtube(slide, isPicked) {
    if (slide.querySelector("iframe")) return;
    var frame = document.createElement("iframe");
    frame.className = "media-youtube";
    frame.src = "${YOUTUBE_FRAME_ORIGIN}/embed/" + encodeURIComponent(slide.getAttribute("data-youtube-video-id")) + "?rel=0&modestbranding=1&enablejsapi=1" + (isPicked ? "&autoplay=1" : "");
    frame.title = slide.getAttribute("data-youtube-title") || "YouTube video";
    frame.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
    frame.setAttribute("allowfullscreen", "");
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    // Its player says where it's at and when it ends once asked to (YouTube's embed messages; no script of YouTube's on the page).
    frame.addEventListener("load", function () { frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "${YOUTUBE_FRAME_ORIGIN}"); });
    slide.querySelector(".media-frame").appendChild(frame);
  }
  window.addEventListener("message", function (event) {
    if (event.origin !== "${YOUTUBE_FRAME_ORIGIN}" || typeof event.data !== "string") return;
    var said; try { said = JSON.parse(event.data); } catch (error) { return; }
    var frame = Array.prototype.slice.call(document.querySelectorAll("iframe.media-youtube")).filter(function (shown) { return shown.contentWindow === event.source; })[0];
    if (!frame || !said || !said.info) return;
    var slide = frame.closest("[data-media-slide]"), viewer = slide.closest("[data-media-viewer]");
    if (said.info.duration) slide.youtubeLengthSec = said.info.duration;
    if (typeof said.info.currentTime === "number") slide.youtubeShare = said.info.currentTime / (slide.youtubeLengthSec || Number(slide.getAttribute("data-media-length")) || 1);
    if (said.info.playerState === 0 && viewer.isAuto) next(viewer);
  });
  // Moving on by itself: the next one, picked (a video plays); past the last, it stops.
  var SCREENSHOT_SHOWN_MS = 6000, isCalm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function next(viewer) { var to = at(viewer) + 1; if (to >= slides(viewer).length) { viewer.isAuto = false; return; } show(viewer, to, true); }
  // The groove along the shown one's foot, frame by frame: a video's place in it, or how long a screenshot has waited to move on.
  function run(viewer) {
    if (viewer.isRunning) return; viewer.isRunning = true;
    var last = performance.now();
    requestAnimationFrame(function frame(now) {
      if (!viewer.open || viewer.classList.contains("is-leaving")) { viewer.isRunning = false; return; }
      var passedMs = now - last; last = now;
      var slide = viewer.querySelector("[data-media-slide]:not([hidden])"), video = slide && slide.querySelector("video:not(.video-stand-in)"), share = 0;
      if (video) share = video.currentTime / (isFinite(video.duration) && video.duration > 0 ? video.duration : 1);
      else if (slide && slide.hasAttribute("data-youtube-video-id")) share = slide.youtubeShare || 0;
      else if (slide && viewer.isAuto) {
        if (!document.hidden) slide.shownMs = (slide.shownMs || 0) + passedMs;
        share = slide.shownMs / SCREENSHOT_SHOWN_MS;
        if (share >= 1) { next(viewer); share = 1; }
      }
      var time = viewer.querySelector('.media-thumb[aria-current="true"] .media-thumb-time'); if (time) time.style.setProperty("--groove-filled", Math.max(0, Math.min(1, share)).toFixed(4));
      requestAnimationFrame(frame);
    });
  }
  document.addEventListener("ended", function (event) {
    var viewer = event.target instanceof HTMLVideoElement ? event.target.closest("[data-media-viewer]") : null;
    if (viewer && viewer.isAuto) next(viewer);
  }, true);
  document.addEventListener("click", function (event) {
    var target = event.target instanceof Element ? event.target : null; if (!target) return;
    // Picked (its well, or its picture in the strip), a video plays at once; stepped onto (the arrows, the keys, a swipe), its player waits.
    var jump = target.closest("[data-media-to]");
    if (jump) {
      var inside = jump.closest("[data-media-viewer]"), viewer = inside || document.getElementById(jump.getAttribute("aria-controls") || "");
      if (!viewer) return;
      viewer.isAuto = !inside && !isCalm;
      show(viewer, Number(jump.getAttribute("data-media-to")), true); run(viewer);
    }
  });
  document.addEventListener("keydown", function (event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    var viewer = document.querySelector("dialog[data-media-viewer][open]"); if (!viewer || (event.target instanceof Element && event.target.closest("input"))) return;
    event.preventDefault(); viewer.isAuto = false; show(viewer, at(viewer) + (event.key === "ArrowRight" ? 1 : -1));
  });
  // A swipe sideways across what's shown steps to the next or the one before.
  var swipe = null;
  document.addEventListener("pointerdown", function (event) { var shown = event.target instanceof Element ? event.target.closest(".media-shown") : null; swipe = shown && event.pointerType !== "mouse" ? { x: event.clientX, y: event.clientY, viewer: shown.closest("[data-media-viewer]") } : null; });
  document.addEventListener("pointerup", function (event) {
    if (!swipe) return; var dx = event.clientX - swipe.x, dy = event.clientY - swipe.y, viewer = swipe.viewer; swipe = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > 2 * Math.abs(dy)) { viewer.isAuto = false; show(viewer, at(viewer) + (dx < 0 ? 1 : -1)); }
  });
  // Closing, nothing in it plays on: it stops as the light box starts to leave (is-leaving, LAYERS_SCRIPT), not once it has gone.
  document.querySelectorAll("[data-media-viewer]").forEach(function (viewer) {
    new MutationObserver(function () { if (viewer.classList.contains("is-leaving") || !viewer.open) slides(viewer).forEach(leave); }).observe(viewer, { attributes: true, attributeFilter: ["class", "open"] });
  });
})();
`;

/**
 * The gallery's stand-ins: covers for screenshots, a short recorded trailer of its own, and a YouTube video, Blender's Big Buck Bunny, with
 * YouTube's own thumbnail copied in as its poster, as Zaisma would copy it (Big Buck Bunny © Blender Foundation, peach.blender.org, CC BY 3.0).
 */
const STAND_IN_TRAILER_URL = "/design/videos/stand-in-trailer.webm";
const STAND_IN_MEDIA: GameMediaItem[] = [
  { mediaKind: "video", poster: STAND_IN_COVER_PICTURES["kestrel"]!, videoUrl: STAND_IN_TRAILER_URL, playDurationSec: 7, isTrailer: true },
  { mediaKind: "picture", picture: STAND_IN_COVER_PICTURES["hollow-tide"]! },
  { mediaKind: "youtube", poster: STAND_IN_ACCOUNT_PICTURES["big-buck-bunny"]!, youtubeVideoId: "aqz-KE-bpKQ", playDurationSec: 635 },
  { mediaKind: "picture", picture: STAND_IN_COVER_PICTURES["verdant"]! },
  { mediaKind: "picture", picture: STAND_IN_COVER_PICTURES["neon-drift"]! },
  { mediaKind: "picture", picture: STAND_IN_COVER_PICTURES["ashen-crown"]! },
];
const mediaPane = (options: GameMediaOptions) => glassPane({ paneWidth: "full", body: stackOfOne(gameMedia(options)) });

component({
  name: "Game media",
  slug: "game-media",
  group: "data",
  subgroup: "pictures",
  summary: "A game's screenshots and videos on its page: a row of carved wells, a trailer first, a video's length in a glass tag at its corner. Pointed at, a well's foot lights; pressed, it sinks and opens the light box on itself, a video playing at once under a glass bar of controls that fades away as it plays, which steps through all of them with the arrows, the arrow keys, a swipe or the strip under it. A YouTube video loads YouTube's player only once the light box shows it.",
  styles: `
/* A well: a game card's carved well (Game card's styles: its edge light, its press, its corner tags) with no words under it, so it keeps the
   frame gap all round, not a bare group's margin. A button, so it drops a button's own look. */
.media-well, .media-thumb { width: 100%; padding: 0; border: 0; cursor: pointer; font: inherit; }
.media-well:is(:hover, .is-pointed) .cover-picture img { filter: brightness(1.06); }
/* A video's length: a glass tag in its well's bottom right corner, a part's frame gap in, its words kept however small the well. */
.cover-mark.at-length { bottom: var(--pad-frame-compact); right: var(--pad-frame-compact); }
/* One alone: its well as wide as what holds it. */
/* The wells (a track, or one well across the width) and the light box they open, one piece; the closed light box takes no room. */
.game-media { display: grid; grid-template-columns: minmax(0, 1fr); }
/* The strip: small wells side by side, scrolling sideways when they don't fit, the one shown lit along its foot. */
.media-strip { display: flex; gap: var(--gap-control-row); max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.media-strip::-webkit-scrollbar { display: none; }
.media-thumb { position: relative; flex: none; width: 128px; aspect-ratio: 16 / 9; }
@media (max-width: 520px) { .media-thumb { width: 96px; } }
.media-thumb:not([aria-current="true"]) .cover-picture img { filter: brightness(0.7); }
/* The one shown carries a groove along its foot, filling as it plays or waits to move on; the others carry none. */
.media-thumb > .media-thumb-time { position: absolute; z-index: 3; left: 4px; right: 4px; bottom: 4px; }
.media-thumb:not([aria-current="true"]) > .media-thumb-time { display: none; }
.media-thumb-time .groove-fill { transition: none; }
/* The light box: one glass pane, as wide as what's shown, over a page dimmed a touch deeper than a sheet's. Its head names the game and
   how far along it is; its foot holds the strip between Previous and Next. */
/* Its head: one slim line, the game's name in a label's size and how far along it is beside it, Close at its end. */
.media-head { display: flex; align-items: baseline; gap: var(--gap-words-words); min-width: 0; }
.media-head > .media-title { margin: 0; font: var(--type-label); color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.media-count { flex: none; font: var(--type-facts); color: var(--ink-2); font-variant-numeric: tabular-nums; }
.media-shown { display: grid; justify-items: center; min-width: 0; }
.media-slide { display: grid; gap: var(--gap-control-stack); min-width: 0; }
.media-slide[hidden] { display: none; }
/* What's shown is carved into the pane: a well as large as it, whole inside it. */
.media-frame { position: relative; display: grid; place-items: center; overflow: hidden; }
.media-frame > :is(.picture, video, iframe) { clip-path: var(--cut-shape); }
/* Large: whole, as wide as the window allows (less the light box's margin and the pane's frame gap, so it lines up with the strip) without
   growing taller than 62% of it. */
.media-large { display: block; width: min(var(--size-sheet-picture), calc(100vw - 2 * var(--pad-pane) - 2 * var(--pad-frame)), calc(62dvh * 16 / 9)); aspect-ratio: 16 / 9; border: 0; background: #000; }
/* A game's own video: a Video player as large as a 16:9 picture shows. */
.media-slide > .video-player { width: min(var(--size-sheet-picture), calc(100vw - 2 * var(--pad-pane) - 2 * var(--pad-frame)), calc(62dvh * 16 / 9)); }
.media-frame > .picture.media-large { aspect-ratio: var(--picture-shape); width: min(var(--size-sheet-picture), calc(100vw - 2 * var(--pad-pane) - 2 * var(--pad-frame)), calc(62dvh * var(--picture-shape))); }
/* A YouTube video's player lies over its poster, which shows while it loads. */
.media-youtube { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; clip-path: var(--cut-shape); }
`,
  render: gameMedia,
  examples: [
    { label: "A trailer first, a YouTube video (Blender's Big Buck Bunny, CC BY 3.0) with YouTube's own thumbnail, then screenshots: press one to open the light box on it", isWide: true, markup: mediaPane({ id: "example-media", gameTitle: "Kestrel", items: STAND_IN_MEDIA, whenEmpty: NO_EMPTY_NOTE }) },
    { label: "Screenshots only", isWide: true, markup: mediaPane({ id: "example-media-shots", gameTitle: "Hollow Tide", items: STAND_IN_MEDIA.filter((mediaItem) => mediaItem.mediaKind === "picture"), whenEmpty: NO_EMPTY_NOTE }) },
    { label: "One screenshot: its well takes the width, and its light box has no strip", markup: mediaPane({ id: "example-media-one", gameTitle: "Verdant", items: [STAND_IN_MEDIA[3]!], whenEmpty: NO_EMPTY_NOTE }) },
  ],
});
