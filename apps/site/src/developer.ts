import { withDeclaredAnswer } from "./answers.ts";
import { ERROR } from "./schemas.ts";
import {
  rentedShareLimitCents,
  rentedShareUsedCents,
  ANSWERS_BYTES,
  answersJson,
  anyOf,
  bodyProblem,
  fieldsOf,
  gameData,
  realNumber,
  isPastLevel,
  listOf,
  orNothing,
  queryProblem,
  text,
  yesOrNo,
  type DoorAnswer,
  type DoorLimit,
  type DoorShape,
  gameDeletionOf,
  isPlayedByOthers,
  countryBlocksAnswer,
  IMAGE_LIMITS,
  IMAGE_KINDS,
  isBackgroundShape,
  SHADER_LIMITS,
  dropChosenBackground,
  shadersForGame,
  isSquare,
  MAXIMUM_GAME_COUNT_PER_OWNER,
  accountById,
  apiKeyForToken,
  DEVELOPER_INFO_FINDING_CODES,
  allows,
  keyAccess,
  isFullKey,
  whereFrom,
  type RequestWhere,
  FULL_ACCESS,
  AREA_ACCESS_CHOICES,
  ACCOUNT_AREAS,
  type AccessArea,
  type KeyAccess,
  addImage,
  setBackgroundTone,
  applyDetails,
  audit,
  checkDetails,
  settleMinimumAge,
  settlePaidGame,
  checkSlug,
  createGame,
  deleteImageRow,
  gameBySlug,
  imageById,
  imageKey,
  cardImageKey,
  imageCopyKeys,
  SIZED_IMAGE_WIDTHS_PX,
  sizedImageKey,
  qrCodeSvg,
  heldImageKey,
  iso,
  banScopeOf,
  type BanScope,
  KNOWN_IMAGE_CODE,
  REVIEW_CODES,
  readReviewReason,
  reviewReason,
  reviewReasonAnswer,
  type Finding,
  type ReviewCodeName,
  imagesForGame,
  MANY_IMAGE_KINDS,
  settleImage,
  newId,
  personOwner,
  readPlayModes,
  slugify,
  sniffImage,
  versionsForGame,
  type DetailsChange,
  type Game,
  type ReviewReason,
  type GameImage,
  type ImageKind,
  FILE_LIMITS,
  planFor,
  releaseNewData,
  storageOf,
  UploadError,
  addBlob,
  blobKey,
  checkUploadList,
  createVersion,
  forbiddenContent,
  manifestKey,
  serverModules,
  type Manifest,
  missingBlobs,
  locateBlobs,
  addOwnedBlob,
  ownedBlobKey,
  publishVersion,
  LIFELIKE_GORE_MINIMUM_PLAYER_AGE_YEARS,
  needsLifelikeGoreAge,
  testerLinkVersion,
  testerLinkWaitingVersion,
  dailyReviewMeaning,
  isAiReviewDone,
  type AiReviewSpeed,
  toManifest,
  versionById,
  type ScanReport,
  type UploadFile,
  type PerformanceCheckRow,
  type PerformanceReport,
  type Version,
  REPORT_REASONS,
  MAXIMUM_TESTER_LINK_COUNT,
  addTesterLink,
  revokeTesterLink,
  testerLinks,
  testerLinkToken,
  updateTesterLink,
  VERSION_CHOICES,
  endPreviewPasses,
  randomKey,
  type TesterLink,
  type TesterLinkChoices,
  type VersionChoice,
  type ReportReason,
  FREE_HOSTING_CENTS_PER_MONTH,
  freeAllowanceCents,
  freeHostingEndCents,
  gameHosting,
  spendingMonthRow,
  type GameHosting,
  MAXIMUM_GAME_STORAGE_SIZE_BYTES,
  creditOf,
  freeUsedPct,
  hostingShares,
  hostingUseThisMonth,
  gameServerCpuSec,
  gameHostingMonth,
  monthStartDateOf,
  type PausedReason,
  NEARLY_USED_PCT,
  nextMonthStartDate,
  failedPlayerErases,
  requestCountThisMonth,
  ApiError,
  checkIdKind,
  isIdOf,
  playerProfile,
  reportedChatOf,
  secondsUntilDayPasses,
  type ErrorCode,
  MAXIMUM_REDIRECT_URL_COUNT,
  MAXIMUM_SIGN_IN_APP_COUNT,
  SIGN_IN_APP_KINDS,
  checkRedirectUrl,
  checkSignInAppName,
  createSignInApp,
  deleteSignInApp,
  redirectUrlsOf,
  signInAppById,
  signInAppsFor,
  updateSignInApp,
  type SignInApp,
  type SignInAppKind,
  MAXIMUM_WEBHOOK_COUNT,
  WEBHOOK_DESTINATION_KINDS,
  WEBHOOK_EVENT_KINDS,
  checkEndpointUrl,
  createWebhook,
  deleteWebhook,
  deliveriesFor,
  deliveryCountsFor,
  allowedHostsOf,
  ownServerUrlsOf,
  checkLinkSites,
  linkAudience,
  standingOf,
  STANDING_LIMITS,
  type Standing,
  linksOf,
  type GameLink,
  eventKindsOf,
  gameSlugsOf,
  updateWebhook,
  webhookById,
  webhooksFor,
  type Webhook,
  type WebhookDelivery,
  type WebhookDestinationKind,
  type WebhookEventKind,
  SAVE_LIMIT_BYTES,
  isSlugRetired,
  ISO_TIME,
  listRooms,
  MATCH_UPDATE_MODES,
  type MatchUpdateMode,
  checkShownText,
  titleNamesZaisma,
  type ShownTextOptions,
  hasThreads,
  ITEM_FIELDS,
  purchaseLabelFor,
  CREDIT_LIMITS,
  isCreditLow,
  type DoorContract,
  BodyPastCapError,
  MAXIMUM_RAW_BODY_SIZE_BYTES,
  NO_BODY_MAXIMUM_SIZE_BYTES,
  readBodyBytes,
  readBodyText,
  favoriteCount,
} from "@zaisma/core";
import { standingWords } from "./standing.ts";
import { bringBackGame, checkStoredSizeFits, deleteOwnGame, deleteOwnVersion, eraseGameNow, reserveOrRefuse, storageRoute } from "./storage-api.ts";
import { gameDeletionRequestAnswer } from "./game-deletion-requests.ts";
import { toneOfPicture } from "./background-tone.ts";
import { updateLiveMatches } from "./match-updates.ts";
import { CARD_IMAGE_HEIGHT_PX, CARD_IMAGE_WIDTH_PX, gameLinkUrl, roomCodeOf } from "./share-cards.ts";
import { connectionAddressOf, currentSession } from "./auth.ts";
import { gameUrl, type Env } from "./env.ts";
import { queueListingCheck } from "./listing-check.ts";
import { queueCompression } from "./compress.ts";
import { previewLinkToken } from "./preview-links.ts";
import { forumRoute, readableTopic } from "./forum.ts";
import { databaseRoute } from "./game-database.ts";
import { savesRoute } from "./saves-api.ts";
import { secretsRoute } from "./secrets-api.ts";
import { keptRoomsRoute } from "./kept-rooms-api.ts";
import { keptRoomRestoresRoute } from "./kept-room-restores-api.ts";
import { roomMessagesRoute, roomsRoute } from "./room-messages-api.ts";
import { checkSpendingConfirmed, creditRoute } from "./credit-api.ts";
import { creditPlanRoute } from "./credit-plan-api.ts";
import { proRoute } from "./pro-api.ts";
import { stripeAccountRoute } from "./stripe-account-api.ts";
import { clearPauses, pauseNow, resetsOnText } from "./hosting-job.ts";
import { itemsRoute, playerItemsRoute, purchaseSettingsRoute, purchasesRoute } from "./items-api.ts";
import { backgroundsAnswer, backgroundsRoute, serveShaderFile, shadersAnswer, shadersReadingTexture } from "./backgrounds-api.ts";
import { serveShaderCheckSheet } from "./shader-check.ts";
import { exportDownload, exportSummary } from "./game-export.ts";
import { logsFor } from "./logs-api.ts";
import { checkRoute } from "./check-api.ts";
import { apiKeysAnswer, dayText, foundWords } from "./leaked-keys.ts";
import { activityAnswer, gameHistoryAnswer, logCallerEvent, logDatabaseCall, logSavesCall, noteKeyUse } from "./security-log.ts";
import { playingNowAnswer } from "./live-world.ts";
import { playStats, playerPerformance, playingNowCounts } from "./plays.ts";
import { sendAlert } from "./email.ts";
import { KNOWN_IMAGE_ALERT, aiReviewSpeedFor, holdForPerson, imageMatcher, passVersionsHeldForGore, publishFacts, publishRouteOf, publishWithReview, pruneVersions, replaceWaitingVersions, requestAiReview, routePublish, usualAiReviewDurations, type PublishFacts } from "./scan.ts";
import { sendTestEvent, tellWebhooks, type PlayerReportRow, type WaitUntil } from "./webhooks.ts";
import { alertIfNoticeFixPublished } from "./notices.ts";

/**
 * The developer API: one API for the MCP, the upload command and the dashboard, so they always agree.
 * Callers sign in with an API key (Authorization: Bearer zsk_…) or, from our own pages, the session cookie.
 * Rows are stored with the names the API shows (docs/NAMING.md), so answers pass them through and only
 * change a value's form: times become ISO, 0 and 1 become false and true, stored JSON becomes objects.
 *
 *   GET    /api/dev/activity                   your account's activity in the last 90 days (a full key)
 *   GET    /api/dev/api-keys                   your API keys: what they can do, when they end, their last use and whether they were turned off (a full key)
 *   GET    /api/dev/games                      your games
 *   POST   /api/dev/games                      make a game (starts as a draft)
 *   GET    /api/dev/games/:slug                one game, with its images, backgrounds, shaders, versions and tester links
 *   PATCH  /api/dev/games/:slug                title, description, visibility, devices, controls, genres, screen_orientation, play_modes, cloud_saves_enabled, account_offer_enabled, deleted_account_erase_enabled, friend_joins_enabled, performance_measuring_enabled, room_browsing, multiplayer_mode, account_requirement, minimum_player_age_years, game_server_allowed_hosts, own_server_urls, links, glass_tint_color, demo_game_slug, full_game_item_name
 *   POST   /api/dev/games/:slug/images?kind=   add a cover, screenshot, background picture or shader texture (the image bytes as the body)
 *   DELETE /api/dev/games/:slug/images/:id     remove one
 *   POST   /api/dev/games/:slug/shaders        send a background shader: { screen, image, buffers } (see backgrounds-api.ts)
 *   POST   /api/dev/games/:slug/shader-checks  check a shader before sending it: the same body, answering its sheet and notes
 *   DELETE /api/dev/games/:slug/shaders/:id    remove one
 *   PUT    /api/dev/games/:slug/backgrounds/:screen   choose what wide or phone shows: { "source", "image_id", "shader_id" }
 *   POST   /api/dev/check                      check a game's files before uploading: what Zaisma would refuse and what won't work (see check-api.ts)
 *   POST   /api/dev/games/:slug/uploads        which of these files still need sending
 *   PUT    /api/dev/files/:sha256              send one file
 *   POST   /api/dev/games/:slug/versions       make a version from stored files (scanned, then a draft)
 *   GET    /api/dev/games/:slug/versions/:id   scan result, findings and preview link
 *   POST   /api/dev/games/:slug/versions/:id/publish   publish a draft or roll back; { "scheduled_publish_at" } publishes later
 *   DELETE /api/dev/games/:slug/versions/:id/publish   cancel a publish-later
 *   POST   /api/dev/games/:slug/versions/:id/ai-review  start a version's AI review without publishing it
 *   DELETE /api/dev/games/:slug/versions/:id   delete a version that isn't in use (storage-api.ts)
 *   DELETE /api/dev/games/:slug                delete the game for good: { "confirm_slug" } (storage-api.ts)
 *   GET    /api/dev/storage                    what the account stores and can store (storage-api.ts)
 *   PATCH  /api/dev/storage                    { "monthly_storage_budget_cents" } (storage-api.ts)
 *   DELETE /api/dev/games/:slug/versions/:id/preview-links   end every preview link handed out so far
 *   POST   /api/dev/files/:sha256/parts        send a big file in parts (see bigFile)
 *   GET    /api/dev/games/:slug/reports        what players reported, by reason
 *   GET    /api/dev/games/:slug/stats          plays, play time, players coming back and multiplayer use
 *   GET    /api/dev/games/:slug/history        what happened to the game, who did it and from where
 *   GET    /api/dev/games/:slug/logs           what its game server printed on Zaisma, last 30 days (see logs-api.ts)
 *   GET    /api/dev/games/:slug/testers        tester links that are on
 *   POST   /api/dev/games/:slug/testers        make a tester link: { "name", "version_choice", "picked_version_id", "ends_at" }
 *   PATCH  /api/dev/games/:slug/testers/:id    change its name, what it opens or its end date
 *   DELETE /api/dev/games/:slug/testers/:id    turn one off for good
 *   GET    /api/dev/games/:slug/database       the game database's tables, indexes and use this month (see game-database.ts)
 *   POST   /api/dev/games/:slug/database/query run one SQL statement: { "sql", "values" }
 *   POST   /api/dev/games/:slug/database/batch run several in one transaction: { "statements" }
 *   GET    /api/dev/games/:slug/database/export one part of the database's SQL dump: ?cursor=<next_cursor>
 *   POST   /api/dev/games/:slug/database/import one part of a SQL dump in: { "dump_sql" }
 *   POST   /api/dev/games/:slug/database/erase-player   erase one player's rows: { "player_id" }
 *   POST   /api/dev/games/:slug/database/restores       restore the database to a time: { "restore_to_at" }
 *   POST   /api/dev/games/:slug/database/restores/:database_restore_id/undo   undo a restore
 *   …/api/dev/games/:slug/saves                the game's cloud saves by player ID: list, read, change, reset, earlier versions (see saves-api.ts)
 *   GET    /api/dev/games/:slug/qr-code        the game's link, or a room's (?room_code=), as a QR code (SVG)
 *   GET    /api/dev/games/:slug/secrets        the game's secrets' names, never their values (see secrets-api.ts)
 *   GET    /api/dev/games/:slug/export         what an export of everything holds, and the link to it (see game-export.ts)
 *   GET    /api/dev/games/:slug/export/download   the .zip of everything about the game
 *   PUT    /api/dev/games/:slug/secrets/:name  set one: { "secret_value" }
 *   DELETE /api/dev/games/:slug/secrets/:name  delete one
 *   GET    /api/dev/games/:slug/kept-rooms     the game's kept rooms and its storage (see kept-rooms-api.ts)
 *   …/api/dev/games/:slug/items                what the game sells or grants: set and remove items (see items-api.ts)
 *   PATCH  /api/dev/games/:slug/purchase-settings   refund_policy, refund_policy_text, own_payment_categories, purchase_delivery
 *   …/api/dev/games/:slug/purchases            purchases and grants with their receipts: list, get, grant, refund, mark handled (see items-api.ts)
 *   GET    /api/dev/games/:slug/players/:player_id/items   the permanent items a player owns, and their purchases still to hand over
 *   DELETE /api/dev/games/:slug/kept-rooms/:room_code   delete one's world: players are sent out, and it waits a week
 *   POST   /api/dev/games/:slug/kept-rooms/:room_code/bring-back   bring a waiting world back
 *   POST   /api/dev/games/:slug/kept-rooms/:room_code/erase-now    erase a waiting world at once, with a passkey tap
 *   GET    /api/dev/games/:slug/kept-rooms/:room_code/restores     what a world can go back to, and its restores (kept-room-restores-api.ts)
 *   POST   /api/dev/games/:slug/kept-rooms/:room_code/restores     a world back to a time: { "restore_to_at" }
 *   POST   /api/dev/games/:slug/kept-rooms/:room_code/restores/:kept_room_restore_id/undo   undo a world's restore
 *   POST   /api/dev/games/:slug/kept-room-restores                 every world back to a time: { "restore_to_at" }
 *   GET    /api/dev/games/:slug/kept-room-restores/:kept_room_restore_batch_id        how that went
 *   POST   /api/dev/games/:slug/kept-room-restores/:kept_room_restore_batch_id/undo   undo it
 *   GET    /api/dev/games/:slug/rooms          the game's live rooms, and one with who's in it (see room-messages-api.ts)
 *   POST   /api/dev/games/:slug/rooms/:room_code/messages|kick|end   a room message to one, remove a player, end it
 *   POST   /api/dev/games/:slug/room-messages  a room message to every room, now or at send_at; GET lists the scheduled, DELETE cancels one
 *   GET    /api/dev/sign-in-apps               your sign-in apps (Sign in with Zaisma, see sign-in.ts)
 *   POST   /api/dev/sign-in-apps               make one: { "name", "kind", "redirect_urls" }; a confidential app's client_secret is answered once
 *   PATCH  /api/dev/sign-in-apps/:id           name, redirect_urls, or replace_client_secret: true
 *   DELETE /api/dev/sign-in-apps/:id           delete one, with every player's yes to it
 *   GET    /api/dev/webhooks                   your webhooks (see webhooks.ts)
 *   POST   /api/dev/webhooks                   make one: { "destination_kind", "endpoint_url", "event_kinds", "game_slugs" }; its signing_secret is answered once
 *   PATCH  /api/dev/webhooks/:id               destination_kind, endpoint_url, event_kinds, game_slugs, or replace_signing_secret: true
 *   DELETE /api/dev/webhooks/:id               delete one, with what was on its way to it
 *   POST   /api/dev/webhooks/:id/test          send it a test event now, and say how it went
 *   GET    /api/dev/webhooks/:id/deliveries    what was sent to it in the last 30 days, and how each went
 *   …/api/dev/forum                            the developer forum: topics, replies, Me too (see forum.ts)
 *
 * API_ROUTES, above route(), is the full list the router answers; keep this one in step with it.
 *
 * Every refusal answers { "error": { code, message, field, fix, retry_after_sec } }, its code from
 * ERROR_CODES (@zaisma/core), and every call that changes something answers with next_steps
 * (docs/NAMING.md), except the steps of sending files, whose next call is always the one that uses them.
 *
 * Until the beta, the calls that make a game, send its files, make a version or publish one answer
 * publishing_not_open for accounts Zaisma hasn't added (isPublishing, set on /admin/publishing).
 *
 * Images are served from /img/:id once approved, and shaders' sources, stills and frames from /shaders/:id/…; owners can see their own before that.
 * A shader check's sheet is at /shader-checks/<name>.png for a day, for anyone with its link.
 */

export interface Caller {
  accountId: string;
  ownerId: string;
  actor: string;
  cookies: string[];
  /** How the call came in: an API key, the MCP (an AI, always) or our own pages (the developer). */
  via: "api" | "mcp" | "dashboard";
  /** What the caller says it is (X-Zaisma-Client), like "cli". Only for labels; never trusted for anything else. */
  client?: string;
  /** Keeps work going after the answer (the Worker's ctx.waitUntil), like sending webhook events; without it, that work is waited for. */
  waitUntil?: WaitUntil;
  /** What the caller may do: its API key's access, or everything from our own pages. */
  access: KeyAccess;
  /** Where the call came from, for the security log. */
  where: RequestWhere;
  /** Whether the account keeps where it's used from (accounts.where_used_from_enabled): off, events have no device, network or place. */
  isWhereKept: boolean;
  /** The fingerprint of the network and country a key's call came from, or null (no key, or no network or country). */
  placeSha256: string | null;
  /** Whether the account may make, upload and publish games (accounts.can_publish): until the beta, only accounts Zaisma adds. */
  canPublish: boolean;
  /** How far Zaisma banned the account (bans.ts), when, and the why the developer reads (null for child safety); banScope null when it isn't banned. */
  banScope: BanScope | null;
  bannedAtMs: number | null;
  banReasonForDeveloper: string | null;
  /** Our own page, with the developer's passkey tapped in the last 10 minutes: may turn spending on or up (credit-api.ts), connect a Stripe account for sales (stripe-account-api.ts) and delete a game other people played (storage-api.ts). */
  isPasskeyConfirmed?: boolean;
}

/** A call that usually follows a change, ready to make (docs/NAMING.md, Next steps). */
export interface NextStep {
  /** The MCP tool's name. */
  tool: string;
  /** What to send it, filled in as far as Zaisma knows. */
  arguments: Record<string, unknown>;
  after_sec: number | null;
  reason: string;
}

const json = (body: unknown, httpStatus = 200, cookies: string[] = []) => {
  const response = Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
  for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
  return response;
};

/** An error as the API answers it, with Retry-After when waiting helps. */
export function errorResponse(error: ApiError): Response {
  const response = json(error.toAnswer(), error.httpStatus);
  if (error.retryAfterSec !== null) response.headers.set("Retry-After", String(error.retryAfterSec));
  return response;
}

/** Our own failure, as an error answer: the caller can tell it isn't their mistake, and what to do. */
export const INTERNAL_ERROR = () =>
  new ApiError("internal_error", {
    message: "Something went wrong on Zaisma's side.",
    fix: "Try once more. If it happens again, tell Zaisma with post_topic (kind bug, category api or mcp): the call, what you sent and this error.",
  });

export async function handleDeveloper(request: Request, env: Env, path: string, ctx?: ExecutionContext): Promise<Response | null> {
  if (path.startsWith("/img/")) return serveImage(request, env, path.slice(5));
  if (path.startsWith("/shaders/")) return serveShaderFile(request, env, path.slice(9), (gameOwnerId) => isOwnerSignedIn(request, env, gameOwnerId));
  if (path.startsWith("/shader-checks/")) return serveShaderCheckSheet(request, env, path.slice("/shader-checks/".length));
  if (path !== "/api/dev" && !path.startsWith("/api/dev/")) return null;
  try {
    const caller = await authenticate(request, env, "api", ctx ? (promise) => ctx.waitUntil(promise) : undefined);
    return await route(request, env, path.slice("/api/dev".length) || "/", caller);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    console.error("Developer API call failed", error);
    return errorResponse(INTERNAL_ERROR());
  }
}

/** waitUntil: the Worker's ctx.waitUntil, set on the caller before the key's use is noted, so its security alerts run after the answer. */
export async function authenticate(request: Request, env: Env, via: "api" | "mcp" = "api", waitUntil?: WaitUntil): Promise<Caller> {
  // Before a key is read, an address counts, at the level a whole building clears (docs/DOORS.md).
  if (await isPastLevel(env, "building", "api_address", connectionAddressOf(request) ?? "unknown")) {
    throw new ApiError("slow_down", { message: "Too many calls from this address in the last minute.", fix: "Wait a minute, then carry on.", retryAfterSec: 60 });
  }
  const header = request.headers.get("authorization");
  let accountId: string | null = null;
  let cookies: string[] = [];
  let access = FULL_ACCESS;
  let usedKey: NonNullable<Awaited<ReturnType<typeof apiKeyForToken>>>["key"] | null = null;
  if (header) {
    const token = header.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
    // A connected app's token is bound to the MCP it asked for (RFC 8707); the REST API is for keys.
    if (via === "api" && token.startsWith("zat_")) {
      throw new ApiError("token_not_for_api", { message: "This token is a connected app's and works only at zaisma.com/mcp.", field: "Authorization", fix: "Call the REST API with an API key made on Developer settings (zaisma.com/dashboard/settings, under Keys)." });
    }
    const found = await apiKeyForToken(env.DB, token);
    const key = found?.key ?? null;
    // A whole-account ban turns its keys off with no place found (bans.ts).
    if (found?.keyState === "turned_off" && found.key.found_in === null) throw accountBanned({ banScope: "whole_account", banReasonForDeveloper: null });
    if (found?.keyState === "turned_off") {
      throw new ApiError("key_turned_off", {
        message: `This API key was ${foundWords(found.key)} and turned off on ${dayText(found.key.turned_off_at_ms!)}, so it can't be used again.`,
        field: "Authorization",
        fix: "Make a new key on zaisma.com/dashboard/settings (under Keys), and keep it out of code you share: use ZAISMA_KEY or your AI tool's settings.",
      });
    }
    if (found?.keyState === "token_ended") {
      throw new ApiError("access_token_ended", {
        message: "This connected app's access token is past its hour.",
        field: "Authorization",
        fix: "Your AI app refreshes it by itself. If it keeps failing, remove Zaisma in the app's connector settings and add it again.",
      });
    }
    if (found?.keyState === "ended") {
      throw new ApiError("key_ended", { message: `This API key's end date was ${dayText(found.key.ends_at_ms!)}.`, field: "Authorization", fix: "Make a new key on zaisma.com/dashboard/settings (under Keys)." });
    }
    accountId = key?.account_id ?? null;
    if (key) access = keyAccess(key);
    usedKey = key;
    if (!accountId) throw new ApiError("bad_key", { message: "That API key isn't valid: it was removed, mistyped or never made.", field: "Authorization", fix: "Make a new key on zaisma.com/dashboard/settings (under Keys) and send it as: Authorization: Bearer zsk_…" });
  } else {
    // From our own pages only: other sites can't use a signed-in player's cookie.
    if (request.method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin) {
      throw new ApiError("bad_origin", { message: "A call with a session came from another site.", fix: "Call from zaisma.com, or send an API key as: Authorization: Bearer zsk_…" });
    }
    const session = await currentSession(request, env);
    if (!session) throw new ApiError("signed_out", { message: "There's no API key and no signed-in session.", field: "Authorization", fix: "Send an API key from zaisma.com/dashboard/settings as: Authorization: Bearer zsk_…" });
    accountId = session.userId;
    cookies = session.cookies;
  }
  // Every call's limit, before anything else about it is read: its row's level (DoorLimit), by the account. A row with its own, like an export's, keeps this too.
  const isFiles = new URL(request.url).pathname.startsWith("/api/dev/files/");
  if (await isPastLevel(env, isFiles ? "building" : "busy", isFiles ? "api_files" : "api", accountId)) {
    throw new ApiError("slow_down", { message: "Too many calls in the last minute.", fix: "Wait a minute, then carry on; up to 120 calls a minute (1,000 for sending files).", retryAfterSec: 60 });
  }
  const caller = await callerFor(env, request, accountId, cookies);
  if (!caller) throw new ApiError("no_account", { message: "The account isn't finished yet.", fix: "Finish making it at zaisma.com/account, then call again." });
  caller.access = access;
  if (waitUntil) caller.waitUntil = waitUntil;
  if (header) {
    caller.via = via;
    caller.where = whereFrom(request.cf as Parameters<typeof whereFrom>[0], request.headers.get("user-agent") ?? "", via === "mcp" ? "ai" : "api_key", connectionAddressOf(request));
    // Before the router's checks, so a call it refuses still records the key's use, like last_used_at_ms.
    if (usedKey) caller.placeSha256 = await noteKeyUse(request, env, usedKey, caller);
  }
  const client = request.headers.get("x-zaisma-client");
  if (client) caller.client = client.slice(0, 20);
  return caller;
}

/** The caller for a signed-in account, or null when the account isn't finished. */
export async function callerFor(env: Env, request: Request, accountId: string, cookies: string[] = []): Promise<Caller | null> {
  const account = await accountById(env.DB, accountId);
  if (!account) return null;
  const owner = await personOwner(env.DB, accountId);
  return {
    accountId,
    ownerId: owner.id,
    actor: `account:${accountId}`,
    cookies,
    via: "dashboard",
    access: FULL_ACCESS,
    where: whereFrom(request.cf as Parameters<typeof whereFrom>[0], request.headers.get("user-agent") ?? "", "you", connectionAddressOf(request)),
    isWhereKept: account.where_used_from_enabled === 1,
    placeSha256: null,
    canPublish: account.can_publish === 1,
    banScope: banScopeOf(account),
    bannedAtMs: account.banned_at_ms,
    banReasonForDeveloper: account.ban_content_rule === "child_safety" ? null : account.ban_reason,
  };
}

/** What a banned developer can still call: get_access, list_games and export_game, so their work stays theirs. */
export const BANNED_DEVELOPER_ROUTES = new Set(["GET /access", "GET /games", "GET /games/:slug/export", "GET /games/:slug/export/download"]);

/** The account_banned refusal: why, unless it's child safety; a whole-account ban says the account is closed. */
export function accountBanned(caller: Pick<Caller, "banScope" | "banReasonForDeveloper">): ApiError {
  if (caller.banScope === "whole_account") {
    return new ApiError("account_banned", {
      message: "Zaisma closed this account for breaking its rules.",
      messageForPeople: "This account is closed for breaking Zaisma's rules.",
      fix: "Tell the developer. Nothing works for this account now; to appeal, they write to safety@zaisma.com with the username.",
    });
  }
  const words = caller.banReasonForDeveloper ? `Zaisma banned this account's developer side for breaking the content rules: ${caller.banReasonForDeveloper.replace(/\.$/, "")}.` : "Zaisma banned this account's developer side for breaking Zaisma's rules.";
  return new ApiError("account_banned", { message: words, messageForPeople: words, fix: "Tell the developer. Only get_access, list_games and export_game work now; to appeal, they write to safety@zaisma.com with the username." });
}

/** Call the API from inside the site as this caller, and answer its response as it is: for a call that answers bytes, like an export's .zip. */
export async function apiResponse(env: Env, caller: Caller, path: string): Promise<Response> {
  return route(new Request(`${env.SITE_ORIGIN}/api/dev${path}`), env, path.split("?")[0]!, caller);
}

/**
 * Call the API from inside the site (the MCP and the dashboard), as this caller. Answers the JSON;
 * refusals throw ApiError with the same codes and messages API callers get.
 */
export async function apiCall(env: Env, caller: Caller, method: string, path: string, payload?: unknown): Promise<Record<string, unknown>> {
  const isRaw = payload instanceof Uint8Array;
  const body = isRaw ? payload : payload === undefined ? undefined : new TextEncoder().encode(JSON.stringify(payload));
  const request = new Request(`${env.SITE_ORIGIN}/api/dev${path}`, {
    method,
    headers: { ...(body ? { "content-length": String(body.byteLength) } : {}), ...(body && !isRaw ? { "content-type": "application/json" } : {}) },
    body,
  });
  const response = await route(request, env, path.split("?")[0]!, caller);
  return (await response.json()) as Record<string, unknown>;
}

/**
 * What a call's path reaches (docs/DECISIONS.md, "Access checks in the router"): one of the caller's
 * games (by its slug), a player's save in one, one of their webhooks or sign-in apps, a forum topic they
 * can see, their account as a whole, or nothing private (public profiles, the key's own access).
 */
export type ApiReach = "game" | "player_save" | "webhook" | "sign_in_app" | "forum_topic" | "account" | "nothing_private";

/** What one :part of a path names. The router loads and checks the first four before the call runs. */
export type ApiPathPart =
  /** One of the caller's games, by its slug, and one the key reaches. */
  | "game"
  /** One of the caller's webhooks. */
  | "webhook"
  /** One of the caller's sign-in apps. */
  | "sign_in_app"
  /** A forum topic the caller can see: public and checked, or their own. */
  | "forum_topic"
  /** Something of the path's game (an image, version, tester link, secret, player's save or earlier copy): the call finds it in that game alone. */
  | "in_game"
  /** A post or image in the path's topic: the call finds it there alone, and only if the caller can see it. */
  | "in_forum_topic"
  /** A file the caller sends, by its SHA-256, which storage checks; a big file is kept for the caller alone. */
  | "file_hash"
  /** A value the call checks, like a part number or a public profile's player ID. */
  | "plain";

/** What one input in the body or the query is. */
export type ApiInput =
  /** Its shape is API_INPUT_SHAPES' for its name, and the call checks the rest of its value. */
  | { kind: "plain" }
  /** Does a higher choice's work, so it needs that choice too whenever it's sent as anything but false or null; withoutIt says what happens when it's left out. */
  | { kind: "needs"; area: AccessArea; choice: string; withoutIt: string }
  /** Names something the caller must own: one of their games by its slug, a list of them (null for every game), files stored for them, or a forum topic they can see. */
  | { kind: "names"; what: "game" | "game_list" | "files" | "forum_topic" };

/** What a call answers: the outputSchema of the tool that makes it, or its own. */
export type ApiAnswer = { toolName: string } | DoorAnswer;

/** A call's body: a JSON object with only these inputs, up to maximumSizeBytes (64 KB if not said), or raw bytes (an image or a file) the call reads itself. */
export type ApiBody = { inputs: Record<string, ApiInput>; maximumSizeBytes?: number; isOptional?: true } | "bytes";

/**
 * One developer API call: its method, its path under /api/dev, where :name stands for one path part, what
 * the path reaches, what an API key needs for it (at least `choice` in `area`, AREA_ACCESS_CHOICES, or area
 * null when any key can make it), what each path part names, and every input it takes in the query and the
 * body. The router checks all of it before any of the call's own code runs (checkCall).
 */
export interface ApiRoute {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  reaches: ApiReach;
  area: AccessArea | null;
  choice: string;
  /** More areas it reads besides `area`, each with the choice it needs: an export reads them all. */
  alsoNeeds: { area: AccessArea; choice: string }[];
  pathParts: Record<string, ApiPathPart>;
  query: Record<string, ApiInput>;
  /** null: the call takes no body, and none is read. */
  body: ApiBody | null;
  /** It acts for the whole account (it makes a game), so a key limited to some games can't make it. */
  isAccountWide: boolean;
  /** Reads where the account is used from, so only a full key for every game makes it. */
  isFullKeyOnly: boolean;
  /** It makes a game, sends its files, makes a version or publishes one, so until the beta only accounts Zaisma adds can call it. */
  isPublishing: boolean;
  answers: ApiAnswer;
  limit: DoorLimit;
}

/** The :names in a path, so a call that leaves one undeclared doesn't type-check. */
type PathPartName<Path extends string> = Path extends `${string}:${infer Name}/${infer Rest}` ? Name | PathPartName<Rest> : Path extends `${string}:${infer Name}` ? Name : never;

type ApiRouteDeclaration<Path extends string> = {
  method: ApiRoute["method"];
  path: Path;
  /** What it answers: required, so a call that doesn't say doesn't type-check. */
  answers: ApiAnswer;
  limit?: DoorLimit;
  reaches: ApiReach;
  access: { area: AccessArea | null; choice: string };
  alsoNeeds?: { area: AccessArea; choice: string }[];
  query?: Record<string, ApiInput>;
  body?: ApiBody;
  isAccountWide?: true;
  isFullKeyOnly?: true;
  isPublishing?: true;
} & ([PathPartName<Path>] extends [never] ? { pathParts?: undefined } : { pathParts: Record<PathPartName<Path>, ApiPathPart> });

const call = <Path extends string>({ access, ...declaration }: ApiRouteDeclaration<Path>): ApiRoute => ({
  pathParts: {},
  alsoNeeds: [],
  query: {},
  body: null,
  isAccountWide: false,
  isFullKeyOnly: false,
  isPublishing: false,
  // Sending a game's files is many small requests, so it has its own, bigger allowance.
  limit: declaration.path.startsWith("/files/") ? { level: "building", counts: "account", group: "api_files" } : { level: "busy", counts: "account", group: "api" },
  ...declaration,
  ...access,
});

const anyKey = { area: null, choice: "" } as const;
const needs = <Area extends AccessArea>(area: Area, choice: (typeof AREA_ACCESS_CHOICES)[Area][number]) => ({ area, choice });
const plain = { kind: "plain" } as const satisfies ApiInput;
const plainInputs = (...names: readonly ApiInputName[]): Record<string, ApiInput> => Object.fromEntries(names.map((name) => [name, plain]));
/** What a call answers: a tool's outputSchema, since a tool's answer is its call's, or a schema or kind of its own. */
const fromTool = (toolName: string): ApiAnswer => ({ toolName });
const fieldsAnswer = (...names: readonly string[]): ApiAnswer => answersJson({ anyOf: [{ type: "object", properties: Object.fromEntries(names.map((name) => [name, {}])), required: [], additionalProperties: false }, ERROR] });
const needsToo = <Area extends AccessArea>(area: Area, choice: (typeof AREA_ACCESS_CHOICES)[Area][number], withoutIt: string): ApiInput => ({ kind: "needs", area, choice, withoutIt });
const naming = (what: "game" | "game_list" | "files" | "forum_topic"): ApiInput => ({ kind: "names", what });

/** What a tester link opens and until when, besides its name. */
const TESTER_LINK_INPUTS = ["version_choice", "picked_version_id", "ends_at"] as const;
const GAME_DETAIL_INPUTS = ["title", "description", "devices", "controls", "genres", "screen_orientation", "play_modes", "cloud_saves_enabled", "account_offer_enabled", "deleted_account_erase_enabled", "friend_joins_enabled", "performance_measuring_enabled", "multiplayer_mode", "room_browsing", "account_requirement", "minimum_player_age_years", "game_server_allowed_hosts", "own_server_urls", "links", "glass_tint_color"] as const;
const FORUM_POST_INPUTS = ["text_markdown", "debug_context", "author_kind", "images_base64"] as const;
/** Posts carry their images inline as base64, so they can be big. */
const MAXIMUM_FORUM_POST_BODY_SIZE_BYTES = 72 * 1024 * 1024;
/** Values up to 1 MB each, up to 100 statements: the body can be big, but not unbounded. */
const MAXIMUM_DATABASE_BODY_SIZE_BYTES = 6 * 1024 * 1024;
/** A part of a dump is up to 5 MB; in JSON its quotes and line breaks take a little more. */
const MAXIMUM_IMPORT_BODY_SIZE_BYTES = 8 * 1024 * 1024;
/** A whole save is up to 5 MB, and JSON can take up to twice that to write it out. */
const MAXIMUM_SAVE_BODY_SIZE_BYTES = SAVE_LIMIT_BYTES * 2 + 64 * 1024;
/** The check takes a game's HTML, JavaScript and CSS as text, and only the path and size of every other file. */
const MAXIMUM_CHECK_BODY_SIZE_BYTES = 8 * 1024 * 1024;
const atGame = { slug: "game" } as const;
/** A shader as add_shader and check_shader send it (backgrounds-api.ts). */
const SHADER_INPUTS = ["screen", "image", "buffers"] as const;
/** Five passes of up to 64 KB each, with room for JSON's escapes. */
const MAXIMUM_SHADER_BODY_SIZE_BYTES = (1 + SHADER_LIMITS.maximumBufferCount) * SHADER_LIMITS.maximumPassSizeBytes * 2 + 64 * 1024;

/** Any game's title, name or line of text is at most this: the outer wall, inside which a call says what it allows with its own fix. */
const WALL_TEXT = text(16 * 1024);
const SLUG_INPUT = text(200);
const ID_INPUT = text(200);
const URL_INPUT = text(4000);
const TIME_INPUT = text(100);
const LIST_OF_WORDS = listOf(text(100), 100);
/** A number: whole or not, and how big, is the call's to say with its own fix. */
const COUNT_INPUT = realNumber(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
const nullable = orNothing;
/**
 * Every input's shape, by its name: a name means one thing in every call (docs/NAMING.md), and a name with no shape here
 * doesn't type-check, so "accepts anything" can't be written. Each is the outer wall: type, size and closed fields, with
 * what a call allows inside it still the call's to say. A query's values read as these too.
 */
export const API_INPUT_SHAPES = {
  account_offer_enabled: yesOrNo,
  account_requirement: WALL_TEXT,
  amount_cents: COUNT_INPUT,
  amount_minor_units: COUNT_INPUT,
  answer_post_id: nullable(ID_INPUT),
  author_kind: WALL_TEXT,
  buffers: listOf(gameData(MAXIMUM_SHADER_BODY_SIZE_BYTES), 100),
  category: nullable(WALL_TEXT),
  cloud_saves_enabled: yesOrNo,
  confirm: yesOrNo,
  confirm_slug: SLUG_INPUT,
  controls: nullable(LIST_OF_WORDS),
  currency_code: nullable(text(40)),
  cursor: nullable(text(4000)),
  debug_context: nullable(fieldsOf({ call: text(4000), error_code: text(4000), error_message: text(8000), request_json: text(16000), notes: text(8000) })),
  deleted_account_erase_enabled: yesOrNo,
  demo_game_slug: nullable(SLUG_INPUT),
  description: nullable(WALL_TEXT),
  destination_kind: WALL_TEXT,
  detail: WALL_TEXT,
  details: nullable(WALL_TEXT),
  devices: nullable(LIST_OF_WORDS),
  dump_sql: text(MAXIMUM_IMPORT_BODY_SIZE_BYTES),
  endpoint_url: nullable(URL_INPUT),
  ends_at: nullable(TIME_INPUT),
  event_kinds: LIST_OF_WORDS,
  files: listOf(gameData(MAXIMUM_CHECK_BODY_SIZE_BYTES), 100_000),
  friend_joins_enabled: yesOrNo,
  full_game_item_name: nullable(ID_INPUT),
  game_account_id: nullable(text(1000)),
  game_server_allowed_hosts: nullable(listOf(text(1000), 100)),
  game_slug: nullable(SLUG_INPUT),
  game_slugs: nullable(listOf(SLUG_INPUT, MAXIMUM_GAME_COUNT_PER_OWNER)),
  genres: nullable(LIST_OF_WORDS),
  glass_tint_color: nullable(text(40)),
  image: gameData(MAXIMUM_SHADER_BODY_SIZE_BYTES),
  image_id: nullable(ID_INPUT),
  images_base64: listOf(text(MAXIMUM_FORUM_POST_BODY_SIZE_BYTES), 100),
  indexeddb_databases: gameData(MAXIMUM_SAVE_BODY_SIZE_BYTES),
  is_answered: yesOrNo,
  is_big_update: yesOrNo,
  is_kept_out: yesOrNo,
  is_on_game_page: yesOrNo,
  is_public: yesOrNo,
  is_stripe_tax_used: yesOrNo,
  item_category: WALL_TEXT,
  item_count: COUNT_INPUT,
  item_kind: WALL_TEXT,
  item_name: ID_INPUT,
  keys: anyOf(text(MAXIMUM_SAVE_BODY_SIZE_BYTES), listOf(text(4000), 1000)),
  kind: WALL_TEXT,
  known_issue_topic_id: nullable(ID_INPUT),
  labels: anyOf(text(4000), listOf(gameData(4096), 100), gameData(4096)),
  links: nullable(listOf(gameData(8192), 100)),
  local_prices: nullable(listOf(gameData(1024), 1000)),
  local_storage_items: gameData(MAXIMUM_SAVE_BODY_SIZE_BYTES),
  match_update_mode: WALL_TEXT,
  maximum_line_count: COUNT_INPUT,
  maximum_topic_count: COUNT_INPUT,
  message: gameData(256 * 1024),
  minimum_level: WALL_TEXT,
  minimum_player_age_years: nullable(COUNT_INPUT),
  monthly_budget_cents: nullable(COUNT_INPUT),
  monthly_storage_budget_cents: nullable(COUNT_INPUT),
  multiplayer_mode: WALL_TEXT,
  name: nullable(WALL_TEXT),
  name_prefix: WALL_TEXT,
  new_lines_cursor: nullable(text(4000)),
  own_payment_categories: LIST_OF_WORDS,
  own_server_urls: nullable(listOf(URL_INPUT, 100)),
  parts: listOf(gameData(4096), 100_000),
  patch_notes: nullable(WALL_TEXT),
  performance_measuring_enabled: yesOrNo,
  period_duration_days: COUNT_INPUT,
  picked_version_id: nullable(ID_INPUT),
  play_modes: nullable(listOf(gameData(4096), 100)),
  player_id: ID_INPUT,
  post_selection: WALL_TEXT,
  price_minor_units: nullable(COUNT_INPUT),
  publish_after_ai_review_enabled: yesOrNo,
  publish_when_approved: yesOrNo,
  purchase_delivery: WALL_TEXT,
  purchase_source: WALL_TEXT,
  purchase_status: WALL_TEXT,
  rating: nullable(WALL_TEXT),
  reason: nullable(WALL_TEXT),
  redirect_urls: nullable(listOf(URL_INPUT, 100)),
  refill_level_cents: COUNT_INPUT,
  refund_policy: nullable(WALL_TEXT),
  refund_policy_text: nullable(WALL_TEXT),
  reopen: yesOrNo,
  replace_client_secret: yesOrNo,
  replace_signing_secret: yesOrNo,
  reply_to_post_id: nullable(ID_INPUT),
  restore_to_at: TIME_INPUT,
  room_browsing: WALL_TEXT,
  room_code: nullable(text(40)),
  scheduled_publish_at: nullable(TIME_INPUT),
  screen: nullable(WALL_TEXT),
  screen_orientation: nullable(WALL_TEXT),
  search_text: WALL_TEXT,
  secret_value: text(256 * 1024),
  section: nullable(WALL_TEXT),
  send_at: nullable(TIME_INPUT),
  shader_id: nullable(ID_INPUT),
  size_bytes: COUNT_INPUT,
  slug: nullable(SLUG_INPUT),
  source: WALL_TEXT,
  source_kind: WALL_TEXT,
  sql: text(MAXIMUM_DATABASE_BODY_SIZE_BYTES),
  statements: listOf(gameData(MAXIMUM_DATABASE_BODY_SIZE_BYTES), 10_000),
  tab: WALL_TEXT,
  tag: WALL_TEXT,
  tags: nullable(LIST_OF_WORDS),
  text_markdown: text(MAXIMUM_FORUM_POST_BODY_SIZE_BYTES),
  title: nullable(WALL_TEXT),
  top_up_id: ID_INPUT,
  topic_id: ID_INPUT,
  topic_status: WALL_TEXT,
  upload_id: text(4000),
  values: listOf(gameData(MAXIMUM_DATABASE_BODY_SIZE_BYTES), 10_000),
  version_choice: WALL_TEXT,
  visibility: WALL_TEXT,
} as const satisfies Readonly<Record<string, DoorShape>>;
export type ApiInputName = keyof typeof API_INPUT_SHAPES;

/** Everything an export reads besides the game itself: read keys have all of it (game-export.ts). */
const EXPORT_ACCESS = [needs("version_access", "read"), needs("stats_access", "read"), needs("database_access", "read"), needs("save_access", "read")];

/**
 * Every developer API call. The router answers only these (anything else is not_found or bad_method),
 * so this is the API as it is; test/site/api-mcp-parity.test.ts holds it to the MCP's tools, and
 * test/site/access-checks.test.ts calls each one as a stranger and with every key that's too weak.
 */
export const API_ROUTES: readonly ApiRoute[] = [
  call({ method: "GET", path: "/access", answers: fromTool("get_access"), reaches: "nothing_private", access: anyKey }),
  call({ method: "GET", path: "/playing-now", answers: fromTool("get_playing_now"), reaches: "nothing_private", access: anyKey }),
  call({ method: "GET", path: "/activity", answers: fromTool("get_activity"), reaches: "account", access: anyKey, isAccountWide: true, isFullKeyOnly: true, query: plainInputs("cursor") }),
  call({ method: "GET", path: "/api-keys", answers: fromTool("list_api_keys"), reaches: "account", access: anyKey, isAccountWide: true, isFullKeyOnly: true }),
  call({ method: "GET", path: "/storage", answers: fromTool("get_storage"), reaches: "account", access: anyKey }),
  call({ method: "PATCH", path: "/storage", answers: fromTool("set_storage_budget"), reaches: "account", access: needs("credit_access", "write"), isAccountWide: true, body: { inputs: plainInputs("monthly_storage_budget_cents") } }),
  call({ method: "GET", path: "/games", answers: fromTool("list_games"), reaches: "account", access: needs("game_access", "read") }),
  call({ method: "POST", path: "/games", answers: fromTool("create_game"), reaches: "account", access: needs("game_access", "write"), isAccountWide: true, isPublishing: true, body: { inputs: plainInputs("slug", ...GAME_DETAIL_INPUTS) } }),
  call({ method: "GET", path: "/games/:slug", answers: fromTool("get_game"), reaches: "game", access: needs("game_access", "read"), pathParts: atGame }),
  call({ method: "DELETE", path: "/games/:slug", answers: fromTool("delete_game"), reaches: "game", access: needs("game_access", "write"), pathParts: atGame, body: { inputs: plainInputs("confirm_slug") } }),
  call({ method: "POST", path: "/games/:slug/bring-back", answers: fromTool("bring_back_game"), reaches: "game", access: needs("game_access", "write"), pathParts: atGame }),
  call({ method: "POST", path: "/games/:slug/erase-now", answers: fromTool("erase_game_now"), reaches: "game", access: needs("game_access", "write"), pathParts: atGame, body: { inputs: plainInputs("confirm_slug") } }),
  call({ method: "GET", path: "/games/:slug/deletion-requests/:game_deletion_request_id", answers: fromTool("get_game_deletion_request"), reaches: "game", access: needs("game_access", "read"), pathParts: { ...atGame, game_deletion_request_id: "plain" } }),
  call({ method: "PATCH", path: "/games/:slug", answers: fromTool("update_game"), reaches: "game", access: needs("game_access", "write"), pathParts: atGame, body: { inputs: { ...plainInputs("visibility", "demo_game_slug", ...GAME_DETAIL_INPUTS), monthly_budget_cents: needsToo("credit_access", "write", "the game's budget stays as it is"), full_game_item_name: needsToo("purchase_access", "write", "the game's price to play stays as it is") } } }),
  call({ method: "POST", path: "/games/:slug/images", answers: fromTool("add_image"), reaches: "game", access: needs("game_access", "write"), pathParts: atGame, query: plainInputs("kind"), body: "bytes" }),
  call({ method: "DELETE", path: "/games/:slug/images/:image_id", answers: fromTool("remove_image"), reaches: "game", access: needs("game_access", "write"), pathParts: { slug: "game", image_id: "in_game" } }),
  call({ method: "POST", path: "/games/:slug/shaders", answers: fromTool("add_shader"), reaches: "game", access: needs("game_access", "write"), pathParts: atGame, body: { inputs: plainInputs(...SHADER_INPUTS), maximumSizeBytes: MAXIMUM_SHADER_BODY_SIZE_BYTES } }),
  // The same shader, drawn and measured before it's sent: it changes nothing of the game's, but takes from the developer's day of checks.
  call({ method: "POST", path: "/games/:slug/shader-checks", answers: fromTool("check_shader"), reaches: "game", access: needs("game_access", "write"), pathParts: atGame, body: { inputs: plainInputs(...SHADER_INPUTS), maximumSizeBytes: MAXIMUM_SHADER_BODY_SIZE_BYTES } }),
  call({ method: "DELETE", path: "/games/:slug/shaders/:shader_id", answers: fromTool("remove_shader"), reaches: "game", access: needs("game_access", "write"), pathParts: { slug: "game", shader_id: "in_game" } }),
  call({ method: "PUT", path: "/games/:slug/backgrounds/:screen", answers: fromTool("set_background"), reaches: "game", access: needs("game_access", "write"), pathParts: { slug: "game", screen: "plain" }, body: { inputs: plainInputs("source", "image_id", "shader_id") } }),
  // Which of these files still need sending: it only answers hashes, so the list is plain.
  call({ method: "POST", path: "/check", answers: fromTool("check_game"), reaches: "nothing_private", access: anyKey, body: { inputs: { files: plain, slug: naming("game") }, maximumSizeBytes: MAXIMUM_CHECK_BODY_SIZE_BYTES } }),
  call({ method: "POST", path: "/games/:slug/uploads", answers: fieldsAnswer("file_count", "size_bytes", "missing_file_hashes", "next_steps"), reaches: "game", access: needs("version_access", "upload"), isPublishing: true, pathParts: atGame, body: { inputs: plainInputs("files"), maximumSizeBytes: 4 * 1024 * 1024 } }),
  call({ method: "PUT", path: "/files/:sha256", answers: fieldsAnswer("sha256", "storage_status"), reaches: "account", access: needs("version_access", "upload"), isPublishing: true, pathParts: { sha256: "file_hash" }, body: "bytes" }),
  call({ method: "POST", path: "/files/:sha256/parts", answers: fieldsAnswer("sha256", "storage_status", "upload_id", "part_size_bytes", "part_count"), reaches: "account", access: needs("version_access", "upload"), isPublishing: true, pathParts: { sha256: "file_hash" }, body: { inputs: plainInputs("size_bytes") } }),
  call({ method: "PUT", path: "/files/:sha256/parts/:part_number", answers: fieldsAnswer("part_number", "etag"), reaches: "account", access: needs("version_access", "upload"), isPublishing: true, pathParts: { sha256: "file_hash", part_number: "plain" }, query: plainInputs("upload_id"), body: "bytes" }),
  call({ method: "POST", path: "/files/:sha256/parts/done", answers: fieldsAnswer("sha256", "storage_status", "size_bytes"), reaches: "account", access: needs("version_access", "upload"), isPublishing: true, pathParts: { sha256: "file_hash" }, body: { inputs: plainInputs("upload_id", "parts"), maximumSizeBytes: 1024 * 1024 } }),
  call({
    method: "POST",
    path: "/games/:slug/versions",
    answers: fieldsAnswer("version", "sent_file_count", "next_steps"),
    reaches: "game",
    access: needs("version_access", "upload"),
    isPublishing: true,
    pathParts: atGame,
    body: {
      inputs: {
        files: naming("files"),
        patch_notes: plain,
        // Going live by itself is publishing, so it needs what publishing needs, not just upload.
        publish_when_approved: needsToo("version_access", "publish", "the version waits as a draft with a preview link, and the developer publishes it"),
        publish_after_ai_review_enabled: plain,
        match_update_mode: plain,
        is_big_update: plain,
      },
      maximumSizeBytes: 4 * 1024 * 1024,
    },
  }),
  call({ method: "GET", path: "/games/:slug/versions/:version_id", answers: fromTool("get_version"), reaches: "game", access: needs("version_access", "read"), pathParts: { slug: "game", version_id: "in_game" } }),
  call({ method: "DELETE", path: "/games/:slug/versions/:version_id", answers: fromTool("delete_version"), reaches: "game", access: needs("version_access", "publish"), pathParts: { slug: "game", version_id: "in_game" } }),
  call({ method: "POST", path: "/games/:slug/versions/:version_id/publish", answers: fromTool("publish_version"), reaches: "game", access: needs("version_access", "publish"), isPublishing: true, pathParts: { slug: "game", version_id: "in_game" }, body: { inputs: plainInputs("scheduled_publish_at", "match_update_mode", "is_big_update", "patch_notes", "publish_after_ai_review_enabled"), isOptional: true } }),
  call({ method: "POST", path: "/games/:slug/versions/:version_id/ai-review", answers: fromTool("start_ai_review"), reaches: "game", access: needs("version_access", "publish"), isPublishing: true, pathParts: { slug: "game", version_id: "in_game" } }),
  call({ method: "DELETE", path: "/games/:slug/versions/:version_id/publish", answers: fromTool("cancel_scheduled_publish"), reaches: "game", access: needs("version_access", "publish"), pathParts: { slug: "game", version_id: "in_game" } }),
  call({ method: "DELETE", path: "/games/:slug/versions/:version_id/preview-links", answers: fromTool("end_preview_links"), reaches: "game", access: needs("version_access", "upload"), pathParts: { slug: "game", version_id: "in_game" } }),
  call({ method: "GET", path: "/games/:slug/reports", answers: fromTool("get_reports"), reaches: "game", access: needs("stats_access", "read"), pathParts: atGame, query: plainInputs("cursor") }),
  call({ method: "GET", path: "/games/:slug/stats", answers: fromTool("get_stats"), reaches: "game", access: needs("stats_access", "read"), pathParts: atGame, query: plainInputs("period_duration_days") }),
  call({ method: "GET", path: "/games/:slug/history", answers: fromTool("get_history"), reaches: "game", access: needs("stats_access", "read"), pathParts: atGame }),
  call({ method: "GET", path: "/games/:slug/qr-code", answers: fromTool("get_qr_code"), reaches: "game", access: needs("game_access", "read"), pathParts: atGame, query: plainInputs("room_code") }),
  call({ method: "GET", path: "/games/:slug/logs", answers: fromTool("get_logs"), reaches: "game", access: needs("stats_access", "read"), pathParts: atGame, query: plainInputs("room_code", "minimum_level", "source_kind", "search_text", "maximum_line_count", "cursor", "new_lines_cursor") }),
  call({ method: "GET", path: "/games/:slug/testers", answers: fieldsAnswer("testers"), reaches: "game", access: needs("game_access", "read"), pathParts: atGame }),
  // picked_version_id is checked in the handler: a version of the path's game that passed.
  call({ method: "POST", path: "/games/:slug/testers", answers: fromTool("add_tester_link"), reaches: "game", access: needs("game_access", "write"), pathParts: atGame, body: { inputs: plainInputs("name", ...TESTER_LINK_INPUTS) } }),
  call({ method: "PATCH", path: "/games/:slug/testers/:tester_id", answers: fromTool("update_tester_link"), reaches: "game", access: needs("game_access", "write"), pathParts: { slug: "game", tester_id: "in_game" }, body: { inputs: plainInputs("name", ...TESTER_LINK_INPUTS) } }),
  call({ method: "DELETE", path: "/games/:slug/testers/:tester_id", answers: fromTool("remove_tester_link"), reaches: "game", access: needs("game_access", "write"), pathParts: { slug: "game", tester_id: "in_game" } }),
  call({ method: "GET", path: "/games/:slug/database", answers: fromTool("get_database"), reaches: "game", access: needs("database_access", "read"), pathParts: atGame }),
  call({ method: "POST", path: "/games/:slug/database/query", answers: fromTool("query_database"), reaches: "game", access: needs("database_access", "write"), pathParts: atGame, body: { inputs: plainInputs("sql", "values"), maximumSizeBytes: MAXIMUM_DATABASE_BODY_SIZE_BYTES } }),
  call({ method: "POST", path: "/games/:slug/database/batch", answers: fromTool("batch_database"), reaches: "game", access: needs("database_access", "write"), pathParts: atGame, body: { inputs: plainInputs("statements"), maximumSizeBytes: MAXIMUM_DATABASE_BODY_SIZE_BYTES } }),
  call({ method: "GET", path: "/games/:slug/database/export", answers: fromTool("export_database"), reaches: "game", access: needs("database_access", "read"), pathParts: atGame, query: plainInputs("cursor") }),
  call({ method: "POST", path: "/games/:slug/database/import", answers: fromTool("import_database"), reaches: "game", access: needs("database_access", "write"), pathParts: atGame, body: { inputs: plainInputs("dump_sql"), maximumSizeBytes: MAXIMUM_IMPORT_BODY_SIZE_BYTES } }),
  call({ method: "POST", path: "/games/:slug/database/erase-player", answers: fromTool("erase_player"), reaches: "game", access: needs("database_access", "write"), pathParts: atGame, body: { inputs: plainInputs("player_id") } }),
  call({ method: "POST", path: "/games/:slug/database/restores", answers: fromTool("restore_database"), reaches: "game", access: needs("database_access", "write"), pathParts: atGame, body: { inputs: plainInputs("restore_to_at") } }),
  call({ method: "POST", path: "/games/:slug/database/restores/:database_restore_id/undo", answers: fromTool("undo_database_restore"), reaches: "game", access: needs("database_access", "write"), pathParts: { slug: "game", database_restore_id: "in_game" } }),
  call({ method: "GET", path: "/games/:slug/export", answers: fromTool("export_game"), reaches: "game", access: needs("game_access", "read"), alsoNeeds: EXPORT_ACCESS, pathParts: atGame }),
  call({ method: "GET", path: "/games/:slug/export/download", answers: ANSWERS_BYTES, reaches: "game", access: needs("game_access", "read"), alsoNeeds: EXPORT_ACCESS, pathParts: atGame }),
  call({ method: "GET", path: "/games/:slug/secrets", answers: fromTool("list_secrets"), reaches: "game", access: needs("game_access", "read"), pathParts: atGame }),
  call({ method: "PUT", path: "/games/:slug/secrets/:secret_name", answers: fromTool("set_secret"), reaches: "game", access: needs("game_access", "write"), pathParts: { slug: "game", secret_name: "in_game" }, body: { inputs: plainInputs("secret_value") } }),
  call({ method: "DELETE", path: "/games/:slug/secrets/:secret_name", answers: fromTool("delete_secret"), reaches: "game", access: needs("game_access", "write"), pathParts: { slug: "game", secret_name: "in_game" } }),
  call({ method: "GET", path: "/games/:slug/kept-rooms", answers: fromTool("list_kept_rooms"), reaches: "game", access: needs("game_access", "read"), pathParts: atGame }),
  call({ method: "DELETE", path: "/games/:slug/kept-rooms/:room_code", answers: fromTool("delete_kept_room"), reaches: "game", access: needs("game_access", "write"), pathParts: { slug: "game", room_code: "in_game" } }),
  call({ method: "POST", path: "/games/:slug/kept-rooms/:room_code/bring-back", answers: fromTool("bring_back_kept_room"), reaches: "game", access: needs("game_access", "write"), pathParts: { slug: "game", room_code: "in_game" } }),
  call({ method: "POST", path: "/games/:slug/kept-rooms/:room_code/erase-now", answers: fromTool("erase_kept_room_now"), reaches: "game", access: needs("game_access", "write"), pathParts: { slug: "game", room_code: "in_game" } }),
  call({ method: "GET", path: "/games/:slug/kept-rooms/:room_code/restores", answers: fromTool("list_kept_room_restores"), reaches: "game", access: needs("game_access", "read"), pathParts: { slug: "game", room_code: "in_game" } }),
  call({ method: "POST", path: "/games/:slug/kept-rooms/:room_code/restores", answers: fromTool("restore_kept_room"), reaches: "game", access: needs("game_access", "write"), pathParts: { slug: "game", room_code: "in_game" }, body: { inputs: plainInputs("restore_to_at") } }),
  call({ method: "POST", path: "/games/:slug/kept-rooms/:room_code/restores/:kept_room_restore_id/undo", answers: fromTool("undo_kept_room_restore"), reaches: "game", access: needs("game_access", "write"), pathParts: { slug: "game", room_code: "in_game", kept_room_restore_id: "in_game" } }),
  call({ method: "POST", path: "/games/:slug/kept-room-restores", answers: fromTool("restore_every_kept_room"), reaches: "game", access: needs("game_access", "write"), pathParts: atGame, body: { inputs: plainInputs("restore_to_at") } }),
  call({ method: "GET", path: "/games/:slug/kept-room-restores/:kept_room_restore_batch_id", answers: fromTool("get_kept_room_restore_batch"), reaches: "game", access: needs("game_access", "read"), pathParts: { slug: "game", kept_room_restore_batch_id: "in_game" } }),
  call({ method: "POST", path: "/games/:slug/kept-room-restores/:kept_room_restore_batch_id/undo", answers: fromTool("undo_every_kept_room_restore"), reaches: "game", access: needs("game_access", "write"), pathParts: { slug: "game", kept_room_restore_batch_id: "in_game" } }),
  call({ method: "GET", path: "/games/:slug/rooms", answers: fromTool("list_rooms"), reaches: "game", access: needs("game_access", "read"), pathParts: atGame, query: plainInputs("labels", "cursor") }),
  call({ method: "GET", path: "/games/:slug/rooms/:room_code", answers: fromTool("get_room"), reaches: "game", access: needs("game_access", "read"), pathParts: { slug: "game", room_code: "in_game" } }),
  call({ method: "POST", path: "/games/:slug/rooms/:room_code/messages", answers: fromTool("send_room_message"), reaches: "game", access: needs("game_access", "write"), pathParts: { slug: "game", room_code: "in_game" }, body: { inputs: plainInputs("message") } }),
  call({ method: "POST", path: "/games/:slug/rooms/:room_code/kick", answers: fromTool("kick_player"), reaches: "game", access: needs("game_access", "write"), pathParts: { slug: "game", room_code: "in_game" }, body: { inputs: plainInputs("player_id", "message", "is_kept_out") } }),
  call({ method: "POST", path: "/games/:slug/rooms/:room_code/end", answers: fromTool("end_room"), reaches: "game", access: needs("game_access", "write"), pathParts: { slug: "game", room_code: "in_game" }, body: { inputs: plainInputs("message", "confirm"), isOptional: true } }),
  call({ method: "POST", path: "/games/:slug/room-messages", answers: fromTool("send_to_every_room"), reaches: "game", access: needs("game_access", "write"), pathParts: atGame, body: { inputs: plainInputs("message", "labels", "send_at") } }),
  call({ method: "GET", path: "/games/:slug/room-messages", answers: fromTool("list_room_messages"), reaches: "game", access: needs("game_access", "read"), pathParts: atGame }),
  call({ method: "DELETE", path: "/games/:slug/room-messages/:scheduled_room_message_id", answers: fromTool("cancel_room_message"), reaches: "game", access: needs("game_access", "write"), pathParts: { slug: "game", scheduled_room_message_id: "in_game" } }),
  call({ method: "GET", path: "/games/:slug/items", answers: fromTool("list_items"), reaches: "game", access: needs("purchase_access", "read"), pathParts: atGame }),
  call({ method: "PUT", path: "/games/:slug/items/:item_name", answers: fromTool("set_item"), reaches: "game", access: needs("purchase_access", "write"), pathParts: { slug: "game", item_name: "in_game" }, body: { inputs: plainInputs(...ITEM_FIELDS) } }),
  call({ method: "DELETE", path: "/games/:slug/items/:item_name", answers: fromTool("remove_item"), reaches: "game", access: needs("purchase_access", "write"), pathParts: { slug: "game", item_name: "in_game" } }),
  call({ method: "PATCH", path: "/games/:slug/purchase-settings", answers: fromTool("set_purchase_settings"), reaches: "game", access: needs("purchase_access", "write"), pathParts: atGame, body: { inputs: plainInputs("refund_policy", "refund_policy_text", "own_payment_categories", "purchase_delivery") } }),
  call({ method: "GET", path: "/games/:slug/purchases", answers: fromTool("list_purchases"), reaches: "game", access: needs("purchase_access", "read"), pathParts: atGame, query: plainInputs("player_id", "item_name", "purchase_source", "purchase_status", "cursor") }),
  call({ method: "POST", path: "/games/:slug/purchases", answers: fromTool("grant_item"), reaches: "game", access: needs("purchase_access", "write"), pathParts: atGame, body: { inputs: plainInputs("player_id", "item_name", "item_count", "game_account_id") } }),
  call({ method: "GET", path: "/games/:slug/purchases/:purchase_id", answers: fromTool("get_purchase"), reaches: "game", access: needs("purchase_access", "read"), pathParts: { slug: "game", purchase_id: "in_game" } }),
  call({ method: "POST", path: "/games/:slug/purchases/:purchase_id/refund", answers: fromTool("refund_purchase"), reaches: "game", access: needs("purchase_access", "write"), pathParts: { slug: "game", purchase_id: "in_game" }, body: { inputs: plainInputs("amount_minor_units"), isOptional: true } }),
  call({ method: "POST", path: "/games/:slug/purchases/:purchase_id/handled", answers: fromTool("mark_purchase_handled"), reaches: "game", access: needs("purchase_access", "write"), pathParts: { slug: "game", purchase_id: "in_game" } }),
  call({ method: "GET", path: "/games/:slug/players/:player_id/items", answers: fromTool("get_player_items"), reaches: "game", access: needs("purchase_access", "read"), pathParts: { slug: "game", player_id: "in_game" } }),
  call({ method: "GET", path: "/games/:slug/saves", answers: fromTool("list_saves"), reaches: "game", access: needs("save_access", "read"), pathParts: atGame, query: plainInputs("cursor") }),
  call({ method: "GET", path: "/games/:slug/saves/:player_id", answers: fromTool("get_save"), reaches: "player_save", access: needs("save_access", "read"), pathParts: { slug: "game", player_id: "in_game" }, query: plainInputs("keys") }),
  call({ method: "PATCH", path: "/games/:slug/saves/:player_id", answers: fromTool("change_save"), reaches: "player_save", access: needs("save_access", "write"), pathParts: { slug: "game", player_id: "in_game" }, body: { inputs: plainInputs("local_storage_items"), maximumSizeBytes: MAXIMUM_SAVE_BODY_SIZE_BYTES } }),
  call({ method: "PUT", path: "/games/:slug/saves/:player_id", answers: fromTool("replace_save"), reaches: "player_save", access: needs("save_access", "write"), pathParts: { slug: "game", player_id: "in_game" }, body: { inputs: plainInputs("local_storage_items", "indexeddb_databases"), maximumSizeBytes: MAXIMUM_SAVE_BODY_SIZE_BYTES } }),
  call({ method: "DELETE", path: "/games/:slug/saves/:player_id", answers: fromTool("reset_save"), reaches: "player_save", access: needs("save_access", "write"), pathParts: { slug: "game", player_id: "in_game" } }),
  call({ method: "GET", path: "/games/:slug/saves/:player_id/copies", answers: fromTool("list_save_copies"), reaches: "player_save", access: needs("save_access", "read"), pathParts: { slug: "game", player_id: "in_game" } }),
  call({ method: "GET", path: "/games/:slug/saves/:player_id/copies/:save_copy_id", answers: fromTool("get_save_copy"), reaches: "player_save", access: needs("save_access", "read"), pathParts: { slug: "game", player_id: "in_game", save_copy_id: "in_game" }, query: plainInputs("keys") }),
  call({ method: "POST", path: "/games/:slug/saves/:player_id/copies/:save_copy_id/restore", answers: fromTool("restore_save_copy"), reaches: "player_save", access: needs("save_access", "write"), pathParts: { slug: "game", player_id: "in_game", save_copy_id: "in_game" } }),
  call({ method: "GET", path: "/forum", answers: fieldsAnswer("topics", "pinned_topics", "tab", "next_cursor", "remaining_post_count"), reaches: "nothing_private", access: needs("forum_access", "read"), query: plainInputs("search_text", "section", "category", "kind", "tag", "tab", "topic_status", "is_answered", "cursor", "maximum_topic_count", "detail") }),
  call({
    method: "POST",
    path: "/forum",
    answers: fromTool("post_topic"),
    reaches: "account",
    access: needs("forum_access", "write"),
    body: { inputs: { ...plainInputs("kind", "title", "category", "tags", "is_public", ...FORUM_POST_INPUTS), game_slug: naming("game"), known_issue_topic_id: naming("forum_topic") }, maximumSizeBytes: MAXIMUM_FORUM_POST_BODY_SIZE_BYTES },
  }),
  call({ method: "GET", path: "/forum/similar", answers: fieldsAnswer("topics"), reaches: "nothing_private", access: needs("forum_access", "read"), query: plainInputs("search_text") }),
  call({ method: "GET", path: "/forum/people", answers: fromTool("forum_people"), reaches: "nothing_private", access: needs("forum_access", "read"), query: { name_prefix: plain, topic_id: naming("forum_topic") } }),
  call({ method: "POST", path: "/forum/media", answers: fieldsAnswer("id", "image_url", "image_markdown"), reaches: "account", access: needs("forum_access", "write"), body: "bytes" }),
  call({ method: "GET", path: "/forum/:topic_id", answers: fromTool("get_topic"), reaches: "forum_topic", access: needs("forum_access", "read"), pathParts: { topic_id: "forum_topic" }, query: plainInputs("post_selection") }),
  // reply_to_post_id and answer_post_id are posts in the path's topic, which the forum finds there alone.
  call({ method: "POST", path: "/forum/:topic_id/posts", answers: fromTool("reply_to_topic"), reaches: "forum_topic", access: needs("forum_access", "write"), pathParts: { topic_id: "forum_topic" }, body: { inputs: plainInputs("reply_to_post_id", "reopen", ...FORUM_POST_INPUTS), maximumSizeBytes: MAXIMUM_FORUM_POST_BODY_SIZE_BYTES } }),
  call({ method: "POST", path: "/forum/:topic_id/vote", answers: fromTool("vote"), reaches: "forum_topic", access: needs("forum_access", "write"), pathParts: { topic_id: "forum_topic" } }),
  call({ method: "DELETE", path: "/forum/:topic_id/vote", answers: fromTool("vote"), reaches: "forum_topic", access: needs("forum_access", "write"), pathParts: { topic_id: "forum_topic" } }),
  call({ method: "POST", path: "/forum/:topic_id/follow", answers: fromTool("follow_topic"), reaches: "forum_topic", access: needs("forum_access", "write"), pathParts: { topic_id: "forum_topic" } }),
  call({ method: "DELETE", path: "/forum/:topic_id/follow", answers: fromTool("follow_topic"), reaches: "forum_topic", access: needs("forum_access", "write"), pathParts: { topic_id: "forum_topic" } }),
  call({ method: "POST", path: "/forum/:topic_id/answer", answers: fromTool("mark_answer"), reaches: "forum_topic", access: needs("forum_access", "write"), pathParts: { topic_id: "forum_topic" }, body: { inputs: plainInputs("answer_post_id"), maximumSizeBytes: 16 * 1024 } }),
  call({ method: "POST", path: "/forum/:topic_id/misplaced", answers: fromTool("flag_misplaced"), reaches: "forum_topic", access: needs("forum_access", "write"), pathParts: { topic_id: "forum_topic" }, body: { inputs: {}, maximumSizeBytes: 16 * 1024 } }),
  call({ method: "POST", path: "/forum/:topic_id/still-happening", answers: fromTool("still_happening"), reaches: "forum_topic", access: needs("forum_access", "write"), pathParts: { topic_id: "forum_topic" }, body: { inputs: plainInputs("text_markdown"), maximumSizeBytes: 16 * 1024 } }),
  call({ method: "PUT", path: "/forum/:topic_id/posts/:post_id/rating", answers: fromTool("rate_post"), reaches: "forum_topic", access: needs("forum_access", "write"), pathParts: { topic_id: "forum_topic", post_id: "in_forum_topic" }, body: { inputs: plainInputs("rating"), maximumSizeBytes: 1024 } }),
  call({ method: "DELETE", path: "/forum/:topic_id/posts/:post_id/rating", answers: fromTool("rate_post"), reaches: "forum_topic", access: needs("forum_access", "write"), pathParts: { topic_id: "forum_topic", post_id: "in_forum_topic" } }),
  call({ method: "POST", path: "/forum/:topic_id/posts/:post_id/bookmark", answers: fromTool("bookmark_post"), reaches: "forum_topic", access: needs("forum_access", "write"), pathParts: { topic_id: "forum_topic", post_id: "in_forum_topic" } }),
  call({ method: "DELETE", path: "/forum/:topic_id/posts/:post_id/bookmark", answers: fromTool("bookmark_post"), reaches: "forum_topic", access: needs("forum_access", "write"), pathParts: { topic_id: "forum_topic", post_id: "in_forum_topic" } }),
  // Deprecated: /rating replaces /helpful, which goes 90 days after this shipped.
  call({ method: "POST", path: "/forum/:topic_id/posts/:post_id/helpful", answers: fieldsAnswer("like_count", "dislike_count", "your_rating", "helpful_count", "has_marked_helpful", "next_steps"), reaches: "forum_topic", access: needs("forum_access", "write"), pathParts: { topic_id: "forum_topic", post_id: "in_forum_topic" } }),
  call({ method: "DELETE", path: "/forum/:topic_id/posts/:post_id/helpful", answers: fieldsAnswer("like_count", "dislike_count", "your_rating", "helpful_count", "has_marked_helpful", "next_steps"), reaches: "forum_topic", access: needs("forum_access", "write"), pathParts: { topic_id: "forum_topic", post_id: "in_forum_topic" } }),
  call({ method: "POST", path: "/forum/:topic_id/posts/:post_id/report", answers: fromTool("report_post"), reaches: "forum_topic", access: needs("forum_access", "write"), pathParts: { topic_id: "forum_topic", post_id: "in_forum_topic" }, body: { inputs: plainInputs("reason", "details"), maximumSizeBytes: 8 * 1024 } }),
  call({ method: "GET", path: "/forum/:topic_id/media/:media_id", answers: ANSWERS_BYTES, reaches: "forum_topic", access: needs("forum_access", "read"), pathParts: { topic_id: "forum_topic", media_id: "in_forum_topic" } }),
  // A public profile, the same as any game gets with no key at all.
  call({ method: "GET", path: "/players/:player_id", answers: fromTool("get_player"), reaches: "nothing_private", access: anyKey, pathParts: { player_id: "plain" } }),
  call({ method: "GET", path: "/sign-in-apps", answers: fromTool("list_sign_in_apps"), reaches: "account", access: needs("sign_in_app_access", "read") }),
  call({ method: "POST", path: "/sign-in-apps", answers: fromTool("create_sign_in_app"), reaches: "account", access: needs("sign_in_app_access", "write"), body: { inputs: plainInputs("name", "kind", "redirect_urls") } }),
  call({ method: "PATCH", path: "/sign-in-apps/:sign_in_app_id", answers: fromTool("update_sign_in_app"), reaches: "sign_in_app", access: needs("sign_in_app_access", "write"), pathParts: { sign_in_app_id: "sign_in_app" }, body: { inputs: plainInputs("name", "redirect_urls", "replace_client_secret") } }),
  call({ method: "DELETE", path: "/sign-in-apps/:sign_in_app_id", answers: fromTool("delete_sign_in_app"), reaches: "sign_in_app", access: needs("sign_in_app_access", "write"), pathParts: { sign_in_app_id: "sign_in_app" } }),
  call({ method: "GET", path: "/credit", answers: fromTool("get_credit"), reaches: "account", access: needs("credit_access", "read"), isAccountWide: true }),
  call({ method: "POST", path: "/credit/top-ups", answers: fromTool("top_up_credit"), reaches: "account", access: needs("credit_access", "write"), isAccountWide: true, body: { inputs: plainInputs("amount_cents") } }),
  call({ method: "GET", path: "/spending-requests/:spending_request_id", answers: fromTool("get_spending_request"), reaches: "account", access: needs("credit_access", "read"), isAccountWide: true, pathParts: { spending_request_id: "plain" } }),
  call({ method: "GET", path: "/pro", answers: fromTool("get_pro"), reaches: "account", access: needs("credit_access", "read"), isAccountWide: true }),
  call({ method: "POST", path: "/pro/checkout", answers: fromTool("start_pro"), reaches: "account", access: needs("credit_access", "write"), isAccountWide: true }),
  call({ method: "POST", path: "/pro/cancel", answers: fromTool("cancel_pro"), reaches: "account", access: needs("credit_access", "write"), isAccountWide: true }),
  call({ method: "POST", path: "/pro/resume", answers: fromTool("resume_pro"), reaches: "account", access: needs("credit_access", "write"), isAccountWide: true }),
  call({ method: "POST", path: "/pro/refund", answers: fromTool("refund_pro"), reaches: "account", access: needs("credit_access", "write"), isAccountWide: true }),
  call({ method: "POST", path: "/credit/refunds", answers: fromTool("refund_top_up"), reaches: "account", access: needs("credit_access", "write"), isAccountWide: true, body: { inputs: plainInputs("top_up_id") } }),
  call({ method: "POST", path: "/credit/plan/checkout", answers: fromTool("start_credit_plan"), reaches: "account", access: needs("credit_access", "write"), isAccountWide: true, body: { inputs: plainInputs("refill_level_cents") } }),
  call({ method: "PATCH", path: "/credit/plan", answers: fromTool("change_credit_plan"), reaches: "account", access: needs("credit_access", "write"), isAccountWide: true, body: { inputs: plainInputs("refill_level_cents") } }),
  call({ method: "POST", path: "/credit/plan/stop", answers: fromTool("stop_credit_plan"), reaches: "account", access: needs("credit_access", "write"), isAccountWide: true }),
  call({ method: "GET", path: "/stripe-account", answers: fromTool("get_stripe_account"), reaches: "account", access: needs("stripe_account_access", "read"), isAccountWide: true }),
  call({ method: "POST", path: "/stripe-account/connection-links", answers: fromTool("connect_stripe_account"), reaches: "account", access: needs("stripe_account_access", "write"), isAccountWide: true }),
  call({ method: "PATCH", path: "/stripe-account", answers: fromTool("update_stripe_account"), reaches: "account", access: needs("stripe_account_access", "write"), isAccountWide: true, body: { inputs: plainInputs("is_stripe_tax_used") } }),
  call({ method: "DELETE", path: "/stripe-account", answers: fromTool("disconnect_stripe_account"), reaches: "account", access: needs("stripe_account_access", "write"), isAccountWide: true }),
  call({ method: "GET", path: "/webhooks", answers: fromTool("list_webhooks"), reaches: "account", access: needs("webhook_access", "read") }),
  call({ method: "POST", path: "/webhooks", answers: fromTool("create_webhook"), reaches: "account", access: needs("webhook_access", "write"), body: { inputs: { ...plainInputs("destination_kind", "endpoint_url", "event_kinds"), game_slugs: naming("game_list") } } }),
  call({ method: "PATCH", path: "/webhooks/:webhook_id", answers: fromTool("update_webhook"), reaches: "webhook", access: needs("webhook_access", "write"), pathParts: { webhook_id: "webhook" }, body: { inputs: { ...plainInputs("destination_kind", "endpoint_url", "event_kinds", "replace_signing_secret"), game_slugs: naming("game_list") } } }),
  call({ method: "DELETE", path: "/webhooks/:webhook_id", answers: fromTool("delete_webhook"), reaches: "webhook", access: needs("webhook_access", "write"), pathParts: { webhook_id: "webhook" } }),
  call({ method: "POST", path: "/webhooks/:webhook_id/test", answers: fromTool("test_webhook"), reaches: "webhook", access: needs("webhook_access", "write"), pathParts: { webhook_id: "webhook" } }),
  call({ method: "GET", path: "/webhooks/:webhook_id/deliveries", answers: fromTool("list_webhook_deliveries"), reaches: "webhook", access: needs("webhook_access", "read"), pathParts: { webhook_id: "webhook" }, query: plainInputs("cursor") }),
];

/** A call's contract (docs/DOORS.md), from its declarations: the router below proves its caller and everything the call names. */
export const apiRouteContract = (apiRoute: ApiRoute): DoorContract => ({
  whoMayCall: "api_caller",
  reaches: apiRoute.reaches,
  trusts: ["api_key", "session"],
  provenBy: { source_path: "apps/site/src/developer.ts", symbol_name: "checkCall" },
  takes: {
    query: inputShapes(apiRoute.query),
    body:
      apiRoute.body === null
        ? null
        : apiRoute.body === "bytes"
          ? { kind: "bytes", maximumSizeBytes: MAXIMUM_RAW_BODY_SIZE_BYTES }
          : { kind: "json", fields: inputShapes(apiRoute.body.inputs), maximumSizeBytes: apiRoute.body.maximumSizeBytes ?? 64 * 1024, ...(apiRoute.body.isOptional ? { isOptional: true as const } : {}) },
  },
  answers: answerOfRoute(apiRoute),
  limit: apiRoute.limit,
});

const inputShapes = (inputs: Readonly<Record<string, ApiInput>>): Record<string, DoorShape> => Object.fromEntries(Object.keys(inputs).map((name) => [name, API_INPUT_SHAPES[name as ApiInputName]]));

/** Each tool's outputSchema, by its name, which mcp.ts fills as it loads: a tool's answer is its call's. */
export const TOOL_ANSWER_SCHEMAS = new Map<string, Readonly<Record<string, unknown>>>();

/** What a call answers. Before mcp.ts has loaded, a tool's schema reads as nothing to cut. */
export function answerOfRoute(apiRoute: ApiRoute): DoorAnswer {
  const { answers } = apiRoute;
  if (!("toolName" in answers)) return answers;
  const schema = TOOL_ANSWER_SCHEMAS.get(answers.toolName);
  return schema ? { kind: "json", schema } : ANSWERS_BYTES;
}

const routePatterns = new Map(
  API_ROUTES.map((apiRoute) => [apiRoute, new RegExp(`^${apiRoute.path.replace(/:([a-z0-9_]+)/g, (_, name: string) => `(?<${name}>${name === "sha256" ? "[0-9a-f]{64}" : "[^/]+"})`)}$`)]),
);

/** The calls at a path (without its query), the most specific first: /forum/people before /forum/:topic_id. */
export function apiRoutesAt(path: string): ApiRoute[] {
  const placeholderCount = (apiRoute: ApiRoute) => apiRoute.path.split(":").length;
  return API_ROUTES.filter((apiRoute) => routePatterns.get(apiRoute)!.test(path)).sort((first, second) => placeholderCount(first) - placeholderCount(second));
}

/** What the router checked and loaded for one call, handed to the call's own code so it looks nothing up again. */
export interface CheckedCall {
  /** Each path part's value, as sent (URL-decoded). */
  pathValues: Record<string, string>;
  /** The query, holding only the call's inputs. */
  query: URLSearchParams;
  /** The JSON body, holding only the call's inputs; {} for a call that takes none, or raw bytes. */
  body: Record<string, unknown>;
  /** The game the path names, the caller's and the key's. */
  game: Game | null;
  webhook: Webhook | null;
  signInApp: SignInApp | null;
  /** A game_list input's games' slugs, each the caller's and the key's: null for every game, undefined when it wasn't sent. */
  gameSlugs?: string[] | null;
  /** A files input's list, every file stored for the caller, and where each is stored. */
  files?: { list: UploadFile[]; found: Map<string, "shared" | "owned"> };
}

/**
 * Checks everything a call declares before any of its own code runs: the key's access, what the path
 * names (loading it), that the query and body hold only the call's inputs, each input's own access, and
 * what the inputs name. Someone else's game, webhook, sign-in app or topic is answered exactly like
 * nothing there, and a key limited to some games is held to those.
 */
async function checkCall(request: Request, env: Env, path: string, apiRoute: ApiRoute, caller: Caller): Promise<CheckedCall> {
  checkAccess(apiRoute, caller);
  if (caller.banScope && !(caller.banScope === "developer" && BANNED_DEVELOPER_ROUTES.has(`${apiRoute.method} ${apiRoute.path}`))) throw accountBanned(caller);
  if (apiRoute.isPublishing && !caller.canPublish) {
    throw new ApiError("publishing_not_open", {
      message: "Publishing opens with the beta. Until then, only accounts Zaisma adds can make, upload and publish games.",
      fix: "Tell the developer publishing opens with the beta, and don't retry until then. Everything else works now: playing, saves, friends and the forum.",
    });
  }
  const pathValues: Record<string, string> = {};
  for (const [name, given] of Object.entries(routePatterns.get(apiRoute)!.exec(path)?.groups ?? {})) pathValues[name] = decodePathPart(given);
  const checked: CheckedCall = { pathValues, query: new URL(request.url).searchParams, body: {}, game: null, webhook: null, signInApp: null };
  for (const [name, pathPart] of Object.entries(apiRoute.pathParts)) {
    const given = pathValues[name]!;
    if (pathPart === "game") checked.game = await ownGame(env, given, caller, name);
    if (pathPart === "webhook") {
      const webhookFix = "list_webhooks lists your webhooks with their IDs.";
      checkIdKind("webhook", given, name, webhookFix);
      const webhook = await webhookById(env.DB, given);
      if (!webhook || webhook.owner_id !== caller.ownerId) throw new ApiError("no_webhook", { message: `You have no webhook with the ID ${given}.`, field: name, fix: webhookFix });
      checked.webhook = webhook;
    }
    if (pathPart === "sign_in_app") {
      const appFix = "list_sign_in_apps lists your sign-in apps with their IDs.";
      checkIdKind("sign_in_app", given, name, appFix);
      const app = await signInAppById(env.DB, given);
      if (!app || app.owner_id !== caller.ownerId) throw new ApiError("no_sign_in_app", { message: `You have no sign-in app with the ID ${given}.`, field: name, fix: appFix });
      checked.signInApp = app;
    }
    if (pathPart === "forum_topic") await readableTopic(env, caller, given, name);
  }

  closedQuery(checked.query, Object.keys(apiRoute.query));
  const body = apiRoute.body;
  if (!body) await refuseBody(request);
  if (body === "bytes" && Number(request.headers.get("content-length") ?? 0) > MAXIMUM_RAW_BODY_SIZE_BYTES) {
    throw new ApiError("wrong_shape", { message: `The body is over ${MAXIMUM_RAW_BODY_SIZE_BYTES / 1024 / 1024} MB, the most any call reads.`, fix: "Send it in parts: POST /files/<sha256>/parts." });
  }
  if (body && body !== "bytes") {
    checked.body = await readJson(request, body.maximumSizeBytes, body.isOptional);
    closedBody(checked.body, Object.keys(body.inputs));
  }
  const inputs: [string, ApiInput, unknown][] = [
    ...Object.entries(apiRoute.query).map(([name, input]): [string, ApiInput, unknown] => [name, input, checked.query.get(name) ?? undefined]),
    ...Object.entries(body && body !== "bytes" ? body.inputs : {}).map(([name, input]): [string, ApiInput, unknown] => [name, input, checked.body[name]]),
  ];
  // Each input's own access first, so a key that can't send one learns nothing about what it names.
  for (const [name, input, given] of inputs) {
    if (input.kind !== "needs" || given === undefined || given === null || given === false || given === "false") continue;
    if (allows(caller.access.areaAccess, input.area, input.choice)) continue;
    throw new ApiError("key_not_allowed", {
      message: `This API key can't send ${name}: that needs ${input.area} ${input.choice}, and the key has ${input.area} ${caller.access.areaAccess[input.area]}.`,
      field: name,
      fix: `Leave ${name} out: ${input.withoutIt}. To send it, the developer makes a key with ${input.area} ${input.choice} on zaisma.com/dashboard/settings; keys can't be made through the API.`,
    });
  }
  // The shape of everything sent, before any of the call's own code runs (docs/DOORS.md).
  const queryRefusal = queryProblem(inputShapes(apiRoute.query), checked.query);
  if (queryRefusal) throw wrongShape(queryRefusal);
  if (body && body !== "bytes") {
    const bodyRefusal = bodyProblem(inputShapes(body.inputs), [], checked.body);
    if (bodyRefusal) throw wrongShape(bodyRefusal);
  }
  for (const [name, input, given] of inputs) {
    if (input.kind !== "names") continue;
    // A version's files are its whole point, so a list left out is refused like one that isn't a list.
    if (input.what === "files") checked.files = await storedFiles(env, given, caller);
    if (given === undefined) continue;
    if (input.what === "game_list") checked.gameSlugs = given === null ? null : await ownGameSlugs(env, given, caller, name);
    if (typeof given !== "string" || !given) continue;
    if (input.what === "game") await ownGame(env, given, caller, name);
    if (input.what === "forum_topic") await readableTopic(env, caller, given, name);
  }
  return checked;
}

const wrongShape = ({ field, problem }: { field: string; problem: string }) =>
  new ApiError("wrong_shape", { message: `${field} isn't the right shape: ${problem}.`, field, fix: "docs/DEVELOPER-API.md and the MCP tool's input schema say what each field takes. Change this field and send it again." });

/** A path part as it was meant: %-escapes decoded, or as sent when they don't decode. */
function decodePathPart(given: string): string {
  try {
    return decodeURIComponent(given);
  } catch {
    return given;
  }
}

/**
 * A list of the caller's games' slugs, each one the key reaches, without repeats. A list that isn't one
 * (not a list, or too long) is the call's to refuse, with its own fix, so it's answered as it came.
 */
async function ownGameSlugs(env: Env, given: unknown, caller: Caller, field: string): Promise<string[] | undefined> {
  if (!Array.isArray(given) || given.length > MAXIMUM_GAME_COUNT_PER_OWNER || given.some((slug) => typeof slug !== "string")) return undefined;
  for (const [i, slug] of (given as string[]).entries()) await ownGame(env, slug, caller, `${field}[${i}]`);
  return [...new Set(given as string[])];
}

/**
 * A version's files: each one already stored, as a shared file anyone could have sent or one kept for
 * this caller alone. One that isn't is answered like a file never sent.
 */
async function storedFiles(env: Env, given: unknown, caller: Caller): Promise<CheckedCall["files"]> {
  const list = listOrThrow(given);
  const found = await locateBlobs(env.DB, list.map((file) => file.sha256), caller.ownerId);
  const missingCount = list.filter((file) => !found.has(file.sha256)).length;
  if (missingCount) {
    throw new ApiError("files_missing", { message: `${missingCount} of the files haven't been sent yet.`, field: "files", fix: "POST /api/dev/games/<slug>/uploads lists the missing_file_hashes; send each to PUT /api/dev/files/<sha256>, then call again." });
  }
  return { list, found };
}

/** Answers a call, cut to what it declares (answers.ts): whatever it's wrong about, the caller still gets the answer and Zaisma hears. */
export async function route(request: Request, env: Env, path: string, caller: Caller): Promise<Response> {
  const response = await answerCall(request, env, path, caller);
  const apiRoute = apiRoutesAt(path).find((candidate) => candidate.method === request.method);
  return apiRoute ? withDeclaredAnswer(env, response, answerOfRoute(apiRoute), `api:${apiRoute.method} ${apiRoute.path}`, caller.waitUntil) : response;
}

async function answerCall(request: Request, env: Env, path: string, caller: Caller): Promise<Response> {
  const method = request.method;
  const answer = (body: unknown, httpStatus = 200) => json(body, httpStatus, caller.cookies);

  // The first feedback calls are gone: everything they did is in the forum.
  if (path === "/feedback" || path.startsWith("/feedback/")) {
    throw new ApiError("gone", { message: "The feedback calls are gone; everything they did is in the developer forum.", fix: "Use search_forum (GET /forum?tab=yours or ?tab=messages) for your topics and messages, and post_topic or message_zaisma (POST /forum) to post." });
  }
  const routes = apiRoutesAt(path);
  if (routes.length === 0) throw new ApiError("not_found", { message: `There's no API call at ${path}.`, fix: "docs/DEVELOPER-API.md lists every call; paths start with /api/dev, like GET /api/dev/games." });
  const apiRoute = routes.find((candidate) => candidate.method === method);
  if (!apiRoute) throw badMethod(method, path);
  const checked = await checkCall(request, env, path, apiRoute, caller);
  const { game, pathValues } = checked;

  if (path === "/playing-now" && method === "GET") return answer(await playingNowAnswer(env));
  if (path === "/access" && method === "GET") {
    // The balance only for a caller that may read the credit.
    const creditBalanceCents = allows(caller.access.areaAccess, "credit_access", "read") && !caller.access.gameSlugs ? (await creditOf(env.DB, caller.ownerId)).balanceCents : null;
    const standing = await standingOf(env.DB, caller.ownerId, Date.now());
    // A card or Stripe account opens links now, except while a ban or the wait after a ruling closes everything.
    const canOpenLinksNow = !standing.outsideLinksEnabled && !standing.isBanned && standing.rulingWaitEndsAtMs === null;
    const standingSteps: NextStep[] = canOpenLinksNow
      ? [
          { tool: "top_up_credit", arguments: {}, after_sec: null, reason: "Paying Zaisma by card opens links to other sites at once (search engines still wait to be established). Ask the developer first, and add the amount_cents they pick." },
          { tool: "connect_stripe_account", arguments: {}, after_sec: null, reason: "Or a Stripe account that can take payments opens them too. Ask the developer first." },
        ]
      : [];
    return answer({ access: accessJson(caller.access), can_publish: caller.canPublish, banned_at: iso(caller.bannedAtMs), ban_scope: caller.banScope, credit_balance_cents: creditBalanceCents, plan: await planFor(env.DB, caller.ownerId), standing: standingJson(standing), next_steps: standingSteps });
  }
  if (apiRoute.path === "/storage") return answer(...(await storageRoute(env, method, checked.body, caller)));
  if (apiRoute.path === "/pro" || apiRoute.path.startsWith("/pro/")) return answer(...(await proRoute(env, apiRoute.path, method, caller)));
  if (apiRoute.path === "/credit/plan" || apiRoute.path.startsWith("/credit/plan/")) return answer(...(await creditPlanRoute(env, apiRoute.path, method, checked.body, caller)));
  if (apiRoute.path === "/credit" || apiRoute.path.startsWith("/credit/")) return answer(...(await creditRoute(env, apiRoute.path, method, checked.body, caller)));
  // With its ID in the path, so the route reads the real path rather than the call's pattern.
  if (apiRoute.path.startsWith("/spending-requests/")) return answer(...(await creditRoute(env, path, method, checked.body, caller)));
  if (apiRoute.path === "/stripe-account" || apiRoute.path.startsWith("/stripe-account/")) return answer(...(await stripeAccountRoute(env, apiRoute.path, method, checked.body, caller)));
  if (path === "/check" && method === "POST") return answer(await checkRoute(env, checked));
  if (path === "/api-keys" && method === "GET") return answer(await apiKeysAnswer(env, caller));
  if (path === "/activity" && method === "GET") return answer(await activityAnswer(env, (await accountById(env.DB, caller.accountId))!, checked.query.get("cursor")));

  if (path === "/games" && method === "GET") {
    const [{ results: games }, unread] = await Promise.all([
      env.DB.prepare("SELECT * FROM games WHERE owner_id = ? ORDER BY updated_at_ms DESC").bind(caller.ownerId).all<Game>(),
      env.DB.prepare("SELECT COUNT(*) AS topic_count FROM forum_topics WHERE account_id = ? AND news_at_ms > COALESCE(seen_at_ms, 0)").bind(caller.accountId).first<{ topic_count: number }>(),
    ]);
    // A key limited to some games lists only those.
    const gameSlugs = caller.access.gameSlugs;
    const keyGames = gameSlugs ? games.filter((game) => gameSlugs.includes(game.slug)) : games;
    // Your forum topics with a reply or change from Zaisma you haven't opened yet.
    const alertsByGameId = await gameAlerts(env, keyGames);
    return answer({ games: await Promise.all(keyGames.map(async (game) => ({ ...(await gameJson(env, game)), alerts: alertsByGameId.get(game.id)! }))), unread_topic_count: unread?.topic_count ?? 0 });
  }

  if (apiRoute.path === "/forum" || apiRoute.path.startsWith("/forum/")) {
    const routed = await forumRoute(request, env, apiRoute.path, caller, checked);
    return routed instanceof Response ? routed : answer(...routed);
  }

  // An account's public profile, the same as any game or server gets at <rooms>/v1/players/<id>.
  if (apiRoute.path === "/players/:player_id") {
    const playerId = pathValues.player_id!;
    const playerFix = "Take player IDs from your game: a room's players, or the sub of a player pass your server checked.";
    checkIdKind("player", playerId, "player_id", playerFix);
    const profile = await playerProfile(env.DB, playerId, env.SITE_ORIGIN);
    if (!profile) throw new ApiError("no_player", { message: `No account has the player ID ${playerId}. Guests have no profile, and a deleted account's is gone.`, field: "player_id", fix: playerFix });
    return answer({ player: profile });
  }

  if (path === "/games" && method === "POST") {
    const body = checked.body;
    const title = shownTextOrThrow(body.title, { field: "title", maximumCharacterCount: 80, isRequired: true });
    await refuseZaismaInTitle(env, title, caller.ownerId);
    const slug = typeof body.slug === "string" && body.slug ? body.slug.trim().toLowerCase() : slugify(title);
    const slugError = checkSlug(slug);
    if (slugError) throw new ApiError("bad_slug", { message: `The link name ${JSON.stringify(slug)} can't be used: ${slugError}`, field: "slug", fix: 'Give a slug of lowercase letters, numbers and single hyphens, like "sky-hopper", or leave it out to make one from the title.' });
    const isRetired = await isSlugRetired(env.DB, slug);
    if (isRetired || (await gameBySlug(env.DB, slug))) {
      const isFromTitle = !(typeof body.slug === "string" && body.slug);
      throw new ApiError("slug_taken", {
        message: isRetired ? `zaisma.com/g/${slug} was a game that was deleted; its link never goes to another game.` : `zaisma.com/g/${slug} is taken.`,
        field: isFromTitle ? "title" : "slug",
        fix: isFromTitle ? `The link name comes from the title: give another title, or a slug of your own, like "${slug}-game".` : `Pick another slug, like "${slug}-game".`,
      });
    }
    const owned = await env.DB.prepare("SELECT COUNT(*) AS game_count FROM games WHERE owner_id = ?").bind(caller.ownerId).first<{ game_count: number }>();
    if ((owned?.game_count ?? 0) >= MAXIMUM_GAME_COUNT_PER_OWNER) {
      throw new ApiError("too_many_games", { message: `You have ${MAXIMUM_GAME_COUNT_PER_OWNER} games, the most an account can have.`, fix: "Ask Zaisma (message_zaisma, kind gap) if you need more." });
    }
    const details = settledMinimumAge({ minimum_player_age_years: 13, account_requirement: "none" }, checkDetailsOrThrow({ ...body, title }));
    if (details.links) details.links = await checkLinkSites(details.links, [], { dnsUrl: env.LINK_CHECK_DNS_URL });
    let made = await createGame(env.DB, { slug, title, description: details.description ?? "", ownerId: caller.ownerId, visibility: "draft" });
    await applyDetails(env.DB, made, { ...details, title: undefined, description: undefined });
    made = (await gameBySlug(env.DB, slug))!;
    await audit(env.DB, made.id, "created", "Made through the developer API", caller.actor);
    await queueListingCheck(env, made.id);
    await logCallerEvent(env, caller, "game_created", { gameId: made.id });
    return answer(
      {
        game: await gameJson(env, made),
        next_steps: [
          {
            tool: "upload_files",
            arguments: { slug: made.slug },
            after_sec: null,
            reason: `Upload the game next: upload_files with its files for a small game (under 5 MB), or npx @zaisma/cli upload <folder> --game ${made.slug} in a terminal.`,
          },
        ] satisfies NextStep[],
      },
      201,
    );
  }

  // One file of a game, by its SHA-256. Storage checks the hash, so a file can't claim to be another.
  if (apiRoute.path === "/files/:sha256") return answer(await putBlob(request, env, pathValues.sha256!, caller));
  if (apiRoute.path.startsWith("/files/:sha256/parts")) return answer(await bigFile(request, env, pathValues.sha256!, apiRoute.path.endsWith("/done") ? "done" : pathValues.part_number, caller, checked));

  if (apiRoute.path === "/games/:slug/versions/:version_id/preview-links") return answer(...(await endPreviewLinks(env, game!, pathValues.version_id!, caller)));
  if (apiRoute.path.startsWith("/games/:slug/uploads") || apiRoute.path.startsWith("/games/:slug/versions")) {
    const what = apiRoute.path.startsWith("/games/:slug/uploads") ? "uploads" : "versions";
    return answer(...(await versionRoute(request, env, game!, what, pathValues.version_id, apiRoute.path.endsWith("/publish"), apiRoute.path.endsWith("/ai-review"), caller, checked)));
  }

  if (apiRoute.path === "/games/:slug/reports") return answer(await reportsFor(env, game!, checked.query.get("cursor")));
  if (apiRoute.path === "/games/:slug/stats") return answer(await statsFor(env, game!, readPeriodDurationDays(checked.query.get("period_duration_days"))));
  if (apiRoute.path === "/games/:slug/history") return answer(await historyFor(env, game!, caller));
  if (apiRoute.path === "/games/:slug/qr-code") return answer(qrCodeFor(env, game!, checked.query.get("room_code")));
  if (apiRoute.path === "/games/:slug/logs") return answer(await logsFor(env, game!, checked));

  if (apiRoute.path.startsWith("/sign-in-apps")) return answer(...(await signInAppRoute(request, env, caller, checked)));

  if (apiRoute.path.startsWith("/webhooks")) {
    const sub = apiRoute.path.endsWith("/test") ? "test" : apiRoute.path.endsWith("/deliveries") ? "deliveries" : undefined;
    return answer(...(await webhookRoute(request, env, sub, caller, checked)));
  }

  if (apiRoute.path.startsWith("/games/:slug/testers")) return answer(...(await testerRoute(request, env, game!, pathValues.tester_id, caller, checked)));

  if (apiRoute.path.startsWith("/games/:slug/database")) {
    const what = apiRoute.path.endsWith("/undo") ? "undo" : apiRoute.path.match(/\/database\/(query|batch|export|import|erase-player|restores)$/)?.[1];
    const answered = await databaseRoute(env, game!, what, checked);
    await logDatabaseCall(env, caller, game!, what, checked, answered[0]);
    return answer(...answered);
  }

  if (apiRoute.path === "/games/:slug/export") return answer(await exportSummary(env, game!));
  if (apiRoute.path === "/games/:slug/export/download") return exportDownload(env, game!, caller, (readMethod, readPath) => apiCall(env, { ...caller, banScope: null }, readMethod, readPath));
  if (apiRoute.path.startsWith("/games/:slug/secrets")) return answer(...(await secretsRoute(request, env, game!, pathValues.secret_name, caller, checked)));
  if (apiRoute.path.startsWith("/games/:slug/kept-room-restores") || apiRoute.path.startsWith("/games/:slug/kept-rooms/:room_code/restores")) return answer(...(await keptRoomRestoresRoute(env, game!, apiRoute.path, caller, checked, request.method)));
  if (apiRoute.path.startsWith("/games/:slug/kept-rooms")) return answer(...(await keptRoomsRoute(request, env, game!, pathValues.room_code, caller)));
  if (apiRoute.path.startsWith("/games/:slug/rooms")) return answer(...(await roomsRoute(request, env, game!, apiRoute.path, pathValues.room_code, caller, checked)));
  if (apiRoute.path.startsWith("/games/:slug/room-messages")) return answer(...(await roomMessagesRoute(request, env, game!, pathValues.scheduled_room_message_id, caller, checked)));
  if (apiRoute.path.startsWith("/games/:slug/items")) return answer(...(await itemsRoute(request, env, game!, pathValues.item_name, caller, checked)));
  if (apiRoute.path === "/games/:slug/purchase-settings") return answer(...(await purchaseSettingsRoute(env, game!, caller, checked)));
  if (apiRoute.path.startsWith("/games/:slug/purchases")) return answer(...(await purchasesRoute(request, env, game!, pathValues.purchase_id, apiRoute.path.endsWith("/refund") ? "refund" : apiRoute.path.endsWith("/handled") ? "handled" : null, caller, checked)));
  if (apiRoute.path === "/games/:slug/players/:player_id/items") return answer(...(await playerItemsRoute(env, game!, pathValues.player_id!)));
  if (apiRoute.path.startsWith("/games/:slug/shader") || apiRoute.path.startsWith("/games/:slug/backgrounds")) return answer(...(await backgroundsRoute(request, env, game!, apiRoute.path, caller, checked)));

  if (apiRoute.path.startsWith("/games/:slug/saves")) {
    const answered = await savesRoute(request, env, game!, pathValues.player_id, apiRoute.path.includes("/copies"), pathValues.save_copy_id, apiRoute.path.endsWith("/restore"), checked);
    await logSavesCall(env, caller, game!, method, Boolean(pathValues.player_id) && (!apiRoute.path.includes("/copies") || Boolean(pathValues.save_copy_id)));
    return answer(...answered);
  }

  if (!game) throw new ApiError("not_found", { message: `There's no API call at ${path}.`, fix: "docs/DEVELOPER-API.md lists every call; paths start with /api/dev, like GET /api/dev/games." });
  const isImages = apiRoute.path.startsWith("/games/:slug/images");

  if (apiRoute.path === "/games/:slug" && method === "DELETE") return answer(...(await deleteOwnGame(env, game, checked.body, caller)));
  if (apiRoute.path === "/games/:slug/bring-back") return answer(...(await bringBackGame(env, game, caller)));
  if (apiRoute.path === "/games/:slug/erase-now") return answer(...(await eraseGameNow(env, game, checked.body, caller)));
  if (apiRoute.path === "/games/:slug/deletion-requests/:game_deletion_request_id") {
    const requestId = pathValues.game_deletion_request_id!;
    checkIdKind("game_deletion_request", requestId, "game_deletion_request_id", "A game deletion request's ID comes with confirmation_needed (game_deletion_request_id).");
    const request = await gameDeletionRequestAnswer(env, caller.accountId, requestId, game.id);
    if (!request) throw new ApiError("no_game_deletion_request", { message: `This game has no deletion request ${JSON.stringify(requestId.slice(0, 60))}.`, field: "game_deletion_request_id", fix: "The ID comes with confirmation_needed (game_deletion_request_id) when a deletion needs the developer's passkey." });
    return answer({ game_deletion_request: request });
  }

  if (!isImages && method === "GET") {
    const [images, shaders, backgrounds, versions, testers, alertsByGameId, playingNow, rooms] = await Promise.all([
      imagesForGame(env.DB, game.id),
      shadersForGame(env.DB, game.id),
      backgroundsAnswer(env, game),
      versionsForGame(env.DB, game.id),
      testerLinks(env.DB, game.id),
      gameAlerts(env, [game]),
      playingNowCounts(env),
      game.multiplayer_mode !== "none" ? listRooms(env.DB, game.id) : null,
    ]);
    const performanceChecks = await performanceChecksFor(env, versions.map((version) => version.id));
    const reviewFacts = await aiReviewFacts(env, game, versions);
    return answer({
      game: await gameJson(env, game),
      alerts: alertsByGameId.get(game.id)!,
      // The exact number, whatever the public minimum: it's the developer's own game. As on the game page, the larger of browsers and rooms.
      playing_now_player_count: Math.max(playingNow.get(game.id) ?? 0, rooms?.playing.playerCount ?? 0),
      images: images.map((image) => imageJson(env, image)),
      backgrounds,
      shaders: await shadersAnswer(env, shaders),
      versions: versions.map((version) => versionJson(env, game, version, performanceChecks.get(version.id) ?? null, reviewFacts)),
      testers: await Promise.all(testers.map((link) => testerJson(env, link))),
    });
  }

  if (!isImages && method === "PATCH") {
    const { monthly_budget_cents: budgetGiven, ...detailBody } = checked.body;
    const change = await settledPaidGame(env, game, settledMinimumAge(game, checkDetailsOrThrow(detailBody)));
    if (budgetGiven !== undefined) await changeBudget(env, game, budgetGiven, caller);
    if (game.review_status === "removed" && change.visibility) {
      throw gameRemoved(game, "its visibility can't change", "visibility");
    }
    // A listed game shows players what it is: at least one screenshot, sent (one waiting for review counts).
    if (change.visibility === "listed" && game.visibility !== "listed") {
      const screenshot = await env.DB.prepare("SELECT id FROM game_images WHERE game_id = ? AND kind = 'screenshot' AND review_status != 'rejected' LIMIT 1").bind(game.id).first();
      if (!screenshot) {
        throw new ApiError("screenshot_needed", {
          message: `${game.slug} has no screenshot, and a listed game needs at least one.`,
          field: "visibility",
          fix: "Add a screenshot with add_image (kind screenshot), then set visibility listed again; or set it unlisted, for people with the link.",
        });
      }
    }
    if (change.minimum_player_age_years !== undefined && change.minimum_player_age_years < LIFELIKE_GORE_MINIMUM_PLAYER_AGE_YEARS && game.minimum_player_age_years >= LIFELIKE_GORE_MINIMUM_PLAYER_AGE_YEARS) {
      const showsGore = await goreVersionPlayersCanReach(env, game);
      if (showsGore) {
        throw new ApiError("content_needs_minimum_age", {
          message: `Version ${showsGore.id} shows lifelike gore, which plays only in games for 16 and up.`,
          field: "minimum_player_age_years",
          fix: "Publish a version with stylized gore first (and point tester links at it), then set minimum_player_age_years to 13.",
        });
      }
    }
    const { multiplayer_mode: multiplayerMode, game_server_allowed_hosts: allowedHosts, own_server_urls: ownServerUrls, links, ...asked } = change;
    // What other people can reach waits for the review: a hidden game takes this visibility once its live version's review lets it through.
    const reviewForVisibility = asked.visibility ? await visibilityRoute(env, game, asked.visibility) : null;
    const details = reviewForVisibility?.route === "now" || !reviewForVisibility ? asked : { ...asked, visibility: undefined };
    if (asked.title !== undefined && asked.title !== game.title) await refuseZaismaInTitle(env, asked.title, game.owner_id);
    const changesMultiplayer = multiplayerMode !== undefined && multiplayerMode !== game.multiplayer_mode;
    if (changesMultiplayer && game.multiplayer_mode === "built-in") {
      throw new ApiError("built_in_server", { message: "This game runs a game server built into Zaisma, which only Zaisma changes.", field: "multiplayer_mode", fix: "Leave multiplayer_mode out, or ask Zaisma with message_zaisma to change it." });
    }
    // Sites new to the list are checked against Cloudflare's malware and phishing list now; the others keep their last check.
    const checkedLinks = links ? await checkLinkSites(links, linksOf(game), { dnsUrl: env.LINK_CHECK_DNS_URL }) : undefined;
    const { isWaitingForReview } = await applyDetails(env.DB, game, { ...details, ...(changesMultiplayer ? { multiplayer_mode: multiplayerMode } : {}), ...(allowedHosts ? { game_server_allowed_hosts: allowedHosts } : {}), ...(ownServerUrls ? { own_server_urls: ownServerUrls } : {}), ...(checkedLinks ? { links: checkedLinks } : {}) });
    if ((details.title !== undefined && details.title !== game.title) || (details.description !== undefined && details.description !== game.description)) await queueListingCheck(env, game.id);
    if (Object.keys(details).length) {
      await audit(env.DB, game.id, "details", Object.keys(details).join(", ") + (isWaitingForReview ? " (words waiting for review)" : ""), caller.actor);
      await logCallerEvent(env, caller, "details_changed", { gameId: game.id });
    }
    if (changesMultiplayer) {
      await audit(env.DB, game.id, "multiplayer", `Multiplayer: ${multiplayerMode}`, caller.actor);
      await logCallerEvent(env, caller, "multiplayer_changed", { gameId: game.id });
    }
    if (allowedHosts) {
      await audit(env.DB, game.id, "allowed-hosts", `Game server can call: ${allowedHosts.join(", ") || "no other servers"}`, caller.actor);
      await logCallerEvent(env, caller, "allowed_hosts_changed", { gameId: game.id });
    }
    if (ownServerUrls) {
      await audit(env.DB, game.id, "own-servers", `Own servers: ${ownServerUrls.join(", ") || "none"}`, caller.actor);
      await logCallerEvent(env, caller, "own_servers_changed", { gameId: game.id });
    }
    if (checkedLinks) {
      await audit(env.DB, game.id, "links", `Links: ${checkedLinks.map((link) => `${link.link_name} ${link.destination_url}`).join(", ") || "none"}`, caller.actor);
      await logCallerEvent(env, caller, "links_changed", { gameId: game.id });
    }
    const reviewSteps = reviewForVisibility ? await applyVisibilityRoute(env, game, asked.visibility!, reviewForVisibility, caller.actor) : [];
    const gameServerProblem = multiplayerMode === "own" ? await liveServerProblem(env, game) : null;
    const changed = (await gameBySlug(env.DB, game.slug))!;
    // Setting the game for 16 or 18 and up passes the versions held only for lifelike gore.
    const passedForGore = change.minimum_player_age_years !== undefined && change.minimum_player_age_years >= LIFELIKE_GORE_MINIMUM_PLAYER_AGE_YEARS ? await passVersionsHeldForGore(env, changed, caller.actor) : [];
    // A game that now sells itself states its refund policy before anything goes on sale.
    const refundPolicySteps: NextStep[] = change.full_game_item_name && !changed.refund_policy
      ? [{ tool: "set_purchase_settings", arguments: { slug: game.slug }, after_sec: null, reason: "A game states its refund policy before anything goes on sale: players can't buy the full game until set_purchase_settings sets refund_policy." }]
      : [];
    const goreSteps: NextStep[] = passedForGore.length
      ? [{ tool: "get_version", arguments: { slug: game.slug, version_id: passedForGore[0]!.id }, after_sec: null, reason: "It passed now that the game is for 16 and up." }]
      : [];
    return answer({
      game: await gameJson(env, changed),
      review_message: isWaitingForReview ? "The new title or description is checked in about a minute, then shows." : null,
      game_server_problem: gameServerProblem,
      next_steps: [...reviewSteps, ...goreSteps, ...refundPolicySteps, ...(await nextStepsAfterDetails(env, changed, gameServerProblem))],
    });
  }

  if (isImages && method === "POST") {
    const kind = checked.query.get("kind") as ImageKind;
    if (!IMAGE_KINDS.includes(kind)) {
      throw new ApiError("bad_kind", {
        message: `kind ${JSON.stringify(kind)} isn't cover, square, screenshot, share, background, phone_background or shader_texture.`,
        field: "kind",
        fix: "Give kind cover (landscape, 16:9 shows best), square (as wide as tall, shown on phones), screenshot, share (the picture shared links show instead of the cover, 1200 by 630 shows best), background (the game's world behind the page on wide screens, no title on it), phone_background (the same, composed for a tall phone screen) or shader_texture (a picture a background shader reads through a channel) (?kind= in the API).",
      });
    }
    // A shader's texture is a picture of its own size: up to 8 MB and 4096 px a side, as small as it likes (noise is often 256 px).
    const isTexture = kind === "shader_texture";
    const maximumSizeBytes = isTexture ? SHADER_LIMITS.maximumTextureSizeBytes : IMAGE_LIMITS.maximumSizeBytes;
    const tooBig = () =>
      isTexture
        ? new ApiError("shader_texture_too_big", { message: `The texture is over ${maximumSizeBytes / 1048576} MB.`, field: "image_base64", fix: "Save it smaller (a JPEG or WebP, or fewer pixels; a shader samples it with mipmaps) and send it again." })
        : new ApiError("image_too_big", { message: "The image is over 5 MB.", field: "image_base64", fix: "Save it smaller (a JPEG or WebP, or fewer pixels) and send it again." });
    const bytes = await readBodyBytes(request, maximumSizeBytes).catch((error: unknown) => {
      throw error instanceof BodyPastCapError ? tooBig() : error;
    });
    const sniffed = sniffImage(bytes);
    if (!sniffed) throw new ApiError("not_an_image", { message: "That isn't a PNG, JPEG or WebP image.", field: "image_base64", fix: "Send a PNG, JPEG or WebP file (the image itself as the body in the API); SVG and other types aren't taken." });
    const { widthPx, heightPx } = sniffed;
    if (isTexture && Math.max(widthPx, heightPx) > SHADER_LIMITS.maximumTextureSidePx) {
      throw new ApiError("shader_texture_too_big", { message: `The texture is ${widthPx} by ${heightPx} px.`, field: "image_base64", fix: `Make it at most ${SHADER_LIMITS.maximumTextureSidePx} px on each side, like 1024 by 1024.` });
    }
    if (!isTexture && (Math.min(widthPx, heightPx) < IMAGE_LIMITS.minimumSidePx || Math.max(widthPx, heightPx) > IMAGE_LIMITS.maximumSidePx)) {
      throw new ApiError("bad_image_dimensions", {
        message: `The image is ${widthPx} by ${heightPx} px.`,
        field: "image_base64",
        fix: `Make it at least ${IMAGE_LIMITS.minimumSidePx} px on each side and at most ${IMAGE_LIMITS.maximumSidePx.toLocaleString("en-US")} px, like 1920 by 1080 for a cover.`,
      });
    }
    if (kind === "square" && (!isSquare(widthPx, heightPx) || widthPx < IMAGE_LIMITS.minimumSquareSidePx)) {
      throw new ApiError("not_square", { message: `The square cover is ${widthPx} by ${heightPx} px.`, field: "image_base64", fix: `Make it as wide as it is tall, at least ${IMAGE_LIMITS.minimumSquareSidePx} px, like 1024 by 1024; or send it as kind cover.` });
    }
    if ((kind === "background" || kind === "phone_background") && !isBackgroundShape(kind, widthPx, heightPx)) {
      throw new ApiError("bad_background_shape", {
        message: `The ${kind === "background" ? "wide" : "phone"} background is ${widthPx} by ${heightPx} px.`,
        field: "image_base64",
        fix:
          kind === "background"
            ? `Make it landscape, ${IMAGE_LIMITS.minimumWideBackgroundRatio} to ${IMAGE_LIMITS.maximumWideBackgroundRatio} times as wide as tall, at least ${IMAGE_LIMITS.minimumBackgroundLongSidePx} px wide, like 2560 by 1440; a portrait one is kind phone_background.`
            : `Make it portrait, ${IMAGE_LIMITS.minimumPhoneBackgroundRatio} to ${IMAGE_LIMITS.maximumPhoneBackgroundRatio} times as tall as wide, at least ${IMAGE_LIMITS.minimumBackgroundLongSidePx} px tall, like 1440 by 3120; a landscape one is kind background.`,
      });
    }
    // Matched against known abuse material before anyone sees it. A match is kept for reporting, never shown.
    // If matching fails, the picture waits for a person as usual.
    const matched = await imageMatcher(env).check([{ path: `${kind} image`, type: sniffed.type, id: "upload", body: async () => bytes }]);
    if (matched.findings.some((finding) => finding.code === KNOWN_IMAGE_CODE)) {
      const id = newId("image");
      await env.GAMES.put(heldImageKey(game.id, id), bytes, { httpMetadata: { contentType: sniffed.type } });
      await audit(env.DB, game.id, "image-held", `A ${kind} upload matched known abuse material. Kept at ${heldImageKey(game.id, id)}; never shown.`, caller.actor);
      await logCallerEvent(env, caller, "image_refused", { gameId: game.id, subjectName: kind });
      await sendAlert(env, `URGENT: known abuse image uploaded to ${game.slug}`, `${KNOWN_IMAGE_ALERT}\n\nA ${kind} upload, kept at ${heldImageKey(game.id, id)} in the games bucket.\n\nGame: ${env.SITE_ORIGIN}/admin/games/${game.id}`);
      throw new ApiError("image_refused", { message: "This image can't be used.", field: "image_base64", fix: "Use a different image." });
    }
    const existing = await imagesForGame(env.DB, game.id);
    const waitingImages = existing.filter((image) => image.kind === kind && image.review_status === "pending");
    if (kind === "screenshot" && existing.filter((image) => image.kind === "screenshot" && image.review_status !== "rejected").length >= IMAGE_LIMITS.maximumScreenshotCount) {
      throw new ApiError("too_many_screenshots", { message: `The game has ${IMAGE_LIMITS.maximumScreenshotCount} screenshots, the most it can have.`, fix: "Remove one with remove_image (its image_id from get_game) first." });
    }
    if (isTexture && existing.filter((image) => image.kind === "shader_texture" && image.review_status !== "rejected").length >= SHADER_LIMITS.maximumGameTextureCount) {
      throw new ApiError("too_many_shader_textures", { message: `The game has ${SHADER_LIMITS.maximumGameTextureCount} shader textures, the most it can keep.`, fix: "Remove one no shader reads with remove_image (its image_id from get_game) first." });
    }
    if (!MANY_IMAGE_KINDS.includes(kind) && waitingImages.length) {
      // Only the newest cover of each kind waits for review.
      for (const old of waitingImages) {
        await env.GAMES.delete([imageKey(old), ...imageCopyKeys(old)]);
        await deleteImageRow(env.DB, old.id);
      }
    }
    const id = newId("image");
    await env.GAMES.put(imageKey({ game_id: game.id, id }), bytes, { httpMetadata: { contentType: sniffed.type } });
    let image = await addImage(env.DB, { id, game_id: game.id, kind, content_type: sniffed.type, width_px: widthPx, height_px: heightPx, size_bytes: bytes.byteLength });
    // A background's tone, measured now from the whole picture, so pages can open on its color with its glass right.
    const tone = kind === "background" || kind === "phone_background" ? await toneOfPicture(env, bytes) : null;
    if (tone) { await setBackgroundTone(env.DB, "game_images", id, tone); image = { ...image, ...tone }; }
    await audit(env.DB, game.id, "image-added", `${kind} ${id}`, caller.actor);
    await logCallerEvent(env, caller, "image_added", { gameId: game.id, subjectName: kind });
    if (isTexture) {
      // Image matching is a texture's whole check: what a shader draws with it is checked in the shader's frames. When matching
      // couldn't answer, it waits for a person, as any picture does.
      if (matched.isConnected) {
        await settleImage(env.DB, image, null, "check");
        image = { ...image, review_status: "approved" };
      }
      return answer(
        {
          image: imageJson(env, image),
          review_message: image.review_status === "approved" ? "It's ready: a shader's channel reads it by its image_id (input_kind texture)." : "Image matching couldn't check it just now, so a person looks, usually within a day; get_game shows when it's approved.",
          next_steps: (image.review_status === "approved" ? [] : [{ tool: "get_game", arguments: { slug: game.slug }, after_sec: 3600, reason: "A person approves it: get_game shows its review_status." }]) satisfies NextStep[],
        },
        201,
      );
    }
    await queueListingCheck(env, game.id);
    return answer(
      {
        image: imageJson(env, image),
        review_message: "It's checked in about a minute, then shows on the game page. zaisma.com/developers/covers shows what passes.",
        next_steps: [{ tool: "get_game", arguments: { slug: game.slug }, after_sec: 60, reason: "The check takes about a minute: get_game shows whether the image passed, and anything that keeps the game off Zaisma's lists (each image's listing_reason, and the game_off_lists alert)." }] satisfies NextStep[],
      },
      201,
    );
  }

  if (isImages && method === "DELETE") {
    const imageId = pathValues.image_id!;
    const imageFix = "get_game lists the game's images with their IDs.";
    checkIdKind("image", imageId, "image_id", imageFix);
    const image = await imageById(env.DB, imageId);
    if (!image || image.game_id !== game.id) throw new ApiError("no_image", { message: `${game.slug} has no image with the ID ${imageId}.`, field: "image_id", fix: imageFix });
    const readers = image.kind === "shader_texture" ? await shadersReadingTexture(env, game.id, image.id) : [];
    if (readers.length) {
      throw new ApiError("shader_texture_in_use", {
        message: `${readers.length === 1 ? "A shader" : `${readers.length} shaders`} the game keeps ${readers.length === 1 ? "reads" : "read"} this texture (${readers.map((reader) => reader.id).join(", ")}).`,
        field: "image_id",
        fix: "Remove those shaders with remove_shader first, or send them again without it.",
      });
    }
    // A listed game keeps at least one screenshot, as when it became listed.
    if (game.visibility === "listed" && image.kind === "screenshot" && image.review_status !== "rejected") {
      const other = await env.DB.prepare("SELECT id FROM game_images WHERE game_id = ? AND kind = 'screenshot' AND review_status != 'rejected' AND id != ? LIMIT 1").bind(game.id, image.id).first();
      if (!other) {
        throw new ApiError("screenshot_needed", {
          message: `${game.slug} is listed and this is its last screenshot.`,
          field: "image_id",
          fix: "Add another screenshot with add_image (kind screenshot) first, or set visibility unlisted.",
        });
      }
    }
    await env.GAMES.delete([imageKey(image), ...imageCopyKeys(image)]);
    await dropChosenBackground(env.DB, game.id, { imageId: image.id });
    await deleteImageRow(env.DB, image.id);
    await audit(env.DB, game.id, "image-removed", `${image.kind} ${image.id}`, caller.actor);
    await logCallerEvent(env, caller, "image_removed", { gameId: game.id, subjectName: image.kind });
    // A cover is judged beside the screenshots, so removing one checks the rest again.
    if (image.kind !== "shader_texture") await queueListingCheck(env, game.id);
    return answer({ removed_image_id: image.id, next_steps: [] satisfies NextStep[] });
  }

  throw badMethod(method, path);
}

/** A method the path doesn't take. */
function badMethod(method: string, path: string): ApiError {
  return new ApiError("bad_method", { message: `${method} isn't a call at ${path}.`, fix: "docs/DEVELOPER-API.md lists the methods each path takes." });
}

/** Shown text from the API, checked (checkShownText), or the error answer: bad_<field>. */
export function shownTextOrThrow(input: unknown, options: ShownTextOptions): string {
  const checked = checkShownText(input, options);
  if ("problem" in checked) {
    const { field, message, fix, messageForPeople } = checked.problem;
    throw new ApiError(`bad_${field}` as ErrorCode, { message, field, fix, messageForPeople });
  }
  return checked.text;
}

/** A game's new details, checked, or the error answer for the first input that's wrong. */
/**
 * A game's monthly budget, what it may draw from its developer's credit (docs/DECISIONS.md, "Hosting is priced with
 * a margin…"): null for no paid hosting, or whole cents of at least 100. Off or lower works with a key; a first or
 * higher budget needs the developer's passkey on zaisma.com. Lower than this month's charges pauses the game at once;
 * a budget with room again starts it.
 */
async function changeBudget(env: Env, game: Game, given: unknown, caller: Caller): Promise<void> {
  if (given !== null && !(typeof given === "number" && Number.isInteger(given) && given >= 100)) {
    throw new ApiError("bad_monthly_budget_cents", {
      message: `monthly_budget_cents ${JSON.stringify(given)} isn't a budget: whole cents of at least 100 ($1), or null.`,
      field: "monthly_budget_cents",
      fix: "Give cents, not dollars: 5000 is $50 a month. null turns paid hosting off, so the game stops at its free allowance.",
    });
  }
  const budgetCents = given as number | null;
  const isRaising = budgetCents !== null && (game.monthly_budget_cents === null || budgetCents > game.monthly_budget_cents);
  if (isRaising) await checkSpendingConfirmed(env, caller, game.monthly_budget_cents === null ? "Giving a game a budget" : "Raising a game's budget", { requestKind: "game_budget", gameId: game.id, monthlyBudgetCents: budgetCents! });
  if (budgetCents === game.monthly_budget_cents) return;
  await env.DB.prepare("UPDATE games SET monthly_budget_cents = ? WHERE id = ?").bind(budgetCents, game.id).run();
  game.monthly_budget_cents = budgetCents;
  await audit(env.DB, game.id, "budget", budgetCents === null ? "No paid hosting" : `Monthly budget: ${budgetCents} cents`, caller.actor);
  await logCallerEvent(env, caller, "hosting_budget_changed", { gameId: game.id });
  const month = await gameHostingMonth(env.DB, game.id);
  if (budgetCents === null) {
    if (month.used_cents >= freeHostingEndCents(game.second_free_allowance_month_start_date, month.month_start_date, Boolean(month.has_real_players))) await pauseNow(env, game.id, "free_used");
  } else if (budgetCents <= month.charged_cents && month.charged_cents > 0) await pauseNow(env, game.id, "budget_used");
  else if (isRaising) await clearPauses(env, game.owner_id!, Date.now(), game.id);
}

function checkDetailsOrThrow(body: Record<string, unknown>) {
  const checked = checkDetails(body);
  if ("problem" in checked) {
    const { field, message, fix, messageForPeople } = checked.problem;
    // bad_<field>, for the field's own name: play_modes[1].play_style is a bad_play_modes.
    const code = (checked.problem.code ?? `bad_${field.split(/[.[]/)[0]}`) as ErrorCode;
    throw new ApiError(code, { message, field, fix, messageForPeople });
  }
  return checked.change;
}

/** A change with the game's minimum age settled: whole_game added when it's above 13, or the error answer for a contradiction. */
function settledMinimumAge(game: Pick<Game, "minimum_player_age_years" | "account_requirement">, change: DetailsChange): DetailsChange {
  const settled = settleMinimumAge(game, change);
  if ("problem" in settled) {
    const { field, message, fix, code } = settled.problem;
    throw new ApiError(code as ErrorCode, { message, field, fix });
  }
  return settled.change;
}

/** A change with the game's price to play settled (settlePaidGame): whole_game added for a paid game, the demo found, or the error answer. */
async function settledPaidGame(env: Env, game: Parameters<typeof settlePaidGame>[1], change: DetailsChange): Promise<DetailsChange> {
  const settled = await settlePaidGame(env.DB, game, change);
  if ("problem" in settled) {
    const { field, message, fix, code } = settled.problem;
    throw new ApiError(code as ErrorCode, { message, field, fix });
  }
  return settled.change;
}

/** What usually follows a change of details: publishing, when the game is now meant for players but nothing is live, or a game server. */
async function nextStepsAfterDetails(env: Env, game: Game, gameServerProblem: string | null): Promise<NextStep[]> {
  if (gameServerProblem) {
    return [{ tool: "upload_files", arguments: { slug: game.slug }, after_sec: null, reason: "Upload a version with its game server (a zaisma-server/ folder with index.js, or zaisma-server.js), then publish it: rooms open once it's live." }];
  }
  if ((game.visibility !== "listed" && game.visibility !== "unlisted") || game.live_version_id) return [];
  const versions = await versionsForGame(env.DB, game.id);
  const approved = versions.find((version) => version.scan_status === "approved");
  if (approved) return [{ tool: "publish_version", arguments: { slug: game.slug, version_id: approved.id }, after_sec: null, reason: "Players see the game once a version is live; this one passed review. Show the developer its preview_url first." }];
  const scanning = versions.find((version) => version.scan_status === "scanning");
  if (scanning) return [{ tool: "get_version", arguments: { slug: game.slug, version_id: scanning.id }, after_sec: 30, reason: "Players see the game once a version is live; this one is still being scanned." }];
  return [{ tool: "upload_files", arguments: { slug: game.slug }, after_sec: null, reason: "Players see the game once a version is live, and it has none yet." }];
}

/**
 * One file, sent whole. A file this owner already sent is answered already_stored without its bytes;
 * any other is read and its hash checked by storage, even when Zaisma already has it from someone else,
 * so the answer never says what other developers sent. Storage keeps one copy either way.
 */
async function putBlob(request: Request, env: Env, sha256: string, caller: Caller): Promise<unknown> {
  const sizeBytes = Number(request.headers.get("content-length") ?? -1);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new ApiError("no_content_length", { message: "The file came without a Content-Length header.", field: "Content-Length", fix: "Send its size in bytes as Content-Length." });
  if (sizeBytes > FILE_LIMITS.maximumDirectSizeBytes) {
    throw new ApiError("file_needs_parts", { message: `The file is over ${FILE_LIMITS.maximumDirectSizeBytes / 1048576} MB, too big to send in one go.`, fix: `Send it in parts: POST /api/dev/files/${sha256}/parts with { "size_bytes" }.` });
  }
  if ((await missingBlobs(env.DB, [sha256], caller.ownerId)).length === 0) {
    await request.body?.cancel();
    return { sha256, storage_status: "already_stored" };
  }
  if (!request.body) throw new ApiError("no_body", { message: "The file came without a body.", fix: "Send the file's bytes as the request body." });
  const storage = await storageOf(env.DB, caller.ownerId);
  await checkStoredSizeFits(env, caller, sizeBytes, storage);
  await reserveOrRefuse(env, caller.ownerId, sizeBytes, storage);
  try {
    await env.GAMES.put(blobKey(sha256), request.body, { sha256 });
  } catch (error) {
    await releaseNewData(env.DB, caller.ownerId, sizeBytes);
    // Storage checks the SHA-256 as it stores (R2's BadDigest, 10037); any other failure is ours, not the file's.
    if (!/\(10037\)|checksum you specified did not match/.test(String((error as Error)?.message ?? error))) {
      console.error("Storing a file failed", error);
      throw INTERNAL_ERROR();
    }
    throw new ApiError("hash_mismatch", { message: `The file doesn't match the SHA-256 ${sha256}.`, fix: "Hash the file again (SHA-256, lowercase hex) and send it to that hash; check it didn't change since you listed it." });
  }
  // Programs and archives aren't allowed in games, whatever they're called.
  const start = await env.GAMES.get(blobKey(sha256), { range: { offset: 0, length: 16 } });
  const forbidden = start ? forbiddenContent(new Uint8Array(await start.arrayBuffer())) : null;
  if (forbidden) {
    await env.GAMES.delete(blobKey(sha256));
    throw new ApiError("forbidden_file", { message: `The file ${sha256} looks like ${forbidden}, which games can't have whatever it's called.`, fix: "Leave it out of the game." });
  }
  await addBlob(env.DB, caller.ownerId, sha256, sizeBytes);
  return { sha256, storage_status: "stored_now" };
}

/**
 * Big files, sent in parts: start, send each part, then finish. Storage can't check the hash
 * of a file sent in parts, so the file is kept for this owner's own versions only.
 *
 *   POST /files/:sha256/parts                  { "size_bytes" }  -> { upload_id, part_size_bytes, part_count }
 *   PUT  /files/:sha256/parts/:n?upload_id=…   one part (all but the last are part_size_bytes long)
 *   POST /files/:sha256/parts/done             { "upload_id", "parts": [{ "part_number", "etag" }] }
 */
async function bigFile(request: Request, env: Env, sha256: string, step: string | undefined, caller: Caller, checked: CheckedCall): Promise<unknown> {
  const key = ownedBlobKey(caller.ownerId, sha256);
  const body = checked.body;
  if (!step && request.method === "POST") {
    const sizeBytes = body.size_bytes;
    if (!Number.isSafeInteger(sizeBytes) || (sizeBytes as number) <= 0) throw new ApiError("bad_size_bytes", { message: "size_bytes isn't a whole number above 0.", field: "size_bytes", fix: 'Send { "size_bytes": <the file\'s size in bytes> }.' });
    if ((sizeBytes as number) > FILE_LIMITS.maximumFileSizeBytes) {
      throw new ApiError("file_too_big", { message: `The file is over ${FILE_LIMITS.maximumFileSizeBytes / 1048576} MB.`, field: "size_bytes", fix: "Split it into smaller files, or ask Zaisma (message_zaisma, kind gap) if the game needs bigger ones." });
    }
    if ((await missingBlobs(env.DB, [sha256], caller.ownerId)).length === 0) return { sha256, storage_status: "already_stored", upload_id: null, part_size_bytes: null, part_count: null };
    await checkStoredSizeFits(env, caller, sizeBytes as number, await storageOf(env.DB, caller.ownerId), "size_bytes");
    const upload = await env.GAMES.createMultipartUpload(key);
    return { sha256, storage_status: "upload_started", upload_id: upload.uploadId, part_size_bytes: FILE_LIMITS.partSizeBytes, part_count: Math.ceil((sizeBytes as number) / FILE_LIMITS.partSizeBytes) };
  }
  if (step && step !== "done" && request.method === "PUT") {
    const partNumber = Number(step);
    const uploadId = checked.query.get("upload_id") ?? "";
    const sizeBytes = Number(request.headers.get("content-length") ?? -1);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
      throw new ApiError("bad_part_number", { message: `${JSON.stringify(step)} isn't a part number from 1 to 10,000.`, field: "part_number", fix: `Number the parts from 1: PUT /api/dev/files/${sha256}/parts/1?upload_id=…` });
    }
    if (!uploadId) throw new ApiError("no_upload_id", { message: "The part came without its upload_id.", field: "upload_id", fix: `Add ?upload_id= with the upload_id from POST /api/dev/files/${sha256}/parts.` });
    if (!(sizeBytes > 0 && sizeBytes <= FILE_LIMITS.partSizeBytes) || !request.body) {
      throw new ApiError("bad_part_size", { message: `Part ${partNumber} is empty, over ${FILE_LIMITS.partSizeBytes / 1048576} MB or has no Content-Length header.`, field: "Content-Length", fix: `Send each part but the last as exactly part_size_bytes (${FILE_LIMITS.partSizeBytes} bytes), with its Content-Length.` });
    }
    await reserveOrRefuse(env, caller.ownerId, sizeBytes, await storageOf(env.DB, caller.ownerId));
    try {
      const part = await env.GAMES.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, request.body);
      return { part_number: part.partNumber, etag: part.etag };
    } catch {
      await releaseNewData(env.DB, caller.ownerId, sizeBytes);
      throw new ApiError("upload_closed", { message: "That upload_id isn't an open upload any more.", field: "upload_id", fix: `Start again with POST /api/dev/files/${sha256}/parts.` });
    }
  }
  if (step === "done" && request.method === "POST") {
    const parts = Array.isArray(body.parts) ? (body.parts as { part_number?: unknown; etag?: unknown }[]) : [];
    if (typeof body.upload_id !== "string" || !parts.length || !parts.every((part) => Number.isInteger(part.part_number) && typeof part.etag === "string")) {
      throw new ApiError("bad_parts", { message: 'The body isn\'t { "upload_id", "parts": [{ "part_number", "etag" }] }.', field: typeof body.upload_id === "string" ? "parts" : "upload_id", fix: "Send the upload_id and every part's part_number and etag, as each part's answer gave them." });
    }
    let stored: R2Object;
    try {
      stored = await env.GAMES.resumeMultipartUpload(key, body.upload_id).complete(parts.map((part) => ({ partNumber: part.part_number as number, etag: part.etag as string })));
    } catch {
      throw new ApiError("parts_incomplete", { message: "Those parts don't make a whole file.", field: "parts", fix: "Check every part was sent and each etag is the one its answer gave, then finish again; or start again if the upload_id is old." });
    }
    if (stored.size > FILE_LIMITS.maximumFileSizeBytes) {
      await env.GAMES.delete(key);
      throw new ApiError("file_too_big", { message: `The file is over ${FILE_LIMITS.maximumFileSizeBytes / 1048576} MB.`, fix: "Split it into smaller files, or ask Zaisma (message_zaisma, kind gap) if the game needs bigger ones." });
    }
    // The real size this time, however small the start's size_bytes said it was.
    const isHeld = (await missingBlobs(env.DB, [sha256], caller.ownerId)).length === 0;
    if (!isHeld) {
      try {
        await checkStoredSizeFits(env, caller, stored.size, await storageOf(env.DB, caller.ownerId));
      } catch (error) {
        await env.GAMES.delete(key);
        throw error;
      }
    }
    const start = await env.GAMES.get(key, { range: { offset: 0, length: 16 } });
    const forbidden = start ? forbiddenContent(new Uint8Array(await start.arrayBuffer())) : null;
    if (forbidden) {
      await env.GAMES.delete(key);
      throw new ApiError("forbidden_file", { message: `The file ${sha256} looks like ${forbidden}, which games can't have whatever it's called.`, fix: "Leave it out of the game." });
    }
    await addOwnedBlob(env.DB, caller.ownerId, sha256, stored.size);
    return { sha256, storage_status: "stored_now", size_bytes: stored.size };
  }
  throw badMethod(request.method, new URL(request.url).pathname);
}

async function versionRoute(request: Request, env: Env, game: Game, what: "uploads" | "versions", id: string | undefined, isPublish: boolean, isAiReview: boolean, caller: Caller, checked: CheckedCall): Promise<[unknown, number?]> {
  const method = request.method;
  const body = checked.body;
  if (game.review_status === "removed" && method !== "GET") {
    throw gameRemoved(game, "it can't get new versions or publish");
  }

  // Step 1: which of these files do you still need to send?
  if (what === "uploads" && !id && method === "POST") {
    const files = listOrThrow(body.files);
    const missing = await missingBlobs(env.DB, files.map((file) => file.sha256), caller.ownerId);
    // The whole game must fit in what the account can store; each file checks the day's new data as it comes, so a game too big for one day goes up over several.
    const missingHashes = new Set(missing);
    const sizeByMissingHash = new Map(files.filter((file) => missingHashes.has(file.sha256)).map((file) => [file.sha256, file.size_bytes]));
    await checkStoredSizeFits(env, caller, [...sizeByMissingHash.values()].reduce((totalSizeBytes, sizeBytes) => totalSizeBytes + sizeBytes, 0), await storageOf(env.DB, caller.ownerId), "files");
    return [{ file_count: files.length, size_bytes: files.reduce((totalSizeBytes, file) => totalSizeBytes + file.size_bytes, 0), missing_file_hashes: missing }];
  }

  // Step 2: make the version once every file is stored. It's scanned, then waits as a draft.
  if (what === "versions" && !id && method === "POST") {
    // The router checked every file is stored for this caller (storedFiles), and publish_when_approved's access.
    const { list: files, found } = checked.files!;
    if (body.publish_when_approved !== undefined && typeof body.publish_when_approved !== "boolean") {
      throw new ApiError("bad_publish_when_approved", { message: "publish_when_approved isn't true or false.", field: "publish_when_approved", fix: "Send true to go live as soon as it passes the scan, or leave it out to publish yourself." });
    }
    if (body.match_update_mode !== undefined && body.publish_when_approved !== true) {
      throw new ApiError("bad_match_update_mode", {
        message: "match_update_mode came without publish_when_approved true, so there's no publish for it to apply to.",
        field: "match_update_mode",
        fix: "Send it with publish_when_approved true, or give it to publish_version when you publish.",
      });
    }
    if (body.publish_after_ai_review_enabled !== undefined && (typeof body.publish_after_ai_review_enabled !== "boolean" || body.publish_when_approved !== true)) throw badPublishAfterAiReview(typeof body.publish_after_ai_review_enabled === "boolean");
    const uploadMatchUpdateMode = readMatchUpdateMode(body.match_update_mode);
    const patchNotes = body.patch_notes === undefined ? "" : shownTextOrThrow(body.patch_notes, { field: "patch_notes", maximumCharacterCount: FILE_LIMITS.maximumPatchNotesCharacterCount, isMultiline: true });
    if (body.is_big_update !== undefined && (typeof body.is_big_update !== "boolean" || body.publish_when_approved !== true)) {
      throw new ApiError("bad_is_big_update", {
        message: typeof body.is_big_update !== "boolean" ? "is_big_update isn't true or false." : "is_big_update came without publish_when_approved true, so there's no publish for it to apply to.",
        field: "is_big_update",
        fix: "Send true with publish_when_approved true, or give it to publish_version when you publish.",
      });
    }
    if (body.is_big_update === true && !patchNotes) throw bigUpdateNeedsNotes();
    const today = await env.DB.prepare("SELECT COUNT(*) AS version_count, MIN(created_at_ms) AS oldest_at_ms FROM versions WHERE game_id = ? AND created_at_ms > ?")
      .bind(game.id, Date.now() - DAY_MS)
      .first<{ version_count: number; oldest_at_ms: number | null }>();
    if ((today?.version_count ?? 0) >= FILE_LIMITS.maximumVersionsPerDay) {
      throw new ApiError("version_limit", {
        message: `${game.slug} has had ${FILE_LIMITS.maximumVersionsPerDay} versions in the last day, the most a game can.`,
        fix: "Wait until the oldest is a day old, then upload again; meanwhile test with the latest version's preview_url.",
        retryAfterSec: secondsUntilDayPasses(today?.oldest_at_ms),
      });
    }
    const versionId = newId("version");
    const manifest = toManifest(files, found, caller.ownerId);
    await env.GAMES.put(manifestKey(versionId), JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });
    await createVersion(env.DB, {
      id: versionId,
      gameId: game.id,
      r2Prefix: `manifests/${versionId}`,
      fileCount: files.length,
      sizeBytes: files.reduce((totalSizeBytes, file) => totalSizeBytes + file.size_bytes, 0),
      kind: "files",
      patchNotes,
      publishWhenApprovedEnabled: body.publish_when_approved === true,
      publishAfterAiReviewEnabled: body.publish_after_ai_review_enabled === true,
      matchUpdateMode: uploadMatchUpdateMode,
      isBigUpdate: body.is_big_update === true,
    });
    await audit(env.DB, game.id, "upload", `${versionId}, ${files.length} files`, caller.actor);
    await logCallerEvent(env, caller, "version_uploaded", { gameId: game.id, versionId });
    await queueCompression(env, manifest, files);
    await replaceWaitingVersions(env, game.id, versionId);
    await env.SCAN_QUEUE.send({ versionId });
    const reason = body.publish_when_approved === true ? "It goes live by itself once it passes, or once its AI review does when other people can reach the game and the developer is still earning going first; the scan usually takes under a minute." : "The scan usually takes under a minute; once it passes, show the developer its preview_url.";
    return [{ version: await versionAnswer(env, game, (await versionById(env.DB, versionId))!), next_steps: [{ tool: "get_version", arguments: { slug: game.slug, version_id: versionId }, after_sec: 30, reason }] satisfies NextStep[] }, 201];
  }

  const versionFix = "get_game lists the game's versions with their IDs, newest first.";
  checkIdKind("version", id, "version_id", versionFix);
  const version = id ? await versionById(env.DB, id) : null;
  if (id && (!version || version.game_id !== game.id)) throw new ApiError("no_version", { message: `${game.slug} has no version with the ID ${id}.`, field: "version_id", fix: versionFix });

  if (version && !isPublish && method === "GET") return [{ version: await versionAnswer(env, game, version) }];
  if (version && !isPublish && method === "DELETE") return deleteOwnVersion(env, game, version, caller);

  // Start the review ahead of a launch, with nothing published. A repeat answers where it stands.
  if (version && isAiReview && method === "POST") {
    if (version.scan_status === "scanning") throw new ApiError("still_scanning", { message: "This version is still being scanned.", field: "version_id", fix: "Wait for scan_status approved (get_version), then start its review.", retryAfterSec: 30 });
    if (version.scan_status !== "approved") throw notApproved(game, version);
    if (env.ANTHROPIC_API_KEY) await requestAiReview(env, game, version, caller.actor);
    else if (version.ai_review_status === "not_started") await holdForPerson(env, game, version);
    await logCallerEvent(env, caller, "ai_review_started", { gameId: game.id, versionId: version.id });
    const reviewed = await versionAnswer(env, game, (await versionById(env.DB, version.id))!);
    return [{ version: reviewed, next_steps: aiReviewSteps(game, reviewed) }];
  }

  // Publish later: { "scheduled_publish_at": "2026-11-01T17:00:00Z" }. It goes live then if it has passed review.
  if (version && isPublish && method === "POST" && body.scheduled_publish_at !== undefined) {
    ageMustAllowVersion(game, version, "version_id");
    const scheduledAtMs = typeof body.scheduled_publish_at === "string" && ISO_TIME.test(body.scheduled_publish_at) ? Date.parse(body.scheduled_publish_at) : NaN;
    if (!Number.isFinite(scheduledAtMs) || scheduledAtMs <= Date.now() + 60_000 || scheduledAtMs > Date.now() + 90 * DAY_MS) {
      const said = typeof body.scheduled_publish_at === "string" ? `"${body.scheduled_publish_at.slice(0, 40)}"` : `a ${typeof body.scheduled_publish_at}`;
      throw new ApiError("bad_time", {
        message: Number.isFinite(scheduledAtMs) ? `scheduled_publish_at ${said} isn't from a few minutes to 90 days ahead.` : `scheduled_publish_at is ${said}, not an ISO time.`,
        field: "scheduled_publish_at",
        fix: `Give an ISO time with Z or an offset, from 2 minutes to 90 days ahead, like "${new Date(Date.now() + DAY_MS).toISOString().slice(0, 14)}00:00Z". Leave it out to publish now.`,
      });
    }
    if (version.scan_status !== "approved" && version.scan_status !== "scanning") throw notApproved(game, version);
    const scheduledMatchUpdateMode = readMatchUpdateMode(body.match_update_mode);
    const scheduledMark = readPublishMark(body, game, version);
    await env.DB.prepare("UPDATE versions SET scheduled_publish_at_ms = ?, match_update_mode = ?, is_big_update = ?, patch_notes = ?, publish_after_ai_review_enabled = ? WHERE id = ?").bind(scheduledAtMs, scheduledMatchUpdateMode, scheduledMark.isBigUpdate, scheduledMark.patchNotes, readPublishAfterAiReview(body, version), version.id).run();
    await audit(env.DB, game.id, "publish-scheduled", `${version.id} at ${iso(scheduledAtMs)}`, caller.actor);
    await logCallerEvent(env, caller, "publish_scheduled", { gameId: game.id, versionId: version.id });
    const nextSteps: NextStep[] =
      version.scan_status === "scanning" ? [{ tool: "get_version", arguments: { slug: game.slug, version_id: version.id }, after_sec: 30, reason: "It goes live at scheduled_publish_at only if it has passed the scan by then. Its AI review starts by itself up to a day ahead when other people can reach the game." }] : [];
    return [{ game: await gameJson(env, game), version: await versionAnswer(env, game, (await versionById(env.DB, version.id))!), next_steps: nextSteps }];
  }
  if (version && isPublish && method === "DELETE") {
    await env.DB.prepare("UPDATE versions SET scheduled_publish_at_ms = NULL, is_big_update = CASE WHEN published_at_ms IS NULL THEN 0 ELSE is_big_update END WHERE id = ?").bind(version.id).run();
    await audit(env.DB, game.id, "publish-unscheduled", version.id, caller.actor);
    await logCallerEvent(env, caller, "publish_unscheduled", { gameId: game.id, versionId: version.id });
    return [{ game: await gameJson(env, game), version: await versionAnswer(env, game, (await versionById(env.DB, version.id))!), next_steps: [] satisfies NextStep[] }];
  }

  // Publish a draft now, or roll back to any version we've kept.
  if (version && isPublish && method === "POST") {
    if (version.scan_status === "scanning") {
      throw new ApiError("still_scanning", {
        message: "This version is still being scanned.",
        field: "version_id",
        fix: "Wait for scan_status approved (get_version), then publish; or give scheduled_publish_at to publish it later once it passes.",
        retryAfterSec: 30,
      });
    }
    if (version.scan_status !== "approved") throw notApproved(game, version);
    ageMustAllowVersion(game, version, "version_id");
    const matchUpdateMode = readMatchUpdateMode(body.match_update_mode);
    const mark = readPublishMark(body, game, version);
    await env.DB.prepare("UPDATE versions SET is_big_update = ?, patch_notes = ? WHERE id = ?").bind(mark.isBigUpdate, mark.patchNotes, version.id).run();
    const publishAfterAiReviewEnabled = readPublishAfterAiReview(body, version);
    if (publishAfterAiReviewEnabled !== version.publish_after_ai_review_enabled) await env.DB.prepare("UPDATE versions SET publish_after_ai_review_enabled = ? WHERE id = ?").bind(publishAfterAiReviewEnabled, version.id).run();
    const toPublish = { ...version, is_big_update: mark.isBigUpdate, patch_notes: mark.patchNotes, publish_after_ai_review_enabled: publishAfterAiReviewEnabled };
    const { route, isReviewNeeded, isOpenBefore } = await routePublish(env, game, toPublish);
    // Other people can reach the game and the developer is still earning going first, or chose not to: it goes live once its review passes, with its mark.
    if (route !== "now") {
      await publishWithReview(env, game, toPublish, "Published", caller.actor, matchUpdateMode);
      await logCallerEvent(env, caller, "version_waiting_for_ai_review", { gameId: game.id, versionId: version.id });
      const waiting = await versionAnswer(env, game, (await versionById(env.DB, version.id))!);
      return [{ game: await gameJson(env, (await gameBySlug(env.DB, game.slug))!), version: waiting, next_steps: aiReviewSteps(game, waiting) }];
    }
    const wasLiveVersion = game.live_version_id ? await versionById(env.DB, game.live_version_id) : null;
    await env.DB.prepare("UPDATE versions SET is_open_before_ai_review = ? WHERE id = ?").bind(isOpenBefore ? 1 : 0, version.id).run();
    await publishVersion(env.DB, version, matchUpdateMode);
    // This publish is the newest word: a version still waiting to go live once its review passes no longer does.
    await env.DB.prepare("UPDATE versions SET publish_when_approved_enabled = 0 WHERE game_id = ? AND id != ? AND ai_review_status IN ('waiting', 'reviewing')").bind(game.id, version.id).run();
    if (matchUpdateMode === "now") await updateLiveMatches(env, game, version, wasLiveVersion, caller.waitUntil);
    await audit(env.DB, game.id, version.published_at_ms ? "rolled-back" : "published", version.id, caller.actor);
    await logCallerEvent(env, caller, version.published_at_ms ? "version_rolled_back" : "version_published", { gameId: game.id, versionId: version.id });
    await pruneVersions(env, game.id);
    await tellWebhooks(env, "live_version_changed", game.id, { versionId: version.id }, caller.waitUntil);
    await alertIfNoticeFixPublished(env, game.id, version.id);
    const published = (await gameBySlug(env.DB, game.slug))!;
    if (isReviewNeeded) await requestAiReview(env, published, (await versionById(env.DB, version.id))!, caller.actor);
    const isHidden = published.visibility === "draft" || published.visibility === "private";
    const hasScreenshot = isHidden && Boolean(await env.DB.prepare("SELECT id FROM game_images WHERE game_id = ? AND kind = 'screenshot' AND review_status != 'rejected' LIMIT 1").bind(game.id).first());
    const publishedAnswer = await versionAnswer(env, published, (await versionById(env.DB, version.id))!);
    const nextSteps: NextStep[] = isHidden
      ? [...(isReviewNeeded ? aiReviewSteps(game, publishedAnswer) : []), { tool: "update_game", arguments: { slug: game.slug, visibility: "listed" }, after_sec: null, reason: `It's live, but the game is ${published.visibility}, so only the developer and tester links see it. When the developer wants players in: listed for everyone, or unlisted for people with the link.${hasScreenshot ? "" : " Listed needs a screenshot first: add one with add_image (kind screenshot)."}` }]
      : isReviewNeeded
        ? aiReviewSteps(game, publishedAnswer)
        : [];
    return [{ game: await gameJson(env, published), version: publishedAnswer, next_steps: nextSteps }];
  }

  throw badMethod(method, new URL(request.url).pathname);
}

const badPublishAfterAiReview = (isBoolean: boolean) =>
  new ApiError("bad_publish_after_ai_review_enabled", {
    message: isBoolean ? "publish_after_ai_review_enabled came without publish_when_approved true, so there's no publish for it to apply to." : "publish_after_ai_review_enabled isn't true or false.",
    field: "publish_after_ai_review_enabled",
    fix: "Send true with publish_when_approved true to go live only once the AI review passes, or give it to publish_version when you publish.",
  });

/** publish_after_ai_review_enabled as stored: as it was when it's left out. */
function readPublishAfterAiReview(body: Record<string, unknown>, version: Version): number {
  if (body.publish_after_ai_review_enabled === undefined) return version.publish_after_ai_review_enabled;
  if (typeof body.publish_after_ai_review_enabled !== "boolean") throw badPublishAfterAiReview(false);
  return body.publish_after_ai_review_enabled ? 1 : 0;
}

/** What to do next about a review that's running: it's told by get_version, or the ai_review_finished webhook. */
function aiReviewSteps(game: Pick<Game, "slug">, version: { id: string; ai_review_status: string; usual_ai_review_duration_min: number | null; is_live: boolean }): NextStep[] {
  if (version.usual_ai_review_duration_min === null) return [];
  const words = version.is_live ? "It's live with its AI review pending" : "It goes live once its AI review passes";
  return [{ tool: "get_version", arguments: { slug: game.slug, version_id: version.id }, after_sec: version.usual_ai_review_duration_min * 60, reason: `${words}, which usually takes about ${version.usual_ai_review_duration_min} min, not a promise: a batch can take much longer. The ai_review_finished webhook says when it ends.` }];
}

const bigUpdateNeedsNotes = () => new ApiError("big_update_needs_patch_notes", { message: "This big update has no patch_notes, and a big update must say what's new.", field: "patch_notes", fix: "Send patch_notes with what's new, or leave is_big_update out to publish it as a quiet patch." });

/**
 * What a publish says about a version: a quiet patch unless is_big_update is true, with new patch_notes if it gives them. A version that
 * has been live keeps its own of both, and can't be marked: only a first time live is news. Sending the same mark again on the live version
 * passes, so a retried publish isn't refused. The answers are as stored, 0 or 1 for the mark.
 */
function readPublishMark(body: Record<string, unknown>, game: Game, version: Version): { isBigUpdate: number; patchNotes: string } {
  if (body.is_big_update !== undefined && typeof body.is_big_update !== "boolean") {
    throw new ApiError("bad_is_big_update", { message: "is_big_update isn't true or false.", field: "is_big_update", fix: "Send true for a big update, or leave it out for a quiet patch." });
  }
  const givenNotes = body.patch_notes === undefined ? undefined : shownTextOrThrow(body.patch_notes, { field: "patch_notes", maximumCharacterCount: FILE_LIMITS.maximumPatchNotesCharacterCount, isMultiline: true });
  if (version.published_at_ms !== null) {
    if (givenNotes !== undefined && givenNotes !== version.patch_notes) {
      throw new ApiError("bad_patch_notes", { message: "This version has been live, so it keeps its patch_notes.", field: "patch_notes", fix: "Leave patch_notes out to roll back to it, or upload a new version with the new notes." });
    }
    if (body.is_big_update === true && !(version.id === game.live_version_id && version.is_big_update === 1)) {
      throw new ApiError("big_update_already_live", { message: "This version has been live, and only a version going live for the first time can be a big update.", field: "is_big_update", fix: "Leave is_big_update out to roll back to it, or upload a new version and mark that." });
    }
    return { isBigUpdate: version.is_big_update, patchNotes: version.patch_notes };
  }
  const patchNotes = givenNotes ?? version.patch_notes;
  if (body.is_big_update === true && !patchNotes) throw bigUpdateNeedsNotes();
  return { isBigUpdate: body.is_big_update === true ? 1 : 0, patchNotes };
}

/** The whole word "Zaisma" in a title, unless the game is on one of Zaisma's own accounts. */
async function refuseZaismaInTitle(env: Env, title: string, ownerId: string | null): Promise<void> {
  if (!titleNamesZaisma(title)) return;
  const owner = ownerId ? await env.DB.prepare("SELECT is_zaisma_account FROM owners WHERE id = ?").bind(ownerId).first<{ is_zaisma_account: number }>() : null;
  if (owner?.is_zaisma_account === 1) return;
  throw new ApiError("title_names_zaisma", { message: `The title ${JSON.stringify(title)} holds the word Zaisma, which only Zaisma's own games can use.`, field: "title", fix: 'Give the game a title of its own without the word Zaisma. A longer word holding it, like "Zaismatic", is fine.' });
}

/** match_update_mode as given: next_match when it's left out, and bad_match_update_mode for anything but the two. */
function readMatchUpdateMode(given: unknown): MatchUpdateMode {
  if (given === undefined) return "next_match";
  if (typeof given === "string" && (MATCH_UPDATE_MODES as readonly string[]).includes(given)) return given as MatchUpdateMode;
  throw new ApiError("bad_match_update_mode", {
    message: `match_update_mode is ${JSON.stringify(given)?.slice(0, 40)}.`,
    field: "match_update_mode",
    fix: 'Give "next_match" (running matches finish on the version they started; the default) or "now" (every live match switches to it within seconds, in the same room).',
  });
}

/** What asking for a visibility does with a live version whose review hasn't let it through. A hidden visibility, or a game with nothing live, is plain: a publish decides later. */
async function visibilityRoute(env: Env, game: Game, visibility: Game["visibility"]) {
  const live = game.live_version_id ? await versionById(env.DB, game.live_version_id) : null;
  if (!live || (visibility !== "listed" && visibility !== "unlisted")) return { route: "now" as const, isReviewNeeded: false, isOpenBefore: false, live: null };
  return { ...(await routePublish(env, { ...game, visibility }, live)), live };
}

/** The visibility's review, and the game's waiting for it: asked again, the newest answer counts, and a hidden visibility ends the wait. */
async function applyVisibilityRoute(env: Env, game: Game, visibility: Game["visibility"], routed: Awaited<ReturnType<typeof visibilityRoute>>, actor: string): Promise<NextStep[]> {
  const isWaiting = routed.route !== "now" && (visibility === "listed" || visibility === "unlisted");
  await env.DB.prepare("UPDATE games SET visibility_after_ai_review = ? WHERE id = ?").bind(isWaiting ? visibility : null, game.id).run();
  if (!routed.live) return [];
  await env.DB.prepare("UPDATE versions SET is_open_before_ai_review = ? WHERE id = ?").bind(routed.isOpenBefore ? 1 : 0, routed.live.id).run();
  if (routed.route === "needs_person") await holdForPerson(env, game, routed.live);
  if (routed.isReviewNeeded) await requestAiReview(env, game, routed.live, actor);
  if (!routed.isReviewNeeded) return [];
  const answer = await versionAnswer(env, game, (await versionById(env.DB, routed.live.id))!);
  if (answer.usual_ai_review_duration_min === null) return [];
  const words = isWaiting ? `The game stays ${game.visibility} and becomes ${visibility} once its live version's AI review passes` : "The live version's AI review is pending";
  return [{ tool: "get_version", arguments: { slug: game.slug, version_id: answer.id }, after_sec: answer.usual_ai_review_duration_min * 60, reason: `${words}: usually about ${answer.usual_ai_review_duration_min} min, not a promise.` }];
}

/** Lifelike gore plays only in games for 16 and up: a version showing it can't go to a game for everyone 13 and up. */
function ageMustAllowVersion(game: Pick<Game, "minimum_player_age_years">, version: Version, field: string): void {
  if (game.minimum_player_age_years >= LIFELIKE_GORE_MINIMUM_PLAYER_AGE_YEARS) return;
  if (!needsLifelikeGoreAge(version.scan_report ? (JSON.parse(version.scan_report) as ScanReport) : null)) return;
  throw new ApiError("content_needs_minimum_age", {
    message: `Version ${version.id} shows lifelike gore, which plays only in games for 16 and up, and this game is for everyone 13 and up.`,
    field,
    fix: "Set the game for 16 and up first (update_game with minimum_player_age_years 16), or use a version with stylized gore.",
  });
}

/** A version players can reach that shows lifelike gore: the live one, one scheduled to publish, or one a tester link opens. */
async function goreVersionPlayersCanReach(env: Env, game: Game): Promise<Version | null> {
  const { results: scheduled } = await env.DB.prepare("SELECT * FROM versions WHERE game_id = ? AND scheduled_publish_at_ms IS NOT NULL").bind(game.id).all<Version>();
  const reachable: Version[] = [...scheduled];
  if (game.live_version_id) {
    const live = await versionById(env.DB, game.live_version_id);
    if (live) reachable.push(live);
  }
  for (const link of await testerLinks(env.DB, game.id)) {
    const opened = (await testerLinkVersion(env.DB, game, link)) ?? (await testerLinkWaitingVersion(env.DB, game, link));
    if (opened) reachable.push(opened);
  }
  return reachable.find((version) => needsLifelikeGoreAge(version.scan_report ? (JSON.parse(version.scan_report) as ScanReport) : null)) ?? null;
}

/** A held or rejected version, which can't be published: why, and what to do, from its review reason or first finding. */
function notApproved(game: Game, version: Version): ApiError {
  const why = versionReviewReason(version) ?? findingsFor(scanReportOf(version))[0] ?? null;
  return new ApiError("not_approved", {
    message: `This version is ${version.scan_status}, so it can't be published${why ? ` (${why.code}): ${why.message}` : "."}`,
    field: "version_id",
    fix: `${why?.fix ?? (version.scan_status === "held" ? "A person at Zaisma looks at held versions, usually within a day." : `Upload a fixed version (upload_files with slug ${game.slug}).`)} get_version shows every finding.`,
  });
}

/** A game Zaisma took down can't change: why, and what to do, from its review reason. */
function gameRemoved(game: Game, what: string, field: string | null = null): ApiError {
  const reason = readReviewReason(game.review_reason);
  const why = reason ? reviewReasonAnswer(reason) : null;
  return new ApiError("game_removed", {
    message: reason?.code === "developer_deleted_game" ? `This game is deleted and waiting to be erased, so ${what}.` : `Zaisma took this game down, so ${what}${why ? ` (${why.code}): ${why.message}` : "."}`,
    field,
    fix: why?.fix ?? "message_zaisma with the game_slug to ask about it.",
  });
}

const DAY_MS = 86400_000;

/** Opaque cursors for lists that continue: they say where the last answer ended. */
const cursorFor = (atMs: number) => `cursor_${atMs.toString(36)}`;
function readCursor(cursor: string | null): number {
  if (!cursor) return 0;
  if (!/^cursor_[0-9a-z]{1,12}$/.test(cursor)) throw new ApiError("bad_cursor", { message: `cursor ${JSON.stringify(cursor.slice(0, 40))} isn't a next_cursor Zaisma gave.`, field: "cursor", fix: "Pass the next_cursor from your last answer as it came, or leave cursor out to start from the beginning." });
  return parseInt(cursor.slice(7), 36);
}

/** How many days back stats go: a whole number from 1 to 90, 30 when it's left out. */
function readPeriodDurationDays(given: string | null): number {
  if (given === null) return 30;
  const dayCount = Number(given);
  if (!/^\d+$/.test(given) || dayCount < 1 || dayCount > 90) {
    throw new ApiError("bad_period_duration_days", { message: `period_duration_days ${JSON.stringify(given.slice(0, 20))} isn't a whole number from 1 to 90.`, field: "period_duration_days", fix: "Give how many days back, today included, from 1 to 90; leave it out for 30." });
  }
  return dayCount;
}

/**
 * Player reports, counted by reason over the last 90 days. Bug reports (as report triage sorted
 * them) come with what the player wrote and the version they played, and player reports Zaisma passed
 * to the developer (bullying, cheating and other behavior that's the game's call) with the reported
 * player and room; `cursor` (from next_cursor) gives only the ones that arrived after it, so a
 * developer's AI can check for new ones. Never who sent any of them.
 * Child-safety reports, including ones triage found under another reason, are never shown or
 * counted here: telling the developer could warn someone abusing a child.
 */
async function reportsFor(env: Env, game: Game, cursor: string | null) {
  const sinceMs = readCursor(cursor);
  const fromMs = Date.now() - 90 * DAY_MS;
  const { results: counts } = await env.DB
    .prepare("SELECT reason, report_status, COUNT(*) AS report_count FROM reports WHERE game_id = ? AND reported_at_ms > ? AND reason != 'child_safety' AND severity_index > 0 GROUP BY reason, report_status")
    .bind(game.id, fromMs)
    .all<{ reason: string; report_status: string; report_count: number }>();
  const byReason = new Map<string, { reason: string; label: string; open_count: number; closed_count: number }>();
  for (const row of counts) {
    const reason = byReason.get(row.reason) ?? { reason: row.reason, label: REPORT_REASONS[row.reason as ReportReason] ?? row.reason, open_count: 0, closed_count: 0 };
    byReason.set(row.reason, reason);
    if (row.report_status === "open") reason.open_count += row.report_count;
    else reason.closed_count += row.report_count;
  }
  const { results: bugs } = await env.DB
    .prepare("SELECT id, player_text, triage, version_id, reported_at_ms, bug_report_at_ms FROM reports WHERE game_id = ? AND is_bug_report = 1 AND severity_index > 0 AND bug_report_at_ms > ? AND player_text != '' ORDER BY bug_report_at_ms DESC LIMIT 50")
    .bind(game.id, Math.max(sinceMs, fromMs))
    .all<{ id: string; player_text: string; triage: string | null; version_id: string | null; reported_at_ms: number; bug_report_at_ms: number }>();
  const { results: players } = await env.DB
    .prepare("SELECT id, player_reason, player_text, player_id, player_name, room_code, version_id, reported_at_ms, reported_chat_json, passed_to_developer_at_ms FROM reports WHERE game_id = ? AND is_passed_to_developer = 1 AND severity_index > 0 AND passed_to_developer_at_ms > ? ORDER BY passed_to_developer_at_ms DESC LIMIT 50")
    .bind(game.id, Math.max(sinceMs, fromMs))
    .all<PlayerReportRow & { passed_to_developer_at_ms: number }>();
  return {
    period_duration_days: 90,
    // Open: waiting for us. Closed: we looked and either dismissed it or acted on it.
    reasons: [...byReason.values()],
    bug_reports: bugs.map(bugReportJson),
    player_reports: players.map(playerReportJson),
    // Pass this as `cursor` next time to get only bug and player reports that arrived after this call.
    next_cursor: cursorFor(Math.max(sinceMs, ...bugs.map((bug) => bug.bug_report_at_ms), ...players.map((report) => report.passed_to_developer_at_ms))),
  };
}

/** A bug report as the developer sees it, in get_reports and the bug_reported webhook event: never who sent it. */
export function bugReportJson(bug: { id: string; player_text: string; triage: string | null; version_id: string | null; reported_at_ms: number }) {
  return {
    id: bug.id,
    player_text: bug.player_text,
    summary: bug.triage ? (JSON.parse(bug.triage) as { summary: string }).summary : null,
    version_id: bug.version_id,
    reported_at: iso(bug.reported_at_ms),
  };
}

/** A player report Zaisma passed to the developer, in get_reports and the player_reported event: who was reported, what the player wrote and the chat lines from their screen, never who sent it. */
export function playerReportJson(report: PlayerReportRow) {
  return {
    id: report.id,
    reason: report.player_reason,
    player_text: report.player_text,
    chat_messages: reportedChatOf(report),
    reported_player_id: report.player_id,
    reported_player_name: report.player_name,
    room_code: report.room_code || null,
    version_id: report.version_id,
    reported_at: iso(report.reported_at_ms),
  };
}

/** Why the live version's game server can't run yet (none, or too big), or null when it can or nothing is live. */
async function liveServerProblem(env: Env, game: Game): Promise<string | null> {
  const version = game.live_version_id ? await versionById(env.DB, game.live_version_id) : null;
  if (!version) return null;
  const manifest = version.kind === "files" ? ((await (await env.GAMES.get(manifestKey(version.id)))?.json()) as Manifest | null) : null;
  const found = await serverModules(env.GAMES, version, manifest);
  if (!found) return "The live version has no game server (a zaisma-server/ folder with index.js, or zaisma-server.js), so its rooms can't open until a version with one is published.";
  if ("error" in found) return `The live version's game server can't run: ${found.error}`;
  return null;
}

/**
 * Plays, play time and players coming back (counted by the game page, see plays.ts), multiplayer
 * room use per day, and for games running their own game server on our rooms, how it's doing:
 * calls, requests, scheduled runs, errors, loops we stopped and matches that ended for it, plus its
 * schedules and recent errors. Only counts: nothing about who played.
 */
async function statsFor(env: Env, game: Game, periodDurationDays: number) {
  const dayCount = Number.isInteger(periodDurationDays) && periodDurationDays > 0 ? Math.min(periodDurationDays, 90) : 30;
  const fromDate = new Date(Date.now() - (dayCount - 1) * DAY_MS).toISOString().slice(0, 10);
  const monthStartDate = `${new Date().toISOString().slice(0, 7)}-01`;
  const [gamePlayStats, performance, { results: roomDays }, { results: errors }, { results: schedules }, hostingUse, hostingMonth, hostingStops, monthRequestCount, monthTraffic, { results: monthMessageTypes }] = await Promise.all([
    playStats(env.DB, game.id, dayCount),
    // How the game runs for its players; null when the developer turned the measuring off.
    game.performance_measuring_enabled ? playerPerformance(env.DB, game.id, dayCount) : null,
    env.DB
      .prepare("SELECT date, room_count, room_play_duration_sec, message_count, inbound_size_bytes, outbound_message_count, outbound_size_bytes, game_server_cpu_duration_ms, game_server_call_count, game_server_request_count, game_server_scheduled_run_count, game_server_crash_count, game_server_stopped_count, game_server_ended_match_count FROM room_usage WHERE game_id = ? AND date >= ? ORDER BY date")
      .bind(game.id, fromDate)
      .all<RoomTrafficRow & { date: string; room_count: number; game_server_cpu_duration_ms: number; game_server_call_count: number; game_server_request_count: number; game_server_scheduled_run_count: number; game_server_crash_count: number; game_server_stopped_count: number; game_server_ended_match_count: number }>(),
    env.DB
      .prepare("SELECT version_id, kind, message, occurrence_count, first_at_ms, last_at_ms FROM game_server_errors WHERE game_id = ? ORDER BY last_at_ms DESC LIMIT 20")
      .bind(game.id)
      .all<GameServerErrorRow>(),
    // Written by the game's object in the rooms Worker within a minute of a publish (apps/rooms/src/game-server.ts).
    env.DB
      .prepare("SELECT schedule_name, cron, version_id, next_run_at_ms, last_run_at_ms FROM game_server_schedules WHERE game_id = ? AND version_id = ? ORDER BY schedule_name")
      .bind(game.id, game.live_version_id)
      .all<{ schedule_name: string; cron: string; version_id: string; next_run_at_ms: number; last_run_at_ms: number | null }>(),
    hostingUseThisMonth(env.DB, game.id),
    gameHostingMonth(env.DB, game.id),
    gameHosting(env.DB, game.id),
    requestCountThisMonth(env.DB, game.id),
    env.DB
      .prepare("SELECT COALESCE(SUM(room_play_duration_sec), 0) AS room_play_duration_sec, COALESCE(SUM(message_count), 0) AS message_count, COALESCE(SUM(inbound_size_bytes), 0) AS inbound_size_bytes, COALESCE(SUM(outbound_message_count), 0) AS outbound_message_count, COALESCE(SUM(outbound_size_bytes), 0) AS outbound_size_bytes FROM room_usage WHERE game_id = ? AND date >= ?")
      .bind(game.id, monthStartDate)
      .first<RoomTrafficRow>(),
    env.DB
      .prepare(
        "SELECT message_type, direction, SUM(message_count) AS message_count, SUM(size_bytes) AS size_bytes, MAX(largest_size_bytes) AS largest_size_bytes, SUM(backed_up_message_count) AS backed_up_message_count FROM room_message_types WHERE game_id = ? AND date >= ? GROUP BY message_type, direction ORDER BY size_bytes DESC LIMIT ?",
      )
      .bind(game.id, monthStartDate, ROOM_TRAFFIC_MESSAGE_TYPE_COUNT)
      .all<MessageTypeRow>(),
  ]);
  // The game's own game server runs on Zaisma for its rooms, or for requests and schedules, which any game's can have.
  const hasOwnServer =
    game.multiplayer_mode === "own" ||
    monthRequestCount > 0 ||
    schedules.length > 0 ||
    // A game server that didn't start counts no request and lists no schedule, but its errors say why.
    errors.length > 0 ||
    roomDays.some((day) => day.game_server_request_count > 0 || day.game_server_scheduled_run_count > 0 || day.game_server_crash_count > 0 || day.game_server_stopped_count > 0);
  return {
    period_duration_days: dayCount,
    play_stats: gamePlayStats,
    favorite_count: await favoriteCount(env.DB, game.id),
    performance,
    multiplayer_days: roomDays.map((day) => ({
      date: day.date,
      room_count: day.room_count,
      room_play_duration_min: Math.round(day.room_play_duration_sec / 60),
      message_count: day.message_count,
      ...perPlayerTraffic(day),
      game_server_cpu_duration_sec: Math.round(day.game_server_cpu_duration_ms / 1000),
      game_server: hasOwnServer ? { call_count: day.game_server_call_count, request_count: day.game_server_request_count, scheduled_run_count: day.game_server_scheduled_run_count, crash_count: day.game_server_crash_count, stopped_count: day.game_server_stopped_count, ended_match_count: day.game_server_ended_match_count } : null,
    })),
    // The one meter: the free allowance as a percentage, what used it as shares, and what credit paid past it.
    hosting_use_this_month: hostingUseJson(game, hostingUse, hostingMonth, hostingStops),
    // What each player sends and gets a second, the biggest message types and what to change, so a developer's AI can cut it.
    room_traffic: roomTraffic(monthTraffic, monthMessageTypes),
    // Schedules are free, capped by their shape: up to 10, each at most once a minute.
    schedules: schedules.map((schedule) => ({ schedule_name: schedule.schedule_name, cron: schedule.cron, version_id: schedule.version_id, next_run_at: iso(schedule.next_run_at_ms), last_run_at: iso(schedule.last_run_at_ms) })),
    // Crashes lose one call each and the match carries on. "stopped" is a call that ran on too long
    // (about 2 seconds of CPU, like a loop that never ends): it freezes the match while it runs,
    // and a match whose game server is stopped twice ends.
    game_server_errors: hasOwnServer ? errors.map(gameServerErrorJson) : [],
  };
}

/**
 * hosting_use_this_month: the free allowance as a percentage (never dollars), what used it as shares, whether the
 * game is paused and why, and, for a game with a budget, what credit paid; the raw counts are facts for tuning,
 * never priced.
 */
/** Where a game's hours went this month: new or returning players, which kind of network, and how much of the rented share is used. Totals only, never who. */
function playHoursJson(game: Game, hosting: Awaited<ReturnType<typeof hostingUseThisMonth>>) {
  const hours = (durationSec: number) => Math.round(durationSec / 360) / 10;
  const { playSplit, use, kinds } = hosting;
  const usedCents = rentedShareUsedCents(kinds, use, { roomUseCents: playSplit.rented_share_room_use_cents, requestCount: playSplit.rented_share_request_count, relayCredentialCount: playSplit.rented_share_relay_credential_count, relayCredentialTotalCount: playSplit.relay_credential_count });
  const limitCents = rentedShareLimitCents(freeAllowanceCents(hosting.secondFreeAllowanceMonthStartDate, monthStartDateOf(Date.now())), game.monthly_budget_cents);
  return {
    total_duration_hours: hours(use.roomPlayDurationSec),
    new_player_duration_hours: hours(playSplit.new_player_room_play_duration_sec),
    returning_player_duration_hours: hours(Math.max(0, use.roomPlayDurationSec - playSplit.new_player_room_play_duration_sec)),
    rented_network_duration_hours: hours(playSplit.rented_network_room_play_duration_sec),
    other_network_duration_hours: hours(Math.max(0, use.roomPlayDurationSec - playSplit.rented_network_room_play_duration_sec)),
    rented_share_used_pct: Math.min(100, Math.floor((usedCents / limitCents) * 100)),
  };
}

export function hostingUseJson(game: Game, hosting: Awaited<ReturnType<typeof hostingUseThisMonth>>, month: { charged_cents: number }, stops: GameHosting) {
  return {
    free_used_pct: hosting.freeUsedPct,
    second_free_allowance_month_start_date: hosting.secondFreeAllowanceMonthStartDate,
    free_rooms_stopped_at: iso(stops.freeRoomsStoppedAtMs),
    shares: hostingShares(hosting.kinds).map((share) => ({ kind: share.kind, share_pct: share.sharePct })),
    is_paused: stops.pausedAtMs !== null,
    paused_reason: stops.pausedReason,
    paused_at: iso(stops.pausedAtMs),
    resets_on_date: nextMonthStartDate(),
    monthly_budget_cents: game.monthly_budget_cents,
    spent_from_credit_cents: month.charged_cents,
    room_play_duration_hours: Math.round(hosting.use.roomPlayDurationSec / 360) / 10,
    play_hours: playHoursJson(game, hosting),
    room_awake_duration_hours: Math.round(hosting.use.roomAwakeDurationSec / 360) / 10,
    room_connection_count: hosting.use.roomConnectionCount,
    inbound_message_count: hosting.use.inboundMessageCount,
    relayed_size_bytes: hosting.use.relayedSizeBytes,
    game_server_cpu_duration_sec: Math.round(gameServerCpuSec(hosting.use)),
    startup_cpu_duration_sec: Math.round(hosting.use.startupCpuDurationMs / 1000),
    game_server_session_count: hosting.use.gameServerSessionCount,
    loaded_version_count: hosting.use.loadedVersionCount,
    outside_call_count: hosting.use.outsideCallCount,
    log_file_count: hosting.use.logFileCount,
    request_count: hosting.use.requestCount + hosting.use.scheduledRunCount,
    awake_duration_hours: Math.round((hosting.use.objectAwakeDurationSec + hosting.use.databaseAwakeDurationSec) / 360) / 10,
    database_call_count: hosting.use.databaseCallCount,
    written_row_count: hosting.use.writtenRowCount,
    read_row_count: hosting.use.readRowCount,
    bookkeeping_written_row_count: hosting.use.bookkeepingWrittenRowCount,
    database_size_bytes: hosting.use.databaseSizeBytes,
    adult_chat_check_count: hosting.use.adultChatCheckCount,
  };
}

/** Room traffic as room_usage adds it up: player time, and messages and bytes each way. */
interface RoomTrafficRow {
  room_play_duration_sec: number;
  message_count: number;
  inbound_size_bytes: number;
  outbound_message_count: number;
  outbound_size_bytes: number;
}

/** A message type's traffic over the month, as room_message_types adds it up. */
interface MessageTypeRow {
  message_type: string;
  direction: "inbound" | "outbound";
  message_count: number;
  size_bytes: number;
  largest_size_bytes: number;
  /** Sends that went reliably to a player whose connection was backed up. */
  backed_up_message_count: number;
}

/** The month's biggest message types get_stats lists. */
const ROOM_TRAFFIC_MESSAGE_TYPE_COUNT = 10;
/** Where room traffic hints start: a JSON type this big on average, this often; this much going out; a message this close to the limit. */
const LARGE_JSON_AVERAGE_SIZE_BYTES = 512;
const FREQUENT_MESSAGES_PER_PLAYER_SEC = 5;
const HEAVY_OUTBOUND_SIZE_BYTES_PER_PLAYER_SEC = 32 * 1024;
const NEAR_LIMIT_SIZE_BYTES = 12 * 1024;
/** Where the latest_only hint starts: a type sent reliably this often a player-second, with this share of its sends to backed-up players. */
const LATEST_ONLY_MESSAGES_PER_PLAYER_SEC = 10;
const LATEST_ONLY_BACKED_UP_PCT = 10;

/** Messages and bytes per player a second, each way, rounded to one decimal; 0 with no player time. */
function perPlayerTraffic(traffic: RoomTrafficRow) {
  const perPlayerSec = (summedNumber: number) => (traffic.room_play_duration_sec > 0 ? Math.round((summedNumber / traffic.room_play_duration_sec) * 10) / 10 : 0);
  return {
    inbound_messages_per_player_sec: perPlayerSec(traffic.message_count),
    inbound_size_bytes_per_player_sec: perPlayerSec(traffic.inbound_size_bytes),
    outbound_messages_per_player_sec: perPlayerSec(traffic.outbound_message_count),
    outbound_size_bytes_per_player_sec: perPlayerSec(traffic.outbound_size_bytes),
  };
}

/** The month's room traffic per player a second, its biggest message types, and hints from a closed list. */
function roomTraffic(traffic: RoomTrafficRow | null, messageTypes: MessageTypeRow[]) {
  const totals = traffic ?? { room_play_duration_sec: 0, message_count: 0, inbound_size_bytes: 0, outbound_message_count: 0, outbound_size_bytes: 0 };
  const perPlayer = perPlayerTraffic(totals);
  const types = totals.room_play_duration_sec > 0 ? messageTypes : [];
  const hints: { code: RoomTrafficHintCode; message: string }[] = [];
  const kilobytes = (sizeBytes: number) => Math.round((sizeBytes / 1024) * 10) / 10;
  const named = (messageType: string) => (messageType === "(none)" ? "Messages without a type" : `"${messageType}" messages`);
  for (const type of types) {
    const averageSizeBytes = type.message_count ? type.size_bytes / type.message_count : 0;
    const isJson = !["(bytes)", "(zaisma)", "(state)", "(other)"].includes(type.message_type);
    if (isJson && averageSizeBytes >= LARGE_JSON_AVERAGE_SIZE_BYTES && type.message_count / totals.room_play_duration_sec >= FREQUENT_MESSAGES_PER_PLAYER_SEC) {
      hints.push({ code: "json_messages_large", message: `${named(type.message_type)} average ${Math.round(averageSizeBytes)} bytes as JSON. Sending them with room.sendBytes and room.broadcastBytes in a compact form usually cuts them to a third.` });
    }
    const messagesPerPlayerSec = type.message_count / totals.room_play_duration_sec;
    const isGameMessage = type.direction === "outbound" && !["(zaisma)", "(state)", "(other)"].includes(type.message_type);
    if (isGameMessage && messagesPerPlayerSec >= LATEST_ONLY_MESSAGES_PER_PLAYER_SEC && (type.backed_up_message_count ?? 0) * 100 >= type.message_count * LATEST_ONLY_BACKED_UP_PCT) {
      const which = type.message_type === "(bytes)" ? "Bytes" : named(type.message_type);
      hints.push({ code: "latest_only_available", message: `${which} go out ${Math.round(messagesPerPlayerSec)} a second to each player, and ${Math.round(((type.backed_up_message_count ?? 0) / type.message_count) * 100)}% of them went to a player whose connection was backed up. Send them with delivery: "latest_only" so a slow player gets only the newest.` });
    }
  }
  if (perPlayer.outbound_size_bytes_per_player_sec >= HEAVY_OUTBOUND_SIZE_BYTES_PER_PLAYER_SEC) {
    hints.push({ code: "outbound_heavy", message: `Each player gets ${kilobytes(perPlayer.outbound_size_bytes_per_player_sec)} KB a second. Send each player only what changed and only what they can see: the game server's stateSyncEnabled does the first, and its stateView the second.` });
  }
  const largestInbound = types.filter((type) => type.direction === "inbound").sort((first, second) => second.largest_size_bytes - first.largest_size_bytes)[0];
  if (largestInbound && largestInbound.largest_size_bytes >= NEAR_LIMIT_SIZE_BYTES) {
    const which = largestInbound.message_type === "(none)" ? "message without a type" : largestInbound.message_type === "(bytes)" ? "bytes message" : `"${largestInbound.message_type}" message`;
    hints.push({ code: "message_near_limit", message: `The largest ${which} is ${kilobytes(largestInbound.largest_size_bytes)} KB, close to the 16 KB limit. Split it or send it as bytes.` });
  }
  return {
    ...perPlayer,
    message_types: types.map((type) => ({
      message_type: type.message_type,
      direction: type.direction,
      message_count: type.message_count,
      size_bytes: type.size_bytes,
      largest_size_bytes: type.largest_size_bytes,
      average_size_bytes: type.message_count ? Math.round(type.size_bytes / type.message_count) : 0,
    })),
    traffic_hints: hints,
  };
}

/** What room traffic hints say to change (ROOM_TRAFFIC_HINT in schemas.ts says what each means). */
type RoomTrafficHintCode = "json_messages_large" | "outbound_heavy" | "message_near_limit" | "latest_only_available";

/** A game server error as it's stored. */
export interface GameServerErrorRow {
  version_id: string;
  kind: "crash" | "stopped";
  message: string;
  occurrence_count: number;
  first_at_ms: number;
  last_at_ms: number;
}

/** One of get_stats' game_server_errors, also in a game_server_error_found event. */
export function gameServerErrorJson(error: GameServerErrorRow) {
  return { kind: error.kind, message: error.message, occurrence_count: error.occurrence_count, version_id: error.version_id, first_at: iso(error.first_at_ms), last_at: iso(error.last_at_ms) };
}

/** What happened to a game, newest first, in words safe to show its developer. */
const HISTORY: Record<string, string | null> = {
  created: "Made the game",
  details: "Changed the details",
  "details-approved": "New title or description approved",
  "details-rejected": "New title or description not approved",
  "image-added": "Added an image",
  "image-removed": "Removed an image",
  "image-approved": "Image approved",
  "image-rejected": "Image not approved",
  "shader-approved": "A background shader passed its check",
  "shader-checked": "A background shader passed its check and waits for a person to look",
  "shader-rejected": "A background shader didn't pass its check; see its review_reason",
  upload: "Uploaded a version",
  "scan-held": "A version was held for a person to look at; see the version's findings",
  "scan-rejected": "A version was rejected; see the version's findings",
  rejected: "A version was rejected after review",
  "review-hold-released": "A person looked and released this hold. It didn't count against your daily reviews.",
  "draft-ready": "A version passed review and is ready to preview and publish",
  published: "Published a version",
  "rolled-back": "Rolled back to an earlier version",
  "publish-scheduled": "Scheduled a version to publish later",
  "publish-unscheduled": "Cancelled a scheduled publish",
  "ai-review-started": "A version's AI review started",
  "ai-review-rolled-back": "The AI review stopped the live version; players are back on the version before it",
  "ai-review-took-down": "The AI review stopped the live version, and no earlier version had passed, so the game has none live until a fix passes",
  "publish-dropped": "A scheduled version didn't pass review, so it wasn't published",
  "draft-deleted": "An unpublished version was deleted after 30 days",
  // Neutral on purpose: the developer is never told which kind of report it was.
  "auto-hold": "A report paused your game while we check it",
  "report-paused-update": "A report paused your latest update while we check it; players get the version before it",
  "report-cleared": "We checked a report and put your game back",
  takedown: "Zaisma took the game down",
  "notice-held": "A notice hid your game from players; see why",
  "notice-fix-published": null,
  "country-blocked": "A notice under one country's law blocked your game for players there; see why",
  "country-block-lifted": "Zaisma lifted a country's block: players there can open your game again",
  restored: "Zaisma restored the game",
  "reports-dismissed": null,
  "reports-to-developer": null,
  // A decision about one of the game's players, never shown on the game's history.
  "social-stopped": null,
  "profile-cleared": null,
  "room-name-hidden": "Zaisma hid a room's name from room lists after a report",
  multiplayer: "Multiplayer settings changed",
  "cloud-saves": "Cloud saves switched",
  "tester-link-added": "Made a tester link",
  "tester-link-removed": "Turned off a tester link",
  "tester-link-changed": "Changed a tester link",
  "preview-links-ended": "Turned off a version's preview links",
  "allowed-hosts": "Changed which other servers the game server can call",
  links: "Changed the game's links",
  "link-flagged": "A link stopped opening: Cloudflare lists its site for malware or phishing",
  "link-cleared": "A link opens again: its site is off Cloudflare's malware and phishing list",
  "secret-set": "Set a secret",
  "secret-deleted": "Deleted a secret",
  "kept-room-deleted": "Deleted a kept room",
  "kept-room-brought-back": "Brought a deleted kept room back",
  "kept-room-restored": "Restored a kept room's world to an earlier time",
  "kept-room-restore-undone": "Undid a restore of a kept room's world",
  "kept-rooms-restored": "Restored every kept room's world to an earlier time",
  "kept-rooms-restore-undone": "Undid a restore of every kept room's world",
  "kept-room-erased-now": "Erased a kept room at once",
  "room-player-kicked": "Removed a player from a live room",
  "room-ended": "Ended a live room",
  // subject_name is the uploader's public name (copies.ts, stopCopy).
  "copy-stopped": "Zaisma stopped a re-upload of this game by another developer; it never reached players",
  "plays-cleared": "Zaisma removed a day's counted plays that looked faked",
  "off-shelves": "Zaisma took the game off Popular, Trending and New",
  "on-shelves": "Zaisma put the game back on Popular, Trending and New",
  owner: null,
};

/** The developer's and their keys' changes come from the security log; Zaisma's own steps from the audit log, worded by HISTORY. */
async function historyFor(env: Env, game: Game, caller: Caller) {
  return gameHistoryAnswer(env, game, caller, (entry) => {
    const description = HISTORY[entry.action];
    if (!description) return null;
    if (entry.action === "copy-stopped") return { description, version_id: null, subject_name: entry.reason, review_reason: null };
    return { description, version_id: entry.reason.match(/\bversion_[a-z0-9]+/)?.[0] ?? null, review_reason: reasonAnswer(entry.review_reason) };
  });
}

/** A stored review reason (JSON) as the API answers it, with its fix; null when there's none. */
function reasonAnswer(stored: string | null) {
  const reason = readReviewReason(stored);
  return reason ? reviewReasonAnswer(reason) : null;
}

function listOrThrow(files: unknown): UploadFile[] {
  try {
    return checkUploadList(files);
  } catch (error) {
    if (error instanceof UploadError) throw new ApiError(error.problem?.code ?? "bad_files", { message: error.message, field: error.problem?.field ?? "files", fix: error.problem?.fix ?? "Check the file list against docs/DEVELOPER-API.md, Uploading versions." });
    throw error;
  }
}

/**
 * Tester links: secret links that open the game's live version whatever its visibility, for guests
 * too. One per group (team, playtesters, a streamer), so one can be turned off without the others.
 */
async function testerRoute(request: Request, env: Env, game: Game, id: string | undefined, caller: Caller, checked: CheckedCall): Promise<[unknown, number?]> {
  if (!id && request.method === "GET") return [{ testers: await Promise.all((await testerLinks(env.DB, game.id)).map((link) => testerJson(env, link))) }];
  if (!id && request.method === "POST") {
    if (game.review_status === "removed") {
      throw gameRemoved(game, "it can't get tester links");
    }
    const body = checked.body;
    const name = readTesterName(body.name);
    const choices = await readTesterChoices(env, game, body, { versionChoice: "live", pickedVersionId: null, endsAtMs: null });
    const links = await testerLinks(env.DB, game.id);
    if (links.length >= MAXIMUM_TESTER_LINK_COUNT) {
      throw new ApiError("too_many_tester_links", { message: `${game.slug} has ${MAXIMUM_TESTER_LINK_COUNT} tester links on, the most a game can.`, fix: "Turn one off with remove_tester_link (its tester_id from get_game) first." });
    }
    const link = await addTesterLink(env.DB, env, game.id, name, choices);
    await reviewForTesterLink(env, game, link, caller.actor);
    await audit(env.DB, game.id, "tester-link-added", name, caller.actor);
    await logCallerEvent(env, caller, "tester_link_added", { gameId: game.id, subjectName: name });
    return [{ tester: await testerJson(env, link), next_steps: [] satisfies NextStep[] }, 201];
  }
  const testerFix = "get_game lists the tester links that are on, with their IDs.";
  if (id && (request.method === "PATCH" || request.method === "DELETE")) {
    checkIdKind("tester", id, "tester_id", testerFix);
    const link = (await testerLinks(env.DB, game.id)).find((candidate) => candidate.id === id);
    if (!link) throw new ApiError("no_tester_link", { message: `${game.slug} has no tester link on with the ID ${id}.`, field: "tester_id", fix: testerFix });
    if (request.method === "PATCH") {
      if (game.review_status === "removed") throw gameRemoved(game, "its tester links can't change");
      const body = checked.body;
      const name = body.name === undefined ? link.name : readTesterName(body.name);
      const choices = await readTesterChoices(env, game, body, { versionChoice: link.version_choice, pickedVersionId: link.picked_version_id, endsAtMs: link.ends_at_ms });
      const changed = await updateTesterLink(env.DB, link, { name, ...choices });
      await reviewForTesterLink(env, game, changed, caller.actor);
      await audit(env.DB, game.id, "tester-link-changed", name, caller.actor);
      await logCallerEvent(env, caller, "tester_link_changed", { gameId: game.id, subjectName: name });
      return [{ tester: await testerJson(env, changed), next_steps: [] satisfies NextStep[] }];
    }
    if (!(await revokeTesterLink(env.DB, game.id, id))) throw new ApiError("no_tester_link", { message: `${game.slug} has no tester link on with the ID ${id}.`, field: "tester_id", fix: testerFix });
    await audit(env.DB, game.id, "tester-link-removed", link.name, caller.actor);
    await logCallerEvent(env, caller, "tester_link_removed", { gameId: game.id, subjectName: link.name });
    return [{ removed_tester_id: link.id, next_steps: [] satisfies NextStep[] }];
  }
  throw badMethod(request.method, new URL(request.url).pathname);
}

/** Testers are other people: what a link would open has its AI review asked for now, and opens when the review lets it through (or at once, for a developer who's earned it). */
async function reviewForTesterLink(env: Env, game: Game, link: TesterLink, actor: string): Promise<void> {
  const waiting = await testerLinkWaitingVersion(env.DB, game, link);
  if (!waiting) return;
  const { isReviewNeeded, isOpenBefore } = await routePublish(env, game, waiting);
  await env.DB.prepare("UPDATE versions SET is_open_before_ai_review = ? WHERE id = ?").bind(isOpenBefore ? 1 : 0, waiting.id).run();
  if (isReviewNeeded) await requestAiReview(env, game, (await versionById(env.DB, waiting.id))!, actor);
}

function readTesterName(given: unknown): string {
  return shownTextOrThrow(given, { field: "name", maximumCharacterCount: 60, isRequired: true });
}

/**
 * What a tester link opens and until when, from a body that may leave any of them out (keeping current):
 * version_choice live, newest_passed or picked, picked_version_id with picked only, and ends_at as an ISO time or null.
 */
async function readTesterChoices(env: Env, game: Game, body: Record<string, unknown>, current: TesterLinkChoices): Promise<TesterLinkChoices> {
  const versionChoice = body.version_choice === undefined ? current.versionChoice : (body.version_choice as VersionChoice);
  if (!VERSION_CHOICES.includes(versionChoice)) {
    throw new ApiError("bad_version_choice", { message: `version_choice is ${JSON.stringify(body.version_choice)}, not one of ${VERSION_CHOICES.join(", ")}.`, field: "version_choice", fix: 'Send "live" for the version players get, "newest_passed" for the newest version that passed the scan, or "picked" with picked_version_id.' });
  }
  let pickedVersionId: string | null = null;
  if (versionChoice === "picked") {
    pickedVersionId = body.picked_version_id === undefined ? current.pickedVersionId : (body.picked_version_id as string | null);
    if (typeof pickedVersionId !== "string") {
      throw new ApiError("bad_version_choice", { message: "version_choice is picked, but there's no picked_version_id.", field: "picked_version_id", fix: "Send the version's id from get_game as picked_version_id, or choose live or newest_passed." });
    }
    const versionFix = "get_game lists the game's versions with their IDs and scan_status, newest first.";
    checkIdKind("version", pickedVersionId, "picked_version_id", versionFix);
    const version = await versionById(env.DB, pickedVersionId);
    if (!version || version.game_id !== game.id) throw new ApiError("no_version", { message: `${game.slug} has no version with the ID ${pickedVersionId}.`, field: "picked_version_id", fix: versionFix });
    if (version.scan_status !== "approved") {
      throw new ApiError("not_approved", { message: `Version ${version.id} is ${version.scan_status}, and a tester link opens only a version that passed the scan.`, field: "picked_version_id", fix: version.scan_status === "scanning" ? "Wait for scan_status approved (get_version), then pick it." : "Pick a version that passed, or fix what the scan found and upload again." });
    }
    ageMustAllowVersion(game, version, "picked_version_id");
  } else if (body.picked_version_id !== undefined && body.picked_version_id !== null) {
    throw new ApiError("bad_version_choice", { message: `picked_version_id goes only with version_choice picked, and this link's is ${versionChoice}.`, field: "picked_version_id", fix: 'Send version_choice "picked" with it, or leave picked_version_id out.' });
  }
  let endsAtMs = current.endsAtMs;
  if (body.ends_at === null) endsAtMs = null;
  else if (body.ends_at !== undefined) {
    endsAtMs = typeof body.ends_at === "string" && ISO_TIME.test(body.ends_at) ? Date.parse(body.ends_at) : NaN;
    if (!Number.isFinite(endsAtMs) || endsAtMs <= Date.now() || endsAtMs > Date.now() + 366 * DAY_MS) {
      const said = typeof body.ends_at === "string" ? `"${body.ends_at.slice(0, 40)}"` : `a ${typeof body.ends_at}`;
      throw new ApiError("bad_time", {
        message: Number.isFinite(endsAtMs) ? `ends_at ${said} isn't between now and a year ahead.` : `ends_at is ${said}, not an ISO time.`,
        field: "ends_at",
        fix: `Give an ISO time with Z or an offset, up to a year ahead, like "${new Date(Date.now() + 7 * DAY_MS).toISOString().slice(0, 14)}00:00Z", or null for no end date.`,
      });
    }
  }
  return { versionChoice, pickedVersionId, endsAtMs };
}

/**
 * Turning a version's preview links off: a new key ends every link handed out so far, and every
 * browser that opened one. Fresh links work again straight away, for the developer and their AI.
 */
async function endPreviewLinks(env: Env, game: Game, id: string, caller: Caller): Promise<[unknown, number?]> {
  const versionFix = "get_game lists the game's versions with their IDs, newest first.";
  checkIdKind("version", id, "version_id", versionFix);
  const version = await versionById(env.DB, id);
  if (!version || version.game_id !== game.id) throw new ApiError("no_version", { message: `${game.slug} has no version with the ID ${id}.`, field: "version_id", fix: versionFix });
  if (version.preview_link_key) {
    await env.DB.prepare("UPDATE versions SET preview_link_key = ? WHERE id = ? AND preview_link_key IS NOT NULL").bind(randomKey(32), version.id).run();
    await endPreviewPasses(env.DB, version.id);
  }
  await audit(env.DB, game.id, "preview-links-ended", version.id, caller.actor);
  await logCallerEvent(env, caller, "preview_links_ended", { gameId: game.id, versionId: version.id });
  return [{ version: await versionAnswer(env, game, (await versionById(env.DB, version.id))!), next_steps: [] satisfies NextStep[] }];
}

/**
 * Sign-in apps: developers' own sites, servers and apps that players sign in to with Zaisma
 * (sign-in.ts). The app's ID is its OAuth client_id; a confidential app's client secret is answered
 * once, when it's made or replaced, and only its SHA-256 is kept.
 */
async function signInAppRoute(request: Request, env: Env, caller: Caller, checked: CheckedCall): Promise<[unknown, number?]> {
  const method = request.method;
  const { body, signInApp: app } = checked;
  if (!app && method === "GET") return [{ sign_in_apps: (await signInAppsFor(env.DB, caller.ownerId)).map((app) => signInAppJson(env, app)) }];
  if (!app && method === "POST") {
    for (const field of ["name", "kind", "redirect_urls"]) {
      if (body[field] === undefined) throw new ApiError("missing_field", { message: `${field} wasn't sent.`, field, fix: SIGN_IN_APP_FIX[field]! });
    }
    const name = signInAppNameOrThrow(body.name);
    if (!(SIGN_IN_APP_KINDS as readonly unknown[]).includes(body.kind)) throw new ApiError("bad_kind", { message: "kind isn't confidential or public.", field: "kind", fix: SIGN_IN_APP_FIX.kind! });
    const redirectUrls = redirectUrlsOrThrow(body.redirect_urls);
    if ((await signInAppsFor(env.DB, caller.ownerId)).length >= MAXIMUM_SIGN_IN_APP_COUNT) {
      throw new ApiError("too_many_sign_in_apps", { message: `You have ${MAXIMUM_SIGN_IN_APP_COUNT} sign-in apps, the most an account can.`, fix: "Delete one you don't use with delete_sign_in_app, or add this site's redirect URLs to an app you have with update_sign_in_app." });
    }
    const { app, clientSecret } = await createSignInApp(env.DB, { ownerId: caller.ownerId, name, kind: body.kind as SignInAppKind, redirectUrls });
    await logCallerEvent(env, caller, "sign_in_app_created", { subjectName: app.name });
    return [{ sign_in_app: signInAppJson(env, app), client_secret: clientSecret, next_steps: [] satisfies NextStep[] }, 201];
  }
  if (!app) throw badMethod(method, new URL(request.url).pathname);
  if (method === "PATCH") {
    const replaceClientSecret = body.replace_client_secret;
    if (replaceClientSecret !== undefined && typeof replaceClientSecret !== "boolean") throw new ApiError("bad_replace_client_secret", { message: "replace_client_secret isn't true or false.", field: "replace_client_secret", fix: "Send true to make a new client secret (the old one stops working at once), or leave it out." });
    if (replaceClientSecret && app.kind === "public") throw new ApiError("bad_replace_client_secret", { message: `${app.name} is a public app, which has no client secret.`, field: "replace_client_secret", fix: "Leave replace_client_secret out. A public app signs in with PKCE alone; for a client secret, make a confidential app with create_sign_in_app." });
    const { app: updated, clientSecret } = await updateSignInApp(env.DB, app, {
      name: body.name === undefined ? undefined : signInAppNameOrThrow(body.name),
      redirectUrls: body.redirect_urls === undefined ? undefined : redirectUrlsOrThrow(body.redirect_urls),
      replaceClientSecret: replaceClientSecret === true,
    });
    await logCallerEvent(env, caller, "sign_in_app_changed", { subjectName: updated.name });
    return [{ sign_in_app: signInAppJson(env, updated), client_secret: clientSecret, next_steps: [] satisfies NextStep[] }];
  }
  if (method === "DELETE") {
    await deleteSignInApp(env.DB, app.id);
    await logCallerEvent(env, caller, "sign_in_app_deleted", { subjectName: app.name });
    return [{ removed_sign_in_app_id: app.id, next_steps: [] satisfies NextStep[] }];
  }
  throw badMethod(method, new URL(request.url).pathname);
}

const SIGN_IN_APP_FIX: Record<string, string> = {
  name: 'Name the app the way players know your site, in 1 to 60 characters, like "Sky Hopper Online". Players see it when they sign in.',
  kind: 'Send "confidential" for a site or server that keeps the client secret on its server, or "public" for a page or phone app with no server, which signs in with PKCE alone.',
  redirect_urls: 'Send a list of 1 to 10 exact URLs your site gets players back on, like ["https://skyhopper.io/auth/callback"]: https, or http://localhost for development, without a #fragment.',
};

function signInAppNameOrThrow(given: unknown): string {
  const checked = checkSignInAppName(given);
  if ("error" in checked) throw new ApiError("bad_name", { message: checked.error, field: "name", fix: SIGN_IN_APP_FIX.name! });
  return checked.name;
}

function redirectUrlsOrThrow(given: unknown): string[] {
  if (!Array.isArray(given) || given.length < 1 || given.length > MAXIMUM_REDIRECT_URL_COUNT) {
    throw new ApiError("bad_redirect_urls", { message: `redirect_urls isn't a list of 1 to ${MAXIMUM_REDIRECT_URL_COUNT} URLs.`, field: "redirect_urls", fix: SIGN_IN_APP_FIX.redirect_urls! });
  }
  const redirectUrls: string[] = [];
  for (const [i, url] of given.entries()) {
    const checked = checkRedirectUrl(url);
    if ("error" in checked) throw new ApiError("bad_redirect_urls", { message: checked.error, field: `redirect_urls[${i}]`, fix: SIGN_IN_APP_FIX.redirect_urls! });
    if (!redirectUrls.includes(checked.redirectUrl)) redirectUrls.push(checked.redirectUrl);
  }
  return redirectUrls;
}

export function signInAppJson(env: Env, app: SignInApp) {
  return { id: app.id, name: app.name, kind: app.kind, redirect_urls: redirectUrlsOf(app), issuer_url: env.SITE_ORIGIN, created_at: iso(app.created_at_ms), updated_at: iso(app.updated_at_ms) };
}

/**
 * Webhooks: addresses the developer's servers listen at, sent signed events about their games, or a
 * game's own game server on Zaisma, whose onWebhook gets them (webhooks.ts). The signing secret is
 * answered once, when it's made or replaced.
 */
async function webhookRoute(request: Request, env: Env, sub: "test" | "deliveries" | undefined, caller: Caller, checked: CheckedCall): Promise<[unknown, number?]> {
  const method = request.method;
  const { body, webhook } = checked;
  if (!webhook && method === "GET") {
    const [webhooks, counts] = await Promise.all([webhooksFor(env.DB, caller.ownerId), deliveryCountsFor(env.DB, caller.ownerId)]);
    return [{ webhooks: webhooks.map((webhook) => webhookJson(webhook, counts.get(webhook.id))) }];
  }
  if (!webhook && method === "POST") {
    const destinationKind = body.destination_kind === undefined ? "endpoint_url" : destinationKindOrThrow(body.destination_kind);
    for (const field of destinationKind === "endpoint_url" ? ["endpoint_url", "event_kinds"] : ["event_kinds", "game_slugs"]) {
      if (body[field] === undefined) throw new ApiError("missing_field", { message: `${field} wasn't sent.`, field, fix: WEBHOOK_FIX[field === "game_slugs" ? "game_server_slugs" : field]! });
    }
    const endpointUrl = endpointUrlFor(env, destinationKind, body.endpoint_url);
    const eventKinds = eventKindsOrThrow(body.event_kinds);
    const gameSlugs = gameSlugsFor(destinationKind, body.game_slugs === undefined ? null : gameSlugsOrThrow(checked.gameSlugs));
    if ((await webhooksFor(env.DB, caller.ownerId)).length >= MAXIMUM_WEBHOOK_COUNT) {
      throw new ApiError("too_many_webhooks", { message: `You have ${MAXIMUM_WEBHOOK_COUNT} webhooks, the most an account can.`, fix: "Delete one you don't use with delete_webhook, or add these event_kinds to one you have with update_webhook." });
    }
    const { webhook, signingSecret } = await createWebhook(env.DB, env, { ownerId: caller.ownerId, destinationKind, endpointUrl, eventKinds, gameSlugs });
    await logCallerEvent(env, caller, "webhook_created", { subjectName: webhook.id });
    return [{ webhook: webhookJson(webhook), signing_secret: signingSecret, next_steps: [testStep(webhook)] satisfies NextStep[] }, 201];
  }
  if (!webhook) throw badMethod(method, new URL(request.url).pathname);

  if (sub === "test" && method === "POST") {
    const delivery = await sendTestEvent(env, webhook);
    return [{ delivery: deliveryJson(delivery), next_steps: [] satisfies NextStep[] }];
  }
  if (sub === "deliveries" && method === "GET") {
    const cursor = checked.query.get("cursor");
    const deliveries = await deliveriesFor(env.DB, webhook.id, 20, cursor ? readCursor(cursor) : null);
    return [{ deliveries: deliveries.map(deliveryJson), next_cursor: deliveries.length === 20 ? cursorFor(deliveries.at(-1)!.created_at_ms) : null }];
  }
  if (sub) throw badMethod(method, new URL(request.url).pathname);
  if (method === "PATCH") {
    const replaceSigningSecret = body.replace_signing_secret;
    if (replaceSigningSecret !== undefined && typeof replaceSigningSecret !== "boolean") {
      throw new ApiError("bad_replace_signing_secret", { message: "replace_signing_secret isn't true or false.", field: "replace_signing_secret", fix: "Send true to make a new signing secret (by default the old one stops at once), or leave it out." });
    }
    // What it would be: a new destination brings its own endpoint_url (or none) and game_slugs to fit.
    const destinationKind = body.destination_kind === undefined ? webhook.destination_kind : destinationKindOrThrow(body.destination_kind);
    const isNewDestination = destinationKind !== webhook.destination_kind;
    if (isNewDestination && destinationKind === "endpoint_url" && body.endpoint_url === undefined) {
      throw new ApiError("missing_field", { message: "endpoint_url wasn't sent, and a webhook to an address needs one.", field: "endpoint_url", fix: WEBHOOK_FIX.endpoint_url! });
    }
    const endpointUrl = body.endpoint_url === undefined ? (destinationKind === "endpoint_url" ? undefined : null) : endpointUrlFor(env, destinationKind, body.endpoint_url);
    const givenGameSlugs = body.game_slugs === undefined ? undefined : gameSlugsOrThrow(checked.gameSlugs);
    const gameSlugs = givenGameSlugs !== undefined || isNewDestination ? gameSlugsFor(destinationKind, givenGameSlugs === undefined ? gameSlugsOf(webhook) : givenGameSlugs) : undefined;
    const { webhook: updated, signingSecret } = await updateWebhook(env.DB, env, webhook, {
      destinationKind,
      endpointUrl,
      eventKinds: body.event_kinds === undefined ? undefined : eventKindsOrThrow(body.event_kinds),
      gameSlugs,
      replaceSigningSecret: replaceSigningSecret === true,
    });
    await logCallerEvent(env, caller, "webhook_changed", { subjectName: webhook.id });
    const counts = (await deliveryCountsFor(env.DB, caller.ownerId)).get(webhook.id);
    const nextSteps: NextStep[] = body.endpoint_url !== undefined || isNewDestination || replaceSigningSecret === true ? [testStep(updated)] : [];
    return [{ webhook: webhookJson(updated, counts), signing_secret: signingSecret, next_steps: nextSteps }];
  }
  if (method === "DELETE") {
    await deleteWebhook(env.DB, webhook.id);
    await logCallerEvent(env, caller, "webhook_deleted", { subjectName: webhook.id });
    return [{ removed_webhook_id: webhook.id, next_steps: [] satisfies NextStep[] }];
  }
  throw badMethod(method, new URL(request.url).pathname);
}

const testStep = (webhook: Webhook): NextStep => ({
  tool: "test_webhook",
  arguments: { webhook_id: webhook.id },
  after_sec: null,
  reason:
    webhook.destination_kind === "game_server"
      ? "Once the game's live version has onWebhook(event, server) in its game server, send a test event to see it finish without an error."
      : "Once your server checks the signature with signing_secret, send a test event to see it answer 2xx.",
});

const WEBHOOK_FIX: Record<string, string> = {
  destination_kind: 'Send "endpoint_url" to send events to your own server\'s https address, or "game_server" to send them to one game\'s own game server on Zaisma (its onWebhook).',
  endpoint_url: 'Give the https address your server takes events at, like "https://hooks.skyhopper.io/zaisma": a name, not an IP address, and not on Zaisma\'s own domains.',
  game_server_endpoint_url: 'A webhook to a game server has no endpoint_url: leave it out (or send null). To send events to your own server instead, send destination_kind "endpoint_url" with it.',
  game_server_slugs: 'Send game_slugs as a list of the one game whose game server gets the events, like ["sky-hopper"]: a webhook to a game server takes only that game\'s events.',
  event_kinds: `Send a list of the events to send, from: ${WEBHOOK_EVENT_KINDS.join(", ")}.`,
  game_slugs: "Send null (or leave it out) for every game you have and will make, or a list of up to 50 of your games' slugs from list_games.",
};

function endpointUrlOrThrow(env: Env, given: unknown): string {
  const ownDomains = [new URL(env.SITE_ORIGIN).hostname, new URL(env.GAME_ORIGIN).hostname, env.GAME_DOMAIN, "zaisma.com", "zaismausercontent.com"].filter(Boolean);
  const checked = checkEndpointUrl(given, ownDomains, env.SITE_ORIGIN.startsWith("http://localhost"));
  if ("error" in checked) throw new ApiError("bad_endpoint_url", { message: checked.error, field: "endpoint_url", fix: WEBHOOK_FIX.endpoint_url! });
  return checked.endpointUrl;
}

function destinationKindOrThrow(given: unknown): WebhookDestinationKind {
  if (!(WEBHOOK_DESTINATION_KINDS as readonly unknown[]).includes(given)) {
    throw new ApiError("bad_destination_kind", { message: `${JSON.stringify(given)} isn't a destination_kind.`, field: "destination_kind", fix: WEBHOOK_FIX.destination_kind! });
  }
  return given as WebhookDestinationKind;
}

/** The endpoint_url a webhook to this destination would have: a checked address, or null for a game server. */
function endpointUrlFor(env: Env, destinationKind: WebhookDestinationKind, given: unknown): string | null {
  if (destinationKind === "endpoint_url") return endpointUrlOrThrow(env, given);
  if (given !== undefined && given !== null) throw new ApiError("bad_endpoint_url", { message: "A webhook to a game server has no endpoint_url.", field: "endpoint_url", fix: WEBHOOK_FIX.game_server_endpoint_url! });
  return null;
}

/** The game_slugs a webhook to this destination would have: a game server's is its one game. */
function gameSlugsFor(destinationKind: WebhookDestinationKind, gameSlugs: string[] | null): string[] | null {
  if (destinationKind === "game_server" && gameSlugs?.length !== 1) {
    throw new ApiError("bad_game_slugs", { message: gameSlugs === null ? "A webhook to a game server needs its game in game_slugs, and it's null (every game)." : `game_slugs has ${gameSlugs.length} games; a webhook to a game server takes one.`, field: "game_slugs", fix: WEBHOOK_FIX.game_server_slugs! });
  }
  return gameSlugs;
}

function eventKindsOrThrow(given: unknown): WebhookEventKind[] {
  if (!Array.isArray(given) || given.length < 1 || given.some((kind) => !(WEBHOOK_EVENT_KINDS as readonly unknown[]).includes(kind))) {
    const wrong = Array.isArray(given) ? given.find((kind) => !(WEBHOOK_EVENT_KINDS as readonly unknown[]).includes(kind)) : undefined;
    throw new ApiError("bad_event_kinds", { message: wrong === undefined ? "event_kinds isn't a list of 1 or more event kinds." : `${JSON.stringify(wrong)} isn't an event kind.`, field: "event_kinds", fix: WEBHOOK_FIX.event_kinds! });
  }
  return [...new Set(given as WebhookEventKind[])];
}

/** game_slugs as the router checked it (each the caller's and the key's), or bad_game_slugs when it isn't null or a list. */
function gameSlugsOrThrow(checkedSlugs: string[] | null | undefined): string[] | null {
  if (checkedSlugs === null) return null;
  if (!checkedSlugs?.length) {
    throw new ApiError("bad_game_slugs", { message: `game_slugs isn't null or a list of 1 to ${MAXIMUM_GAME_COUNT_PER_OWNER} slugs.`, field: "game_slugs", fix: WEBHOOK_FIX.game_slugs! });
  }
  return checkedSlugs;
}

function webhookJson(webhook: Webhook, counts?: { pendingCount: number; failedCount: number }) {
  return {
    id: webhook.id,
    destination_kind: webhook.destination_kind,
    endpoint_url: webhook.endpoint_url,
    event_kinds: eventKindsOf(webhook),
    game_slugs: gameSlugsOf(webhook),
    pending_delivery_count: counts?.pendingCount ?? 0,
    failed_delivery_count: counts?.failedCount ?? 0,
    created_at: iso(webhook.created_at_ms),
    updated_at: iso(webhook.updated_at_ms),
  };
}

function deliveryJson(delivery: WebhookDelivery) {
  return {
    webhook_id: delivery.webhook_id,
    webhook_event: JSON.parse(delivery.event_json) as Record<string, unknown>,
    delivery_status: delivery.delivery_status,
    attempt_count: delivery.attempt_count,
    last_attempt_at: iso(delivery.last_attempt_at_ms),
    next_attempt_at: delivery.delivery_status === "pending" ? iso(delivery.next_attempt_at_ms) : null,
    failure_message: delivery.failure_message,
    created_at: iso(delivery.created_at_ms),
  };
}

// The JSON for each kind of thing, as schemas.ts describes it: the row's own names, with values in
// the API's form (ISO times, true and false, lists and objects instead of stored text).

async function testerJson(env: Env, link: TesterLink) {
  return {
    id: link.id,
    name: link.name,
    link_url: `${env.SITE_ORIGIN}/t/${await testerLinkToken(env, link)}`,
    version_choice: link.version_choice,
    picked_version_id: link.picked_version_id,
    ends_at: iso(link.ends_at_ms),
    created_at: iso(link.created_at_ms),
    last_opened_at: iso(link.last_opened_at_ms),
  };
}

/** The versions' Chrome runs, by version ID, in one query. */
export async function performanceChecksFor(env: Env, versionIds: string[]): Promise<Map<string, PerformanceCheckRow>> {
  if (!versionIds.length) return new Map();
  const { results } = await env.DB.prepare("SELECT * FROM performance_checks WHERE version_id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(versionIds)).all<PerformanceCheckRow>();
  return new Map(results.map((row) => [row.version_id, row]));
}

/** A version's answer with its Chrome run, for one version. */
export async function versionAnswer(env: Env, game: Game, version: Version) {
  return versionJson(env, game, version, (await performanceChecksFor(env, [version.id])).get(version.id) ?? null, await aiReviewFacts(env, game, [version]));
}

/** What a game's versions' AI review answers need, read once for all of them; null when every review has ended. */
async function aiReviewFacts(env: Env, game: Game, versions: Version[]): Promise<AiReviewFacts | null> {
  if (versions.every((version) => isAiReviewDone(version) || version.ai_review_status === "stopped")) return null;
  const [publish, speed, usualDurationsMin] = await Promise.all([publishFacts(env, game), aiReviewSpeedFor(env, game), usualAiReviewDurations(env)]);
  return { publish, speed, usualDurationsMin };
}

interface AiReviewFacts {
  publish: PublishFacts;
  speed: AiReviewSpeed;
  usualDurationsMin: Record<AiReviewSpeed, number>;
}

/** How a version started in Chrome: null for zip versions and versions from before it ran. */
function performanceCheckJson(row: PerformanceCheckRow | null) {
  if (!row) return null;
  const report: Omit<PerformanceReport, "start_files"> | null = row.report ? JSON.parse(row.report) : null;
  return {
    check_status: row.check_status,
    checked_at: iso(row.checked_at_ms),
    browser_description: report?.browser_description ?? "Chrome on a computer with no graphics card",
    loading_duration_sec: report?.loading_duration_sec ?? null,
    start_download_size_bytes: report?.start_download_size_bytes ?? null,
    start_file_count: report?.start_file_count ?? null,
    start_memory_size_bytes: report?.start_memory_size_bytes ?? null,
    longest_start_task_duration_ms: report?.longest_start_task_duration_ms ?? null,
    notes: report?.notes ?? [],
  };
}

export function versionJson(env: Env, game: Game, version: Version, performanceCheck: PerformanceCheckRow | null, aiReview: AiReviewFacts | null) {
  const isReviewOpen = aiReview !== null && !isAiReviewDone(version) && version.ai_review_status !== "stopped";
  const preview = previewLinkToken(env, version);
  const report = scanReportOf(version);
  return {
    id: version.id,
    file_count: version.file_count,
    size_bytes: version.size_bytes,
    // scanning, held (a person will look), approved or rejected.
    scan_status: version.scan_status,
    ai_review_status: version.ai_review_status,
    ai_review_speed: version.ai_review_speed,
    ai_review_requested_at: iso(version.ai_review_requested_at_ms),
    ai_review_finished_at: iso(version.ai_review_finished_at_ms),
    ai_review_waiting_reason: version.ai_review_waiting_reason,
    usual_ai_review_duration_min: isReviewOpen ? aiReview.usualDurationsMin[version.ai_review_speed ?? aiReview.speed] : null,
    is_ai_review_needed_to_publish: isReviewOpen && version.ai_review_status === "not_started" && publishRouteOf(game, version, aiReview.publish).isReviewNeeded,
    is_open_before_ai_review: version.is_open_before_ai_review === 1,
    publish_after_ai_review_enabled: version.publish_after_ai_review_enabled === 1,
    has_threads: hasThreads(report),
    is_live: version.id === game.live_version_id,
    patch_notes: version.patch_notes,
    preview_url: preview ? `${env.SITE_ORIGIN}/p/${preview.token}` : null,
    preview_url_expires_at: preview ? iso(preview.expiresAtMs) : null,
    published_at: iso(version.published_at_ms),
    first_published_at: iso(version.first_published_at_ms),
    is_big_update: version.is_big_update === 1,
    scheduled_publish_at: iso(version.scheduled_publish_at_ms),
    // How running matches get it when it goes live by itself (publish later, or publish when approved).
    match_update_mode: version.match_update_mode ?? "next_match",
    created_at: iso(version.created_at_ms),
    review_reason: versionReviewReason(version),
    findings: [...findingsFor(report), ...(isReviewOpen ? waitingFindingsFor(version) : [])],
    replaced_by_version_id: version.replaced_by_version_id,
    performance_check: performanceCheckJson(performanceCheck),
  };
}

/** What a review waiting for a free daily review tells the developer. A note: nothing is held. */
function waitingFindingsFor(version: Version) {
  const code = version.ai_review_waiting_reason;
  if (!code) return [];
  return [{ code, severity: "info" as const, message: dailyReviewMeaning(code), content_rule: null, path: null, fix: REVIEW_CODES[code].fix, message_for_people: REVIEW_CODES[code].messageForPeople }];
}

/** A person's or a report's decision about a version: a report paused this update, or a person rejected it. */
function versionReviewReason(version: Version) {
  if (version.report_held_at_ms && version.scan_status === "held") return reviewReasonAnswer(reviewReason("report_paused_update"));
  const reason = readReviewReason(version.review_reason);
  return reason ? reviewReasonAnswer(reason) : null;
}

/** Why the scan held or rejected a version, with the rule and the fix. Child-safety signals are never described: a person needs to look. */
const scanReportOf = (version: Version): ScanReport | null => (version.scan_report ? (JSON.parse(version.scan_report) as ScanReport) : null);

function findingsFor(report: ScanReport | null) {
  if (!report) return [];
  const shown: Finding[] = report.is_child_safety
    ? [{ stage: "static", severity: "hold", code: "needs_review", message: "" }]
    : report.findings.filter((finding) => (finding.severity !== "info" || DEVELOPER_INFO_FINDING_CODES.includes(finding.code)) && Object.hasOwn(REVIEW_CODES, finding.code));
  return shown.map((finding) => {
    const code = finding.code as ReviewCodeName;
    const reason = reviewReasonAnswer({ code, message: finding.message, content_rule: REVIEW_CODES[code].contentRule });
    return { code, severity: finding.severity, message: reason.message, content_rule: reason.content_rule, path: finding.path ?? null, fix: reason.fix, message_for_people: reason.message_for_people };
  });
}

/** A game this caller owns, by its slug (or the input named by `field`). Someone else's game looks the same as no game. */
export async function ownGame(env: Env, slug: string, caller: Caller, field = "slug"): Promise<Game> {
  const game = await gameBySlug(env.DB, slug);
  if (!game || game.owner_id !== caller.ownerId) {
    throw new ApiError("no_game", { message: `You don't have a game at zaisma.com/g/${slug}.`, field, fix: "list_games (GET /games) lists your games with their slugs; create_game makes a new one." });
  }
  const gameSlugs = caller.access.gameSlugs;
  if (gameSlugs && !gameSlugs.includes(game.slug)) {
    throw new ApiError("key_not_allowed", {
      message: `This API key works only on ${gameSlugs.join(", ")}, not ${game.slug}.`,
      field,
      fix: `Use one of the games list_games shows, or ask the developer for a key that covers ${game.slug} (keys are made on zaisma.com/dashboard/settings).`,
    });
  }
  return game;
}

/** Refuses a call the caller's key doesn't reach, saying what it would need. */
function checkAccess(apiRoute: ApiRoute, caller: Caller): void {
  const { area, choice } = apiRoute;
  if (apiRoute.isAccountWide && caller.access.gameSlugs) {
    throw new ApiError("key_not_allowed", {
      message: `This API key works only on ${caller.access.gameSlugs.join(", ")}, so it can't make ${apiRoute.method} ${apiRoute.path}, which acts for the whole account.`,
      fix: "Make the call with a key for all your games, or on zaisma.com/dashboard; keys are made on zaisma.com/dashboard/settings.",
    });
  }
  if (apiRoute.isFullKeyOnly && !isFullKey(caller.access)) {
    throw new ApiError("key_not_allowed", {
      message: `This API key isn't a full key, and ${apiRoute.method} ${apiRoute.path} needs one: ${apiRoute.path === "/api-keys" ? "it shows how your keys are used and from where" : "it shows where your account is used from"}.`,
      fix: `Call with a full key for all your games, or see ${apiRoute.path === "/api-keys" ? "your keys on zaisma.com/dashboard/settings, under Keys, where keys are made" : "it on zaisma.com/account, under Activity; keys are made on zaisma.com/dashboard/settings"}.`,
    });
  }
  for (const more of apiRoute.alsoNeeds) {
    if (allows(caller.access.areaAccess, more.area, more.choice)) continue;
    throw new ApiError("key_not_allowed", {
      message: `This API key can't make ${apiRoute.method} ${apiRoute.path}: it reads ${more.area.replace("_access", "")} too, which needs ${more.area} ${more.choice}, and the key has ${more.area} ${caller.access.areaAccess[more.area]}.`,
      fix: `get_access (GET /access) shows what this key can do. To do this, the developer makes a key with ${apiRoute.alsoNeeds.map((each) => `${each.area} ${each.choice}`).join(", ")} (a read key has them all) on zaisma.com/dashboard/settings; keys can't be made through the API.`,
    });
  }
  if (!area || allows(caller.access.areaAccess, area, choice)) return;
  const has = caller.access.areaAccess[area];
  const isAccountArea = ACCOUNT_AREAS.includes(area) && caller.access.gameSlugs !== null;
  throw new ApiError("key_not_allowed", {
    message: isAccountArea
      ? `This API key works only on some games, and ${area === "webhook_access" ? "webhooks" : "sign-in apps"} belong to the whole account, so it can't make ${apiRoute.method} ${apiRoute.path}.`
      : `This API key can't make ${apiRoute.method} ${apiRoute.path}: that needs ${area} ${choice}, and the key has ${area} ${has}.`,
    fix: `get_access (GET /access) shows what this key can do. To do this, the developer makes a key with ${area} ${choice}${isAccountArea ? " for all their games" : ""} on zaisma.com/dashboard/settings; keys can't be made through the API.`,
  });
}

/** What a caller may do, as the API answers it. */
export function accessJson(access: KeyAccess) {
  return { api_key_name: access.apiKeyName, api_key_ends_at: access.endsAtMs === null ? null : iso(access.endsAtMs), access_level: access.accessLevel, area_access: access.areaAccess, game_slugs: access.gameSlugs };
}

/** The JSON object a call was sent; with isOptional, a call sent with no body at all gets {}. */
async function readJson(request: Request, maximumSizeBytes = 64 * 1024, isOptional = false): Promise<Record<string, unknown>> {
  try {
    const text = await readBodyText(request, maximumSizeBytes);
    if (isOptional && !text.trim()) return {};
    const body: unknown = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof BodyPastCapError) {
      throw new ApiError("json_too_big", { message: `The JSON body is over ${maximumSizeBytes / 1024} KB, the most this call takes.`, fix: "Send less: big games go through the upload command (npx @zaisma/cli upload), and long text can be shortened." });
    }
  }
  throw new ApiError("bad_json", { message: "The body isn't a JSON object.", fix: 'Send a JSON object, like { "title": "Sky Hopper" }, with Content-Type: application/json.' });
}

/** A call that takes no body refuses one: nothing, or {} (many clients send it by default), passes. */
async function refuseBody(request: Request): Promise<void> {
  const fix = "This call takes no body; leave it out.";
  const text = (
    await readBodyText(request, NO_BODY_MAXIMUM_SIZE_BYTES).catch((error: unknown) => {
      throw error instanceof BodyPastCapError ? new ApiError("bad_json", { message: "This call takes no body, and one was sent.", fix }) : error;
    })
  ).trim();
  if (!text) return;
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const [firstKey] = Object.keys(body);
      if (firstKey === undefined) return;
      throw new ApiError("unknown_field", { message: `${firstKey} isn't a field of this call: it takes no body.`, field: firstKey, fix });
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
  }
  throw new ApiError("bad_json", { message: "This call takes no body, and one was sent.", fix });
}

/** Inputs are closed: a field we don't take is an error, never quietly ignored (docs/NAMING.md). */
export function closedBody(body: Record<string, unknown>, fields: string[]): void {
  for (const key of Object.keys(body)) {
    if (!fields.includes(key)) throw new ApiError("unknown_field", { message: `${key} isn't a field of this call.`, field: key, fix: `Leave it out. The fields are: ${fields.join(", ")}.` });
  }
}

export function closedQuery(queryParameters: URLSearchParams, fields: string[]): void {
  for (const key of queryParameters.keys()) {
    if (!fields.includes(key)) throw new ApiError("unknown_field", { message: `${key} isn't a query parameter of this call.`, field: key, fix: `Leave it out. The parameters are: ${fields.join(", ")}.` });
  }
}

const splitLabels = (labels: string) => (labels ? labels.split(",") : []);

export async function gameJson(env: Env, game: Game) {
  const { outsideLinksEnabled } = await standingOf(env.DB, game.owner_id, Date.now());
  const erasesAtMs = game.review_status === "removed" ? ((await gameDeletionOf(env.DB, game.id))?.erases_at_ms ?? null) : null;
  const waitingWords = game.details_waiting_for_review ? (JSON.parse(game.details_waiting_for_review) as { title?: string; description?: string }) : null;
  return {
    slug: game.slug,
    page_url: `${env.SITE_ORIGIN}/g/${game.slug}`,
    title: game.title,
    description: game.description,
    visibility: game.visibility,
    visibility_after_ai_review: game.visibility_after_ai_review,
    // Ours, separate from visibility: pending (no version has passed review yet), live, held or removed, and why.
    review_status: game.review_status,
    review_reason: reasonAnswer(game.review_reason),
    erases_at: erasesAtMs === null ? null : iso(erasesAtMs),
    is_erase_now_allowed: erasesAtMs !== null && !(await isPlayedByOthers(env.DB, game.id)),
    // Countries whose players can't open it, on a notice under that country's law; [] for none.
    country_blocks: countryBlocksAnswer(game),
    devices: splitLabels(game.devices),
    controls: splitLabels(game.controls),
    genres: splitLabels(game.genres),
    screen_orientation: game.screen_orientation || null,
    play_modes: readPlayModes(game.play_modes),
    cloud_saves_enabled: Boolean(game.cloud_saves_enabled),
    account_offer_enabled: Boolean(game.account_offer_enabled),
    deleted_account_erase_enabled: Boolean(game.deleted_account_erase_enabled),
    friend_joins_enabled: Boolean(game.friend_joins_enabled),
    performance_measuring_enabled: Boolean(game.performance_measuring_enabled),
    multiplayer_mode: game.multiplayer_mode,
    room_browsing: game.room_browsing,
    account_requirement: game.account_requirement,
    // Never entry_signing_key: it's Zaisma's own, behind the game entry.
    minimum_player_age_years: game.minimum_player_age_years,
    game_server_allowed_hosts: allowedHostsOf(game),
    own_server_urls: ownServerUrlsOf(game),
    links: linksOf(game).map((link) => linkJson(link, outsideLinksEnabled)),
    details_waiting_for_review: waitingWords ? { title: waitingWords.title ?? null, description: waitingWords.description ?? null } : null,
    // Why the title keeps the game off Zaisma's lists ("No slop"); null when nothing does.
    title_listing_reason: reasonAnswer(game.title_listing_reason),
    glass_tint_color: game.glass_tint_color,
    // What it may draw from the developer's credit each month; null: no paid hosting, it stops at its free allowance.
    monthly_budget_cents: game.monthly_budget_cents,
    // What the game page says it sells, from its items: pages and AIs read the label from here alone.
    purchase_label: await purchaseLabelFor(env.DB, game),
    // The permanent content item a player buys to play; null: free to play. Its demo, another of the developer's games, by slug.
    full_game_item_name: game.full_game_item_name,
    demo_game_slug: game.demo_game_id ? ((await env.DB.prepare("SELECT slug FROM games WHERE id = ?").bind(game.demo_game_id).first<{ slug: string }>())?.slug ?? null) : null,
    refund_policy: game.refund_policy,
    refund_policy_text: game.refund_policy_text,
    first_published_at: iso(game.first_published_at_ms),
    big_update_at: iso(game.big_update_at_ms),
    // Where Browse's Recently updated places it: a marked big update moves it at most once every 30 days.
    recently_updated_at: iso(game.recently_updated_at_ms ?? game.first_published_at_ms),
    updated_at: iso(game.updated_at_ms),
  };
}

/** A developer's standing as GET /access answers it (schemas.ts, STANDING). */
function standingJson(standing: Standing) {
  return {
    is_established_developer: standing.isEstablishedDeveloper,
    outside_links_enabled: standing.outsideLinksEnabled,
    publish_before_ai_review_enabled: standing.publishBeforeAiReviewEnabled,
    search_engines_enabled: standing.searchEnginesEnabled,
    returning_player_count: standing.returningPlayerCount,
    minimum_returning_player_count: STANDING_LIMITS.minimumReturningPlayerCount,
    account_age_days: standing.accountAgeDays,
    minimum_account_age_days: STANDING_LIMITS.minimumDeveloperAccountAgeDays,
    has_card_or_stripe_account: standing.hasCardOrStripeAccount,
    last_ruling_at: iso(standing.lastRulingAtMs),
    ruling_wait_ends_at: iso(standing.rulingWaitEndsAtMs),
    message_for_people: standingWords(standing),
  };
}

/** A registered link as the API answers it: who it opens for (with the developer's standing), and why it opens for nobody. */
function linkJson(link: GameLink, outsideLinksEnabled: boolean) {
  return {
    link_name: link.link_name,
    destination_url: link.destination_url,
    is_on_game_page: link.is_on_game_page,
    who_can_open: linkAudience(link, outsideLinksEnabled),
    review_reason: link.review_reason ? reviewReasonAnswer(link.review_reason) : null,
  };
}

/** Cents as dollars, like $3.40 or $50. */
const dollarsText = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/** The kinds of alert, most urgent first. */
export const GAME_ALERT_KINDS = ["game_removed", "game_waiting_to_erase", "game_held", "game_blocked_in_country", "version_rejected", "version_held", "link_flagged", "game_off_lists", "hosting_paused", "free_rooms_stopped", "second_free_allowance_started", "database_full", "hosting_nearly_paused", "hosting_budget_nearly_used", "credit_low", "database_nearly_full", "player_erase_failed", "reports_open"] as const;
export type GameAlertKind = (typeof GAME_ALERT_KINDS)[number];
export interface GameAlert {
  kind: GameAlertKind;
  message: string;
  fix: string;
  /** What the dashboard shows: what needs attention and what to do, naming no call or field. */
  message_for_people: string;
  version_id: string | null;
}

/**
 * What needs the developer's attention in each game, most urgent first: a takedown or hold, the
 * newest version rejected, versions waiting for a person, rooms, requests or the game database
 * paused for the month (or the database full), a heads-up when NEARLY_USED_PCT of one of those
 * free allowances is used, players who deleted their accounts that Zaisma couldn't erase from the game
 * database, and player reports waiting for Zaisma. The developer home and a game's overview show the
 * same list, and list_games and get_game answer it. Five queries however many games there are, and one
 * call to each game's database for its use alone.
 */
export async function gameAlerts(env: Env, games: Game[]): Promise<Map<string, GameAlert[]>> {
  const alertsByGameId = new Map<string, GameAlert[]>(games.map((game) => [game.id, []]));
  if (!games.length) return alertsByGameId;
  const gameIds = JSON.stringify(games.map((game) => game.id));
  const monthStartDate = `${new Date().toISOString().slice(0, 7)}-01`;
  const ownerIds = JSON.stringify([...new Set(games.map((game) => game.owner_id).filter(Boolean))]);
  const [{ results: versions }, { results: usage }, { results: reports }, databaseUses, failedErases, { results: listingImages }, { results: keptRooms }, { results: owners }, spendingStop] = await Promise.all([
    // Each game's newest version, and every version waiting for a person.
    env.DB
      .prepare(
        "SELECT game_id, id, scan_status, report_held_at_ms, created_at_ms, created_at_ms = (SELECT MAX(newer.created_at_ms) FROM versions AS newer WHERE newer.game_id = versions.game_id) AS is_newest FROM versions WHERE game_id IN (SELECT value FROM json_each(?)) AND scan_status IN ('held', 'rejected') AND replaced_by_version_id IS NULL ORDER BY created_at_ms DESC",
      )
      .bind(gameIds)
      .all<{ game_id: string; id: string; scan_status: "held" | "rejected"; report_held_at_ms: number | null; created_at_ms: number; is_newest: number }>(),
    // Each game's month on the meter, as the hosting job last wrote it (hosting-job.ts).
    env.DB
      .prepare("SELECT game_id, used_cents, charged_cents, paused_at_ms, paused_reason, has_real_players FROM game_hosting_months WHERE game_id IN (SELECT value FROM json_each(?)) AND month_start_date = ?")
      .bind(gameIds, monthStartDate)
      .all<{ game_id: string; used_cents: number; charged_cents: number; paused_at_ms: number | null; paused_reason: PausedReason | null; has_real_players: number }>(),
    // Counted as get_reports counts them: the last 90 days, never child safety.
    env.DB
      .prepare("SELECT game_id, COUNT(*) AS report_count FROM reports WHERE game_id IN (SELECT value FROM json_each(?)) AND report_status = 'open' AND reported_at_ms > ? AND reason != 'child_safety' AND severity_index > 0 GROUP BY game_id")
      .bind(gameIds, Date.now() - 90 * DAY_MS)
      .all<{ game_id: string; report_count: number }>(),
    // Without game databases (a Zaisma of your own without the rooms Worker), there's nothing to say about them.
    Promise.all(games.map((game) => env.GAME_DATABASES?.usage(game.id).then((answer) => ("queryResult" in answer ? answer.queryResult : null), () => null) ?? null)),
    failedPlayerErases(env.DB, games.map((game) => game.id)),
    // Covers the listing check found keep the game off Zaisma's lists ("No slop").
    env.DB
      .prepare("SELECT game_id, kind, listing_reason FROM game_images WHERE game_id IN (SELECT value FROM json_each(?)) AND kind != 'screenshot' AND review_status != 'rejected' AND listing_reason IS NOT NULL")
      .bind(gameIds)
      .all<{ game_id: string; kind: string; listing_reason: string }>(),
    // Kept rooms' saved worlds share the free storage with the database.
    env.DB.prepare("SELECT game_id, SUM(saved_size_bytes) AS size_bytes FROM kept_rooms WHERE game_id IN (SELECT value FROM json_each(?)) GROUP BY game_id").bind(gameIds).all<{ game_id: string; size_bytes: number }>(),
    // Each owner's credit: its low line, and whether a game with a budget can go past its free hosting (any credit).
    env.DB
      .prepare(
        "SELECT id, credit_balance_cents, credit_low_line_cents FROM owners WHERE id IN (SELECT value FROM json_each(?))",
      )
      .bind(ownerIds)
      .all<{ id: string; credit_balance_cents: number; credit_low_line_cents: number | null }>(),
    // The month's spending stop (spending.ts), which reaches every free game.
    spendingMonthRow(env.DB),
  ]);
  for (const game of games) {
    const alerts = alertsByGameId.get(game.id)!;
    const add = (kind: GameAlertKind, message: string, fix: string, messageForPeople: string, versionId: string | null = null) => alerts.push({ kind, message, fix, message_for_people: messageForPeople, version_id: versionId });
    const reason = reasonAnswer(game.review_reason);
    if (game.review_status === "removed" && reason?.code === "developer_deleted_game") add("game_waiting_to_erase", "You deleted this game. It's off for every player and waits a week before it's erased.", "bring_back_game brings it back until erases_at.", "You deleted this game. Its page here says when it's erased.");
    else if (game.review_status === "removed") add("game_removed", `Zaisma took this game down${reason ? `: ${reason.message}` : "."}`, reason?.fix ?? "message_zaisma with the game_slug to ask why.", "Zaisma took this game down. Its page here says why and what to do.");
    if (game.review_status === "held") add("game_held", `Players can't open this game right now${reason ? `: ${reason.message}` : "."}`, reason?.fix ?? "Nothing to do: a person at Zaisma looks, usually within a day.", "Players can't open this game right now. Its page here says why.");
    for (const block of countryBlocksAnswer(game)) {
      add("game_blocked_in_country", `Players in ${block.country_code} (${block.country_name}) can't open this game: ${block.review_reason.message}`, block.review_reason.fix, `Players in ${block.country_name} can't open this game, on a notice about that country's law. Take out what it names and publish a fixed version, and a person at Zaisma lifts the block, usually within a day.`);
    }
    const gameVersions = versions.filter((version) => version.game_id === game.id);
    const rejected = gameVersions.find((version) => version.scan_status === "rejected" && version.is_newest);
    if (rejected) add("version_rejected", "Your newest version was rejected, so it can't be published.", `get_version with this version_id says what the scan found and how to fix it; then upload a fixed version.`, "Your newest version was rejected, so it can't be published.", rejected.id);
    for (const held of gameVersions.filter((version) => version.scan_status === "held")) {
      const message = held.report_held_at_ms ? "A player report paused this version until a person at Zaisma looks, usually within a day." : "This version is waiting for a person at Zaisma, usually within a day.";
      add("version_held", message, "Nothing to do but wait; get_version shows the result.", message, held.id);
    }
    for (const link of linksOf(game).filter((each) => each.review_reason)) {
      const hostname = new URL(link.destination_url).hostname;
      add("link_flagged", `The link ${link.link_name} opens for nobody: Cloudflare lists ${hostname} for malware or phishing.`, reviewReasonAnswer(link.review_reason!).fix, `A link opens for nobody: Cloudflare lists ${hostname} for malware or phishing. Change it in Links, or ask Cloudflare to look again if the site is yours and safe.`);
    }
    // Off Zaisma's lists (a fake reward holds the game instead, which game_held already says).
    const listingReasons = [game.title_listing_reason, ...listingImages.filter((row) => row.game_id === game.id).map((row) => row.listing_reason)]
      .map((stored) => readReviewReason(stored))
      .filter((listingReason): listingReason is ReviewReason => Boolean(listingReason) && listingReason!.code !== "fake_reward");
    if (game.visibility === "listed" && listingReasons.length) {
      add("game_off_lists", `Zaisma's lists leave this game out until it's fixed, though it plays by its link: ${listingReasons.map((listingReason) => listingReason.message).join(" ")}`, reviewReasonAnswer(listingReasons[0]!).fix, `Zaisma's lists leave this game out until it's fixed. ${reviewReasonAnswer(listingReasons[0]!).message_for_people}`);
    }
    const month = usage.find((row) => row.game_id === game.id);
    const databaseUse = databaseUses[games.indexOf(game)];
    const storageSizeBytes = (databaseUse?.storageSizeBytes ?? 0) + (keptRooms.find((row) => row.game_id === game.id)?.size_bytes ?? 0);
    const isFull = Boolean(databaseUse && storageSizeBytes >= MAXIMUM_GAME_STORAGE_SIZE_BYTES);
    const resetsOn = resetsOnText(Date.now());
    const budgetCents = game.monthly_budget_cents;
    const owner = owners.find((row) => row.id === game.owner_id);
    const canGoPastFree = Boolean(owner && owner.credit_balance_cents > 0);
    // The paused line, then the heads-ups; a heads-up is never given alongside its own paused or full kind.
    if (month?.paused_at_ms) {
      const why =
        month.paused_reason === "budget_used"
          ? `it used its ${dollarsText(budgetCents ?? month.charged_cents)} budget for this month`
          : month.paused_reason === "credit_used"
            ? "your credit ran out"
            : month.paused_reason === "no_real_players"
              ? "it has no real players yet, and games with none have used their share of free hosting this month"
              : month.paused_reason === "free_hosting_ended"
                ? "Zaisma's free hosting for this month is used up across all games"
                : `it used this month's free hosting (it's back on ${resetsOn})`;
      const fix =
        month.paused_reason === "budget_used"
          ? "Raise its budget with update_game (monthly_budget_cents) to start it again now. get_stats shows the month's use."
          : month.paused_reason === "credit_used"
            ? "Add credit with top_up_credit to start it again now. get_credit shows the balance."
            : month.paused_reason === "no_real_players"
              ? `It starts again once real players play it (a minute on screen from a checked browser, off cloud networks; tester links count, and more are needed as it uses more), or on ${resetsOn}. Or add credit (top_up_credit) and give the game a budget (update_game, monthly_budget_cents).`
              : month.paused_reason === "free_hosting_ended"
                ? `Wait for ${resetsOn}, or add credit (top_up_credit) and give the game a budget (update_game, monthly_budget_cents). Servers of your own are never limited.`
                : `Wait for ${resetsOn}, or add credit (top_up_credit) and give the game a budget (update_game, monthly_budget_cents) to keep it going. Rooms on your own server are never limited. get_stats shows the month's use.`;
      const whatToDo =
        month.paused_reason === "budget_used" ? "Raise its budget in Hosting to start it again now." : month.paused_reason === "credit_used" ? "Add credit to start it again now." : month.paused_reason === "no_real_players" ? `It starts again once real players play it, or on ${resetsOn}.` : "Add credit and give the game a budget in Hosting to start it again now.";
      const message = `The game's hosting is paused: ${why}. No new rooms, connections between players or game server requests start, and matches already running get an hour to finish.`;
      add("hosting_paused", message, fix, `${message} ${whatToDo}`);
    }
    if (isFull) {
      const message = `The game's storage (its database and kept rooms) is full at ${MAXIMUM_GAME_STORAGE_SIZE_BYTES / 1024 ** 3} GB, the most a game can keep: the database can change and delete rows, but not grow, and no more rooms can be kept.`;
      add("database_full", message, "Delete rows the game no longer needs with query_database (or export_database to keep them elsewhere), or kept rooms nobody plays with delete_kept_room. get_database and list_kept_rooms show their sizes.", `${message} Delete rows or kept rooms the game no longer needs.`);
    }
    const secondMonth = game.second_free_allowance_month_start_date;
    const nearlyEndCents = (freeHostingEndCents(secondMonth, monthStartDate, month?.has_real_players !== 0) * NEARLY_USED_PCT) / 100;
    const usedPct = (usedCents: number) => freeUsedPct(usedCents, freeAllowanceCents(secondMonth, monthStartDate));
    // The month's stop reaches a free game only: its rooms stop, and what else it runs goes on.
    if (spendingStop?.free_rooms_stopped_at_ms != null && !month?.paused_at_ms && (budgetCents === null || !canGoPastFree) && (month?.used_cents ?? 0) > 0) {
      const message = `Zaisma's free room time for this month is used up across all games: no new rooms or connections between players start until ${resetsOn}, and matches already running get an hour to finish. The game's database and game server requests go on.`;
      add("free_rooms_stopped", message, `Wait for ${resetsOn}, or add credit (top_up_credit) and give the game a budget (update_game, monthly_budget_cents) to start rooms again now. Rooms on your own server are never limited.`, `${message} Add credit and give the game a budget in Hosting to start rooms again now.`);
    }
    if (secondMonth === monthStartDate && !month?.paused_at_ms) {
      const message = `The game filled its free hosting for the first time, so Zaisma gave it a second free allowance this month, once. Next month it has one again.`;
      add("second_free_allowance_started", message, "To keep it going past free hosting, add credit (top_up_credit) and give the game a budget (update_game, monthly_budget_cents). get_stats shows what used it.", `${message} To keep it going past that, add credit and give the game a budget in Hosting.`);
    }
    if (month && !month.paused_at_ms && budgetCents === null && month.used_cents >= nearlyEndCents) {
      const message = `${usedPct(month.used_cents)}% of this month's free hosting is used. When it's all used, new rooms, connections between players and game server requests pause until ${resetsOn}.`;
      add("hosting_nearly_paused", message, "get_stats shows what used it. To keep the game going past it, add credit (top_up_credit) and give the game a budget (update_game, monthly_budget_cents); rooms on your own server are never limited.", `${message} To keep it going past that, add credit and give the game a budget in Hosting.`);
    }
    // A budget with nothing to spend stops at the free hosting all the same.
    if (month && !month.paused_at_ms && budgetCents !== null && month.charged_cents === 0 && !canGoPastFree && month.used_cents >= nearlyEndCents) {
      const message = `${usedPct(month.used_cents)}% of this month's free hosting is used, and there's no credit for the game's budget to spend. When it's all used, new rooms, connections between players and game server requests pause until ${resetsOn} or credit comes in.`;
      add("hosting_nearly_paused", message, "Add credit with top_up_credit. get_credit shows the balance.", `${message} Add credit to keep it going.`);
    }
    if (month && !month.paused_at_ms && budgetCents !== null && month.charged_cents >= (budgetCents * NEARLY_USED_PCT) / 100) {
      const message = `The game has used ${dollarsText(month.charged_cents)} of its ${dollarsText(budgetCents)} budget this month. When it's all used, the game pauses like at the end of its free hosting.`;
      add("hosting_budget_nearly_used", message, "Raise its budget with update_game (monthly_budget_cents) to keep it going. get_credit shows every game's spending.", `${message} Raise its budget in Hosting to keep it going.`);
    }
    if (budgetCents !== null && owner && isCreditLow({ balanceCents: owner.credit_balance_cents, creditLowLineCents: owner.credit_low_line_cents }) && month?.paused_reason !== "credit_used") {
      // No amount: a key that can see the game may not be one that reads the credit.
      add("credit_low", `Credit is low: add credit. It's under ${CREDIT_LIMITS.creditLowPct}% of what there was after your last top-up; when it's used, this game pauses like at the end of its free hosting.`, "Add credit with top_up_credit. get_credit shows the balance.", `Credit is under ${CREDIT_LIMITS.creditLowPct}% of what there was after your last top-up. When it's used, this game pauses like at the end of its free hosting, so add credit.`);
    }
    if (databaseUse && !isFull && storageSizeBytes >= (MAXIMUM_GAME_STORAGE_SIZE_BYTES * NEARLY_USED_PCT) / 100) {
      const message = `The game's storage (its database and kept rooms) is ${NEARLY_USED_PCT}% full: a game keeps at most ${MAXIMUM_GAME_STORAGE_SIZE_BYTES / 1024 ** 3} GB. When it's full, the database can change and delete rows but not grow.`;
      add("database_nearly_full", message, "Delete rows the game no longer needs with query_database (or export_database to keep them elsewhere), or kept rooms nobody plays with delete_kept_room.", `${message} Delete rows or kept rooms the game no longer needs.`);
    }
    const gameFailedErases = failedErases.filter((erase) => erase.game_id === game.id);
    if (gameFailedErases.length) {
      const playerCount = gameFailedErases.length;
      add(
        "player_erase_failed",
        `Zaisma couldn't erase ${playerCount === 1 ? "a player" : `${playerCount} players`} who deleted their account${playerCount === 1 ? "" : "s"} from the game database: ${gameFailedErases[0]!.failure_message ?? "it didn't answer."}`,
        `Fix what stopped it, then erase_player with each player_id: ${gameFailedErases.slice(0, 5).map((erase) => erase.player_id).join(", ")}.`,
        `Zaisma couldn't erase ${playerCount === 1 ? "a player" : `${playerCount} players`} who deleted their account${playerCount === 1 ? "" : "s"} from the game database. Fix what stopped it, then erase ${playerCount === 1 ? "that player" : "them"} again from your AI tool.`,
      );
    }
    const openReportCount = reports.find((row) => row.game_id === game.id)?.report_count ?? 0;
    if (openReportCount) {
      const message = `${openReportCount === 1 ? "A player report is" : `${openReportCount} player reports are`} waiting for Zaisma.`;
      add("reports_open", message, "get_reports shows them by reason, with what players wrote about bugs. Zaisma looks at each one.", `${message} Zaisma looks at each one.`);
    }
  }
  return alertsByGameId;
}

function imageJson(env: Env, image: GameImage) {
  return {
    id: image.id,
    kind: image.kind,
    review_status: image.review_status,
    review_reason: reasonAnswer(image.review_reason),
    listing_reason: reasonAnswer(image.listing_reason),
    width_px: image.width_px,
    height_px: image.height_px,
    size_bytes: image.size_bytes,
    image_url: `${env.SITE_ORIGIN}/img/${image.id}`,
    placeholder_data_url: image.placeholder_data_url,
    created_at: iso(image.created_at_ms),
  };
}

/**
 * Covers and screenshots. Only real PNG, JPEG or WebP files are stored (checked by their bytes),
 * and they're sent with headers that stop a browser treating them as anything else.
 */
/** Whether the browser asking is signed in as the account that owns the game: before review, only it sees the game's pictures. */
async function isOwnerSignedIn(request: Request, env: Env, gameOwnerId: string | null): Promise<boolean> {
  const session = await currentSession(request, env);
  const owner = session ? await env.DB.prepare("SELECT id FROM owners WHERE account_id = ?").bind(session.userId).first<{ id: string }>() : null;
  return Boolean(owner) && owner!.id === gameOwnerId;
}

async function serveImage(request: Request, env: Env, imagePath: string): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  // /img/:id, /img/:id/card.jpg (the picture made into a share card JPEG) or /img/:id/w<width>.webp (one of its sizes, SIZED_IMAGE_WIDTHS_PX).
  const [id = "", copy] = imagePath.split("/");
  const isCard = copy === "card.jpg";
  const sizedWidthPx = Number(/^w(\d+)\.webp$/.exec(copy ?? "")?.[1]);
  const isSized = (SIZED_IMAGE_WIDTHS_PX as readonly number[]).includes(sizedWidthPx);
  if (!isIdOf("image", id) || (copy !== undefined && !isCard && !isSized) || (request.method !== "GET" && request.method !== "HEAD")) return notFound();
  const image = await imageById(env.DB, id);
  if (!image || image.review_status === "rejected") return notFound();
  const game = await env.DB.prepare("SELECT review_status, owner_id FROM games WHERE id = ?").bind(image.game_id).first<{ review_status: string; owner_id: string | null }>();
  if (!game) return notFound();
  let cacheControl = "public, max-age=3600";
  if (image.review_status !== "approved" || game.review_status === "removed") {
    // Before review only the owner sees it.
    if (!(await isOwnerSignedIn(request, env, game.owner_id))) return notFound();
    cacheControl = "private, no-store";
  }
  if (isCard && image.review_status === "approved") {
    const card = await cardImage(env, image);
    if (card) {
      return new Response(request.method === "HEAD" ? null : card.body, {
        headers: { "Content-Type": "image/jpeg", "Content-Length": String(card.size), "Cache-Control": cacheControl, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": "inline" },
      });
    }
  }
  // A size is made once and kept; before the picture is approved, or where it can't be made, the picture itself is sent.
  const sized = isSized && image.review_status === "approved" ? await sizedImage(env, image, sizedWidthPx) : null;
  const stored = sized ?? (await env.GAMES.get(imageKey(image)));
  if (!stored) return notFound();
  // A picture is never changed in place, so a browser holding it asks whether it's still the same and gets a few bytes back, not the picture again.
  if (request.headers.get("If-None-Match") === stored.httpEtag) return new Response(null, { status: 304, headers: { ETag: stored.httpEtag, "Cache-Control": cacheControl } });
  return new Response(request.method === "HEAD" ? null : stored.body, {
    headers: {
      "Content-Type": sized ? "image/webp" : image.content_type,
      "Content-Length": String(stored.size),
      ETag: stored.httpEtag,
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}

/**
 * An approved picture as a share card: fitted inside 1200 by 630 and saved as a JPEG, which every chat
 * app takes (WhatsApp drops pictures over about 600 KB). Made once with Cloudflare Images and kept next
 * to the picture; null when there's no Images binding or it fails, and the picture itself is sent.
 */
async function cardImage(env: Env, image: GameImage): Promise<R2ObjectBody | null> {
  const kept = await env.GAMES.get(cardImageKey(image));
  if (kept || !env.IMAGES) return kept;
  const original = await env.GAMES.get(imageKey(image));
  if (!original) return null;
  try {
    const made = await env.IMAGES.input(original.body).transform({ width: CARD_IMAGE_WIDTH_PX, height: CARD_IMAGE_HEIGHT_PX, fit: "scale-down" }).output({ format: "image/jpeg", quality: 85 });
    await env.GAMES.put(cardImageKey(image), await new Response(made.image()).arrayBuffer(), { httpMetadata: { contentType: "image/jpeg" } });
  } catch (error) {
    console.error("share card image failed", image.id, error);
    return null;
  }
  return env.GAMES.get(cardImageKey(image));
}

/**
 * An approved picture at one of its sizes (SIZED_IMAGE_WIDTHS_PX): scaled down to that width, never up, and saved as WebP, made once with
 * Cloudflare Images and kept next to the picture. null when there's no Images binding or it fails, and the picture itself is sent.
 */
async function sizedImage(env: Env, image: GameImage, widthPx: number): Promise<R2ObjectBody | null> {
  const kept = await env.GAMES.get(sizedImageKey(image, widthPx));
  if (kept || !env.IMAGES) return kept;
  const original = await env.GAMES.get(imageKey(image));
  if (!original) return null;
  try {
    const made = await env.IMAGES.input(original.body).transform({ width: widthPx, fit: "scale-down" }).output({ format: "image/webp", quality: 85 });
    await env.GAMES.put(sizedImageKey(image, widthPx), await new Response(made.image()).arrayBuffer(), { httpMetadata: { contentType: "image/webp" } });
  } catch (error) {
    console.error("sized image failed", image.id, widthPx, error);
    return null;
  }
  return env.GAMES.get(sizedImageKey(image, widthPx));
}

/** The game's link, or one of its rooms', and its QR code as an SVG document, for posters, booths and trailers. */
function qrCodeFor(env: Env, game: Game, roomCode: string | null) {
  let code: string | null = null;
  if (roomCode !== null && roomCode !== "") {
    code = roomCodeOf(roomCode);
    if (!code) throw new ApiError("bad_room_code", { message: `room_code ${JSON.stringify(roomCode)} isn't a room's code.`, field: "room_code", fix: "Give the six characters players see, like K7Q2MX, or leave room_code out for the game's own link." });
  }
  const linkUrl = gameLinkUrl(env, game.slug, code);
  return { link_url: linkUrl, qr_code_svg: qrCodeSvg(linkUrl) };
}
