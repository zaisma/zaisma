// The games Worker as the preview runs it: unchanged, except database calls are tried again when
// another preview server has the database locked (retry-when-locked.mjs).
import games from "../../../apps/games/src/index.ts";
import { workerRetryingWhenLocked } from "./retry-when-locked.mjs";

export * from "../../../apps/games/src/index.ts";
export default workerRetryingWhenLocked(games);
