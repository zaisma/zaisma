import type { Finding } from "../types.ts";

export interface ImageForMatching {
  path: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface ImageMatchResult {
  provider: string;
  connected: boolean;
  checked: number;
  findings: Finding[];
}

/**
 * Known-illegal-image matching (perceptual hashes against NCMEC/industry lists).
 * Planned providers: Cloudflare's CSAM Scanning Tool on the game domain's zone,
 * and PhotoDNA. Until one is connected, every game is held for manual review.
 */
export interface ImageMatcher {
  check(images: ImageForMatching[]): Promise<ImageMatchResult>;
}

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
