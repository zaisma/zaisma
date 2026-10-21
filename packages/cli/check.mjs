// The game check behind `zaisma check`, the MCP's check_game and POST /api/dev/check: what Zaisma would
// refuse in a game, and what won't work inside its game frame, each with how to fix it. Plain JavaScript
// with no imports, so the upload command runs it in Node and the site imports it as it is.
// Docs: https://github.com/zaisma/zaisma/blob/main/docs/DEVELOPER-API.md#checking-a-game

/** Every file type a game may contain: the extensions in CONTENT_TYPES (packages/core/src/mime.ts), in its order. */
export const GAME_FILE_EXTENSIONS = [
  "html", "htm", "js", "mjs", "css", "json", "map", "txt", "md", "xml", "csv", "wasm", "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp",
  "mp3", "ogg", "oga", "opus", "wav", "m4a", "aac", "flac", "mp4", "webm", "woff", "woff2", "ttf", "otf", "glb", "gltf", "obj", "mtl", "ktx2", "basis", "hdr",
  "bin", "data", "dat", "pck", "atlas", "fnt", "tmx", "tsx", "tmj", "ldtk",
];

/** The upload limits the API refuses past (FILE_LIMITS in packages/core/src/uploads.ts, and a path's length in ZIP_LIMITS). */
export const UPLOAD_LIMITS = { maximumGameSizeBytes: 2 * 1024 * 1024 * 1024, maximumFileSizeBytes: 500 * 1024 * 1024, maximumFileCount: 20_000, maximumPathCharacterCount: 200 };

/** The files whose text the check reads; for every other file it needs only the path and size. */
export const CHECKED_TEXT_EXTENSIONS = ["html", "htm", "js", "mjs", "css"];

/** Files a pre-compressed build has, which the upload command unpacks. */
export const PRECOMPRESSED_EXTENSIONS = ["gz", "br", "unityweb"];

/** The most problems one answer lists; the rest are counted in omitted_problem_count. */
export const MAXIMUM_PROBLEM_COUNT = 200;

/**
 * Every problem the check finds. refused: Zaisma refuses the upload as it is. broken: it uploads, but that
 * part won't work on Zaisma. The file-list codes are the API's own error codes, with the same meanings.
 */
export const CHECK_PROBLEM_CODES = {
  no_index_html: { problemKind: "refused", isFixedByUploadCommand: false, meaning: "There's no index.html at the top." },
  file_type_not_allowed: { problemKind: "refused", isFixedByUploadCommand: false, meaning: "A file is of a type games can't have." },
  precompressed_file: { problemKind: "refused", isFixedByUploadCommand: true, meaning: "A file is pre-compressed (.gz, .br or Unity's .unityweb); the upload command unpacks it." },
  hidden_file: { problemKind: "refused", isFixedByUploadCommand: true, meaning: "A file or folder's name starts with a dot; the upload command leaves it out." },
  duplicate_path: { problemKind: "refused", isFixedByUploadCommand: false, meaning: "Two files share a path (paths don't depend on case)." },
  bad_path: { problemKind: "refused", isFixedByUploadCommand: false, meaning: "A path is absolute, has . or .. or an empty part in it, has control characters or is over 200 characters." },
  file_too_big: { problemKind: "refused", isFixedByUploadCommand: false, meaning: "A file is over 500 MB." },
  game_too_big: { problemKind: "refused", isFixedByUploadCommand: false, meaning: "The game is over 2 GB." },
  too_many_files: { problemKind: "refused", isFixedByUploadCommand: false, meaning: "The game has more than 20,000 files." },
  outside_file: { problemKind: "broken", isFixedByUploadCommand: true, meaning: "The page, a stylesheet or a module loads a file from another site; the upload command downloads it into the game." },
  outside_address: { problemKind: "broken", isFixedByUploadCommand: false, meaning: "The code connects to or loads from another site while it runs." },
  address_not_allowed: { problemKind: "broken", isFixedByUploadCommand: false, meaning: "The code connects to an address no game can use: plain ws:// or http://, localhost, or an IP address." },
  needs_threads: { problemKind: "broken", isFixedByUploadCommand: false, meaning: "The build needs threads (SharedArrayBuffer), which games on Zaisma don't have." },
  browser_dialog: { problemKind: "broken", isFixedByUploadCommand: false, meaning: "alert, confirm or prompt, which never show in the game's frame." },
  form_submission: { problemKind: "broken", isFixedByUploadCommand: false, meaning: "A form, which never submits in the game's frame." },
  file_download: { problemKind: "broken", isFixedByUploadCommand: false, meaning: "A file download, which the game's frame doesn't allow." },
  outside_link: { problemKind: "broken", isFixedByUploadCommand: false, meaning: "A link that opens another site or a new window, which the game's frame doesn't allow." },
  outside_frame: { problemKind: "broken", isFixedByUploadCommand: false, meaning: "A frame of another site, which games can't show." },
  blocked_feature: { problemKind: "broken", isFixedByUploadCommand: false, meaning: "Camera, microphone, screen capture, location, payments, USB, serial, Bluetooth or HID, which games on Zaisma can't use." },
};

/** Hosts that appear in nearly every file and never load anything (the scan's own list, packages/core/src/scan/static.ts). */
const IGNORED_HOSTS = new Set(["www.w3.org", "w3.org", "schemas.xmlsoap.org", "ns.adobe.com", "purl.org", "xmlns.com"]);
/** Zaisma's own hosts: rooms are always allowed, and the game's own site is the game domain. */
const isZaismaHost = (host) => host === "zaisma.com" || host.endsWith(".zaisma.com") || host === "zaismausercontent.com" || host.endsWith(".zaismausercontent.com");
const isLocalHost = (host) => host === "localhost" || host.endsWith(".localhost") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");

/** The extension of a path's last part, lowercase, without the dot; "" when it has none. */
export const extensionOf = (path) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : "";
};

/** A match's text for people and AIs to search for: on one line, up to 120 characters. */
const quoteOf = (text) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
};

/** The line a match is on, for people and AIs to search for: up to 120 characters, around the match when the line is longer. */
const lineAround = (text, index) => {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const lineEnd = text.indexOf("\n", index) === -1 ? text.length : text.indexOf("\n", index);
  const windowStartIndex = Math.max(lineStart, Math.min(index - 40, lineEnd - 120));
  return quoteOf(text.slice(windowStartIndex, Math.min(lineEnd, windowStartIndex + 120)));
};

/**
 * Engine and library output: Unity's framework and loader, a .js beside a .wasm of the same name (Godot,
 * Emscripten), wasm-bindgen's glue (Bevy, Trunk) beside its _bg.wasm, macroquad's and miniquad's loader
 * beside a .wasm, and minified libraries. Their code mentions dialogs, cameras and the like without the game
 * using them, so the behaviour checks skip them.
 */
export function isEngineOutput(path, lowercasePaths) {
  const lowercasePath = path.toLowerCase();
  if (/\.(framework|loader)\.js$/.test(lowercasePath) || /\.min\.m?js$/.test(lowercasePath)) return true;
  if (!/\.m?js$/.test(lowercasePath)) return false;
  if (lowercasePaths.has(lowercasePath.replace(/\.m?js$/, ".wasm"))) return true;
  if (lowercasePaths.has(lowercasePath.replace(/\.m?js$/, "_bg.wasm"))) return true;
  const folder = lowercasePath.slice(0, lowercasePath.lastIndexOf("/") + 1);
  return /(^|\/)(mq_js_bundle|gl)\.js$/.test(lowercasePath) && [...lowercasePaths].some((other) => other.startsWith(folder) && !other.slice(folder.length).includes("/") && other.endsWith(".wasm"));
}

/** The text with JavaScript comments blanked to spaces (line breaks kept), so indexes into it are the original's. */
function blankScriptComments(text) {
  const out = text.split("");
  const blank = (startIndex, endIndex) => {
    for (let index = startIndex; index < endIndex; index++) if (out[index] !== "\n") out[index] = " ";
  };
  let lastSignificant = "";
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const next = text[index + 1];
    if (character === "/" && next === "/") {
      const lineEndIndex = text.indexOf("\n", index);
      blank(index, lineEndIndex === -1 ? text.length : lineEndIndex);
      index = lineEndIndex === -1 ? text.length : lineEndIndex;
    } else if (character === "/" && next === "*") {
      const closeIndex = text.indexOf("*/", index + 2);
      blank(index, closeIndex === -1 ? text.length : closeIndex + 2);
      index = closeIndex === -1 ? text.length : closeIndex + 1;
    } else if (character === '"' || character === "'" || character === "`") {
      // A string: skip to its end, so a // or /* in it isn't a comment.
      let closeIndex = index + 1;
      while (closeIndex < text.length && text[closeIndex] !== character && (character === "`" || text[closeIndex] !== "\n")) closeIndex += text[closeIndex] === "\\" ? 2 : 1;
      index = closeIndex;
      lastSignificant = character;
    } else if (character === "/" && (lastSignificant === "" || "(,=:[!&|?{};+-*%<>~^".includes(lastSignificant))) {
      // A regular expression: skip to its closing slash, outside a [class].
      let closeIndex = index + 1;
      let isInClass = false;
      while (closeIndex < text.length && text[closeIndex] !== "\n" && (isInClass || text[closeIndex] !== "/")) {
        if (text[closeIndex] === "\\") closeIndex++;
        else if (text[closeIndex] === "[") isInClass = true;
        else if (text[closeIndex] === "]") isInClass = false;
        closeIndex++;
      }
      index = closeIndex;
      lastSignificant = "/";
    } else if (!/\s/.test(character)) {
      lastSignificant = character;
    }
  }
  return out.join("");
}

/** A page's or module's text with its comments blanked, HTML's and its scripts' JavaScript ones, at the same indexes. */
function blankComments(text, fileKind) {
  if (fileKind === "module") return blankScriptComments(text);
  const spaces = (part) => part.replace(/[^\n]/g, " ");
  return text
    .replace(/<!--[\s\S]*?(?:-->|$)/g, spaces)
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>|$)/gi, (...[, openTag, body, closeTag]) => openTag + blankScriptComments(body) + closeTag);
}

/** An attribute's value in a tag, with where the value starts and ends in the whole text. */
function attributeOf(tag, tagStart, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`, "i").exec(tag);
  if (!match) return null;
  const attributeValue = match[1] ?? match[2] ?? match[3] ?? "";
  const valueStartIndex = tagStart + match.index + match[0].length - attributeValue.length - (match[3] === undefined ? 1 : 0);
  return { attributeValue, start: valueStartIndex, end: valueStartIndex + attributeValue.length };
}

/** An absolute http(s) URL for a reference, or null when it isn't one to download. */
function resolveReference(raw, baseUrl, isModuleSpecifier) {
  const given = raw.trim();
  if (!given || /^(data|blob|javascript|about|mailto):/i.test(given) || given.startsWith("#") || /^(\.\/)?_zaisma\//.test(given)) return null;
  const isAbsolute = /^(https?:)?\/\//i.test(given);
  if (!isAbsolute && !baseUrl) return null;
  // A bare module name ("three") is the import map's to resolve, not a file.
  if (!isAbsolute && isModuleSpecifier && !/^(\.{1,2})?\//.test(given)) return null;
  try {
    const url = new URL(given.startsWith("//") ? `https:${given}` : given, baseUrl ?? undefined);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

const IMPORT_PATTERN = /(?:^|[^\w$.])(?:import|export)\s*(?:[\w$*{}\s,]*?\bfrom\s*)?(["'])([^"'\n]+?)\1/g;
const DYNAMIC_IMPORT_PATTERN = /(?:^|[^\w$.])import\s*\(\s*(["'`])([^"'`\n]+?)\1\s*\)/g;
const CSS_IMPORT_PATTERN = /@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1/gi;
const CSS_URL_PATTERN = /url\(\s*(["']?)([^"')]+?)\1\s*\)/gi;

/**
 * Every outside file a text loads: where the URL stands in the text (start, end), what kind of reference it
 * is and the URL it resolves to. fileKind is html, css or module. Without a baseUrl (the game's own files)
 * only http(s) and // URLs count; with one (a file downloaded from baseUrl) relative ones count too.
 * referenceKind: script (a classic script tag), module, style, file or import_map (importMapKey is set; a
 * key ending in / is a prefix).
 */
export function findOutsideReferences(text, fileKind, { baseUrl = null } = {}) {
  const references = [];
  const add = (raw, start, referenceKind, quote, isModuleSpecifier = false, importMapKey = null) => {
    const url = resolveReference(raw, baseUrl, isModuleSpecifier);
    if (url) references.push({ url, start, end: start + raw.length, referenceKind, quote: quoteOf(quote), importMapKey });
  };
  const findCss = (css, offset) => {
    const importSpans = [];
    for (const match of css.matchAll(CSS_IMPORT_PATTERN)) {
      importSpans.push([match.index, match.index + match[0].length]);
      add(match[2], offset + match.index + match[0].lastIndexOf(match[2]), "style", match[0]);
    }
    for (const match of css.matchAll(CSS_URL_PATTERN)) {
      if (importSpans.some(([start, end]) => match.index >= start && match.index < end)) continue;
      add(match[2], offset + match.index + match[0].indexOf(match[2], 4), "file", match[0]);
    }
  };
  const findModule = (code, offset) => {
    for (const pattern of [IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN]) {
      for (const match of code.matchAll(pattern)) add(match[2], offset + match.index + match[0].lastIndexOf(match[1] + match[2]) + 1, "module", match[0], true);
    }
  };
  if (fileKind === "css") findCss(text, 0);
  if (fileKind === "module") findModule(text, 0);
  if (fileKind !== "html") return references.sort((first, second) => first.start - second.start);

  for (const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const openingTag = `<script${match[1]}>`;
    const type = (attributeOf(openingTag, match.index, "type")?.attributeValue ?? "").toLowerCase();
    const source = attributeOf(openingTag, match.index, "src");
    const contentStart = match.index + openingTag.length;
    if (source) add(source.attributeValue, source.start, type === "module" ? "module" : "script", openingTag);
    else if (type === "importmap") {
      let importMap;
      try {
        importMap = JSON.parse(match[2]);
      } catch {
        continue;
      }
      let searchFromIndex = 0;
      const entries = [...Object.entries(importMap?.imports ?? {}), ...Object.values(importMap?.scopes ?? {}).flatMap((scope) => Object.entries(scope ?? {}))];
      for (const [key, mappedUrl] of entries) {
        if (typeof mappedUrl !== "string") continue;
        const written = JSON.stringify(mappedUrl);
        const foundIndex = match[2].indexOf(written, searchFromIndex);
        if (foundIndex === -1) continue;
        searchFromIndex = foundIndex + written.length;
        add(mappedUrl, contentStart + foundIndex + 1, "import_map", `"${key}": ${written}`, false, key);
      }
    } else if (type === "module") findModule(match[2], contentStart);
  }
  for (const match of text.matchAll(/<link\b[^>]*>/gi)) {
    const relations = (attributeOf(match[0], match.index, "rel")?.attributeValue ?? "").toLowerCase().split(/\s+/);
    const link = attributeOf(match[0], match.index, "href");
    if (!link) continue;
    if (relations.includes("stylesheet")) add(link.attributeValue, link.start, "style", match[0]);
    else if (relations.includes("modulepreload")) add(link.attributeValue, link.start, "module", match[0]);
    else if (relations.includes("preload") && (attributeOf(match[0], match.index, "as")?.attributeValue ?? "").toLowerCase() === "script") add(link.attributeValue, link.start, "script", match[0]);
    else if (relations.some((relation) => ["icon", "apple-touch-icon", "preload"].includes(relation))) add(link.attributeValue, link.start, "file", match[0]);
  }
  for (const match of text.matchAll(/<(?:img|audio|video|source)\b[^>]*>/gi)) {
    const media = attributeOf(match[0], match.index, "src");
    if (media) add(media.attributeValue, media.start, "file", match[0]);
  }
  for (const match of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) findCss(match[1], match.index + match[0].indexOf(">") + 1);
  for (const match of text.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const css = match[1] ?? match[2];
    findCss(css, match.index + match[0].indexOf(css, match[0].indexOf("=")));
  }
  return references.sort((first, second) => first.start - second.start);
}

/** Addresses code connects to or loads from while it runs: any ws(s):// text, and http(s) URLs given straight to the calls that load. */
const ADDRESS_PATTERNS = [
  /(["'`])(wss?:\/\/[^"'`\s]+)\1/g,
  /\b(?:fetch|WebSocket|EventSource|importScripts|Worker|Audio|io)\s*\(\s*(["'`])((?:https?|wss?):\/\/[^"'`\s]+)\1/g,
  /\.open\s*\(\s*["'`][A-Za-z]+["'`]\s*,\s*(["'`])(https?:\/\/[^"'`\s]+)\1/g,
  /\.src\s*=\s*(["'`])(https?:\/\/[^"'`\s]+)\1/g,
];

function findAddresses(text) {
  const addresses = [];
  for (const pattern of ADDRESS_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      let url;
      try {
        url = new URL(match[2]);
      } catch {
        continue;
      }
      if (url.hostname.includes("$")) continue;
      addresses.push({ index: match.index, protocol: url.protocol.slice(0, -1), host: url.hostname.toLowerCase(), quote: lineAround(text, match.index) });
    }
  }
  return addresses.sort((first, second) => first.index - second.index);
}

const FEATURES = [
  { pattern: /\bgetUserMedia\b/, name: "the camera or microphone (getUserMedia)" },
  { pattern: /\bgetDisplayMedia\b/, name: "screen capture (getDisplayMedia)" },
  { pattern: /\bnavigator\.geolocation\b/, name: "location (navigator.geolocation)" },
  { pattern: /\bnew\s+PaymentRequest\b/, name: "payments (PaymentRequest)" },
  { pattern: /\bnavigator\.usb\b/, name: "USB (navigator.usb)" },
  { pattern: /\bnavigator\.serial\b/, name: "serial ports (navigator.serial)" },
  { pattern: /\bnavigator\.bluetooth\b/, name: "Bluetooth (navigator.bluetooth)" },
  { pattern: /\bnavigator\.hid\b/, name: "HID devices (navigator.hid)" },
];
const DIALOG_PATTERN = /(?<![\w$.])(?<!function\s+)(?:window\.)?(alert|confirm|prompt)\s*\(/;
/** Only when a load fails, like Unity's page template's .catch((message) => { alert(message); }): the game itself works. */
const FAILURE_HANDLER_BEFORE_PATTERN = /\.catch\(\s*(?:function\s*)?\(?\s*[\w$]*\s*\)?\s*(?:=>\s*)?\{\s*$/;
/** The first dialog the code opens, besides one only a failed load opens. */
function dialogOf(code) {
  const pattern = new RegExp(DIALOG_PATTERN.source, "g");
  for (const match of code.matchAll(pattern)) {
    if (!FAILURE_HANDLER_BEFORE_PATTERN.test(code.slice(Math.max(0, match.index - 80), match.index))) return match;
  }
  return null;
}
const THREADS_PATTERNS = [/\bGODOT_THREADS_ENABLED\s*=\s*true\b/, /\bENVIRONMENT_IS_PTHREAD\b/, /coi-serviceworker/i, /\b__wbindgen_thread_destroy\b/, /\binitThreadPool\b/];

/**
 * Checks a game's files: [{ path, sizeBytes, contentText }], contentText a string for the checked text files
 * (CHECKED_TEXT_EXTENSIONS) and null for the rest. slug names the game in the fixes; ownServerUrls are its
 * own servers, which the code may connect to (null when they aren't known). Answers the API's answer, snake_case: { file_count,
 * size_bytes, problems, omitted_problem_count }, each problem { code, problem_kind,
 * is_fixed_by_upload_command, message, path, quote, fix }.
 */
export function checkGameFiles(files, { slug = null, ownServerUrls = null } = {}) {
  const game = slug ?? "<slug>";
  const ownHosts = new Set((ownServerUrls ?? []).map((ownServerUrl) => { try { return new URL(ownServerUrl).hostname.toLowerCase(); } catch { return ""; } }));
  const problems = [];
  const seen = new Set();
  let omittedProblemCount = 0;
  const add = (code, { message, path = null, quote = null, fix, sameAs = "" }) => {
    const key = `${code}\n${path}\n${sameAs}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (problems.length >= MAXIMUM_PROBLEM_COUNT) {
      omittedProblemCount++;
      return;
    }
    const { problemKind, isFixedByUploadCommand } = CHECK_PROBLEM_CODES[code];
    problems.push({ code, problem_kind: problemKind, is_fixed_by_upload_command: isFixedByUploadCommand, message, path, quote, fix });
  };

  const lowercasePaths = new Set(files.map((file) => file.path.toLowerCase()));
  const pathsSeen = new Set();
  let sizeBytes = 0;
  for (const file of files) {
    sizeBytes += file.sizeBytes;
    const { path } = file;
    // eslint-disable-next-line no-control-regex
    if (path.startsWith("/") || /^[a-z]:/i.test(path) || /[\u0000-\u001f\u007f]/.test(path) || path.replace(/\\/g, "/").split("/").some((part) => part === "" || part === "." || part === "..") || path.length > UPLOAD_LIMITS.maximumPathCharacterCount) {
      add("bad_path", { message: `${JSON.stringify(path.slice(0, 80))} isn't a path a game can have.`, path: path.slice(0, 200), fix: "Give paths relative to the game's folder, like index.html or assets/hero.png: no leading /, no . or .. parts, up to 200 characters. Rename or move the file." });
      continue;
    }
    const parts = path.split("/");
    const hiddenIndex = parts.findIndex((part) => part.startsWith("."));
    if (hiddenIndex !== -1) {
      const hiddenPath = parts.slice(0, hiddenIndex + 1).join("/");
      add("hidden_file", { message: `${hiddenPath} is hidden: its name starts with a dot.`, path: hiddenPath, sameAs: hiddenPath, fix: "zaisma upload leaves hidden files out. With upload_files or the API, leave it out of the files." });
      continue;
    }
    const extension = extensionOf(path);
    if (PRECOMPRESSED_EXTENSIONS.includes(extension)) {
      const unpackedPath = path.slice(0, -extension.length - 1);
      add("precompressed_file", { message: `${path} is pre-compressed.`, path, fix: `zaisma upload unpacks it into ${unpackedPath} and points the game at it; Zaisma compresses files for players itself. With upload_files or the API, turn off compression in the engine's build settings (Unity: Publishing Settings, Compression Format: Disabled) and build again.` });
    } else if (!GAME_FILE_EXTENSIONS.includes(extension)) {
      add("file_type_not_allowed", { message: `${path}: .${extension || "(no extension)"} files aren't allowed in games.`, path, fix: `Leave it out of the game's folder. Games can have: ${GAME_FILE_EXTENSIONS.join(", ")}.` });
    }
    if (file.sizeBytes > UPLOAD_LIMITS.maximumFileSizeBytes) add("file_too_big", { message: `${path} is over 500 MB.`, path, fix: "Split it into smaller files, or ask Zaisma (message_zaisma, kind gap) if the game needs bigger ones." });
    const lowercasePath = path.toLowerCase();
    if (pathsSeen.has(lowercasePath)) add("duplicate_path", { message: `Two files share the path ${path} (paths don't depend on case).`, path, fix: "Give each file its own path." });
    pathsSeen.add(lowercasePath);
  }
  if (!pathsSeen.has("index.html")) {
    const nested = [...pathsSeen].filter((path) => path.endsWith("/index.html")).sort((first, second) => first.split("/").length - second.split("/").length || first.localeCompare(second))[0];
    const folder = nested ? files.find((file) => file.path.toLowerCase() === nested).path.slice(0, -"/index.html".length) : null;
    add("no_index_html", { message: "There's no index.html at the top of the game.", fix: folder ? `Upload the ${folder} folder instead: index.html has to be at the top of the folder you upload.` : "Add the game's start page as index.html at the top of the folder." });
  }
  if (files.length > UPLOAD_LIMITS.maximumFileCount) add("too_many_files", { message: `The game has ${files.length} files; the limit is 20,000.`, fix: "Leave out files the game doesn't load, or pack small ones together (like sprites into an atlas)." });
  if (sizeBytes > UPLOAD_LIMITS.maximumGameSizeBytes) add("game_too_big", { message: `The game is ${(sizeBytes / 1024 ** 3).toFixed(1)} GB; the limit is 2 GB.`, fix: "Leave out files the game doesn't load, or ask Zaisma (message_zaisma, kind gap) for more." });

  const threadsFix = "Export without threads: in Godot 4.3 or newer, turn Thread Support off in the Web export preset (Godot 4.0 to 4.2 always use threads, so update); in Unity, leave Native C/C++ Multithreading off in Player Settings, the default; in Rust, build without the `atomics` target feature (the default) and without wasm-bindgen-rayon. Games on Zaisma can't have SharedArrayBuffer.";
  let hasThreadsProblem = false;
  const addThreads = (message, quote, path) => {
    if (!hasThreadsProblem) add("needs_threads", { message, quote, path, fix: threadsFix });
    hasThreadsProblem = true;
  };
  for (const file of files) {
    const { path, contentText: text } = file;
    if (typeof text !== "string") {
      if (/coi-serviceworker/i.test(path)) addThreads(`${path} is there to turn on threads (SharedArrayBuffer), which games on Zaisma don't have.`, null, path);
      continue;
    }
    const extension = extensionOf(path);
    const fileKind = extension === "css" ? "css" : extension === "js" || extension === "mjs" ? "module" : "html";

    for (const reference of findOutsideReferences(text, fileKind)) {
      add("outside_file", { message: `${path} loads ${reference.url} from another site, which games on Zaisma can't do.`, path, quote: reference.quote, sameAs: reference.url, fix: `zaisma upload downloads it into the game and points ${path} at it. With upload_files or the API, download it into the game's files yourself and load it by its path.` });
    }
    if (fileKind === "css") continue;

    for (const address of findAddresses(text)) {
      const { host, protocol } = address;
      if (IGNORED_HOSTS.has(host) || isZaismaHost(host)) continue;
      const isSocket = protocol === "ws" || protocol === "wss";
      if (isLocalHost(host)) {
        add("address_not_allowed", { message: `${path} connects to ${host}, and players' browsers can't connect to localhost or an IP address from a game on Zaisma.`, path, quote: address.quote, sameAs: host, fix: `Run the server at a host name with wss:// (or https://) and list it as one of the game's own servers: zaisma own-servers ${game} wss://play.example.com (the command sets the whole list, so name any it already has too), or update_game with own_server_urls. Or use Zaisma rooms.` });
      } else if (protocol === "ws" || protocol === "http") {
        add("address_not_allowed", { message: `${path} connects to ${protocol}://${host}, a plain address the game page's browser blocks.`, path, quote: address.quote, sameAs: host, fix: `Use ${isSocket ? "wss" : "https"}://${host}: games run on https, and own servers take only wss:// and https:// addresses. Then list it: zaisma own-servers ${game} ${isSocket ? "wss" : "https"}://${host} (the command sets the whole list, so name any it already has too).` });
      } else if (!ownHosts.has(host)) {
        add("outside_address", {
          message: `${path} connects to or loads from ${host} while it runs${ownServerUrls ? ", and it isn't one of the game's own servers" : ", which works only if it's one of the game's own servers"}.`,
          path,
          quote: address.quote,
          sameAs: host,
          fix: `If ${host} is the game's own server, list it so players' browsers may connect: zaisma own-servers ${game} ${isSocket ? "wss" : "https"}://${host} (the command sets the whole list, so name any it already has too), or update_game with own_server_urls; it works at once. If it's a file, put it in the game's files and load it by its path.`,
        });
      }
    }

    const threadsMatch = THREADS_PATTERNS.map((pattern) => pattern.exec(text)).find(Boolean);
    if (threadsMatch) addThreads(`${path} is from a build that needs threads (SharedArrayBuffer), which games on Zaisma don't have, so it won't start.`, lineAround(text, threadsMatch.index), path);

    if (isEngineOutput(path, lowercasePaths)) continue;
    // What the code does, not what its comments say: a library's docs mention alert() and window.open.
    const code = blankComments(text, fileKind);
    const found = (pattern) => pattern.exec(code);
    let match;
    if ((match = dialogOf(code))) add("browser_dialog", { message: `${path} uses ${match[1]}(), which never shows in the game's frame on Zaisma.`, path, quote: lineAround(text, match.index), fix: "Show the message in the game itself, like on the canvas or in an element over it." });
    if (fileKind === "html" && (match = found(/<form\b[^>]*>/i))) add("form_submission", { message: `${path} has a form, which never submits in the game's frame on Zaisma.`, path, quote: lineAround(text, match.index), fix: "Handle the button's click (or the Enter key) in script instead of submitting the form." });
    if ((match = (fileKind === "html" && found(/<a\b[^>]*\sdownload\b[^>]*>/i)) || found(/\.download\s*=(?!=)/))) add("file_download", { message: `${path} downloads a file, which the game's frame on Zaisma doesn't allow.`, path, quote: lineAround(text, match.index), fix: "Keep it in the game (its browser saves, which Zaisma's cloud saves mirror), or copy it to the clipboard." });
    if ((match = (fileKind === "html" && (found(/<a\b[^>]*\shref\s*=\s*["']?(?:https?:)?\/\/[^>]*>/i) || found(/<a\b[^>]*\starget\s*=\s*["']?_blank[^>]*>/i))) || found(/\bwindow\.open\s*\(/))) {
      add("outside_link", { message: `${path} opens another site or a new window, which the game's frame on Zaisma doesn't allow.`, path, quote: lineAround(text, match.index), fix: `Register the link and open it by name: zaisma links set ${game} <link_name> <url> (or update_game with links), then Zaisma.links.open("<link_name>") in the game.` });
    }
    if (fileKind === "html" && (match = found(/<iframe\b[^>]*\ssrc\s*=\s*["']?(?:https?:)?\/\/[^>]*>/i))) add("outside_frame", { message: `${path} shows another site in a frame, which games on Zaisma can't do.`, path, quote: lineAround(text, match.index), fix: "Frames show only the game's own pages: put what it shows in the game's files, or register a link to it (zaisma links set)." });
    for (const feature of FEATURES) {
      if ((match = found(feature.pattern))) add("blocked_feature", { message: `${path} uses ${feature.name}, which games on Zaisma can't use.`, path, quote: lineAround(text, match.index), sameAs: feature.name, fix: "Leave it out, or make the game work without it when the browser says no." });
    }
  }
  return { file_count: files.length, size_bytes: sizeBytes, problems, omitted_problem_count: omittedProblemCount };
}
