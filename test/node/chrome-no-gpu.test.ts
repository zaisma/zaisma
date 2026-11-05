// No Chrome that Zaisma's scripts or tests start ever touches the machine's GPU: openChrome is the only way one starts, and it has no way to ask for the GPU.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { chromeFlags, findChrome, openChrome } from "../../packages/cli/chrome.mjs";

const ROOT = join(import.meta.dirname, "../..");
const THIS_FILE = "test/node/chrome-no-gpu.test.ts";
const CHROME_MODULE = "packages/cli/chrome.mjs";
const GPU_FLAG = /--enable-gpu|--ignore-gpu-blocklist|--use-angle=(?!swiftshader)|--use-gl=(?!angle)/;
// What only a Chrome's start says, and what asks for a GPU.
const STARTS_CHROME = /--headless|--remote-debugging-port|--user-data-dir/;
const HOLDS_LAUNCHES = ["scripts", "packages", "test", "apps"];

function codeFiles(folder: string): string[] {
  return readdirSync(join(ROOT, folder)).flatMap((name) => {
    const path = join(folder, name);
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) return [];
    if (statSync(join(ROOT, path)).isDirectory()) return codeFiles(path);
    return /\.(mjs|cjs|js|ts)$/.test(name) ? [path] : [];
  });
}

describe("every local Chrome runs without the GPU", () => {
  it("has flags that never ask for the GPU, in either mode", () => {
    for (const options of [{}, { isDrawingOnCpu: true }, { isDrawingOnCpu: false }]) {
      const flags = chromeFlags(options);
      expect(flags.filter((flag) => GPU_FLAG.test(flag))).toEqual([]);
      expect(flags.some((flag) => flag === "--disable-gpu" || flag === "--use-angle=swiftshader")).toBe(true);
    }
  });

  it("refuses any other option, so no caller can ask for the GPU", async () => {
    await expect(openChrome("/no/such/chrome", "zaisma-no-gpu-test-", { isGpu: true } as never)).rejects.toThrow("no option isGpu");
  });

  it("starts only through openChrome, and nothing in the repository asks for a GPU", () => {
    const files = HOLDS_LAUNCHES.flatMap(codeFiles).filter((path) => relative(ROOT, join(ROOT, path)) !== THIS_FILE);
    const texts = files.map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") }));
    expect(texts.filter(({ path, text }) => path !== CHROME_MODULE && path !== "test/node/chrome.test.ts" && STARTS_CHROME.test(text)).map(({ path }) => path)).toEqual([]);
    expect(texts.filter(({ text }) => GPU_FLAG.test(text)).map(({ path }) => path)).toEqual([]);
  });

  const chromePath = findChrome([join(ROOT, ".wrangler/chrome"), join(ROOT, "chrome")]);
  it.skipIf(!chromePath || typeof WebSocket !== "function").each([
    ["WebGL in software", {}, /SwiftShader/],
    ["no WebGL at all", { isDrawingOnCpu: true }, /^Disabled$/],
  ])("really has %s when Chrome is asked what draws", async (_name, options, renderer) => {
    const chrome = await openChrome(chromePath!, `zaisma-no-gpu-test-${process.pid}-`, options);
    try {
      const { gpu } = await chrome.send("SystemInfo.getInfo");
      expect(gpu.auxAttributes.glRenderer).toMatch(renderer);
      expect(gpu.auxAttributes.glRenderer).not.toMatch(/Metal|Apple|NVIDIA|Intel|AMD/);
    } finally {
      await chrome.close();
    }
  }, 60_000);
});
