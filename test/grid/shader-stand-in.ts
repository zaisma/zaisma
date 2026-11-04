import { SHADER_LIMITS } from "@zaisma/core";

/**
 * A shader check draws in a stand-in that answers a clean drawing at once: the grid checks who gets through, and the real
 * drawing (headless Chromium) is test/site/shader-check.test.ts's. Each grid file on the site mocks shader-check.ts with this.
 */
export function shaderCheckStandIn<Module extends object>(original: Module): Module {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const frames = (given: number) => Array.from({ length: SHADER_LIMITS.checkFrameCount }, () => given);
  const render = async () => ({
    compileError: null,
    referenceFrameTimesMs: Array.from({ length: 30 }, () => SHADER_LIMITS.referenceFrameMs),
    levels: [{ qualityLevel: 0, frameTimesMs: frames(20), frameLuminances: frames(0.4) }],
    stillPng: PNG,
    smallStillPng: PNG,
    framePngs: Array.from({ length: SHADER_LIMITS.sampledFrameCount }, () => PNG),
    shimmerPngs: [],
    sheetPng: null,
  });
  return { ...original, shaderCheckDeps: () => ({ render }) };
}
