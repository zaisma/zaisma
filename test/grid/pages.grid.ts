import { createExecutionContext, env } from "cloudflare:test";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";
import { createApiKey, type KeyScope } from "@zaisma/core";
import { PATH_PARTS, SITE_DOORS, siteDoorIds, type SiteDoor } from "../../apps/site/src/doors.ts";
import { everything, keyFor, setUpOwnersCall, useRealServers, useStandInServers, type SiteWorker } from "../site/access-world.ts";
import { samplePathOf } from "../door-samples.ts";
import { CALLER_KINDS, cellOf, expectedAtSiteDoor, problemWithAnswer, tooLongFor, wrongValueOf, type CallAnswer, type CallerKind, type GridCell } from "./cells.ts";
import { makePageWorld } from "./page-world.ts";
import { CHANGES_NOTHING, COVERED_ELSEWHERE, MAY_TOUCH_OWNER, OWNER_NOT_PROVEN, OWNER_SETUP_ROUTES, PAGE_SAMPLES, type PageSample, type PageWorld } from "./samples.ts";
import { SITE, emptyWorlds, ownersThings, rememberEmptyTables, sessionCookie, showsPrivateValue, useSessions, whileBanned } from "./site-world.ts";

vi.mock("../../apps/site/src/shader-check.ts", async (original) => (await import("./shader-stand-in.ts")).shaderCheckStandIn(await original<object>()));
vi.resetModules();
const worker = (await import("../../apps/site/src/index.ts")).default as unknown as SiteWorker;

/**
 * Every door in SITE_DOORS by every kind of caller, through the whole site: the guard (test/site/door-guard.test.ts tries that
 * alone) and the door's own code. Each caller sends what the owner sends, and test/grid/cells.ts says what the door's contract expects.
 */

const ADMIN_SITE = "http://localhost";
let address = 0;
/** Each call its own address, since rate limits are live. */
const nextAddress = () => `198.51.${Math.floor(address / 250)}.${(address++ % 250) + 1}`;

const rows = SITE_DOORS.flatMap((door) => (door.methods === "any" ? (["POST"] as const) : door.methods).map((method) => ({ door, method })))
  .filter(({ door, method }) => !(`${method} ${door.path}` in COVERED_ELSEWHERE))
  .map(({ door, method }) => [door.methods === "any" ? siteDoorIds(door)[0]! : `page:${method} ${door.path}`, door, method] as const);

/** The parts of a path a developer's door holds to its owner. */
const OWNED_PARTS = new Set(["slug", "webhook_id", "sign_in_app_id", "spending_request_id", "top_up_id", "shader_id", "id"]);
const isOwnedInPath = (door: SiteDoor) => [...door.path.matchAll(/:([a-z_]+)/g)].some((match) => OWNED_PARTS.has(match[1]!));

function pathWith(door: SiteDoor, world: PageWorld, values: Record<string, string> = {}): string {
  const given = { ...world.pagePathValues, ...values };
  return door.path
    .split("/")
    .map((part) => (part.startsWith(":") ? (given[part.slice(1)] ?? samplePathOf(part, PATH_PARTS)) : part === "*" ? "x" : part))
    .join("/");
}

/** The same path with what it names swapped for what isn't there, and the swap: what another account's answer is compared with. */
function pathOfNothing(path: string, world: PageWorld): { path: string; swapBack: (location: string | null) => string | null } {
  const swaps: [string, string][] = [[world.values.slug!, `gone-${world.n}`], ...["webhook_id", "sign_in_app_id", "spending_request_id", "top_up_id", "shader_id", "image_id", "version_id", "tester_id"].map((name): [string, string] => [world.values[name]!, `${world.values[name]!.split("_").slice(0, -1).join("_")}_gone`])];
  const swapped = swaps.reduce((given, [real, gone]) => given.replaceAll(real, gone), path);
  return { path: swapped, swapBack: (location) => location && swaps.reduce((given, [real, gone]) => given.replaceAll(gone, real), location) };
}

interface Credential {
  site: string;
  headers: Record<string, string>;
}

async function credentialOf(door: SiteDoor, callerKind: CallerKind, world: PageWorld, scopeKey: (scope?: KeyScope) => Promise<string>): Promise<Credential> {
  const isAdminDoor = door.contract.whoMayCall === "admin";
  const site = isAdminDoor && callerKind === "owner" ? ADMIN_SITE : SITE;
  const origin: Record<string, string> = { origin: site };
  switch (callerKind) {
    case "owner":
    case "banned_developer":
    case "banned_account":
      return { site, headers: { ...origin, cookie: await sessionCookie(world.victimAccountId) } };
    case "another_account":
      return { site, headers: { ...origin, cookie: await sessionCookie(world.strangerAccountId) } };
    case "stranger":
      return { site, headers: origin };
    case "weaker_key":
      return { site, headers: { ...origin, authorization: `Bearer ${await scopeKey({ accessLevel: "read", gameSlugs: null })}` } };
    case "another_games_key":
      return { site, headers: { ...origin, authorization: `Bearer ${await scopeKey({ accessLevel: "full", gameSlugs: [world.otherSlug] })}` } };
  }
}

/** A request's body and its type, as the sample says: JSON, a file upload, or a plain form. */
function bodyOf(sample: PageSample): { body: BodyInit; headers: Record<string, string> } {
  if (sample.jsonBody !== undefined) return { body: JSON.stringify(sample.jsonBody), headers: { "content-type": "application/json" } };
  if (sample.multipart) {
    const parts = new FormData();
    for (const [name, given] of Object.entries(sample.multipart)) parts.set(name, given);
    return { body: parts, headers: {} };
  }
  const form = new URLSearchParams();
  for (const [name, given] of Object.entries(sample.form ?? {})) for (const each of [given].flat()) form.append(name, each);
  return { body: form.toString(), headers: { "content-type": "application/x-www-form-urlencoded" } };
}

async function callDoor(method: string, path: string, sample: PageSample, credential: Credential, workerEnv = env) {
  const query = sample.query ? `?${new URLSearchParams(sample.query)}` : "";
  const isGet = method === "GET" || method === "HEAD" || method === "OPTIONS";
  const sent = isGet ? { headers: {} } : bodyOf(sample);
  const headers: Record<string, string> = { ...credential.headers, "cf-connecting-ip": nextAddress(), ...sent.headers };
  let response: Response;
  try {
    response = await worker.fetch(new Request(`${credential.site}${path}${query}`, { method, headers, redirect: "manual", ...("body" in sent ? { body: sent.body } : {}) }), workerEnv, createExecutionContext());
  } catch {
    // What Cloudflare answers when a Worker throws.
    return { http_status: 500, location: null, answerText: "" };
  }
  const answerText = new TextDecoder().decode(await response.arrayBuffer());
  return { http_status: response.status, location: response.headers.get("location"), answerText };
}

beforeAll(async () => {
  useStandInServers();
  await useSessions();
  await rememberEmptyTables();
});

afterEach(emptyWorlds);

afterAll(useRealServers);

describe("every door on the site", () => {
  it.for(rows)("%s", { timeout: 120_000 }, async ([doorId, door, method], { task }) => {
    const cells: GridCell[] = (task.meta.grid_cells = []);
    const rowName = `${method} ${door.path}`;
    // Starting a monthly plan needs none running yet.
    const worldRoute = rowName === "POST /dashboard/settings/credit/plan/start" ? "POST /credit/plan/checkout" : "";
    const sampleOf = PAGE_SAMPLES[rowName] ?? ((): PageSample => ({}));
    const world = await makePageWorld(worldRoute);
    const sample = sampleOf(world);
    const scopeKey = async (scope?: KeyScope) => (scope ? (await createApiKey(env.DB, world.victimAccountId, `grid ${Math.random()}`, scope)).token : keyFor(world.victimAccountId));
    const sentBy = (path: string) => `${path} ${JSON.stringify(sample)}`;

    // Everyone but the owner first, then the owner on a world of their own: another account's call may rightly take what the owner's needs.
    for (const callerKind of CALLER_KINDS.filter((kind) => kind !== "owner")) {
      const isWeaker = callerKind === "weaker_key" || callerKind === "another_games_key" || callerKind === "banned_account";
      const callerKnows = isWeaker ? [world.victimAccountId, world.victimOwnerId] : [];
      const contractExpects = expectedAtSiteDoor(door, callerKind, isOwnedInPath(door));
      // A preflight proves nothing and gives nothing, whoever asks. A banned developer who keeps a door is still its owner, on what the owner names.
      const expected = method === "OPTIONS" ? "own_things_only" : contractExpects === "goes_through" && rowName in OWNER_NOT_PROVEN ? "own_things_only" : contractExpects;
      const path = pathWith(door, world, { ...sample.pathValues, ...(contractExpects === "goes_through" ? sample.ownerPathValues : sample.pathValuesWithoutProof) });
      const credential = await credentialOf(door, callerKind, world, scopeKey);
      const run = async (): Promise<CallAnswer> => {
        const before = await ownersThings(world);
        const made = await callDoor(method, path, sample, credential);
        const isChanged = (await ownersThings(world)) !== before;
        return { http_status: made.http_status, location: made.location, is_owners_changed: isChanged && !(rowName in MAY_TOUCH_OWNER) && contractExpects !== "goes_through", is_private_value_shown: callerKind !== "banned_developer" && showsPrivateValue(world, made.answerText, sentBy(path), callerKnows) };
      };
      const answer = callerKind === "banned_account" ? await whileBanned(world.victimAccountId, "whole_account", run) : callerKind === "banned_developer" ? await whileBanned(world.victimAccountId, "developer", run) : await run();
      let nothingThere: { http_status: number; location: string | null } | null = null;
      if (expected === "like_nothing_there") {
        const nothing = pathOfNothing(path, world);
        const made = await callDoor(method, nothing.path, sample, credential);
        nothingThere = { http_status: made.http_status, location: nothing.swapBack(made.location) };
      }
      cells.push(cellOf(doorId, callerKind, problemWithAnswer(expected, door.contract.whoMayCall === "signed_in" || door.contract.whoMayCall === "developer" ? (door as { whenSignedOut: { kind: string; httpStatus?: number } }) : null, answer, nothingThere)));
    }

    if (rowName in OWNER_NOT_PROVEN) return;
    const ownersWorld = await makePageWorld(worldRoute);
    const ownersSample = sampleOf(ownersWorld);
    if (OWNER_SETUP_ROUTES[rowName]) await setUpOwnersCall(OWNER_SETUP_ROUTES[rowName]!, ownersWorld);
    const before = await everything(ownersWorld);
    const made = await callDoor(method, pathWith(door, ownersWorld, { ...ownersSample.pathValues, ...ownersSample.ownerPathValues }), ownersSample, await credentialOf(door, "owner", ownersWorld, scopeKey));
    let problem: string | null;
    if (door.contract.whoMayCall === "admin") {
      // Past the guard is all an admin's cell shows: the door's own code may say there's no such thing.
      problem = made.http_status === 401 || made.http_status === 403 ? `Answered ${made.http_status} to Zaisma's own people.` : null;
    } else {
      problem = problemWithAnswer("goes_through", null, { http_status: made.http_status, location: made.location, is_owners_changed: false, is_private_value_shown: false });
      const isWrite = !["GET", "HEAD", "OPTIONS"].includes(method);
      if (!problem && isWrite && door.contract.whoMayCall !== "anyone" && !(rowName in CHANGES_NOTHING) && (await everything(ownersWorld)) === before) problem = `Changed nothing (${made.http_status} to ${made.location}), so the sample proves nothing.`;
    }
    cells.push(cellOf(doorId, "owner", problem));

    // What the door's contract says it takes and how much it can be used: a wrong shape and a door past its limit are refused before any of its own code runs.
    const { takes, limit } = door.contract;
    const ownerCredential = await credentialOf(door, "owner", ownersWorld, scopeKey);
    const ownersPath = pathWith(door, ownersWorld, { ...ownersSample.pathValues, ...ownersSample.ownerPathValues });
    const wrongSamples: PageSample[] = [];
    for (const [name, shape] of Object.entries(takes.query)) {
      const tooLong = tooLongFor(shape);
      if (tooLong) wrongSamples.push({ ...ownersSample, query: { ...ownersSample.query, [name]: tooLong } });
      break;
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && takes.body?.kind === "form" && !ownersSample.jsonBody && !ownersSample.multipart) wrongSamples.push({ ...ownersSample, form: { ...ownersSample.form, zzz_no_such_field: "x" } });
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && takes.body?.kind === "json") {
      wrongSamples.push({ ...ownersSample, form: undefined, multipart: undefined, jsonBody: { ...(ownersSample.jsonBody as object | undefined), zzz_no_such_field: "x" } });
      for (const [name, shape] of Object.entries(takes.body.fields)) {
        const wrong = wrongValueOf(shape);
        if (wrong === undefined) continue;
        wrongSamples.push({ ...ownersSample, form: undefined, multipart: undefined, jsonBody: { ...(ownersSample.jsonBody as object | undefined), [name]: wrong } });
        break;
      }
    }
    if (wrongSamples.length && door.contract.whoMayCall !== "admin") {
      const ownersBefore = await everything(ownersWorld);
      const answers = [];
      for (const wrongSample of wrongSamples) answers.push(await callDoor(method, ownersPath, wrongSample, ownerCredential));
      const isChanged = (await everything(ownersWorld)) !== ownersBefore;
      const passed = answers.find((answer) => answer.http_status < 400 || answer.http_status >= 500);
      cells.push(cellOf(doorId, "wrong_shape", isChanged ? "A request of the wrong shape changed something." : passed ? `Answered ${passed.http_status} to a request of the wrong shape.` : null));
    }
    if ("level" in limit) {
      const refusing = { ...env, [`LIMIT_${limit.level.toUpperCase()}`]: { limit: async () => ({ success: false }) } };
      const past = await callDoor(method, ownersPath, ownersSample, ownerCredential, refusing as typeof env);
      cells.push(cellOf(doorId, "past_limit", past.http_status === 429 ? null : `Answered ${past.http_status} past its limit.`));
    }
  });
});
