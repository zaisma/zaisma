import { describe } from "vitest";
import { lockSurface } from "./surface.ts";

/** Own servers' chat check, v1: its options, answer, reasons and limits (the filter's behavior is test/game-server/chat.test.ts and test/rooms/rooms.test.ts). */
describe("chat checks v1", () => {
  lockSurface("chat", "packages/game-server/src/chat.ts", ["ChatCheck", "ChatCheckOptions", "ChatCheckReason", "CHAT_CHECK_LIMITS", "ChatCheckError", "checkChat"]);
});
