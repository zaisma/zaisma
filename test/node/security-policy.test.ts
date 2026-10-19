import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DISCLOSURE_WAIT_DAYS, REPLY_WITHIN_DAYS, SECURITY_ADVISORY_URL, SECURITY_REPORT_EMAIL } from "../../apps/site/src/security-policy.ts";

// "Anyone can report a hole safely, and is promised no trouble for it." in docs/DECISIONS.md:
// SECURITY.md in the repo says the same as the page (test/site/security-policy.test.ts).

const ROOT = join(import.meta.dirname, "../..");

describe("SECURITY.md", () => {
  it("says the same as the page: address, private report link, policy page and the day counts", () => {
    const file = readFileSync(join(ROOT, "SECURITY.md"), "utf8");
    expect(file).toContain(`mailto:${SECURITY_REPORT_EMAIL}`);
    expect(file).toContain(SECURITY_ADVISORY_URL);
    expect(file).toContain("zaisma.com/legal/security");
    expect(file).toContain(`${DISCLOSURE_WAIT_DAYS} days`);
    expect(file).toContain(`within ${REPLY_WITHIN_DAYS} days`);
    expect(file).toContain(`within 30`);
  });
});
