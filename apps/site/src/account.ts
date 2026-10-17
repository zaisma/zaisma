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
  USERNAME_RULES,
  accountById,
  accountByUsername,
  ageBand,
  ageOn,
  apiKeysFor,
  b64url,
  changeUsername,
  checkUsername,
  createAccount,
  createApiKey,
  defaultSocialMode,
  deleteAccount,
  gameBySlug,
  gamesOwnedBy,
  isAgeBand,
  isSocialMode,
  isUsernameRight,
  isUsernameTaken,
  markPasswordChanged,
  newChallenge,
  passkeysFor,
  redirectUrlsOf,
  removeSignInGrant,
  revokeApiKey,
  signInGrantsFor,
  socialModesFor,
  suggestUsernames,
  updateAccount,
  UsernameTakenError,
  type Account,
  type AgeBand,
  type SocialMode,
} from "@zaisma/core";
import {
  PROVIDERS,
  authConfigured,
  authUserEmail,
  clearSessionCookies,
  createPasswordUser,
  currentSession,
  deleteAuthUser,
  exchangeCode,
  isProvider,
  providerUrl,
  providersOn,
  readCookie,
  realEmail,
  refreshSession,
  removeEmail,
  sendCode,
  sessionCookies,
  setCookie,
  setPassword,
  signInWithPassword,
  signOutEverywhere,
  startEmailChange,
  verifyCode,
  verifyEmailChange,
  type PasswordSignIn,
  type Provider,
  type Session,
} from "./auth.ts";
import type { Env } from "./env.ts";
import { deleteForumFiles } from "./forum-posts.ts";
import { html, layout, message, metalButton, raw, type Raw } from "./html.ts";
import { PASSKEY_SCRIPT, RECENT_SIGNIN_MS } from "./passkeys.ts";
import { MINIMUM_PASSWORD_CHARACTER_COUNT, PASSWORD_HINT, newPasswordProblem } from "./passwords.ts";
import { deleteSaveFiles } from "./saves.ts";
import { isRealBrowser, turnstileFormScript } from "./turnstile.ts";

/**
 * Sign-in, account creation and the account page.
 *
 * Making an account takes a birthday, a username and a password, nothing else (docs/DECISIONS.md).
 * The age question comes first, so we collect nothing from under-13s. The birth date is used once and
 * never stored; we keep the band (13–15, 16–17 or 18+). "Sign in" never creates accounts, so it can't skip
 * the question. 16 and over choose a social mode while making the account (friends-focused unless they
 * pick another); 13–15 start solo-focused. Everyone can change it on the account page, within their band.
 * Google and Discord work the same way, with a username and no password: someone new who comes back from
 * them without having answered the age question is forgotten straight away and sent to answer it first.
 *
 * Supabase checks passwords and makes sessions; an account without an email is known to it by a stand-in
 * address (auth.ts). An email and passkeys are optional ways back in. Changing how you sign in (password,
 * email, passkeys) needs a sign-in in the last 10 minutes: "Confirm it's you" on the account page.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const BLOCK_DURATION_SEC = 24 * 3600;
const JOIN_DURATION_SEC = 3600;
const OAUTH_DURATION_SEC = 600;
/** Longer than any password Supabase takes, so a long one gets the "too long" message instead of being cut. */
const MAXIMUM_PASSWORD_FIELD_CHARACTER_COUNT = 200;

const PATHS = [
  "/signin",
  "/signin/code",
  "/signin/email",
  "/join",
  "/join/age",
  "/join/account",
  "/join/username",
  "/api/username-check",
  "/account",
  "/account/kept",
  "/account/username",
  "/account/age",
  "/account/social-mode",
  "/account/confirm",
  "/account/password",
  "/account/email",
  "/account/email/code",
  "/account/email/remove",
  "/account/delete",
  "/account/keys",
  "/signout",
];

const SLOW_DOWN = "Too many tries. Wait a minute and try again.";
const BOT_CHECK_FAILED = "We couldn't check that you're using a real browser. Wait a few seconds and try again.";
const takenText = (username: string) => `${username} is taken. Try another, or one of these.`;

export async function handleAccount(request: Request, env: Env, path: string): Promise<Response | null> {
  if (!PATHS.includes(path) && !/^\/account\/keys\/[a-z0-9]+\/revoke$/.test(path) && !/^\/account\/sign-ins\/sign_in_app_[a-z0-9]+\/remove$/.test(path) && !/^\/signin\/(with\/[a-z]{1,20}|callback)$/.test(path)) return null;
  if (!authConfigured(env)) return message(env, "Accounts aren't on yet", "You can still play as a guest.", 404);

  const post = request.method === "POST";
  if (post) {
    // Forms only come from our own pages.
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return new Response("Bad origin", { status: 403 });
  }
  const form = post ? await request.formData() : null;
  const field = (name: string, maximumCharacterCount = 200) => String(form?.get(name) ?? "").trim().slice(0, maximumCharacterCount);
  // Passwords are taken as typed, spaces and all.
  const passwordField = (name = "password") => String(form?.get(name) ?? "").slice(0, MAXIMUM_PASSWORD_FIELD_CHARACTER_COUNT);
  const next = safeNext(form ? field("next", 2000) : new URL(request.url).searchParams.get("next"));
  const session = await currentSession(request, env);
  const done = (response: Response) => withCookies(response, session?.cookies ?? []);

  // Whether a username is free, as it's typed: on the join page, and the account page for the signed-in player.
  if (path === "/api/username-check") {
    const own = session ? await accountById(env.DB, session.userId) : null;
    const wanted = (new URL(request.url).searchParams.get("username") ?? "").slice(0, 40);
    return Response.json(await usernameAnswer(env, wanted, own), { headers: { "Cache-Control": "no-store" } });
  }

  if (path === "/signin" && !post) return done(session ? redirect(next ?? "/account") : await signinPage(env, next));
  if (path === "/signin/email" && !post) return done(session ? redirect(next ?? "/account") : emailSigninPage(env, next));

  // --- Google and Discord ---
  const withProvider = path.match(/^\/signin\/with\/([a-z]+)$/)?.[1];
  if (withProvider !== undefined) {
    if (!isProvider(withProvider) || !(await providersOn(env)).includes(withProvider)) return message(env, "Not available", "That way of signing in isn't on. Use your username and password instead.", 404);
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
      const why = query.get("error") === "access_denied" ? `${by} sign-in was cancelled.` : `${by} sign-in didn't work. Try again, or use your username and password.`;
      return withCookies(await signinPage(env, back, why, 400), cookies);
    }
    if (await accountById(env.DB, signedIn.userId)) return withCookies(redirect(back ?? "/"), [...cookies, ...sessionCookies(env, signedIn)]);
    // New here, and they answered the age question first: pick a username to finish.
    if (joinBand(request, env)) return withCookies(redirect(`/join/username${nextQuery(back)}`), [...cookies, ...sessionCookies(env, signedIn)]);
    // New here without the age question: keep nothing, and ask it now.
    await deleteAuthUser(env, signedIn.userId);
    return withCookies(redirect(`/join?with=${provider}${back ? `&next=${encodeURIComponent(back)}` : ""}`), cookies);
  }
  if (path.startsWith("/join") && readCookie(request, env, "zaisma_age") === "no") return done(tooYoungPage(env));

  // --- Signing in with a username (or email) and password ---
  if (path === "/signin" && post) {
    if (await limited(env, request)) return message(env, "Slow down", SLOW_DOWN, 429);
    const login = field("username", 320);
    const password = passwordField();
    if (!login || !password) return await signinPage(env, next, "Enter your username and password.", 400, login);
    const signedIn = await passwordSignIn(env, login, password);
    if (signedIn === "too-many") return message(env, "Slow down", SLOW_DOWN, 429);
    if (signedIn === "no-password") return await signinPage(env, next, "This account doesn't have a password yet. Use Forgot your password to get in with your email, then add one.", 400, login);
    if (signedIn === "wrong") return await signinPage(env, next, "That username and password don't match. Check them and try again.", 400, login);
    if (signedIn === "failed") return message(env, "Couldn't sign you in", "Something went wrong on our side. Try again in a minute.", 502);
    const cookies = sessionCookies(env, signedIn);
    // Signed in, but the account was never finished (a half-done Google sign-up): finish it first.
    if (!(await accountById(env.DB, signedIn.userId))) return withCookies(redirect(`/join${nextQuery(next)}`), cookies);
    return withCookies(redirect(next ?? "/"), cookies);
  }

  // --- Forgot your password: back in with a code to the account's email ---
  if (path === "/signin/email" && post) {
    if (await limited(env, request)) return message(env, "Slow down", SLOW_DOWN, 429);
    const email = field("email", 320).toLowerCase();
    if (!EMAIL.test(email)) return emailSigninPage(env, next, "Enter your email address.");
    const sent = await sendCode(env, email, false);
    if (sent === "too-many") return message(env, "Slow down", "We've sent a lot of codes to that address. Wait a few minutes and try again.", 429);
    if (sent === "failed") return message(env, "Couldn't send the code", "Something went wrong on our side. Try again in a minute.", 502);
    return codePage(env, email, next);
  }

  if (path === "/signin/code" && post) {
    if (await limited(env, request)) return message(env, "Slow down", SLOW_DOWN, 429);
    const email = field("email", 320).toLowerCase();
    const code = field("code", 20).replace(/\D/g, "");
    const signedIn = code.length >= 6 ? await verifyCode(env, email, code) : null;
    if (!signedIn) return codePage(env, email, next, "That code didn't work. Check it, or go back and get a new one.");
    const cookies = sessionCookies(env, signedIn);
    if (await accountById(env.DB, signedIn.userId)) return withCookies(redirect(next ?? "/"), cookies);
    return withCookies(redirect(`/join${nextQuery(next)}`), cookies);
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
      // They came from Google or Discord: go straight back there (it won't ask again), then pick a username.
      const via = field("with");
      if (!session && isProvider(via) && (await providersOn(env)).includes(via)) return withCookies(redirect(`/signin/with/${via}${nextQuery(next)}`), [cookie]);
      // Already signed in (Google or Discord, or an email code, but never finished): just the username.
      return withCookies(session ? joinUsernamePage(env, next, band) : await joinAccountPage(env, next, band), [...(session?.cookies ?? []), cookie]);
    }

    const band = joinBand(request, env);
    if (!band) return done(redirect(`/join${nextQuery(next)}`));

    if (path === "/join/account" && !post) return done(session ? redirect(`/join/username${nextQuery(next)}`) : await joinAccountPage(env, next, band));

    if (path === "/join/account" && post) {
      if (session) return done(redirect(`/join/username${nextQuery(next)}`));
      if (await limited(env, request)) return message(env, "Slow down", SLOW_DOWN, 429);
      const socialMode = chosenSocialMode(band, field("social_mode", 40));
      const wanted = field("username", 40);
      const password = passwordField();
      const again = async (error: string, suggestions: string[] = []) => joinAccountPage(env, next, band, error, { username: wanted, socialMode, suggestions });
      const checked = checkUsername(wanted);
      if ("error" in checked) return await again(checked.error, await suggestUsernames(env.DB, wanted));
      if (await isUsernameTaken(env.DB, checked.username)) return await again(takenText(checked.username), await suggestUsernames(env.DB, checked.username));
      const problem = await newPasswordProblem(password, checked.username);
      if (problem) return await again(problem);
      // Last, so a token isn't spent on a form that comes back for another reason.
      if (env.TURNSTILE_SECRET && !(await isRealBrowser(env, field("turnstile_token", 2048), "join"))) return await again(BOT_CHECK_FAILED);
      const made = await createPasswordUser(env, password);
      if (!made) return message(env, "Couldn't make your account", "Something went wrong on our side. Try again in a minute.", 502);
      try {
        await createAccount(env.DB, { id: made.userId, username: checked.username, ageBand: band, socialMode, hasPassword: true });
      } catch (error) {
        if (!(error instanceof UsernameTakenError)) throw error;
        await deleteAuthUser(env, made.userId);
        return await again(takenText(checked.username), await suggestUsernames(env.DB, checked.username));
      }
      const signedIn = await signInWithPassword(env, made.email, password);
      const cookies = [setCookie(env, "zaisma_join", "", { maximumAgeSec: 0 })];
      if (typeof signedIn === "string") return withCookies(redirect(`/signin${nextQuery(next)}`), cookies);
      return withCookies(redirect(next ?? "/account?welcome"), [...cookies, ...sessionCookies(env, signedIn)]);
    }

    if (path === "/join/username" && !post) return done(session ? joinUsernamePage(env, next, band) : redirect(`/join/account${nextQuery(next)}`));

    if (path === "/join/username" && post && session) {
      const socialMode = chosenSocialMode(band, field("social_mode", 40));
      const wanted = field("username", 40);
      const again = async (error: string, suggestions: string[] = []) => done(joinUsernamePage(env, next, band, error, { username: wanted, socialMode, suggestions }));
      const checked = checkUsername(wanted);
      if ("error" in checked) return await again(checked.error, await suggestUsernames(env.DB, wanted));
      if (await isUsernameTaken(env.DB, checked.username)) return await again(takenText(checked.username), await suggestUsernames(env.DB, checked.username));
      if (env.TURNSTILE_SECRET && !(await isRealBrowser(env, field("turnstile_token", 2048), "join"))) return await again(BOT_CHECK_FAILED);
      try {
        await createAccount(env.DB, { id: session.userId, username: checked.username, ageBand: band, socialMode });
      } catch (error) {
        if (!(error instanceof UsernameTakenError)) throw error;
        return await again(takenText(checked.username), await suggestUsernames(env.DB, checked.username));
      }
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
  // Changing how they sign in needs a sign-in in the last 10 minutes, so a stolen session can't lock them out.
  const recent = Date.now() - session.signedInAtMs < RECENT_SIGNIN_MS;

  if (path === "/account" && !post) {
    const query = new URL(request.url).searchParams;
    return done(await accountPage(env, session, query.has("welcome"), undefined, undefined, query));
  }
  if (path === "/account/kept" && !post) return done(await keptPage(env, account.username, new URL(request.url).searchParams.get("game")));

  if (path === "/account/username" && post) {
    const wanted = field("username", 40);
    const checked = checkUsername(wanted);
    if ("error" in checked) return done(await accountPage(env, session, false, checked.error, undefined, undefined, { username: wanted, suggestions: await suggestUsernames(env.DB, wanted) }));
    if (!(await changeUsername(env.DB, account.id, checked.username))) {
      return done(await accountPage(env, session, false, takenText(checked.username), undefined, undefined, { username: wanted, suggestions: await suggestUsernames(env.DB, checked.username) }));
    }
    return done(redirect("/account?username-saved#username"));
  }

  // Confirm it's them: their password, or a code to their email when the account has no password.
  if (path === "/account/confirm" && post) {
    const back = next ?? "/account?confirmed#signing-in";
    if (account.password_changed_at_ms !== null) {
      const password = passwordField();
      const email = password ? await authUserEmail(env, account.id) : null;
      const isLimited = env.PASSWORD_LIMIT ? !(await env.PASSWORD_LIMIT.limit({ key: account.id })).success : false;
      if (isLimited) return done(message(env, "Slow down", SLOW_DOWN, 429));
      const signedIn: PasswordSignIn = email ? await signInWithPassword(env, email, password) : "wrong";
      if (signedIn === "wrong") return done(await accountPage(env, session, false, "That password isn't right."));
      if (signedIn === "too-many") return done(message(env, "Slow down", SLOW_DOWN, 429));
      if (signedIn === "failed") return done(message(env, "Couldn't check your password", "Something went wrong on our side. Try again in a minute.", 502));
      return withCookies(redirect(back), sessionCookies(env, signedIn));
    }
    const email = realEmail(session.email);
    const sent = email ? await sendCode(env, email, false) : "failed";
    if (!email || sent !== "sent") return done(redirect("/account?confirm-failed#signing-in"));
    return done(codePage(env, email, back, undefined, "confirm"));
  }

  if ((path === "/account/password" || path === "/account/email" || path === "/account/email/remove") && post && !recent) return done(redirect("/account?confirm-first#signing-in"));

  if (path === "/account/password" && post) {
    const password = passwordField();
    const problem = await newPasswordProblem(password, account.username);
    // From the window after Forgot your password: it opens again, saying what's wrong.
    const again = field("from", 20) === "new-password" ? new URLSearchParams({ "new-password": "", ...(next ? { next } : {}) }) : undefined;
    if (problem) return done(await accountPage(env, session, false, problem, undefined, again));
    if (!(await setPassword(env, account.id, password))) return done(message(env, "Couldn't save your password", "Something went wrong on our side. Try again in a minute.", 502));
    await markPasswordChanged(env.DB, account.id);
    return done(redirect(next ?? "/account?password-saved#signing-in"));
  }

  // An email: Supabase sends a code to the new address, and it's theirs once they type it.
  if (path === "/account/email" && post) {
    if (await limited(env, request)) return done(message(env, "Slow down", SLOW_DOWN, 429));
    const email = field("email", 320).toLowerCase();
    if (!EMAIL.test(email)) return done(await accountPage(env, session, false, "Enter an email address."));
    if (email === realEmail(session.email)?.toLowerCase()) return done(redirect("/account#signing-in"));
    const started = await startEmailChange(env, session.access, email);
    if (started === "taken") return done(await accountPage(env, session, false, "That email can't be added. It may already be on another account."));
    if (started === "too-many") return done(message(env, "Slow down", "We've sent a lot of codes. Wait a few minutes and try again.", 429));
    if (started === "failed") return done(message(env, "Couldn't send the code", "Something went wrong on our side. Try again in a minute.", 502));
    return done(codePage(env, email, null, undefined, "email"));
  }

  if (path === "/account/email/code" && post) {
    if (await limited(env, request)) return done(message(env, "Slow down", SLOW_DOWN, 429));
    const email = field("email", 320).toLowerCase();
    const code = field("code", 20).replace(/\D/g, "");
    const changed = code.length >= 6 ? await verifyEmailChange(env, email, code) : null;
    if (!changed) return done(codePage(env, email, null, "That code didn't work. Check it, or go back and try again.", "email"));
    return withCookies(redirect("/account?email-saved#signing-in"), sessionCookies(env, changed));
  }

  // Taking the email off: only with a password, so they can still sign in.
  if (path === "/account/email/remove" && post) {
    if (account.password_changed_at_ms === null) return done(await accountPage(env, session, false, "Add a password first, so you can still sign in without your email."));
    if (!(await removeEmail(env, account.id))) return done(message(env, "Couldn't remove your email", "Something went wrong on our side. Try again in a minute.", 502));
    const fresh = await refreshSession(env, session.refresh);
    return withCookies(redirect("/account?email-removed#signing-in"), fresh ? sessionCookies(env, fresh) : session.cookies);
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
    return withCookies(message(env, "Your account is deleted", "Your username, any email, game saves and everything else on your account are gone. You can still play as a guest."), clearSessionCookies(env));
  }

  return done(redirect("/account"));
}

/**
 * A password sign-in by username, or by the account's email for those who type it. "no-password" for an
 * account made with an email code, Google or Discord that never added one. Usernames are public, so saying
 * which part is wrong would give nothing away, but one message for both keeps it simple.
 */
async function passwordSignIn(env: Env, login: string, password: string): Promise<PasswordSignIn | "no-password"> {
  let email: string | null = null;
  let limitKey: string;
  let account: Account | null = null;
  if (login.includes("@")) {
    email = login.toLowerCase();
    limitKey = email;
  } else {
    account = await accountByUsername(env.DB, login.replace(/^@/, ""));
    if (!account) return "wrong";
    limitKey = account.id;
  }
  if (env.PASSWORD_LIMIT && !(await env.PASSWORD_LIMIT.limit({ key: limitKey })).success) return "too-many";
  if (account) {
    if (account.password_changed_at_ms === null) return "no-password";
    email = await authUserEmail(env, account.id);
    if (!email) return "failed";
  }
  return signInWithPassword(env, email!, password);
}

/** What the username box says as it's typed: free or not, why, and free ones close to it. */
async function usernameAnswer(env: Env, wanted: string, own: Account | null): Promise<{ is_available: boolean; message: string; suggested_usernames: string[] }> {
  const checked = checkUsername(wanted);
  if ("error" in checked) return { is_available: false, message: checked.error, suggested_usernames: wanted.trim() ? await suggestUsernames(env.DB, wanted) : [] };
  if (own && own.username.toLowerCase() === checked.username.toLowerCase()) return { is_available: true, message: "That's your username.", suggested_usernames: [] };
  if (await isUsernameTaken(env.DB, checked.username)) return { is_available: false, message: `${checked.username} is taken.`, suggested_usernames: await suggestUsernames(env.DB, checked.username) };
  return { is_available: true, message: `${checked.username} is free.`, suggested_usernames: [] };
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
  return nextPath && /^\/(?![/\\])[\w\-./?=&%+*#]*$/.test(nextPath) && nextPath.length < 2000 ? nextPath : null;
}

const nextQuery = (next: string | null) => (next ? `?next=${encodeURIComponent(next)}` : "");

async function limited(env: Env, request: Request): Promise<boolean> {
  // Keyed by connection address, checked by Cloudflare and never stored.
  return env.SIGNIN_LIMIT ? !(await env.SIGNIN_LIMIT.limit({ key: request.headers.get("cf-connecting-ip") ?? "local" })).success : false;
}

/** The age band from the join steps' cookie, once the age question is answered. */
function joinBand(request: Request, env: Env): AgeBand | null {
  try {
    const joinCookie = JSON.parse(decodeURIComponent(readCookie(request, env, "zaisma_join") ?? "")) as { band?: string };
    return isAgeBand(joinCookie.band) ? joinCookie.band : null;
  } catch {
    return null;
  }
}

/** The social mode picked while joining, when the band can choose it; otherwise the band's default. 13–15 never choose. */
function chosenSocialMode(band: AgeBand | null, given: unknown): SocialMode {
  if (!band) return "solo_focused";
  return band !== "13-15" && isSocialMode(given) && socialModesFor(band).includes(given) ? given : defaultSocialMode(band);
}

const AGE_ORDER: Record<AgeBand, number> = { "13-15": 0, "16-17": 1, "18+": 2 };

// --- Pages ---

function page(env: Env, title: string, body: Raw, httpStatus = 200, hasTurnstileCheck = false): Response {
  const response = layout(env, { title: `${title} · Zaisma`, body: html`<div class="narrow">${body}</div>`, isPrivate: true, hasTurnstileCheck });
  return new Response(response.body, { status: httpStatus, headers: response.headers });
}

const errorParagraph = (text?: string) => (text ? html`<p class="error" role="alert">${text}</p>` : "");
const nextField = (next: string | null) => (next ? html`<input type="hidden" name="next" value="${next}">` : "");

/** Show what's typed in a form's password boxes, for typing one on a phone. */
const showPasswordToggle = () => html`<label class="toggle"><input type="checkbox" data-show-password> Show password</label>`;
const SHOW_PASSWORD_SCRIPT = `for (const box of document.querySelectorAll("[data-show-password]")) box.addEventListener("change", () => { for (const input of box.closest("form").querySelectorAll('input[name="password"]')) input.type = box.checked ? "text" : "password"; });`;

/**
 * The username box, with what it says as it's typed (free, taken, why not) and free ones close to it to
 * tap. The server says the same when the form comes back, so it works without the script.
 */
function usernameField(given: string, hint: string, suggestions: string[], options: { isFocused?: boolean; label?: string } = {}): Raw {
  return html`<label>${options.label ?? "Username"}<input id="username-box" name="username" value="${given}" minlength="3" maxlength="20" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" required${options.label === "" ? raw(' aria-label="Username"') : ""}${options.isFocused === false ? "" : raw(" autofocus")}><span class="hint" id="username-status" data-resting="${hint}">${hint}</span></label>
${usernameSuggestions(suggestions)}`;
}

const usernameSuggestions = (suggestions: string[]) =>
  html`<div class="suggest" id="username-suggestions"${suggestions.length ? "" : raw(" hidden")}>${suggestions.length ? html`<span>Free:</span>` : ""}${suggestions.map((suggestion) => html`<button class="btn ghost" type="button" data-username="${suggestion}">${suggestion}</button>`)}</div>`;

const USERNAME_SCRIPT = `(() => {
  const input = document.getElementById("username-box"), status = document.getElementById("username-status"), box = document.getElementById("username-suggestions");
  if (!input || !status || !box) return;
  let timer = null, asked = input.value.trim();
  const show = (text, kind) => { status.textContent = text; status.className = "hint" + (kind ? " " + kind : ""); };
  const suggest = (names) => {
    box.replaceChildren();
    if (names.length) box.append(Object.assign(document.createElement("span"), { textContent: "Free:" }));
    for (const name of names) {
      const button = Object.assign(document.createElement("button"), { type: "button", className: "btn ghost", textContent: name });
      button.dataset.username = name;
      box.append(button);
    }
    box.hidden = !names.length;
  };
  const check = async () => {
    const wanted = input.value.trim();
    if (wanted === asked) return;
    asked = wanted;
    if (!wanted) { show(status.dataset.resting); suggest([]); return; }
    try {
      const answer = await (await fetch("/api/username-check?username=" + encodeURIComponent(wanted))).json();
      if (input.value.trim() !== wanted) return;
      show(answer.message, answer.is_available ? "ok" : "bad");
      suggest(answer.suggested_usernames || []);
    } catch {}
  };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(check, 350); });
  box.addEventListener("click", (event) => {
    const chosen = event.target.closest("button[data-username]");
    if (!chosen) return;
    input.value = chosen.dataset.username;
    input.focus();
    check();
  });
})();`;

async function signinPage(env: Env, next: string | null, error?: string, httpStatus = 200, login = ""): Promise<Response> {
  const providers = await providersOn(env);
  return page(
    env,
    "Sign in",
    html`<h1>Sign in</h1>
${errorParagraph(error)}
<form class="stack" method="post" action="/signin">
${nextField(next)}
<label>Username<input name="username" value="${login}" autocomplete="username webauthn" autocapitalize="off" autocorrect="off" spellcheck="false" required${login ? "" : raw(" autofocus")}></label>
<label>Password<input type="password" name="password" autocomplete="current-password" required${login ? raw(" autofocus") : ""}></label>
${showPasswordToggle()}
<button class="btn" type="submit">Sign in</button>
</form>
<p class="muted"><a href="/signin/email${nextQuery(next)}">Forgot your password?</a></p>
<div class="ways" id="ways"${providers.length ? "" : raw(" hidden")}>
<p class="or"><span>or</span></p>
<button class="btn ghost" type="button" id="passkey-go" hidden>${raw(ICON_PASSKEY)}Sign in with a passkey</button>
${providerLinks(providers, next)}
<p class="error" role="alert" id="passkey-error" hidden></p>
</div>
<p class="muted">New here? <a href="/join${nextQuery(next)}">Make an account</a>. Most games play without one.</p>
<script>${raw(SHOW_PASSWORD_SCRIPT)}
${raw(PASSKEY_SCRIPT)}
(() => {
  if (!window.PublicKeyCredential) return;
  document.getElementById("ways").hidden = false;
  document.getElementById("passkey-go").hidden = false;
  const next = ${raw(JSON.stringify(next ?? "/").replace(/</g, "\\u003c"))};
  const show = (e) => { const p = document.getElementById("passkey-error"); p.textContent = e || ""; p.hidden = !e; };
  document.getElementById("passkey-go").onclick = async () => show(await zaismaPasskeySignIn(next, false));
  // Browsers that can also offer passkeys in the username box's autofill.
  if (PublicKeyCredential.isConditionalMediationAvailable) PublicKeyCredential.isConditionalMediationAvailable().then((ok) => ok && zaismaPasskeySignIn(next, true).then(show));
})();
</script>`,
    httpStatus,
  );
}

/**
 * Forgot your password: a code to the account's email, or a passkey. After it, a window on the account
 * page asks for a new password, then goes on to wherever they were headed.
 */
function emailSigninPage(env: Env, next: string | null, error?: string): Response {
  const back = `/account?new-password${next ? `&next=${encodeURIComponent(next)}` : ""}`;
  return page(
    env,
    "Forgot your password?",
    html`<h1>Forgot your password?</h1>
<p class="lead">Get back in with the email or a passkey on your account, then set a new password.</p>
${errorParagraph(error)}
<form class="stack" method="post" action="/signin/email">
${nextField(back)}
<label>Email<input type="email" name="email" autocomplete="email" required autofocus></label>
<button class="btn" type="submit">Email me a code</button>
</form>
<div class="ways" id="ways" hidden>
<p class="or"><span>or</span></p>
<button class="btn ghost" type="button" id="passkey-go">${raw(ICON_PASSKEY)}Sign in with a passkey</button>
<p class="error" role="alert" id="passkey-error" hidden></p>
</div>
<p class="muted">Added neither? Then the account can't be recovered, but you can always <a href="/join">make a new one</a>.</p>
<script>${raw(PASSKEY_SCRIPT)}
(() => {
  if (!window.PublicKeyCredential) return;
  document.getElementById("ways").hidden = false;
  const show = (e) => { const p = document.getElementById("passkey-error"); p.textContent = e || ""; p.hidden = !e; };
  document.getElementById("passkey-go").onclick = async () => show(await zaismaPasskeySignIn(${raw(JSON.stringify(back).replace(/</g, "\\u003c"))}, false));
})();
</script>`,
    error ? 400 : 200,
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

/** What a code is for: signing in, confirming it's you on the account page, or adding an email. */
type CodeKind = "signin" | "confirm" | "email";

function codePage(env: Env, email: string, next: string | null, error?: string, kind: CodeKind = "signin"): Response {
  const lead = {
    signin: html`If <strong>${email}</strong> is on a Zaisma account, a code is on its way.`,
    confirm: html`We sent a code to <strong>${email}</strong>. Enter it to confirm it's you.`,
    email: html`We sent a code to <strong>${email}</strong>. Enter it to add the email to your account.`,
  }[kind];
  const back = { signin: html`<a href="/signin/email${nextQuery(next)}">try again</a>`, confirm: html`<a href="/account#signing-in">go back</a> and try again`, email: html`<a href="/account#signing-in">go back</a> and try again` }[kind];
  return page(
    env,
    "Check your email",
    html`<h1>Check your email</h1>
<p class="lead">${lead}</p>
${errorParagraph(error)}
<form class="stack" method="post" action="${kind === "email" ? "/account/email/code" : "/signin/code"}">
${nextField(next)}
<input type="hidden" name="email" value="${email}">
<label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,12}" maxlength="12" required autofocus></label>
<button class="btn" type="submit">Continue</button>
</form>
<p class="muted">No email after a minute? Check spam, or ${back}.</p>`,
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
<p class="lead">${via ? `You're new to Zaisma. Answer this first, then we'll take you back to ${PROVIDERS[via]} to finish.` : "Keep your progress, play with friends and get your own username. Most games play without one."}</p>
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
/** Each preset as a new player picks it: a line in their own words. */
const JOIN_SOCIAL_MODE_LINES: Record<SocialMode, string> = {
  solo_focused: "I just want to play, no chat.",
  friends_focused: "I want to play and chat with my friends.",
  open_and_social: "I like meeting new players.",
};

function joinSocialModeFields(band: AgeBand | null, current: SocialMode | undefined): Raw | string {
  if (!band || band === "13-15") return "";
  const chosen = current ?? defaultSocialMode(band);
  return html`<fieldset class="choices"><legend>How do you play?</legend>
${socialModesFor(band).map(
    (socialMode) => html`<label class="check"><input type="radio" name="social_mode" value="${socialMode}"${socialMode === chosen ? raw(" checked") : ""}> <span>${SOCIAL_MODE_LABELS[socialMode]}<small class="hint">${JOIN_SOCIAL_MODE_LINES[socialMode]}</small></span></label>`,
  )}
</fieldset>
<p class="hint">You can change this any time on your account page.</p>`;
}

const USERNAME_HINT = "Everyone sees it, and it's how friends find you. Don't use your real name.";

/** What a join form shows again when it comes back: what they typed (never the password), and free usernames. */
interface JoinGiven {
  username?: string;
  socialMode?: SocialMode;
  suggestions?: string[];
}

/** Cloudflare's invisible check on a join form, when it's set up: an empty box it can use, and its answer's field. */
const joinCheck = (env: Env) => (env.TURNSTILE_SITE_KEY ? html`<input type="hidden" name="turnstile_token"><div id="join-check"></div>` : "");
const joinCheckScript = (env: Env) => (env.TURNSTILE_SITE_KEY ? turnstileFormScript(env.TURNSTILE_SITE_KEY, "join", "join-form", "join-check") : "");

/** The second step: a username and a password, or Google or Discord instead. */
async function joinAccountPage(env: Env, next: string | null, band: AgeBand, error?: string, given: JoinGiven = {}): Promise<Response> {
  const providers = await providersOn(env);
  return page(
    env,
    "Make an account",
    html`<h1>Make an account</h1>
${errorParagraph(error)}
${providers.length ? html`<div class="ways">${providerLinks(providers, next)}<p class="or"><span>or pick a username and password</span></p></div>` : ""}
<form class="stack" method="post" action="/join/account" id="join-form">
${nextField(next)}
${usernameField(given.username ?? "", USERNAME_HINT, given.suggestions ?? [])}
<label>Password<input type="password" name="password" minlength="${MINIMUM_PASSWORD_CHARACTER_COUNT}" autocomplete="new-password" required><span class="hint">${PASSWORD_HINT}</span></label>
${showPasswordToggle()}
${joinSocialModeFields(band, given.socialMode)}
${joinCheck(env)}
<button class="btn" type="submit">Make my account</button>
</form>
<p class="muted">By making an account you agree to the <a href="/legal/content-rules">content rules</a> and our <a href="/legal/privacy">privacy policy</a>.</p>
<script>${raw(USERNAME_SCRIPT)}
${raw(SHOW_PASSWORD_SCRIPT)}
${raw(joinCheckScript(env))}</script>`,
    error ? 400 : 200,
    Boolean(env.TURNSTILE_SITE_KEY),
  );
}

/** After Google or Discord: just a username, since they sign in with those. */
function joinUsernamePage(env: Env, next: string | null, band: AgeBand, error?: string, given: JoinGiven = {}): Response {
  return page(
    env,
    "Pick a username",
    html`<h1>Pick a username</h1>
${errorParagraph(error)}
<form class="stack" method="post" action="/join/username" id="join-form">
${nextField(next)}
${usernameField(given.username ?? "", USERNAME_HINT, given.suggestions ?? [])}
${joinSocialModeFields(band, given.socialMode)}
${joinCheck(env)}
<button class="btn" type="submit">Finish</button>
</form>
<p class="muted">By making an account you agree to the <a href="/legal/content-rules">content rules</a> and our <a href="/legal/privacy">privacy policy</a>.</p>
<script>${raw(USERNAME_SCRIPT)}
${raw(joinCheckScript(env))}</script>`,
    error ? 400 : 200,
    Boolean(env.TURNSTILE_SITE_KEY),
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
  read: ["Read", "See games, versions, stats, the database, saves and the forum. Changes nothing."],
  upload: ["Upload", "Upload new versions as drafts, without publishing them or posting. For CI."],
  publish: ["Publish", "Upload and publish versions, change game details and tester links, and post on the forum. Can't run SQL, change saves, or change sign-in apps and webhooks."],
  full: ["Full", "Everything. For your own AI tool."],
  custom: ["Custom", "Choose for each area."],
};

/** Each area on the custom step: its name, and what it covers. */
const AREA_LABELS: Record<AccessArea, [string, string]> = {
  game_access: ["Games", "Details, images, visibility and tester links. Write also makes new games."],
  version_access: ["Versions", "Uploading, publishing, scheduling and rolling back."],
  stats_access: ["Stats", "Stats, player reports and history."],
  database_access: ["Game databases", "Read-only sees tables and use, and exports. Write runs SQL and imports."],
  save_access: ["Players' saves", "Read-only reads saves and their copies. Write changes, resets and restores them."],
  forum_access: ["Developer forum", "Write posts, replies, votes and messages to Zaisma in your name."],
  sign_in_app_access: ["Sign-in apps", "Belong to your whole account, so only a key for all your games reaches them."],
  webhook_access: ["Webhooks", "Belong to your whole account, so only a key for all your games reaches them."],
};

const AREA_SHORT_LABELS: Record<AccessArea, string> = { game_access: "games", version_access: "versions", stats_access: "stats", database_access: "database", save_access: "saves", forum_access: "forum", sign_in_app_access: "sign-in apps", webhook_access: "webhooks" };

/** The common words for each choice, as GitHub's tokens say them. */
const CHOICE_LABELS: Record<string, string> = { none: "No access", read: "Read-only", write: "Read and write", upload: "Upload", publish: "Upload and publish" };

/** What a key can do and on which games, in a few words, for the list of keys. */
function keyScopeText(key: ApiKey, games: { slug: string; title: string }[]): string {
  const access = keyAccess(key);
  const titles = access.gameSlugs?.map((slug) => games.find((game) => game.slug === slug)?.title ?? slug);
  const where = titles ? (titles.length === 1 ? `only ${titles[0]}` : `only ${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`) : "all games";
  const what =
    access.accessLevel === "custom"
      ? `Custom: ${ACCESS_AREAS.filter((area) => access.areaAccess[area] !== "none")
          .map((area) => `${AREA_SHORT_LABELS[area]} ${CHOICE_LABELS[access.areaAccess[area]]!.toLowerCase()}`)
          .join(", ")}`
      : LEVEL_LABELS[access.accessLevel][0];
  return `${what}; ${where}`;
}

/**
 * Making a key: a button that opens a wizard. Its name and what it can do, then which games, then (for a
 * custom key) a choice per area. One form, so the steps only show and hide; the server checks it all again.
 */
function keyWizard(games: { slug: string; title: string }[]): Raw {
  return html`<button class="btn" type="button" id="key-new">Make an API key</button>
<dialog id="key-wizard" class="wizard bevel-l" aria-labelledby="key-wizard-title">
<form method="post" action="/account/keys#developer" id="key-form">
  <div class="wizard-head">
    <div><h2 id="key-wizard-title">New API key</h2><p class="wizard-sub" id="key-wizard-sub"></p></div>
    <button class="btn ghost wizard-x" type="button" data-close aria-label="Close">Close</button>
  </div>
  <div class="wizard-body">
    <section data-step="what" data-title="New API key" data-sub="Name it, and choose what it can do.">
      <label>Key name<input name="name" maxlength="40" placeholder="Like My laptop or GitHub Actions"></label>
      <fieldset class="choices"><legend>What it can do</legend>
${ACCESS_LEVELS.map(
    (level) => html`<label class="check"><input type="radio" name="access_level" value="${level}"${level === "full" ? raw(" checked") : ""}> <span>${LEVEL_LABELS[level][0]}<small class="hint">${LEVEL_LABELS[level][1]}</small></span></label>`,
  )}
      </fieldset>
    </section>
    <section data-step="games" data-title="Which games" data-sub="Choose the games it works on." hidden>
      <fieldset class="choices" aria-label="Which games">
        <label class="check"><input type="radio" name="game_scope" value="all" checked> <span>All my games<small class="hint">And games you make later.</small></span></label>
${games.length
    ? html`        <label class="check"><input type="radio" name="game_scope" value="some"> <span>Only these games<small class="hint">It can't make games, sign-in apps or webhooks.</small></span></label>
        <div class="choices" id="key-games">${games.map((game) => html`<label class="check"><input type="checkbox" name="game_slugs" value="${game.slug}"> <span>${game.title}</span></label>`)}</div>`
    : ""}
      </fieldset>
    </section>
    <section data-step="areas" data-title="What it can do" data-sub="Choose for each area." hidden>
${ACCESS_AREAS.map(
    (area) => html`      <fieldset class="area"><legend>${AREA_LABELS[area][0]}</legend><p class="hint">${AREA_LABELS[area][1]}</p>
        <div class="seg picks">${AREA_ACCESS_CHOICES[area].map((choice: string) => html`<label><input type="radio" name="${area}" value="${choice}"${choice === "read" ? raw(" checked") : ""}><span>${CHOICE_LABELS[choice]}</span></label>`)}</div>
      </fieldset>`,
  )}
    </section>
    <p class="error" id="key-wizard-error" role="alert" hidden></p>
  </div>
  <div class="wizard-foot row">
    <button class="btn ghost" type="button" id="key-back">Back</button>
    <button class="btn" type="button" id="key-next">Next</button>
    <button class="btn light" type="submit" id="key-make">Make the key</button>
  </div>
</form>
</dialog>
<script>
(() => {
  const dialog = document.getElementById("key-wizard");
  const form = document.getElementById("key-form");
  const steps = [...form.querySelectorAll("[data-step]")];
  const $ = (id) => document.getElementById(id);
  const games = $("key-games");
  let at = 0;
  // The areas step is only for a custom key.
  const path = () => steps.filter((step) => step.dataset.step !== "areas" || form.access_level.value === "custom");
  const isSome = () => form.game_scope.value === "some";
  function show() {
    const list = path();
    at = Math.min(at, list.length - 1);
    for (const step of steps) step.hidden = step !== list[at];
    $("key-wizard-title").textContent = list[at].dataset.title;
    $("key-wizard-sub").textContent = list[at].dataset.sub;
    $("key-back").hidden = at === 0;
    $("key-next").hidden = at === list.length - 1;
    $("key-make").hidden = at !== list.length - 1;
    $("key-wizard-error").hidden = true;
    if (games) games.hidden = !isSome();
    // Sign-in apps and webhooks belong to the whole account, out of reach of a key for some games.
    for (const area of ["sign_in_app_access", "webhook_access"]) {
      for (const input of form.querySelectorAll('input[name="' + area + '"]')) {
        input.disabled = isSome() && input.value !== "none";
        if (isSome() && input.value === "none") input.checked = true;
      }
    }
  }
  // Choosing some games needs at least one.
  function problem() {
    const step = path()[at].dataset.step;
    if (step === "games" && isSome() && !form.querySelector('input[name="game_slugs"]:checked')) return "Choose at least one game, or All my games.";
    return "";
  }
  function stop(message) {
    $("key-wizard-error").textContent = message;
    $("key-wizard-error").hidden = false;
  }
  $("key-new").onclick = () => { form.reset(); at = 0; show(); dialog.showModal(); };
  $("key-back").onclick = () => { at -= 1; show(); };
  $("key-next").onclick = () => { const said = problem(); if (said) return stop(said); at += 1; show(); };
  form.addEventListener("change", (event) => { if (event.target.name !== "name") show(); });
  form.addEventListener("submit", (event) => { const said = problem(); if (said) { event.preventDefault(); stop(said); } });
  for (const close of dialog.querySelectorAll("[data-close]")) close.onclick = () => dialog.close();
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
})();
</script>`;
}

const ICON_PASSKEY = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.9 3.1-7 7-7 1.2 0 2.4.3 3.4.9"/><circle cx="18" cy="13" r="2.5"/><path d="M18 15.5V21l1.5-1.2M18 18.5h1.5"/></svg>';

const BAND_TEXT: Record<AgeBand, string> = { "13-15": "13 to 15", "16-17": "16 or 17", "18+": "18 or over" };

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Notes the account page shows after a change, by the query it's sent back with. */
const SIGNING_IN_NOTES: Record<string, string> = {
  "password-saved": "Password saved. Sign in with it and your username from now on.",
  "email-saved": "Email added. If you forget your password, you can get back in with it.",
  "email-removed": "Email removed. Sign in with your username and password.",
  confirmed: "Thanks, that's you. For the next 10 minutes you can change how you sign in.",
};

/**
 * The window after Forgot your password (or an email code for an account with no password yet): pick a
 * password now, then go on to where they were headed. Not now goes there too.
 */
function newPasswordWindow(hasPassword: boolean, then: string | null, error?: string): Raw {
  return html`<dialog id="new-password" class="wizard short bevel-l" aria-labelledby="new-password-title">
<form method="post" action="/account/password">
  <input type="hidden" name="from" value="new-password">
  ${nextField(then)}
  <div class="wizard-head"><div><h2 id="new-password-title">${hasPassword ? "Set a new password" : "Add a password"}</h2><p class="wizard-sub">You're signed in. Pick a password to sign in with your username next time.</p></div></div>
  <div class="wizard-body stack">
    ${errorParagraph(error)}
    <label>New password<input type="password" name="password" minlength="${MINIMUM_PASSWORD_CHARACTER_COUNT}" autocomplete="new-password" required autofocus><span class="hint">${PASSWORD_HINT}</span></label>
    ${showPasswordToggle()}
  </div>
  <div class="wizard-foot row">
    ${then ? html`<a class="btn ghost" href="${then}">Not now</a>` : html`<button class="btn ghost" type="button" data-close>Not now</button>`}
    <button class="btn light" type="submit">Save password</button>
  </div>
</form>
</dialog>
<script>
(() => {
  const dialog = document.getElementById("new-password");
  dialog.showModal();
  for (const close of dialog.querySelectorAll("[data-close]")) close.onclick = () => dialog.close();
  ${raw(SHOW_PASSWORD_SCRIPT)}
})();
</script>`;
}

/** What the username form shows again when it comes back: what they typed, and free usernames. */
interface UsernameGiven {
  username: string;
  suggestions: string[];
}

async function accountPage(env: Env, session: Session, welcome: boolean, error?: string, made?: { name: string; token: string }, query = new URLSearchParams(), usernameGiven?: UsernameGiven): Promise<Response> {
  const account = (await accountById(env.DB, session.userId))!;
  const [games, keys, passkeys, signIns] = await Promise.all([gamesOwnedBy(env.DB, account.id), apiKeysFor(env.DB, account.id), passkeysFor(env.DB, account.id), signInGrantsFor(env.DB, account.id)]);
  // Changing how they sign in needs a recent sign-in; otherwise "Confirm it's you" first.
  const recent = Date.now() - session.signedInAtMs < RECENT_SIGNIN_MS;
  const email = realEmail(session.email);
  const hasPassword = account.password_changed_at_ms !== null;
  const signingInNote = Object.keys(SIGNING_IN_NOTES).find((key) => query.has(key));
  // Just back in after Forgot your password: a window asks for a new one straight away.
  const isAskingForPassword = query.has("new-password") && recent;
  return page(
    env,
    "Your account",
    html`${welcome ? html`<p class="note">Welcome to Zaisma, ${account.username}.</p>${raw(JOINED_SCRIPT)}` : ""}
<h1>${account.username}</h1>
${email ? html`<p class="lead">${email}</p>` : ""}
${isAskingForPassword ? newPasswordWindow(hasPassword, safeNext(query.get("next")), error) : errorParagraph(error)}
<h2 id="username">Username</h2>
${isUsernameRight(account.username) ? "" : html`<p class="note" role="status">Usernames are now ${USERNAME_RULES.toLowerCase().replace(/\.$/, "")}, and yours has something else in it. Pick a new one.</p>`}
${query.has("username-saved") ? html`<p class="note" role="status">Saved. Everyone sees your new username from now on.</p>` : ""}
<form class="stack" method="post" action="/account/username">
${usernameField(usernameGiven?.username ?? account.username, "Everyone sees it, and it's how friends find you.", usernameGiven?.suggestions ?? [], { isFocused: false, label: "" })}
<button class="btn ghost" type="submit">Save</button>
</form>
<script>${raw(USERNAME_SCRIPT)}</script>
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
<h2 id="signing-in">Signing in</h2>
${signingInNote ? html`<p class="note" role="status">${SIGNING_IN_NOTES[signingInNote]!}</p>` : ""}
${query.has("confirm-failed") ? html`<p class="error" role="alert">Couldn't send a code. Wait a minute and try again.</p>` : ""}
${recent
      ? ""
      : html`<div class="note" id="confirm"><p>${query.has("confirm-first") ? html`<strong>Confirm it's you first.</strong> ` : ""}To change your password, email or passkeys, confirm it's you.</p>
${hasPassword
          ? html`<form class="row" method="post" action="/account/confirm"><input type="password" name="password" autocomplete="current-password" required aria-label="Your password" placeholder="Your password"><button class="btn" type="submit">Confirm</button></form>`
          : html`<form method="post" action="/account/confirm"><button class="btn" type="submit">Email me a code</button></form>`}
</div>`}
<h3 class="sub">Password</h3>
<p>${hasPassword ? `Set on ${day(account.password_changed_at_ms!)}.` : "No password yet. Add one to sign in with your username."}</p>
${recent
      ? html`<form class="row" method="post" action="/account/password"><input type="password" name="password" minlength="${MINIMUM_PASSWORD_CHARACTER_COUNT}" autocomplete="new-password" required aria-label="New password" placeholder="New password"><button class="btn ghost" type="submit">${hasPassword ? "Change" : "Add"}</button></form>
<p class="hint">${PASSWORD_HINT}</p>`
      : ""}
<h3 class="sub">Email</h3>
<p>${email ? html`<strong>${email}</strong>. A way back in if you forget your password. Never shown to anyone.` : "No email. Add one to get back in if you forget your password. Never shown to anyone."}</p>
${recent
      ? html`<form class="row" method="post" action="/account/email"><input type="email" name="email" autocomplete="email" required aria-label="${email ? "New email" : "Email"}" placeholder="${email ? "New email" : "Email"}"><button class="btn ghost" type="submit">${email ? "Change" : "Add"}</button></form>
${email && hasPassword ? html`<form class="after-row" method="post" action="/account/email/remove"><button class="btn ghost" type="submit">Remove email</button></form>` : ""}`
      : ""}
<h3 class="sub" id="passkeys">Passkeys</h3>
<p>Sign in with Face ID, a fingerprint or your device's PIN instead of your password.</p>
${query.has("passkey-added") ? html`<p class="note" role="status"><strong>Passkey added.</strong> Next time, choose Sign in with a passkey.</p>` : ""}
${passkeys.length
      ? html`<ul class="keys">${passkeys.map(
          (passkey) => html`<li><span>Added on ${passkey.name} <span class="why muted small">${day(passkey.created_at_ms)}, ${passkey.last_used_at_ms ? `last used ${day(passkey.last_used_at_ms)}` : "not used yet"}</span></span>
<form method="post" action="/account/passkeys/${passkey.id}/remove"><button class="btn ghost" type="submit">Remove</button></form></li>`,
        )}</ul>`
      : ""}
${recent
      ? html`<div class="row" id="passkey-add-row"><button class="btn${passkeys.length ? " ghost" : ""}" type="button" id="passkey-add">Add a passkey</button></div>
<p class="error" role="alert" id="passkey-error" hidden></p>
<script>${raw(PASSKEY_SCRIPT)}
(() => {
  const row = document.getElementById("passkey-add-row");
  if (!window.PublicKeyCredential) {
    row.innerHTML = "<p class=muted>This browser can't use passkeys.</p>";
    return;
  }
  document.getElementById("passkey-add").onclick = async () => {
    const error = await zaismaAddPasskey();
    if (!error) return (location.href = "/account?passkey-added#passkeys");
    // The recent sign-in ran out while the page was open: confirm it's you first.
    if (error === "confirm") return (location.href = "/account?confirm-first#signing-in");
    const p = document.getElementById("passkey-error");
    p.textContent = error;
    p.hidden = false;
  };
})();
</script>`
      : ""}
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
${keyWizard(games)}
<h2>Sign out</h2>
<form method="post" action="/signout"><button class="btn ghost" type="submit">Sign out on every device</button></form>
<h2>Delete account</h2>
<details><summary>Delete your account</summary>
<p>This deletes your username, any email, game saves and everything else on your account straight away. It can't be undone.</p>
<form class="row" method="post" action="/account/delete">
<input name="confirm" placeholder='Type "delete"' aria-label='Type "delete" to confirm' autocomplete="off" required>
<button class="btn danger" type="submit">Delete my account</button>
</form>
</details>
<p class="muted small">Account ID: <code>${account.id}</code></p>`,
  );
}
