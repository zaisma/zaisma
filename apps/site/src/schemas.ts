import { CONTROLS, DEVICES, PLAY_STYLES, ROOM_BROWSING, SCREENS, VISIBILITIES } from "@zaisma/core";

/**
 * The developer API's answers as JSON Schema: the MCP's output schemas, and what the tests check
 * every answer against. Names follow docs/NAMING.md, and test/site/naming.test.ts checks them.
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
export const PLAY_MODE = object({
  mode: choice({ single: "single-player", local: "together on one device or screen", online: "each on their own device" }),
  minimum_player_count: nullable(countOf("2 or more; null for single")),
  maximum_player_count: nullable(countOf("null for no limit, or for single")),
  play_style: nullable(choice(PLAY_STYLES, "null for single.")),
});

export const GAME = object({
  slug: text("The game's link name, as in zaisma.com/g/<slug>"),
  page_url: url(),
  title: text(),
  description: text(),
  visibility: VISIBILITY,
  review_status: REVIEW_STATUS,
  devices: list(choice(DEVICES)),
  controls: list(choice(CONTROLS)),
  screen_orientation: nullable(choice(SCREENS, "null: not set.")),
  play_modes: nullable(list(PLAY_MODE, "How it's played; null: not set.")),
  cloud_saves_enabled: yes("Signed-in players' browser saves are copied to their account."),
  multiplayer_mode: MULTIPLAYER_MODE,
  room_browsing: ROOM_BROWSING_CHOICE,
  details_waiting_for_review: nullable(object({ title: nullable(text()), description: nullable(text()) }, "A new title or description waiting for review before players see it.")),
  updated_at: isoTime(),
});

export const FINDING = object({
  severity: choice({ reject: "the version can't go live", hold: "a person at Zaisma looks first" }),
  rule: text("Which check found it."),
  explanation: text(),
  path: nullable(text("The file it's in, if any.")),
});

export const VERSION = object({
  id: text(),
  file_count: countOf(),
  size_bytes: countOf(),
  scan_status: choice({ scanning: "being scanned, usually under a minute", held: "waiting for a person at Zaisma", approved: "passed; it can be previewed and published", rejected: "can't be published; see findings" }),
  is_live: yes("This is the version players get."),
  patch_notes: text(),
  preview_url: nullable(url("A private link to play this version, once it's approved.")),
  published_at: nullable(isoTime("When it last went live.")),
  scheduled_publish_at: nullable(isoTime("When it goes live by itself, if it's scheduled.")),
  created_at: isoTime(),
  findings: list(FINDING, "Why it was held or rejected."),
});

export const IMAGE = object({
  id: text(),
  kind: choice({ cover: "landscape cover", square: "square cover, shown on phones", screenshot: "a screenshot" }),
  review_status: choice({ pending: "only you see it until it's reviewed", approved: "shown to players", rejected: "not shown" }),
  width_px: countOf(),
  height_px: countOf(),
  size_bytes: countOf(),
  image_url: url(),
  created_at: isoTime(),
});

export const TESTER = object({
  id: text(),
  name: text("Who it's for."),
  link_url: url("The secret link to share."),
  created_at: isoTime(),
  last_opened_at: nullable(isoTime("To the hour.")),
});

/** The calls that usually follow a change, ready to make (docs/NAMING.md, Next steps). */
export const NEXT = list(
  object({
    tool: text("The MCP tool to call."),
    arguments: { type: "object", description: "What to send it, filled in." },
    after_sec: nullable(countOf("How long to wait first; null for straight away.")),
    reason: text(),
  }),
);

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
      version_id: text(),
      first_at: isoTime(),
      last_at: isoTime(),
    }),
    "The 20 most recent distinct errors of the game's own game server; empty for other games.",
  ),
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
  bug_reports: list(
    object({
      id: text(),
      player_text: text("What the player wrote."),
      summary: nullable(text()),
      version_id: nullable(text("The version they played.")),
      reported_at: isoTime(),
    }),
  ),
  next_cursor: text("Pass as cursor next time to get only bug reports that arrived after this call."),
});

export const HISTORY = object({
  events: list(
    object({
      description: text(),
      version_id: nullable(text()),
      done_by: choice({ you: "the developer", zaisma: "Zaisma" }),
      happened_at: isoTime(),
    }),
    "Newest first.",
  ),
});
