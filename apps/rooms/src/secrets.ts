import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { SECRET_LIMITS, secretNameProblem, secretValueProblem, type SecretListing } from "@zaisma/core";
import type { Env } from "./index.ts";

/**
 * A game's secrets (docs/DECISIONS.md, "Game servers are full building blocks"): tokens and keys its
 * developer sets per game, which its game server reads as server.secrets and room.secrets. One object
 * per game, named by its ID, keeps them in its own storage, never in D1, so no listing or export of
 * Zaisma's database holds them. Only the developer API sets them (GameSecretsService), and only this
 * Worker reads them, to hand to the game's sandbox when it opens a session (sandbox.ts).
 */

/** One secret as stored: its text and when it was set. */
interface StoredSecret {
  secret_value: string;
  set_at_ms: number;
}

/** What setting a secret answers. */
type SetOutcome = { secret: SecretListing } | { error: "bad_secret_name" | "bad_secret_value" | "too_many_secrets" };

/** A game's secrets for its game server, and when they last changed (null: never). */
export interface GameSecrets {
  secrets: Record<string, string>;
  changedAtMs: number | null;
}

export class GameSecretsObject extends DurableObject<Env> {
  private stored(): Record<string, StoredSecret> {
    return this.ctx.storage.kv.get<Record<string, StoredSecret>>("secrets") ?? {};
  }

  /** Names and when each was set, never the values, by name. */
  listSecrets(): SecretListing[] {
    return Object.entries(this.stored())
      .map(([name, secret]) => ({ name, set_at_ms: secret.set_at_ms }))
      .sort((first, second) => first.name.localeCompare(second.name));
  }

  readSecrets(): GameSecrets {
    const secrets: Record<string, string> = {};
    for (const [name, secret] of Object.entries(this.stored())) secrets[name] = secret.secret_value;
    return { secrets, changedAtMs: this.ctx.storage.kv.get<number>("changed_at_ms") ?? null };
  }

  /** Set one, replacing any of the same name. The site checks first; checked here again all the same. */
  setSecret(name: string, secretValue: string, atMs: number): SetOutcome {
    if (secretNameProblem(name)) return { error: "bad_secret_name" };
    if (secretValueProblem(secretValue)) return { error: "bad_secret_value" };
    const stored = this.stored();
    if (!(name in stored) && Object.keys(stored).length >= SECRET_LIMITS.maximumSecretCount) return { error: "too_many_secrets" };
    stored[name] = { secret_value: secretValue, set_at_ms: atMs };
    this.save(stored, atMs);
    return { secret: { name, set_at_ms: atMs } };
  }

  /** Remove one; false when there's none by that name. */
  deleteSecret(name: string, atMs: number): boolean {
    const stored = this.stored();
    if (!(name in stored)) return false;
    delete stored[name];
    this.save(stored, atMs);
    return true;
  }

  /** Every secret, for a game being deleted (GameStorageService). */
  async deleteStorage(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  private save(stored: Record<string, StoredSecret>, atMs: number): void {
    if (Object.keys(stored).length) this.ctx.storage.kv.put("secrets", stored);
    else this.ctx.storage.kv.delete("secrets");
    this.ctx.storage.kv.put("changed_at_ms", atMs);
  }
}

/** A game's secrets object, by its game ID. */
export function gameSecretsObject(env: Pick<Env, "GAME_SECRETS">, gameId: string): DurableObjectStub<GameSecretsObject> {
  return env.GAME_SECRETS.get(env.GAME_SECRETS.idFromName(gameId));
}

/** What a game's server gets as its secrets: none when they can't be read, which its errors then show. */
export async function secretsForGameServer(env: Pick<Env, "GAME_SECRETS">, gameId: string): Promise<GameSecrets> {
  return (await gameSecretsObject(env, gameId).readSecrets()) as GameSecrets;
}

/** What the developer API gets when the secrets object didn't answer. */
type Unavailable = { error: "secrets_unavailable" };

/**
 * Every game's secrets for the developer API on zaisma.com (apps/site/src/developer.ts), through a
 * service binding: only Zaisma's own Workers reach it. The site checks the caller owns the game, and
 * the name and value, before it names the game here. A change also tells the game's object outside
 * rooms (game-server.ts) to open its next session with them; running rooms read them again when they
 * next check the game, within a minute, from games.secrets_changed_at_ms, which the site sets.
 */
export class GameSecretsService extends WorkerEntrypoint<Env> {
  async list(gameId: string): Promise<{ secrets: SecretListing[] } | Unavailable> {
    return this.reach(async () => ({ secrets: await gameSecretsObject(this.env, gameId).listSecrets() }));
  }

  async set(gameId: string, name: string, secretValue: string, atMs: number): Promise<SetOutcome | Unavailable> {
    const outcome = await this.reach(async () => (await gameSecretsObject(this.env, gameId).setSecret(name, secretValue, atMs)) as SetOutcome);
    if ("secret" in outcome) await this.tellGameServer(gameId);
    return outcome;
  }

  async remove(gameId: string, name: string, atMs: number): Promise<{ isRemoved: boolean } | Unavailable> {
    const outcome = await this.reach(async () => ({ isRemoved: await gameSecretsObject(this.env, gameId).deleteSecret(name, atMs) }));
    if ("isRemoved" in outcome && outcome.isRemoved) await this.tellGameServer(gameId);
    return outcome;
  }

  private async reach<T>(work: () => Promise<T>): Promise<T | Unavailable> {
    try {
      return await work();
    } catch (error) {
      console.error("Game secrets unavailable:", error);
      return { error: "secrets_unavailable" };
    }
  }

  /** Requests and schedules use the new secrets from their next call. */
  private async tellGameServer(gameId: string): Promise<void> {
    // The site's tests reach this Worker without its game servers.
    if (!this.env.GAME_SERVER_OBJECTS) return;
    try {
      await this.env.GAME_SERVER_OBJECTS.get(this.env.GAME_SERVER_OBJECTS.idFromName(gameId)).secretsChanged();
    } catch (error) {
      console.error("Couldn't tell the game server its secrets changed:", error);
    }
  }
}
