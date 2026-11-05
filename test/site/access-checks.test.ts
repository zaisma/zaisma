import { env } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACCOUNT_AREAS, AREA_ACCESS_BY_LEVEL, AREA_ACCESS_CHOICES, allows, type AccessArea, type AreaAccess } from "@zaisma/core";
import { API_ROUTES, type ApiInput, type ApiRoute } from "../../apps/site/src/developer.ts";
import { errorProblems } from "../schema-check.ts";
import {
  CONFIRMED_ON_A_PAGE,
  KEY_USE_EVENT_KINDS,
  SAMPLES,
  clearWorlds,
  everything,
  keyFor,
  makeCall,
  makeWorld,
  nameOf,
  privateValues,
  setUpOwnersCall,
  useRealServers,
  useStandInServers,
  withNothingThere,
  type Sample,
  type SiteWorker,
  type World,
} from "./access-world.ts";

// A shader check that goes through draws in a stand-in that answers a clean drawing at once: what this file checks is who gets
// through, and the real drawing (headless Chromium, whose start alone takes seconds on a busy runner) is test/site/shader-check.test.ts's.
const drawings = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../apps/site/src/shader-check.ts", async (original) => {
  const { SHADER_LIMITS } = await import("@zaisma/core");
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const frames = (value: number) => Array.from({ length: SHADER_LIMITS.checkFrameCount }, () => value);
  const render = async () => {
    drawings.count++;
    return {
      compileError: null,
      referenceFrameTimesMs: Array.from({ length: 30 }, () => SHADER_LIMITS.referenceFrameMs),
      levels: [{ qualityLevel: 0, frameTimesMs: frames(20), frameLuminances: frames(0.4) }],
      stillPng: PNG,
      smallStillPng: PNG,
      framePngs: Array.from({ length: SHADER_LIMITS.sampledFrameCount }, () => PNG),
      shimmerPngs: [],
      sheetPng: null,
    };
  };
  return { ...(await original<typeof import("../../apps/site/src/shader-check.ts")>()), shaderCheckDeps: () => ({ render }) };
});
// The site as loaded again with the stand-in: SELF's copy was loaded before this file's stand-ins.
vi.resetModules();
const worker = (await import("../../apps/site/src/index.ts")).default;

/**
 * Access checks in the router (docs/DECISIONS.md, "Access checks in the router"). Every call in
 * API_ROUTES, built from its own declarations:
 *
 * - as a stranger (another developer's full key) on the developer's things, and naming them in each input
 *   that names something, and naming them from inside the stranger's own game or topic,
 * - with each key level below what the call needs,
 * - with a key limited to the developer's other game,
 * - and with each input that needs more than the call.
 *
 * Each must be refused, a stranger exactly as if nothing were there, with nothing changed: the database,
 * both buckets and the game's own database and secrets. Then the same call by the developer with a full
 * key must go through, so each refusal was the router's, not a bad example. A call, path part or input
 * without its declarations, or without an example here, fails.
 */




/**
 * Calls that change something (or read something private) and write no security event, and why. Every other
 * call that changes something, and each of LOGGED_READS, must write one for the developer's account.
 */
const UNLOGGED_CHANGES: Record<string, string> = {
  "POST /check": "Changes nothing: it reads the files it's sent and keeps nothing.",
  "POST /games/:slug/uploads": "Only answers which files are missing.",
  "PUT /files/:sha256": "A piece of an upload: the version is the event.",
  "POST /files/:sha256/parts": "A piece of an upload: the version is the event.",
  "PUT /files/:sha256/parts/:part_number": "A piece of an upload: the version is the event.",
  "POST /files/:sha256/parts/done": "A piece of an upload: the version is the event.",
  "POST /webhooks/:webhook_id/test": "Changes nothing.",
  "POST /games/:slug/shader-checks": "Changes nothing of the game's: it draws the shader and keeps only a sheet picture for a day.",
  "POST /games/:slug/purchases/:purchase_id/handled": "Delivery bookkeeping, once for every purchase players make: the purchase's handled_at is its record.",
  "POST /games/:slug/rooms/:room_code/messages": "A message to the game's own room, as often as the game's tools send them: the game server decides what it does, and keeps its own record.",
};
/** Reads that are logged: what a player saved, and the whole database. */
const LOGGED_READS = ["GET /games/:slug/export/download", "GET /games/:slug/database/export", "GET /games/:slug/saves/:player_id", "GET /games/:slug/saves/:player_id/copies/:save_copy_id"];
const isLogged = (apiRoute: ApiRoute) => (apiRoute.method !== "GET" && !(nameOf(apiRoute) in UNLOGGED_CHANGES) && !apiRoute.path.startsWith("/forum")) || LOGGED_READS.includes(nameOf(apiRoute));

/**
 * Path parts that name something inside the path's game or topic by its ID: from inside the stranger's own
 * game or topic, the developer's must be answered like nothing there.
 */
const IDS_INSIDE = ["image_id", "shader_id", "version_id", "tester_id", "save_copy_id", "database_restore_id", "kept_room_restore_id", "kept_room_restore_batch_id", "post_id", "media_id", "purchase_id", "scheduled_room_message_id"];
/** Path parts inside a game that aren't IDs of the developer's things, and why a stranger may use them in their own game. */
const NAMES_INSIDE: Record<string, string> = {
  secret_name: "A name the developer picks: any game can have a secret of that name.",
  screen: "wide or phone: every game has a background for both.",
  room_code: "A room's code is only unique inside its game: any game can have a room with that code.",
  player_id: "A player's save or items in this game: a game's developer reads and changes its own players' saves and items, and a player has them in each game they play.",
  item_name: "A name the developer picks: any game can have an item of that name.",
};

/**
 * Inputs that do a higher choice's work, and the choice each needs (docs/DECISIONS.md, "Developers hold
 * the keys"). The declarations must say so, and an input declared to need more must be here: a new one is
 * a decision about access, so it's written down twice.
 */
const INPUTS_THAT_NEED_MORE: Record<string, [AccessArea, string]> = {
  "POST /games/:slug/versions publish_when_approved": ["version_access", "publish"],
  "PATCH /games/:slug monthly_budget_cents": ["credit_access", "write"],
  "PATCH /games/:slug full_game_item_name": ["purchase_access", "write"],
};

/** What a stranger names in an input that names something: the developer's own. */
const NAMED: Record<Extract<ApiInput, { kind: "names" }>["what"], (world: World) => unknown> = {
  game: (world) => world.values.slug,
  game_list: (world) => [world.values.slug],
  files: (world) => [{ path: "index.html", sha256: world.ownedSha256, size_bytes: 20 }],
  forum_topic: (world) => world.values.topic_id,
};

const placeholders = (apiRoute: ApiRoute) => [...apiRoute.path.matchAll(/:([a-z0-9_]+)/g)].map((match) => match[1]!);
const OWNING_PARTS = ["game", "webhook", "sign_in_app", "forum_topic"];
const ownsSomething = (apiRoute: ApiRoute) => Object.values(apiRoute.pathParts).some((pathPart) => OWNING_PARTS.includes(pathPart));
const bodyInputs = (apiRoute: ApiRoute): Record<string, ApiInput> => (apiRoute.body && apiRoute.body !== "bytes" ? apiRoute.body.inputs : {});
const allInputs = (apiRoute: ApiRoute) => ({ ...apiRoute.query, ...bodyInputs(apiRoute) });









const call = makeCall(worker as unknown as SiteWorker);

beforeAll(useStandInServers);

afterAll(async () => {
  useRealServers();
  await clearWorlds();
});

describe("the declarations", () => {
  it("name every path part, and only those", () => {
    for (const apiRoute of API_ROUTES) expect(Object.keys(apiRoute.pathParts).sort(), nameOf(apiRoute)).toEqual(placeholders(apiRoute).sort());
  });

  it("say what each path reaches, as its parts do", () => {
    for (const apiRoute of API_ROUTES) {
      const parts = Object.values(apiRoute.pathParts);
      const expected = parts.includes("webhook")
        ? ["webhook"]
        : parts.includes("sign_in_app")
          ? ["sign_in_app"]
          : parts.includes("forum_topic")
            ? ["forum_topic"]
            : parts.includes("game")
              ? [apiRoute.pathParts.player_id && apiRoute.path.includes("/saves/") ? "player_save" : "game"]
              : ["account", "nothing_private"];
      expect(expected, nameOf(apiRoute)).toContain(apiRoute.reaches);
    }
  });

  it("sort every part inside a game or topic", () => {
    for (const apiRoute of API_ROUTES) {
      for (const [name, pathPart] of Object.entries(apiRoute.pathParts)) {
        if (pathPart !== "in_game" && pathPart !== "in_forum_topic") continue;
        expect(IDS_INSIDE.includes(name) || name in NAMES_INSIDE, `${nameOf(apiRoute)}: :${name} is inside its game or topic; add it to IDS_INSIDE (another's ID, refused from inside the stranger's own) or NAMES_INSIDE with why a stranger may use it.`).toBe(true);
      }
    }
  });

  it("need more than reading for a call that changes something, and no more for one that reads", () => {
    // Calls that only read but take a body, so they can't be a GET: the game check reads the files it's sent and keeps nothing.
    const READS_WITH_A_BODY = new Set(["POST /check"]);
    for (const apiRoute of API_ROUTES) {
      if (apiRoute.method === "GET" || READS_WITH_A_BODY.has(nameOf(apiRoute))) expect(["", "read"], `${nameOf(apiRoute)} only reads`).toContain(apiRoute.choice);
      else expect(["none", "read", ""], `${nameOf(apiRoute)} changes something, so it needs write, upload or publish`).not.toContain(apiRoute.choice);
    }
  });

  it("hold the inputs that do a higher choice's work to that choice", () => {
    for (const [inputName, [area, choice]] of Object.entries(INPUTS_THAT_NEED_MORE)) {
      const apiRoute = API_ROUTES.find((candidate) => inputName.startsWith(`${nameOf(candidate)} `));
      expect(apiRoute ? allInputs(apiRoute)[inputName.split(" ").at(-1)!] : undefined, inputName).toMatchObject({ kind: "needs", area, choice });
    }
    for (const apiRoute of API_ROUTES) {
      for (const [name, input] of Object.entries(allInputs(apiRoute))) {
        if (input.kind === "needs") expect(INPUTS_THAT_NEED_MORE, `${nameOf(apiRoute)} ${name} needs more than its call: add it to INPUTS_THAT_NEED_MORE`).toHaveProperty([`${nameOf(apiRoute)} ${name}`]);
      }
    }
  });

  it("take no body on a GET, and give an input its own access only when it needs more than the call", () => {
    for (const apiRoute of API_ROUTES) {
      if (apiRoute.method === "GET") expect(apiRoute.body, nameOf(apiRoute)).toBeNull();
      for (const [name, input] of Object.entries(allInputs(apiRoute))) {
        if (input.kind !== "needs") continue;
        expect(AREA_ACCESS_CHOICES[input.area] as readonly string[], `${nameOf(apiRoute)} ${name}`).toContain(input.choice);
        const isMore = input.area !== apiRoute.area || !allows({ ...AREA_ACCESS_BY_LEVEL.read, [input.area]: apiRoute.choice } as AreaAccess, input.area, input.choice);
        expect(isMore, `${nameOf(apiRoute)} ${name} needs no more than the call itself`).toBe(true);
      }
    }
  });

  it("have an example here for every call, and none for a call that isn't one", () => {
    expect(API_ROUTES.map(nameOf).filter((routeName) => !(routeName in SAMPLES)), "Add an example of each new call to SAMPLES in this file, as it goes through with a full key.").toEqual([]);
    expect(Object.keys(SAMPLES).filter((routeName) => !API_ROUTES.some((apiRoute) => nameOf(apiRoute) === routeName))).toEqual([]);
  });
});

describe("every call", () => {
  it.each(API_ROUTES.map((apiRoute) => [nameOf(apiRoute), apiRoute] as const))("%s refuses whoever it should, with nothing changed", async (routeName, apiRoute) => {
    const world = await makeWorld(routeName);
    const sample = SAMPLES[routeName]!(world);
    const asDeveloper = { ...sample, pathValues: { ...world.values, ...sample.pathValues } };
    const strangerKey = await keyFor(world.strangerAccountId);
    const before = await everything(world);
    const refusals: string[] = [];

    /** A refusal: the error's shape, the code if one is expected, and nothing changed anywhere. */
    const refused = async (caseName: string, made: Awaited<ReturnType<typeof call>>, code?: string, field?: string) => {
      refusals.push(caseName);
      expect(made.httpStatus, `${caseName}: ${made.answerText.slice(0, 300)}`).toBeGreaterThanOrEqual(400);
      expect(made.httpStatus, `${caseName}: ${made.answerText.slice(0, 300)}`).toBeLessThan(500);
      expect(errorProblems(made.answer, made.httpStatus), caseName).toEqual([]);
      if (code) expect(made.answer.error?.code, `${caseName}: ${made.answerText.slice(0, 300)}`).toBe(code);
      if (field) expect(made.answer.error?.field, caseName).toBe(field);
      expect(await everything(world), `${caseName} changed something`).toBe(before);
    };
    /** A stranger's refusal must be the same answer as for something that isn't there. */
    const refusedLikeNothing = async (caseName: string, strangerSample: Sample & { pathValues: Record<string, string> }) => {
      const made = await call(apiRoute, strangerKey, strangerSample);
      await refused(caseName, made);
      expect(made.answer.error?.code, caseName).not.toBe("key_not_allowed");
      const nothing = withNothingThere(world, strangerSample);
      const madeOnNothing = await call(apiRoute, strangerKey, nothing.sample);
      expect({ httpStatus: madeOnNothing.httpStatus, answer: nothing.swapBack(madeOnNothing.answerText) }, `${caseName}: not the same as nothing there`).toEqual({ httpStatus: made.httpStatus, answer: made.answerText });
    };

    // A stranger on the developer's game, webhook, sign-in app or private topic.
    if (ownsSomething(apiRoute)) await refusedLikeNothing("a stranger on the developer's", { ...sample, pathValues: { ...world.values, ...sample.pathValues, ...pickOwning(apiRoute, world.values) } });
    // A stranger naming the developer's things in an input, from their own game or topic.
    const strangerPath = { ...world.values, ...sample.pathValues, ...world.strangerValues };
    for (const [name, input] of Object.entries(allInputs(apiRoute))) {
      if (input.kind !== "names") continue;
      const query = { ...sample.query };
      const body = { ...sample.body };
      for (const [otherName, other] of Object.entries(allInputs(apiRoute))) if (other.kind === "names") delete (otherName in apiRoute.query ? query : body)[otherName];
      const named = NAMED[input.what](world);
      if (name in apiRoute.query) query[name] = named as string;
      else body[name] = named;
      const hasJsonBody = apiRoute.body !== null && apiRoute.body !== "bytes";
      await refusedLikeNothing(`a stranger naming the developer's in ${name}`, { pathValues: strangerPath, query, body: hasJsonBody ? body : undefined, bytes: sample.bytes });
    }
    // A stranger reaching an ID of the developer's from inside their own game or topic.
    for (const name of Object.keys(apiRoute.pathParts).filter((part) => IDS_INSIDE.includes(part))) {
      await refusedLikeNothing(`a stranger on the developer's ${name} from their own`, { ...sample, pathValues: { ...strangerPath, [name]: world.values[name]! } });
    }
    // A stranger's own account: nothing of the developer's in what they read.
    if (!ownsSomething(apiRoute) && apiRoute.method === "GET" && !Object.values(allInputs(apiRoute)).some((input) => input.kind === "names")) {
      const made = await call(apiRoute, strangerKey, asDeveloper);
      for (const value of privateValues(world)) expect(made.answerText, `a stranger's ${routeName} answers the developer's ${value}`).not.toContain(value);
      expect(await everything(world), `a stranger's ${routeName} changed something`).toBe(before);
    }

    // Each key level below what the call needs, and a custom key one choice short.
    if (apiRoute.area) {
      const area = apiRoute.area;
      for (const level of ["read", "upload", "publish", "full"] as const) {
        if (allows(AREA_ACCESS_BY_LEVEL[level], area, apiRoute.choice)) continue;
        await refused(`a${level === "upload" ? "n" : ""} ${level} key`, await call(apiRoute, await keyFor(world.victimAccountId, { accessLevel: level, gameSlugs: null }), asDeveloper), "key_not_allowed");
      }
      const choices: readonly string[] = AREA_ACCESS_CHOICES[area];
      for (const choice of choices.slice(0, choices.indexOf(apiRoute.choice))) {
        const areaAccess = { ...AREA_ACCESS_BY_LEVEL.full, [area]: choice } as AreaAccess;
        await refused(`a custom key with ${area} ${choice}`, await call(apiRoute, await keyFor(world.victimAccountId, { accessLevel: "custom", areaAccess, gameSlugs: null }), asDeveloper), "key_not_allowed");
      }
    }

    // A call that reads more areas (an export) needs each: a custom key one choice short in any of them is refused.
    for (const more of apiRoute.alsoNeeds) {
      const choices: readonly string[] = AREA_ACCESS_CHOICES[more.area];
      for (const choice of choices.slice(0, choices.indexOf(more.choice))) {
        const areaAccess = { ...AREA_ACCESS_BY_LEVEL.full, [more.area]: choice } as AreaAccess;
        await refused(`a custom key with ${more.area} ${choice}`, await call(apiRoute, await keyFor(world.victimAccountId, { accessLevel: "custom", areaAccess, gameSlugs: null }), asDeveloper), "key_not_allowed");
      }
    }

    // A call that shows where the account is used from takes only a full key for every game.
    if (apiRoute.isFullKeyOnly) {
      for (const level of ["read", "upload", "publish"] as const) {
        await refused(`a${level === "upload" ? "n" : ""} ${level} key`, await call(apiRoute, await keyFor(world.victimAccountId, { accessLevel: level, gameSlugs: null }), asDeveloper), "key_not_allowed");
      }
      await refused("a full key for one game", await call(apiRoute, await keyFor(world.victimAccountId, { accessLevel: "full", gameSlugs: [world.values.slug!] }), asDeveloper), "key_not_allowed");
    }

    // A key for the developer's other game.
    const limitedKey = () => keyFor(world.victimAccountId, { accessLevel: "custom", areaAccess: { ...AREA_ACCESS_BY_LEVEL.full, sign_in_app_access: "none", webhook_access: "none" }, gameSlugs: [world.otherSlug] });
    const gameField = Object.entries(apiRoute.pathParts).find(([, pathPart]) => pathPart === "game")?.[0];
    if (gameField || apiRoute.isAccountWide || (apiRoute.area && ACCOUNT_AREAS.includes(apiRoute.area))) {
      await refused("a key for the developer's other game", await call(apiRoute, await limitedKey(), asDeveloper), "key_not_allowed", gameField && !apiRoute.isAccountWide && !(apiRoute.area && ACCOUNT_AREAS.includes(apiRoute.area)) ? gameField : undefined);
    }
    for (const [name, input] of Object.entries(allInputs(apiRoute))) {
      if (input.kind !== "names" || (input.what !== "game" && input.what !== "game_list") || gameField || (apiRoute.area && ACCOUNT_AREAS.includes(apiRoute.area))) continue;
      const named = NAMED[input.what](world);
      const limitedSample = name in apiRoute.query ? { ...asDeveloper, query: { ...asDeveloper.query, [name]: named as string } } : { ...asDeveloper, body: { ...asDeveloper.body, [name]: named } };
      await refused(`a key for the developer's other game naming this one in ${name}`, await call(apiRoute, await limitedKey(), limitedSample), "key_not_allowed", name);
    }

    // Each input that needs more than the call, from a key that has just what the call needs.
    for (const [name, input] of Object.entries(allInputs(apiRoute))) {
      if (input.kind !== "needs") continue;
      const choices: readonly string[] = AREA_ACCESS_CHOICES[input.area];
      const areaAccess = { ...AREA_ACCESS_BY_LEVEL.full, [input.area]: choices[choices.indexOf(input.choice) - 1] } as AreaAccess;
      expect(allows(areaAccess, apiRoute.area as AccessArea, apiRoute.choice), `${routeName}: a key short of ${name}'s access can't make the call at all`).toBe(true);
      const withInput = name in apiRoute.query ? { ...asDeveloper, query: { ...asDeveloper.query, [name]: "true" } } : { ...asDeveloper, body: { ...asDeveloper.body, [name]: true } };
      await refused(`a key without ${input.area} ${input.choice} sending ${name}`, await call(apiRoute, await keyFor(world.victimAccountId, { accessLevel: "custom", areaAccess, gameSlugs: null }), withInput), "key_not_allowed", name);
    }

    // An input the call doesn't declare, in the query and in a JSON body.
    const developerKey = await keyFor(world.victimAccountId);
    await refused("an input in the query it doesn't take", await call(apiRoute, developerKey, { ...asDeveloper, query: { ...asDeveloper.query, not_an_input: "1" } }), "unknown_field", "not_an_input");
    if (apiRoute.body && apiRoute.body !== "bytes") await refused("an input in the body it doesn't take", await call(apiRoute, developerKey, { ...asDeveloper, body: { ...asDeveloper.body, not_an_input: 1 } }), "unknown_field", "not_an_input");

    // And the developer, with a full key, gets through.
    const eventCount = async () => (await env.DB.prepare(`SELECT COUNT(*) AS event_count FROM security_events WHERE account_id = ? AND kind NOT IN (${KEY_USE_EVENT_KINDS.map((kind) => `'${kind}'`).join(", ")})`).bind(world.victimAccountId).first<{ event_count: number }>())!.event_count;
    const eventCountBefore = await eventCount();
    await setUpOwnersCall(routeName, world);
    // Erasing at once always asks for the passkey, and the asking is logged.
    if (routeName === "POST /games/:slug/erase-now" || routeName === "POST /games/:slug/kept-rooms/:room_code/erase-now") {
      expect((await call(apiRoute, developerKey, asDeveloper)).answer.error?.code).toBe("confirmation_needed");
      expect((await eventCount()) - eventCountBefore).toBe(1);
      return;
    }
    // A call that needs the owner's passkey on a page first refuses even the developer's full key, with nothing changed.
    if (CONFIRMED_ON_A_PAGE.has(routeName)) {
      await refused("the developer's full key, before a passkey on a page", await call(apiRoute, developerKey, asDeveloper), "confirmation_needed");
      expect(await eventCount()).toBe(eventCountBefore);
      return;
    }
    const made = await call(apiRoute, developerKey, asDeveloper);
    expect(made.httpStatus, `The developer's own ${routeName} with a full key: ${made.answerText.slice(0, 400)}`).toBeLessThan(300);
    // A call that changes something says so in the security log; no other call writes to it.
    expect((await eventCount()) - eventCountBefore, isLogged(apiRoute) ? `${routeName} changed something and wrote no security event: log it with logCallerEvent, or add it to UNLOGGED_CHANGES with why.` : `${routeName} wrote a security event it shouldn't`).toBe(isLogged(apiRoute) ? 1 : 0);
    // A call that reaches or names something of the developer's refused someone.
    if (ownsSomething(apiRoute) || Object.values(allInputs(apiRoute)).some((input) => input.kind === "names")) expect(refusals.length, routeName).toBeGreaterThan(0);
    // A shader check that went through drew in the stand-in.
    if (routeName === "POST /games/:slug/shader-checks") expect(drawings.count).toBe(1);
  });
});

/** The developer's values for the parts that own something (their game, webhook, sign-in app, private topic), over an example's own. */
function pickOwning(apiRoute: ApiRoute, values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(apiRoute.pathParts).filter(([, pathPart]) => OWNING_PARTS.includes(pathPart)).map(([name]) => [name, values[name]!]));
}
