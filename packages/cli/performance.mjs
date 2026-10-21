// Notes on a game's files that would make it much smaller for players (docs/DECISIONS.md, "Every version is
// started in Chrome, and what it finds are notes."): textures that could be KTX2, WAV and AIFF audio, glTF models
// without mesh compression, and engine development builds, each with about what it saves and the fix. They never
// hold a version. `zaisma check`, check_game and the Chrome run after upload share them. Plain JavaScript with no
// imports, like check.mjs, so the upload command runs it in Node and the site imports it as it is.
// Docs: https://github.com/zaisma/zaisma/blob/main/docs/DEVELOPER-API.md#how-it-started-in-chrome

const MEGABYTE_BYTES = 1024 * 1024;

/** How much of an image, sound, model or engine loader the notes read: the first 64 KB, where their headers are. */
export const ASSET_HEAD_SIZE_BYTES = 64 * 1024;

/** A .gltf this size or smaller is read whole, for the .bin files it names; a bigger one has its data inside it. */
const MAXIMUM_WHOLE_GLTF_SIZE_BYTES = 16 * MEGABYTE_BYTES;

/**
 * Where a note is worth an AI's time on a PC-grade game and silent on a small one, and the fixed rates the
 * estimates use: KTX2 (Basis Universal ETC1S) at about 2 bits a pixel plus a third for mipmaps, Opus at 96 kbps.
 */
export const ASSET_NOTE_LIMITS = {
  minimumImageSizeBytes: MEGABYTE_BYTES,
  minimumImagesSizeBytes: 16 * MEGABYTE_BYTES,
  minimumImagesSavedSizeBytes: 8 * MEGABYTE_BYTES,
  minimumAudioSizeBytes: 8 * MEGABYTE_BYTES,
  minimumModelsSizeBytes: 8 * MEGABYTE_BYTES,
  ktx2BytesPerPixel: (2 / 8) * (4 / 3),
  opusBytesPerSec: 12_000,
};

/** The development or debug builds an engine's loader says it is, by a marker only its debug export has. */
const DEVELOPMENT_BUILD_MARKERS = [
  // Godot 4's loader names its engine file godot.web.template_debug…wasm in an export with Export With Debug ticked,
  // and template_release otherwise (test/engines/godot/debug-loader.js, from test/engines/godot/source).
  { engine: "Godot", marker: "godot.web.template_debug.", fix: "Untick Export With Debug in the export dialog and export again." },
];

/** Every asset note: what it means, and the fix for all but development_build, whose fix is its engine's. */
export const ASSET_NOTE_CODES = {
  images_could_be_ktx2: {
    meaning: "PNG, JPEG and WebP textures of a WebGL or WebGPU game that would be much smaller as KTX2.",
    fix: "Convert them with KTX-Software (toktx --t2 --encode etc1s --genmipmap out.ktx2 in.png) or basisu, and load them with your engine's KTX2 loader (three.js KTX2Loader, Babylon.js and PlayCanvas have one).",
  },
  audio_could_be_opus: {
    meaning: "WAV and AIFF audio that would be much smaller compressed.",
    fix: "Convert it (ffmpeg -i in.wav -c:a libopus -b:a 96k out.ogg). Safari plays Ogg from 18.4; for older Safari, also ship AAC in .m4a (ffmpeg -i in.wav -c:a aac -b:a 128k out.m4a).",
  },
  models_could_be_smaller: {
    meaning: "glTF models with no mesh compression.",
    fix: "Compress them with gltfpack (meshoptimizer) and load them with your engine's meshopt decoder (three.js GLTFLoader.setMeshoptDecoder); it usually makes models several times smaller.",
  },
  development_build: {
    meaning: "An engine's development or debug build, bigger and slower for players.",
    fix: DEVELOPMENT_BUILD_MARKERS.map(({ engine, fix }) => `${engine}: ${fix}`).join(" "),
  },
};

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
const AUDIO_EXTENSIONS = ["wav", "aif", "aiff"];
const CODE_EXTENSIONS = ["js", "mjs", "html", "htm"];
/** Code that draws with WebGL or WebGPU: the context names, and the engines that do. */
const GPU_CODE = /webgl2?|getContext\(\s*["']gpu["']|\bTHREE\.|\bBABYLON\b|\bpc\.Application\b|\bPhaser\b/;

const extensionOf = (path) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : "";
};
const megabytesText = (sizeBytes) => `${Math.max(1, Math.round(sizeBytes / MEGABYTE_BYTES))} MB`;
const latin1 = (bytes, startIndex = 0, endIndex = bytes.length) => String.fromCharCode(...bytes.subarray(startIndex, Math.min(endIndex, startIndex + 4096)));
const textOf = (bytes) => new TextDecoder().decode(bytes);

/**
 * The files whose first bytes the notes read, and how many: images of 1 MB or more, WAV and AIFF audio, .glb
 * models, a .gltf whole up to 16 MB (for the .bin files it names), and code, for an engine's development build.
 * Callers read these and hand them to findAssetNotes as each file's headBytes.
 */
export function assetHeadSizes(files) {
  const sizes = new Map();
  for (const file of files) {
    const extension = extensionOf(file.path);
    if (IMAGE_EXTENSIONS.includes(extension) && file.sizeBytes >= ASSET_NOTE_LIMITS.minimumImageSizeBytes) sizes.set(file.path, ASSET_HEAD_SIZE_BYTES);
    else if (AUDIO_EXTENSIONS.includes(extension) || extension === "glb" || CODE_EXTENSIONS.includes(extension)) sizes.set(file.path, Math.min(file.sizeBytes, ASSET_HEAD_SIZE_BYTES));
    else if (extension === "gltf") sizes.set(file.path, file.sizeBytes <= MAXIMUM_WHOLE_GLTF_SIZE_BYTES ? file.sizeBytes : ASSET_HEAD_SIZE_BYTES);
  }
  return sizes;
}

/** An image's width and height from its header (PNG IHDR, a JPEG SOFn marker, WebP's VP8, VP8L or VP8X), or null. */
export function imageSizePx(bytes) {
  if (!bytes || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0x89 && latin1(bytes, 1, 4) === "PNG" && latin1(bytes, 12, 16) === "IHDR") return { widthPx: view.getUint32(16), heightPx: view.getUint32(20) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let byteIndex = 2; byteIndex + 9 < bytes.length; ) {
      if (bytes[byteIndex] !== 0xff) return null;
      const marker = bytes[byteIndex + 1];
      if (marker === 0xff) {
        byteIndex += 1;
        continue;
      }
      // SOF0 to SOF15, besides DHT (C4), JPG (C8) and DAC (CC), carry the frame's size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { widthPx: view.getUint16(byteIndex + 7), heightPx: view.getUint16(byteIndex + 5) };
      byteIndex += 2 + view.getUint16(byteIndex + 2);
    }
    return null;
  }
  if (bytes.length >= 30 && latin1(bytes, 0, 4) === "RIFF" && latin1(bytes, 8, 12) === "WEBP") {
    const chunk = latin1(bytes, 12, 16);
    if (chunk === "VP8 ") return { widthPx: view.getUint16(26, true) & 0x3fff, heightPx: view.getUint16(28, true) & 0x3fff };
    if (chunk === "VP8L") {
      const packedNumber = view.getUint32(21, true);
      return { widthPx: (packedNumber & 0x3fff) + 1, heightPx: ((packedNumber >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { widthPx: (view.getUint32(24, true) & 0xffffff) + 1, heightPx: (view.getUint32(27, true) & 0xffffff) + 1 };
  }
  return null;
}

/** How long a WAV or AIFF file plays, in seconds, from its header; null when the header can't tell. */
export function audioDurationSec(bytes, sizeBytes) {
  if (!bytes || bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (latin1(bytes, 0, 4) === "RIFF" && latin1(bytes, 8, 12) === "WAVE") {
    let byteRate = null;
    for (let byteIndex = 12; byteIndex + 8 <= bytes.length; ) {
      const chunk = latin1(bytes, byteIndex, byteIndex + 4);
      const chunkSizeBytes = view.getUint32(byteIndex + 4, true);
      if (chunk === "fmt " && byteIndex + 16 <= bytes.length) byteRate = view.getUint32(byteIndex + 16, true);
      // The data chunk's own size, or what's left of the file when it's the last and its size wasn't written.
      if (chunk === "data") return byteRate ? Math.min(chunkSizeBytes, sizeBytes - byteIndex - 8) / byteRate : null;
      byteIndex += 8 + chunkSizeBytes + (chunkSizeBytes % 2);
    }
    return null;
  }
  if (latin1(bytes, 0, 4) === "FORM" && ["AIFF", "AIFC"].includes(latin1(bytes, 8, 12))) {
    for (let byteIndex = 12; byteIndex + 8 <= bytes.length; ) {
      const chunkSizeBytes = view.getUint32(byteIndex + 4);
      if (latin1(bytes, byteIndex, byteIndex + 4) === "COMM" && byteIndex + 26 <= bytes.length) {
        const frameCount = view.getUint32(byteIndex + 10);
        // The sample rate is an 80-bit IEEE extended number: a 15-bit exponent and a 64-bit mantissa.
        const exponentNumber = (view.getUint16(byteIndex + 16) & 0x7fff) - 16383;
        const mantissaNumber = view.getUint32(byteIndex + 18) * 2 ** 32 + view.getUint32(byteIndex + 22);
        const samplesPerSec = mantissaNumber * 2 ** (exponentNumber - 63);
        return samplesPerSec > 0 ? frameCount / samplesPerSec : null;
      }
      byteIndex += 8 + chunkSizeBytes + (chunkSizeBytes % 2);
    }
  }
  return null;
}

/** A glTF model's JSON, as far as its first bytes reach: a .glb's JSON chunk, or a .gltf's text. */
function modelJsonText(path, bytes) {
  if (!bytes) return "";
  if (extensionOf(path) === "gltf") return textOf(bytes);
  if (bytes.length < 20 || latin1(bytes, 0, 4) !== "glTF" || latin1(bytes, 16, 20) !== "JSON") return "";
  const chunkSizeBytes = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true);
  return textOf(bytes.subarray(20, 20 + chunkSizeBytes));
}

/**
 * The asset notes for a game's files: [{ path, sizeBytes, contentText, headBytes }], contentText as check.mjs takes
 * it (or null) and headBytes the first bytes assetHeadSizes asked for (or null when they weren't read: a note that
 * needs them then leaves that file out). A caller holding many files may read an image's size or a sound's length
 * itself and pass sizePx or durationSec instead of its bytes. isDrawnWithGpu says the game draws with WebGL or WebGPU, as its Chrome run
 * saw; null works it out from its code. Answers notes, snake_case: { code, message, path, saved_size_bytes, fix }.
 */
export function findAssetNotes(files, { isDrawnWithGpu = null } = {}) {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const codeTextOf = (file) => file.contentText ?? (file.headBytes ? textOf(file.headBytes) : "");
  const codeFiles = files.filter((file) => CODE_EXTENSIONS.includes(extensionOf(file.path)));
  const notes = [];
  const note = (code, message, paths, savedSizeBytes, fix = ASSET_NOTE_CODES[code].fix) => notes.push({ code, message, path: paths.length === 1 ? paths[0] : null, saved_size_bytes: savedSizeBytes, fix });

  // Textures: only a game that draws with the GPU uploads them as textures, and only an image the estimate halves counts.
  const isGpuGame = isDrawnWithGpu ?? codeFiles.some((file) => GPU_CODE.test(codeTextOf(file)));
  if (isGpuGame) {
    const images = [];
    for (const file of files) {
      if (!IMAGE_EXTENSIONS.includes(extensionOf(file.path)) || file.sizeBytes < ASSET_NOTE_LIMITS.minimumImageSizeBytes) continue;
      const measuredSizePx = file.sizePx ?? imageSizePx(file.headBytes);
      const estimatedSizeBytes = measuredSizePx ? Math.round(measuredSizePx.widthPx * measuredSizePx.heightPx * ASSET_NOTE_LIMITS.ktx2BytesPerPixel) : null;
      if (estimatedSizeBytes !== null && estimatedSizeBytes * 2 <= file.sizeBytes) images.push({ path: file.path, sizeBytes: file.sizeBytes, estimatedSizeBytes });
    }
    const totalSizeBytes = images.reduce((sumBytes, image) => sumBytes + image.sizeBytes, 0);
    const estimatedSizeBytes = images.reduce((sumBytes, image) => sumBytes + image.estimatedSizeBytes, 0);
    if (totalSizeBytes >= ASSET_NOTE_LIMITS.minimumImagesSizeBytes && totalSizeBytes - estimatedSizeBytes >= ASSET_NOTE_LIMITS.minimumImagesSavedSizeBytes) {
      const message = `${megabytesText(totalSizeBytes)} of PNG, JPEG and WebP textures could be about ${megabytesText(estimatedSizeBytes)} as KTX2, and use about a quarter of the graphics memory.`;
      note("images_could_be_ktx2", message, images.map((image) => image.path), totalSizeBytes - estimatedSizeBytes);
    }
  }

  const sounds = files.filter((file) => AUDIO_EXTENSIONS.includes(extensionOf(file.path)));
  const soundsSizeBytes = sounds.reduce((sumBytes, file) => sumBytes + file.sizeBytes, 0);
  if (soundsSizeBytes >= ASSET_NOTE_LIMITS.minimumAudioSizeBytes) {
    // A sound whose header can't tell its length is counted as it is: nothing saved on it.
    const estimatedSizeBytes = Math.round(sounds.reduce((sumBytes, file) => {
      const durationSec = file.durationSec ?? audioDurationSec(file.headBytes, file.sizeBytes);
      return sumBytes + (durationSec === null ? file.sizeBytes : Math.min(file.sizeBytes, durationSec * ASSET_NOTE_LIMITS.opusBytesPerSec));
    }, 0));
    if (estimatedSizeBytes < soundsSizeBytes) {
      note("audio_could_be_opus", `${megabytesText(soundsSizeBytes)} of WAV and AIFF audio could be about ${megabytesText(estimatedSizeBytes)} as Ogg Opus.`, sounds.map((file) => file.path), soundsSizeBytes - estimatedSizeBytes);
    }
  }

  const models = [];
  for (const file of files) {
    const extension = extensionOf(file.path);
    if ((extension !== "glb" && extension !== "gltf") || !file.headBytes) continue;
    const jsonText = modelJsonText(file.path, file.headBytes);
    if (/EXT_meshopt_compression|KHR_meshopt_compression|KHR_draco_mesh_compression/.test(jsonText)) continue;
    let sizeBytes = file.sizeBytes;
    if (extension === "gltf") {
      const folder = file.path.slice(0, file.path.lastIndexOf("/") + 1);
      try {
        for (const buffer of JSON.parse(jsonText).buffers ?? []) {
          if (typeof buffer.uri !== "string" || buffer.uri.startsWith("data:")) continue;
          sizeBytes += filesByPath.get(folder + decodeURIComponent(buffer.uri))?.sizeBytes ?? 0;
        }
      } catch {
        // A .gltf too big to read whole has its data inside it.
      }
    }
    models.push({ path: file.path, sizeBytes });
  }
  const modelsSizeBytes = models.reduce((sumBytes, model) => sumBytes + model.sizeBytes, 0);
  if (modelsSizeBytes >= ASSET_NOTE_LIMITS.minimumModelsSizeBytes) {
    note("models_could_be_smaller", `${megabytesText(modelsSizeBytes)} of glTF models have no mesh compression.`, models.map((model) => model.path), null);
  }

  for (const { engine, marker, fix } of DEVELOPMENT_BUILD_MARKERS) {
    const loader = codeFiles.find((file) => codeTextOf(file).includes(marker));
    if (loader) note("development_build", `This is a ${engine} development build: bigger and slower for players.`, [loader.path], null, fix);
  }
  return notes;
}
