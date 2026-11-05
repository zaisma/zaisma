// Types for chrome.mjs, so the tests find a Chrome the way `zaisma check` does.

export interface ChromeConnection {
  send(method: string, parameters?: Record<string, unknown>, sessionId?: string): Promise<any>;
  listen(sessionId: string, onEvent: (method: string, parameters: any) => void): () => void;
  close(): Promise<void>;
}

export function findChrome(downloadFolders?: string[]): string | null;
export function chromeFlags(options?: { isDrawingOnCpu?: boolean }): string[];
export function openChrome(path: string, profilePrefix: string, options?: { isDrawingOnCpu?: boolean; startLimitMs?: number }): Promise<ChromeConnection>;

export const CHROME_START_LIMIT_MS: number;
export class ChromeStartStalled extends Error {}
export function startWithinTries<Started>(startOnce: () => Promise<Started> | Started, say?: (line: string) => void): Promise<Started>;
