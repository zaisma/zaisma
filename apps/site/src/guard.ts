import { banScopeOf, BodyPastCapError, bodyProblem, checkDoor, formProblem, isPastDoorLimit, NO_BODY_MAXIMUM_SIZE_BYTES, queryProblem, readBodyBytes, type DoorCaller } from "@zaisma/core";
import { adminIdentity } from "./access.ts";
import { authConfigured, connectionAddressOf, currentSession } from "./auth.ts";
import { safeNext } from "./account.ts";
import { siteDoorAt, type SiteDoor, type WhenSignedOut } from "./doors.ts";
import type { Env } from "./env.ts";
import { message } from "./html.ts";

const redirect = (to: string, cookies: readonly string[] = []) => {
  const response = new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
  for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
  return response;
};

const NOT_ALLOWED_FROM_HERE = { error: { code: "bad_origin", message: "Not allowed from here." } };

function wrongOrigin(door: SiteDoor): Response {
  if (door.answersAs === "json") return Response.json(NOT_ALLOWED_FROM_HERE, { status: 403, headers: { "Cache-Control": "no-store" } });
  return door.answersAs === "empty" ? new Response(null, { status: 403 }) : new Response("Bad origin", { status: 403 });
}

/** Whether the request's Origin is one the door takes: Zaisma's own, at the address it's on or its configured one (the same on zaisma.com; a preview can be opened at another). */
function isOriginTaken(request: Request, env: Env, door: SiteDoor): boolean {
  if (door.origin === "anywhere") return true;
  const origin = request.headers.get("origin");
  if (!origin) return door.origin === "own_pages_if_sent";
  return origin === new URL(request.url).origin || origin === new URL(env.SITE_ORIGIN).origin;
}

function answerAs(door: SiteDoor, httpStatus: number, code: string, words: string): Response {
  if (door.answersAs === "json") return Response.json({ error: { code, message: words } }, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
  return door.answersAs === "empty" ? new Response(null, { status: httpStatus, headers: { "Cache-Control": "no-store" } }) : new Response(words, { status: httpStatus, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
}

const wrongShape = (door: SiteDoor, field: string) => answerAs(door, 400, "wrong_shape", `${field} isn't the right shape.`);
const tooOften = (door: SiteDoor) => answerAs(door, 429, "slow_down", "Too many requests. Try again in a minute.");
/** A body over what its door takes, from the guard or from the door's own read of it. */
export const bodyTooBig = (door: SiteDoor) => answerAs(door, 413, "wrong_shape", "That's too big.");
/** What a door's row lets it be sent: every read behind the door stops here. */
export const doorBodyMaximumSizeBytes = (door: SiteDoor) => door.contract.takes.body?.maximumSizeBytes ?? NO_BODY_MAXIMUM_SIZE_BYTES;

/** A request that isn't its door's shape: its query's names, its body's size, then its fields. A body is read from a copy, on doors that take one. */
async function refusedByShape(request: Request, door: SiteDoor): Promise<Response | null> {
  const { query, body } = door.contract.takes;
  const wrong = queryProblem(query, new URL(request.url).searchParams, true);
  if (wrong) return wrongShape(door, wrong.field);
  const { method } = request;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  const maximumSizeBytes = doorBodyMaximumSizeBytes(door);
  if (Number(request.headers.get("content-length") ?? 0) > maximumSizeBytes) return bodyTooBig(door);
  if (!body || body.kind === "bytes") return null;
  const contentType = request.headers.get("content-type") ?? "";
  if (body.kind === "form" && !contentType.includes("form")) return null;
  let bodyBytes: Uint8Array;
  try {
    bodyBytes = await readBodyBytes(request.clone(), maximumSizeBytes);
  } catch (error) {
    if (error instanceof BodyPastCapError) return bodyTooBig(door);
    return answerAs(door, 400, "wrong_shape", "That body can't be read.");
  }
  if (body.kind === "form") {
    const form = await new Response(bodyBytes, { headers: { "Content-Type": contentType } }).formData().catch(() => null);
    if (!form) return answerAs(door, 400, "wrong_shape", "That form can't be read.");
    const problem = formProblem(body.fields, body.fileNames ?? [], form as unknown as Parameters<typeof formProblem>[2]);
    return problem ? wrongShape(door, problem.field) : null;
  }
  const bodyText = new TextDecoder().decode(bodyBytes);
  if (!bodyText.trim() && body.isOptional) return null;
  let given: unknown;
  try {
    given = JSON.parse(bodyText);
  } catch {
    return answerAs(door, 400, "wrong_shape", "That isn't JSON.");
  }
  if (!given || typeof given !== "object" || Array.isArray(given)) return answerAs(door, 400, "wrong_shape", "That isn't a JSON object.");
  const problem = bodyProblem(body.fields, body.required ?? [], given as Record<string, unknown>);
  if (!problem) return null;
  // A name it doesn't take is said as the API says it.
  return problem.field in body.fields || (body.required ?? []).includes(problem.field) ? wrongShape(door, problem.field) : answerAs(door, 400, "unknown_field", `${problem.field} isn't one of this door's fields.`);
}

async function signedOutAnswer(request: Request, path: string, whenSignedOut: WhenSignedOut): Promise<Response> {
  const url = new URL(request.url);
  const signInWith = (next: string | null) => redirect(`/signin${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  const status = (httpStatus: number, jsonBody: unknown) =>
    jsonBody === null ? new Response(null, { status: httpStatus, headers: { "Cache-Control": "no-store" } }) : Response.json(jsonBody, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
  switch (whenSignedOut.kind) {
    case "profile":
      return redirect(path.replace(/\/edit$/, ""));
    case "status":
      return status(whenSignedOut.httpStatus, whenSignedOut.jsonBody);
    case "form_or_status":
      return (request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded") ? signInWith(whenSignedOut.next) : status(whenSignedOut.httpStatus, whenSignedOut.jsonBody);
    case "sign_in": {
      const { next } = whenSignedOut;
      if (next === "here") return signInWith(path);
      if (next === "here_with_query") return signInWith(safeNext(path + url.search));
      if (next !== "next_field") return signInWith(next);
      // A form sends where to go back to in its fields; a page in its query. Read from a copy, on this refusal only.
      const form = request.method === "POST" ? await request.clone().formData().catch(() => null) : null;
      return signInWith(safeNext(form ? String(form.get("next") ?? "").trim().slice(0, 2000) : url.searchParams.get("next")));
    }
  }
}

/**
 * The guard in front of every door on zaisma.com (docs/DOORS.md): the row for this path and method, the origin it
 * takes, and who may call it, each before any of the door's own code. Answers a Response to refuse, or null for
 * the door to go on. A door that needs no session reads none, so a guest's page costs what it did. The session
 * it reads is the one the door's own code then gets (currentSession keeps it per request), so nothing is read
 * twice. When sessions can't be read at all (accounts off, or Supabase failing), the door's own code answers as it
 * always has: it asks for the same session and finds none.
 */
export async function guardSiteDoor(request: Request, env: Env, path: string): Promise<Response | null> {
  const door = siteDoorAt(path, request.method);
  if (door === "no_door") return message(env, "Page not found", "There's nothing at this address.", 404);
  if (door === "wrong_method") return new Response("Method not allowed", { status: 405 });
  if (!isOriginTaken(request, env, door)) return wrongOrigin(door);
  // An address's limit first, where no player is known yet: it reads nothing. Then who, then what they sent, all before any of the door's own code.
  const { limit } = door.contract;
  if ("counts" in limit && limit.counts === "address" && (await isPastDoorLimit(env, limit, door.path, connectionAddressOf(request) ?? "unknown"))) return tooOften(door);
  return (await whoIsRefused(request, env, path, door)) ?? refusedByShape(request, door);
}

/** Who may call the door: its answer for anyone else. */
async function whoIsRefused(request: Request, env: Env, path: string, door: SiteDoor): Promise<Response | null> {
  const { limit } = door.contract;
  const proven: DoorCaller[] = [];
  if (door.contract.whoMayCall === "admin") {
    if (await adminIdentity(request, env)) proven.push("admin");
    return checkDoor(door.contract, proven) ? null : new Response("Forbidden", { status: 403 });
  }
  if (!("whenSignedOut" in door)) return checkDoor(door.contract, proven) ? null : new Response("Forbidden", { status: 403 });

  if (!authConfigured(env)) return null;
  let session: Awaited<ReturnType<typeof currentSession>>;
  try {
    session = await currentSession(request, env);
  } catch {
    return null;
  }
  if (!session) return signedOutAnswer(request, path, door.whenSignedOut);
  // A door for a session counts the account, so it can't be aimed at anyone else.
  if (await isPastDoorLimit(env, limit, door.path, session.userId)) return tooOften(door);
  proven.push("signed_in");
  const isDeveloperBanned = session.accountRow !== null && banScopeOf(session.accountRow) !== null;
  if ("whenNoAccount" in door) {
    if (!session.accountRow) return redirect(door.whenNoAccount, session.cookies);
    if (isDeveloperBanned && !door.isOpenToBannedDeveloper) return redirect("/dashboard", session.cookies);
    proven.push("developer");
  } else if (isDeveloperBanned && door.isClosedToBannedDeveloper) {
    return redirect("/dashboard", session.cookies);
  }
  return checkDoor(door.contract, proven) ? null : new Response("Forbidden", { status: 403 });
}
