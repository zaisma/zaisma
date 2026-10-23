import { AGE_BAND_FLOOR_YEARS, accountWithBirthday, type Account } from "@zaisma/core";
import { currentSession, readCookie, realEmail } from "./auth.ts";
import type { Env } from "./env.ts";

/** Who is looking at a page: their account when signed in, and the cookies a refreshed session sets. */
export interface Viewer {
  ageFloorYears: number;
  account: Account | null;
  email: string | null;
  cookies: string[];
}

/**
 * The age the viewer can find games for (docs/DECISIONS.md, "Games can keep out younger age bands"): their
 * band's youngest age, or 18 signed out, who see every listed game (one for older players asks them for an
 * account). The session is read only when the zaisma_in cookie says they're signed in, so signed-out pages
 * cost nothing extra, and its check already read the account's row, so it isn't read again.
 */
export async function viewerOf(request: Request, env: Env): Promise<Viewer> {
  if (!readCookie(request, env, "zaisma_in")) return { ageFloorYears: 18, account: null, email: null, cookies: [] };
  const session = await currentSession(request, env).catch(() => null);
  const account = session?.accountRow ? await accountWithBirthday(env.DB, session.accountRow) : null;
  return { ageFloorYears: account ? AGE_BAND_FLOOR_YEARS[account.age_band] : 18, account, email: account && session ? realEmail(session.email) : null, cookies: session?.cookies ?? [] };
}
