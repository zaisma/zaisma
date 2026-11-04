// Written by `node scripts/security-map/cli.mjs public-promises`, never by hand. The security page prints these; while the list is empty it prints nothing.

export type PublishedPromise = {
  promise_line: string;
  strengths: { strength_kind: "math" | "structure" | "tested" | "trusted"; strength_line: string }[];
  way_lines: string[];
};

export const PUBLISHED_PROMISES: PublishedPromise[] = [];
