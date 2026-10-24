import type { Server } from "node:http";
import type { GameDatabase, GameServer, PublicKey } from "../src/index.ts";

/** What startServer takes. Only gameServer and gameSlug are required; the rest have the defaults named here. */
export interface StartServerOptions {
  /** Your game server: the default export of your server.ts (a defineGameServer object), or relay. */
  gameServer: GameServer;
  /** Your game's Zaisma slug: 1 to 40 lowercase letters, digits or hyphens. */
  gameSlug: string;
  /** The port to listen on. Default 8080; 0 picks a free one. */
  port?: number;
  /** The page origins that may connect. Default `https://<gameSlug>.zaismausercontent.com`; an empty list allows any page, for local testing. */
  origins?: string[];
  /** Who signs your players' passes. Default https://rooms.zaisma.com (PASS_ISSUER_URL). */
  issuerUrl?: string;
  /** The keys that check passes. Default: the ones `<issuerUrl>/.well-known/jwks.json` publishes, kept an hour. Called with true to fetch them again. */
  loadPassKeys?: (isRefreshing?: boolean) => Promise<PublicKey[]>;
  /** The keys that check receipts (room.verifyReceipt). Default: the ones `<issuerUrl>/.well-known/receipt-jwks.json` publishes. */
  loadReceiptKeys?: (isRefreshing?: boolean) => Promise<PublicKey[]>;
  /** An account's public profile, or null when no account has that ID. Default: looked up at `<issuerUrl>/v1/players/<id>`. */
  loadProfile?: (playerId: string) => Promise<{ name: string } | null>;
  /** The game's database (room.database). Default: a local SQLite file, zaisma-database.sqlite, made the first time the game uses it. */
  database?: GameDatabase;
  /** room.secrets and server.secrets. Default: this process's environment variables. */
  secrets?: Readonly<Record<string, string>>;
  /** The signing secret of the Zaisma webhook whose events come to /v1/webhooks. Default: the ZAISMA_WEBHOOK_SIGNING_SECRET environment variable. */
  webhookSigningSecret?: string;
  /** Where rooms save their states, so a restart brings matches back. Default zaisma-room-states.sqlite; null keeps none. */
  roomStateFile?: string | null;
}

export interface RunningServer {
  /** Saves every room, tells players to reconnect, and finishes once the server has stopped. */
  close(): Promise<void>;
  /** The HTTP server, for its address (httpServer.address()). */
  httpServer: Server;
}

/**
 * Run a game server on your own Node server (Node 22.18 or later). Throws a GameServerError
 * (unknown_option, bad_option) for options it doesn't take, before anything listens.
 */
export function startServer(options: StartServerOptions): RunningServer;
