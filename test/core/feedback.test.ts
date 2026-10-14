import { describe, expect, it } from "vitest";
import { blankSecrets, matchKnownIssues } from "@zaisma/core";

describe("blanking secrets in feedback", () => {
  it("blanks keys, tokens and passwords", () => {
    const cases = [
      "my key is zsk_abcdefghijklmnop1234",
      "ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
      "stripe sk_live_51Habcdefghijklmnop",
      "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "aws AKIAIOSFODNN7EXAMPLE",
      "Authorization: Bearer abc.def-ghi_jklmnop",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijklmnop",
      'config { "password": "hunter2hunter2" }',
      "DATABASE_URL=postgres://admin:s3cretpass@db.example.com/zaisma",
      "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----",
      "random Xk9aPq2LmN8vR4tY7wZ1bC5dE3fG6hJ0",
    ];
    for (const c of cases) {
      const out = blankSecrets(c);
      expect(out.blanked, c).toBeGreaterThan(0);
      expect(out.text).toContain("[secret removed]");
    }
    expect(blankSecrets("DATABASE_URL=postgres://admin:s3cretpass@db.example.com/zaisma").text).not.toContain("s3cretpass");
    expect(blankSecrets("Authorization: Bearer abc.def-ghi_jklmnop").text).toBe("Authorization: Bearer [secret removed]");
  });

  it("keeps what feedback needs", () => {
    const fine = [
      "upload_files failed with too_big_for_mcp (413) on version k3j4h5g6f7d8s9a0",
      "sha256 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 is missing",
      "max_tokens: 4096 and token_count: 12, author: ai, secret: true",
      "See https://zaisma.com/g/tiny-jump/versions/abc and requestAnimationFrame loop",
    ];
    for (const c of fine) expect(blankSecrets(c), c).toEqual({ text: c, blanked: 0 });
  });
});

describe("matching known issues", () => {
  const known = [
    { id: "a", known_title: "Uploads over 500 MB fail", title: "big upload", workaround: "Split the build", area: "publishing" },
    { id: "b", known_title: "Rooms drop players on Safari", title: "safari", workaround: null, area: "rooms" },
  ];
  it("finds the issue that shares words, and nothing for unrelated text", () => {
    expect(matchKnownIssues("My 700 MB upload fails every time with uploads stuck", known).map((k) => k.id)).toEqual(["a"]);
    expect(matchKnownIssues("Players on safari keep getting dropped from rooms", known).map((k) => k.id)).toEqual(["b"]);
    expect(matchKnownIssues("How do I change my avatar?", known)).toEqual([]);
  });
});
