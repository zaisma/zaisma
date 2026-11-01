import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { tertiaryButton } from "./actions.ts";
import { CUT_LINE, EDGE, glassPane, groove, icon, type ShownPicture } from "./foundations.ts";
import { stackOfOne } from "./layout.ts";
import { STAND_IN_COVER_PICTURES } from "../generated/stand-in-placeholders.generated.ts";

export interface VideoPlayerOptions {
  /** The video file: a game's own, from its files. */
  videoUrl: string;
  /** What shows before it plays. */
  poster: ShownPicture;
  /** Its length, for its time before the file has said: 107 for 1:47. */
  playDurationSec: number;
  /** What a screen reader calls it: "Kestrel, Trailer, 0:07". */
  label: string;
  /** The gallery's fixed still: the sound's groove open beside Sound. */
  state?: "is-sound-open";
}

/** A length as players read it: 1:42, 12:05, 1:02:10. */
export const lengthWords = (durationSec: number): string => {
  const wholeSec = Math.max(0, Math.round(durationSec)), hourCount = Math.floor(wholeSec / 3600), minuteCount = Math.floor((wholeSec % 3600) / 60);
  const secondsWords = String(wholeSec % 60).padStart(2, "0");
  return hourCount ? `${hourCount}:${String(minuteCount).padStart(2, "0")}:${secondsWords}` : `${minuteCount}:${secondsWords}`;
};

/** Sound: it mutes and unmutes, its icon following the level (muted, one wave up to half, two above: data-sound-at, set by its script). */
function soundButton(): Raw {
  const levels = (["off", "low", "high"] as const).map((soundAt) => raw(String(icon(soundAt === "off" ? "speaker-off" : soundAt === "low" ? "speaker-low" : "speaker")).replace("<svg ", `<svg data-shown-at="${soundAt}" `)));
  return raw(String(tertiaryButton("Mute", { type: "button", icon: "speaker", isLabelHidden: true, isSmall: true, dataAttributes: { "video-sound": "", "sound-at": "high" } })).replace(String(icon("speaker")), levels.join("")));
}

/**
 * A video player: the video carved in, whole, with its controls on a floating glass bar over its foot: play, the groove for where it's at
 * (a range over it, unseen, to seek; a faint light for how far it's loaded; Waiting's glint past it while it buffers), its time, sound and
 * full screen. The bar sinks away as it plays and comes back on a move or a touch;
 * a press on the video plays or pauses it. For a game's own video files; a YouTube video plays in YouTube's player.
 */
export function videoPlayer(options: VideoPlayerOptions): Raw {
  const level = html`<span class="video-level">${groove({ kind: "video-level-groove", filledPct: 100 })}<input class="video-level-input" type="range" min="0" max="1" step="0.05" value="1" aria-label="Sound level"></span>`;
  const controls = html`<div class="video-controls glass glass-bar compact smoke" data-glass data-glass-corners="0 0 0 0" role="group" aria-label="Video controls">${EDGE}${tertiaryButton("Play", { type: "button", icon: "play", onIcon: "pause", isLabelHidden: true, isSmall: true, dataAttributes: { "video-play": "" } })}<span class="video-seek">${groove({ kind: "video-progress", filledPct: 0 })}<span class="video-loaded" aria-hidden="true"></span><span class="video-waiting light-glint loops" aria-hidden="true"></span><input class="video-seek-input" type="range" min="0" max="${String(options.playDurationSec)}" step="0.1" value="0" aria-label="Where it's at"></span><span class="video-time" aria-hidden="true"><span data-video-time>0:00</span><span class="video-time-length"> / ${lengthWords(options.playDurationSec)}</span></span><span class="video-sound">${soundButton()}${level}</span>${tertiaryButton("Full screen", { type: "button", icon: "full-screen", onIcon: "full-screen-exit", isLabelHidden: true, isSmall: true, dataAttributes: { "video-full-screen": "" } })}</div>`;
  return html`<div class="video-player carving${options.state ? ` ${options.state}` : ""}" data-cut-line="0" data-cut-square data-video-player data-video-length="${String(options.playDurationSec)}" aria-busy="false">${CUT_LINE}<span class="video-status" role="status"></span><video class="video-stand-in" aria-hidden="true" tabindex="-1" muted playsinline></video><video src="${options.videoUrl}" poster="${options.poster.imageUrl}" preload="none" playsinline aria-label="${options.label}"></video><span class="video-press" data-video-press aria-hidden="true"></span>${controls}</div>`;
}

/**
 * A video player's controls follow its video: Play or Pause, where it's at (the groove's light and the range), its time, its sound's level and
 * icon. Dragging seeks as it goes, showing the frame it's at (before it has played too); pressing the video plays or pauses it; full screen and back from its own button or Esc. The bar rises in
 * on any move or touch over the player and sinks away 2.5 s after the pointer stops, or at once when it leaves; never while it's paused, dragged or worked
 * from the keys. A touch on a player whose bar is away only brings it back.
 */
export const VIDEO_PLAYER_SCRIPT = `/* video player */(function () {
  function playerOf(target) { return target instanceof Element ? target.closest("[data-video-player]") : null; }
  document.addEventListener("click", function (event) {
    var box = playerOf(event.target); if (!box) return;
    var target = event.target, video = box.querySelector("video:not(.video-stand-in)");
    var isOnVideo = target === video || Boolean(target.closest("[data-video-press]"));
    if (isOnVideo && box.isWakeTouch) { box.isWakeTouch = false; return; }
    if (target.closest("[data-video-play]") || isOnVideo) { if (video.paused) video.play().catch(function () {}); else video.pause(); }
    else if (target.closest("[data-video-sound]")) { if (video.muted || video.volume === 0) { video.muted = false; if (video.volume === 0) video.volume = 0.5; } else video.muted = true; }
    else if (target.closest("[data-video-full-screen]")) {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (box.requestFullscreen) box.requestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    }
  });
  document.addEventListener("fullscreenchange", function () {
    document.querySelectorAll("[data-video-player] [data-video-full-screen]").forEach(function (button) {
      var isFull = document.fullscreenElement === button.closest("[data-video-player]");
      button.setAttribute("data-is-on", String(isFull)); button.setAttribute("aria-label", isFull ? "Exit full screen" : "Full screen");
    });
  });
  function lengthOf(box, video) { return isFinite(video.duration) && video.duration > 0 ? video.duration : Number(box.getAttribute("data-video-length")) || 1; }
  function follow(event) {
    var video = event.target; if (!(video instanceof HTMLVideoElement)) return;
    var box = video.closest("[data-video-player]"); if (!box) return;
    var share = Math.min(1, video.currentTime / lengthOf(box, video)), minutes = Math.floor(video.currentTime / 60), seconds = Math.floor(video.currentTime % 60);
    if (!box.querySelector(".video-seek-input[data-is-dragged]")) played(box, video, video.currentTime);
    var range = box.querySelector(".video-seek-input"); if (!range.hasAttribute("data-is-dragged")) range.value = String(video.currentTime);
    box.querySelector("[data-video-time]").textContent = minutes + ":" + String(seconds).padStart(2, "0");
    var play = box.querySelector("[data-video-play]"); play.setAttribute("aria-label", video.paused ? "Play" : "Pause"); play.setAttribute("data-is-on", String(!video.paused));
    var level = video.muted ? 0 : video.volume, sound = box.querySelector("[data-video-sound]");
    sound.setAttribute("data-sound-at", level === 0 ? "off" : level <= 0.5 ? "low" : "high"); sound.setAttribute("aria-label", level === 0 ? "Sound on" : "Mute");
    box.querySelector(".video-level-groove").style.setProperty("--groove-filled", level.toFixed(4));
    var levelRange = box.querySelector(".video-level-input"); if (!levelRange.hasAttribute("data-is-dragged")) levelRange.value = String(level);
    if (event.type === "play" || event.type === "pause" || event.type === "ended") wake(box);
    if (event.type === "play") glide(box, video);
  }
  // Where it's at, in the groove's light, and how far past it the video has loaded, a fainter light.
  function played(box, video, atSec) {
    var length = lengthOf(box, video), share = Math.min(1, atSec / length), loadedSec = atSec;
    for (var rangeIndex = 0; rangeIndex < video.buffered.length; rangeIndex++) if (video.buffered.start(rangeIndex) <= atSec + 0.5 && video.buffered.end(rangeIndex) >= atSec) loadedSec = video.buffered.end(rangeIndex);
    box.querySelector(".video-progress").style.setProperty("--groove-filled", share.toFixed(4));
    var seekBox = box.querySelector(".video-seek"); seekBox.style.setProperty("--played", share.toFixed(4)); seekBox.style.setProperty("--loaded", Math.min(1, loadedSec / length).toFixed(4));
  }
  // Playing, its light runs along the groove frame by frame, at the video's own pace, not in the steps its time is reported in.
  function glide(box, video) {
    if (box.isGliding) return; box.isGliding = true;
    (function frame() {
      if (video.paused || video.ended || !box.isConnected) { box.isGliding = false; return; }
      if (!box.querySelector(".video-seek-input[data-is-dragged]")) played(box, video, video.currentTime);
      requestAnimationFrame(frame);
    })();
  }
  ["timeupdate", "play", "pause", "volumechange", "ended", "progress"].forEach(function (name) { document.addEventListener(name, follow, true); });
  // Once the file says how long it really is, the range runs to that, not to the length it was given, so the light lands under the pointer.
  document.addEventListener("durationchange", function (event) {
    var video = event.target; if (!(video instanceof HTMLVideoElement) || !isFinite(video.duration) || !(video.duration > 0)) return;
    var box = video.closest("[data-video-player]"); if (box) box.querySelector(".video-seek-input").max = String(video.duration);
  }, true);
  // Waiting on its video for more than a moment (a short hiccup shows nothing), a glint runs along the groove past where it's at, the bar
  // stays up, and a screen reader hears it's loading; it goes once the video plays on, or is paused.
  var BUFFERING_AFTER_MS = 500;
  function buffering(box, isBuffering) {
    clearTimeout(box.bufferingTimer);
    if (!isBuffering) { box.classList.remove("is-buffering"); box.setAttribute("aria-busy", "false"); box.querySelector(".video-status").textContent = ""; return; }
    box.bufferingTimer = setTimeout(function () {
      var video = box.querySelector("video:not(.video-stand-in)"); if (video.paused || video.readyState >= 3) return;
      box.classList.add("is-buffering"); box.setAttribute("aria-busy", "true"); box.querySelector(".video-status").textContent = "Loading"; wake(box);
    }, BUFFERING_AFTER_MS);
  }
  ["waiting", "stalled"].forEach(function (name) { document.addEventListener(name, function (event) { var box = event.target instanceof HTMLVideoElement && !event.target.classList.contains("video-stand-in") ? event.target.closest("[data-video-player]") : null; if (box) buffering(box, true); }, true); });
  ["playing", "canplay", "pause", "ended", "emptied"].forEach(function (name) { document.addEventListener(name, function (event) { var box = event.target instanceof HTMLVideoElement && !event.target.classList.contains("video-stand-in") ? event.target.closest("[data-video-player]") : null; if (box) buffering(box, false); }, true); });
  // Dragged along, it seeks as it goes, and playing doesn't pull it back until it's let go (Safari never focuses a range).
  // The light follows the pointer at once; the video catches up.
  function seek(event) {
    var range = event.target instanceof Element ? event.target.closest(".video-seek-input") : null; if (!range) return;
    var box = range.closest("[data-video-player]"), video = box.querySelector("video:not(.video-stand-in)");
    played(box, video, Number(range.value));
    video.currentTime = Number(range.value);
  }
  document.addEventListener("input", seek); document.addEventListener("change", seek);
  document.addEventListener("input", function (event) {
    var range = event.target instanceof Element ? event.target.closest(".video-level-input") : null; if (!range) return;
    var box = range.closest("[data-video-player]"), video = box.querySelector("video:not(.video-stand-in)");
    box.querySelector(".video-level-groove").style.setProperty("--groove-filled", Number(range.value).toFixed(4));
    video.volume = Number(range.value); video.muted = video.volume === 0;
  });
  document.addEventListener("pointerdown", function (event) { var range = event.target instanceof Element ? event.target.closest(".video-seek-input, .video-level-input") : null; if (range) range.setAttribute("data-is-dragged", ""); });
  // Taken hold of before it has played, the timeline starts the video loading, so dragging shows the frame it's at, not the poster.
  function loadToSeek(event) {
    var range = event.target instanceof Element ? event.target.closest(".video-seek-input") : null; if (!range) return;
    var video = range.closest("[data-video-player]").querySelector("video:not(.video-stand-in)");
    if (video.preload === "none") { video.preload = "auto"; video.load(); video.currentTime = Number(range.value); }
  }
  document.addEventListener("pointerdown", loadToSeek); document.addEventListener("keydown", loadToSeek);
  ["pointerup", "pointercancel"].forEach(function (name) { document.addEventListener(name, function () { document.querySelectorAll(".video-controls [data-is-dragged]").forEach(function (range) { range.removeAttribute("data-is-dragged"); }); }); });
  var QUIET_AFTER_MS = 2500;
  function quiet(box) {
    var video = box.querySelector("video:not(.video-stand-in)");
    if (video.paused || box.classList.contains("is-buffering") || box.querySelector(".video-controls [data-is-dragged], .video-controls :focus-visible")) return;
    box.classList.add("is-quiet");
  }
  function wake(box) { box.classList.remove("is-quiet"); clearTimeout(box.quietTimer); box.quietTimer = setTimeout(function () { quiet(box); }, QUIET_AFTER_MS); }
  document.addEventListener("pointermove", function (event) { var box = playerOf(event.target); if (box) wake(box); });
  document.addEventListener("pointerdown", function (event) { var box = playerOf(event.target); if (!box) return; box.isWakeTouch = event.pointerType !== "mouse" && box.classList.contains("is-quiet"); wake(box); });
  document.addEventListener("pointerout", function (event) {
    var box = playerOf(event.target);
    if (box && event.pointerType === "mouse" && !(event.relatedTarget instanceof Element && box.contains(event.relatedTarget))) { clearTimeout(box.quietTimer); quiet(box); }
  });
  document.addEventListener("focusin", function (event) { var box = playerOf(event.target); if (box) wake(box); });
})();
`;

const STAND_IN_PLAYER: VideoPlayerOptions = { videoUrl: "/design/videos/stand-in-trailer.webm", poster: STAND_IN_COVER_PICTURES["kestrel"]!, playDurationSec: 7, label: "Kestrel, Trailer, 0:07" };
const playerPane = (markup: Raw) => glassPane({ paneWidth: "full", body: stackOfOne(markup) });

component({
  name: "Video player",
  slug: "video-player",
  group: "data",
  subgroup: "pictures",
  summary: "A game's own video, carved in whole, its controls on a floating glass bar over its foot: play, where it's at, its time, sound and full screen. The bar sinks away as it plays and comes back on a move or a touch; a press on the video plays or pauses it. Pointed at, Sound slides a short groove open for the level, and its icon follows it. A YouTube video plays in YouTube's own player instead.",
  styles: `
/* The player: a carving as wide as what holds it, 16:9, the video whole inside it (black where its shape differs), and the bar over it. */
.video-player { position: relative; display: grid; aspect-ratio: 16 / 9; overflow: hidden; background: #000; container-type: inline-size; }
/* The video itself never takes the pointer: a clear layer over it does (pressing it plays or pauses), so Safari's Live Text, which offers to
   read text off a paused frame wherever the pointer rests on a video, never comes up over the picture and takes the pointer from the controls. */
.video-player > video { display: block; width: 100%; height: 100%; object-fit: contain; clip-path: var(--cut-shape); pointer-events: none; -webkit-user-select: none; user-select: none; }
.video-press { position: absolute; inset: 0; z-index: 1; cursor: pointer; }
/* Safari, in full screen, runs Live Text over the first of the largest videos in what's full screen once it's paused, and its button then
   takes the pointer until Esc (WebKit bug 283671). An empty video the same size as the real one, before it, is the one it picks: there's no
   frame in it, so there's no text to offer. It's never seen, heard or reached. */
.video-stand-in { position: absolute; inset: 0; width: 100%; height: 100%; visibility: hidden; pointer-events: none; }
.video-player.is-quiet > .video-press { cursor: none; }
/* Its bar: a glass bar (its glass, rim and blur; square but where the edge rule cuts it; smoked, in both themes, so its light ink reads over
   any picture, as a film's controls do) a frame gap in from the foot, rising in and fading
   as the pointer moves, sinking away and fading once it's quiet. */
.video-controls { position: absolute; z-index: 2; left: var(--pad-frame-compact); right: var(--pad-frame-compact); bottom: var(--pad-frame-compact); display: flex; align-items: center; gap: var(--gap-words-words);
  color: var(--ink); --glass-tint: var(--glass-regular); transition: var(--glass-transition), opacity var(--motion-arrive) var(--ease-glide), transform var(--motion-arrive) var(--ease-glide); }
.video-player.is-quiet .video-controls { opacity: 0; transform: translateY(6px); pointer-events: none; }
/* Its grooves' light follows the video and the pointer as they go, with no glide of its own. */
.video-player .groove-fill { transition: none; }
.video-seek { position: relative; flex: 1 1 0; display: grid; }
/* The unseen ranges over the grooves: no thumb of their own (a hair's width), so a value maps onto the whole groove and the light stays
   under the pointer right to its ends. */
.video-seek-input, .video-level-input { position: absolute; inset: -8px 0; width: 100%; margin: 0; opacity: 0; cursor: pointer; -webkit-appearance: none; appearance: none; background: none; }
.video-seek-input::-webkit-slider-thumb, .video-level-input::-webkit-slider-thumb { -webkit-appearance: none; width: 1px; height: 24px; }
.video-seek-input::-moz-range-thumb, .video-level-input::-moz-range-thumb { width: 1px; height: 24px; border: 0; }
/* How far it has loaded: a faint light in the groove from where it's at; waiting on it, a glint runs along the rest of the groove. */
.video-loaded, .video-waiting { position: absolute; z-index: 3; top: 2px; bottom: 2px; left: calc(2px + (100% - 4px) * var(--played, 0)); pointer-events: none; }
.video-loaded { width: calc((100% - 4px) * max(0, var(--loaded, 0) - var(--played, 0))); background: var(--glint); opacity: 0.22; }
.video-waiting { right: 2px; display: none; }
.video-player.is-buffering .video-waiting { display: block; }
.video-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.video-time { font: var(--type-facts); color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
/* Sound: pointed at or worked from the keys, a short groove slides open beside it inside the bar, filled to the level. */
.video-sound { display: flex; align-items: center; }
.video-level { position: relative; display: grid; width: 0; overflow: hidden; transition: width var(--motion-arrive) var(--ease-glide); }
.video-sound:hover > .video-level, .video-sound:has(:focus-visible) > .video-level, .video-player.is-sound-open .video-level, .video-level:has([data-is-dragged]) { width: 64px; overflow: visible; }
.video-sound [data-video-sound]:not([data-sound-at="off"]) svg[data-shown-at="off"], .video-sound [data-video-sound]:not([data-sound-at="low"]) svg[data-shown-at="low"], .video-sound [data-video-sound]:not([data-sound-at="high"]) svg[data-shown-at="high"] { display: none; }
/* Narrow (a phone's width): its time says only where it's at, and Sound only mutes, its groove never opening, so everything fits on one
   line and the timeline keeps what's left. A touch screen's own buttons set the sound, so there it only mutes too. */
.video-seek { min-width: 0; }
@container (max-width: 25rem) { .video-time-length, .video-level { display: none; } }
/* Narrower still for its words (a phone at 200% text): Play, the timeline and full screen alone, so the timeline keeps room to seek. */
@container (max-width: 16rem) { .video-time, .video-sound { display: none; } }
@media (pointer: coarse) { .video-level { display: none; } }
/* Full screen: no pane to be carved into, so no carving: the video fills the screen edge to edge on black, and only its bar is glass. */
.video-player:fullscreen { width: 100%; height: 100%; aspect-ratio: auto; background: #000; box-shadow: none; clip-path: none; }
.video-player:fullscreen > .cut-line { display: none; }
.video-player:fullscreen > video { clip-path: none; }
/* There its bar floats a pane's margin in from the screen's edges (and clear of a phone's rounded corners and notch), not a frame gap. */
.video-player:fullscreen .video-controls { left: max(var(--pad-pane), env(safe-area-inset-left, 0px)); right: max(var(--pad-pane), env(safe-area-inset-right, 0px)); bottom: max(var(--pad-pane), env(safe-area-inset-bottom, 0px)); }
`,
  render: videoPlayer,
  examples: [
    { label: "Its poster until it plays: press it or Play", isWide: true, markup: playerPane(videoPlayer({ ...STAND_IN_PLAYER })) },
    { label: "Sound pointed at: the groove open beside it", isWide: true, markup: playerPane(videoPlayer({ ...STAND_IN_PLAYER, state: "is-sound-open" })), isStill: true },
    { label: "On a phone: the groove takes what's left", markup: html`<div style="width:280px">${playerPane(videoPlayer({ ...STAND_IN_PLAYER }))}</div>` },
  ],
});
