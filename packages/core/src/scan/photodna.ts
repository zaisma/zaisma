import type { Finding } from "../types.ts";
import { KNOWN_IMAGE_CODE, type ImageMatcher, type MediaForMatching } from "./images.ts";

/**
 * PhotoDNA, from Microsoft: pictures, and still frames from videos, matched against lists of known child
 * sexual abuse material. Pictures never leave Zaisma: each one (or each frame) becomes an Edge Hash (made
 * with Microsoft's SDK, in the photodna Worker's container), and only the hashes are sent, up to 5 per
 * request. Microsoft's license keeps AI agents away from the SDK's libraries; this code only talks to the
 * service that runs them.
 */

/** What making one picture's Edge Hash came to. `skip`: PhotoDNA can't hash this picture (too small, a format it can't read). */
export type PhotoDnaHashOutcome = { kind: "hash"; hash: string } | { kind: "skip"; why: string } | { kind: "down"; why: string };

/** One still frame taken from a video, and where in the video it is. */
export interface PhotoDnaFrame {
  hash: string;
  timeInVideoMs: number;
}

/** What taking a video's frames and hashing them came to. `skip`: no frame could be taken (too big, unreadable, no picture track). */
export type PhotoDnaFramesOutcome = { kind: "frames"; frames: PhotoDnaFrame[] } | { kind: "skip"; why: string } | { kind: "down"; why: string };

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
  /** A video's still frames, each hashed (the container takes them; see apps/photodna/container/frames.mjs). */
  hashFrames(media: MediaForMatching): Promise<PhotoDnaFramesOutcome>;
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

/** Where a frame is in its video, as m:ss. */
const timeInVideo = (timeInVideoMs: number) => {
  const wholeSecondCount = Math.floor(timeInVideoMs / 1000);
  return `${Math.floor(wholeSecondCount / 60)}:${String(wholeSecondCount % 60).padStart(2, "0")}`;
};
/** Matched frames named in a video's finding. */
const NAMED_FRAME_COUNT = 3;

/**
 * The PhotoDNA matcher. Pictures are hashed whole (an animated GIF's first frame); videos as still frames
 * taken from them, and a match on any frame holds the video. A picture PhotoDNA can't hash, a video it can't
 * take frames from, or one Microsoft couldn't match is counted as unchecked rather than held: it never stops
 * a version while Arachnid Shield has checked everything. If the service or Microsoft is down, the rest
 * aren't sent and the result says matching didn't finish.
 */
export function photoDna(service: PhotoDnaService, options: { priority?: PhotoDnaPriority } = {}): ImageMatcher {
  const priority = options.priority ?? "upload";
  return {
    async check(media) {
      const findings: Finding[] = [];
      const sendable = media.filter((candidate) => candidate.type.startsWith("image/") || candidate.type.startsWith("video/"));
      let uncheckedMediaCount = media.length - sendable.length;
      let checkedMediaCount = 0;
      let down: string | null = null;

      // One hash per distinct picture, and one set of frames per distinct video, made a few at a time.
      const outcomeById = new Map<string, Promise<PhotoDnaHashOutcome | PhotoDnaFramesOutcome>>();
      const outcomes: { media: MediaForMatching; outcome: PhotoDnaHashOutcome | PhotoDnaFramesOutcome }[] = [];
      let nextIndex = 0;
      const worker = async () => {
        while (!down && nextIndex < sendable.length) {
          const candidate = sendable[nextIndex++]!;
          let pending = outcomeById.get(candidate.id);
          if (!pending) {
            const made = candidate.type.startsWith("video/") ? service.hashFrames(candidate) : service.hash(candidate);
            outcomeById.set(candidate.id, (pending = made.catch((error): PhotoDnaHashOutcome => ({ kind: "down", why: String(error) }))));
          }
          const outcome = await pending;
          if (outcome.kind === "down") down ??= `couldn't make hashes (${outcome.why})`;
          outcomes.push({ media: candidate, outcome });
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENT_HASH_COUNT, sendable.length) }, worker));

      // Each distinct hash is sent once, 5 to a request; every picture or frame with that hash shares its answer.
      const sharingByHash = new Map<string, { media: MediaForMatching; timeInVideoMs: number | null }[]>();
      const hashed: MediaForMatching[] = [];
      const unansweredCountByMedia = new Map<MediaForMatching, number>();
      for (const { media: candidate, outcome } of outcomes) {
        if (outcome.kind === "skip" || (outcome.kind === "frames" && !outcome.frames.length)) uncheckedMediaCount++;
        const frames = outcome.kind === "hash" ? [{ hash: outcome.hash, timeInVideoMs: null }] : outcome.kind === "frames" ? outcome.frames : [];
        if (!frames.length) continue;
        hashed.push(candidate);
        unansweredCountByMedia.set(candidate, frames.length);
        for (const frame of frames) {
          const sharing = sharingByHash.get(frame.hash) ?? [];
          sharing.push({ media: candidate, timeInVideoMs: frame.timeInVideoMs });
          sharingByHash.set(frame.hash, sharing);
        }
      }
      const failed = new Set<MediaForMatching>();
      const matched = new Map<MediaForMatching, { timeInVideoMs: number | null; sources: string[] }[]>();
      const hashes = [...sharingByHash.keys()];
      for (let i = 0; !down && i < hashes.length; i += PHOTODNA_MAXIMUM_HASH_COUNT) {
        const batch = hashes.slice(i, i + PHOTODNA_MAXIMUM_HASH_COUNT);
        const answer = await service.match(batch, priority).catch((error): PhotoDnaMatchOutcome => ({ kind: "down", why: String(error) }));
        if (answer.kind === "down") {
          down = `Microsoft didn't answer (${answer.why})`;
          break;
        }
        batch.forEach((hash, index) => {
          const hashResult = answer.results[index]!;
          for (const { media: candidate, timeInVideoMs } of sharingByHash.get(hash)!) {
            unansweredCountByMedia.set(candidate, unansweredCountByMedia.get(candidate)! - 1);
            if (hashResult.failure) failed.add(candidate);
            else if (hashResult.isMatch) matched.set(candidate, [...(matched.get(candidate) ?? []), { timeInVideoMs, sources: hashResult.sources }]);
          }
        });
      }

      // A video is checked once every one of its frames was answered; its matches count either way, even if Microsoft went down after them.
      for (const candidate of hashed) {
        if (failed.has(candidate)) uncheckedMediaCount++;
        else if (!unansweredCountByMedia.get(candidate)) checkedMediaCount++;
        const matches = matched.get(candidate);
        if (!matches) continue;
        const sources = [...new Set(matches.flatMap((match) => match.sources))];
        const lists = sources.length ? ` (list: ${sources.join(", ")})` : "";
        const times = matches.flatMap((match) => (match.timeInVideoMs === null ? [] : [match.timeInVideoMs])).sort((earlierMs, laterMs) => earlierMs - laterMs);
        const what = times.length
          ? `${times.length === 1 ? "a frame" : `${times.length} frames`} at ${times.slice(0, NAMED_FRAME_COUNT).map(timeInVideo).join(", ")}${times.length > NAMED_FRAME_COUNT ? " and more" : ""} ${times.length === 1 ? "matches" : "match"}`
          : "matches";
        findings.push({ stage: "images", severity: "hold", code: KNOWN_IMAGE_CODE, message: `PhotoDNA: ${what} known child sexual abuse material${lists}.`, path: candidate.path });
      }

      if (down) findings.push({ stage: "images", severity: "hold", code: "image_matching_failed", message: `PhotoDNA ${down}, so not every picture and video was checked. A person should look, or scan it again later.` });
      return { provider: "photodna", isConnected: true, checkedMediaCount, uncheckedMediaCount, findings };
    },
  };
}
