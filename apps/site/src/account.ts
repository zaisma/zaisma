import {
  ACCESS_AREAS,
  ACCOUNT_AREAS,
  ACCESS_LEVELS,
  AREA_ACCESS_CHOICES,
  MAXIMUM_API_KEY_COUNT,
  checkKeyScope,
  keyAccess,
  type AccessArea,
  type AccessLevel,
  type ApiKey,
  type AreaAccess,
  type KeyScope,
  NAME_RULES,
  accountById,
  ageBand,
  ageOn,
  apiKeysFor,
  b64url,
  checkName,
  createAccount,
  createApiKey,
  defaultSocialMode,
  deleteAccount,
  gameBySlug,
  gamesOwnedBy,
  isAgeBand,
  isSocialMode,
  newChallenge,
  passkeysFor,
  redirectUrlsOf,
  removeSignInGrant,
  revokeApiKey,
  signInGrantsFor,
  socialModesFor,
  updateAccount,
  type AgeBand,
  type SocialMode,
} from "@zaisma/core";
import {
  PROVIDERS,
  authConfigured,
  clearSessionCookies,
  currentSession,
  deleteAuthUser,
  exchangeCode,
  isProvider,
  providerUrl,
  providersOn,
  readCookie,
  sendCode,
  sessionCookies,
  setCookie,
  signOutEverywhere,
  verifyCode,
  type Provider,
  type Session,
} from "./auth.ts";
import type { Env } from "./env.ts";
import { deleteForumFiles } from "./forum-posts.ts";
import { html, layout, message, metalButton, raw, type Raw } from "./html.ts";
import { PASSKEY_SCRIPT, RECENT_SIGNIN_MS } from "./passkeys.ts";
import { deleteSaveFiles } from "./saves.ts";

/**
 * Sign-in, account creation and the account page.
 *
 * New accounts answer the age question before they type an email, so we collect
 * nothing from under-13s. The birth date is used once and never stored; we keep
 * the band (13–15, 16–17 or 18+). "Sign in" never creates accounts, so it can't skip the question.
 * 16 and over choose a social mode while making the account (friends-focused unless they pick
 * another); 13–15 start solo-focused. Everyone can change it on the account page, within their band.
 * Google and Discord work the same way: someone new who comes back from them without having
 * answered the age question is forgotten straight away and sent to answer it first.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const BLOCK_DURATION_SEC = 24 * 3600;
const JOIN_DURATION_SEC = 3600;
const OAUTH_DURATION_SEC = 600;

export async function handleAccount(request: Request, env: Env, path: string): Promise<Response | null> {
  if (
    !["/signin", "/signin/code", "/join", "/join/age", "/join/email", "/join/name", "/account", "/account/kept", "/account/name", "/account/age", "/account/social-mode", "/account/delete", "/account/keys", "/signout"].includes(path) &&
    !/^\/account\/keys\/[a-z0-9]+\/revoke$/.test(path) &&
    !/^\/account\/sign-ins\/sign_in_app_[a-z0-9]+\/remove$/.test(path) &&
    !/^\/signin\/(with\/[a-z]{1,20}|callback)$/.test(path)
  ) return null;
  if (!authConfigured(env)) return message(env, "Accounts aren't on yet", "You can still play as a guest.", 404);

  const post = request.method === "POST";
  if (post) {
    // Forms only come from our own pages.
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return new Response("Bad origin", { status: 403 });
  }
  const form = post ? await request.formData() : null;
  const field = (name: string, maximumCharacterCount = 200) => String(form?.get(name) ?? "").trim().slice(0, maximumCharacterCount);
  const next = safeNext(form ? field("next", 2000) : new URL(request.url).searchParams.get("next"));
  const session = await currentSession(request, env);
  const done = (response: Response) => withCookies(response, session?.cookies ?? []);

  if (path === "/signin" && !post) return done(session ? redirect(next ?? "/account") : await signinPage(env, next));

  // --- Google and Discord ---
  const withProvider = path.match(/^\/signin\/with\/([a-z]+)$/)?.[1];
  if (withProvider !== undefined) {
    if (!isProvider(withProvider) || !(await providersOn(env)).includes(withProvider)) return message(env, "Not available", "That way of signing in isn't on. Use an email code instead.", 404);
    // PKCE: the code Supabase sends back only works with this verifier, kept in this browser.
    const verifier = newChallenge();
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const cookie = setCookie(env, "zaisma_oauth", `${withProvider}.${verifier}.${encodeURIComponent(next ?? "")}`, { maximumAgeSec: OAUTH_DURATION_SEC });
    return withCookies(redirect(providerUrl(env, withProvider, challenge)), [cookie]);
  }

  if (path === "/signin/callback") {
    const [provider = "", verifier = "", ...rest] = (readCookie(request, env, "zaisma_oauth") ?? "").split(".");
    let back: string | null = null;
    try {
      back = safeNext(decodeURIComponent(rest.join(".")));
    } catch {}
    const cookies = [setCookie(env, "zaisma_oauth", "", { maximumAgeSec: 0 })];
    const query = new URL(request.url).searchParams;
    const code = query.get("code");
    const signedIn = code && verifier && isProvider(provider) ? await exchangeCode(env, code.slice(0, 500), verifier) : null;
    if (!signedIn) {
      const by = isProvider(provider) ? PROVIDERS[provider] : "That";
      const why = query.get("error") === "access_denied" ? `${by} sign-in was cancelled.` : `${by} sign-in didn't work. Try again, or use an email code.`;
      return withCookies(await signinPage(env, back, why, 400), cookies);
    }
    if (await accountById(env.DB, signedIn.userId)) return withCookies(redirect(back ?? "/"), [...cookies, ...sessionCookies(env, signedIn)]);
    // New here, and they answered the age question first: pick a name to finish.
    if (joinBand(request, env)) return withCookies(redirect(`/join/name${nextQuery(back)}`), [...cookies, ...sessionCookies(env, signedIn)]);
    // New here without the age question: keep nothing, and ask it now.
    await deleteAuthUser(env, signedIn.userId);
    return withCookies(redirect(`/join?with=${provider}${back ? `&next=${encodeURIComponent(back)}` : ""}`), cookies);
  }
  if (path.startsWith("/join") && readCookie(request, env, "zaisma_age") === "no") return done(tooYoungPage(env));

  if (path === "/signin" || path === "/join/email") {
    if (await limited(env, request)) return message(env, "Slow down", "Too many tries. Wait a minute and try again.", 429);
    const email = field("email", 320).toLowerCase();
    const band = joinBand(request, env);
    const socialMode = chosenSocialMode(band, field("social_mode", 40));
    if (!EMAIL.test(email)) return path === "/signin" ? await signinPage(env, next, "Enter your email address.") : await joinEmailPage(env, next, band, "Enter your email address.", { name: field("name"), socialMode });
    const cookies: string[] = [];
    if (path === "/join/email") {
      if (!band) return redirect("/join");
      const checked = checkName(field("name", 60));
      if ("error" in checked) return await joinEmailPage(env, next, band, checked.error, { name: field("name"), email, socialMode });
      cookies.push(setCookie(env, "zaisma_join", encodeURIComponent(JSON.stringify({ band, name: checked.name, social_mode: socialMode })), { maximumAgeSec: JOIN_DURATION_SEC }));
    }
    const sent = await sendCode(env, email, path === "/join/email");
    if (sent === "too-many") return message(env, "Slow down", "We've sent a lot of codes to that address. Wait a few minutes and try again.", 429);
    if (sent === "failed") return message(env, "Couldn't send the code", "Something went wrong on our side. Try again in a minute.", 502);
    return withCookies(codePage(env, email, next), cookies);
  }

  if (path === "/signin/code" && post) {
    if (await limited(env, request)) return message(env, "Slow down", "Too many tries. Wait a minute and try again.", 429);
    const email = field("email", 320).toLowerCase();
    const code = field("code", 20).replace(/\D/g, "");
    const signedIn = code.length >= 6 ? await verifyCode(env, email, code) : null;
    if (!signedIn) return codePage(env, email, next, "That code didn't work. Check it, or go back and get a new one.");
    const cookies = sessionCookies(env, signedIn);
    if (await accountById(env.DB, signedIn.userId)) return withCookies(redirect(next ?? "/"), cookies);
    // A brand new sign-in: finish the account with the age band and name from the join steps.
    const join = joinDetails(request, env);
    if (!join?.name) return withCookies(redirect(`/join${nextQuery(next)}`), cookies);
    await createAccount(env.DB, { id: signedIn.userId, name: join.name, ageBand: join.band, socialMode: join.socialMode });
    cookies.push(setCookie(env, "zaisma_join", "", { maximumAgeSec: 0 }));
    return withCookies(redirect(next ?? "/account?welcome"), cookies);
  }

  // --- Making an account ---
  if (path.startsWith("/join")) {
    const account = session ? await accountById(env.DB, session.userId) : null;
    if (account) return done(redirect(next ?? "/account"));

    if (path === "/join" && !post) {
      const via = new URL(request.url).searchParams.get("with") ?? "";
      return done(agePage(env, next, undefined, isProvider(via) ? via : undefined));
    }

    if (path === "/join/age" && post) {
      const ageYearCount = ageOn({ yearNumber: Number(field("year")), monthNumber: Number(field("month")), dayNumber: Number(field("day")) }, new Date());
      if (ageYearCount === null) return done(agePage(env, next, "Choose your full birth date."));
      const band = ageBand(ageYearCount);
      if (!band) {
        // Under 13: no account. Anything Supabase already holds (a half-finished sign-in) is deleted now.
        const cookies = [setCookie(env, "zaisma_age", "no", { maximumAgeSec: BLOCK_DURATION_SEC }), setCookie(env, "zaisma_join", "", { maximumAgeSec: 0 })];
        if (session) {
          await deleteAuthUser(env, session.userId);
          cookies.push(...clearSessionCookies(env));
        }
        return withCookies(tooYoungPage(env), cookies);
      }
      const cookie = setCookie(env, "zaisma_join", encodeURIComponent(JSON.stringify({ band })), { maximumAgeSec: JOIN_DURATION_SEC });
      // They came from Google or Discord: go straight back there (it won't ask again), then pick a name.
      const via = field("with");
      if (!session && isProvider(via) && (await providersOn(env)).includes(via)) return withCookies(redirect(`/signin/with/${via}${nextQuery(next)}`), [cookie]);
      // Already signed in (they verified an email but never finished): skip straight to the name.
      return withCookies(session ? joinNamePage(env, next, band) : await joinEmailPage(env, next, band), [...(session?.cookies ?? []), cookie]);
    }

    if (path === "/join/name" && !post) {
      const band = joinBand(request, env);
      return done(session && band ? joinNamePage(env, next, band) : redirect(`/join${nextQuery(next)}`));
    }

    if (path === "/join/name" && post && session) {
      const band = joinBand(request, env);
      if (!band) return done(redirect("/join"));
      const socialMode = chosenSocialMode(band, field("social_mode", 40));
      const checked = checkName(field("name", 60));
      if ("error" in checked) return done(joinNamePage(env, next, band, checked.error, { name: field("name"), socialMode }));
      await createAccount(env.DB, { id: session.userId, name: checked.name, ageBand: band, socialMode });
      return withCookies(redirect(next ?? "/account?welcome"), [...session.cookies, setCookie(env, "zaisma_join", "", { maximumAgeSec: 0 })]);
    }
    return done(redirect("/join"));
  }

  // --- Signed in from here on ---
  if (!session) return redirect(`/signin${nextQuery(path === "/account" ? null : path === "/account/kept" ? safeNext(path + new URL(request.url).search) : next)}`);
  const account = await accountById(env.DB, session.userId);

  if (path === "/signout" && post) {
    await signOutEverywhere(env, session.access);
    return withCookies(redirect("/"), clearSessionCookies(env));
  }
  if (!account) return done(redirect("/join"));

  if (path === "/account" && !post) {
    const query = new URL(request.url).searchParams;
    return done(await accountPage(env, session, query.has("welcome"), undefined, undefined, query));
  }
  if (path === "/account/kept" && !post) return done(await keptPage(env, account.name, new URL(request.url).searchParams.get("game")));

  if (path === "/account/name" && post) {
    const checked = checkName(field("name", 60));
    if ("error" in checked) return done(await accountPage(env, session, false, checked.error));
    await updateAccount(env.DB, account.id, { name: checked.name });
    return done(redirect("/account"));
  }

  // Teens move up a band once they're old enough, keeping their social mode. Nobody moves down, and the date isn't kept.
  if (path === "/account/age" && post && account.age_band !== "18+") {
    const ageYearCount = ageOn({ yearNumber: Number(field("year")), monthNumber: Number(field("month")), dayNumber: Number(field("day")) }, new Date());
    const band = ageYearCount === null ? null : ageBand(ageYearCount);
    if (!band || AGE_ORDER[band] <= AGE_ORDER[account.age_band]) return done(await accountPage(env, session, false, `That birth date isn't ${account.age_band === "13-15" ? "16" : "18"} or over yet.`));
    await updateAccount(env.DB, account.id, { ageBand: band });
    return done(redirect("/account#age"));
  }

  // Who can chat with them, within what their band can choose.
  if (path === "/account/social-mode" && post) {
    const socialMode = field("social_mode", 40);
    if (!isSocialMode(socialMode) || !socialModesFor(account.age_band).includes(socialMode)) return done(await accountPage(env, session, false, "Choose one of the chat settings shown."));
    await updateAccount(env.DB, account.id, { socialMode });
    return done(redirect("/account?social-mode-saved#chat"));
  }

  // API keys for the developer MCP and upload command. The key is shown once, here.
  if (path === "/account/keys" && post) {
    const name = field("name", 40) || "My key";
    if ((await apiKeysFor(env.DB, account.id)).length >= MAXIMUM_API_KEY_COUNT) return done(await accountPage(env, session, false, `You can have up to ${MAXIMUM_API_KEY_COUNT} keys. Remove one first.`));
    // Only the developer's own games can be chosen; anything else in the form is dropped.
    const ownSlugs = new Set((await gamesOwnedBy(env.DB, account.id)).map((game) => game.slug));
    const accessLevel = field("access_level", 20) as AccessLevel;
    const scope: KeyScope = {
      accessLevel,
      gameSlugs: field("game_scope", 10) === "some" ? [...new Set((form?.getAll("game_slugs") ?? []).map(String))].filter((slug) => ownSlugs.has(slug)) : null,
      ...(accessLevel === "custom" ? { areaAccess: Object.fromEntries(ACCESS_AREAS.map((area) => [area, field(area, 20)])) as AreaAccess } : {}),
    };
    // A key for some games never reaches the account's own areas; the page says so beside them.
    if (scope.gameSlugs && scope.areaAccess) for (const area of ACCOUNT_AREAS) (scope.areaAccess as Record<AccessArea, string>)[area] = "none";
    const problem = checkKeyScope(scope);
    if (problem) return done(await accountPage(env, session, false, problem));
    const { token } = await createApiKey(env.DB, account.id, name, scope);
    return done(await accountPage(env, session, false, undefined, { name, token }));
  }
  const revoke = path.match(/^\/account\/keys\/([a-z0-9]+)\/revoke$/);
  if (revoke && post) {
    await revokeApiKey(env.DB, account.id, revoke[1]!);
    return done(redirect("/account#developer"));
  }

  // Sign in with Zaisma: the player takes their yes to an app back.
  const signInApp = path.match(/^\/account\/sign-ins\/(sign_in_app_[a-z0-9]+)\/remove$/);
  if (signInApp && post) {
    await removeSignInGrant(env.DB, account.id, signInApp[1]!);
    return done(redirect("/account#sign-ins"));
  }

  if (path === "/account/delete" && post) {
    if (field("confirm").toLowerCase() !== "delete") return done(await accountPage(env, session, false, 'Type "delete" to confirm.'));
    if (!(await deleteAuthUser(env, session.userId))) return done(message(env, "Couldn't delete your account", "Something went wrong on our side. Try again later.", 502));
    await deleteSaveFiles(env, account.id);
    await deleteForumFiles(env, account.id);
    await deleteAccount(env.DB, account.id);
    return withCookies(message(env, "Your account is deleted", "Your email, name, game saves and everything else on your account are gone. You can still play as a guest."), clearSessionCookies(env));
  }

  return done(redirect("/account"));
}

// --- Helpers ---

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
}

function withCookies(response: Response, cookies: string[]): Response {
  const out = new Response(response.body, response);
  for (const cookie of cookies) out.headers.append("Set-Cookie", cookie);
  out.headers.set("Cache-Control", "no-store");
  return out;
}

/** Only our own paths, never another site. Long enough for a Sign in with Zaisma link (sign-in.ts). */
function safeNext(nextPath: string | null | undefined): string | null {
  return nextPath && /^\/(?![/\\])[\w\-./?=&%+*]*$/.test(nextPath) && nextPath.length < 2000 ? nextPath : null;
}

const nextQuery = (next: string | null) => (next ? `?next=${encodeURIComponent(next)}` : "");

async function limited(env: Env, request: Request): Promise<boolean> {
  // Keyed by connection address, checked by Cloudflare and never stored.
  return env.SIGNIN_LIMIT ? !(await env.SIGNIN_LIMIT.limit({ key: request.headers.get("cf-connecting-ip") ?? "local" })).success : false;
}

function joinDetails(request: Request, env: Env): { band: AgeBand; name?: string; socialMode: SocialMode } | null {
  try {
    const joinCookie = JSON.parse(decodeURIComponent(readCookie(request, env, "zaisma_join") ?? "")) as { band?: string; name?: string; social_mode?: string };
    if (!isAgeBand(joinCookie.band)) return null;
    return { band: joinCookie.band, name: typeof joinCookie.name === "string" ? joinCookie.name : undefined, socialMode: chosenSocialMode(joinCookie.band, joinCookie.social_mode) };
  } catch {
    return null;
  }
}

const joinBand = (request: Request, env: Env) => joinDetails(request, env)?.band ?? null;

/** The social mode picked while joining, when the band can choose it; otherwise the band's default. 13–15 never choose. */
function chosenSocialMode(band: AgeBand | null, given: unknown): SocialMode {
  if (!band) return "solo_focused";
  return band !== "13-15" && isSocialMode(given) && socialModesFor(band).includes(given) ? given : defaultSocialMode(band);
}

const AGE_ORDER: Record<AgeBand, number> = { "13-15": 0, "16-17": 1, "18+": 2 };

// --- Pages ---

function page(env: Env, title: string, body: Raw, httpStatus = 200): Response {
  const response = layout(env, { title: `${title} · Zaisma`, body: html`<div class="narrow">${body}</div>`, isPrivate: true });
  return new Response(response.body, { status: httpStatus, headers: response.headers });
}

const errorParagraph = (text?: string) => (text ? html`<p class="error" role="alert">${text}</p>` : "");
const nextField = (next: string | null) => (next ? html`<input type="hidden" name="next" value="${next}">` : "");

async function signinPage(env: Env, next: string | null, error?: string, httpStatus = 200): Promise<Response> {
  const providers = await providersOn(env);
  return page(
    env,
    "Sign in",
    html`<h1>Sign in</h1>
<p class="lead">No password needed.</p>
${errorParagraph(error)}
<div class="ways" id="ways"${providers.length ? "" : raw(" hidden")}>
<button class="btn" type="button" id="passkey-go" hidden>${raw(ICON_PASSKEY)}Sign in with a passkey</button>
${providerLinks(providers, next)}
<p class="error" role="alert" id="passkey-error" hidden></p>
<p class="or"><span>or get a code by email</span></p>
</div>
<form class="stack" method="post" action="/signin">
${nextField(next)}
<label>Email<input type="email" name="email" autocomplete="email webauthn" required autofocus></label>
<button class="btn" type="submit" id="code-go">Email me a code</button>
</form>
<p class="muted">New here? <a href="/join${nextQuery(next)}">Make an account</a>. Most games play without one.</p>
<script>${raw(PASSKEY_SCRIPT)}
(() => {
  if (!window.PublicKeyCredential) return;
  // Passkeys first, the email code as the way in for new devices.
  document.getElementById("ways").hidden = false;
  document.getElementById("passkey-go").hidden = false;
  document.getElementById("code-go").classList.add("ghost");
  const next = ${raw(JSON.stringify(next ?? "/").replace(/</g, "\u003c"))};
  const show = (e) => { const p = document.getElementById("passkey-error"); p.textContent = e || ""; p.hidden = !e; };
  document.getElementById("passkey-go").onclick = async () => show(await zaismaPasskeySignIn(next, false));
  // Browsers that can also offer passkeys in the email box's autofill.
  if (PublicKeyCredential.isConditionalMediationAvailable) PublicKeyCredential.isConditionalMediationAvailable().then((ok) => ok && zaismaPasskeySignIn(next, true).then(show));
})();
</script>`,
    httpStatus,
  );
}

const ICON_PROVIDER: Record<Provider, string> = {
  google:
    '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>',
  discord:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#5865F2" d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.6 1.25a18.27 18.27 0 0 0-5.49 0 12.64 12.64 0 0 0-.62-1.25.08.08 0 0 0-.08-.04 19.74 19.74 0 0 0-4.88 1.52.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-1.99a.08.08 0 0 0-.04-.1 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1-.01-.12l.37-.29a.07.07 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.06 0a.07.07 0 0 1 .08.01l.37.29a.08.08 0 0 1 0 .12c-.6.35-1.22.65-1.87.9a.08.08 0 0 0-.04.1c.36.7.77 1.36 1.22 1.99a.08.08 0 0 0 .09.03 19.84 19.84 0 0 0 6-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.68-3.55-13.66a.06.06 0 0 0-.03-.03zM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.15-1.09-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42z"/></svg>',
};

function providerLinks(providers: Provider[], next: string | null): Raw {
  return html`${providers.map((provider) => html`<a class="btn ghost" href="/signin/with/${provider}${nextQuery(next)}">${raw(ICON_PROVIDER[provider])}Continue with ${PROVIDERS[provider]}</a>`)}`;
}

export function codePage(env: Env, email: string, next: string | null, error?: string, confirm = false): Response {
  return page(
    env,
    "Check your email",
    html`<h1>Check your email</h1>
<p class="lead">${confirm ? html`We sent a code to <strong>${email}</strong>. Enter it to confirm it's you.` : html`If <strong>${email}</strong> has a Zaisma account or you're making one, a code is on its way.`}</p>
${errorParagraph(error)}
<form class="stack" method="post" action="/signin/code">
${nextField(next)}
<input type="hidden" name="email" value="${email}">
<label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,12}" maxlength="12" required autofocus></label>
<button class="btn" type="submit">Continue</button>
</form>
<p class="muted">No email after a minute? Check spam, or ${confirm ? html`<a href="/account#passkeys">go back</a> and try again` : html`<a href="/signin${nextQuery(next)}">try again</a>`}.</p>`,
    error ? 400 : 200,
  );
}

function birthFields(): Raw {
  const currentYearNumber = new Date().getUTCFullYear();
  return html`<div class="row birth">
<label>Month<select name="month" required><option value="">Month</option>${MONTHS.map((monthName, i) => html`<option value="${i + 1}">${monthName}</option>`)}</select></label>
<label>Day<select name="day" required><option value="">Day</option>${Array.from({ length: 31 }, (_, i) => html`<option>${i + 1}</option>`)}</select></label>
<label>Year<select name="year" required><option value="">Year</option>${Array.from({ length: 100 }, (_, i) => html`<option>${currentYearNumber - i}</option>`)}</select></label>
</div>`;
}

function agePage(env: Env, next: string | null, error?: string, via?: Provider): Response {
  return page(
    env,
    "Make an account",
    html`<h1>Make an account</h1>
<p class="lead">${via ? `You're new to Zaisma. Answer this first, then we'll take you back to ${PROVIDERS[via]} to finish.` : "Keep your progress, play with friends and get your own name. Most games play without one."}</p>
${errorParagraph(error)}
<form class="stack" method="post" action="/join/age">
${nextField(next)}
${via ? html`<input type="hidden" name="with" value="${via}">` : ""}
<fieldset><legend>When's your birthday?</legend>${birthFields()}</fieldset>
<p class="muted">We only keep your age group, never your birth date.</p>
<button class="btn" type="submit">Next</button>
</form>
<p class="muted">Have an account? <a href="/signin${nextQuery(next)}">Sign in</a>.</p>`,
  );
}

const SOCIAL_MODE_LABELS: Record<SocialMode, string> = { solo_focused: "Solo-focused", friends_focused: "Friends-focused", open_and_social: "Open and social" };

function socialModeHint(socialMode: SocialMode, band: AgeBand): string {
  if (socialMode === "solo_focused") return "No chat with other players. You still play with them.";
  if (socialMode === "friends_focused") return "Chat only with friends you invited, or who invited you.";
  return band === "16-17" ? "Chat with anyone 16 or 17 who's open and social too." : "Chat with any adult who's open and social too.";
}

/** The social modes a band can pick, as radio buttons. */
function socialModeChoices(band: AgeBand, current: SocialMode, legend: string): Raw {
  return html`<fieldset class="choices"><legend>${legend}</legend>
${socialModesFor(band).map(
    (socialMode) => html`<label class="check"><input type="radio" name="social_mode" value="${socialMode}"${socialMode === current ? raw(" checked") : ""}> <span>${SOCIAL_MODE_LABELS[socialMode]}<small class="hint">${socialModeHint(socialMode, band)}</small></span></label>`,
  )}
</fieldset>`;
}

/** 16 and over pick a social mode while joining; 13–15 start solo-focused and can turn on friends later. */
function joinSocialModeFields(band: AgeBand | null, current: SocialMode | undefined): Raw | string {
  if (!band || band === "13-15") return "";
  return html`${socialModeChoices(band, current ?? defaultSocialMode(band), "Who can chat with you?")}<p class="hint">Games that have chat follow this. You can change it any time on your account page.</p>`;
}

async function joinEmailPage(env: Env, next: string | null, band: AgeBand | null, error?: string, given: { name?: string; email?: string; socialMode?: SocialMode } = {}): Promise<Response> {
  const { name = "", email = "" } = given;
  const providers = await providersOn(env);
  return page(
    env,
    "Make an account",
    html`<h1>Make an account</h1>
${errorParagraph(error)}
${providers.length ? html`<div class="ways">${providerLinks(providers, next)}<p class="or"><span>or use your email</span></p></div>` : ""}
<form class="stack" method="post" action="/join/email">
${nextField(next)}
<label>Your name<input name="name" value="${name}" minlength="3" maxlength="20" autocomplete="nickname" required autofocus><span class="hint">What other players see. ${NAME_RULES} Don't use your real name.</span></label>
<label>Email<input type="email" name="email" value="${email}" autocomplete="email" required><span class="hint">Only for signing in. Never shown to anyone.</span></label>
${joinSocialModeFields(band, given.socialMode)}
<button class="btn" type="submit">Email me a code</button>
</form>
<p class="muted">By making an account you agree to the <a href="/legal/content-rules">content rules</a> and our <a href="/legal/privacy">privacy policy</a>.</p>`,
    error ? 400 : 200,
  );
}

function joinNamePage(env: Env, next: string | null, band: AgeBand, error?: string, given: { name?: string; socialMode?: SocialMode } = {}): Response {
  return page(
    env,
    "Pick a name",
    html`<h1>Pick a name</h1>
${errorParagraph(error)}
<form class="stack" method="post" action="/join/name">
${nextField(next)}
<label>Your name<input name="name" value="${given.name ?? ""}" minlength="3" maxlength="20" autocomplete="nickname" required autofocus><span class="hint">What other players see. ${NAME_RULES} Don't use your real name.</span></label>
${joinSocialModeFields(band, given.socialMode)}
<button class="btn" type="submit">Finish</button>
</form>`,
    error ? 400 : 200,
  );
}

function tooYoungPage(env: Env): Response {
  return page(
    env,
    "Accounts are for 13 and up",
    html`<h1>Accounts are for 13 and up</h1>
<p class="lead">You can't make a Zaisma account yet, but you can still play as a guest in any game that doesn't need one.</p>
<a class="btn" href="/">Find a game</a>`,
  );
}

// Just signed in or joined: tell the game tab that opened this one, and bring this device's
// recently played games over to the account.
const JOINED_SCRIPT = `<script>(()=>{try{new BroadcastChannel("zaisma").postMessage("signed-in")}catch{}
let p=[];try{p=JSON.parse(localStorage.getItem("zaisma:played")||"[]")}catch{}
if(p.length)fetch("/api/me/played",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({played:p.slice(0,20).map(g=>({slug:g.slug,played_at_ms:g.played_at_ms??g.at}))})}).catch(()=>{})})()</script>`;

/** Where "Keep your progress" lands once the guest has an account (or signed in), in the tab it opened. */
async function keptPage(env: Env, name: string, slug: string | null): Promise<Response> {
  const game = slug && /^[a-z0-9-]+$/.test(slug) ? await gameBySlug(env.DB, slug) : null;
  const back = game ? `/g/${game.slug}?play` : "/";
  return page(
    env,
    "You're in",
    html`<h1>You're in, ${name}</h1>
<p class="lead">${game ? `Go back to ${game.title} to keep playing.${game.cloud_saves_enabled ? " From now on, your progress saves to your account, so it's safe and follows you to any device." : ""}` : "From now on, games you play save your progress to your account."}</p>
${metalButton(game ? `Back to ${game.title}` : "Find a game", { href: back, dataAttributes: { back: "" } })}
${raw(JOINED_SCRIPT)}
<script>
// This tab was opened by the game: go back to it, so it keeps running where the player left off.
document.querySelector("[data-back]").addEventListener("click", (e) => {
  if (!window.opener || window.opener.closed) return;
  e.preventDefault();
  const href = e.currentTarget.href;
  try { window.opener.focus(); } catch {}
  window.close();
  // Some browsers won't close it: then just go to the game here.
  setTimeout(() => (location.href = href), 300);
});
</script>`,
  );
}

const LEVEL_LABELS: Record<AccessLevel, [string, string]> = {
  full: ["Full", "Everything: change and publish games, run database SQL, post on the forum, sign-in apps and webhooks. For your own AI tool."],
  publish: ["Publish", "Upload and publish versions, change game details and tester links, and post on the forum. Can't run SQL or change sign-in apps and webhooks."],
  upload: ["Upload", "Upload new versions as drafts and read everything, but not publish or post. For CI."],
  read: ["Read", "Read games, versions, stats, the database and the forum. Changes nothing."],
  custom: ["Custom", "Choose for each area."],
};

const AREA_LABELS: Record<AccessArea, string> = {
  game_access: "Games: details, images, visibility and tester links",
  version_access: "Versions",
  stats_access: "Stats, player reports and history",
  database_access: "Game databases",
  forum_access: "Developer forum",
  sign_in_app_access: "Sign-in apps (needs all your games)",
  webhook_access: "Webhooks (needs all your games)",
};

const AREA_SHORT_LABELS: Record<AccessArea, string> = { game_access: "games", version_access: "versions", stats_access: "stats", database_access: "database", forum_access: "forum", sign_in_app_access: "sign-in apps", webhook_access: "webhooks" };

const CHOICE_LABELS: Record<string, string> = { none: "No access", read: "Read", change: "Read and change", upload: "Upload", publish: "Upload and publish" };

/** What a key can do and on which games, in a few words, for the list of keys. */
function keyScopeText(key: ApiKey, games: { slug: string; title: string }[]): string {
  const access = keyAccess(key);
  const titles = access.gameSlugs?.map((slug) => games.find((game) => game.slug === slug)?.title ?? slug);
  const where = titles ? (titles.length === 1 ? `only ${titles[0]}` : `only ${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`) : "all games";
  const what =
    access.accessLevel === "custom"
      ? `Custom: ${ACCESS_AREAS.filter((area) => access.areaAccess[area] !== "none")
          .map((area) => `${AREA_SHORT_LABELS[area]} ${access.areaAccess[area]}`)
          .join(", ")}`
      : LEVEL_LABELS[access.accessLevel][0];
  return `${what}; ${where}`;
}

/** Making a key: its name, what it can do (a level or a choice per area) and which games. Open when there are no keys yet. */
function keyForm(games: { slug: string; title: string }[], isOpen: boolean): Raw {
  return html`<details${isOpen ? raw(" open") : ""}><summary>Make an API key</summary>
<form class="stack" method="post" action="/account/keys" id="key-form">
<label>Key name<input name="name" maxlength="40" placeholder="Like My laptop or GitHub Actions"></label>
<fieldset class="choices"><legend>What it can do</legend>
${ACCESS_LEVELS.map(
    (level) => html`<label class="check"><input type="radio" name="access_level" value="${level}"${level === "full" ? raw(" checked") : ""}> <span>${LEVEL_LABELS[level][0]}<small class="hint">${LEVEL_LABELS[level][1]}</small></span></label>`,
  )}
</fieldset>
<fieldset class="areas" id="key-areas"><legend>For a custom key</legend>
${ACCESS_AREAS.map(
    (area) => html`<label>${AREA_LABELS[area]}<select name="${area}">${AREA_ACCESS_CHOICES[area].map((choice: string) => html`<option value="${choice}"${choice === "read" ? raw(" selected") : ""}>${CHOICE_LABELS[choice]}</option>`)}</select></label>`,
  )}
</fieldset>
<fieldset class="choices"><legend>Which games</legend>
<label class="check"><input type="radio" name="game_scope" value="all" checked> <span>All my games<small class="hint">And games you make later.</small></span></label>
${games.length
    ? html`<label class="check"><input type="radio" name="game_scope" value="some"> <span>Only these games<small class="hint">It can't make games, sign-in apps or webhooks.</small></span></label>
<div class="choices" id="key-games">${games.map((game) => html`<label class="check"><input type="checkbox" name="game_slugs" value="${game.slug}"> <span>${game.title}</span></label>`)}</div>`
    : ""}
</fieldset>
<button class="btn" type="submit">Make the key</button>
</form>
</details>
<script>
(() => {
  const form = document.getElementById("key-form");
  const areas = document.getElementById("key-areas");
  const games = document.getElementById("key-games");
  const show = () => {
    areas.hidden = form.access_level.value !== "custom";
    const isSome = form.game_scope.value === "some";
    if (games) games.hidden = !isSome;
    // Sign-in apps and webhooks belong to the whole account, out of reach of a key for some games.
    for (const select of [form.sign_in_app_access, form.webhook_access]) {
      select.disabled = isSome;
      if (isSome) select.value = "none";
    }
  };
  form.addEventListener("change", show);
  show();
})();
</script>`;
}

const ICON_PASSKEY = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.9 3.1-7 7-7 1.2 0 2.4.3 3.4.9"/><circle cx="18" cy="13" r="2.5"/><path d="M18 15.5V21l1.5-1.2M18 18.5h1.5"/></svg>';

const BAND_TEXT: Record<AgeBand, string> = { "13-15": "13 to 15", "16-17": "16 or 17", "18+": "18 or over" };

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function accountPage(env: Env, session: Session, welcome: boolean, error?: string, made?: { name: string; token: string }, query = new URLSearchParams()): Promise<Response> {
  const account = (await accountById(env.DB, session.userId))!;
  const [games, keys, passkeys, signIns] = await Promise.all([gamesOwnedBy(env.DB, account.id), apiKeysFor(env.DB, account.id), passkeysFor(env.DB, account.id), signInGrantsFor(env.DB, account.id)]);
  // Adding a passkey needs a recent sign-in; otherwise an email code first.
  const recent = Date.now() - session.signedInAtMs < RECENT_SIGNIN_MS;
  return page(
    env,
    "Your account",
    html`${welcome ? html`<p class="note">Welcome to Zaisma, ${account.name}.</p>${raw(JOINED_SCRIPT)}` : ""}
<h1>${account.name}</h1>
<p class="lead">${session.email}</p>
${errorParagraph(error)}
<h2>Name</h2>
<form class="row" method="post" action="/account/name">
<input name="name" value="${account.name}" minlength="3" maxlength="20" required aria-label="Name">
<button class="btn ghost" type="submit">Save</button>
</form>
<h2 id="age">Age group</h2>
<p>${BAND_TEXT[account.age_band]}.${account.age_band === "18+" ? "" : " Accounts under 18 get safer settings."}</p>
${account.age_band === "18+"
      ? ""
      : html`<details><summary>Turned ${account.age_band === "13-15" ? "16" : "18"}?</summary><form class="stack" method="post" action="/account/age">${birthFields()}<button class="btn ghost" type="submit">Update</button></form></details>`}
<h2 id="friends">Friends</h2>
<p>Friends join by an invite you give them, as a link or a code. <a href="/friends">Your friends and invites</a>.</p>
<h2 id="chat">Chat</h2>
${query.has("social-mode-saved") ? html`<p class="note" role="status">Saved. Games pick it up the next time you open them.</p>` : ""}
<form class="stack" method="post" action="/account/social-mode">
${socialModeChoices(account.age_band, account.social_mode, "Who can chat with you in games")}
${account.age_band === "13-15" ? html`<p class="hint">Open and social opens up at 16.</p>` : ""}
<button class="btn ghost" type="submit">Save</button>
</form>
<h2 id="passkeys">Passkeys</h2>
<p>Sign in with Face ID, a fingerprint or your device's PIN instead of an email code. Your email still works if you lose a device.</p>
${query.has("passkey-added") ? html`<p class="note" role="status"><strong>Passkey added.</strong> Next time, choose Sign in with a passkey.</p>` : ""}
${query.has("passkey") && recent ? html`<p class="note" role="status">Thanks, that's you. Now add your passkey.</p>` : ""}
${query.has("passkey-failed") ? html`<p class="error" role="alert">Couldn't send a code. Wait a minute and try again.</p>` : ""}
${passkeys.length
      ? html`<ul class="keys">${passkeys.map(
          (passkey) => html`<li><span>Added on ${passkey.name} <span class="why muted small">${day(passkey.created_at_ms)}, ${passkey.last_used_at_ms ? `last used ${day(passkey.last_used_at_ms)}` : "not used yet"}</span></span>
<form method="post" action="/account/passkeys/${passkey.id}/remove"><button class="btn ghost" type="submit">Remove</button></form></li>`,
        )}</ul>`
      : ""}
<div class="row" id="passkey-add-row">
${recent
      ? html`<button class="btn${passkeys.length ? " ghost" : ""}" type="button" id="passkey-add"${query.has("passkey") ? raw(" autofocus") : ""}>Add a passkey</button>`
      : html`<form method="post" action="/account/passkeys/confirm"><button class="btn${passkeys.length ? " ghost" : ""}" type="submit" id="passkey-confirm">Add a passkey</button></form><span class="hint">We'll email you a code first, to check it's you.</span>`}
</div>
<p class="error" role="alert" id="passkey-error" hidden></p>
<script>${raw(PASSKEY_SCRIPT)}
(() => {
  const row = document.getElementById("passkey-add-row");
  if (!window.PublicKeyCredential) {
    row.innerHTML = "<p class=muted>This browser can't use passkeys.</p>";
    return;
  }
  const add = document.getElementById("passkey-add");
  if (!add) return;
  add.onclick = async () => {
    const error = await zaismaAddPasskey();
    if (!error) return (location.href = "/account?passkey-added#passkeys");
    // The recent sign-in ran out while the page was open: confirm with a code first.
    if (error === "confirm") return location.reload();
    const p = document.getElementById("passkey-error");
    p.textContent = error;
    p.hidden = false;
  };
})();
</script>
<h2>Game saves</h2>
<p>Games you play while signed in save your progress to your account. <a href="/account/saves">See your saves</a>, and go back to an earlier version if progress goes missing.</p>
${signIns.length
      ? html`<h2 id="sign-ins">Signed in with Zaisma</h2>
<p>Sites and apps you signed in to with your Zaisma account. They get your player ID and name, never your email. Remove one and it asks again next time.</p>
<ul class="keys">${signIns.map(
          (signIn) => html`<li><span>${signIn.name} <span class="muted small">${new URL(redirectUrlsOf(signIn)[0]!).host}, last used ${day(signIn.last_used_at_ms)}</span></span>
<form method="post" action="/account/sign-ins/${signIn.sign_in_app_id}/remove"><button class="btn ghost" type="submit">Remove</button></form></li>`,
        )}</ul>`
      : ""}
${games.length
      ? html`<h2>Your games</h2><ul>${games.map((game) => html`<li><a href="/dashboard/${game.slug}">${game.title}</a> <span class="pill ${game.review_status}">${game.review_status}</span></li>`)}</ul>`
      : ""}
<h2 id="developer">Game developers</h2>
<p>Manage your games on <a href="/dashboard">your games page</a>, or from any AI tool or the command line with an API key. Treat a key like a password: anyone with it can change your games.</p>
${made
      ? html`<div class="note" role="status"><p><strong>Your new key, "${made.name}".</strong> Copy it now. It won't be shown again.</p><p><code class="key">${made.token}</code></p>
<p class="small">Connect Claude Code to Zaisma with it:</p><p><code class="key">claude mcp add --transport http -s user zaisma ${env.SITE_ORIGIN}/mcp --header "Authorization: Bearer ${made.token}"</code></p>
<p class="small">Other AI tools: add the MCP server ${env.SITE_ORIGIN}/mcp with that header. For the upload command, set it as ZAISMA_KEY.</p></div>`
      : ""}
${keys.length
      ? html`<ul class="keys">${keys.map(
          (key) => html`<li><span>${key.name} <span class="why muted small">${keyScopeText(key, games)}</span><span class="why muted small">Made ${day(key.created_at_ms)}, ${key.last_used_at_ms ? `last used ${day(key.last_used_at_ms)}` : "not used yet"}</span></span>
<form method="post" action="/account/keys/${key.id}/revoke"><button class="btn ghost" type="submit">Remove</button></form></li>`,
        )}</ul>`
      : ""}
${keyForm(games, keys.length === 0)}
<h2>Sign out</h2>
<form method="post" action="/signout"><button class="btn ghost" type="submit">Sign out on every device</button></form>
<h2>Delete account</h2>
<details><summary>Delete your account</summary>
<p>This deletes your email, name, game saves and everything else on your account straight away. It can't be undone.</p>
<form class="row" method="post" action="/account/delete">
<input name="confirm" placeholder='Type "delete"' aria-label='Type "delete" to confirm' autocomplete="off" required>
<button class="btn danger" type="submit">Delete my account</button>
</form>
</details>
<p class="muted small">Account ID: <code>${account.id}</code></p>`,
  );
}
