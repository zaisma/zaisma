import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error a plain script
import { probeUrl } from "../../scripts/page-probe.mjs";

describe("npm run page:probe", () => {
  it("opens a path on the preview's own site and an address as it is", () => {
    expect(probeUrl("/account", "http://localhost:8900")).toBe("http://localhost:8900/account");
    expect(probeUrl("http://localhost:8900/account", "http://localhost:8901")).toBe("http://localhost:8900/account");
  });

  it("signs in at the origin of the page it opens, never at the sign-in site", () => {
    const source = readFileSync("scripts/page-probe.mjs", "utf8");
    expect(source).toContain("signIn(chrome, browserContextId, new URL(url).origin, account)");
    expect(source).not.toContain("signInSite");
  });
});
