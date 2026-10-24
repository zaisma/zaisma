// A player's purchase PIN (the Zaisma buy sheet): an optional way to confirm saved-card buys on a device, beside a
// passkey or the password. It only confirms purchases, so it's hashed like a password and locks after 5 wrong tries
// until a password confirm resets the count (docs/DECISIONS.md, "One Zaisma buy sheet").

/** What a purchase PIN takes, and how long one confirm lasts on a device. */
export const PURCHASE_PIN_LIMITS = { minimumPinLength: 6, maximumPinLength: 64, maximumFailedTryCount: 5, confirmationDurationMin: 15 } as const;

const PBKDF2_ITERATION_COUNT = 210_000;
const SALT_BYTE_COUNT = 16;
const HASH_BIT_COUNT = 256;

/** Why a PIN can't be set, or null when it can: 6 or more digits, or any passphrase of 6 or more characters, up to 64. */
export function purchasePinProblem(pin: unknown): string | null {
  if (typeof pin !== "string") return "purchase_pin must be text: 6 or more digits, or a passphrase of 6 or more characters.";
  const pinCharacterCount = [...pin].length;
  if (pinCharacterCount < PURCHASE_PIN_LIMITS.minimumPinLength) return `purchase_pin must be at least ${PURCHASE_PIN_LIMITS.minimumPinLength} characters, like 482913 or a short passphrase.`;
  if (pinCharacterCount > PURCHASE_PIN_LIMITS.maximumPinLength) return `purchase_pin can be at most ${PURCHASE_PIN_LIMITS.maximumPinLength} characters.`;
  if (pin.trim() !== pin) return "purchase_pin can't start or end with a space.";
  return null;
}

/** The stored form of a PIN: `pbkdf2-sha256$<iterations>$<salt>$<hash>`, salt and hash in base64url. */
export async function hashPurchasePin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_COUNT));
  const hash = await derive(pin, salt, PBKDF2_ITERATION_COUNT);
  return `pbkdf2-sha256$${PBKDF2_ITERATION_COUNT}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

/** Whether `pin` is the PIN behind `storedHash`, compared in constant time. A malformed stored hash never matches. */
export async function isPurchasePin(pin: string, storedHash: string): Promise<boolean> {
  const [scheme, iterationText, saltText, hashText] = storedHash.split("$");
  const iterationCount = Number(iterationText);
  if (scheme !== "pbkdf2-sha256" || !Number.isInteger(iterationCount) || iterationCount < 1 || !saltText || !hashText) return false;
  const expected = fromBase64Url(hashText);
  const actual = await derive(pin, fromBase64Url(saltText), iterationCount);
  if (actual.length !== expected.length) return false;
  let mismatchNumber = 0;
  for (let i = 0; i < actual.length; i++) mismatchNumber |= actual[i]! ^ expected[i]!;
  return mismatchNumber === 0;
}

async function derive(pin: string, salt: Uint8Array, iterationCount: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iterationCount }, key, HASH_BIT_COUNT));
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
