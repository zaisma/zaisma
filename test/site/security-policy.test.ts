import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { DISCLOSURE_WAIT_DAYS, FIX_WITHIN_DAYS, REPLY_WITHIN_DAYS, SECURITY_ADVISORY_URL, SECURITY_REPORT_EMAIL, SECURITY_TEXT_FILE_LIFETIME_DAYS, securityTextFile } from "../../apps/site/src/security-policy.ts";

// "Anyone can report a hole safely, and is promised no trouble for it." in docs/DECISIONS.md:
// the security page, /.well-known/security.txt and SECURITY.md all say the same thing.

const SITE = "https://zaisma.test";

describe("the security page", () => {
  it("opens for a stranger, names both ways to report and the promises, and is linked from every footer", async () => {
    const page = await SELF.fetch(`${SITE}/legal/security`);
    expect(page.status).toBe(200);
    const text = await page.text();
    expect(text).toContain(`mailto:${SECURITY_REPORT_EMAIL}`);
    expect(text).toContain(SECURITY_ADVISORY_URL);
    expect(text).toContain("/.well-known/security.txt");
    expect(text).toContain("safe harbor");
    expect(text).toContain(`${DISCLOSURE_WAIT_DAYS} days`);
    expect(text).toContain(`within ${REPLY_WITHIN_DAYS} days`);
    expect(text).toContain(`within ${FIX_WITHIN_DAYS}`);
    expect(text).toContain("no cash reward");
    expect(await (await SELF.fetch(`${SITE}/legal/privacy`)).text()).toContain('<a class="link quiet" href="/legal/security">Security</a>');
  });
});

describe("the security text file", () => {
  it("answers as plain text with both contacts, the policy and an Expires 30 days ahead", async () => {
    const answer = await SELF.fetch(`${SITE}/.well-known/security.txt`);
    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const text = await answer.text();
    expect(text).toContain(`Contact: mailto:${SECURITY_REPORT_EMAIL}\n`);
    expect(text).toContain(`Contact: ${SECURITY_ADVISORY_URL}\n`);
    expect(text).toContain(`Policy: ${SITE}/legal/security\n`);
    expect(text).toContain(`Canonical: ${SITE}/.well-known/security.txt\n`);
    const expires = Date.parse(text.match(/^Expires: (.+)$/m)![1]!);
    expect(expires - Date.now()).toBeGreaterThan((SECURITY_TEXT_FILE_LIFETIME_DAYS - 1) * 86_400_000);
    expect(expires - Date.now()).toBeLessThanOrEqual(SECURITY_TEXT_FILE_LIFETIME_DAYS * 86_400_000);
  });
  it("makes Expires fresh for each request", async () => {
    const expiresOf = async (now: Date) => (await securityTextFile(SITE, now).text()).match(/^Expires: (.+)$/m)![1];
    expect(await expiresOf(new Date("2026-10-19T00:00:00Z"))).toBe("2026-11-18T00:00:00.000Z");
  });
});
