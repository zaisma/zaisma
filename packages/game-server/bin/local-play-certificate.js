// The test bench's own HTTPS certificate (local-play.js uses it with --on-network): self-signed, made on this computer for its own
// names and addresses, so a phone that asks for HTTPS gets it. No one vouches for it, so the phone warns once before it opens the bench.
// Written with Node's crypto alone (an EC key, and the certificate's DER put together here), so the package needs no dependency for it.
import { X509Certificate, createPrivateKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { isIP } from "node:net";

/** How long a certificate lasts: under the 398 days browsers take, and made again before it ends. */
const CERTIFICATE_DURATION_DAYS = 397;
const DAY_MS = 24 * 3600 * 1000;

// DER, the encoding certificates are written in: a tag, the length, then the bytes.
function der(tag, content) {
  const contentSizeBytes = content.length;
  const lengthBytes = contentSizeBytes < 128 ? [contentSizeBytes] : contentSizeBytes < 256 ? [0x81, contentSizeBytes] : [0x82, contentSizeBytes >> 8, contentSizeBytes & 0xff];
  return Buffer.concat([Buffer.from([tag, ...lengthBytes]), content]);
}
const sequence = (...parts) => der(0x30, Buffer.concat(parts));
const set = (...parts) => der(0x31, Buffer.concat(parts));
const explicit = (tagNumber, content) => der(0xa0 + tagNumber, content);
const octets = (bytes) => der(0x04, bytes);
const bits = (bytes) => der(0x03, Buffer.concat([Buffer.from([0]), bytes]));
const utf8 = (text) => der(0x0c, Buffer.from(text, "utf8"));
function integer(bytes) {
  // A positive integer: a leading zero byte when the first bit is set.
  return der(0x02, bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
}
function objectId(dotted) {
  const [first, second, ...rest] = dotted.split(".").map(Number);
  const bytes = [first * 40 + second];
  for (const part of rest) {
    const groups = [];
    let remaining = part;
    do {
      groups.unshift(remaining & 0x7f);
      remaining = Math.floor(remaining / 128);
    } while (remaining > 0);
    bytes.push(...groups.map((groupNumber, groupIndex) => (groupIndex < groups.length - 1 ? groupNumber | 0x80 : groupNumber)));
  }
  return der(0x06, Buffer.from(bytes));
}
function utcTime(atMs) {
  const shown = new Date(atMs).toISOString();
  return der(0x17, Buffer.from(`${shown.slice(2, 4)}${shown.slice(5, 7)}${shown.slice(8, 10)}${shown.slice(11, 13)}${shown.slice(14, 16)}${shown.slice(17, 19)}Z`, "ascii"));
}
/** An address as subjectAltName writes it: 4 bytes for IPv4, 16 for IPv6. */
function addressBytes(address) {
  if (isIP(address) === 4) return Buffer.from(address.split(".").map(Number));
  const halves = address.split("::");
  const groupsOf = (text) => (text ? text.split(":") : []);
  const head = groupsOf(halves[0]);
  const tail = groupsOf(halves[1] ?? "");
  const groups = [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  return Buffer.from(groups.flatMap((group) => [parseInt(group, 16) >> 8, parseInt(group, 16) & 0xff]));
}

/**
 * A self-signed certificate for these names and addresses ("localhost", "192.168.1.20"), with its key, as PEM text:
 * { certificatePem, keyPem }. ECDSA P-256 and SHA-256, for server authentication, as phones ask of a server's certificate.
 */
export function makeCertificate(names, nowMs = Date.now()) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const name = sequence(set(sequence(objectId("2.5.4.3"), utf8("Zaisma test bench"))));
  const signatureAlgorithm = sequence(objectId("1.2.840.10045.4.3.2"));
  const alternativeNames = sequence(...names.map((each) => (isIP(each) ? der(0x87, addressBytes(each)) : der(0x82, Buffer.from(each, "ascii")))));
  const extensions = explicit(3, sequence(
    sequence(objectId("2.5.29.17"), octets(alternativeNames)),
    // Extended key usage: server authentication.
    sequence(objectId("2.5.29.37"), octets(sequence(objectId("1.3.6.1.5.5.7.3.1")))),
    // Basic constraints: not a certificate authority.
    sequence(objectId("2.5.29.19"), octets(sequence())),
  ));
  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  const toBeSigned = sequence(
    explicit(0, integer(Buffer.from([2]))),
    integer(serial),
    signatureAlgorithm,
    name,
    sequence(utcTime(nowMs - DAY_MS), utcTime(nowMs + CERTIFICATE_DURATION_DAYS * DAY_MS)),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    extensions,
  );
  const certificate = sequence(toBeSigned, signatureAlgorithm, bits(sign("sha256", toBeSigned, privateKey)));
  const lines = certificate.toString("base64").match(/.{1,64}/g) ?? [];
  return { certificatePem: `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`, keyPem: privateKey.export({ type: "pkcs8", format: "pem" }) };
}

/** Whether a kept certificate still serves: it reads, covers every one of these names, and has more than a week left. */
export function isCertificateGood(kept, names, nowMs = Date.now()) {
  try {
    const certificate = new X509Certificate(kept.certificatePem);
    createPrivateKey(kept.keyPem);
    const covers = (each) => (isIP(each) ? certificate.checkIP(each) : certificate.checkHost(each)) !== undefined;
    return Date.parse(certificate.validTo) - nowMs > 7 * DAY_MS && names.every(covers);
  } catch {
    return false;
  }
}
