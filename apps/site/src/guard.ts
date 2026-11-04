import { banScopeOf, checkDoor, type DoorCaller } from "@zaisma/core";
import { adminIdentity } from "./access.ts";
import { authConfigured, currentSession } from "./auth.ts";
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
