import {
  ACCESS_AREAS,
  ACCOUNT_AREAS,
  ACCESS_LEVELS,
  AREA_ACCESS_CHOICES,
  MAXIMUM_API_KEY_COUNT,
  keyStateOf,
  liveApiKeyCount,
  SECURITY_LOG_LIMITS,
  approvingPasskeys,
  checkKeyScope,
  keyAccess,
  type AccessArea,
  type AccessLevel,
  type ApiKey,
  type SignInKind,
  type AreaAccess,
  type KeyScope,
  SOCIAL_SETTINGS,
  SOCIAL_SETTING_CHOICES,
  USERNAME_RULES,
  accountById,
  accountByUsername,
  ageBand,
  ageBandOn,
  ageOn,
  birthDateText,
  apiKeysFor,
  b64url,
  changeUsername,
  checkUsername,
  createAccount,
  createApiKey,
  defaultSocialMode,
  accountDeletionReach,
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
  sameSocialSettings,
  signInGrantsFor,
  socialModeOf,
  socialModeSettings,
  socialModesFor,
  socialSettingsOf,
  socialStoppedNotice,
  socialSettingChoicesFor,
  suggestUsernames,
  updateAccount,
  setColorTheme,
  setStreamerMode,
  COLOR_THEMES,
  type ColorTheme,
  UsernameTakenError,
  type Account,
  type AgeBand,
  type SocialMode,
  type SocialSetting,
  type SocialSettings,
} from "@zaisma/core";
import {
  PROVIDERS,
  authConfigured,
  authUserEmail,
  authUserIdByEmail,
  clearSessionCookies,
  connectionAddressOf,
  createPasswordUser,
  currentSession,
  deleteAuthUser,
  endSessionsBefore,
  exchangeCode,
  isProvider,
  providerUrl,
  providersOn,
  readCookie,
  realEmail,
  downloadStartedCookie,
  refreshSession,
  removeEmail,
  sessionCookies,
  sessionForUser,
  setCookie,
  setEmail,
  setPassword,
  signInWithPassword,
  signOutEverywhere,
  signOutOthers,
  type PasswordSignIn,
  type Provider,
  type Session,
} from "./auth.ts";
import { protectAccountLine } from "./account-protection.ts";
import { clearWrongPasswordNotice, isDeviceMarked, isPasswordLockedOut, noteWrongPassword } from "./device-marks.ts";
import { checkEmailCode, sendEmailCode, waitEndsText } from "./email-codes.ts";
import type { Env } from "./env.ts";
import { deleteForumFiles } from "./forum-posts.ts";
import { deleteDueGames } from "./game-deletion.ts";
import { html, layout, message, metalButton, raw, scriptTags, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";
import { foundWords } from "./leaked-keys.ts";
import { emailAskBox, isEmailAskDue, markSecurityAlertsSeen, securityAlertsBox, skipEmailAsk } from "./security-alerts.ts";
import { activityAnswer, doneByText, eventTitle, logAccountChange, recordSignIn, seedKeyPlace, setWhereUsedFrom, whereText } from "./security-log.ts";
import { profilePath } from "./profiles.ts";
import { PASSKEY_ADD_SCRIPT, PASSKEY_CONFIRM_SCRIPT, PASSKEY_SCRIPT, PASSKEY_SIGN_IN_SCRIPT, checkPasskeyTap, keyRefusal, usedChallengeCookie, type PasskeyTap } from "./passkeys.ts";
import { MINIMUM_PASSWORD_CHARACTER_COUNT, PASSWORD_HINT, newPasswordProblem } from "./passwords.ts";
import { deleteSaveFiles } from "./saves.ts";
import { accountDataFileName, accountDataZip } from "./account-data.ts";
import { tellAccountDeleted, type WaitUntil } from "./webhooks.ts";
import { carryProof, confirmationOf, recordProof } from "./session-proofs.ts";
import { BOT_CHECK_SCRIPT, isRealBrowser, type TurnstileAction } from "./turnstile.ts";

/**
 * Sign-in, account creation and the account page.
 *
 * Making an account takes a birthday, a username and a password, nothing else (docs/DECISIONS.md).
 * The age question comes first, so we collect nothing from under-13s. We keep the band (13–15, 16–17 or
 * 18+), and the birth date only while the account is under 18, so the band moves up on the birthday by
 * itself; nobody changes it by hand, and no page says which band anyone is in. "Sign in" never creates
 * accounts, so it can't skip the question. 16 and over choose a social mode's preset while making the
 * account (friends-focused unless they pick another); 13–15 start solo-focused. Everyone changes their
 * social settings on the account page, within their band's limits.
 * Google and Discord work the same way, with a username and no password: someone new who comes back from
 * them without having answered the age question is forgotten straight away and sent to answer it first.
 *
 * Supabase checks passwords and makes sessions; an account without an email is known to it by a stand-in
 * address (auth.ts). An email and passkeys are optional ways back in. Changing how you sign in (password,
 * email, passkeys), and deleting the account, need a proof in the last 10 minutes by the strongest way the
 * account has, its passkey when it has one: "Confirm it's you" on the account page (session-proofs.ts). Making
 * an API key needs a passkey tap made for it. A new password signs out every other device.
 *
 * Accounts open only through Zaisma (docs/DECISIONS.md): email codes are Zaisma's own (email-codes.ts), and a
 * device that signed in to an account before always opens it with its password, while other devices pass the
 * invisible check and share 20 wrong passwords a day per account (device-marks.ts). Every sign-in marks the
 * device it happened on.
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
  "/account/social",
  "/account/streamer-mode",
  "/account/color-theme",
  "/account/confirm",
  "/account/password",
  "/account/email",
  "/account/email/code",
  "/account/email/remove",
  "/account/delete",
  "/account/data.zip",
  "/account/keys",
  "/account/where-used-from",
  "/account/security-alerts/seen",
  "/account/email-ask/skip",
  "/signout",
];

const SLOW_DOWN = "Too many tries. Wait a minute and try again.";
const BOT_CHECK_FAILED = "We couldn't check that you're using a real browser. Wait a few seconds and try again.";
const EMAIL_TAKEN = "That email can't be added. It may already be on another account.";
const LOCKED_OUT = "Too many wrong passwords were tried on this account today. Sign in on a device you've used before, or with your passkey or email.";
const CODE_DIDNT_WORK = "That code didn't work. Check it, or go back and get a new one.";
const takenText = (username: string) => `${username} is taken. Try another, or one of these.`;

export async function handleAccount(request: Request, env: Env, path: string, waitUntil?: WaitUntil): Promise<Response | null> {
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
  const connectionAddress = connectionAddressOf(request);
  // Cloudflare's invisible check on a form that has it (skipped where it isn't set up).
  const passesBotCheck = async (action: TurnstileAction) => !env.TURNSTILE_SECRET || (await isRealBrowser(env, field("turnstile_token", 2048), action));

  // Whether a username is free, as it's typed: on the join page, and the account page for the signed-in player.
  if (path === "/api/username-check") {
    const own = session ? await accountById(env.DB, session.userId) : null;
    const wanted = (new URL(request.url).searchParams.get("username") ?? "").slice(0, 40);
    return Response.json(await usernameAnswer(env, wanted, own), { headers: { "Cache-Control": "no-store" } });
  }

  // A session cookie that no longer works (signed out on every device, or a new password elsewhere): clear it, so the header stops saying signed in.
  if (path === "/signin" && !post) return session ? done(redirect(next ?? "/account")) : withCookies(await signinPage(env, next), readCookie(request, env, "zaisma") ? clearSessionCookies(env) : []);
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
    const signedIn = code && verifier && isProvider(provider) ? await exchangeCode(env, code.slice(0, 500), verifier, connectionAddress) : null;
    if (!signedIn) {
      const by = isProvider(provider) ? PROVIDERS[provider] : "That";
      const why = query.get("error") === "access_denied" ? `${by} sign-in was cancelled.` : `${by} sign-in didn't work. Try again, or use your username and password.`;
      return withCookies(await signinPage(env, back, why, 400), cookies);
    }
    if (isProvider(provider)) await recordProof(env, signedIn, provider);
    if (await accountById(env.DB, signedIn.userId)) return withCookies(redirect(back ?? "/"), [...cookies, ...sessionCookies(env, signedIn), await recordSignIn(request, env, signedIn.userId, provider as SignInKind)]);
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
    const email = login.includes("@") ? login.toLowerCase() : null;
    const userId = email ? await authUserIdByEmail(env, email) : null;
    if (userId === undefined) return message(env, "Couldn't sign you in", "Something went wrong on our side. Try again in a minute.", 502);
    const account = email ? (userId ? await accountById(env.DB, userId) : null) : await accountByUsername(env.DB, login.replace(/^@/, ""));
    const signedIn = await tryPassword(request, env, account, password, { turnstileToken: field("turnstile_token", 2048), knownEmail: email });
    if (signedIn === "too-many") return message(env, "Slow down", SLOW_DOWN, 429);
    if (signedIn === "locked") return await signinPage(env, next, LOCKED_OUT, 400, login);
    if (signedIn === "bot-check-failed") return await signinPage(env, next, BOT_CHECK_FAILED, 400, login);
    if (signedIn === "no-password") return await signinPage(env, next, "This account doesn't have a password yet. Use Forgot your password to get in with your email, then add one.", 400, login);
    if (signedIn === "wrong") return await signinPage(env, next, "That username and password don't match. Check them and try again.", 400, login);
    if (signedIn === "failed") return message(env, "Couldn't sign you in", "Something went wrong on our side. Try again in a minute.", 502);
    await recordProof(env, signedIn, "password");
    return withCookies(redirect(next ?? "/"), [...sessionCookies(env, signedIn), await recordSignIn(request, env, signedIn.userId, "password")]);
  }

  // --- Forgot your password: back in with a code to the account's email ---
  if (path === "/signin/email" && post) {
    if (await limited(env, request)) return message(env, "Slow down", SLOW_DOWN, 429);
    const email = field("email", 320).toLowerCase();
    if (!EMAIL.test(email)) return emailSigninPage(env, next, "Enter your email address.");
    if (!(await passesBotCheck("email_code"))) return emailSigninPage(env, next, BOT_CHECK_FAILED, email);
    // Only an address on an account gets a code; any other is answered the same, so the form doesn't say who has one.
    const userId = await authUserIdByEmail(env, email);
    const account = userId ? await accountById(env.DB, userId) : null;
    const sent = userId === undefined ? "failed" : await sendEmailCode(env, { email, accountId: account?.id ?? null, kind: "sign_in", reason: "sign_in" });
    if (sent === "too-many") return message(env, "Slow down", "We've sent a lot of codes to that address. Wait a few minutes and try again.", 429);
    if (sent === "failed") return message(env, "Couldn't send the code", "Something went wrong on our side. Try again in a minute.", 502);
    return codePage(env, email, next);
  }

  // A code from /signin/email, or from Confirm it's you on the account page.
  if (path === "/signin/code" && post) {
    if (await limited(env, request)) return message(env, "Slow down", SLOW_DOWN, 429);
    const email = field("email", 320).toLowerCase();
    const accountId = await checkEmailCode(env, email, field("code", 20).replace(/\D/g, ""), "sign_in");
    const kind = field("kind", 20) === "confirm" ? "confirm" : "signin";
    if (!accountId) return codePage(env, email, next, CODE_DIDNT_WORK, kind);
    const signedIn = await sessionForUser(env, accountId, connectionAddress);
    if (!signedIn) return message(env, "Couldn't sign you in", "Something went wrong on our side. Get a new code in a minute and try again.", 502);
    await recordProof(env, signedIn, "email_code");
    return withCookies(redirect(next ?? "/"), [...sessionCookies(env, signedIn), await recordSignIn(request, env, accountId, "email_code")]);
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
      // Under 18, the birth date goes with the join steps to the new account, which keeps it until 18.
      const birthDate = band === "18+" ? undefined : birthDateText({ yearNumber: Number(field("year")), monthNumber: Number(field("month")), dayNumber: Number(field("day")) });
      const cookie = setCookie(env, "zaisma_join", encodeURIComponent(JSON.stringify({ band, birth_date: birthDate })), { maximumAgeSec: JOIN_DURATION_SEC });
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
        await createAccount(env.DB, { id: made.userId, username: checked.username, ageBand: band, birthDate: joinBirthDate(request, env), socialMode, hasPassword: true });
      } catch (error) {
        if (!(error instanceof UsernameTakenError)) throw error;
        await deleteAuthUser(env, made.userId);
        return await again(takenText(checked.username), await suggestUsernames(env.DB, checked.username));
      }
      const signedIn = await signInWithPassword(env, made.email, password, connectionAddress);
      const cookies = [setCookie(env, "zaisma_join", "", { maximumAgeSec: 0 }), await recordSignIn(request, env, made.userId, "password", { isNewAccount: true })];
      if (typeof signedIn === "string") return withCookies(redirect(`/signin${nextQuery(next)}`), cookies);
      await recordProof(env, signedIn, "password");
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
        await createAccount(env.DB, { id: session.userId, username: checked.username, ageBand: band, birthDate: joinBirthDate(request, env), socialMode });
      } catch (error) {
        if (!(error instanceof UsernameTakenError)) throw error;
        return await again(takenText(checked.username), await suggestUsernames(env.DB, checked.username));
      }
      return withCookies(redirect(next ?? "/account?welcome"), [...session.cookies, setCookie(env, "zaisma_join", "", { maximumAgeSec: 0 }), await recordSignIn(request, env, session.userId, null, { isNewAccount: true })]);
    }
    return done(redirect("/join"));
  }

  // --- Signed in from here on ---
  if (!session) return redirect(`/signin${nextQuery(path === "/account" ? null : path === "/account/kept" ? safeNext(path + new URL(request.url).search) : next)}`);
  const account = await accountById(env.DB, session.userId);

  if (path === "/signout" && post) {
    // Other devices are out at once, not within the hour their access token has left.
    await endSessionsBefore(env, session.userId, Date.now());
    await signOutEverywhere(env, session.access, connectionAddress);
    return withCookies(redirect("/"), clearSessionCookies(env));
  }
  if (!account) return done(redirect("/join"));
  // Changing how they sign in, and deleting the account, need a proof in the last 10 minutes by the strongest way the account has, so a stolen session can't lock them out.
  const confirmation = await confirmationOf(env, session, account.id);

  if (path === "/account" && !post) {
    const query = new URL(request.url).searchParams;
    return done(await accountPage(env, session, query.has("welcome"), undefined, undefined, query));
  }
  if (path === "/account/kept" && !post) return done(await keptPage(env, account.username, new URL(request.url).searchParams.get("game")));

  // Download your data: everything about the account as one .zip, built while it downloads. A stolen session alone can't take it.
  if (path === "/account/data.zip" && !post) {
    if (!confirmation.isConfirmed) return done(redirect("/account?confirm-first#signing-in"));
    if (env.EXPORT_LIMIT && !(await env.EXPORT_LIMIT.limit({ key: account.id })).success) return done(message(env, "Wait a minute", "You started two downloads in the last minute. Wait a minute, then download your data again.", 429));
    await logAccountChange(request, env, account, "account_data_downloaded");
    const nowMs = Date.now();
    const download = new Response(accountDataZip(env, account, nowMs), {
      headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${accountDataFileName(account, nowMs)}"`, "cache-control": "no-store" },
    });
    // The button's page stops its spinner when this cookie appears (html.ts, data-download).
    download.headers.append("Set-Cookie", downloadStartedCookie(env));
    return done(download);
  }

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
    if (await limited(env, request)) return done(message(env, "Slow down", SLOW_DOWN, 429));
    // With a passkey that can approve, a password or code only lets them add a passkey, which waits a day.
    const back = next ?? (confirmation.isPasskeyNeeded ? "/account?confirmed-to-add#passkeys" : "/account?confirmed#signing-in");
    if (account.password_changed_at_ms !== null) {
      // Signed in already, so no invisible check; the limits on wrong passwords still hold.
      const signedIn = await tryPassword(request, env, account, passwordField(), { turnstileToken: null, knownEmail: null });
      if (signedIn === "wrong" || signedIn === "no-password") return done(await accountPage(env, session, false, "That password isn't right."));
      if (signedIn === "locked") return done(await accountPage(env, session, false, LOCKED_OUT));
      if (signedIn === "too-many" || signedIn === "bot-check-failed") return done(message(env, "Slow down", SLOW_DOWN, 429));
      if (signedIn === "failed") return done(message(env, "Couldn't check your password", "Something went wrong on our side. Try again in a minute.", 502));
      await recordProof(env, signedIn, "password");
      return withCookies(redirect(back), [...sessionCookies(env, signedIn), await recordSignIn(request, env, account.id, "password")]);
    }
    const email = realEmail(session.email);
    if (!email) return done(redirect("/account?confirm-failed#signing-in"));
    if (!(await passesBotCheck("email_code"))) return done(await accountPage(env, session, false, BOT_CHECK_FAILED));
    const sent = await sendEmailCode(env, { email, accountId: account.id, kind: "sign_in", reason: "confirm" });
    if (sent !== "sent") return done(redirect("/account?confirm-failed#signing-in"));
    return done(codePage(env, email, back, undefined, "confirm"));
  }

  if ((path === "/account/password" || path === "/account/email" || path === "/account/email/remove" || path === "/account/delete") && post && !confirmation.isConfirmed) return done(redirect("/account?confirm-first#signing-in"));

  if (path === "/account/password" && post) {
    const password = passwordField();
    const problem = await newPasswordProblem(password, account.username);
    // From the window after Forgot your password: it opens again, saying what's wrong.
    const again = field("from", 20) === "new-password" ? new URLSearchParams({ "new-password": "", ...(next ? { next } : {}) }) : undefined;
    if (problem) return done(await accountPage(env, session, false, problem, undefined, again));
    if (!(await setPassword(env, account.id, password))) return done(message(env, "Couldn't save your password", "Something went wrong on our side. Try again in a minute.", 502));
    await markPasswordChanged(env.DB, account.id);
    await logAccountChange(request, env, account, account.password_changed_at_ms === null ? "password_added" : "password_changed");
    // This device gets a session made with the new password, and every other device is signed out: Zaisma refuses
    // any session from before this one (the backstop), and Supabase is asked to sign the others out too.
    const fresh = await signInWithPassword(env, session.email, password, connectionAddress);
    const keyCount = (await apiKeysFor(env.DB, account.id)).length;
    // After a new password, the keys window (when there are keys) before going on to wherever they were headed.
    const where = keyCount ? `/account?password-saved&keys-check${next ? `&next=${encodeURIComponent(next)}` : ""}#developer` : (next ?? "/account?password-saved#signing-in");
    if (typeof fresh === "string") {
      // Couldn't make this device's new session: every device is signed out, this one too.
      await endSessionsBefore(env, account.id, Date.now());
      return withCookies(message(env, "Password saved", "Sign in again with your new password."), clearSessionCookies(env));
    }
    await endSessionsBefore(env, account.id, fresh.signedInAtMs);
    await signOutOthers(env, fresh.access, connectionAddress);
    await carryProof(env, session.sessionId, fresh);
    return withCookies(redirect(where), sessionCookies(env, fresh));
  }

  // An email: Zaisma sends its own code to the new address, and the secret key sets it once they type it.
  if (path === "/account/email" && post) {
    if (await limited(env, request)) return done(message(env, "Slow down", SLOW_DOWN, 429));
    const email = field("email", 320).toLowerCase();
    if (!EMAIL.test(email)) return done(await accountPage(env, session, false, "Enter an email address."));
    if (email === realEmail(session.email)?.toLowerCase()) return done(redirect("/account#signing-in"));
    if (!(await passesBotCheck("email_code"))) return done(await accountPage(env, session, false, BOT_CHECK_FAILED));
    const holder = await authUserIdByEmail(env, email);
    if (holder) return done(await accountPage(env, session, false, EMAIL_TAKEN));
    const sent = holder === undefined ? "failed" : await sendEmailCode(env, { email, accountId: account.id, kind: "add_email", reason: "add_email" });
    if (sent === "too-many") return done(message(env, "Slow down", "We've sent a lot of codes. Wait a few minutes and try again.", 429));
    if (sent === "failed") return done(message(env, "Couldn't send the code", "Something went wrong on our side. Try again in a minute.", 502));
    return done(codePage(env, email, null, undefined, "email"));
  }

  if (path === "/account/email/code" && post) {
    if (await limited(env, request)) return done(message(env, "Slow down", SLOW_DOWN, 429));
    const email = field("email", 320).toLowerCase();
    const codeAccountId = await checkEmailCode(env, email, field("code", 20).replace(/\D/g, ""), "add_email");
    if (codeAccountId !== account.id) return done(codePage(env, email, null, "That code didn't work. Check it, or go back and try again.", "email"));
    const isSet = await setEmail(env, account.id, email);
    if (isSet === "taken") return done(await accountPage(env, session, false, EMAIL_TAKEN));
    if (isSet === "failed") return done(message(env, "Couldn't add your email", "Something went wrong on our side. Try again in a minute.", 502));
    // The old address hears about it too.
    const oldEmail = realEmail(session.email);
    await logAccountChange(request, env, account, oldEmail ? "email_changed" : "email_added", { alert: { emails: oldEmail ? [oldEmail] : [] } });
    // A fresh session, so it says the new email.
    const fresh = await refreshSession(env, session.refresh, connectionAddress);
    return withCookies(redirect("/account?email-saved#signing-in"), fresh ? sessionCookies(env, fresh) : session.cookies);
  }

  // Taking the email off: only with a password, so they can still sign in.
  if (path === "/account/email/remove" && post) {
    if (account.password_changed_at_ms === null) return done(await accountPage(env, session, false, "Add a password first, so you can still sign in without your email."));
    if (!(await removeEmail(env, account.id))) return done(message(env, "Couldn't remove your email", "Something went wrong on our side. Try again in a minute.", 502));
    const removedEmail = realEmail(session.email);
    await logAccountChange(request, env, account, "email_removed", { alert: { emails: removedEmail ? [removedEmail] : [] } });
    const fresh = await refreshSession(env, session.refresh, connectionAddress);
    return withCookies(redirect("/account?email-removed#signing-in"), fresh ? sessionCookies(env, fresh) : session.cookies);
  }

  // Who can do what with them, within their band's limits. A preset chosen with no setting changed sets them
  // all (the page's script also fills them in); otherwise the settings as sent, which may match a preset or be Custom.
  if (path === "/account/social" && post) {
    const current = socialSettingsOf(account);
    const sent = Object.fromEntries(SOCIAL_SETTINGS.map((setting) => [setting, form?.has(setting) ? field(setting, 40) : current[setting]])) as unknown as SocialSettings;
    const socialMode = field("social_mode", 40);
    const choosable = isSocialMode(socialMode) && socialModesFor(account.age_band).includes(socialMode);
    if (socialMode !== "custom" && !choosable) return done(await accountPage(env, session, false, "Choose from the social settings shown."));
    const socialSettings = choosable && sameSocialSettings(sent, current) ? socialModeSettings(socialMode, account.age_band) : sent;
    if (!(await updateAccount(env.DB, account.id, { socialSettings }))) return done(await accountPage(env, session, false, account.social_stopped_at_ms ? socialStoppedNotice(account.social_stopped_reason) : "Choose from the social settings shown."));
    return done(redirect("/account?social-saved#social"));
  }

  // Light or dark for their pages: System follows the device.
  if (path === "/account/color-theme" && post) {
    const colorTheme = COLOR_THEMES.find((theme) => theme === field("color_theme", 10));
    if (!colorTheme) return done(message(env, "Pick a theme", "Pick System, Light or Dark.", 400));
    await setColorTheme(env.DB, account.id, colorTheme);
    return done(redirect("/account?theme-saved#theme"));
  }

  // Streamer mode: game pages hide room codes until the player shows them.
  if (path === "/account/streamer-mode" && post) {
    await setStreamerMode(env.DB, account.id, field("is_streamer_mode_on", 1) === "1");
    return done(redirect("/account?streamer-mode-saved#streamer-mode"));
  }

  // API keys for the developer MCP and upload command. The key is shown once, here.
  if (path === "/account/keys" && post) {
    const name = field("name", 40) || "My key";
    if ((await liveApiKeyCount(env.DB, account.id)) >= MAXIMUM_API_KEY_COUNT) return done(await accountPage(env, session, false, `You can have up to ${MAXIMUM_API_KEY_COUNT} keys. Remove one first.`));
    // Only the developer's own games can be chosen; anything else in the form is dropped.
    const ownSlugs = new Set((await gamesOwnedBy(env.DB, account.id)).map((game) => game.slug));
    const scope = keyScopeFromForm(form ?? new FormData(), ownSlugs);
    const problem = checkKeyScope(scope);
    if (problem) return done(await accountPage(env, session, false, problem));
    // A key lasts, so it needs a tap on a passkey made for this key (an honest page asks for it; this is the backstop).
    const passkey = await checkPasskeyTap(request, env, account.id, "key", passkeyTapFromForm(form ?? new FormData()));
    if (!passkey) return withCookies(await accountPage(env, session, false, keyRefusal(await passkeysFor(env.DB, account.id))), [...(session?.cookies ?? []), usedChallengeCookie(env)]);
    const { key, token } = await createApiKey(env.DB, account.id, name, scope);
    await recordProof(env, session, "passkey", passkey.id);
    await seedKeyPlace(request, env, account.id, key.id);
    await logAccountChange(request, env, account, "api_key_created", { subjectName: name });
    return withCookies(await accountPage(env, session, false, undefined, { name, token }), [...session.cookies, usedChallengeCookie(env)]);
  }
  const revoke = path.match(/^\/account\/keys\/([a-z0-9]+)\/revoke$/);
  if (revoke && post) {
    const removedKey = (await apiKeysFor(env.DB, account.id)).find((key) => key.id === revoke[1]);
    if (await revokeApiKey(env.DB, account.id, revoke[1]!)) await logAccountChange(request, env, account, removedKey?.kind === "connected_app" ? "connected_app_removed" : "api_key_removed", { subjectName: removedKey?.name ?? null });
    return done(redirect(safeNext(field("next", 2000)) ?? "/account#developer"));
  }

  // Security alerts no email told them about: That was me. And the email ask's Skip.
  if (path === "/account/security-alerts/seen" && post) {
    await markSecurityAlertsSeen(env, account.id);
    return done(redirect(field("next", 20) === "/dashboard" ? "/dashboard" : "/account"));
  }
  if (path === "/account/email-ask/skip" && post) {
    await skipEmailAsk(env, account.id);
    return done(redirect(field("next", 20) === "/dashboard" ? "/dashboard" : "/account"));
  }

  // Keep where the account is used from: turning it off wipes the device, network and place from what's logged, so it needs the same proof as changing the email (Confirm it's you).
  if (path === "/account/where-used-from" && post) {
    const isEnabled = field("where_used_from_enabled", 10) === "on";
    if (isEnabled === (account.where_used_from_enabled === 1)) return done(redirect("/account#activity"));
    if (!isEnabled && !confirmation.isConfirmed) return done(redirect("/account?confirm-first#signing-in"));
    await setWhereUsedFrom(request, env, account, isEnabled);
    return done(redirect(`/account?${isEnabled ? "where-on" : "where-off"}#activity`));
  }

  // Sign in with Zaisma: the player takes their yes to an app back.
  const signInApp = path.match(/^\/account\/sign-ins\/(sign_in_app_[a-z0-9]+)\/remove$/);
  if (signInApp && post) {
    await removeSignInGrant(env.DB, account.id, signInApp[1]!);
    return done(redirect("/account#sign-ins"));
  }

  if (path === "/account/delete" && post) {
    if (field("confirm").toLowerCase() !== "delete") return done(await accountPage(env, session, false, 'Type "delete" to confirm.'));
    // Who to tell is read first: deleting the account deletes the rows that say.
    const reach = await accountDeletionReach(env.DB, account.id);
    const ownedGameCount = (await gamesOwnedBy(env.DB, account.id)).length;
    if (!(await deleteAuthUser(env, session.userId))) return done(message(env, "Couldn't delete your account", "Something went wrong on our side. Try again later.", 502));
    await deleteSaveFiles(env, account.id);
    await deleteForumFiles(env, account.id);
    await deleteAccount(env.DB, account.id);
    await tellAccountDeleted(env, reach, waitUntil);
    // Its games are already down; their files, database and saves go now, or at the next run if there's a lot.
    if (waitUntil) waitUntil(deleteDueGames(env));
    else await deleteDueGames(env);
    return withCookies(
      message(
        env,
        "Your account is deleted",
        `Your username, any email, game saves and everything else on your account are gone.${ownedGameCount ? " Your games are deleted too, and their links never go to another game." : ""} Games you played and sites you signed in to with Zaisma were told, so their developers can erase what they kept about you. You can still play as a guest.`,
      ),
      clearSessionCookies(env),
    );
  }

  return done(redirect("/account"));
}

/** What a password try came to: a session, or why not. */
type PasswordTry = PasswordSignIn | "no-password" | "locked" | "bot-check-failed";

/**
 * A password for an account (docs/DECISIONS.md, "Accounts open only through Zaisma"). A device with the
 * account's mark always gets its try. Any other passes the invisible check (unless it's signed in already,
 * turnstileToken null) and gets none while the day's 20 wrong passwords from unmarked devices are used up.
 * 5 tries a minute per account hold everywhere. "no-password" for an account made with an email code, Google
 * or Discord that never added one; an unknown account is just "wrong", after the same checks, so nothing
 * says whether it exists.
 */
async function tryPassword(request: Request, env: Env, account: Account | null, password: string, options: { turnstileToken: string | null; knownEmail: string | null }): Promise<PasswordTry> {
  const isMarked = account ? await isDeviceMarked(request, env, account.id) : false;
  if (!isMarked) {
    if (account && (await isPasswordLockedOut(env, account.id))) return "locked";
    if (options.turnstileToken !== null && env.TURNSTILE_SECRET && !(await isRealBrowser(env, options.turnstileToken, "sign_in"))) return "bot-check-failed";
  }
  if (!account || !password) return "wrong";
  if (env.PASSWORD_LIMIT && !(await env.PASSWORD_LIMIT.limit({ key: account.id })).success) return "too-many";
  if (account.password_changed_at_ms === null) return "no-password";
  const email = options.knownEmail ?? (await authUserEmail(env, account.id));
  if (!email) return "failed";
  const signedIn = await signInWithPassword(env, email, password, connectionAddressOf(request));
  if (signedIn === "wrong") await noteWrongPassword(request, env, account.id, isMarked);
  return signedIn;
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

/** The birth date from the join steps' cookie: under 18 only, and only when it says the same band (the server worked both out from one answer). */
function joinBirthDate(request: Request, env: Env): string | undefined {
  try {
    const joinCookie = JSON.parse(decodeURIComponent(readCookie(request, env, "zaisma_join") ?? "")) as { band?: string; birth_date?: string };
    const isSameBand = isAgeBand(joinCookie.band) && joinCookie.band !== "18+" && typeof joinCookie.birth_date === "string" && ageBandOn(joinCookie.birth_date, new Date()) === joinCookie.band;
    return isSameBand ? joinCookie.birth_date : undefined;
  } catch {
    return undefined;
  }
}

/** The social mode picked while joining, when the band can choose it; otherwise the band's default. 13–15 never choose. */
function chosenSocialMode(band: AgeBand | null, given: unknown): SocialMode {
  if (!band) return "solo_focused";
  return band !== "13-15" && isSocialMode(given) && socialModesFor(band).includes(given) ? given : defaultSocialMode(band);
}

// --- Pages ---

const COLOR_THEME_LABELS: Record<ColorTheme, string> = { system: "System", light: "Light", dark: "Dark" };

function page(env: Env, title: string, body: Raw, httpStatus = 200, hasTurnstileCheck = false, account?: Account | null): Response {
  const response = layout(env, { title: `${title} · Zaisma`, body: html`<div class="narrow">${body}</div>${hasTurnstileCheck ? scriptTags(BOT_CHECK_SCRIPT) : ""}`, isPrivate: true, hasTurnstileCheck, viewer: account === undefined ? undefined : { account } });
  return new Response(response.body, { status: httpStatus, headers: response.headers });
}

const errorParagraph = (text?: string) => (text ? html`<p class="error" role="alert">${text}</p>` : "");
const nextField = (next: string | null) => (next ? html`<input type="hidden" name="next" value="${next}">` : "");

/** Show what's typed in a form's password boxes, for typing one on a phone. */
const showPasswordToggle = () => html`<label class="toggle"><input type="checkbox" data-show-password> Show password</label>`;
const SHOW_PASSWORD_SCRIPT = pageScript("show-password", `for (const box of document.querySelectorAll("[data-show-password]")) box.addEventListener("change", () => { for (const input of box.closest("form").querySelectorAll('input[name="password"]')) input.type = box.checked ? "text" : "password"; });`);

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

const USERNAME_SCRIPT = pageScript("username-check", `(() => {
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
})();`);

async function signinPage(env: Env, next: string | null, error?: string, httpStatus = 200, login = ""): Promise<Response> {
  const providers = await providersOn(env);
  return page(
    env,
    "Sign in",
    html`<h1>Sign in</h1>
${errorParagraph(error)}
<form class="stack" method="post" action="/signin" id="signin-form">
${nextField(next)}
<label>Username<input name="username" value="${login}" autocomplete="username webauthn" autocapitalize="off" autocorrect="off" spellcheck="false" required${login ? "" : raw(" autofocus")}></label>
<label>Password<input type="password" name="password" autocomplete="current-password" required${login ? raw(" autofocus") : ""}></label>
${showPasswordToggle()}
${botCheck(env, "sign_in")}
<button class="btn" type="submit">Sign in</button>
</form>
<p class="muted"><a href="/signin/email${nextQuery(next)}">Forgot your password?</a></p>
<div class="ways" id="ways"${providers.length ? "" : raw(" hidden")}>
<p class="or"><span>or</span></p>
<button class="btn ghost" type="button" id="passkey-go" data-next="${next ?? "/"}" data-autofill hidden>${raw(ICON_PASSKEY)}Sign in with a passkey</button>
${providerLinks(providers, next)}
<p class="error" role="alert" id="passkey-error" hidden></p>
</div>
<p class="muted">New here? <a href="/join${nextQuery(next)}">Make an account</a>. Most games play without one.</p>
${scriptTags(SHOW_PASSWORD_SCRIPT, PASSKEY_SCRIPT, PASSKEY_SIGN_IN_SCRIPT)}`,
    httpStatus,
    Boolean(env.TURNSTILE_SITE_KEY),
  );
}

/**
 * Forgot your password: a code to the account's email, or a passkey. After it, a window on the account
 * page asks for a new password, then goes on to wherever they were headed.
 */
function emailSigninPage(env: Env, next: string | null, error?: string, given = ""): Response {
  const back = `/account?new-password${next ? `&next=${encodeURIComponent(next)}` : ""}`;
  return page(
    env,
    "Forgot your password?",
    html`<h1>Forgot your password?</h1>
<p class="lead">Get back in with the email or a passkey on your account, then set a new password.</p>
${errorParagraph(error)}
<form class="stack" method="post" action="/signin/email" id="code-form">
${nextField(back)}
<label>Email<input type="email" name="email" value="${given}" autocomplete="email" required autofocus></label>
${botCheck(env, "email_code")}
<button class="btn" type="submit">Email me a code</button>
</form>
<div class="ways" id="ways" hidden>
<p class="or"><span>or</span></p>
<button class="btn ghost" type="button" id="passkey-go" data-next="${back}">${raw(ICON_PASSKEY)}Sign in with a passkey</button>
<p class="error" role="alert" id="passkey-error" hidden></p>
</div>
<p class="muted">Added neither? Then the account can't be recovered, but you can always <a href="/join">make a new one</a>.</p>
${scriptTags(PASSKEY_SCRIPT, PASSKEY_SIGN_IN_SCRIPT)}`,
    error ? 400 : 200,
    Boolean(env.TURNSTILE_SITE_KEY),
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
${kind === "confirm" ? html`<input type="hidden" name="kind" value="confirm">` : ""}
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
<p class="muted">Your birthday is never shown to anyone.</p>
<button class="btn" type="submit">Next</button>
</form>
<p class="muted">Have an account? <a href="/signin${nextQuery(next)}">Sign in</a>.</p>`,
  );
}

const SOCIAL_MODE_LABELS: Record<SocialMode, string> = { solo_focused: "Solo-focused", friends_focused: "Friends-focused", open_and_social: "Open and social" };

/**
 * What a preset does, in a line. It only ever says what the player gets, never what they don't or why:
 * nothing on the page hints at age groups or what opens up later, so there's nothing to lie about.
 */
function socialModeHint(socialMode: SocialMode, band: AgeBand): string {
  if (socialMode === "solo_focused") return "No chat. Friends can still join you and see what you play.";
  if (socialMode === "friends_focused") return "Chat, joining and what you play, with friends only.";
  return band === "18+" ? "Chat with anyone, take friend requests, and anyone can join you, see what you play and see your profile." : "Chat with anyone, take friend requests, and anyone can see your profile. Friends can join you and see what you play.";
}

/** The presets a band can pick, as radio buttons (only those: a preset the band can't have isn't shown at all); the account page adds Custom. */
function socialModeChoices(band: AgeBand, current: SocialMode | "custom", legend: string | null, withCustom = false): Raw {
  const radio = (choice: string, label: string, hint: string) =>
    html`<label class="check"><input type="radio" name="social_mode" value="${choice}"${choice === current ? raw(" checked") : ""}> <span>${label}<small class="hint">${hint}</small></span></label>`;
  return html`<fieldset class="choices"${legend ? "" : raw(' aria-label="Social settings"')}>${legend ? html`<legend>${legend}</legend>` : ""}
${socialModesFor(band).map((socialMode) => radio(socialMode, SOCIAL_MODE_LABELS[socialMode], socialModeHint(socialMode, band)))}
${withCustom ? radio("custom", "Custom", "Choose each one yourself.") : ""}
</fieldset>`;
}

/** Each preset as a new player picks it while joining (16 and over; 13–15 start solo-focused): a line in their own words. */
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

/** Each social setting on the account page: what it's called, and what it covers. */
const SOCIAL_SETTING_LABELS: Record<SocialSetting, [string, string]> = {
  who_can_chat: ["Who can chat with you", "Text and voice, in games that have chat."],
  who_can_join: ["Who can join you", "Jump into the game you're playing, from Zaisma."],
  who_sees_playing_now: ["Who sees what you're playing", "The game you're in right now."],
  who_sees_played_games: ["Who sees what you've played", "Games you played lately."],
  who_sees_online: ["Who sees you online", "When you have Zaisma open."],
  who_can_send_friend_requests: ["Friend requests", "Friends can always add you with an invite you give them."],
  who_sees_profile: ["Who sees your profile", "Your bio, links and the games you play. Your name and the games you've made always show."],
};

const SOCIAL_CHOICE_LABELS: Record<string, string> = { nobody: "Nobody", friends: "Friends", anyone: "Anyone" };

/**
 * The Social section: the presets, and under Custom every setting as choices side by side. Only the
 * choices the band has are there at all; a setting with just one isn't shown. Picking a preset fills
 * in its settings (the script), so Custom starts from the last one; the server works it out again.
 */
function socialSettingsForm(band: AgeBand, settings: SocialSettings): Raw {
  const presets = Object.fromEntries(socialModesFor(band).map((socialMode) => [socialMode, socialModeSettings(socialMode, band)]));
  return html`<form class="stack social" method="post" action="/account/social" id="social-form" data-presets="${JSON.stringify(presets)}">
${socialModeChoices(band, socialModeOf(settings, band), null, true)}
<div class="social-settings">
${SOCIAL_SETTINGS.map((setting) => {
    const choices = socialSettingChoicesFor(band, setting) as readonly string[];
    if (choices.length < 2) return "";
    return html`<fieldset class="area"><legend>${SOCIAL_SETTING_LABELS[setting][0]}</legend><p class="hint">${SOCIAL_SETTING_LABELS[setting][1]}</p>
<div class="seg picks">${choices.map(
      (choice) =>
        html`<label><input type="radio" name="${setting}" value="${choice}"${choice === settings[setting] ? raw(" checked") : ""}><span>${setting === "who_can_send_friend_requests" && choice === "nobody" ? "Invites only" : SOCIAL_CHOICE_LABELS[choice]}</span></label>`,
    )}</div>
</fieldset>`;
  })}
</div>
<button class="btn ghost" type="submit">Save</button>
</form>
${scriptTags(SOCIAL_SETTINGS_SCRIPT)}`;
}

// Picking a preset fills in its settings, from the form's data-presets.
const SOCIAL_SETTINGS_SCRIPT = pageScript("social-settings", `(() => {
  const form = document.getElementById("social-form");
  const presets = JSON.parse(form.dataset.presets);
  form.addEventListener("change", (event) => {
    const preset = event.target.name === "social_mode" && presets[event.target.value];
    if (!preset) return;
    for (const [setting, choice] of Object.entries(preset)) {
      const input = form.querySelector('input[name="' + setting + '"][value="' + choice + '"]');
      if (input) input.checked = true;
    }
  });
})();`);

const USERNAME_HINT = "Everyone sees it, and it's how friends find you. Don't use your real name.";

/** What a join form shows again when it comes back: what they typed (never the password), and free usernames. */
interface JoinGiven {
  username?: string;
  socialMode?: SocialMode;
  suggestions?: string[];
}

/**
 * Cloudflare's invisible check on a form, when it's set up: an empty box it can use, and its answer's
 * field. A page with one passes hasTurnstileCheck to page(), which brings the check's script.
 */
const botCheck = (env: Env, action: TurnstileAction) => (env.TURNSTILE_SITE_KEY ? html`<input type="hidden" name="turnstile_token"><div data-bot-check="${action}" data-site-key="${env.TURNSTILE_SITE_KEY}"></div>` : "");

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
${botCheck(env, "join")}
<button class="btn" type="submit">Make my account</button>
</form>
<p class="muted">By making an account you agree to the <a href="/legal/content-rules">content rules</a> and our <a href="/legal/privacy">privacy policy</a>.</p>
${scriptTags(USERNAME_SCRIPT, SHOW_PASSWORD_SCRIPT)}`,
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
${botCheck(env, "join")}
<button class="btn" type="submit">Finish</button>
</form>
<p class="muted">By making an account you agree to the <a href="/legal/content-rules">content rules</a> and our <a href="/legal/privacy">privacy policy</a>.</p>
${scriptTags(USERNAME_SCRIPT)}`,
    error ? 400 : 200,
    Boolean(env.TURNSTILE_SITE_KEY),
  );
}

function tooYoungPage(env: Env): Response {
  return page(
    env,
    "You can't make an account",
    html`<h1>You can't make an account</h1>
<p class="lead">You can still play as a guest in any game that doesn't need one.</p>
<a class="btn" href="/">Find a game</a>`,
  );
}

// Just signed in or joined: tell the game tab that opened this one, and bring this device's
// recently played games over to the account.
const JOINED_SCRIPT = pageScript("joined", `(()=>{try{new BroadcastChannel("zaisma").postMessage("signed-in")}catch{}
let p=[];try{p=JSON.parse(localStorage.getItem("zaisma:played")||"[]")}catch{}
if(p.length)fetch("/api/me/played",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({played:p.slice(0,20).map(g=>({slug:g.slug,played_at_ms:g.played_at_ms??g.at}))})}).catch(()=>{})})();`);

// This tab was opened by the game: go back to it, so it keeps running where the player left off.
const KEPT_SCRIPT = pageScript("kept", `document.querySelector("[data-back]").addEventListener("click", (e) => {
  if (!window.opener || window.opener.closed) return;
  e.preventDefault();
  const href = e.currentTarget.href;
  try { window.opener.focus(); } catch {}
  window.close();
  // Some browsers won't close it: then just go to the game here.
  setTimeout(() => (location.href = href), 300);
});`);

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
${scriptTags(JOINED_SCRIPT, KEPT_SCRIPT)}`,
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
  game_access: ["Games", "Details, images, visibility, tester links and secrets. Write also makes new games."],
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
/**
 * One key in a list: its name and what it can do, then how it stands. A key that works says when it was made,
 * last used (with what and from where, when the account keeps that) and its end date; one Zaisma turned off says
 * where it was found; one past its end date says so. The buttons are the list's own.
 */
function keyRow(key: ApiKey, games: { slug: string; title: string }[], buttons: Raw): Raw {
  const state = keyStateOf(key);
  let standing: string;
  if (state === "turned_off") standing = `Turned off ${day(key.turned_off_at_ms!)}: ${foundWords(key)}. Make a new key and remove this one.`;
  else if (state === "ended") standing = `Ended ${day(key.ends_at_ms!)}. Make a new key and remove this one.`;
  else {
    const place = whereText({ device: null, network_name: key.last_used_network_name, city_name: key.last_used_city_name, region_name: key.last_used_region_name, country_code: key.last_used_country_code });
    const lastUsed = key.last_used_at_ms ? `last used ${day(key.last_used_at_ms)}${key.last_used_device ? ` with ${key.last_used_device}` : ""}${place ? ` · ${place}` : ""}` : "not used yet";
    standing = `${key.kind === "connected_app" ? "Connected" : "Made"} ${day(key.created_at_ms)} · ${lastUsed}${key.ends_at_ms ? ` · ends ${day(key.ends_at_ms)}` : ""}`;
  }
  // A connected app (an AI app that signed in, mcp-sign-in.ts) is listed with the keys, saying where it sends you back.
  const kindNote = key.kind === "connected_app" ? html` <span class="muted small">connected app · ${key.connected_app_host ?? ""}</span>` : "";
  return html`<li${state === "on" ? "" : raw(' class="off"')}><span><span class="key-name">${key.name}</span>${kindNote} <span class="why muted small">${keyScopeText(key, games)}</span><span class="why muted small">${standing}</span></span>
${buttons}</li>`;
}

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
 * What a key or a connected app can do: its end date and level (with the key's name, when there is one), which
 * games, and a choice per area for custom. The key wizard steps through these sections; the connect page
 * (mcp-sign-in.ts) shows them in place behind Change. ACCESS_CHOICES_SCRIPT runs them; the server checks it all again.
 */
export function accessChoices(games: { slug: string; title: string }[], nameField: Raw | null): Raw {
  return html`    <section data-step="what" data-title="New API key" data-sub="Name it, and choose what it can do.">
${nameField ?? ""}      <label>Ends<select name="ends_after_days"><option value="" selected>Never</option><option value="7">In 7 days</option><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="365">In a year</option></select></label>
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
        <div class="choices" data-access-games>${games.map((game) => html`<label class="check"><input type="checkbox" name="game_slugs" value="${game.slug}"> <span>${game.title}</span></label>`)}</div>`
    : ""}
      </fieldset>
    </section>
    <section data-step="areas" data-title="What it can do" data-sub="Choose for each area." hidden>
${ACCESS_AREAS.map(
    (area) => html`      <fieldset class="area"><legend>${AREA_LABELS[area][0]}</legend><p class="hint">${AREA_LABELS[area][1]}</p>
        <div class="seg picks">${AREA_ACCESS_CHOICES[area].map((choice: string) => html`<label><input type="radio" name="${area}" value="${choice}"${choice === "read" ? raw(" checked") : ""}><span>${CHOICE_LABELS[choice]}</span></label>`)}</div>
      </fieldset>`,
  )}
    </section>`;
}

/** The passkey's hidden fields a form sends its tap in (ACCESS_CHOICES_SCRIPT's zaismaFillTap fills them). */
export const PASSKEY_TAP_FIELDS = raw('<input type="hidden" name="passkey_id"><input type="hidden" name="client_data_json"><input type="hidden" name="authenticator_data"><input type="hidden" name="signature"><input type="hidden" name="user_handle">');

/** The step before anything that needs a passkey: add one (#passkey-first), or wait for the new one. */
export function passkeyStep(passkeyState: PasskeyState, approvesFromAtMs: number | null, words: { title: string; sub: string; waitingFor: string }): Raw {
  if (passkeyState === "ready") return raw("");
  return html`    <section data-step="passkey" data-title="${words.title}" data-sub="${words.sub}" hidden>
${passkeyState === "waiting" && approvesFromAtMs !== null
    ? html`      <p>Your new passkey can ${words.waitingFor} from ${waitEndsText(approvesFromAtMs)}.</p>`
    : html`      <button class="btn" type="button" id="passkey-first">Add a passkey</button>`}
    </section>`;
}

/**
 * The developer's own games and whether the account has a passkey that can approve a key, for the pages that make
 * keys and connect apps.
 */
export async function keyMakingState(env: Env, accountId: string): Promise<{ games: { slug: string; title: string }[]; passkeyState: PasskeyState; approvesFromAtMs: number | null }> {
  const [games, passkeys] = await Promise.all([gamesOwnedBy(env.DB, accountId), passkeysFor(env.DB, accountId)]);
  const nowMs = Date.now();
  const approving = approvingPasskeys(passkeys, nowMs);
  const waitingPasskeys = passkeys.filter((passkey) => passkey.approves_from_at_ms > nowMs);
  return {
    games: games.map((game) => ({ slug: game.slug, title: game.title })),
    passkeyState: approving.length ? "ready" : passkeys.length ? "waiting" : "none",
    approvesFromAtMs: waitingPasskeys.length && !approving.length ? Math.min(...waitingPasskeys.map((passkey) => passkey.approves_from_at_ms)) : null,
  };
}

/**
 * What a key or connected app may do, from the choices' form fields. Only the developer's own games can be chosen;
 * anything else is dropped. Access for some games never reaches the account's own areas. Check it with checkKeyScope.
 */
export function keyScopeFromForm(form: FormData, ownSlugs: Set<string>): KeyScope {
  const field = (name: string, maximumCharacterCount: number) => String(form.get(name) ?? "").trim().slice(0, maximumCharacterCount);
  const accessLevel = field("access_level", 20) as AccessLevel;
  const endsAfterDays = field("ends_after_days", 10);
  const scope: KeyScope = {
    accessLevel,
    endsAfterDays: endsAfterDays === "" ? null : Number(endsAfterDays),
    gameSlugs: field("game_scope", 10) === "some" ? [...new Set(form.getAll("game_slugs").map(String))].filter((slug) => ownSlugs.has(slug)) : null,
    ...(accessLevel === "custom" ? { areaAccess: Object.fromEntries(ACCESS_AREAS.map((area) => [area, field(area, 20)])) as AreaAccess } : {}),
  };
  if (scope.gameSlugs && scope.areaAccess) for (const area of ACCOUNT_AREAS) (scope.areaAccess as Record<AccessArea, string>)[area] = "none";
  return scope;
}

/** The tap a form sent, as checkPasskeyTap takes it. */
export function passkeyTapFromForm(form: FormData): PasskeyTap {
  const field = (name: string, maximumCharacterCount: number) => String(form.get(name) ?? "").trim().slice(0, maximumCharacterCount);
  return {
    id: field("passkey_id", 400),
    clientDataJSON: field("client_data_json", 20000),
    authenticatorData: field("authenticator_data", 20000),
    signature: field("signature", 20000),
    userHandle: field("user_handle", 400),
  };
}

/**
 * Making a key: a button that opens a wizard. Its name and what it can do, then which games, then (for a
 * custom key) a choice per area. One form, so the steps only show and hide; the server checks it all again.
 */
function keyWizard(games: { slug: string; title: string }[], passkeyState: PasskeyState, approvesFromAtMs: number | null, isOpenOnLoad: boolean): Raw {
  return html`<button class="btn" type="button" id="key-new" data-passkey-state="${passkeyState}"${isOpenOnLoad ? raw(" data-open") : ""}>Make an API key</button>
<dialog id="key-wizard" class="wizard${passkeyState === "ready" ? "" : " short"} bevel-l" aria-labelledby="key-wizard-title">
<form method="post" action="/account/keys#developer" id="key-form">
  <div class="wizard-head">
    <div><h2 id="key-wizard-title">New API key</h2><p class="wizard-sub" id="key-wizard-sub"></p></div>
    <button class="btn ghost wizard-x" type="button" data-close aria-label="Close">Close</button>
  </div>
  ${PASSKEY_TAP_FIELDS}
  <div class="wizard-body">
${passkeyStep(passkeyState, approvesFromAtMs, { title: "First, add a passkey", sub: "Making a key needs your passkey, so someone who learns your password can't make one. After this, each key is a tap.", waitingFor: "make keys" })}
${accessChoices(games, html`      <label>Key name<input name="name" maxlength="40" placeholder="Like My laptop or GitHub Actions"></label>
`)}
    <p class="error" id="key-wizard-error" role="alert" hidden></p>
  </div>
  <div class="wizard-foot row">
    <button class="btn ghost" type="button" id="key-back">Back</button>
    <button class="btn" type="button" id="key-next">Next</button>
    <button class="btn light" type="submit" id="key-make">Make the key</button>
  </div>
</form>
</dialog>
${scriptTags(ACCESS_CHOICES_SCRIPT, KEY_WIZARD_SCRIPT)}`;
}

/** Whether the account can make a key now: with a passkey that approves, only waiting ones, or none. */
export type PasskeyState = "none" | "waiting" | "ready";

/**
 * The browser side of accessChoices, for the key wizard and the connect page (after PASSKEY_SCRIPT):
 * zaismaAccessChoices(form) keeps the games list and the account's own areas in step and says what's missing;
 * zaismaPasskeyFirst(go) wires #passkey-first; zaismaFillTap(form, tap) puts a tap in PASSKEY_TAP_FIELDS.
 */
export const ACCESS_CHOICES_SCRIPT = pageScript("access-choices", `
function zaismaAccessChoices(form) {
  const games = form.querySelector("[data-access-games]");
  const isSome = () => form.game_scope.value === "some";
  function sync() {
    if (games) games.hidden = !isSome();
    // Sign-in apps and webhooks belong to the whole account, out of reach of access for some games.
    for (const area of ["sign_in_app_access", "webhook_access"]) {
      for (const input of form.querySelectorAll('input[name="' + area + '"]')) {
        input.disabled = isSome() && input.value !== "none";
        if (isSome() && input.value === "none") input.checked = true;
      }
    }
  }
  // Choosing some games needs at least one.
  const gamesProblem = () => (isSome() && !form.querySelector('input[name="game_slugs"]:checked') ? "Choose at least one game, or All my games." : "");
  return { sync, gamesProblem, isSome, isCustom: () => form.access_level.value === "custom" };
}
// Add a passkey, then go where go says for each outcome: added (it can approve at once), confirm (the proof ran out) or waiting (a day).
function zaismaPasskeyFirst(go, stop) {
  const button = document.getElementById("passkey-first");
  if (!button) return;
  button.onclick = async () => {
    const error = await zaismaAddPasskey();
    if (!error) return (location.href = go.added);
    if (error === "confirm") return (location.href = "/account?confirm-first#signing-in");
    if (error === "waiting") return (location.href = go.waiting);
    stop(error);
  };
}
function zaismaFillTap(form, tap) {
  form.passkey_id.value = tap.passkey_id;
  form.client_data_json.value = tap.client_data_json;
  form.authenticator_data.value = tap.authenticator_data;
  form.signature.value = tap.signature;
  form.user_handle.value = tap.user_handle;
}
`);

// The new key's steps: what it's called, which games, what it can do (and each area, for a custom key).
// Without a passkey that can approve, the one step is adding a passkey (or waiting for the new one); a key is made with a tap on one.
const KEY_WIZARD_SCRIPT = pageScript("key-wizard", `(() => {
  const dialog = document.getElementById("key-wizard");
  const form = document.getElementById("key-form");
  const steps = [...form.querySelectorAll("[data-step]")];
  const $ = (id) => document.getElementById(id);
  const choices = zaismaAccessChoices(form);
  let at = 0;
  const state = $("key-new").dataset.passkeyState;
  // The areas step is only for a custom key.
  const path = () => (state === "ready" ? steps.filter((step) => step.dataset.step !== "passkey" && (step.dataset.step !== "areas" || choices.isCustom())) : steps.filter((step) => step.dataset.step === "passkey"));
  function show() {
    const list = path();
    at = Math.min(at, list.length - 1);
    for (const step of steps) step.hidden = step !== list[at];
    $("key-wizard-title").textContent = list[at].dataset.title;
    $("key-wizard-sub").textContent = list[at].dataset.sub;
    const isPasskeyStep = state !== "ready";
    $("key-back").hidden = isPasskeyStep || at === 0;
    $("key-next").hidden = isPasskeyStep || at === list.length - 1;
    $("key-make").hidden = isPasskeyStep || at !== list.length - 1;
    form.querySelector(".wizard-foot").hidden = isPasskeyStep;
    $("key-wizard-error").hidden = true;
    choices.sync();
  }
  function problem() {
    return path()[at].dataset.step === "games" ? choices.gamesProblem() : "";
  }
  function stop(message) {
    $("key-wizard-error").textContent = message;
    $("key-wizard-error").hidden = false;
  }
  const open = () => { form.reset(); at = 0; show(); dialog.showModal(); };
  $("key-new").onclick = open;
  if ($("key-new").hasAttribute("data-open")) open();
  // Added with nothing older to approve: it can make keys at once. The page comes back with the wizard open.
  zaismaPasskeyFirst({ added: "/account?passkey-added&make-key#developer", waiting: "/account?passkey-waiting#passkeys" }, stop);
  $("key-back").onclick = () => { at -= 1; show(); };
  $("key-next").onclick = () => { const said = problem(); if (said) return stop(said); at += 1; show(); };
  form.addEventListener("change", (event) => { if (event.target.name !== "name") show(); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const said = problem();
    if (said) return stop(said);
    if (state !== "ready") return;
    // The tap is made for this key, once; the server checks it.
    const tapped = await zaismaPasskeyTap("key");
    if (tapped.error) return stop(tapped.error);
    zaismaFillTap(form, tapped.tap);
    form.submit();
  });
  for (const close of dialog.querySelectorAll("[data-close]")) close.onclick = () => dialog.close();
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
})();`);

const ICON_PASSKEY = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.9 3.1-7 7-7 1.2 0 2.4.3 3.4.9"/><circle cx="18" cy="13" r="2.5"/><path d="M18 15.5V21l1.5-1.2M18 18.5h1.5"/></svg>';

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Notes the account page shows after a change, by the query it's sent back with. */
const SIGNING_IN_NOTES: Record<string, string> = {
  "password-saved": "Password saved, and every other device is signed out. Sign in with it and your username from now on.",
  "email-saved": "Email added. If you forget your password, you can get back in with it.",
  "email-removed": "Email removed. Sign in with your username and password.",
  confirmed: "Thanks, that's you. For the next 10 minutes you can change how you sign in.",
  "not-you": "Don't recognize something in your activity? Change your password here.",
};

/** Notes that belong to the Passkeys section, so they're shown there and not under Signing in. */
const PASSKEY_NOTE_KEYS = ["confirmed-to-add", "passkey-waiting"];

/** The window after a new password: the account's API keys keep working, so each can be turned off. */
function keysCheckWindow(keys: ApiKey[], games: { slug: string; title: string }[], then: string | null): Raw {
  const back = `/account?keys-check${then ? `&next=${encodeURIComponent(then)}` : ""}#developer`;
  return html`<dialog id="keys-check" class="wizard short bevel-l" aria-labelledby="keys-check-title">
  <div class="wizard-head"><div><h2 id="keys-check-title">Check your API keys</h2><p class="wizard-sub">Your other devices are signed out, but API keys keep working. Turn off any you don't know.</p></div></div>
  <div class="wizard-body">
    ${keys.length
      ? html`<ul class="keys">${keys.map((key) => keyRow(key, games, html`<form method="post" action="/account/keys/${key.id}/revoke">${nextField(back)}<button class="btn ghost" type="submit">Turn off</button></form>`))}</ul>`
      : html`<p>No API keys left.</p>`}
  </div>
  <div class="wizard-foot row">
    ${then ? html`<a class="btn light" href="${then}">Done</a>` : html`<button class="btn light" type="button" data-close>Done</button>`}
  </div>
</dialog>
${scriptTags(KEYS_CHECK_SCRIPT)}`;
}

const KEYS_CHECK_SCRIPT = pageScript("keys-check", `(() => {
  const dialog = document.getElementById("keys-check");
  dialog.showModal();
  for (const close of dialog.querySelectorAll("[data-close]")) close.onclick = () => dialog.close();
})();`);

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
${scriptTags(NEW_PASSWORD_SCRIPT, SHOW_PASSWORD_SCRIPT)}`;
}

const NEW_PASSWORD_SCRIPT = pageScript("new-password", `(() => {
  const dialog = document.getElementById("new-password");
  dialog.showModal();
  for (const close of dialog.querySelectorAll("[data-close]")) close.onclick = () => dialog.close();
})();`);

/**
 * After someone tried enough wrong passwords to lock new devices out, or cost a device its mark, the owner's
 * account page says so once, with the ways back in a new device can use when the account has neither.
 */
function wrongPasswordNotice(noticeAtMs: number, hasNoOtherWayIn: boolean): Raw {
  const when = Date.now() - noticeAtMs < 86400_000 ? "today" : `on ${new Date(noticeAtMs).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}`;
  return html`<div class="note" role="status" id="wrong-passwords"><p>Someone tried wrong passwords on your account ${when}. Nothing got in.</p>
${hasNoOtherWayIn ? html`<div class="row"><a class="btn ghost" href="#passkeys">Add a passkey</a> <a class="btn ghost" href="#email">Add an email</a></div>` : ""}</div>`;
}

type ActivityEvents = Awaited<ReturnType<typeof activityAnswer>>;

/** The account's Activity: what happened in the last 90 days, who did it and from where, and the setting for keeping where. */
function activitySection(activity: ActivityEvents, query: URLSearchParams): Raw {
  const event = (each: ActivityEvents["events"][number]) => {
    const where = whereText(each);
    const by = doneByText(each);
    return html`<li><span>${eventTitle(each)} <span class="why muted small">${day(Date.parse(each.happened_at))}${by === "You" ? "" : ` · ${by}`}${where ? ` · ${where}` : ""}${each.security_alert_status === "emailed" ? " · Emailed" : ""}${each.done_by === "zaisma" ? "" : html` · <a href="/account?not-you#signing-in">Not you?</a>`}</span></span></li>`;
  };
  const shown = activity.events.slice(0, SECURITY_LOG_LIMITS.accountPageEventCount);
  const earlier = activity.events.slice(SECURITY_LOG_LIMITS.accountPageEventCount);
  return html`<h2 id="activity">Activity</h2>
${query.has("where-off") ? html`<p class="note" role="status">Saved. Your activity shows only what happened and when from now on.</p>` : ""}
${query.has("where-on") ? html`<p class="note" role="status">Saved. Your activity shows where each thing came from again, from now on.</p>` : ""}
${shown.length ? html`<ul class="keys">${shown.map(event)}</ul>` : html`<p class="muted">Nothing in the last 90 days.</p>`}
${earlier.length ? html`<details><summary>Earlier</summary><ul class="keys">${earlier.map(event)}</ul></details>` : ""}
<form class="stack" method="post" action="/account/where-used-from">
<div class="choices">
<label class="check"><input type="checkbox" name="where_used_from_enabled" value="on"${activity.where_used_from_enabled ? raw(" checked") : ""}> <span>Keep where my account is used from<small class="hint">Shows the device, network and rough place of each sign-in and change. Off, we keep only what happened and when. Uploads keep their connection address for 90 days either way.</small></span></label>
</div>
<div class="row"><button class="btn ghost" type="submit">Save</button></div>
</form>`;
}

/** What the username form shows again when it comes back: what they typed, and free usernames. */
interface UsernameGiven {
  username: string;
  suggestions: string[];
}

async function accountPage(env: Env, session: Session, welcome: boolean, error?: string, made?: { name: string; token: string }, query = new URLSearchParams(), usernameGiven?: UsernameGiven): Promise<Response> {
  const account = (await accountById(env.DB, session.userId))!;
  const [games, keys, passkeys, signIns, activity] = await Promise.all([
    gamesOwnedBy(env.DB, account.id),
    apiKeysFor(env.DB, account.id),
    passkeysFor(env.DB, account.id),
    signInGrantsFor(env.DB, account.id),
    activityAnswer(env, account, null),
  ]);
  // Changing how they sign in, and deleting the account, need the strongest proof the account has; otherwise "Confirm it's you" first.
  const { isProven, isConfirmed, isPasskeyNeeded } = await confirmationOf(env, session, account.id);
  const nowMs = Date.now();
  const approving = approvingPasskeys(passkeys, nowMs);
  const waitingPasskeys = passkeys.filter((passkey) => passkey.approves_from_at_ms > nowMs);
  const passkeyState: PasskeyState = approving.length ? "ready" : passkeys.length ? "waiting" : "none";
  const email = realEmail(session.email);
  const isAskingForEmail = await isEmailAskDue(env, account, email);
  const hasPassword = account.password_changed_at_ms !== null;
  const signingInNote = Object.keys(SIGNING_IN_NOTES).find((key) => query.has(key) && !PASSKEY_NOTE_KEYS.includes(key));
  // Just back in after Forgot your password: a window asks for a new one straight away.
  const isAskingForPassword = query.has("new-password") && isConfirmed;
  // Someone tried enough wrong passwords to lock new devices out, or cost a device its mark: said once.
  const noticeAtMs = account.wrong_password_notice_at_ms;
  if (noticeAtMs !== null) await clearWrongPasswordNotice(env, account.id, noticeAtMs);
  // The invisible check runs on asking for an email code: Confirm it's you without a password, or adding an email.
  const hasCodeForm = Boolean(env.TURNSTILE_SITE_KEY) && (isConfirmed || !hasPassword);
  // Adding a way in waits for Confirm it's you, which is above: say so where the add would be.
  const confirmToAdd = html`<p class="muted small"><a href="#confirm">Confirm it's you</a> above to add one.</p>`;
  const confirmWithOldWays = html`${hasPassword
    ? html`<form class="row" method="post" action="/account/confirm"><input type="password" name="password" autocomplete="current-password" required aria-label="Your password" placeholder="Your password"><button class="btn" type="submit">Confirm</button></form>`
    : html`<form method="post" action="/account/confirm" id="confirm-form">${botCheck(env, "email_code")}<button class="btn" type="submit">Email me a code</button></form>`}`;
  return page(
    env,
    "Your account",
    html`${welcome ? html`<p class="note">Welcome to Zaisma, ${account.username}.</p>${scriptTags(JOINED_SCRIPT)}` : ""}
<h1>${account.username}</h1>
${email ? html`<p class="lead">${email}</p>` : ""}
<p><a class="btn ghost" href="${profilePath(account.username)}">Your profile</a></p>
${securityAlertsBox(activity.unseen_security_alerts, "/account")}
${isAskingForEmail ? emailAskBox({ isConfirmed, backTo: "/account" }) : ""}
${noticeAtMs !== null ? wrongPasswordNotice(noticeAtMs, !email && !passkeys.length) : ""}
${isAskingForPassword ? newPasswordWindow(hasPassword, safeNext(query.get("next")), error) : errorParagraph(error)}
${query.has("keys-check") ? keysCheckWindow(keys, games, safeNext(query.get("next"))) : ""}
<h2 id="username">Username</h2>
${isUsernameRight(account.username) ? "" : html`<p class="note" role="status">Usernames are now ${USERNAME_RULES.toLowerCase().replace(/\.$/, "")}, and yours has something else in it. Pick a new one.</p>`}
${query.has("username-saved") ? html`<p class="note" role="status">Saved. Everyone sees your new username from now on.</p>` : ""}
<form class="stack" method="post" action="/account/username">
${usernameField(usernameGiven?.username ?? account.username, "Everyone sees it, and it's how friends find you.", usernameGiven?.suggestions ?? [], { isFocused: false, label: "" })}
<button class="btn ghost" type="submit">Save</button>
</form>
${scriptTags(USERNAME_SCRIPT)}
<h2 id="friends">Friends</h2>
<p>Friends join by an invite you give them, as a link or a code. <a href="/friends">Your friends and invites</a>.</p>
<h2 id="social">Social</h2>
${account.social_stopped_at_ms
      ? html`<p class="note" role="status">${socialStoppedNotice(account.social_stopped_reason)}</p>`
      : html`<p>Who can chat with you, join you and see what you play.</p>
${query.has("social-saved") ? html`<p class="note" role="status">Saved. Games pick up chat changes the next time you open them.</p>` : ""}
${socialSettingsForm(account.age_band, socialSettingsOf(account))}`}
<h2 id="theme">Theme</h2>
<p>Light or dark. System follows your device.</p>
${query.has("theme-saved") ? html`<p class="note" role="status">Saved.</p>` : ""}
<form class="seg" method="post" action="/account/color-theme" aria-label="Theme">
${COLOR_THEMES.map((theme) => html`<button type="submit" name="color_theme" value="${theme}" aria-pressed="${String(account.color_theme === theme)}">${COLOR_THEME_LABELS[theme]}</button>`)}
</form>
<h2 id="streamer-mode">Streamer mode</h2>
<p>Hides room codes on game pages until you show them, so viewers can't join your matches from your screen.</p>
${query.has("streamer-mode-saved") ? html`<p class="note" role="status">Saved.</p>` : ""}
<form class="seg" method="post" action="/account/streamer-mode" aria-label="Streamer mode">
<button type="submit" name="is_streamer_mode_on" value="0" aria-pressed="${String(!account.is_streamer_mode_on)}">Off</button>
<button type="submit" name="is_streamer_mode_on" value="1" aria-pressed="${String(Boolean(account.is_streamer_mode_on))}">On</button>
</form>
<h2 id="signing-in">Signing in</h2>
${signingInNote ? html`<p class="note" role="status">${SIGNING_IN_NOTES[signingInNote]!}</p>` : ""}
${!email && !passkeys.length && !isAskingForEmail ? protectAccountLine() : ""}
${query.has("confirm-failed") ? html`<p class="error" role="alert">Couldn't send a code. Wait a minute and try again.</p>` : ""}
${scriptTags(PASSKEY_SCRIPT)}
${isConfirmed
      ? ""
      : html`<div class="note" id="confirm"><p>${query.has("confirm-first") ? html`<strong>Confirm it's you first.</strong> ` : ""}To change your password, email or passkeys, download your data, delete your account, or stop keeping where your account is used from, confirm it's you.</p>
${isPasskeyNeeded
          ? html`<div class="row"><button class="btn" type="button" id="passkey-confirm">Confirm with your passkey</button></div>
<p class="error" role="alert" id="passkey-confirm-error" hidden></p>
<details id="lost-passkeys"><summary>Lost your passkeys?</summary>
<p>${hasPassword ? "Confirm with your password" : "Confirm with a code to your email"} to add a new passkey. Because none of your passkeys approved it, it can make API keys and change how you sign in a day after you add it${email ? ", and we'll email you about it" : ""}.</p>
${confirmWithOldWays}
</details>
${scriptTags(PASSKEY_CONFIRM_SCRIPT)}`
          : confirmWithOldWays}
</div>`}
<h3 class="sub">Password</h3>
<p>${hasPassword ? `Set on ${day(account.password_changed_at_ms!)}.` : "No password yet. Add one to sign in with your username."}</p>
${isConfirmed
      ? html`<form class="row" method="post" action="/account/password"><input type="password" name="password" minlength="${MINIMUM_PASSWORD_CHARACTER_COUNT}" autocomplete="new-password" required aria-label="New password" placeholder="New password"><button class="btn ghost" type="submit">${hasPassword ? "Change" : "Add"}</button></form>
<p class="hint">${PASSWORD_HINT}</p>`
      : ""}
<h3 class="sub" id="email">Email</h3>
<p>${email ? html`<strong>${email}</strong>. A way back in if you forget your password. Never shown to anyone.` : "No email. Add one to get back in if you forget your password. Never shown to anyone."}</p>
${isConfirmed
      ? html`<form class="row" method="post" action="/account/email" id="email-form"><input type="email" name="email" autocomplete="email" required aria-label="${email ? "New email" : "Email"}" placeholder="${email ? "New email" : "Email"}">${botCheck(env, "email_code")}<button class="btn ghost" type="submit">${email ? "Change" : "Add"}</button></form>
${email && hasPassword ? html`<form class="after-row" method="post" action="/account/email/remove"><button class="btn ghost" type="submit">Remove email</button></form>` : ""}`
      : email
        ? ""
        : confirmToAdd}
<h3 class="sub" id="passkeys">Passkeys</h3>
<p>Sign in with Face ID, a fingerprint or your device's PIN instead of your password.</p>
${query.has("passkey-added") ? html`<p class="note" role="status"><strong>Passkey added.</strong> Next time, choose Sign in with a passkey.</p>` : ""}
${query.has("confirmed-to-add") ? html`<p class="note" role="status">Thanks, that's you. You can add a new passkey for the next 10 minutes. It can make API keys and change how you sign in from tomorrow.</p>` : ""}
${query.has("passkey-waiting") && waitingPasskeys.length ? html`<p class="note" role="status">Passkey added. It can make API keys and change how you sign in from ${waitEndsText(Math.max(...waitingPasskeys.map((passkey) => passkey.approves_from_at_ms)))}.</p>` : ""}
${passkeys.length
      ? html`<ul class="keys">${passkeys.map(
          (passkey) => html`<li><span>Added on ${passkey.name} <span class="why muted small">${day(passkey.created_at_ms)}, ${passkey.last_used_at_ms ? `last used ${day(passkey.last_used_at_ms)}` : "not used yet"}</span>${passkey.approves_from_at_ms > nowMs ? html`<span class="why muted small">Can make API keys from ${waitEndsText(passkey.approves_from_at_ms)}</span>` : ""}</span>
${isConfirmed ? html`<form method="post" action="/account/passkeys/${passkey.id}/remove"><button class="btn ghost" type="submit">Remove</button></form>` : ""}</li>`,
        )}</ul>`
      : ""}
${isProven
      ? html`<div class="row" id="passkey-add-row"><button class="btn${passkeys.length ? " ghost" : ""}" type="button" id="passkey-add">Add a passkey</button></div>
<p class="error" role="alert" id="passkey-error" hidden></p>
${scriptTags(PASSKEY_ADD_SCRIPT)}`
      : passkeys.length
        ? ""
        : confirmToAdd}
${activitySection(activity, query)}
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
      ? html`<ul class="keys">${keys.map((key) => keyRow(key, games, html`<form method="post" action="/account/keys/${key.id}/revoke"><button class="btn ghost" type="submit">Remove</button></form>`))}</ul>`
      : ""}
${keyWizard(games, passkeyState, waitingPasskeys.length && !approving.length ? Math.min(...waitingPasskeys.map((passkey) => passkey.approves_from_at_ms)) : null, query.has("make-key"))}
<h2>Sign out</h2>
<form method="post" action="/signout"><button class="btn ghost" type="submit">Sign out on every device</button></form>
<h2 id="your-data">Download your data</h2>
<p>A copy of everything Zaisma keeps about your account, with your game saves as files, in one .zip.</p>
${isConfirmed
      ? html`<p><a class="btn ghost" href="/account/data.zip" data-download>Download your data</a></p>`
      : html`<p><a href="#confirm">Confirm it's you above</a>, then you can download your data here.</p>`}
<h2 id="delete-account">Delete account</h2>
${isConfirmed
      ? html`<details><summary>Delete your account</summary>
<p>This deletes your username, any email, game saves and everything else on your account straight away. Games you played and sites you signed in to with Zaisma are told, so their developers can erase what they kept about you. It can't be undone.</p>
${games.length
          ? html`<p>Your games are deleted with it, with their files, database and every player's saves, and their links never go to another game:</p>
<ul>${games.map((game) => html`<li>${game.title} <span class="muted">(zaisma.com/g/${game.slug})</span></li>`)}</ul>`
          : ""}
<form class="row" method="post" action="/account/delete">
<input name="confirm" placeholder='Type "delete"' aria-label='Type "delete" to confirm' autocomplete="off" required>
<button class="btn danger" type="submit">Delete my account</button>
</form>
</details>`
      : html`<p><a href="#confirm">Confirm it's you above</a>, then you can delete your account here.</p>`}
<p class="muted small">Account ID: <code>${account.id}</code></p>`,
    200,
    hasCodeForm,
    account,
  );
}
