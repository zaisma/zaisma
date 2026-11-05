import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ChromeStartStalled, openChrome, startWithinTries } from "../../packages/cli/chrome.mjs";
import { temporaryFolder } from "../temporary-folder.ts";

/** A Chrome that never answers (seen on GitHub's runners): it costs one more start, never a job's whole time limit. */
describe("a Chrome that doesn't start", () => {
  it("is started again, saying so, and what it answers then is the answer", async () => {
    let startCount = 0;
    const lines: string[] = [];
    const started = await startWithinTries(async () => {
      startCount++;
      if (startCount === 1) throw new ChromeStartStalled("Chrome didn't answer within 30 s.");
      return "chrome";
    }, (line: string) => lines.push(line));
    expect([started, startCount]).toEqual(["chrome", 2]);
    expect(lines.join()).toContain("Chrome didn't answer within 30 s. It's started again.");
  });

  it("fails by name when it stalls every time, and at once for anything else", async () => {
    let startCount = 0;
    const stalls = () => { startCount++; throw new ChromeStartStalled("Chrome didn't answer within 30 s."); };
    await expect(startWithinTries(stalls, () => {})).rejects.toThrow("Chrome didn't answer within 30 s.");
    expect(startCount).toBe(3);
    startCount = 0;
    const breaks = () => { startCount++; throw new Error("Chrome stopped (1)"); };
    await expect(startWithinTries(breaks, () => {})).rejects.toThrow("Chrome stopped (1)");
    expect(startCount).toBe(1);
  });

  it("is stopped at the limit: a program that never says it's ready is started three times, then openChrome fails", async () => {
    const folder = temporaryFolder("zaisma-chrome-start-");
    const startsFile = join(folder, "starts.txt");
    const program = join(folder, "chrome-that-hangs");
    writeFileSync(startsFile, "");
    writeFileSync(program, `#!/bin/sh\necho started >> "${startsFile}"\nexec sleep 60\n`);
    chmodSync(program, 0o755);
    await expect(openChrome(program, "zaisma-chrome-start-test-", { isDrawingOnCpu: true, startLimitMs: 1000 })).rejects.toThrow("Chrome didn't answer within 1 s");
    expect(readFileSync(startsFile, "utf8").trim().split("\n")).toHaveLength(3);
  }, 20_000);
});
