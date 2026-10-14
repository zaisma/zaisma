import { sha256Hex } from "../ids.ts";
import type { Finding } from "../types.ts";

export interface ImageForMatching {
  path: string;
  /** Its media type, like image/png. */
  type: string;
  /** Reads the file. Matchers call it a few pictures at a time, so a big game is never all in memory. */
  load(): Promise<Uint8Array>;
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
  check(images: ImageForMatching[]): Promise<ImageMatchResult>;
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
/** Pictures sent to Arachnid Shield at once. */
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
 * each picture against known child sexual abuse material, by the exact file and by how it looks.
 * `credentials` is the API user's "username:password". The same picture under several names is sent once.
 * If Shield turns down the sign-in or stops answering, the rest aren't sent and the version is held.
 */
export function arachnidShield(credentials: string, options: { baseUrl?: string; fetch?: typeof fetch; wait?: (ms: number) => Promise<void> } = {}): ImageMatcher {
  const endpoint = `${(options.baseUrl || ARACHNID_SHIELD_URL).replace(/\/+$/, "")}/v1/media/`;
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const wait = options.wait ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const authorization = `Basic ${btoa(credentials)}`;

  async function scan(bytes: Uint8Array, type: string): Promise<Outcome> {
    let why = "";
    for (let attempt = 0; attempt < TRIES; attempt++) {
      if (attempt) await wait(1000 * 2 ** attempt);
      let res: Response;
      try {
        res = await send(endpoint, { method: "POST", headers: { authorization, accept: "application/json", "content-type": type }, body: bytes });
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
    async check(images) {
      const findings: Finding[] = [];
      const bySha = new Map<string, Promise<Outcome>>();
      let checked = 0;
      let stop: Outcome | null = null;
      let next = 0;
      const worker = async () => {
        while (!stop && next < images.length) {
          const image = images[next++]!;
          const bytes = await image.load();
          const sha = await sha256Hex(bytes);
          let pending = bySha.get(sha);
          if (!pending) bySha.set(sha, (pending = scan(bytes, image.type)));
          const outcome = await pending;
          if (outcome.kind === "refused" || outcome.kind === "down") {
            stop ??= outcome;
          } else if (outcome.kind === "failed") {
            findings.push({ stage: "images", severity: "hold", rule: "image-matching-failed", detail: `Arachnid Shield couldn't check this picture (${outcome.why}). A person should look.`, path: image.path });
          } else {
            checked++;
            if (outcome.kind === "match") {
              const how = outcome.matchType === "exact" ? "the exact file" : outcome.matchType === "near" ? "a visual match" : "a match";
              findings.push({ stage: "images", severity: "hold", rule: KNOWN_IMAGE_RULE, detail: `Arachnid Shield: ${LABELS[outcome.classification] ?? `classified "${outcome.classification}"`} (${how}).`, path: image.path });
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(AT_ONCE, images.length) }, worker));
      const halted = stop as Outcome | null;
      if (halted?.kind === "refused") {
        findings.push({ stage: "images", severity: "hold", rule: "image-matching-failed", detail: `Arachnid Shield turned down our sign-in (${halted.status}). Check the ARACHNID_SHIELD_KEY secret; until it works, a person approves each game.` });
      } else if (halted?.kind === "down") {
        findings.push({ stage: "images", severity: "hold", rule: "image-matching-failed", detail: `Arachnid Shield didn't answer (${halted.why}), so not every picture was checked. A person should look, or scan it again later.` });
      }
      return { provider: "arachnid-shield", connected: true, checked, findings };
    },
  };
}
