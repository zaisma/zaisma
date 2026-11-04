import { cutUndeclared, noteAnswerCut, type DoorAnswer } from "@zaisma/core";
import type { Env } from "./env.ts";

/**
 * Answers checked on live requests (docs/DOORS.md): a JSON answer goes out with only what its door declares. A field it
 * didn't declare is cut and noted, and the caller still gets the answer; the hosting job tells Julius once a door a day.
 * Only JSON answers: pages, bytes and files have nothing to cut. About 1.5 millionths of a second per KB.
 */
export async function withDeclaredAnswer(env: Pick<Env, "DB">, response: Response, answer: DoorAnswer, doorId: string, waitUntil?: (promise: Promise<unknown>) => void): Promise<Response> {
  if (answer.kind !== "json" || !(response.headers.get("content-type") ?? "").includes("application/json")) return response;
  let given: unknown;
  try {
    given = await response.clone().json();
  } catch {
    return response;
  }
  const cut = cutUndeclared(answer.schema, given);
  if (!cut.cutPaths.length) return response;
  const noted = noteAnswerCut(env.DB, doorId, cut.cutPaths).catch((error: unknown) => console.error("An answer's cut wasn't noted", doorId, error));
  if (waitUntil) waitUntil(noted);
  else await noted;
  return new Response(JSON.stringify(cut.value), { status: response.status, statusText: response.statusText, headers: response.headers });
}
