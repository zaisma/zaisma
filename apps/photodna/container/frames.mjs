// Still frames from a video, for the PhotoDNA hasher (server.mjs) to hash one by one. ffmpeg decodes only the
// video's keyframes, at least MINIMUM_FRAME_GAP_MS apart and at most MAXIMUM_FRAME_COUNT of them, spread evenly
// over a longer video. A video whose keyframes are far rarer than that (an encode that hides frames between
// them) is decoded in full at the same gap instead. Nothing here reads the SDK.
import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

/** Most frames taken from one video: a 10-minute video gets one every 2 s, a longer one the same 300 spread out. */
export const MAXIMUM_FRAME_COUNT = 300;
export const MINIMUM_FRAME_GAP_MS = 2000;
/** Keyframes rarer than one in this long (or in twice the gap, for a long video) mean the video is decoded in full. */
export const SPARSE_KEYFRAME_GAP_MS = 10_000;
/** How long taking one video's frames may run, both passes together; frames taken by then are hashed. */
export const MAXIMUM_EXTRACTION_MS = 4 * 60 * 1000;
/** Frames are scaled down to this on their long side: plenty for PhotoDNA, and a 4K frame doesn't fill the disk. */
export const MAXIMUM_FRAME_SIDE_PX = 1920;

/** Runs a command until it exits or `deadlineMs` (a Date.now() time) passes, when it's stopped. */
function run(command, args, deadlineMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    // showinfo writes a line per frame: only those, and the last error, are kept.
    child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-4 * 1024 * 1024)));
    let isTimedOut = false;
    const timer = setTimeout(() => {
      isTimedOut = true;
      child.kill("SIGKILL");
    }, Math.max(0, deadlineMs - Date.now()));
    const finish = (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, isTimedOut });
    };
    child.on("error", () => finish(-1));
    child.on("close", finish);
  });
}

/** The video's length, or null when its container doesn't say. */
async function durationMs(videoPath, deadlineMs) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath], deadlineMs);
  const seconds = Number.parseFloat(stdout.trim());
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/** One pass of ffmpeg: frames at least `gapMs` apart, written into `folder` as PNG files, with their times in the video. */
async function takeFrames(videoPath, folder, { isKeyframesOnly, gapMs, deadlineMs }) {
  await mkdir(folder, { recursive: true });
  const gapSeconds = (gapMs / 1000).toFixed(3);
  const filter = [`select='isnan(prev_selected_t)+gte(t-prev_selected_t,${gapSeconds})'`, `scale='min(iw,${MAXIMUM_FRAME_SIDE_PX})':'min(ih,${MAXIMUM_FRAME_SIDE_PX})':force_original_aspect_ratio=decrease`, "showinfo"].join(",");
  const args = ["-hide_banner", "-nostdin", "-loglevel", "info", ...(isKeyframesOnly ? ["-skip_frame", "nokey"] : []), "-i", videoPath, "-map", "0:v:0", "-an", "-sn", "-vf", filter, "-fps_mode", "vfr", "-frames:v", String(MAXIMUM_FRAME_COUNT), "-c:v", "png", "-compression_level", "1", join(folder, "frame-%05d.png")];
  const { stderr, exitCode, isTimedOut } = await run("ffmpeg", args, deadlineMs);
  const timesMs = [...stderr.matchAll(/\[Parsed_showinfo[^\]]*\][^\n]*?pts_time:\s*(-?[\d.]+)/g)].map((match) => Math.max(0, Math.round(Number.parseFloat(match[1]) * 1000)));
  const files = (await readdir(folder)).filter((name) => name.endsWith(".png")).sort();
  // A frame being written when ffmpeg was stopped may be cut short: the last one is dropped then.
  const kept = isTimedOut ? files.slice(0, -1) : files;
  const frames = kept.map((name, index) => ({ path: join(folder, name), timeInVideoMs: timesMs[index] ?? 0 }));
  const why = frames.length ? null : isTimedOut ? "no frame within the time allowed" : /matches no streams/.test(stderr) ? "no picture track" : `ffmpeg took no frame (exit ${exitCode}): ${stderr.trim().split("\n").slice(-1)[0]?.slice(0, 200) ?? ""}`;
  return { frames, isTimedOut, why };
}

/**
 * Still frames from the video at `videoPath`, as PNG files under `folder` (the caller's to remove):
 * `{ frames: [{ path, timeInVideoMs }] }`, or `{ why }` when none could be taken.
 */
export async function videoFrames(videoPath, folder, startedAtMs = Date.now()) {
  const deadlineMs = startedAtMs + MAXIMUM_EXTRACTION_MS;
  const lengthMs = await durationMs(videoPath, deadlineMs);
  const gapMs = lengthMs === null ? MINIMUM_FRAME_GAP_MS : Math.max(MINIMUM_FRAME_GAP_MS, lengthMs / MAXIMUM_FRAME_COUNT);
  const keyframes = await takeFrames(videoPath, join(folder, "keyframes"), { isKeyframesOnly: true, gapMs, deadlineMs });
  const expectedFrameCount = lengthMs === null ? 2 : Math.min(MAXIMUM_FRAME_COUNT, Math.floor(lengthMs / Math.max(gapMs, SPARSE_KEYFRAME_GAP_MS)) / 2);
  if (keyframes.isTimedOut || keyframes.frames.length >= expectedFrameCount) return keyframes.frames.length ? { frames: keyframes.frames } : { why: keyframes.why };
  const decoded = await takeFrames(videoPath, join(folder, "decoded"), { isKeyframesOnly: false, gapMs, deadlineMs });
  // Stopped by the time limit with fewer frames than the keyframes gave: the keyframes are hashed instead.
  const taken = decoded.frames.length >= keyframes.frames.length ? decoded : keyframes;
  return taken.frames.length ? { frames: taken.frames } : { why: taken.why };
}
