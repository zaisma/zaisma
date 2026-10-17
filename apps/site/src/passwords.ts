/**
 * What a new password has to be (docs/DECISIONS.md, "Making an account takes a birthday, a username and a
 * password, nothing else"): long enough, not the username, and not one known from a breach. No rules about
 * capitals, digits or symbols. Supabase checks passwords at sign-in and keeps only a hash.
 */

export const MINIMUM_PASSWORD_CHARACTER_COUNT = 8;
/** Supabase hashes passwords with bcrypt, which reads only the first 72 bytes. */
const MAXIMUM_PASSWORD_BYTE_COUNT = 72;
export const PASSWORD_HINT = `At least ${MINIMUM_PASSWORD_CHARACTER_COUNT} characters. A few words you'll remember work well.`;

const PWNED_PASSWORDS_RANGE_URL = "https://api.pwnedpasswords.com/range/";

/** What's wrong with a new password, in words for the player, or null when it's fine. */
export async function newPasswordProblem(password: string, username: string | null): Promise<string | null> {
  if ([...password].length < MINIMUM_PASSWORD_CHARACTER_COUNT) return `Passwords are at least ${MINIMUM_PASSWORD_CHARACTER_COUNT} characters.`;
  if (new TextEncoder().encode(password).length > MAXIMUM_PASSWORD_BYTE_COUNT) return "That password is too long. Keep it under 72 characters.";
  if (username && password.trim().toLowerCase() === username.toLowerCase()) return "Pick a password that isn't your username.";
  if (await isBreachedPassword(password)) return "That password showed up in a data breach, so it's easy to guess. Pick another.";
  return null;
}

/**
 * Whether Have I Been Pwned knows the password from a breach. Only the first 5 characters of its SHA-1 hash
 * leave Zaisma (a range check, padded so the answer's size says nothing); never the password. When the
 * service can't be reached, the password is let through.
 */
async function isBreachedPassword(password: string): Promise<boolean> {
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password)))].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  try {
    const response = await fetch(`${PWNED_PASSWORDS_RANGE_URL}${hash.slice(0, 5)}`, { headers: { "Add-Padding": "true", "User-Agent": "Zaisma" }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) return false;
    const suffix = hash.slice(5);
    // Lines are "SUFFIX:COUNT"; padding lines have a count of 0.
    return (await response.text()).split("\n").some((line) => {
      const [lineSuffix, breachCount] = line.trim().split(":");
      return lineSuffix === suffix && Number(breachCount) > 0;
    });
  } catch {
    return false;
  }
}
