/** The frame's sandbox and permissions, exactly the game page's. */
export const FRAME_SANDBOX: string;
export const FRAME_ALLOW: string;
/** What the frame's messages the bench has no stand-in for do on Zaisma, by message type. */
export const ONLY_ON_ZAISMA: Record<string, string>;
/** The bench page's HTML, for a game on these ports. */
export function benchPage(config: { gameSlug: string; benchPort: number; gamePort: number; roomsPort: number; isOnNetwork: boolean }): string;
