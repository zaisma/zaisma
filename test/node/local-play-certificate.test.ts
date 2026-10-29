import { X509Certificate } from "node:crypto";
import { createSecureContext } from "node:tls";
import { describe, expect, it } from "vitest";
import { integer, isCertificateGood, makeCertificate } from "../../packages/game-server/bin/local-play-certificate.js";

/** A DER INTEGER is the fewest bytes that hold the number, so OpenSSL refuses a leading zero byte that isn't needed to keep it positive. */
const FIXED_TIME_MS = Date.UTC(2026, 9, 29);

describe("the test bench's certificate", () => {
  it("writes each integer in the fewest bytes, with a zero byte in front only when the first bit is set", () => {
    const written = (bytes: number[]) => [...integer(Buffer.from(bytes))];
    expect(written([0x01])).toEqual([0x02, 1, 0x01]);
    expect(written([0x7f, 0xff])).toEqual([0x02, 2, 0x7f, 0xff]);
    expect(written([0x80])).toEqual([0x02, 2, 0x00, 0x80]);
    expect(written([0x00, 0x01])).toEqual([0x02, 1, 0x01]);
    expect(written([0x00, 0x00, 0x7f])).toEqual([0x02, 1, 0x7f]);
    expect(written([0x00, 0x80, 0x01])).toEqual([0x02, 3, 0x00, 0x80, 0x01]);
    expect(written([0x00, 0x00, 0xff, 0x00])).toEqual([0x02, 3, 0x00, 0xff, 0x00]);
    // Zero itself keeps one byte.
    expect(written([0x00, 0x00])).toEqual([0x02, 1, 0x00]);
    expect(written([0x00])).toEqual([0x02, 1, 0x00]);
  });

  it("loads a certificate whose serial starts with zero bytes", () => {
    const hard = [
      Buffer.alloc(16),
      Buffer.from([0, ...Array(15).fill(0xff)]),
      Buffer.from([0x80, 0, ...Array(14).fill(0x11)]),
      Buffer.from([0, 0, 0x80, ...Array(13).fill(0x22)]),
      Buffer.from([0x7f, ...Array(15).fill(0)]),
    ];
    for (const serialBytes of hard) {
      const kept = makeCertificate(["localhost", "192.168.1.20"], FIXED_TIME_MS, serialBytes);
      expect(() => createSecureContext({ cert: kept.certificatePem, key: kept.keyPem })).not.toThrow();
      expect(isCertificateGood(kept, ["localhost", "192.168.1.20"], FIXED_TIME_MS)).toBe(true);
    }
  });

  it("loads every certificate it makes, 300 in a row", () => {
    for (let count = 0; count < 300; count += 1) {
      const kept = makeCertificate(["localhost", "::1"], FIXED_TIME_MS);
      expect(new X509Certificate(kept.certificatePem).subject).toContain("Zaisma test bench");
      expect(() => createSecureContext({ cert: kept.certificatePem, key: kept.keyPem })).not.toThrow();
    }
  });
});
