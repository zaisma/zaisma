// "Anyone can report a hole safely, and is promised no trouble for it." in docs/DECISIONS.md:
// the one place the security page (/legal/security), /.well-known/security.txt and the tests
// get the address, the private report link and the promises from. SECURITY.md in the repo says
// the same; test/site/security-policy.test.ts fails when they disagree.

export const SECURITY_REPORT_EMAIL = "security@zaisma.com";
export const SECURITY_ADVISORY_URL = "https://github.com/zaisma/zaisma/security/advisories/new";
export const SECURITY_POLICY_PATH = "/legal/security";
export const SECURITY_TEXT_FILE_PATH = "/.well-known/security.txt";
/** How far ahead security.txt's Expires is, made fresh on every request so the file never expires unnoticed. */
export const SECURITY_TEXT_FILE_LIFETIME_DAYS = 30;
export const REPLY_WITHIN_DAYS = 5;
export const FIX_WITHIN_DAYS = 30;
export const DISCLOSURE_WAIT_DAYS = 90;

export function securityTextFile(siteOrigin: string, now: Date = new Date()): Response {
  const expires = new Date(now.getTime() + SECURITY_TEXT_FILE_LIFETIME_DAYS * 86_400_000);
  const text = [
    `Contact: mailto:${SECURITY_REPORT_EMAIL}`,
    `Contact: ${SECURITY_ADVISORY_URL}`,
    `Expires: ${expires.toISOString()}`,
    "Preferred-Languages: en",
    `Canonical: ${siteOrigin}${SECURITY_TEXT_FILE_PATH}`,
    `Policy: ${siteOrigin}${SECURITY_POLICY_PATH}`,
    "",
  ].join("\n");
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
