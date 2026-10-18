import type { Finding } from "../types.ts";
import { KNOWN_IMAGE_CODE, type ImageMatcher, type MediaForMatching } from "./images.ts";

/**
 * PhotoDNA, from Microsoft: still pictures matched against lists of known child sexual abuse material.
 * Pictures never leave Zaisma: each one becomes an Edge Hash (made with Microsoft's SDK, in the
 * photodna Worker's container), and only the hashes are sent, up to 5 per request. Microsoft's
 * license keeps AI agents away from the SDK's libraries; this code only talks to the service that runs them.
 */

/** What making one picture's Edge Hash came to. `skip`: PhotoDNA can't hash this picture (too small, a format it can't read). */
export type PhotoDnaHashOutcome = { kind: "hash"; hash: string } | { kind: "skip"; why: string } | { kind: "down"; why: string };

/** One hash's answer from Microsoft. `failure` is set when Microsoft couldn't match that hash. */
export interface PhotoDnaHashResult {
  isMatch: boolean;
  /** The lists it matched, like "Test" for Microsoft's test pictures. */
  sources: string[];
  failure?: string;
}

/** Microsoft's answer to up to 5 hashes, in the order sent; `down` when it didn't answer (or said to slow down) after its tries. */
export type PhotoDnaMatchOutcome = { kind: "results"; results: PhotoDnaHashResult[] } | { kind: "down"; why: string };

/** New uploads go first; rechecks of versions that already passed wait behind them. */
export type PhotoDnaPriority = "upload" | "recheck";

/** The photodna Worker, as the matcher sees it. */
export interface PhotoDnaService {
  hash(media: MediaForMatching): Promise<PhotoDnaHashOutcome>;
  match(hashes: string[], priority: PhotoDnaPriority): Promise<PhotoDnaMatchOutcome>;
}

export const PHOTODNA_MATCH_URL = "https://api.microsoftmoderator.com/photodna/v1.0/MatchHash";
/** Hashes Microsoft takes in one request. */
export const PHOTODNA_MAXIMUM_HASH_COUNT = 5;
/** Microsoft's limits: 5 requests a second (one every 200 ms), and 10 million a month. */
export const PHOTODNA_REQUEST_INTERVAL_MS = 200;
export const PHOTODNA_MONTHLY_REQUEST_COUNT = 10_000_000;
/** Microsoft's status code for a hash it matched or cleared. */
const MATCHED_STATUS_CODE = 3000;
/** Pictures hashed at once. */
const CONCURRENT_HASH_COUNT = 4;

/** Microsoft's answer to a MatchHash request, in its own words (its field names, so read loosely). */
type MatchHashAnswer = { MatchResults?: Record<string, unknown>[]; message?: string };
type MicrosoftStatus = { Code?: number; Description?: string };
type MicrosoftMatchDetails = { MatchFlags?: { Source?: string }[] };

/** Reads Microsoft's answer to `hashCount` hashes. A missing or short answer is `down`, so the version is matched again later. */
export function readMatchHashAnswer(answer: unknown, hashCount: number): PhotoDnaMatchOutcome {
  const results = (answer as MatchHashAnswer | null)?.MatchResults;
  if (!Array.isArray(results) || results.length < hashCount) return { kind: "down", why: `answered without results for every hash${(answer as MatchHashAnswer | null)?.message ? `: ${String((answer as MatchHashAnswer).message).slice(0, 200)}` : ""}` };
  return {
    kind: "results",
    results: results.slice(0, hashCount).map((answered) => {
      const status = answered?.["Status"] as MicrosoftStatus | undefined;
      if (status?.Code !== MATCHED_STATUS_CODE) return { isMatch: false, sources: [], failure: `status ${status?.Code ?? "missing"}${status?.Description ? `: ${String(status.Description).slice(0, 120)}` : ""}` };
      const details = answered["MatchDetails"] as MicrosoftMatchDetails | undefined;
      const sources = (details?.MatchFlags ?? []).map((flag) => String(flag?.Source ?? "")).filter(Boolean);
      return { isMatch: answered["IsMatch"] === true, sources };
    }),
  };
}

/**
 * The PhotoDNA matcher. Videos aren't sent (Arachnid Shield checks them); an animated GIF's first
 * frame is. A picture PhotoDNA can't hash, or one Microsoft couldn't match, is counted as unchecked
 * rather than held: it never stops a version while Arachnid Shield has checked everything. If the
 * service or Microsoft is down, the rest aren't sent and the result says matching didn't finish.
 */
export function photoDna(service: PhotoDnaService, options: { priority?: PhotoDnaPriority } = {}): ImageMatcher {
  const priority = options.priority ?? "upload";
  return {
    async check(media) {
      const findings: Finding[] = [];
      const pictures = media.filter((candidate) => candidate.type.startsWith("image/"));
      let uncheckedMediaCount = media.length - pictures.length;
      let checkedMediaCount = 0;
      let down: string | null = null;

      // One hash per distinct file, made a few at a time.
      const hashById = new Map<string, Promise<PhotoDnaHashOutcome>>();
      const outcomes: { picture: MediaForMatching; outcome: PhotoDnaHashOutcome }[] = [];
      let nextIndex = 0;
      const worker = async () => {
        while (!down && nextIndex < pictures.length) {
          const picture = pictures[nextIndex++]!;
          let pending = hashById.get(picture.id);
          if (!pending) hashById.set(picture.id, (pending = service.hash(picture).catch((error): PhotoDnaHashOutcome => ({ kind: "down", why: String(error) }))));
          const outcome = await pending;
          if (outcome.kind === "down") down ??= `couldn't make hashes (${outcome.why})`;
          outcomes.push({ picture, outcome });
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENT_HASH_COUNT, pictures.length) }, worker));

      // Each distinct hash is sent once, 5 to a request; every picture with that hash shares its answer.
      const picturesByHash = new Map<string, MediaForMatching[]>();
      for (const { picture, outcome } of outcomes) {
        if (outcome.kind === "skip") uncheckedMediaCount++;
        if (outcome.kind !== "hash") continue;
        const sharing = picturesByHash.get(outcome.hash) ?? [];
        sharing.push(picture);
        picturesByHash.set(outcome.hash, sharing);
      }
      const hashes = [...picturesByHash.keys()];
      for (let i = 0; !down && i < hashes.length; i += PHOTODNA_MAXIMUM_HASH_COUNT) {
        const batch = hashes.slice(i, i + PHOTODNA_MAXIMUM_HASH_COUNT);
        const answer = await service.match(batch, priority).catch((error): PhotoDnaMatchOutcome => ({ kind: "down", why: String(error) }));
        if (answer.kind === "down") {
          down = `Microsoft didn't answer (${answer.why})`;
          break;
        }
        batch.forEach((hash, index) => {
          const hashResult = answer.results[index]!;
          const sharing = picturesByHash.get(hash)!;
          if (hashResult.failure) {
            uncheckedMediaCount += sharing.length;
            return;
          }
          checkedMediaCount += sharing.length;
          if (!hashResult.isMatch) return;
          const lists = hashResult.sources.length ? ` (list: ${hashResult.sources.join(", ")})` : "";
          for (const picture of sharing) findings.push({ stage: "images", severity: "hold", code: KNOWN_IMAGE_CODE, message: `PhotoDNA: matches known child sexual abuse material${lists}.`, path: picture.path });
        });
      }

      if (down) findings.push({ stage: "images", severity: "hold", code: "image_matching_failed", message: `PhotoDNA ${down}, so not every picture was checked. A person should look, or scan it again later.` });
      return { provider: "photodna", isConnected: true, checkedMediaCount, uncheckedMediaCount, findings };
    },
  };
}
