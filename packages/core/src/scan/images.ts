import type { Finding } from "../types.ts";

/** A picture or video to match. */
export interface MediaForMatching {
  /** Where it is in the game, like "art/hero.png" or "index.html (picture in the code)". */
  path: string;
  /** What it really is, like image/png or video/mp4. */
  type: string;
  /** The same id means the same file (like its storage key): it's sent once. */
  id: string;
  /** Its SHA-256, when known: a file cleared in the last 30 days (checked_files) isn't sent again. */
  sha256?: string;
  /** The file, read afresh for each try: its bytes, or a stream of known length so a big video never sits in memory. */
  body(): Promise<Uint8Array | ReadableStream>;
}

export interface ImageMatchResult {
  /** The matchers that checked everything they could, joined by "+", like "arachnid-shield+photodna". */
  provider: string;
  isConnected: boolean;
  checkedMediaCount: number;
  /** Pictures and videos this matcher didn't check (PhotoDNA: pictures it can't hash, videos it can't take frames from). */
  uncheckedMediaCount?: number;
  findings: Finding[];
}

/**
 * Known-illegal-image matching (exact and perceptual hashes against lists of known child sexual abuse
 * material). Connected: Arachnid Shield and PhotoDNA, each when its key is set, through eitherMatcher;
 * Cloudflare's CSAM Scanning Tool is a backstop on served files. Until one is connected, every game is
 * held for manual review. Self-hosters can plug in their own matcher.
 */
export interface ImageMatcher {
  check(media: MediaForMatching[]): Promise<ImageMatchResult>;
}

/** Pictures and videos matched by their file names. Anything else is matched too if its first bytes say it's one (sniffMedia). */
export const MATCH_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  mp4: "video/mp4",
  webm: "video/webm",
};

/** Enough of a file's start for sniffMedia, and for matroskaHasVideo to find its tracks. */
export const SNIFF_BYTES = 64;
export const MATROSKA_HEAD_BYTES = 64 * 1024;

/**
 * What a file really is from its first bytes, when it's a picture or video that matching can check,
 * whatever it's called; null for anything else (audio, fonts, code, data).
 */
export function sniffMedia(bytes: Uint8Array): string | null {
  const ascii = (startIndex: number, endIndex: number) => latin1(bytes.subarray(startIndex, endIndex));
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 8) === "PNG\r\n\x1a\n") return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF") return ascii(8, 12) === "WEBP" ? "image/webp" : ascii(8, 12) === "AVI " ? "video/x-msvideo" : null;
  if (ascii(0, 2) === "BM" && bytes.length >= 18 && [12, 40, 52, 56, 64, 108, 124].includes(bytes[14]! | (bytes[15]! << 8) | (bytes[16]! << 16) | (bytes[17]! << 24))) return "image/bmp";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (/^(M4A|M4B|M4P|F4A|F4B)/.test(brand)) return null; // audio
    const brands = ascii(8, Math.min(bytes.length, 32));
    if (brands.includes("avif") || brands.includes("avis")) return "image/avif";
    if (/^(heic|heix|heim|heis|hevc|hevx|mif1|msf1)/.test(brand)) return "image/heic";
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  return null;
}

function latin1(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return text;
}

/** Whether a WebM or Matroska file has a video track, from its start. Audio-only ones aren't sent; when unsure, it's sent. */
export function matroskaHasVideo(head: Uint8Array): boolean {
  const text = latin1(head.subarray(0, MATROSKA_HEAD_BYTES));
  return /V_[A-Z0-9]{2,}/.test(text) || !/A_[A-Z0-9]{2,}/.test(text);
}

/** Pictures and videos written into code as base64 (in data: links or plain strings), by how their encodings start. */
const EMBEDDED = /(?:iVBORw0KGg|\/9j\/|R0lGOD|UklGR|GkXfo|AAAA[A-Za-z0-9+/][GWm2]Z0eX)[A-Za-z0-9+/]{60,}={0,2}/g;
/** Most embedded pictures read from one file, and the biggest one decoded. */
export const MAXIMUM_EMBEDDED_MEDIA_COUNT = 500;
const MAXIMUM_EMBEDDED_CHARACTER_COUNT = 40 * 1024 * 1024;

/** Pictures and videos embedded in a code file as base64, decoded, with what they really are. */
export function embeddedMedia(text: string): { type: string; bytes: Uint8Array }[] {
  const out: { type: string; bytes: Uint8Array }[] = [];
  for (const match of text.matchAll(EMBEDDED)) {
    if (out.length >= MAXIMUM_EMBEDDED_MEDIA_COUNT) break;
    const encoded = match[0].slice(0, MAXIMUM_EMBEDDED_CHARACTER_COUNT).replace(/=+$/, "");
    let binary: string;
    try {
      binary = atob(encoded.length % 4 === 1 ? encoded.slice(0, -1) : encoded);
    } catch {
      continue;
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const type = sniffMedia(bytes);
    if (type && (type !== "video/webm" || matroskaHasVideo(bytes))) out.push({ type, bytes });
  }
  return out;
}

/** Engine packs and binaries searched for pictures stored inside them (Godot .pck, .glb models, Unity and Emscripten .data, assets compiled into .wasm; Unity asset bundles are found by their first bytes). */
export const PACK_EXTENSIONS = new Set(["pck", "glb", "data", "dat", "bin", "wasm"]);
/** How much of a pack is read at a time; a picture bigger than this inside one isn't matched. */
export const PACK_WINDOW_SIZE_BYTES = 32 * 1024 * 1024;
/** Pictures inside packs smaller than this aren't sent: too small to show anything. */
export const MINIMUM_PACK_PICTURE_SIZE_BYTES = 1024;

/** A whole picture found inside a pack: its bytes are startIndex up to (not including) endIndex. */
export interface PictureInside {
  startIndex: number;
  endIndex: number;
  type: string;
}

/**
 * The whole PNG, JPEG, GIF and WebP files stored inside a pack's bytes, found by their signatures and walked
 * to their ends. GPU textures are decoded apart (unityPicturesInside, godotPicturesInside); encrypted packs pass. unfinishedStartIndex is
 * where a picture starts that runs past the end of these bytes (read on from there), or null. One claiming
 * more than PACK_WINDOW_SIZE_BYTES is skipped, so reading on from it always gets all of it in one window.
 */
export function picturesInside(bytes: Uint8Array): { pictures: PictureInside[]; unfinishedStartIndex: number | null } {
  const pictures: PictureInside[] = [];
  let index = 0;
  while (index < bytes.length) {
    const firstByte = bytes[index];
    const isCandidate = firstByte === 0x89 || firstByte === 0xff || firstByte === 0x47 || firstByte === 0x52;
    if (isCandidate && bytes.length - index < 16) return { pictures, unfinishedStartIndex: index };
    const walked = firstByte === 0x89 ? pngEnd(bytes, index) : firstByte === 0xff ? jpegEnd(bytes, index) : firstByte === 0x47 ? gifEnd(bytes, index) : firstByte === 0x52 ? webpEnd(bytes, index) : null;
    if (walked === "unfinished") return { pictures, unfinishedStartIndex: index };
    if (walked) {
      pictures.push({ startIndex: index, endIndex: walked.endIndex, type: walked.type });
      index = walked.endIndex;
    } else index++;
  }
  return { pictures, unfinishedStartIndex: null };
}

type Walked = { endIndex: number; type: string } | "unfinished" | null;

const uint32 = (bytes: Uint8Array, index: number) => ((bytes[index]! << 24) | (bytes[index + 1]! << 16) | (bytes[index + 2]! << 8) | bytes[index + 3]!) >>> 0;
const ascii = (bytes: Uint8Array, index: number, text: string) => [...text].every((character, characterIndex) => bytes[index + characterIndex] === character.charCodeAt(0));

function pngEnd(bytes: Uint8Array, startIndex: number): Walked {
  if (!ascii(bytes, startIndex + 1, "PNG\r\n\x1a\n") || uint32(bytes, startIndex + 8) !== 13 || !ascii(bytes, startIndex + 12, "IHDR")) return null;
  let index = startIndex + 8;
  while (true) {
    if (index + 8 > bytes.length) return "unfinished";
    const chunkSizeBytes = uint32(bytes, index);
    if (chunkSizeBytes > 0x7fffffff) return null;
    const isEnd = ascii(bytes, index + 4, "IEND");
    index += 12 + chunkSizeBytes;
    if (index - startIndex > PACK_WINDOW_SIZE_BYTES) return null;
    if (index > bytes.length) return "unfinished";
    if (isEnd) return { endIndex: index, type: "image/png" };
  }
}

function jpegEnd(bytes: Uint8Array, startIndex: number): Walked {
  if (bytes[startIndex + 1] !== 0xd8 || bytes[startIndex + 2] !== 0xff) return null;
  const firstMarkerByte = bytes[startIndex + 3]!;
  if (!((firstMarkerByte >= 0xe0 && firstMarkerByte <= 0xef) || firstMarkerByte === 0xdb || firstMarkerByte === 0xfe || (firstMarkerByte >= 0xc0 && firstMarkerByte <= 0xcf))) return null;
  let index = startIndex + 2;
  while (true) {
    if (index + 4 > bytes.length) return "unfinished";
    if (bytes[index] !== 0xff) return null;
    const markerByte = bytes[index + 1]!;
    if (markerByte === 0xd9) return { endIndex: index + 2, type: "image/jpeg" };
    if (markerByte === 0xff) {
      index++;
      continue;
    }
    if ((markerByte >= 0xd0 && markerByte <= 0xd7) || markerByte === 0x01) {
      index += 2;
      continue;
    }
    const segmentSizeBytes = (bytes[index + 2]! << 8) | bytes[index + 3]!;
    if (segmentSizeBytes < 2) return null;
    index += 2 + segmentSizeBytes;
    if (index - startIndex > PACK_WINDOW_SIZE_BYTES) return null;
    if (markerByte !== 0xda) continue;
    // Scan data runs to the next markerByte that isn't a stuffed byte (FF 00) or a restart (FF D0-D7).
    while (true) {
      if (index - startIndex > PACK_WINDOW_SIZE_BYTES) return null;
      if (index + 1 >= bytes.length) return "unfinished";
      if (bytes[index] === 0xff && bytes[index + 1] !== 0x00 && !(bytes[index + 1]! >= 0xd0 && bytes[index + 1]! <= 0xd7)) break;
      index++;
    }
  }
}

function gifEnd(bytes: Uint8Array, startIndex: number): Walked {
  if (!ascii(bytes, startIndex, "GIF87a") && !ascii(bytes, startIndex, "GIF89a")) return null;
  const subBlocks = (fromIndex: number): number | "unfinished" | null => {
    let index = fromIndex;
    while (true) {
      if (index - startIndex > PACK_WINDOW_SIZE_BYTES) return null;
      if (index >= bytes.length) return "unfinished";
      const subBlockSizeBytes = bytes[index]!;
      index += 1 + subBlockSizeBytes;
      if (subBlockSizeBytes === 0) return index;
    }
  };
  const colorTableSize = (packedByte: number) => (packedByte & 0x80 ? 3 * (1 << ((packedByte & 0x07) + 1)) : 0);
  let index = startIndex + 13 + colorTableSize(bytes[startIndex + 10]!);
  while (true) {
    if (index >= bytes.length) return "unfinished";
    const blockByte = bytes[index]!;
    if (blockByte === 0x3b) return { endIndex: index + 1, type: "image/gif" };
    let next: number | "unfinished" | null;
    if (blockByte === 0x21) next = subBlocks(index + 2);
    else if (blockByte === 0x2c) {
      if (index + 10 > bytes.length) return "unfinished";
      next = subBlocks(index + 10 + colorTableSize(bytes[index + 9]!) + 1);
    } else return null;
    if (next === "unfinished" || next === null) return next;
    index = next;
  }
}

function webpEnd(bytes: Uint8Array, startIndex: number): Walked {
  if (!ascii(bytes, startIndex, "RIFF") || !ascii(bytes, startIndex + 8, "WEBPVP8")) return null;
  const riffSizeBytes = (bytes[startIndex + 4]! | (bytes[startIndex + 5]! << 8) | (bytes[startIndex + 6]! << 16) | (bytes[startIndex + 7]! << 24)) >>> 0;
  const endIndex = startIndex + 8 + riffSizeBytes + (riffSizeBytes % 2);
  if (endIndex - startIndex > PACK_WINDOW_SIZE_BYTES) return null;
  return endIndex > bytes.length ? "unfinished" : { endIndex, type: "image/webp" };
}

/** The code on a finding for a picture that matched known abuse material. The scan holds the version, keeps everything and alerts. */
export const KNOWN_IMAGE_CODE = "known_illegal_image";

export const notConnected: ImageMatcher = {
  async check() {
    return {
      provider: "none",
      isConnected: false,
      checkedMediaCount: 0,
      findings: [
        {
          stage: "images",
          severity: "hold",
          code: "image_matching_off",
          message: "Known-illegal-image matching isn't connected yet, so a person has to approve this game. Must be connected before outside uploads open.",
        },
      ],
    };
  },
};

export const ARACHNID_SHIELD_URL = "https://shield.projectarachnid.com";
/** Files sent to Arachnid Shield at once. */
const CONCURRENT_FILE_COUNT = 4;
const MAXIMUM_ATTEMPT_COUNT = 3;

type Outcome =
  | { kind: "clear" }
  | { kind: "match"; classification: string; matchType: string | null }
  | { kind: "failed"; why: string }
  | { kind: "down"; why: string }
  | { kind: "refused"; httpStatus: number };

const LABELS: Record<string, string> = {
  csam: "known child sexual abuse material",
  "harmful-abusive-material": "known harmful or abusive material involving a child",
};

/**
 * Arachnid Shield, from Project Arachnid (the Canadian Centre for Child Protection): free matching of
 * each picture and video (frame by frame) against known child sexual abuse material, by the exact file
 * and by how it looks. `credentials` is the API user's "username:password". A file under several names
 * is sent once. If Shield turns down the sign-in or stops answering, the rest aren't sent and the version is held.
 */
export function arachnidShield(credentials: string, options: { baseUrl?: string; fetch?: typeof fetch; wait?: (delayMs: number) => Promise<void> } = {}): ImageMatcher {
  const endpoint = `${(options.baseUrl || ARACHNID_SHIELD_URL).replace(/\/+$/, "")}/v1/media/`;
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const wait = options.wait ?? ((delayMs) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const authorization = `Basic ${btoa(credentials)}`;

  async function scan(file: MediaForMatching): Promise<Outcome> {
    let why = "";
    for (let attemptIndex = 0; attemptIndex < MAXIMUM_ATTEMPT_COUNT; attemptIndex++) {
      if (attemptIndex) await wait(1000 * 2 ** attemptIndex);
      let response: Response;
      try {
        response = await send(endpoint, { method: "POST", headers: { authorization, accept: "application/json", "content-type": file.type }, body: await file.body() });
      } catch (error) {
        why = String(error);
        continue;
      }
      if (response.status === 401 || response.status === 403) return { kind: "refused", httpStatus: response.status };
      if (response.status === 429 || response.status >= 500) {
        why = `${response.status}`;
        await response.body?.cancel();
        continue;
      }
      const answer = (await response.json().catch(() => ({}))) as { classification?: string | null; match_type?: string | null; detail?: string };
      if (!response.ok) return { kind: "failed", why: `${response.status}${answer.detail ? `: ${String(answer.detail).slice(0, 200)}` : ""}` };
      if (answer.classification === "no-known-match") return { kind: "clear" };
      if (!answer.classification) return { kind: "failed", why: "no classification in its answer" };
      return { kind: "match", classification: answer.classification, matchType: answer.match_type ?? null };
    }
    return { kind: "down", why };
  }

  return {
    async check(media) {
      const findings: Finding[] = [];
      const byId = new Map<string, Promise<Outcome>>();
      let checkedMediaCount = 0;
      let stop: Outcome | null = null;
      let nextIndex = 0;
      const worker = async () => {
        while (!stop && nextIndex < media.length) {
          const image = media[nextIndex++]!;
          let pending = byId.get(image.id);
          if (!pending) byId.set(image.id, (pending = scan(image)));
          const outcome = await pending;
          if (outcome.kind === "refused" || outcome.kind === "down") {
            stop ??= outcome;
          } else if (outcome.kind === "failed") {
            findings.push({ stage: "images", severity: "hold", code: "image_matching_failed", message: `Arachnid Shield couldn't check this file (${outcome.why}). A person should look.`, path: image.path });
          } else {
            checkedMediaCount++;
            if (outcome.kind === "match") {
              const how = outcome.matchType === "exact" ? "the exact file" : outcome.matchType === "near" ? "a visual match" : "a match";
              findings.push({ stage: "images", severity: "hold", code: KNOWN_IMAGE_CODE, message: `Arachnid Shield: ${LABELS[outcome.classification] ?? `classified "${outcome.classification}"`} (${how}).`, path: image.path });
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENT_FILE_COUNT, media.length) }, worker));
      const halted = stop as Outcome | null;
      if (halted?.kind === "refused") {
        findings.push({ stage: "images", severity: "hold", code: "image_matching_failed", message: `Arachnid Shield turned down our sign-in (${halted.httpStatus}). Check the ARACHNID_SHIELD_KEY secret; until it works, a person approves each game.` });
      } else if (halted?.kind === "down") {
        findings.push({ stage: "images", severity: "hold", code: "image_matching_failed", message: `Arachnid Shield didn't answer (${halted.why}), so not every picture and video was checked. A person should look, or scan it again later.` });
      }
      return { provider: "arachnid-shield", isConnected: true, checkedMediaCount, findings };
    },
  };
}

/** A matcher that couldn't finish: the service didn't answer or turned down our key (a failure on the whole version, not one file). */
const isUnfinished = (matchResult: ImageMatchResult) => matchResult.findings.some((finding) => finding.code === "image_matching_failed" && !finding.path);

/**
 * Several matchers on the same pictures and videos, together: a match on any one holds the version.
 * A version waits for a person only when every matcher failed. When one fails but another checked
 * every picture and video (nothing it doesn't check), the failure doesn't hold it: it's noted, the
 * provider names only the ones that finished, and the daily job matches it again with the rest.
 */
export function eitherMatcher(matchers: ImageMatcher[]): ImageMatcher {
  if (matchers.length === 1) return matchers[0]!;
  return {
    async check(media) {
      const results = await Promise.all(matchers.map((matcher) => matcher.check(media)));
      const finished = results.filter((matchResult) => !isUnfinished(matchResult));
      const hasCoverage = finished.some((matchResult) => !matchResult.uncheckedMediaCount);
      const findings: Finding[] = [];
      for (const matchResult of results) {
        if (finished.includes(matchResult) || !hasCoverage) {
          findings.push(...matchResult.findings);
          continue;
        }
        // Its own matches and per-file failures still count; only "didn't finish" is set aside.
        findings.push(...matchResult.findings.filter((finding) => !(finding.code === "image_matching_failed" && !finding.path)));
        const why = matchResult.findings.find((finding) => finding.code === "image_matching_failed" && !finding.path)!.message;
        findings.push({ stage: "images", severity: "info", code: "image_matching_later", message: `${matchResult.provider} didn't finish, so it matches this version later. ${why}` });
      }
      return {
        provider: finished.map((matchResult) => matchResult.provider).join("+") || results.map((matchResult) => matchResult.provider).join("+"),
        isConnected: results.some((matchResult) => matchResult.isConnected),
        checkedMediaCount: Math.max(...results.map((matchResult) => matchResult.checkedMediaCount)),
        uncheckedMediaCount: Math.min(...results.map((matchResult) => matchResult.uncheckedMediaCount ?? 0)),
        findings,
      };
    },
  };
}
