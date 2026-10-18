// A software passkey, for the preview's seed: what a phone or laptop does when it makes and uses a passkey
// (the same bytes as the Device class in test/site/accounts.test.ts). P-256, DER signatures, flags 0x45 when
// made and 0x05 when used, and a counter that goes up.

const sha = async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
const text = (value) => new TextEncoder().encode(value);
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) (out.set(part, at), (at += part.length));
  return out;
};
const u32 = (number) => new Uint8Array([number >>> 24, (number >>> 16) & 255, (number >>> 8) & 255, number & 255]);
const b64url = (bytes) => Buffer.from(typeof bytes === "string" ? text(bytes) : bytes).toString("base64url");

// WebCrypto signs as r||s; WebAuthn sends DER.
function der(raw) {
  const int = (part) => {
    let at = 0;
    while (at < part.length - 1 && part[at] === 0) at++;
    const trimmed = part.slice(at);
    return trimmed[0] & 0x80 ? cat(new Uint8Array([2, trimmed.length + 1, 0]), trimmed) : cat(new Uint8Array([2, trimmed.length]), trimmed);
  };
  const body = cat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return cat(new Uint8Array([0x30, body.length]), body);
}

/** A passkey for this site: create(options) answers what /api/passkeys/add takes, tap(challenge) what a tap sends. */
export function newSoftwarePasskey(rpId, origin) {
  const id = crypto.getRandomValues(new Uint8Array(16));
  let keys;
  let signCount = 0;
  return {
    async create(options) {
      keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      const authenticatorData = cat(await sha(text(rpId)), new Uint8Array([0x45]), u32(0), new Uint8Array(16), new Uint8Array([0, id.length]), id);
      return {
        id: b64url(id),
        clientDataJSON: b64url(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin })),
        authenticatorData: b64url(authenticatorData),
        publicKey: b64url(new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey))),
        alg: -7,
      };
    },
    async tap(challenge) {
      signCount += 1;
      const authenticatorData = cat(await sha(text(rpId)), new Uint8Array([0x05]), u32(signCount));
      const clientData = text(JSON.stringify({ type: "webauthn.get", challenge, origin }));
      const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, cat(authenticatorData, await sha(clientData))));
      return { id: b64url(id), clientDataJSON: b64url(clientData), authenticatorData: b64url(authenticatorData), signature: b64url(der(signature)) };
    },
  };
}
