import { describe, expect, it } from "vitest";
import { CHECK_PROBLEM_CODES, GAME_FILE_EXTENSIONS, MAXIMUM_PROBLEM_COUNT, UPLOAD_LIMITS, checkGameFiles, findOutsideReferences, type CheckedFile } from "../../packages/cli/check.mjs";
import { ERROR_CODES } from "../../packages/core/src/errors.ts";
import { CONTENT_TYPES } from "../../packages/core/src/mime.ts";
import { FILE_LIMITS } from "../../packages/core/src/uploads.ts";
import { ZIP_LIMITS } from "../../packages/core/src/zip.ts";

/**
 * The game check behind zaisma check, check_game and POST /api/dev/check (packages/cli/check.mjs): what
 * Zaisma would refuse, and what won't work inside its game frame.
 */

const TEXT = new Set(["html", "htm", "js", "mjs", "css"]);
/** A game from paths and their text (or a size, for any other file). */
const gameOf = (files: Record<string, string | number>): CheckedFile[] =>
  Object.entries(files).map(([path, content]) => ({ path, sizeBytes: typeof content === "number" ? content : content.length, contentText: typeof content === "string" && TEXT.has(path.split(".").pop()!) ? content : null }));
const codesOf = (files: Record<string, string | number>, options = {}) => checkGameFiles(gameOf(files), options).problems.map((problem) => problem.code);
const page = (body: string) => `<!doctype html><title>Sky Hopper</title>${body}`;

describe("the game check", () => {
  it("finds nothing in a plain canvas game, and adds up its files", () => {
    const answer = checkGameFiles(gameOf({ "index.html": page('<canvas></canvas><script src="game.js"></script><script src="_zaisma/v1.js"></script>'), "game.js": "const ctx = canvas.getContext('2d');", "assets/hero.png": 2048 }));
    expect(answer).toEqual({ file_count: 3, size_bytes: answer.size_bytes, problems: [], omitted_problem_count: 0 });
    expect(answer.size_bytes).toBe(gameOf({ "index.html": page('<canvas></canvas><script src="game.js"></script><script src="_zaisma/v1.js"></script>') })[0]!.sizeBytes + 36 + 2048);
  });

  it("says what the API would refuse in the file list, each once", () => {
    expect(codesOf({ "build/index.html": page(""), "build/game.js": "" })).toEqual(["no_index_html"]);
    expect(checkGameFiles(gameOf({ "build/index.html": page("") })).problems[0]!.fix).toContain("Upload the build folder instead");
    expect(codesOf({ "index.html": page(""), "setup.exe": 10, "Build/game.wasm.gz": 10, "Build/game.data.unityweb": 10, ".env": 1, ".git2/config": 1, "A.png": 1, "a.png": 1, [`${"x".repeat(197)}.png`]: 1, "big.bin": UPLOAD_LIMITS.maximumFileSizeBytes + 1 })).toEqual([
      "file_type_not_allowed",
      "precompressed_file",
      "precompressed_file",
      "hidden_file",
      "hidden_file",
      "duplicate_path",
      "bad_path",
      "file_too_big",
    ]);
    expect(codesOf({ "index.html": page(""), ...Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`part${i}.bin`, UPLOAD_LIMITS.maximumFileSizeBytes])) })).toEqual(["game_too_big"]);
    const packed = checkGameFiles(gameOf({ "index.html": page(""), "Build/game.wasm.gz": 10 })).problems[0]!;
    expect(packed).toMatchObject({ problem_kind: "refused", is_fixed_by_upload_command: true, path: "Build/game.wasm.gz" });
    expect(packed.fix).toContain("unpacks it into Build/game.wasm");
    const many = Object.fromEntries([["index.html", page("")], ...Array.from({ length: UPLOAD_LIMITS.maximumFileCount }, (_, i) => [`f${i}.png`, 1])]);
    expect(codesOf(many)).toEqual(["too_many_files"]);
  });

  it("finds files the page, stylesheets and modules load from other sites, which the upload command downloads", () => {
    const html = page(
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto"><script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>' +
        '<script type="importmap">{"imports": {"three": "https://unpkg.com/three@0.160.0/build/three.module.js"}}</script>' +
        '<script type="module">import * as THREE from "three"; import confetti from "https://esm.sh/canvas-confetti@1.9.3";</script>' +
        '<img src="data:image/png;base64,AAA"><img src="assets/hero.png"><script src="_zaisma/v1.js"></script>',
    );
    const problems = checkGameFiles(gameOf({ "index.html": html, "style.css": "body { background: url('https://example.com/bg.png') }" })).problems;
    expect(problems.map((problem) => [problem.code, problem.path, problem.is_fixed_by_upload_command])).toEqual([
      ["outside_file", "index.html", true],
      ["outside_file", "index.html", true],
      ["outside_file", "index.html", true],
      ["outside_file", "index.html", true],
      ["outside_file", "style.css", true],
    ]);
    expect(problems[0]!.message).toContain("https://fonts.googleapis.com/css2?family=Roboto");
    expect(codesOf({ "index.html": page(""), "game.js": 'import { Howl } from "https://cdn.skypack.dev/howler";' })).toEqual(["outside_file"]);
  });

  it("gives each outside file's exact place, and resolves relative imports in a downloaded file against where it came from", () => {
    const html = '<script src="https://a.example/lib.js"></script><link rel="stylesheet" href=\'//b.example/x.css\'><script type="module">import "https://c.example/m.js"</script>';
    expect(findOutsideReferences(html, "html").map((reference) => [html.slice(reference.start, reference.end), reference.referenceKind, reference.url])).toEqual([
      ["https://a.example/lib.js", "script", "https://a.example/lib.js"],
      ["//b.example/x.css", "style", "https://b.example/x.css"],
      ["https://c.example/m.js", "module", "https://c.example/m.js"],
    ]);
    const module = 'import { a } from "./a.js"; export * from "/pkg@1/b.mjs"; import("../c.js"); import x from "three";';
    expect(findOutsideReferences(module, "module", { baseUrl: "https://esm.sh/v135/pkg@1/es2022/index.mjs" }).map((reference) => reference.url)).toEqual([
      "https://esm.sh/v135/pkg@1/es2022/a.js",
      "https://esm.sh/pkg@1/b.mjs",
      "https://esm.sh/v135/pkg@1/c.js",
    ]);
    const css = "@import url('fonts.css'); .a { background: url(img/bg.png) }";
    expect(findOutsideReferences(css, "css", { baseUrl: "https://x.example/s/main.css" }).map((reference) => [css.slice(reference.start, reference.end), reference.referenceKind])).toEqual([
      ["fonts.css", "style"],
      ["img/bg.png", "file"],
    ]);
  });

  it("finds addresses the code connects to while it runs, and leaves out Zaisma's and the game's own servers", () => {
    const code = 'new WebSocket("wss://play.example.com/room"); fetch("https://api.example.com/scores"); const rooms = "wss://rooms.zaisma.com/x"; xhr.open("GET", "https://data.example.org/level.json");';
    const unknown = checkGameFiles(gameOf({ "index.html": page(""), "game.js": code }));
    expect(unknown.problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining("play.example.com while it runs, which works only if it's one of the game's own servers"),
      expect.stringContaining("api.example.com"),
      expect.stringContaining("data.example.org"),
    ]);
    expect(unknown.problems[0]!.fix).toContain("zaisma own-servers <slug> wss://play.example.com");
    const listed = checkGameFiles(gameOf({ "index.html": page(""), "game.js": code }), { slug: "sky-hopper", ownServerUrls: ["wss://play.example.com", "https://api.example.com"] });
    expect(listed.problems.map((problem) => problem.message)).toEqual([expect.stringContaining("data.example.org while it runs, and it isn't one of the game's own servers")]);
    expect(listed.problems[0]!.fix).toContain("zaisma own-servers sky-hopper https://data.example.org");
    expect(codesOf({ "index.html": page('<script>new WebSocket("ws://localhost:8080"); new WebSocket("wss://192.168.1.4/x"); new WebSocket("ws://play.example.com")</script>') })).toEqual(["address_not_allowed", "address_not_allowed", "address_not_allowed"]);
  });

  it("explains threaded builds, once, and passes Godot's builds without threads", () => {
    expect(codesOf({ "index.html": page("<script>const GODOT_THREADS_ENABLED = true;</script>") })).toEqual(["needs_threads"]);
    expect(codesOf({ "index.html": page(""), "index.js": "if (ENVIRONMENT_IS_PTHREAD) {}", "index.wasm": 10, "other.js": "ENVIRONMENT_IS_PTHREAD" })).toEqual(["needs_threads"]);
    expect(codesOf({ "index.html": page('<script src="coi-serviceworker.js"></script>'), "coi-serviceworker.js": "// isolate" })).toEqual(["needs_threads"]);
    expect(codesOf({ "index.html": page("<script>const GODOT_THREADS_ENABLED = false;</script>") })).toEqual([]);
    const threads = checkGameFiles(gameOf({ "index.html": page("<script>const GODOT_THREADS_ENABLED = true;</script>") })).problems[0]!;
    expect(threads).toMatchObject({ problem_kind: "broken", is_fixed_by_upload_command: false, path: "index.html" });
    expect(threads.fix).toContain("Thread Support off");
  });

  it("finds what the game's frame doesn't allow, but not in engine or library output", () => {
    const html = page('<form><input name="player"></form><a href="https://example.com" target="_blank">Site</a><a href="save.json" download>Save</a><iframe src="https://www.youtube.com/embed/x"></iframe>');
    expect(codesOf({ "index.html": html })).toEqual(["form_submission", "file_download", "outside_link", "outside_frame"]);
    const code = 'alert("Game over"); navigator.mediaDevices.getUserMedia({ video: true }); navigator.geolocation.getCurrentPosition(f); window.open("https://x.example");';
    expect(codesOf({ "index.html": page(""), "game.js": code })).toEqual(["browser_dialog", "outside_link", "blocked_feature", "blocked_feature"]);
    expect(codesOf({ "index.html": page(""), "Build/game.framework.js": code, "Build/game.loader.js": code, "index.js": code, "index.wasm": 10, "lib/phaser.min.js": code })).toEqual([]);
    expect(codesOf({ "index.html": page(""), "game.js": "ui.prompt('name'); function alert(text) { draw(text); } showConfirm();" })).toEqual([]);
  });

  it("names the game in the fixes when it's given, and stops the list at 200", () => {
    const linked = (options = {}) => checkGameFiles(gameOf({ "index.html": page('<a href="https://example.com">Site</a>') }), options).problems[0]!.fix;
    expect(linked()).toContain("zaisma links set <slug>");
    expect(linked({ slug: "sky-hopper" })).toContain("zaisma links set sky-hopper");
    const many = Object.fromEntries([["index.html", page("")], ...Array.from({ length: 250 }, (_, i) => [`f${i}.exe`, 1])]);
    const answer = checkGameFiles(gameOf(many));
    expect(answer.problems).toHaveLength(MAXIMUM_PROBLEM_COUNT);
    expect(answer.omitted_problem_count).toBe(50);
  });

  it("holds the file types, limits and codes to the API's", () => {
    expect(GAME_FILE_EXTENSIONS).toEqual(Object.keys(CONTENT_TYPES));
    expect(UPLOAD_LIMITS).toEqual({ maximumGameSizeBytes: FILE_LIMITS.maximumGameSizeBytes, maximumFileSizeBytes: FILE_LIMITS.maximumFileSizeBytes, maximumFileCount: FILE_LIMITS.maximumFileCount, maximumPathCharacterCount: ZIP_LIMITS.maximumPathCharacterCount });
    for (const [code, { problemKind }] of Object.entries(CHECK_PROBLEM_CODES)) if (problemKind === "refused") expect(ERROR_CODES, code).toHaveProperty([code]);
  });
});
