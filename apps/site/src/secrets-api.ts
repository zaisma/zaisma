import { ApiError, allowedHostsOf, audit, iso, secretNameProblem, secretValueProblem, SECRET_LIMITS, type Game, type SecretListing } from "@zaisma/core";
import { closedBody, readJson, type Caller, type NextStep } from "./developer.ts";
import type { Env } from "./env.ts";

/**
 * A game's secrets through the developer API (docs/DECISIONS.md, "Game servers are full building
 * blocks"): tokens and keys its game server reads as server.secrets and room.secrets. They're kept in
 * the rooms Worker (apps/rooms/src/secrets.ts), reached through the GAME_SECRETS service binding, and
 * never answered again once set: only their names and when each was set.
 *
 *   GET    /api/dev/games/:slug/secrets               the game's secrets' names and when each was set
 *   PUT    /api/dev/games/:slug/secrets/:secret_name  set one: { "secret_value" }, replacing any of that name
 *   DELETE /api/dev/games/:slug/secrets/:secret_name  delete one
 *
 * games.secrets_changed_at_ms gets the same time as the secrets object, so running rooms read them again
 * when they next check the game, within a minute.
 */

/** A secret of up to 8 KB, in JSON, with room for escapes. */
const MAXIMUM_SECRET_BODY_SIZE_BYTES = 64 * 1024;

const secretJson = (secret: SecretListing) => ({ name: secret.name, set_at: iso(secret.set_at_ms) });

export async function secretsRoute(request: Request, env: Env, game: Game, secretName: string | undefined, caller: Caller): Promise<[unknown, number?]> {
  const service = env.GAME_SECRETS;
  if (!service) throw new ApiError("secrets_unavailable", { message: "This Zaisma has no game secrets connected.", fix: "On zaisma.com this doesn't happen; on your own Zaisma, bind the rooms Worker's GameSecretsService as GAME_SECRETS (apps/site/wrangler.jsonc)." });
  const unavailable = () => new ApiError("secrets_unavailable", { message: "The game's secrets didn't answer.", fix: "Try again in a moment; if it keeps happening, tell Zaisma with post_topic (kind bug, category servers).", retryAfterSec: 10 });
  const method = request.method;

  if (!secretName) {
    if (method !== "GET") throw new ApiError("bad_method", { message: `${method} isn't a call at /games/${game.slug}/secrets.`, fix: "GET lists the secrets; set one with PUT /games/:slug/secrets/:secret_name." });
    const listed = await service.list(game.id);
    if ("error" in listed) throw unavailable();
    return [{ secrets: listed.secrets.map(secretJson) }];
  }

  const nameProblem = secretNameProblem(secretName);
  if (nameProblem) throw new ApiError("bad_secret_name", { message: nameProblem.message, field: nameProblem.field, fix: nameProblem.fix });
  const atMs = Date.now();

  if (method === "PUT") {
    const body = await readJson(request, MAXIMUM_SECRET_BODY_SIZE_BYTES);
    closedBody(body, ["secret_value"]);
    const valueProblem = secretValueProblem(body.secret_value);
    if (valueProblem) throw new ApiError("bad_secret_value", { message: valueProblem.message, field: valueProblem.field, fix: valueProblem.fix });
    const outcome = await service.set(game.id, secretName, body.secret_value as string, atMs);
    if ("error" in outcome) {
      if (outcome.error === "too_many_secrets") {
        throw new ApiError("too_many_secrets", { message: `${game.slug} has ${SECRET_LIMITS.maximumSecretCount} secrets, the most a game can have.`, field: "secret_name", fix: "Delete one it no longer uses with delete_secret (list_secrets names them), or keep several values in one secret as JSON." });
      }
      if (outcome.error === "secrets_unavailable") throw unavailable();
      throw new ApiError(outcome.error, { message: `The secret couldn't be set (${outcome.error}).`, field: outcome.error === "bad_secret_name" ? "secret_name" : "secret_value", fix: "Check it against list_secrets' rules and send it again." });
    }
    await secretsChanged(env, game, atMs);
    await audit(env.DB, game.id, "secret-set", secretName, caller.actor);
    const nextSteps: NextStep[] = allowedHostsOf(game).length
      ? []
      : [{ tool: "update_game", arguments: { slug: game.slug, game_server_allowed_hosts: ["api.example.com"] }, after_sec: null, reason: "The game server can call no other servers yet: list the hosts it uses this secret with, in place of api.example.com." }];
    return [{ secret: secretJson(outcome.secret), next_steps: nextSteps }];
  }

  if (method === "DELETE") {
    const outcome = await service.remove(game.id, secretName, atMs);
    if ("error" in outcome) throw unavailable();
    if (!outcome.isRemoved) throw new ApiError("no_secret", { message: `${game.slug} has no secret named ${secretName}.`, field: "secret_name", fix: "list_secrets names the game's secrets." });
    await secretsChanged(env, game, atMs);
    await audit(env.DB, game.id, "secret-deleted", secretName, caller.actor);
    return [{ deleted_secret_name: secretName, next_steps: [] satisfies NextStep[] }];
  }

  throw new ApiError("bad_method", { message: `${method} isn't a call at /games/${game.slug}/secrets/${secretName}.`, fix: "PUT sets the secret with { \"secret_value\" }; DELETE deletes it." });
}

/** Running rooms compare this with what they were given when they next check the game (apps/rooms/src/room.ts). */
async function secretsChanged(env: Env, game: Game, atMs: number): Promise<void> {
  await env.DB.prepare("UPDATE games SET secrets_changed_at_ms = ? WHERE id = ?").bind(atMs, game.id).run();
}
