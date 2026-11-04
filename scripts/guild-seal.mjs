#!/usr/bin/env node
// Zaisma Pro's guild seal, from its source (scripts/guild-seal/: the drawing, and the timelines in page.html), rendered in headless Chrome:
//
//   npm run guild-seal                the pictures and both videos
//   npm run guild-seal -- --stills    only the pictures
//
// brand/guild-seal-<px>.webp          one drawing, simply smaller, at every size; a page takes it as a picture
// brand/design/videos/guild-seal-*.mp4  the seal being made (forging), and at rest (resting, a loop); never drawn live
//
// Its letters come from Google Fonts while it renders, so this needs the network; nothing it writes does. Run it only when the drawing or a
// timeline changes, and check the files in.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openChrome } from "./chrome.mjs";
import { chromeToRun } from "./layout-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = pathToFileURL(join(ROOT, "scripts/guild-seal/page.html")).href;
const STILL_MASTER_PX = 2048;
const STILL_SIZES_PX = [1024, 512, 256, 128, 64, 40];
const VIDEO_PX = 640, FRAMES_PER_SECOND = 30, VIDEO_BITS_PER_SECOND = 2_000_000;

// Runs in the page: its frames through the browser's H.264 encoder, then into a small MP4 file with its index first, so it starts at once.
// Nothing here needs an encoder installed. H.264 because every browser and phone plays it in hardware; a VP9 file this wrote was refused on the page.
const ENCODER = `window.sealEncoder = (function () {
  var samples = [], encoder, W, H, FPS, avcC = null;
  function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function u16(n) { return [(n >>> 8) & 255, n & 255]; }
  function ascii(s) { return Array.from(s).map(function (c) { return c.charCodeAt(0); }); }
  function concat(parts) { var size = 0, at = 0; parts.forEach(function (p) { size += p.length; }); var out = new Uint8Array(size); parts.forEach(function (p) { out.set(p, at); at += p.length; }); return out; }
  function box(type) { var body = concat([].slice.call(arguments, 1).map(function (p) { return p instanceof Uint8Array ? p : new Uint8Array(p); })); return concat([new Uint8Array(u32(body.length + 8).concat(ascii(type))), body]); }
  var IDENTITY = [].concat(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000));
  function zeros(n) { return new Array(n).fill(0); }
  function moov(offset) {
    var TIMESCALE = FPS * 1000, count = samples.length, duration = count * 1000;
    var keys = []; samples.forEach(function (s, i) { if (s.key) keys.push(i + 1); });
    var avc1 = box("avc1", zeros(6), u16(1), zeros(16), u16(W), u16(H), u32(0x480000), u32(0x480000), u32(0), u16(1), zeros(32), u16(24), u16(0xFFFF), box("avcC", avcC));
    var stbl = box("stbl", box("stsd", u32(0), u32(1), avc1), box("stts", u32(0), u32(1), u32(count), u32(1000)), box("stss", u32(0), u32(keys.length), [].concat.apply([], keys.map(u32))), box("stsc", u32(0), u32(1), u32(1), u32(count), u32(1)), box("stsz", u32(0), u32(0), u32(count), [].concat.apply([], samples.map(function (s) { return u32(s.data.length); }))), box("stco", u32(0), u32(1), u32(offset)));
    var minf = box("minf", box("vmhd", u32(1), zeros(8)), box("dinf", box("dref", u32(0), u32(1), box("url ", u32(1)))), stbl);
    var mdia = box("mdia", box("mdhd", u32(0), u32(0), u32(0), u32(TIMESCALE), u32(duration), u16(0x55C4), u16(0)), box("hdlr", u32(0), u32(0), ascii("vide"), zeros(12), ascii("VideoHandler"), [0]), minf);
    var trak = box("trak", box("tkhd", u32(3), u32(0), u32(0), u32(1), u32(0), u32(duration), zeros(8), u16(0), u16(0), u16(0), u16(0), IDENTITY, u32(W * 65536), u32(H * 65536)), mdia);
    return box("moov", box("mvhd", u32(0), u32(0), u32(0), u32(TIMESCALE), u32(duration), u32(0x10000), u16(0x100), zeros(10), IDENTITY, zeros(24), u32(2)), trak);
  }
  return {
    start: async function (width, height, fps, bitrate) {
      samples = []; avcC = null; W = width; H = height; FPS = fps;
      var config = { codec: "avc1.640028", width: width, height: height, bitrate: bitrate, framerate: fps, avc: { format: "avc" } };
      if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error("This Chrome has no H.264 encoder: run it with the system's Chrome.");
      encoder = new VideoEncoder({ output: function (chunk, metadata) { if (metadata && metadata.decoderConfig && metadata.decoderConfig.description) avcC = new Uint8Array(metadata.decoderConfig.description.slice ? metadata.decoderConfig.description.slice(0) : metadata.decoderConfig.description.buffer); var data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); samples.push({ key: chunk.type === "key", at: chunk.timestamp, data: data }); }, error: function (e) { console.error(e); } });
      encoder.configure(config);
    },
    add: async function (base64, index) { var blob = await (await fetch("data:image/png;base64," + base64)).blob(), bitmap = await createImageBitmap(blob), frame = new VideoFrame(bitmap, { timestamp: Math.round(index * 1e6 / FPS), duration: Math.round(1e6 / FPS) }); encoder.encode(frame, { keyFrame: index % (FPS * 2) === 0 }); frame.close(); bitmap.close(); },
    finish: async function () {
      await encoder.flush(); encoder.close();
      for (var i = 1; i < samples.length; i++) if (samples[i].at <= samples[i - 1].at) throw new Error("The encoder reordered its frames: this file writer doesn't handle that.");
      var ftyp = box("ftyp", ascii("isom"), u32(512), ascii("isomiso2avc1mp41"));
      var offset = ftyp.length + moov(0).length + 8;
      var file = concat([ftyp, moov(offset), box("mdat", concat(samples.map(function (s) { return s.data; })))]), s = "";
      for (var k = 0; k < file.length; k += 32768) s += String.fromCharCode.apply(null, file.subarray(k, k + 32768));
      return btoa(s);
    }
  };
})();`;

const args = process.argv.slice(2);
const chrome = await openChrome(await chromeToRun(), "zaisma-guild-seal-");
try {
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, parameters = {}) => chrome.send(method, parameters, sessionId);
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const shot = async () => (await send("Page.captureScreenshot", { format: "png" })).data;
  await send("Page.enable");
  await send("Runtime.enable");
  const open = async (sizePx, isClear) => {
    await send("Emulation.setDeviceMetricsOverride", { width: sizePx, height: sizePx, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setDefaultBackgroundColorOverride", isClear ? { color: { r: 0, g: 0, b: 0, a: 0 } } : { color: { r: 29, g: 23, b: 16, a: 1 } });
    const loaded = new Promise((done) => { const off = chrome.on?.("Page.loadEventFired", () => { off?.(); done(); }); setTimeout(done, 4000); });
    await send("Page.navigate", { url: PAGE });
    await loaded;
    if (!(await evaluate("window.guildSeal.isFontReady()"))) throw new Error("The seal's letters didn't load from Google Fonts: this needs the network.");
    await evaluate(ENCODER);
  };

  await open(STILL_MASTER_PX, true);
  await evaluate("window.guildSeal.still(); new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))");
  const master = await shot();
  for (const sizePx of STILL_SIZES_PX) {
    const data = await evaluate(`(async () => { const blob = await (await fetch("data:image/png;base64,${master}")).blob(); const bitmap = await createImageBitmap(blob, { resizeWidth: ${sizePx}, resizeHeight: ${sizePx}, resizeQuality: "high" }); const canvas = new OffscreenCanvas(${sizePx}, ${sizePx}); canvas.getContext("2d").drawImage(bitmap, 0, 0); const out = await canvas.convertToBlob({ type: "image/webp", quality: 0.9 }); const bytes = new Uint8Array(await out.arrayBuffer()); let s = ""; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)); return btoa(s); })()`);
    const file = Buffer.from(data, "base64");
    writeFileSync(join(ROOT, `brand/guild-seal-${sizePx}.webp`), file);
    console.log(`brand/guild-seal-${sizePx}.webp (${Math.round(file.length / 1024)} KB)`);
  }

  if (!args.includes("--stills")) {
    mkdirSync(join(ROOT, "brand/design/videos"), { recursive: true });
    await open(VIDEO_PX, false);
    for (const name of ["forging", "resting"]) {
      const durationMs = await evaluate(`window.guildSeal.${name}()`);
      const frameCount = Math.round((durationMs / 1000) * FRAMES_PER_SECOND);
      await evaluate(`window.sealEncoder.start(${VIDEO_PX}, ${VIDEO_PX}, ${FRAMES_PER_SECOND}, ${VIDEO_BITS_PER_SECOND})`);
      for (let index = 0; index < frameCount; index++) {
        await evaluate(`window.guildSeal.seek(${(index * 1000) / FRAMES_PER_SECOND})`);
        await send("Runtime.evaluate", { expression: `window.sealEncoder.add(${JSON.stringify(await shot())}, ${index})`, awaitPromise: true });
        if (index % 60 === 0) console.log(`${name}: frame ${index} of ${frameCount}`);
      }
      const file = Buffer.from(await evaluate("window.sealEncoder.finish()"), "base64");
      writeFileSync(join(ROOT, `brand/design/videos/guild-seal-${name}.mp4`), file);
      console.log(`brand/design/videos/guild-seal-${name}.mp4 (${Math.round(file.length / 1024)} KB)`);
    }
  }
} finally {
  await chrome.close();
}
