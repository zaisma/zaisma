import { env } from "cloudflare:test";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";
import { ACCOUNT_AREAS, AREA_ACCESS_BY_LEVEL, AREA_ACCESS_CHOICES, allows, type AreaAccess, type KeyScope } from "@zaisma/core";
import { API_INPUT_SHAPES, API_ROUTES, BANNED_DEVELOPER_ROUTES, type ApiInputName, type ApiRoute } from "../../apps/site/src/developer.ts";
import { CONFIRMED_ON_A_PAGE, SAMPLES, keyFor, makeCall, nameOf, setUpOwnersCall, useRealServers, useStandInServers, withNothingThere, type Sample, type SiteWorker, type World } from "../site/access-world.ts";
import { cellOf, problemWithAnswer, tooLongFor, wrongValueOf, type CallAnswer, type CallerKind, type ExpectedAnswer, type GridCell } from "./cells.ts";
import { SITE, emptyWorlds, keyWithScope, makeWorld, ownersThings, rememberEmptyTables, sessionCookie, showsPrivateValue, useSessions, whileBanned } from "./site-world.ts";

vi.mock("../../apps/site/src/shader-check.ts", async (original) => (await import("./shader-stand-in.ts")).shaderCheckStandIn(await original<object>()));
vi.resetModules();
const worker = (await import("../../apps/site/src/index.ts")).default as unknown as SiteWorker;
const call = makeCall(worker);

/**
 * Every call in API_ROUTES by every kind of caller (test/grid/cells.ts). test/site/access-checks.test.ts holds the router's
 * refusals to their exact words and blocks on them; this tries who it doesn't: no credential, a session, and a banned account.
 */

const OWNING_PARTS = ["game", "webhook", "sign_in_app", "forum_topic"];
const ownsSomething = (apiRoute: ApiRoute) => Object.values(apiRoute.pathParts).some((part) => OWNING_PARTS.includes(part));

beforeAll(async () => {
  useStandInServers();
  await useSessions();
  await rememberEmptyTables();
});

afterEach(emptyWorlds);

afterAll(useRealServers);

describe("every call", () => {
  it.for(API_ROUTES.map((apiRoute) => [`api:${nameOf(apiRoute)}`, apiRoute] as const))("%s", { timeout: 120_000 }, async ([doorId, apiRoute], { task }) => {
    const routeName = nameOf(apiRoute);
    const cells: GridCell[] = (task.meta.grid_cells = []);
    const world: World = await makeWorld(routeName);
    const sample = SAMPLES[routeName]!(world);
    const asOwner: Sample & { pathValues: Record<string, string> } = { ...sample, pathValues: { ...world.values, ...sample.pathValues } };

    /** One try: the answer, and what it did to the owner's things. */
    const attempt = async (key: string | null, headers: Record<string, string> = {}, given = asOwner, callerKnows: readonly string[] = []): Promise<CallAnswer> => {
      const before = await ownersThings(world);
      const made = await call(apiRoute, key, given, headers);
      return { http_status: made.httpStatus, location: null, is_owners_changed: (await ownersThings(world)) !== before, is_private_value_shown: showsPrivateValue(world, made.answerText, JSON.stringify({ ...given, bytes: undefined }), callerKnows) };
    };
    const ownKeyAttempt = (key: string) => attempt(key, {}, asOwner, [world.victimAccountId, world.victimOwnerId, world.otherSlug]);
    const judge = async (callerKind: CallerKind, expected: ExpectedAnswer, answer: CallAnswer, nothingThere: CallAnswer | null = null) => cells.push(cellOf(doorId, callerKind, problemWithAnswer(expected, null, answer, nothingThere)));
    const keyOf = (scope?: KeyScope) => (scope ? keyWithScope(world.victimAccountId, scope) : keyFor(world.victimAccountId));

    await judge("stranger", "refused", await attempt(null));

    // What the call's contract says it takes and how much it can be used: refused before any of its own code runs.
    const ownersKey = keyOf();
    const wrongSamples: (typeof asOwner)[] = [];
    if (apiRoute.body && apiRoute.body !== "bytes" && !sample.bytes) {
      wrongSamples.push({ ...asOwner, body: { ...(sample.body as object | undefined), zzz_no_such_field: "x" } });
      for (const name of Object.keys(apiRoute.body.inputs)) {
        const wrong = wrongValueOf(API_INPUT_SHAPES[name as ApiInputName]);
        if (wrong === undefined) continue;
        wrongSamples.push({ ...asOwner, body: { ...(sample.body as object | undefined), [name]: wrong } });
        break;
      }
    }
    for (const name of Object.keys(apiRoute.query)) {
      const tooLong = tooLongFor(API_INPUT_SHAPES[name as ApiInputName]);
      if (tooLong) wrongSamples.push({ ...asOwner, query: { ...sample.query, [name]: tooLong } });
      if (tooLong) break;
    }
    if (!wrongSamples.length) wrongSamples.push({ ...asOwner, query: { ...sample.query, zzz_no_such_field: "x" } });
    const ownersBefore = await ownersThings(world);
    const wrongAnswers = [];
    for (const wrongSample of wrongSamples) wrongAnswers.push(await call(apiRoute, await ownersKey, wrongSample));
    const wrongPassed = wrongAnswers.find((answer) => answer.httpStatus < 400 || answer.httpStatus >= 500);
    cells.push(cellOf(doorId, "wrong_shape", (await ownersThings(world)) !== ownersBefore ? "A request of the wrong shape changed something." : wrongPassed ? `Answered ${wrongPassed.httpStatus} to a request of the wrong shape.` : null));
    if ("level" in apiRoute.limit) {
      const refusing = { ...env, [`LIMIT_${apiRoute.limit.level.toUpperCase()}`]: { limit: async () => ({ success: false }) } };
      const past = await makeCall(worker, refusing as typeof env)(apiRoute, await ownersKey, asOwner);
      cells.push(cellOf(doorId, "past_limit", past.httpStatus === 429 ? null : `Answered ${past.httpStatus} past its limit.`));
    }

    // Another account, by their key and by their session from Zaisma's own pages: nothing of the owner's, as if it weren't there.
    const strangerKey = await keyFor(world.strangerAccountId);
    const strangerSession = { cookie: await sessionCookie(world.strangerAccountId), origin: SITE };
    if (ownsSomething(apiRoute)) {
      // The owner's own game, webhook, sign-in app or private topic, whatever public one the owner's call uses.
      const owning = Object.fromEntries(Object.entries(apiRoute.pathParts).filter(([, part]) => OWNING_PARTS.includes(part)).map(([name]) => [name, world.values[name]!]));
      const onOwners = { ...asOwner, pathValues: { ...asOwner.pathValues, ...owning } };
      const nothing = withNothingThere(world, onOwners).sample;
      const byKey = await attempt(strangerKey, {}, onOwners);
      const bySession = await attempt(null, strangerSession, onOwners);
      const failed = problemWithAnswer("like_nothing_there", null, byKey, await attempt(strangerKey, {}, nothing)) ?? problemWithAnswer("like_nothing_there", null, bySession, await attempt(null, strangerSession, nothing));
      cells.push(cellOf(doorId, "another_account", failed));
    } else {
      const failed = problemWithAnswer("own_things_only", null, await attempt(strangerKey)) ?? problemWithAnswer("own_things_only", null, await attempt(null, strangerSession));
      cells.push(cellOf(doorId, "another_account", failed));
    }

    // The owner's key below what the call needs: every level that doesn't allow it, then a custom key one choice short.
    if (apiRoute.area) {
      const area = apiRoute.area;
      let failed: string | null = null;
      for (const level of ["read", "upload", "publish", "full"] as const) {
        if (!allows(AREA_ACCESS_BY_LEVEL[level], area, apiRoute.choice)) failed ??= problemWithAnswer("refused", null, await ownKeyAttempt(await keyOf({ accessLevel: level, gameSlugs: null })));
      }
      const choices: readonly string[] = AREA_ACCESS_CHOICES[area];
      for (const choice of choices.slice(0, choices.indexOf(apiRoute.choice))) {
        failed ??= problemWithAnswer("refused", null, await ownKeyAttempt(await keyOf({ accessLevel: "custom", areaAccess: { ...AREA_ACCESS_BY_LEVEL.full, [area]: choice } as AreaAccess, gameSlugs: null })));
      }
      cells.push(cellOf(doorId, "weaker_key", failed));
    }

    // A key of the owner's for their other game.
    if (Object.values(apiRoute.pathParts).includes("game") || apiRoute.isAccountWide || (apiRoute.area && ACCOUNT_AREAS.includes(apiRoute.area))) {
      const limited = await keyOf({ accessLevel: "custom", areaAccess: { ...AREA_ACCESS_BY_LEVEL.full, sign_in_app_access: "none", webhook_access: "none" }, gameSlugs: [world.otherSlug] });
      await judge("another_games_key", "refused", await ownKeyAttempt(limited));
    }

    // The owner, banned: a whole-account ban closes every call, a developer ban all but what keeps their work theirs.
    const ownerKey = await keyFor(world.victimAccountId);
    await judge("banned_account", "refused", await whileBanned(world.victimAccountId, "whole_account", () => ownKeyAttempt(ownerKey)));
    const isOpenWhenBanned = BANNED_DEVELOPER_ROUTES.has(routeName);
    await setUpOwnersCall(routeName, world);
    await judge("banned_developer", isOpenWhenBanned ? "goes_through" : "refused", await whileBanned(world.victimAccountId, "developer", () => ownKeyAttempt(ownerKey)));

    // And the owner, so each refusal above was the door's, not a bad example.
    // On a world of its own: another account's own call above may have taken what this one needs, like a game's link name.
    const ownersWorld = await makeWorld(routeName);
    const ownersSample = SAMPLES[routeName]!(ownersWorld);
    await setUpOwnersCall(routeName, ownersWorld);
    const owner = await call(apiRoute, await keyFor(ownersWorld.victimAccountId), { ...ownersSample, pathValues: { ...ownersWorld.values, ...ownersSample.pathValues } });
    const ownersAnswer: CallAnswer = { http_status: owner.httpStatus, location: null, is_owners_changed: false, is_private_value_shown: false };
    if (CONFIRMED_ON_A_PAGE.has(routeName)) cells.push(cellOf(doorId, "owner", owner.httpStatus === 403 ? null : `Answered ${owner.httpStatus}, where it needs a passkey on a page first.`));
    else cells.push(cellOf(doorId, "owner", problemWithAnswer("goes_through", null, ownersAnswer)));
    // What the owner got is what the contract says: anything else was cut and noted (apps/site/src/answers.ts).
    const cutAnswer = await env.DB.prepare("SELECT field_paths FROM door_answer_cuts WHERE door_id = ?").bind(`api:${apiRoute.method} ${apiRoute.path}`).first<{ field_paths: string }>();
    cells.push(cellOf(doorId, "answer_shape", cutAnswer ? `Answered with ${cutAnswer.field_paths}, which it doesn't declare.` : null));
  });
});
