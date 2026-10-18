/**
 * A game's own servers (docs/DECISIONS.md, "Games can't load outside scripts, and connect only to Zaisma rooms
 * and their own servers"): the servers players' browsers connect to besides Zaisma rooms, like a game server
 * the developer runs with @zaisma/game-server or their own relay. The developer sets them (own_server_urls on
 * the game), live at once with no approval by Zaisma; the game's Content Security Policy lets it connect to
 * them, and the game's ⋯ menu names them.
 */

import type { InputProblem } from "./developers.ts";
import { ZAISMA_DOMAINS, unreachableHostReason } from "./reach.ts";

export const OWN_SERVER_LIMITS = {
  /** Servers on one game's list. */
  maximumServerCount: 5,
  /** One address. */
  maximumUrlCharacterCount: 200,
} as const;

/**
 * A game's list of its own servers, checked and tidied, or the problem with it: up to 5 addresses starting
 * with wss:// or https://, a name on the internet and a port if it needs one, nothing after. Each is kept as
 * its origin, like "wss://play.example.com"; a second address on the same host (wss:// and https:// reach
 * the same server) is dropped.
 */
export function checkOwnServerUrls(given: unknown): { ownServerUrls: string[] } | { problem: InputProblem } {
  const refuse = (message: string, fix: string) => ({ problem: { field: "own_server_urls", message, fix } });
  if (!Array.isArray(given) || !given.every((entry) => typeof entry === "string")) return refuse("own_server_urls isn't a list of server addresses.", 'Send a list like ["wss://play.example.com"], or [] for none.');
  if (given.length > OWN_SERVER_LIMITS.maximumServerCount) return refuse(`own_server_urls has ${given.length} servers.`, `List up to ${OWN_SERVER_LIMITS.maximumServerCount}: the servers players' browsers connect to.`);
  const ownServerUrls: string[] = [];
  const hosts: string[] = [];
  for (const entry of given as string[]) {
    const trimmed = entry.trim();
    const parsed = trimmed.length <= OWN_SERVER_LIMITS.maximumUrlCharacterCount && URL.canParse(trimmed) ? new URL(trimmed) : null;
    if (!parsed || (parsed.protocol !== "wss:" && parsed.protocol !== "https:") || parsed.username || parsed.password || (parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash) {
      return refuse(`${JSON.stringify(entry)} isn't a server address.`, "Give the address starting with wss:// or https:// and nothing after the name (and port), like wss://play.example.com.");
    }
    // The same check as game server reach, in words about the player's browser.
    if (unreachableHostReason(parsed.hostname)) {
      const isZaisma = ZAISMA_DOMAINS.some((domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
      const message = isZaisma ? `${parsed.hostname} is on Zaisma's own domain, not a server of your own.` : `${parsed.hostname} isn't a name on the internet: players' browsers reach your server by its name, never an IP address or this computer.`;
      return refuse(message, "Give your server's name on the internet, like wss://play.example.com.");
    }
    if (hosts.includes(parsed.host)) continue;
    hosts.push(parsed.host);
    ownServerUrls.push(`${parsed.protocol}//${parsed.host}`);
  }
  return { ownServerUrls };
}

/** A game's own servers, from its column (JSON). */
export const ownServerUrlsOf = (game: { own_server_urls: string }): string[] => JSON.parse(game.own_server_urls || "[]") as string[];

/** Whether an address (a room's serverUrl) is on one of the game's own servers: the same host, over wss:// or https://. */
export function isOwnServerUrl(serverUrl: string, ownServerUrls: readonly string[]): boolean {
  if (!URL.canParse(serverUrl)) return false;
  const server = new URL(serverUrl);
  if (server.protocol !== "wss:" && server.protocol !== "https:") return false;
  return ownServerUrls.some((listed) => new URL(listed).host === server.host);
}
