import { CONTENT_RULES, CONTROLS, DEVICES, FORUM_REPORT_REASONS, PLAY_STYLES, PLAYER_REPORT_REASONS, REPORT_REASONS, REVIEW_CODES, ROOM_BROWSING, SCREENS, VISIBILITIES, WEBHOOK_EVENT_KINDS, type IdKind } from "@zaisma/core";

/**
 * The developer API's answers as JSON Schema, and the admin MCP's at the end: the MCPs' output
 * schemas, and what the tests check every answer against. Names follow docs/NAMING.md, and
 * test/site/naming.test.ts checks them.
 */

export type Schema = Record<string, unknown>;

const describe = (schema: Schema, description?: string): Schema => (description ? { ...schema, description } : schema);
const orNull = (schema: Schema): Schema => {
  const type = schema.type as string | string[];
  return { ...schema, type: [...(Array.isArray(type) ? type : [type]), "null"], ...(schema.enum ? { enum: [...(schema.enum as unknown[]), null] } : {}) };
};

export const text = (description?: string) => describe({ type: "string" }, description);
export const url = (description?: string) => describe({ type: "string", format: "uri" }, description);
/** A calendar day: YYYY-MM-DD in UTC. */
export const date = (description?: string) => describe({ type: "string", format: "date" }, description);
/** A point in time: ISO 8601 in UTC, named <event>_at. */
export const isoTime = (description?: string) => describe({ type: "string", format: "date-time" }, description);
/** An ID of one kind: <kind>_<random> (docs/NAMING.md, IDs). */
export const idOf = (kind: IdKind, description?: string) => describe({ type: "string", pattern: `^${kind}_[a-z0-9]+$` }, description);
export const countOf = (description?: string) => describe({ type: "integer", minimum: 0 }, description);
export const number = (description?: string) => describe({ type: "number", minimum: 0 }, description);
export const yes = (description?: string) => describe({ type: "boolean" }, description);
export const list = (items: Schema, description?: string) => describe({ type: "array", items }, description);
export const nullable = orNull;
/** One of a fixed list; the description says what each value means. */
export function choice(values: Record<string, string> | readonly string[], lead?: string): Schema {
  const meanings = Array.isArray(values) ? null : (values as Record<string, string>);
  const keys = meanings ? Object.keys(meanings) : [...(values as readonly string[])];
  const said = meanings ? keys.map((key) => `${key}: ${meanings[key]}`).join(". ") : "";
  return describe({ type: "string", enum: keys }, [lead, said].filter(Boolean).join(" ") || undefined);
}
/** An object whose keys are always all there. */
export function object(properties: Record<string, Schema>, description?: string): Schema {
  return describe({ type: "object", properties, required: Object.keys(properties), additionalProperties: false }, description);
}

export const VISIBILITY = choice(
  { draft: "only you and tester links", listed: "on Zaisma for everyone", unlisted: "only people with the link", private: "only you and tester links, after being public" },
  "Who can see the game.",
);
export const REVIEW_STATUS = choice(
  { pending: "no version has passed review yet", live: "players can play it", held: "paused while Zaisma checks it", removed: "taken down by Zaisma" },
  "Zaisma's review of the game, separate from visibility.",
);
export const MULTIPLAYER_MODE = choice(
  { none: "single-player, or the game's own servers", relay: "Zaisma passes each message to the others", own: "the game's own game server runs on Zaisma rooms", "built-in": "a game server built into Zaisma, set by Zaisma" },
  "Multiplayer on Zaisma rooms.",
);
export const ROOM_BROWSING_CHOICE = choice(
  { page: "open rooms listed on the game page and to the game", game: "only to the game", off: "nowhere; room codes and invite links still work" },
  "For games on Zaisma rooms: where open rooms are listed.",
);
export const ACCOUNT_REQUIREMENT_CHOICE = choice(
  { none: "guests play everything", multiplayer: "guests play alone; only signed-in players get player passes", whole_game: "players sign in before Play; only signed-in players get player passes" },
  "What the game needs a Zaisma account for.",
);
export const PLAY_MODE = object({
  mode: choice({ single: "single-player", local: "together on one device or screen", online: "each on their own device" }),
  minimum_player_count: nullable(countOf("2 or more; null for single")),
  maximum_player_count: nullable(countOf("null for no limit, or for single")),
  play_style: nullable(choice(PLAY_STYLES, "null for single.")),
});

export const CONTENT_RULE = choice(CONTENT_RULES, "The content rule it's about, as zaisma.com/legal/content-rules#<rule> words it.");
const REVIEW_CODE = describe({ type: "string", enum: Object.keys(REVIEW_CODES) }, "Stable, from one list (docs/DEVELOPER-API.md, Holds and takedowns); search_forum finds others who had it.");
/** Why Zaisma held, rejected or took something down: the same parts as an error's, plus the content rule. */
export const reviewReason = (description: string) =>
  object(
    {
      code: REVIEW_CODE,
      message: text("What happened and why, in plain words."),
      content_rule: nullable(CONTENT_RULE),
      fix: text("What to do about it, naming the call when there is one."),
    },
    description,
  );

export const GAME = object({
  slug: text("The game's link name, as in zaisma.com/g/<slug>"),
  page_url: url(),
  title: text(),
  description: text(),
  visibility: VISIBILITY,
  review_status: REVIEW_STATUS,
  review_reason: nullable(reviewReason("Why it's held or removed; null while it's pending or live.")),
  devices: list(choice(DEVICES)),
  controls: list(choice(CONTROLS)),
  screen_orientation: nullable(choice(SCREENS, "null: not set.")),
  play_modes: nullable(list(PLAY_MODE, "How it's played; null: not set.")),
  cloud_saves_enabled: yes("Signed-in players' browser saves are copied to their account."),
  multiplayer_mode: MULTIPLAYER_MODE,
  room_browsing: ROOM_BROWSING_CHOICE,
  account_requirement: ACCOUNT_REQUIREMENT_CHOICE,
  details_waiting_for_review: nullable(object({ title: nullable(text()), description: nullable(text()) }, "A new title or description waiting for review before players see it.")),
  updated_at: isoTime(),
});

const FINDING_SEVERITY = choice({ reject: "the version can't go live", hold: "a person at Zaisma looks first" });
export const FINDING = object({
  code: REVIEW_CODE,
  severity: FINDING_SEVERITY,
  message: text("What the scan found, in plain words."),
  content_rule: nullable(CONTENT_RULE),
  path: nullable(text("The file it's in, if any.")),
  fix: text("What to do about it."),
});

const SCAN_STATUS = choice({ scanning: "being scanned, usually under a minute", held: "waiting for a person at Zaisma", approved: "passed; it can be previewed and published", rejected: "can't be published; see findings" });

export const VERSION = object({
  id: idOf("version"),
  file_count: countOf(),
  size_bytes: countOf(),
  scan_status: SCAN_STATUS,
  is_live: yes("This is the version players get."),
  patch_notes: text(),
  preview_url: nullable(url("A private link to play this version, once it's approved.")),
  published_at: nullable(isoTime("When it last went live.")),
  scheduled_publish_at: nullable(isoTime("When it goes live by itself, if it's scheduled.")),
  created_at: isoTime(),
  review_reason: nullable(reviewReason("A person's or a report's decision: why a person rejected it, or a report paused it. null otherwise.")),
  findings: list(FINDING, "What the scan found that holds or rejects it."),
});

export const IMAGE = object({
  id: idOf("image"),
  kind: choice({ cover: "landscape cover", square: "square cover, shown on phones", screenshot: "a screenshot" }),
  review_status: choice({ pending: "only you see it until it's reviewed", approved: "shown to players", rejected: "not shown" }),
  review_reason: nullable(reviewReason("Why it wasn't approved; null otherwise.")),
  width_px: countOf(),
  height_px: countOf(),
  size_bytes: countOf(),
  image_url: url(),
  created_at: isoTime(),
});

export const TESTER = object({
  id: idOf("tester"),
  name: text("Who it's for."),
  link_url: url("The secret link to share."),
  created_at: isoTime(),
  last_opened_at: nullable(isoTime("To the hour.")),
});

/** A developer's site or app that players sign in to with Zaisma (OpenID Connect). */
export const SIGN_IN_APP = object({
  id: idOf("sign_in_app", "The app's ID: give it to your OpenID Connect library as the client_id."),
  name: text("What players see when they sign in."),
  kind: choice({ confidential: "a site or server that keeps the client secret on its server", public: "a page or phone app with no server; it signs in with PKCE alone" }, "OAuth's client type."),
  redirect_urls: list(url(), "The exact URLs a sign-in can go back to: the redirect_uri your site sends must be one of them."),
  issuer_url: url("Zaisma's OpenID Connect issuer: libraries find everything else at <issuer_url>/.well-known/openid-configuration."),
  created_at: isoTime(),
  updated_at: isoTime(),
});

/** An account's public profile: what anyone sees of it, games and servers included. */
export const PLAYER_PROFILE = object({
  id: idOf("player", "The account's player ID, the same in every game."),
  name: text("The account's name, as other players see it."),
});

/** The calls that usually follow a change, ready to make (docs/NAMING.md, Next steps). */
export const NEXT = list(
  object({
    tool: text("The MCP tool to call."),
    arguments: { type: "object", description: "What to send it, filled in as far as Zaisma knows; the reason says what to add." },
    after_sec: nullable(countOf("How long to wait first; null for straight away.")),
    reason: text(),
  }),
  "The calls that usually follow; empty when nothing does.",
);

/** Every error, in the API and the MCP (docs/NAMING.md, Errors). */
export const ERROR = object({
  error: object({
    code: text("Stable, one problem per code; docs/DEVELOPER-API.md lists every code."),
    message: text("What happened."),
    field: nullable(text("The input at fault, like play_modes[1].play_style; null when no one input is.")),
    fix: text("What to do about it."),
    retry_after_sec: nullable(countOf("How long to wait before trying again, when waiting helps; else null.")),
  }),
});

/**
 * A tool's output schema as the MCP lists it: its answer, or an error. MCP clients check a result's
 * structuredContent against the output schema even when isError is set, so the error has to fit too.
 */
export const answerOrError = (answerSchema: Schema): Schema => ({ type: "object", anyOf: [answerSchema, ERROR] });

const DAY_PLAYS = object({
  date: date(),
  play_count: countOf("Counted plays: the official number."),
  player_count: countOf("Browsers with a counted play that day."),
  new_player_count: countOf("Browsers with their first counted play."),
  play_duration_min: countOf("Time on screen in counted plays."),
  started_play_count: countOf("Every play started, counted or not."),
});
const CAME_BACK = object({
  returned_pct: nullable(countOf("null until enough days are over.")),
  returned_player_count: countOf(),
  new_player_count: countOf("New players in the 30 days before."),
});

export const PLAY_STATS = object(
  {
    days: list(DAY_PLAYS),
    play_count: countOf(),
    started_play_count: countOf(),
    new_player_count: countOf(),
    play_duration_min: countOf(),
    average_play_duration_min: nullable(number("Per counted play; null before any.")),
    came_back: object({ after_1_day: CAME_BACK, after_7_days: CAME_BACK, after_30_days: CAME_BACK }),
  },
  "Counted plays: the game on screen for a minute in a browser Cloudflare checked. Tester and preview links and the developer's own plays don't count; a player is a browser.",
);

export const STATS = object({
  period_duration_days: countOf(),
  play_stats: PLAY_STATS,
  multiplayer_days: list(
    object({
      date: date(),
      room_count: countOf(),
      room_play_duration_min: countOf("Player time in rooms."),
      message_count: countOf(),
      game_server: nullable(
        object(
          {
            call_count: countOf(),
            crash_count: countOf("A handler threw; that call is lost."),
            stopped_count: countOf("A call ran on too long, about 2 seconds of CPU; the match froze meanwhile."),
            ended_match_count: countOf("Matches ended because their game server was stopped twice."),
          },
          "Only for games running their own game server; otherwise null.",
        ),
      ),
    }),
  ),
  room_use_this_month: object({
    room_play_duration_hours: number("Player time on Zaisma rooms this month, UTC."),
    free_room_play_duration_hours: countOf(),
    has_reached_free_hours: yes("Until hosting billing is ready, no new rooms open until the month resets; matches already running carry on."),
  }),
  game_server_errors: list(
    object({
      kind: choice({ crash: "a handler threw", stopped: "a call ran on too long" }),
      message: text("The error, with the file and line it came from."),
      occurrence_count: countOf(),
      version_id: idOf("version"),
      first_at: isoTime(),
      last_at: isoTime(),
    }),
    "The 20 most recent distinct errors of the game's own game server; empty for other games.",
  ),
});

/** A game database's answer to one statement. */
export const STATEMENT_RESULT = object({
  rows: list(
    {
      type: "object",
      additionalProperties: { anyOf: [{ type: ["string", "number", "null"] }, object({ blob_base64: text("The bytes, base64-encoded.") })] },
      description: "One row, by column name: text, a number, null, or { blob_base64 } for a blob.",
    },
    "What the statement answered: a SELECT's rows, or a change's with RETURNING; [] for none.",
  ),
  read_row_count: countOf("Rows the statement read, as Cloudflare counts them towards the month's free reads."),
  written_row_count: countOf("Rows it wrote, counting each index changed, towards the month's free writes."),
});

export const DATABASE = object({
  tables: list(object({ name: text(), sql: text("Its CREATE TABLE, as SQLite keeps it.") }), "The game's tables, by name."),
  indexes: list(object({ name: text(), table_name: text(), sql: text("Its CREATE INDEX, as SQLite keeps it.") }), "Indexes made with CREATE INDEX, by name."),
  database_use_this_month: object(
    {
      read_row_count: countOf(),
      written_row_count: countOf(),
      storage_size_bytes: countOf("The database's size now."),
      free_read_row_count: countOf(),
      free_written_row_count: countOf(),
      free_storage_size_bytes: countOf(),
      has_reached_free_reads: yes("Until hosting billing is ready, past them queries stop (game servers' and the API's) until reset_date."),
      has_reached_free_writes: yes("Past them writes stop until reset_date; reads keep working."),
      has_reached_free_storage: yes("At it the database can change and delete rows but not grow."),
      reset_date: date("When the month's reads and writes start again from 0 (UTC)."),
    },
    "This calendar month (UTC), against the free use every game has.",
  ),
});

/** A player's report that report triage sorted as a bug: what they wrote, never who they are. */
export const BUG_REPORT = object({
  id: idOf("report"),
  player_text: text("What the player wrote."),
  summary: nullable(text()),
  version_id: nullable(idOf("version", "The version they played.")),
  reported_at: isoTime(),
});

export const REPORTS = object({
  period_duration_days: countOf(),
  reasons: list(
    object({
      reason: text(),
      label: text(),
      open_count: countOf("Waiting for Zaisma."),
      closed_count: countOf("Zaisma looked and dismissed it or acted on it."),
    }),
  ),
  bug_reports: list(BUG_REPORT),
  next_cursor: text("Pass as cursor next time to get only bug reports that arrived after this call."),
});

/** An address your server takes Zaisma's events at, and the events it takes. */
export const WEBHOOK = object({
  id: idOf("webhook"),
  endpoint_url: url("Where events are sent, as signed POSTs."),
  event_kinds: list(choice(WEBHOOK_EVENT_KINDS), "The events sent to it."),
  game_slugs: nullable(list(text(), "Only events about these games; null for every game you have and will make.")),
  pending_delivery_count: countOf("Events still being tried."),
  failed_delivery_count: countOf("Events that failed every try in the last 30 days: list_webhook_deliveries says why."),
  created_at: isoTime(),
  updated_at: isoTime(),
});

/** What a webhook is sent: the body the signature covers. */
export const WEBHOOK_EVENT = object({
  id: idOf("webhook_event", "The same on every try (Standard Webhooks' webhook-id header), so a server can skip one it already has."),
  kind: choice(
    {
      bug_reported: "report triage sorted a player's report as a bug (bug_report)",
      scan_status_changed: "a version's scan finished, or Zaisma changed its scan_status later (version)",
      live_version_changed: "players get another version: published, rolled back, published at its set time, or put back while a report is checked (version: the one players get now)",
      review_status_changed: "Zaisma held or took down the game, or put it back (game.review_status and game.review_reason)",
      test: "sent by test_webhook; game, version and bug_report are null",
    },
    "What happened.",
  ),
  happened_at: isoTime(),
  game: nullable({ ...GAME, description: "The game as get_game answers it, now; null for a test event." }),
  version: nullable({ ...VERSION, description: "The version as get_version answers it, now; null when the event isn't about one." }),
  bug_report: nullable({ ...BUG_REPORT, description: "The bug report as get_reports lists it; null unless kind is bug_reported." }),
});

/** One event on its way to one webhook, and how it went. */
export const WEBHOOK_DELIVERY = object({
  webhook_id: idOf("webhook"),
  webhook_event: WEBHOOK_EVENT,
  delivery_status: choice({ pending: "being tried; next_attempt_at says when next", delivered: "your server answered 2xx", failed: "every try failed, so it won't be sent again" }),
  attempt_count: countOf("Tries so far: up to 6 over about a day and a half (a test event: 1)."),
  last_attempt_at: nullable(isoTime()),
  next_attempt_at: nullable(isoTime("When it's tried next; null unless pending.")),
  failure_message: nullable(text("Why the last try failed, with the HTTP status your server answered, like \"Answered 500; only a 2xx answer counts as delivered.\"; null once delivered.")),
  created_at: isoTime(),
});

export const HISTORY = object({
  events: list(
    object({
      description: text(),
      version_id: nullable(idOf("version")),
      done_by: choice({ you: "the developer", zaisma: "Zaisma" }),
      happened_at: isoTime(),
      review_reason: nullable(reviewReason("For a hold, rejection or takedown: why, the rule and the fix. null for everything else.")),
    }),
    "Newest first.",
  ),
});

// --- The developer forum ---

const TOPIC_KIND = choice({ bug: "something in Zaisma doesn't work", gap: "a limit or missing piece blocks the developer", feature: "an idea", question: "a question", talk: "a discussion" });
export const TOPIC_STATUS = choice(
  {
    new: "open, or waiting for Zaisma on a message",
    investigating: "Zaisma is looking",
    known: "confirmed",
    planned: "on the roadmap",
    fixing: "being worked on",
    released: "a fix is out and Zaisma is watching that it holds",
    fixed: "resolved",
    wont: "won't fix, with why",
    answered: "a question with an answer",
  },
  "Where it stands: a known issue's phase, or answered.",
);
const AUTHOR_KIND = choice({ developer: "the developer wrote it", ai: "the developer's AI assistant wrote it", zaisma: "the people who build Zaisma" });
const PERSON = object({
  name: text("The account's name; an AI's posts carry its developer's name."),
  kind: AUTHOR_KIND,
  is_you: yes(),
});
const TOPIC_FIELDS = {
  id: idOf("topic"),
  kind: TOPIC_KIND,
  title: text(),
  category: nullable(text("Where in Zaisma it belongs, like rooms or mcp.")),
  tags: list(text()),
  topic_status: TOPIC_STATUS,
  is_public: yes("false: a private message to Zaisma, only the developer and Zaisma see it."),
  is_shown: yes("Others can see it: public, and its first post passed the check."),
  is_known_issue: yes("Zaisma's own topic about a problem many developers hit."),
  author: PERSON,
  recent_participants: list(PERSON, "The latest few people in it, newest first, without the author."),
  participant_count: countOf("Everyone in it besides the author."),
  reply_count: countOf(),
  vote_count: countOf("Affects me too, I want this or same question."),
  has_voted: yes(),
  affected_developer_count: nullable(countOf("For a known issue: the developers it affects, with their messages and votes; null otherwise.")),
  is_answered: yes(),
  merged_into_topic_id: nullable(idOf("topic", "Your message's known issue, when Zaisma merged it into one.")),
  is_unread: yes("Something new since you last opened it."),
  created_at: isoTime(),
  last_activity_at: isoTime(),
  search_match: nullable(text("With search_text: the words that matched, marked «like this».")),
};
export const TOPIC_ROW = object(TOPIC_FIELDS);
export const BRIEF_TOPIC = object(
  {
    id: idOf("topic"),
    title: text(),
    kind: TOPIC_KIND,
    topic_status: TOPIC_STATUS,
    is_known_issue: yes(),
    is_answered: yes(),
    vote_count: countOf(),
    affected_developer_count: nullable(countOf("For a known issue: the developers it affects; null otherwise.")),
    reply_count: countOf(),
    category: nullable(text()),
    search_match: nullable(text("The words that matched, marked «like this»; null without search_text.")),
    is_unread: yes(),
    last_activity_at: isoTime(),
  },
  "A topic in a few fields: open it with get_topic.",
);
export const TOPIC = object({
  ...TOPIC_FIELDS,
  workaround: nullable(text("A known issue's: what to do until it's fixed.")),
  roadmap_item: nullable(text("A known issue's roadmap item, as in docs/ROADMAP.md.")),
  game_slug: nullable(text("The game a message is about, for its developer only.")),
  merged_into_topic: nullable(object({ id: idOf("topic"), title: text(), topic_status: TOPIC_STATUS, workaround: nullable(text()) }, "The known issue your message is part of.")),
  your_message_topic_id: nullable(idOf("topic", "On a known issue: your own private message about it.")),
  is_following: yes("What's new in it shows as unread in search_forum's yours tab."),
  has_flagged_misplaced: yes("You flagged it as in the wrong category, and Zaisma hasn't looked yet."),
  can_reply: yes(),
  can_vote: yes(),
  can_flag_misplaced: yes(),
  can_mark_answer: yes(),
  can_reopen: yes(),
});
const DEBUG_CONTEXT = object(
  { call: nullable(text()), error_code: nullable(text()), error_message: nullable(text()), request_json: nullable(text()), notes: nullable(text()) },
  "What was attached for whoever fixes it; only its poster and Zaisma see it.",
);
const POST_KIND = choice({ post: "a post", reopen: "its developer reopened the topic", status: "Zaisma changed where it stands" });
const POSTED_VIA = choice(["mcp", "api", "cli", "dashboard", "admin"]);
export const POST = object({
  id: idOf("post"),
  author: PERSON,
  kind: POST_KIND,
  text_markdown: text(),
  reply_to_post: nullable(object({ id: idOf("post"), author_name: text(), excerpt: text() }, "The post it answers, if it answers one.")),
  is_answer: yes("The question's marked answer."),
  check_status: nullable(choice({ pending: "being checked: only you see it yet", passed: "others see it", held: "waiting for a person at Zaisma: only you see it yet" }, "null in a message to Zaisma.")),
  posted_via: POSTED_VIA,
  helpful_count: countOf(),
  has_marked_helpful: yes(),
  has_reported: yes("You reported it, and Zaisma hasn't looked yet."),
  debug_context: nullable(DEBUG_CONTEXT),
  media: list(object({ id: idOf("media"), image_url: url() }), "Its images."),
  mentioned_names: list(text(), "The people it @mentions."),
  created_at: isoTime(),
});
const CHECK_NOTE = nullable(text("While others can't see it yet: how long the check takes. null once they can."));
const REMOVED_SECRET_COUNT = countOf("Keys and passwords blanked before it was stored.");
export const TOPIC_PAGE = object({
  topics: list(BRIEF_TOPIC),
  pinned_topics: list(BRIEF_TOPIC, "Open known issues, above the latest topics on the first page."),
  tab: choice(["latest", "top", "unanswered", "known", "yours", "messages"]),
  next_cursor: nullable(text("Pass as cursor for the next topics; null on the last page.")),
  remaining_post_count: countOf("Posts the developer can still make today."),
});
export const TOPIC_WITH_POSTS = object({
  topic: TOPIC,
  posts: list(POST),
  post_count: countOf("Posts you can see in all, whichever were sent."),
  remaining_post_count: countOf("Posts the developer can still make today."),
});
export const NEW_TOPIC = object({
  topic: TOPIC,
  posts: list(POST),
  post_count: countOf(),
  remaining_post_count: countOf(),
  similar_topics: list(TOPIC_ROW, "Topics and known issues that look like the same thing: if one is, vote or reply there."),
  check_note: CHECK_NOTE,
  removed_secret_count: REMOVED_SECRET_COUNT,
  next_steps: NEXT,
});
export const NEW_REPLY = object({ post: POST, check_note: CHECK_NOTE, removed_secret_count: REMOVED_SECRET_COUNT, next_steps: NEXT });

// --- The admin MCP (docs/ADMIN-MCP.md) ---

/** A precedent's ID. The first ones were named by hand, with hyphens: precedent_hard-or-boring. */
export const PRECEDENT_ID_PATTERN = "^precedent_[a-z0-9-]+$";
const precedentIdOf = (description?: string) => describe({ type: "string", pattern: PRECEDENT_ID_PATTERN }, description);
/** A report group is named by its first report: its ID is that report's. */
const reportGroupIdOf = (description?: string) => idOf("report", description ?? "The group's ID: its first report's.");

export const REPORT_SEVERITY = choice(
  { child_safety: "a person decides, nothing is deleted, and a confirmed case goes to NCMEC", urgent: "illegal content, or harm happening now", high: "malware, sexual content or hate", normal: "most reports", low: "taste, or copyright from players" },
  "How serious, most serious first.",
);
export const TOPIC_SEVERITY = choice(
  {
    urgent: "a security hole, data exposed or lost, money handled wrong, or broken for everyone",
    high: "blocks a developer from publishing or running their game, with no way around it",
    normal: "a bug with a way around it, a gap, most feature requests",
    low: "a question, a nice-to-have, a docs wording",
  },
  "How serious, most serious first.",
);
const PRECEDENT_DECISION = choice({ dismiss: "nothing against the rules", bug: "the developer's to fix: passed to them as a bug report", recheck: "check the game's files again", take_down: "take the game down" });
export const REPORT_GROUP_DECISION = choice({
  dismiss: "nothing against the rules; the reports close",
  hide_name: "hide a reported room's name and labels from room lists",
  bug: "pass to the developer as a bug report",
  take_down: "take the game down",
  restore: "put a paused game back",
  put_update_back: "put a paused update back for players",
  keep_update_off: "keep a paused update off",
});
const TRIAGE_RECOMMENDATION = choice({ dismiss: "nothing against the rules", bug: "the developer's to fix", recheck: "check the game's files again", person: "a person should look", take_down: "take the game down", restore: "put the game back" });
const REPORT_REASON = choice(Object.keys(REPORT_REASONS));
const PRECEDENT_FIT = object(
  { id: precedentIdOf(), title: text(), fit: choice({ fits: "the case fits it, so it's decided the same way", challenges: "the case looks like it, but the precedent doesn't seem right for it" }) },
  "The precedent the case fits or challenges.",
);

const ADMIN_GAME = object({
  id: idOf("game"),
  slug: text(),
  title: text(),
  description: text(),
  review_status: REVIEW_STATUS,
  visibility: VISIBILITY,
  multiplayer_mode: MULTIPLAYER_MODE,
  game_server_name: nullable(text("What runs its multiplayer on Zaisma rooms: relay, sandbox (the game's own game server) or a built-in one's name; null without rooms.")),
  has_own_servers: yes("The game talks to servers of its own."),
  review_reason: nullable(reviewReason("What the developer reads about why it's held or removed.")),
  created_at: isoTime(),
});
const ADMIN_VERSION = object({
  id: idOf("version"),
  scan_status: SCAN_STATUS,
  is_live: yes("This is the version players get."),
  patch_notes: text(),
  published_at: nullable(isoTime("When it last went live.")),
  created_at: isoTime(),
  scan_summary: nullable(text("What the AI review said; null before it ran.")),
  review_reason: nullable(reviewReason("What the developer reads about a person's or report's decision on it.")),
  findings: list(
    object({ code: text("Which check found it: a code from REVIEW_CODES, or one only Zaisma sees, like known_illegal_image."), severity: FINDING_SEVERITY, message: text("For Zaisma's eyes."), path: nullable(text()) }),
    "Everything the scan found but notes, as Zaisma sees it.",
  ),
});
const HISTORY_EVENT = object({
  action: text("What happened, like report-paused-update or version-published."),
  description: text(),
  actor: text("Who did it: an admin's email, the developer's account, or Zaisma's own checks (scan, triage)."),
  happened_at: isoTime(),
  review_reason: nullable(reviewReason("For a hold, rejection or takedown: what the developer reads about it.")),
});
const GAME_IN_BRIEF = object({ slug: text(), title: text(), review_status: REVIEW_STATUS });

export const REPORT_GROUP_ROW = object({
  id: reportGroupIdOf(),
  severity: REPORT_SEVERITY,
  game: GAME_IN_BRIEF,
  report_count: countOf(),
  first_reported_at: isoTime(),
  summary: nullable(text("What report triage made of it; null until it's sorted.")),
  recommendation: nullable(TRIAGE_RECOMMENDATION),
  why: nullable(text()),
  precedent: nullable(PRECEDENT_FIT),
  is_spot_check: yes("Triage would have dismissed it under a precedent alone; kept for a person to look at."),
  ai_actions: list(text(), "What triage did by itself, in plain words."),
});
const AI_USE = object(
  {
    input_token_count: countOf(),
    output_token_count: countOf(),
    scan_call_count: countOf("AI reviews of versions."),
    report_triage_call_count: countOf(),
    forum_call_count: countOf("Forum sorting and post checks."),
  },
  "The month's AI use, shared by scans, report triage and the forum, UTC.",
);
export const REPORT_GROUP_LIST = object({
  report_groups: list(REPORT_GROUP_ROW, "Open ones, most serious first, then the longest waiting."),
  more_group_count: countOf("Open groups past maximum_group_count."),
  ai_use_this_month: AI_USE,
});

const REPORT = object({
  id: idOf("report"),
  report_status: choice({ open: "waiting", dismissed: "closed with nothing done", actioned: "closed with something done" }),
  reason: REPORT_REASON,
  reason_label: text("The reason in words, with the player and room it's about."),
  player_text: text("What the player wrote. Untrusted."),
  reported_player: nullable(object({ id: idOf("player"), name: text(), reason: choice(Object.keys(PLAYER_REPORT_REASONS)) }, "For a report about a player: who, and what they did.")),
  room_code: nullable(text()),
  room_name: nullable(text("The room's name and labels when it was reported. Typed by players, so untrusted.")),
  version_id: nullable(idOf("version", "The version that was playing.")),
  picture_status: choice({ none: "no picture", shown: "sent with this answer as an image", not_shown: "past the 3 shown; on the admin page", admin_page_only: "a child-safety report's: never sent, only on the admin page" }),
  summary: nullable(text("What triage made of this one report.")),
  reported_at: isoTime(),
});
const TRIAGE = object(
  {
    is_by_ai: yes("false: sorted by rules alone (a child-safety report, or no AI)."),
    category: REPORT_REASON,
    summary: text(),
    recommendation: TRIAGE_RECOMMENDATION,
    why: text(),
    ai_actions: list(text(), "What triage did by itself."),
    precedent: nullable(PRECEDENT_FIT),
    precedent_draft: nullable(object({ title: text(), applies_when: text(), decision: PRECEDENT_DECISION, why: text() }, "When no precedent fits, or the case challenges one: the ruling the AI proposes.")),
    is_spot_check: yes(),
  },
  "What report triage (an AI) found, for the most serious report.",
);
const RECHECK = object({
  recheck_status: choice({ waiting: "the files are being checked again", done: "checked", failed: "the check couldn't run" }),
  scan_status: nullable(choice(["approved", "held", "rejected"], "What the check found; null until it's done.")),
  summary: nullable(text()),
  findings: list(text()),
});
export const PRECEDENT = object({
  id: precedentIdOf(),
  precedent_status: choice({ proposed: "waiting for the admin's approval", active: "in force", retired: "no longer followed" }),
  title: text(),
  applies_when: text("What cases like it look like."),
  decision: PRECEDENT_DECISION,
  why: text(),
  can_ai_apply_alone: yes("Dismissals only: the AI applies it without a person, but for 1 in 20 kept as spot-checks."),
  followed_count: countOf("Reports decided by it, or recommended under it."),
  replaces_precedent_id: nullable(precedentIdOf("The precedent this one changed.")),
  from_report_group_id: nullable(reportGroupIdOf("The report group it was set while deciding.")),
  created_by: text("Who set it: an admin's email, or who drafted it."),
  created_at: nullable(isoTime("null for the first ones, drafted with the precedents.")),
  updated_at: nullable(isoTime()),
});
export const REPORT_GROUP = object({
  report_group: object({
    id: reportGroupIdOf(),
    is_open: yes("Some of its reports are still open."),
    severity: REPORT_SEVERITY,
    child_safety_note: nullable(text("For a child-safety group: what the law asks. null otherwise.")),
    game: ADMIN_GAME,
    reports: list(REPORT, "Oldest first."),
    triage: nullable(TRIAGE),
    rechecks: list(RECHECK, "Fresh looks at the game's files triage asked for."),
    precedent: nullable(PRECEDENT),
    versions: list(ADMIN_VERSION, "The versions the reports were about."),
    events: list(HISTORY_EVENT, "What happened to the game lately, newest first."),
    possible_decisions: list(REPORT_GROUP_DECISION, "What decide_report_group can do now."),
  }),
});
export const REPORT_GROUP_DECIDED = object({
  report_group_id: reportGroupIdOf(),
  decision: REPORT_GROUP_DECISION,
  report_count: countOf("Reports it closed."),
  precedent: nullable(PRECEDENT),
  message: nullable(text("Anything the admin should know about what happened.")),
  next_steps: NEXT,
});
export const HANDLED_REPORTS = object({
  period_duration_days: countOf(),
  reports: list(
    object({ id: idOf("report"), game_slug: text(), summary: text(), ai_actions: list(text()), player_text: text("Untrusted."), reported_at: isoTime() }),
    "Closed by triage without a person, newest first.",
  ),
});
export const PRECEDENT_LIST = object({ precedents: list(PRECEDENT, "In force first, then proposed, then retired; oldest first in each.") });
export const PRECEDENT_CHANGED = object({ precedent: PRECEDENT, next_steps: NEXT });

const SORTING = object(
  {
    is_by_ai: yes("false: sorted without the AI (no key, or the month's budget used up)."),
    summary: text(),
    why: text(),
    merged_into_topic_id: nullable(idOf("topic", "The topic it was merged into as a duplicate.")),
    same_as_topic_id: nullable(idOf("topic", "A public topic that looks like the same thing: merge it if it is.")),
    known_issue_draft: nullable(object({ title: text(), workaround: text() }, "A known issue the AI proposes: approve it with decide_topic's known_issue.")),
  },
  "What AI sorting found.",
);
const LATEST_POST = object({ author_kind: AUTHOR_KIND, text_markdown: text("Its start.") });
const TOPIC_IN_BRIEF = object({ id: idOf("topic"), title: text("A known issue's title when it is one.") });
const QUEUE_TOPIC = object({
  id: idOf("topic"),
  kind: TOPIC_KIND,
  title: text("As first posted."),
  known_issue_title: nullable(text()),
  is_public: yes("A forum topic every developer can read; false: a private message to Zaisma."),
  topic_status: TOPIC_STATUS,
  severity: TOPIC_SEVERITY,
  category: nullable(text()),
  affected_developer_count: countOf(),
  post_count: countOf("In it and the topics merged into it."),
  game_slug: nullable(text()),
  created_at: isoTime(),
  last_posted_at: nullable(isoTime()),
  latest_post: nullable(LATEST_POST),
  is_waiting_for_sorting: yes("New, and AI sorting hasn't looked yet."),
  sorting: nullable(SORTING),
});
const WAITING_POST = object({
  id: idOf("post"),
  topic: TOPIC_IN_BRIEF,
  check_status: choice({ held: "the check held it: others can't see it", pending: "not checked yet: others can't see it", passed: "shown, and developers reported it" }),
  held_reason: nullable(text("Why the check held it.")),
  reports: list(object({ reason: choice(Object.keys(FORUM_REPORT_REASONS)), details: nullable(text()) }), "What developers reported it for; who reported it stays with Zaisma."),
  developer_name: nullable(text("null: the account was deleted.")),
  author_kind: AUTHOR_KIND,
  text_markdown: text(),
  created_at: isoTime(),
});
const ZAISMA_MENTION = object({ id: idOf("post"), topic: TOPIC_IN_BRIEF, developer_name: nullable(text()), author_kind: AUTHOR_KIND, text_markdown: text("Its start."), created_at: isoTime() });
export const TOPIC_QUEUE = object({
  topics: list(QUEUE_TOPIC, "Topics on their own and known issues, most serious first."),
  topics_in_known_issues: list(
    object({ id: idOf("topic"), title: text(), known_issue_topic_id: idOf("topic"), known_issue_topic_status: TOPIC_STATUS }),
    "Messages added to or reopened inside a known issue that's past new.",
  ),
  waiting_posts: list(WAITING_POST, "Public posts others can't see yet, or that developers reported: decide_post shows or removes each."),
  zaisma_mentions: list(ZAISMA_MENTION, "Public posts that mention @Zaisma with no reply from Zaisma since: a reply in the topic answers them."),
});
export const WAITING_POSTS = list(WAITING_POST);

const ADMIN_TOPIC = object({
  id: idOf("topic"),
  kind: TOPIC_KIND,
  title: text("As first posted."),
  topic_status: TOPIC_STATUS,
  is_public: yes("A forum topic every developer can read; false: private to the developer and Zaisma."),
  severity: TOPIC_SEVERITY,
  category: nullable(text()),
  developer_name: nullable(text("null: Zaisma's own known issue, or the account was deleted.")),
  game: nullable(object({ slug: text(), title: text() })),
  known_issue: nullable(object({ title: text(), workaround: nullable(text()), roadmap_item: nullable(text()), affected_developer_count: countOf() })),
  merged_into_topic: nullable(object({ id: idOf("topic"), title: text(), topic_status: TOPIC_STATUS }, "The known issue it's part of.")),
  is_waiting_for_sorting: yes(),
  sorting: nullable(SORTING),
});
const ADMIN_POST = object({
  id: idOf("post"),
  author_kind: AUTHOR_KIND,
  posted_via: POSTED_VIA,
  kind: POST_KIND,
  text_markdown: text("Untrusted."),
  debug_context: nullable(DEBUG_CONTEXT),
  media_ids: list(idOf("media"), "Its images; the latest 3 in the topic come with the answer."),
  check_status: nullable(choice({ pending: "not checked yet", passed: "others see it", held: "the check held it" }, "null in a private message.")),
  held_reason: nullable(text()),
  reply_to_post_id: nullable(idOf("post")),
  created_at: isoTime(),
});
const MERGED_TOPIC = object({ id: idOf("topic"), developer_name: nullable(text()), title: text(), topic_status: TOPIC_STATUS, latest_post: nullable(LATEST_POST) });
const TOPIC_FOR_ADMIN_FIELDS = { topic: ADMIN_TOPIC, posts: list(ADMIN_POST, "Oldest first."), merged_topics: list(MERGED_TOPIC, "Messages merged into it.") };
export const TOPIC_FOR_ADMIN = object(TOPIC_FOR_ADMIN_FIELDS);
export const TOPIC_DECIDED = object({ ...TOPIC_FOR_ADMIN_FIELDS, next_steps: NEXT });
export const POST_DECIDED = object({ post_id: idOf("post"), decision: choice({ show: "shown to everyone, its reports cleared", remove: "taken down" }), waiting_posts: WAITING_POSTS, next_steps: NEXT });

export const GAME_FOR_ADMIN = object({
  game: ADMIN_GAME,
  versions: list(ADMIN_VERSION, "Newest first."),
  report_groups: list(REPORT_GROUP_ROW, "Open ones."),
  events: list(HISTORY_EVENT, "What happened to it lately, newest first."),
});
