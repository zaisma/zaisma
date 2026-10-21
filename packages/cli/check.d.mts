// Types for check.mjs, so the site imports the game check type-checked.
import type { PerformanceNote } from "./performance.mjs";

export type CheckProblemCode =
  | "no_index_html"
  | "file_type_not_allowed"
  | "precompressed_file"
  | "hidden_file"
  | "duplicate_path"
  | "bad_path"
  | "file_too_big"
  | "game_too_big"
  | "too_many_files"
  | "outside_file"
  | "outside_address"
  | "address_not_allowed"
  | "needs_threads"
  | "browser_dialog"
  | "form_submission"
  | "file_download"
  | "outside_link"
  | "outside_frame"
  | "blocked_feature";

export type ProblemKind = "refused" | "broken";

export interface CheckedFile {
  path: string;
  sizeBytes: number;
  /** The file's text for the checked text files (CHECKED_TEXT_EXTENSIONS), null for the rest. */
  contentText: string | null;
  /** The first bytes performance.mjs's assetHeadSizes asks for; left out, its notes skip the file. */
  headBytes?: Uint8Array | null;
}

export interface CheckProblem {
  code: CheckProblemCode;
  problem_kind: ProblemKind;
  is_fixed_by_upload_command: boolean;
  message: string;
  path: string | null;
  quote: string | null;
  fix: string;
}

export interface GameCheck {
  file_count: number;
  size_bytes: number;
  problems: CheckProblem[];
  omitted_problem_count: number;
  performance_notes: PerformanceNote[];
}

export type ReferenceKind = "script" | "module" | "style" | "file" | "import_map";

export interface OutsideReference {
  url: string;
  start: number;
  end: number;
  referenceKind: ReferenceKind;
  quote: string;
  importMapKey: string | null;
}

export const GAME_FILE_EXTENSIONS: string[];
export const UPLOAD_LIMITS: { maximumGameSizeBytes: number; maximumFileSizeBytes: number; maximumFileCount: number; maximumPathCharacterCount: number };
export const CHECKED_TEXT_EXTENSIONS: string[];
export const PRECOMPRESSED_EXTENSIONS: string[];
export const MAXIMUM_PROBLEM_COUNT: number;
export const CHECK_PROBLEM_CODES: Record<CheckProblemCode, { problemKind: ProblemKind; isFixedByUploadCommand: boolean; meaning: string }>;
export function extensionOf(path: string): string;
export function isEngineOutput(path: string, lowercasePaths: Set<string>): boolean;
export function findOutsideReferences(text: string, fileKind: "html" | "css" | "module", options?: { baseUrl?: string | null }): OutsideReference[];
export function buildHasThreads(files: Pick<CheckedFile, "path" | "contentText">[]): boolean;
export function checkGameFiles(files: CheckedFile[], options?: { slug?: string | null; ownServerUrls?: readonly string[] | null }): GameCheck;
