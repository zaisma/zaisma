import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isShieldItem, readPageInputs, shieldStateOf } from "./page-data.mjs";

/**
 * The promises printed on the public security page. A printed line is a claim, so the first printing waits
 * until every shield is whole and the grid and the pattern rules have nothing left. After that the printing
 * stays whatever a later item does, because taking it down would announce the item, and only its words
 * update. Only the *_line fields and each strength's kind ever leave the private repo.
 */

export const PUBLISHED_PROMISES_PATH = join(import.meta.dirname, "../../apps/site/src/security-promises.ts");

const LIST_MARK = "export const PUBLISHED_PROMISES: PublishedPromise[] = ";
/** What a printed line never holds: code, an address or a person. */
const UNPRINTABLE_LINE = /[`_\\/]|https?:|\b(Julius|Gleb)\b/;

/** What keeps the first printing back, as counts only; every count 0 and every run present means it may go up. */
export function gateCountsOf({ promises, items, grid, patterns }) {
  const staleLineCount = promises.flatMap((promise) => [...promise.strengths.map((strength) => strength.strength_stale_reason), ...promise.ways_to_break.map((way) => way.score_stale_reason)]).filter(Boolean).length;
  return {
    is_every_shield_whole: shieldStateOf(items) === "whole",
    open_item_count: items.filter(isShieldItem).length,
    is_grid_run: grid !== null,
    grid_failure_count: (grid?.failures.length ?? 0) + (grid?.doors_not_tried.length ?? 0),
    is_pattern_run: patterns !== null,
    pattern_finding_count: patterns?.findings.length ?? 0,
    stale_line_count: staleLineCount,
  };
}

export const isGateOpen = (counts) => counts.is_every_shield_whole && counts.is_grid_run && counts.grid_failure_count === 0 && counts.is_pattern_run && counts.pattern_finding_count === 0 && counts.stale_line_count === 0;

/** The printed list, in rollout order, with nothing but the lines. */
export const publishedPromisesOf = (promises) =>
  [...promises]
    .sort((first, second) => first.rollout_position - second.rollout_position)
    .map((promise) => ({
      promise_line: promise.promise_line,
      strengths: promise.strengths.map(({ strength_kind, strength_line }) => ({ strength_kind, strength_line })),
      way_lines: promise.ways_to_break.map((way) => way.way_line),
    }));

/** The lines that can't be printed; [] when all can. */
export const unprintableLinesOf = (published) => published.flatMap((promise) => [promise.promise_line, ...promise.strengths.map((strength) => strength.strength_line), ...promise.way_lines]).filter((line) => UNPRINTABLE_LINE.test(line));

/** The file's text with this list in it, everything else unchanged. */
export function withPublishedPromises(fileText, published) {
  const start = fileText.indexOf(LIST_MARK);
  if (start === -1) throw new Error("apps/site/src/security-promises.ts has lost its list, so it can't be written.");
  return `${fileText.slice(0, start)}${LIST_MARK}${JSON.stringify(published, null, 2)};\n`;
}

/** The list a file holds now. */
export function publishedPromisesInFile(fileText) {
  const start = fileText.indexOf(LIST_MARK);
  if (start === -1) throw new Error("apps/site/src/security-promises.ts has lost its list, so it can't be read.");
  return JSON.parse(fileText.slice(start + LIST_MARK.length).trim().replace(/;$/, ""));
}

/** Where the printing stands: its next step is print, update_words or null. */
export function publicPromisesStateOf(inputs, currentlyPublished) {
  const gate_counts = gateCountsOf(inputs);
  const is_gate_open = isGateOpen(gate_counts);
  const is_published = currentlyPublished.length > 0;
  const are_words_different = JSON.stringify(currentlyPublished) !== JSON.stringify(publishedPromisesOf(inputs.promises));
  const next_step = is_published ? (are_words_different ? "update_words" : null) : is_gate_open ? "print" : null;
  return { is_gate_open, is_published, are_words_different, next_step, gate_counts };
}

/** The next step for the repo at mapDir and this checkout's file, or null while the repo has no promises yet. */
export function publicPromisesNextStepOf(mapDir, filePath = PUBLISHED_PROMISES_PATH) {
  const inputs = readPageInputs(mapDir);
  if (!inputs.promises.length) return null;
  return publicPromisesStateOf(inputs, publishedPromisesInFile(readFileSync(filePath, "utf8"))).next_step;
}

/** Writes the printing, or refuses with what holds it back. */
export function writePublicPromises({ mapDir, filePath = PUBLISHED_PROMISES_PATH }) {
  const inputs = readPageInputs(mapDir);
  if (!inputs.promises.length) throw new Error(`${mapDir} has no promises yet.`);
  const fileText = readFileSync(filePath, "utf8");
  const state = publicPromisesStateOf(inputs, publishedPromisesInFile(fileText));
  if (!state.is_published && !state.is_gate_open) throw new Error(`Not printing the promises yet: ${JSON.stringify(state.gate_counts)}`);
  const published = publishedPromisesOf(inputs.promises);
  const unprintable = unprintableLinesOf(published);
  if (unprintable.length) throw new Error(`Not printing the promises: ${unprintable.length} lines hold code, an address or a person. Reword them in the private repo.`);
  writeFileSync(filePath, withPublishedPromises(fileText, published));
  return { promise_count: published.length, is_first_printing: !state.is_published };
}
