/**
 * Every error the developer API and MCP answer with (docs/NAMING.md, Errors), in one list: a stable,
 * lowercase snake_case code per problem, never reused for another, with its HTTP status and what it
 * means. docs/DEVELOPER-API.md lists every code, and test/site/errors.test.ts keeps the two in step.
 * Codes named bad_<field> mean that input's value isn't one the call takes; `field` says where.
 */
export const ERROR_CODES = {
  // Signing in and requests
  no_key: { httpStatus: 401, meaning: "The MCP was called without an API key." },
  bad_key: { httpStatus: 401, meaning: "The API key isn't valid: removed, mistyped or never made." },
  signed_out: { httpStatus: 401, meaning: "No API key, and no signed-in session." },
  no_account: { httpStatus: 401, meaning: "The account isn't finished yet." },
  bad_origin: { httpStatus: 403, meaning: "A call with a session came from another site." },
  slow_down: { httpStatus: 429, meaning: "Too many calls in a minute." },
  not_found: { httpStatus: 404, meaning: "There's no API call at that path." },
  bad_method: { httpStatus: 405, meaning: "The path doesn't take that method." },
  gone: { httpStatus: 410, meaning: "The call was removed, like the first feedback calls." },
  bad_json: { httpStatus: 400, meaning: "The body isn't a JSON object." },
  json_too_big: { httpStatus: 413, meaning: "The JSON body is over the call's size limit." },
  unknown_field: { httpStatus: 400, meaning: "A field, argument or query parameter the call doesn't take." },
  missing_field: { httpStatus: 400, meaning: "A field the call needs wasn't sent." },
  internal_error: { httpStatus: 500, meaning: "Something broke on Zaisma's side." },

  // Games
  no_game: { httpStatus: 404, meaning: "You have no game with that slug." },
  bad_slug: { httpStatus: 400, meaning: "The link name isn't lowercase letters, numbers and single hyphens, or is reserved." },
  slug_taken: { httpStatus: 409, meaning: "Another game has that link name." },
  too_many_games: { httpStatus: 403, meaning: "The account has as many games as it can have." },
  bad_title: { httpStatus: 400, meaning: "A game's or topic's title is empty or too long." },
  bad_description: { httpStatus: 400, meaning: "The description isn't text of up to 500 characters." },
  bad_visibility: { httpStatus: 400, meaning: "visibility isn't draft, listed, unlisted or private." },
  bad_devices: { httpStatus: 400, meaning: "devices isn't a list of phone, tablet and computer." },
  bad_controls: { httpStatus: 400, meaning: "controls isn't a list of touch, keyboard_mouse and gamepad." },
  bad_screen_orientation: { httpStatus: 400, meaning: "screen_orientation isn't portrait, landscape, either or null." },
  bad_play_modes: { httpStatus: 400, meaning: "play_modes isn't a list of play modes, or one of them is wrong." },
  bad_cloud_saves_enabled: { httpStatus: 400, meaning: "cloud_saves_enabled isn't true or false." },
  bad_room_browsing: { httpStatus: 400, meaning: "room_browsing isn't page, game or off." },
  bad_multiplayer_mode: { httpStatus: 400, meaning: "multiplayer_mode isn't none, relay or own." },
  built_in_server: { httpStatus: 403, meaning: "The game runs a game server built into Zaisma, which only Zaisma changes." },
  game_removed: { httpStatus: 403, meaning: "Zaisma took the game down, so this can't change." },
  needs_confirm: { httpStatus: 409, meaning: "Hiding a game players can play needs the developer's OK." },
  bad_period_duration_days: { httpStatus: 400, meaning: "period_duration_days isn't a whole number from 1 to 90." },
  bad_cursor: { httpStatus: 400, meaning: "cursor isn't a next_cursor from an earlier answer." },

  // Covers, screenshots and other images
  bad_kind: { httpStatus: 400, meaning: "kind isn't one of the choices the call takes." },
  not_an_image: { httpStatus: 415, meaning: "The file isn't an image of a type the call takes." },
  image_too_big: { httpStatus: 413, meaning: "The image is over 5 MB." },
  bad_image_dimensions: { httpStatus: 400, meaning: "The image is under 320 px or over 8,192 px on a side." },
  not_square: { httpStatus: 400, meaning: "A square cover isn't as wide as it is tall, or is under 512 px." },
  too_many_screenshots: { httpStatus: 400, meaning: "The game has 8 screenshots already." },
  image_refused: { httpStatus: 422, meaning: "The image can't be used." },
  no_image: { httpStatus: 404, meaning: "The game has no image with that ID." },
  no_file: { httpStatus: 400, meaning: "A form on Zaisma's pages was sent without its image." },

  // Uploading versions
  bad_files: { httpStatus: 400, meaning: "files isn't a list of files in the shape the call takes." },
  bad_path: { httpStatus: 400, meaning: "A file's path is absolute, has . or .. in it, has control characters or is over 200 characters." },
  hidden_file: { httpStatus: 400, meaning: "A file or folder's name starts with a dot." },
  precompressed_file: { httpStatus: 400, meaning: "A file is pre-compressed (.gz or .br)." },
  file_type_not_allowed: { httpStatus: 400, meaning: "A file is of a type games can't have." },
  file_too_big: { httpStatus: 413, meaning: "A file is over 500 MB." },
  duplicate_path: { httpStatus: 400, meaning: "Two files share a path." },
  no_index_html: { httpStatus: 400, meaning: "There's no index.html at the top of the game." },
  too_many_files: { httpStatus: 400, meaning: "The game has more than 20,000 files." },
  game_too_big: { httpStatus: 413, meaning: "The game is over 2 GB." },
  too_big_for_mcp: { httpStatus: 413, meaning: "upload_files takes up to 5 MB; bigger builds go through the upload command." },
  bad_base64: { httpStatus: 400, meaning: "Something sent as base64 isn't valid base64." },
  files_missing: { httpStatus: 409, meaning: "Some of the version's files haven't been sent yet." },
  bad_patch_notes: { httpStatus: 400, meaning: "patch_notes isn't text of up to 2,000 characters." },
  bad_publish_when_approved: { httpStatus: 400, meaning: "publish_when_approved isn't true or false." },
  version_limit: { httpStatus: 429, meaning: "The game has had 20 versions in the last day." },
  no_content_length: { httpStatus: 411, meaning: "A file was sent without a Content-Length header." },
  file_needs_parts: { httpStatus: 413, meaning: "A file over 95 MB was sent in one go." },
  no_body: { httpStatus: 400, meaning: "A file was sent without a body." },
  hash_mismatch: { httpStatus: 400, meaning: "A file doesn't match the SHA-256 it was sent as." },
  forbidden_file: { httpStatus: 400, meaning: "A file is a program or an archive, whatever its name says." },
  bad_size_bytes: { httpStatus: 400, meaning: "size_bytes isn't a whole number above 0." },
  bad_part_number: { httpStatus: 400, meaning: "A part's number isn't from 1 to 10,000." },
  no_upload_id: { httpStatus: 400, meaning: "A part was sent without its upload_id." },
  bad_part_size: { httpStatus: 400, meaning: "A part is empty, over 50 MB or has no Content-Length header." },
  upload_closed: { httpStatus: 400, meaning: "The upload_id isn't an open upload any more." },
  bad_parts: { httpStatus: 400, meaning: "The finishing call isn't { upload_id, parts: [{ part_number, etag }] }." },
  parts_incomplete: { httpStatus: 400, meaning: "The parts sent don't make a whole file." },

  // Versions and publishing
  no_version: { httpStatus: 404, meaning: "The game has no version with that ID." },
  bad_time: { httpStatus: 400, meaning: "scheduled_publish_at isn't an ISO time from a few minutes to 90 days ahead." },
  still_scanning: { httpStatus: 409, meaning: "The version is still being scanned." },
  not_approved: { httpStatus: 409, meaning: "The version didn't pass review, so it can't be published." },

  // Tester links
  bad_name: { httpStatus: 400, meaning: "A tester link's name isn't 1 to 60 characters." },
  too_many_tester_links: { httpStatus: 403, meaning: "The game has 50 tester links on already." },
  no_tester_link: { httpStatus: 404, meaning: "The game has no tester link on with that ID." },

  // The developer forum
  no_topic: { httpStatus: 404, meaning: "There's no topic with that ID you can see." },
  no_post: { httpStatus: 404, meaning: "There's no post with that ID you can see in the topic." },
  no_known_issue: { httpStatus: 404, meaning: "There's no known issue with that ID." },
  no_media: { httpStatus: 404, meaning: "There's no image there you can see." },
  bad_tab: { httpStatus: 400, meaning: "tab isn't latest, top, unanswered, known, yours or messages." },
  bad_section: { httpStatus: 400, meaning: "section isn't one of the forum's sections." },
  bad_category: { httpStatus: 400, meaning: "category isn't one of the forum's categories." },
  no_category: { httpStatus: 400, meaning: "A public topic was sent without its category." },
  bad_tag: { httpStatus: 400, meaning: "tag isn't one of the forum's tags." },
  bad_tags: { httpStatus: 400, meaning: "tags isn't a list of up to 3 of the forum's tags." },
  bad_topic_status: { httpStatus: 400, meaning: "topic_status isn't one of the statuses." },
  bad_is_answered: { httpStatus: 400, meaning: "is_answered isn't true or false." },
  bad_maximum_topic_count: { httpStatus: 400, meaning: "maximum_topic_count isn't a whole number from 1 to 30." },
  bad_detail: { httpStatus: 400, meaning: "detail isn't brief." },
  bad_post_selection: { httpStatus: 400, meaning: "post_selection isn't all, answer, latest or none." },
  bad_is_public: { httpStatus: 400, meaning: "is_public isn't true or false." },
  bad_text_markdown: { httpStatus: 400, meaning: "text_markdown is empty or over 8,000 characters." },
  bad_author_kind: { httpStatus: 400, meaning: "author_kind isn't developer or ai." },
  bad_debug_context: { httpStatus: 400, meaning: "debug_context isn't an object of its five text fields, up to 8,000 characters in all." },
  bad_images_base64: { httpStatus: 400, meaning: "images_base64 isn't a list of base64 images." },
  too_many_images: { httpStatus: 400, meaning: "A post carries more than 10 images." },
  bad_reopen: { httpStatus: 400, meaning: "reopen isn't true or false." },
  bad_answer_post_id: { httpStatus: 400, meaning: "answer_post_id isn't a post ID or null." },
  bad_reason: { httpStatus: 400, meaning: "reason isn't one of the report reasons." },
  post_limit: { httpStatus: 429, meaning: "The account has posted 100 times in the last day." },
  image_limit: { httpStatus: 429, meaning: "The account has uploaded 200 forum images in the last day." },
  not_yours: { httpStatus: 403, meaning: "Only the developer who started the topic can do that." },
  not_a_question: { httpStatus: 400, meaning: "Only a question has an answer to mark." },
  not_closed: { httpStatus: 400, meaning: "The topic isn't closed, so there's nothing to reopen." },
  not_released: { httpStatus: 400, meaning: "The topic isn't a known issue whose fix is out." },
  cant_vote: { httpStatus: 400, meaning: "The topic doesn't take your vote: it's yours, private, or a discussion." },
  cant_flag: { httpStatus: 400, meaning: "Only public topics others can see can be flagged as misplaced." },
  cant_mark_helpful: { httpStatus: 400, meaning: "Your own posts can't be marked helpful." },
  cant_report: { httpStatus: 400, meaning: "The post can't be reported: it's yours, or Zaisma's." },
} as const satisfies Record<string, { httpStatus: number; meaning: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

/** What went wrong besides its code, as an error answer gives it. */
export interface ErrorDetails {
  /** What happened, in one sentence. */
  message: string;
  /** The input at fault, like play_modes[1].play_style; leave out when no one input is. */
  field?: string | null;
  /** What to do about it, naming the call or value when there is one. */
  fix: string;
  /** How long to wait first, when waiting helps. */
  retryAfterSec?: number | null;
}

/** An error answer: { "error": { code, message, field, fix, retry_after_sec } }, the same in the API and the MCP. */
export interface ErrorAnswer {
  error: { code: ErrorCode; message: string; field: string | null; fix: string; retry_after_sec: number | null };
}

/** A refusal the developer API and MCP answer with, as docs/NAMING.md describes. */
export class ApiError extends Error {
  readonly httpStatus: number;
  readonly field: string | null;
  readonly fix: string;
  readonly retryAfterSec: number | null;

  constructor(
    readonly code: ErrorCode,
    details: ErrorDetails,
  ) {
    super(details.message);
    this.httpStatus = ERROR_CODES[code].httpStatus;
    this.field = details.field ?? null;
    this.fix = details.fix;
    this.retryAfterSec = details.retryAfterSec ?? null;
  }

  /** What happened and what to do, for a page to show. */
  get messageWithFix(): string {
    return `${this.message} ${this.fix}`;
  }

  toAnswer(): ErrorAnswer {
    return { error: { code: this.code, message: this.message, field: this.field, fix: this.fix, retry_after_sec: this.retryAfterSec } };
  }
}

/** Seconds until a limit over the last day frees up, from the oldest thing it counted. */
export function secondsUntilDayPasses(oldestAtMs: number | null | undefined, nowMs = Date.now()): number {
  return Math.max(1, Math.ceil(((oldestAtMs ?? nowMs) + 86400_000 - nowMs) / 1000));
}
