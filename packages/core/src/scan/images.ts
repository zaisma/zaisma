import type { Finding } from "../types.ts";

/** A picture or video to match. */
export interface MediaForMatching {
  /** Where it is in the game, like "art/hero.png" or "index.html (picture in the code)". */
  path: string;
  /** What it really is, like image/png or video/mp4. */
  type: string;
  /** The same id means the same file (like its storage key): it's sent once. */
  id: string;
  /** The file, read afresh for each try: its bytes, or a stream of known length so a big video never sits in memory. */
  body(): Promise<Uint8Array | ReadableStream>;
}

export interface ImageMatchResult {
  provider: string;
  connected: boolean;
  checked: number;
  findings: Finding[];
}

/**
 * Known-illegal-image matching (exact and perceptual hashes against lists of known child sexual abuse
 * material). Connected: Arachnid Shield, when its key is set. Planned: PhotoDNA once Microsoft approves
 * us, with Cloudflare's CSAM Scanning Tool as a backstop on served files. Until one is connected, every
 * game is held for manual review. Self-hosters can plug in their own matcher.
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
export function sniffMedia(b: Uint8Array): string | null {
  const ascii = (from: number, to: number) => latin1(b.subarray(from, to));
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 8) === "PNG\r\n\x1a\n") return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF") return ascii(8, 12) === "WEBP" ? "image/webp" : ascii(8, 12) === "AVI " ? "video/x-msvideo" : null;
  if (ascii(0, 2) === "BM" && b.length >= 18 && [12, 40, 52, 56, 64, 108, 124].includes(b[14]! | (b[15]! << 8) | (b[16]! << 16) | (b[17]! << 24))) return "image/bmp";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (/^(M4A|M4B|M4P|F4A|F4B)/.test(brand)) return null; // audio
    const brands = ascii(8, Math.min(b.length, 32));
    if (brands.includes("avif") || brands.includes("avis")) return "image/avif";
    if (/^(heic|heix|heim|heis|hevc|hevx|mif1|msf1)/.test(brand)) return "image/heic";
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  return null;
}

function latin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

/** Whether a WebM or Matroska file has a video track, from its start. Audio-only ones aren't sent; when unsure, it's sent. */
export function matroskaHasVideo(head: Uint8Array): boolean {
  const text = latin1(head.subarray(0, MATROSKA_HEAD_BYTES));
  return /V_[A-Z0-9]{2,}/.test(text) || !/A_[A-Z0-9]{2,}/.test(text);
}

/** Pictures and videos written into code as base64 (in data: links or plain strings), by how their encodings start. */
const EMBEDDED = /(?:iVBORw0KGg|\/9j\/|R0lGOD|UklGR|GkXfo|AAAA[A-Za-z0-9+/][GWm2]Z0eX)[A-Za-z0-9+/]{60,}={0,2}/g;
/** Most embedded pictures read from one file, and the biggest one decoded. */
export const EMBEDDED_LIMIT = 500;
const EMBEDDED_MAX_CHARS = 40 * 1024 * 1024;

/** Pictures and videos embedded in a code file as base64, decoded, with what they really are. */
export function embeddedMedia(text: string): { type: string; bytes: Uint8Array }[] {
  const out: { type: string; bytes: Uint8Array }[] = [];
  for (const m of text.matchAll(EMBEDDED)) {
    if (out.length >= EMBEDDED_LIMIT) break;
    const encoded = m[0].slice(0, EMBEDDED_MAX_CHARS).replace(/=+$/, "");
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

/** The rule on a finding for a picture that matched known abuse material. The scan holds the version, keeps everything and alerts. */
export const KNOWN_IMAGE_RULE = "known-illegal-image";

export const notConnected: ImageMatcher = {
  async check() {
    return {
      provider: "none",
      connected: false,
      checked: 0,
      findings: [
        {
          stage: "images",
          severity: "hold",
          rule: "image-matching-not-connected",
          detail: "Known-illegal-image matching isn't connected yet, so a person has to approve this game. Must be connected before outside uploads open.",
        },
      ],
    };
  },
};

export const ARACHNID_SHIELD_URL = "https://shield.projectarachnid.com";
/** Files sent to Arachnid Shield at once. */
const AT_ONCE = 4;
const TRIES = 3;

type Outcome =
  | { kind: "clear" }
  | { kind: "match"; classification: string; matchType: string | null }
  | { kind: "failed"; why: string }
  | { kind: "down"; why: string }
  | { kind: "refused"; status: number };

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
export function arachnidShield(credentials: string, options: { baseUrl?: string; fetch?: typeof fetch; wait?: (ms: number) => Promise<void> } = {}): ImageMatcher {
  const endpoint = `${(options.baseUrl || ARACHNID_SHIELD_URL).replace(/\/+$/, "")}/v1/media/`;
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const wait = options.wait ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const authorization = `Basic ${btoa(credentials)}`;

  async function scan(item: MediaForMatching): Promise<Outcome> {
    let why = "";
    for (let attempt = 0; attempt < TRIES; attempt++) {
      if (attempt) await wait(1000 * 2 ** attempt);
      let res: Response;
      try {
        res = await send(endpoint, { method: "POST", headers: { authorization, accept: "application/json", "content-type": item.type }, body: await item.body() });
      } catch (err) {
        why = String(err);
        continue;
      }
      if (res.status === 401 || res.status === 403) return { kind: "refused", status: res.status };
      if (res.status === 429 || res.status >= 500) {
        why = `${res.status}`;
        await res.body?.cancel();
        continue;
      }
      const data = (await res.json().catch(() => ({}))) as { classification?: string | null; match_type?: string | null; detail?: string };
      if (!res.ok) return { kind: "failed", why: `${res.status}${data.detail ? `: ${String(data.detail).slice(0, 200)}` : ""}` };
      if (data.classification === "no-known-match") return { kind: "clear" };
      if (!data.classification) return { kind: "failed", why: "no classification in its answer" };
      return { kind: "match", classification: data.classification, matchType: data.match_type ?? null };
    }
    return { kind: "down", why };
  }

  return {
    async check(media) {
      const findings: Finding[] = [];
      const byId = new Map<string, Promise<Outcome>>();
      let checked = 0;
      let stop: Outcome | null = null;
      let next = 0;
      const worker = async () => {
        while (!stop && next < media.length) {
          const image = media[next++]!;
          let pending = byId.get(image.id);
          if (!pending) byId.set(image.id, (pending = scan(image)));
          const outcome = await pending;
          if (outcome.kind === "refused" || outcome.kind === "down") {
            stop ??= outcome;
          } else if (outcome.kind === "failed") {
            findings.push({ stage: "images", severity: "hold", rule: "image-matching-failed", detail: `Arachnid Shield couldn't check this file (${outcome.why}). A person should look.`, path: image.path });
          } else {
            checked++;
            if (outcome.kind === "match") {
              const how = outcome.matchType === "exact" ? "the exact file" : outcome.matchType === "near" ? "a visual match" : "a match";
              findings.push({ stage: "images", severity: "hold", rule: KNOWN_IMAGE_RULE, detail: `Arachnid Shield: ${LABELS[outcome.classification] ?? `classified "${outcome.classification}"`} (${how}).`, path: image.path });
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(AT_ONCE, media.length) }, worker));
      const halted = stop as Outcome | null;
      if (halted?.kind === "refused") {
        findings.push({ stage: "images", severity: "hold", rule: "image-matching-failed", detail: `Arachnid Shield turned down our sign-in (${halted.status}). Check the ARACHNID_SHIELD_KEY secret; until it works, a person approves each game.` });
      } else if (halted?.kind === "down") {
        findings.push({ stage: "images", severity: "hold", rule: "image-matching-failed", detail: `Arachnid Shield didn't answer (${halted.why}), so not every picture and video was checked. A person should look, or scan it again later.` });
      }
      return { provider: "arachnid-shield", connected: true, checked, findings };
    },
  };
}
