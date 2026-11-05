// The compress Worker as the preview runs it: unchanged, except database calls are tried again when
// another preview server has the database locked (retry-when-locked.mjs), and while GitHub's runners make the full test data (PREVIEW_BROTLI_QUALITY, run.mjs),
// a lower quality: a copy reads the same to everything, and this Worker shares its one runtime with the rest of the preview, so the best holds the seed's calls up.
import { BROTLI_LIMITS } from "@zaisma/core";
import compress from "../../../apps/compress/src/index.ts";
import { workerRetryingWhenLocked } from "./retry-when-locked.mjs";

export * from "../../../apps/compress/src/index.ts";
const worker = workerRetryingWhenLocked(compress);
export default {
  ...worker,
  queue: (batch, environment, context) => {
    const qualityNumber = Number(environment.PREVIEW_BROTLI_QUALITY);
    if (qualityNumber) Object.assign(BROTLI_LIMITS, { bestQuality: qualityNumber, largeFileQuality: qualityNumber });
    return worker.queue(batch, environment, context);
  },
};
