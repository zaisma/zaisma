/**
 * Game server reach and secrets (docs/DECISIONS.md, "Game servers are full building blocks"): the
 * hosts a game's server may call, which its developer lists on the game (game_server_allowed_hosts),
 * and the secrets set per game that its server reads (server.secrets, room.secrets). The site checks
 * both as they're set; the rooms Worker's gateway (apps/rooms/src/outbound.ts) checks every call
 * against the list, and the game's secrets object (apps/rooms/src/secrets.ts) keeps the secrets.
 */

import type { InputProblem } from "./developers.ts";

/** Zaisma's own domains: a game server never calls them, so it can't loop back into Zaisma. */
export const ZAISMA_DOMAINS = ["zaisma.com", "zaismausercontent.com"] as const;

export const REACH_LIMITS = {
  /** Hosts on one game's list. */
  maximumAllowedHostCount: 20,
  /** A host name, as DNS allows. */
  maximumHostCharacterCount: 253,
} as const;

export const SECRET_LIMITS = {
  maximumSecretCount: 50,
  maximumNameCharacterCount: 64,
  maximumValueSizeBytes: 8 * 1024,
} as const;

/** A secret's name, like an environment variable's: capitals, digits and underscores, starting with a capital. */
export const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Why a host name (from a list, or one a call goes to) can't be reached, or null when it can. */
export function unreachableHostReason(host: string, blockedDomains: readonly string[] = ZAISMA_DOMAINS): string | null {
  if (host === "localhost" || host.endsWith(".localhost") || /^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) {
    return `${host} is an IP address or this computer; game servers call names on the internet, like api.example.com.`;
  }
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label)) || !/[a-z]/.test(labels.at(-1)!)) return `${host} isn't a name on the internet, like api.example.com.`;
  const blocked = blockedDomains.find((domain) => host === domain || host.endsWith(`.${domain}`));
  if (blocked) return `${host} is on ${blocked}, Zaisma's own domain, which game servers don't call.`;
  return null;
}

/**
 * A game's list of hosts its server may call, checked and tidied (lowercase, no repeats), or the
 * problem with it: up to 20 host names like "api.github.com", or "*.example.com" for every name under
 * example.com (not example.com itself). No https://, paths or ports: every call is https.
 */
export function checkAllowedHosts(given: unknown): { allowedHosts: string[] } | { problem: InputProblem } {
  const field = "game_server_allowed_hosts";
  const refuse = (message: string, fix: string) => ({ problem: { field: "game_server_allowed_hosts", message, fix } });
  const example = 'like ["discord.com", "api.github.com", "*.example.com"]';
  if (!Array.isArray(given) || !given.every((host) => typeof host === "string")) return refuse(`${field} isn't a list of host names.`, `Send a list of host names, ${example}, or [] for none.`);
  if (given.length > REACH_LIMITS.maximumAllowedHostCount) return refuse(`${field} has ${given.length} hosts.`, `List up to ${REACH_LIMITS.maximumAllowedHostCount}; "*.example.com" covers every name under example.com.`);
  const allowedHosts: string[] = [];
  for (const entry of given as string[]) {
    const host = entry.trim().toLowerCase();
    if (/^[a-z]+:\/\//.test(host) || /[/?#@]/.test(host)) return refuse(`${JSON.stringify(entry)} isn't a host name.`, `Give the name alone, without https:// or a path, ${example}.`);
    if (/:\d+$/.test(host)) return refuse(`${JSON.stringify(entry)} has a port.`, "Give the name alone; a call can use any port the name answers on.");
    const isWildcard = host.startsWith("*.");
    const name = isWildcard ? host.slice(2) : host;
    if (name.length > REACH_LIMITS.maximumHostCharacterCount || name.includes("*")) return refuse(`${JSON.stringify(entry)} isn't a host name.`, `Give a name, or "*." and a name for every name under it, ${example}.`);
    const reason = unreachableHostReason(name);
    if (reason) return refuse(reason, `Give names your game server calls, ${example}.`);
    if (isWildcard && name.split(".").length < 2) return refuse(`${JSON.stringify(entry)} covers a whole top-level domain.`, 'Give "*." and a name with a dot, like "*.example.com".');
    if (!allowedHosts.includes(host)) allowedHosts.push(host);
  }
  return { allowedHosts };
}

/** Whether a call's host is on a game's list: the same name, or a name under a "*." entry. */
export function isHostAllowed(host: string, allowedHosts: readonly string[]): boolean {
  return allowedHosts.some((allowed) => (allowed.startsWith("*.") ? host.endsWith(allowed.slice(1)) : host === allowed));
}

/** A game's list, from its column (JSON). */
export const allowedHostsOf = (game: { game_server_allowed_hosts: string }): string[] => JSON.parse(game.game_server_allowed_hosts || "[]") as string[];

/** The problem with a secret's name, or null when it's fine. */
export function secretNameProblem(name: unknown): InputProblem | null {
  if (typeof name === "string" && SECRET_NAME_PATTERN.test(name)) return null;
  return {
    field: "secret_name",
    message: `${JSON.stringify(name)} isn't a secret name.`,
    fix: `Name it like an environment variable: capitals, digits and underscores, starting with a capital, up to ${SECRET_LIMITS.maximumNameCharacterCount} characters, like DISCORD_WEBHOOK_URL.`,
  };
}

/** The problem with a secret's value, or null when it's fine. */
export function secretValueProblem(secretValue: unknown): InputProblem | null {
  if (typeof secretValue === "string" && secretValue.length > 0 && new TextEncoder().encode(secretValue).length <= SECRET_LIMITS.maximumValueSizeBytes) return null;
  return {
    field: "secret_value",
    message: typeof secretValue === "string" && secretValue.length > 0 ? `secret_value is over ${SECRET_LIMITS.maximumValueSizeBytes / 1024} KB.` : "secret_value isn't text.",
    fix: `Send the secret as text of up to ${SECRET_LIMITS.maximumValueSizeBytes / 1024} KB, like the token itself; to remove a secret, use delete_secret.`,
  };
}

/** A secret as the API shows it: its name and when it was set, never its value. */
export interface SecretListing {
  name: string;
  set_at_ms: number;
}
