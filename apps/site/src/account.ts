import {
  ACCESS_AREAS,
  ACCOUNT_AREAS,
  banScopeOf,
  isBannedMark,
  isContentRule,
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
  joinBirthDateKept,
  signUpToday,
  type Account,
  type AgeBand,
  type Game,
  type SocialMode,
  type SocialSetting,
  type SocialSettings,
} from "@zaisma/core";
import { APPEAL_EMAIL, CONTENT_RULE_WORDS, emailBanned } from "./bans.ts";
import { accountBanned } from "./developer.ts";
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
import { checkEmailCode, deleteEmailCodesOf, sendEmailCode, waitEndsText } from "./email-codes.ts";
import type { Env } from "./env.ts";
import { deleteForumFiles } from "./forum-posts.ts";
import { deleteDueGames } from "./game-deletion.ts";
import { confirmItsYouSheet } from "./components/confirm-its-you.ts";
import { html, layout, message, pageData, raw, scriptTags, type Raw } from "./html.ts";
import { cityPane, cityStage, CITY_PANE_SCRIPT, CITY_SCRIPT } from "./components/city.ts";
import type { CheckedPageName } from "./components/checked-pages.ts";
import { row } from "./components/layout.ts";
import { type IconName } from "./components/foundations.ts";
import { secondaryButton, primaryButton, tertiaryButton, textLink } from "./components/actions.ts";
import { choiceCards, wheelField, cutField, tabSwitch } from "./components/inputs.ts";
import { header } from "./components/navigation.ts";
import { notice } from "./components/panes.ts";
import { pageScript } from "./page-scripts.ts";
import { foundWords } from "./leaked-keys.ts";
import { emailAskBox, isEmailAskDue, markSecurityAlertsSeen, securityAlertsBox, skipEmailAsk } from "./security-alerts.ts";
import { activityAnswer, doneByText, eventTitle, logAccountChange, recordSignIn, seedKeyPlace, setWhereUsedFrom, whereText } from "./security-log.ts";
import { profilePath } from "./profiles.ts";
import { PASSKEY_ADD_SCRIPT, PASSKEY_SCRIPT, PASSKEY_SIGN_IN_SCRIPT, checkPasskeyTap, keyRefusal, usedChallengeCookie, type PasskeyTap } from "./passkeys.ts";
import { MINIMUM_PASSWORD_CHARACTER_COUNT, PASSWORD_HINT, newPasswordProblem } from "./passwords.ts";
import { deleteSaveFiles } from "./saves.ts";
import { accountDataFileName, accountDataZip } from "./account-data.ts";
import { tellAccountDeleted, type WaitUntil } from "./webhooks.ts";
import { carryProof, confirmationOf, recordProof } from "./session-proofs.ts";
import { creditKeptOnDeletionCents, refundForDeletion } from "./credit-api.ts";
import { forgetCardForDeletion } from "./buy.ts";
import { disconnect } from "./stripe.ts";
import { BOT_CHECK_SCRIPT, isRealBrowser, type TurnstileAction } from "./turnstile.ts";
import { recordRestoreEvent } from "./restore-events.ts";

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

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const BLOCK_DURATION_SEC = 24 * 3600;
const blockDurationSec = (env: Env): number => (env.TOO_YOUNG_BLOCK_SECONDS === undefined ? BLOCK_DURATION_SEC : Number(env.TOO_YOUNG_BLOCK_SECONDS) || 0);
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
  "/join/play",
  "/api/username-check",
  "/account",
  "/account/kept",
  "/account/username",
  "/account/social",
  "/account/streamer-mode",
  "/account/color-theme",
  "/account/confirm",
  "/api/account/confirm",
  "/account/password",
  "/account/email",
  "/account/email/code",
  "/account/email/remove",
  "/account/delete",
  "/account/data.zip",
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
  // Confirm it's you from the popup (components/confirm-its-you.ts) is JSON, not a form.
  if (path === "/api/account/confirm") return post ? confirmItsYou(request, env) : new Response("Method not allowed", { status: 405 });
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
  if (path === "/signin/email" && !post) return done(session ? redirect(next ?? "/account") : await emailSigninPage(env, next));

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
    // The proof is kept only for an account that exists: someone deleted for not answering the age question leaves no row.
    const existing = await accountById(env.DB, signedIn.userId);
    if (existing && banScopeOf(existing) === "whole_account") return withCookies(closedAccountPage(env, existing), cookies);
    if (existing) {
      if (isProvider(provider)) await recordProof(env, signedIn, provider);
      return withCookies(redirect(back ?? "/"), [...cookies, ...sessionCookies(env, signedIn), await recordSignIn(request, env, signedIn.userId, provider as SignInKind)]);
    }
    // A new account can't take an email a ban carries (bans.ts): nothing is kept.
    if (realEmail(signedIn.email) && (await isBannedMark(env.DB, "email", signedIn.email))) {
      await deleteAuthUser(env, signedIn.userId);
      return withCookies(await signinPage(env, back, emailBanned().messageForPeople, 403), cookies);
    }
    // New here, and they answered the age question first: pick a username to finish (the proof is kept once the account is made).
    if (joinBand(request, env)) return withCookies(redirect(`/join/username${nextQuery(back)}`), [...cookies, ...sessionCookies(env, signedIn), ...(isProvider(provider) ? [setCookie(env, "zaisma_via", provider, { maximumAgeSec: JOIN_DURATION_SEC })] : [])]);
    // New here without the age question: keep nothing, and ask it now.
    await deleteAuthUser(env, signedIn.userId);
    return withCookies(redirect(`/join?with=${provider}${back ? `&next=${encodeURIComponent(back)}` : ""}`), cookies);
  }
  if (path.startsWith("/join") && blockDurationSec(env) > 0 && readCookie(request, env, "zaisma_age") === "no") return done(tooYoungPage(env));

  // --- Signing in with a username (or email) and password ---
  if (path === "/signin" && post) {
    if (await limited(env, request)) return message(env, "Slow down", SLOW_DOWN, 429);
    const login = field("username", 320);
    const password = passwordField();
    if (!login || !password) return await signinPage(env, next, "Enter your username and password.", 400, login);
    const typed = login.replace(/^@/, "");
    const email = typed.includes("@") ? typed.toLowerCase() : null;
    const userId = email ? await authUserIdByEmail(env, email) : null;
    if (userId === undefined) return message(env, "Couldn't sign you in", "Something went wrong on Zaisma's side. Try again in a minute.", 502);
    const account = email ? (userId ? await accountById(env.DB, userId) : null) : await accountByUsername(env.DB, typed);
    const signedIn = await tryPassword(request, env, account, password, { turnstileToken: field("turnstile_token", 2048), knownEmail: email });
    if (signedIn === "too-many") return message(env, "Slow down", SLOW_DOWN, 429);
    if (signedIn === "locked") return await signinPage(env, next, LOCKED_OUT, 400, login);
    if (signedIn === "bot-check-failed") return await signinPage(env, next, BOT_CHECK_FAILED, 400, login);
    if (signedIn === "no-password") return await signinPage(env, next, "This account doesn't have a password yet. Use Forgot your password to get in with your email, then add one.", 400, login);
    if (signedIn === "wrong") return await signinPage(env, next, "That username and password don't match. Check them and try again.", 400, login);
    if (signedIn === "failed") return message(env, "Couldn't sign you in", "Something went wrong on Zaisma's side. Try again in a minute.", 502);
    // A closed account hears why once the password is right, and gets no session.
    if (account && banScopeOf(account) === "whole_account") {
      await signOutEverywhere(env, signedIn.access, connectionAddress);
      return closedAccountPage(env, account);
    }
    await recordProof(env, signedIn, "password");
    return withCookies(redirect(next ?? "/"), [...sessionCookies(env, signedIn), await recordSignIn(request, env, signedIn.userId, "password")]);
  }

  // --- Forgot your password: back in with a code to the account's email ---
  if (path === "/signin/email" && post) {
    if (await limited(env, request)) return message(env, "Slow down", SLOW_DOWN, 429);
    const email = field("email", 320).toLowerCase();
    if (!EMAIL.test(email)) return await emailSigninPage(env, next, "Enter your email address.");
    if (!(await passesBotCheck("email_code"))) return await emailSigninPage(env, next, BOT_CHECK_FAILED, email);
    // Only an address on an account gets a code; any other is answered the same, so the form doesn't say who has one.
    const userId = await authUserIdByEmail(env, email);
    const account = userId ? await accountById(env.DB, userId) : null;
    const sent = userId === undefined ? "failed" : await sendEmailCode(env, { email, accountId: account?.id ?? null, kind: "sign_in", reason: "sign_in" });
    if (sent === "too-many") return message(env, "Slow down", "We've sent a lot of codes to that address. Wait a few minutes and try again.", 429);
    if (sent === "failed") return message(env, "Couldn't send the code", "Something went wrong on Zaisma's side. Try again in a minute.", 502);
    return await codePage(env, email, next);
  }

  // A code from /signin/email, or from Confirm it's you on the account page.
  if (path === "/signin/code" && post) {
    if (await limited(env, request)) return message(env, "Slow down", SLOW_DOWN, 429);
    const email = field("email", 320).toLowerCase();
    const codeAccountId = await checkEmailCode(env, email, field("code", 20).replace(/\D/g, ""), "sign_in");
    const kind = field("kind", 20) === "confirm" ? "confirm" : "signin";
    // The code opens the account only while that address is still its own: one sent before the address changed or came off opens nothing.
    const accountId = codeAccountId && (await authUserIdByEmail(env, email)) === codeAccountId ? codeAccountId : null;
    if (!accountId) return await codePage(env, email, next, CODE_DIDNT_WORK, kind);
    const codeAccount = await accountById(env.DB, accountId);
    if (codeAccount && banScopeOf(codeAccount) === "whole_account") return closedAccountPage(env, codeAccount);
    const signedIn = await sessionForUser(env, accountId, connectionAddress);
    if (!signedIn) return message(env, "Couldn't sign you in", "Something went wrong on Zaisma's side. Get a new code in a minute and try again.", 502);
    await recordProof(env, signedIn, "email_code");
    return withCookies(redirect(next ?? "/"), [...sessionCookies(env, signedIn), await recordSignIn(request, env, accountId, "email_code")]);
  }

  // --- Making an account ---
  // The birthday, then a username and a password (or Google or Discord, then a username), which makes the account; then, for 16 and
  // over, how they play, which only sets the preset (the account starts on the band's default, so leaving there keeps it).
  if (path === "/join/play") {
    const account = session ? await accountById(env.DB, session.userId) : null;
    if (!account) return done(redirect(`/join${nextQuery(next)}`));
    const after = next ?? "/account?welcome";
    if (account.age_band === "13-15") return done(redirect(after));
    if (!post) return done(await joinPlayPage(env, next, account));
    const socialMode = field("social_mode", 40);
    if (!isSocialMode(socialMode) || !socialModesFor(account.age_band).includes(socialMode)) return done(await joinPlayPage(env, next, account, "Choose one of these."));
    if (!(await updateAccount(env.DB, account.id, { socialSettings: socialModeSettings(socialMode, account.age_band) }))) return done(await joinPlayPage(env, next, account, account.social_stopped_at_ms ? socialStoppedNotice(account.social_stopped_reason) : "Choose one of these."));
    return done(redirect(after));
  }

  if (path.startsWith("/join")) {
    const account = session ? await accountById(env.DB, session.userId) : null;
    if (account) return done(redirect(next ?? "/account"));

    if (path === "/join" && !post) {
      const via = new URL(request.url).searchParams.get("with") ?? "";
      return done(await agePage(env, next, undefined, isProvider(via) ? via : undefined));
    }

    // A session whose sign-in is gone (the account was deleted on another device) can't start an account: start over signed out.
    const leftover = Boolean(session) && (path === "/join/age" || path === "/join/username") && post && !(await authUserEmail(env, session!.userId));
    if (leftover) return withCookies(redirect(`/join${nextQuery(next)}`), clearSessionCookies(env));

    if (path === "/join/age" && post) {
      // The wheels send the birthday as one YYYY-MM-DD; a form without the script sends its parts.
      const [yearText = "", monthText = "", dayText = ""] = /^\d{4}-\d{2}-\d{2}$/.test(field("birthday", 10)) ? field("birthday", 10).split("-") : [field("year"), field("month"), field("day")];
      const birthday = { yearNumber: Number(yearText), monthNumber: Number(monthText), dayNumber: Number(dayText) };
      const ageYearCount = ageOn(birthday, signUpToday(field("today", 10)));
      if (ageYearCount === null) return done(await agePage(env, next, "Choose your full birth date."));
      const band = ageBand(ageYearCount);
      if (!band) {
        // Under 13: no account. Anything Supabase already holds (a half-finished sign-in) is deleted now.
        const cookies = [setCookie(env, "zaisma_age", "no", { maximumAgeSec: blockDurationSec(env) }), setCookie(env, "zaisma_join", "", { maximumAgeSec: 0 })];
        if (session) {
          await deleteAuthUser(env, session.userId);
          cookies.push(...clearSessionCookies(env));
        }
        return withCookies(tooYoungPage(env), cookies);
      }
      // Under 18, the birth date goes with the join steps to the new account, which keeps it until 18.
      const birthDate = band === "18+" ? undefined : birthDateText(birthday);
      const cookie = setCookie(env, "zaisma_join", encodeURIComponent(JSON.stringify({ band, birth_date: birthDate })), { maximumAgeSec: JOIN_DURATION_SEC });
      // They came from Google or Discord: go straight back there (it won't ask again), then pick a username.
      const via = field("with");
      if (!session && isProvider(via) && (await providersOn(env)).includes(via)) return withCookies(redirect(`/signin/with/${via}${nextQuery(next)}`), [cookie]);
      // Already signed in (Google or Discord, or an email code, but never finished): just the username.
      return withCookies(session ? await joinUsernamePage(env, next) : await joinAccountPage(env, next), [...(session?.cookies ?? []), cookie]);
    }

    const band = joinBand(request, env);
    if (!band) return done(redirect(`/join${nextQuery(next)}`));
    // Made: 16 and over choose how they play next; 13–15 go straight on.
    const afterMade = band === "13-15" ? (next ?? "/account?welcome") : `/join/play${nextQuery(next)}`;

    if (path === "/join/account" && !post) return done(session ? redirect(`/join/username${nextQuery(next)}`) : await joinAccountPage(env, next));

    if (path === "/join/account" && post) {
      if (session) return done(redirect(`/join/username${nextQuery(next)}`));
      if (await limited(env, request)) return message(env, "Slow down", SLOW_DOWN, 429);
      const wanted = field("username", 40);
      const password = passwordField();
      const again = async (problem: Pick<JoinGiven, "usernameError" | "passwordError"> | string, suggestions: string[] = []) =>
        typeof problem === "string" ? joinAccountPage(env, next, problem, { username: wanted, suggestions }) : joinAccountPage(env, next, undefined, { username: wanted, suggestions, ...problem });
      const checked = checkUsername(wanted);
      if ("error" in checked) return await again({ usernameError: checked.error }, await suggestUsernames(env.DB, wanted));
      if (await isUsernameTaken(env.DB, checked.username)) return await again({ usernameError: takenText(checked.username) }, await suggestUsernames(env.DB, checked.username));
      const problem = await newPasswordProblem(password, checked.username);
      if (problem) return await again({ passwordError: problem });
      // Last, so a token isn't spent on a form that comes back for another reason.
      if (env.TURNSTILE_SECRET && !(await isRealBrowser(env, field("turnstile_token", 2048), "join"))) return await again(BOT_CHECK_FAILED);
      const made = await createPasswordUser(env, password);
      if (!made) return message(env, "Couldn't make your account", "Something went wrong on Zaisma's side. Try again in a minute.", 502);
      try {
        await createAccount(env.DB, { id: made.userId, username: checked.username, ageBand: band, birthDate: joinBirthDate(request, env), socialMode: defaultSocialMode(band), hasPassword: true });
      } catch (error) {
        if (!(error instanceof UsernameTakenError)) throw error;
        await deleteAuthUser(env, made.userId);
        return await again({ usernameError: takenText(checked.username) }, await suggestUsernames(env.DB, checked.username));
      }
      const signedIn = await signInWithPassword(env, made.email, password, connectionAddress);
      const cookies = [setCookie(env, "zaisma_join", "", { maximumAgeSec: 0 }), await recordSignIn(request, env, made.userId, "password", { isNewAccount: true })];
      if (typeof signedIn === "string") return withCookies(redirect(`/signin${nextQuery(next)}`), cookies);
      await recordProof(env, signedIn, "password");
      return withCookies(redirect(afterMade), [...cookies, ...sessionCookies(env, signedIn)]);
    }

    if (path === "/join/username" && !post) return done(session ? await joinUsernamePage(env, next) : redirect(`/join/account${nextQuery(next)}`));

    if (path === "/join/username" && post && session) {
      const wanted = field("username", 40);
      const again = async (problem: Pick<JoinGiven, "usernameError"> | string, suggestions: string[] = []) =>
        done(typeof problem === "string" ? await joinUsernamePage(env, next, problem, { username: wanted, suggestions }) : await joinUsernamePage(env, next, undefined, { username: wanted, suggestions, ...problem }));
      const checked = checkUsername(wanted);
      if ("error" in checked) return await again({ usernameError: checked.error }, await suggestUsernames(env.DB, wanted));
      if (await isUsernameTaken(env.DB, checked.username)) return await again({ usernameError: takenText(checked.username) }, await suggestUsernames(env.DB, checked.username));
      if (env.TURNSTILE_SECRET && !(await isRealBrowser(env, field("turnstile_token", 2048), "join"))) return await again(BOT_CHECK_FAILED);
      try {
        await createAccount(env.DB, { id: session.userId, username: checked.username, ageBand: band, birthDate: joinBirthDate(request, env), socialMode: defaultSocialMode(band) });
      } catch (error) {
        if (!(error instanceof UsernameTakenError)) throw error;
        return await again({ usernameError: takenText(checked.username) }, await suggestUsernames(env.DB, checked.username));
      }
      const via = readCookie(request, env, "zaisma_via") ?? "";
      if (isProvider(via)) await recordProof(env, session, via);
      return withCookies(redirect(afterMade), [...session.cookies, setCookie(env, "zaisma_join", "", { maximumAgeSec: 0 }), setCookie(env, "zaisma_via", "", { maximumAgeSec: 0 }), await recordSignIn(request, env, session.userId, null, { isNewAccount: true })]);
    }
    return done(redirect("/join"));
  }

  // --- Signed in from here on ---
  if (!session) return redirect(`/signin${nextQuery(path === "/account" ? null : path === "/account/kept" ? safeNext(path + new URL(request.url).search) : next)}`);
  const account = await accountById(env.DB, session.userId);

  if (path === "/signout" && post) {
    // Other devices are out at once, not within the hour their access token has left.
    await endSessionsBefore(env, session.userId, Date.now(), "up");
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
  if (path === "/account/kept" && !post) return done(await keptPage(env, account, new URL(request.url).searchParams.get("game")));

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

  // Confirm it's them with a code to their email, for an account with no password to prove it with (a password, or a passkey, is the popup's: /api/account/confirm).
  if (path === "/account/confirm" && post) {
    if (await limited(env, request)) return done(message(env, "Slow down", SLOW_DOWN, 429));
    // With a passkey that can approve, a code only lets them add a passkey, which waits a day.
    const back = next ?? (confirmation.isPasskeyNeeded ? "/account?confirmed-to-add#passkeys" : "/account?confirmed#signing-in");
    if (account.password_changed_at_ms !== null) return done(redirect("/account?confirm-first#signing-in"));
    const email = realEmail(session.email);
    if (!email) return done(redirect("/account?confirm-failed#signing-in"));
    if (!(await passesBotCheck("email_code"))) return done(await accountPage(env, session, false, BOT_CHECK_FAILED));
    const sent = await sendEmailCode(env, { email, accountId: account.id, kind: "sign_in", reason: "confirm" });
    if (sent !== "sent") return done(redirect("/account?confirm-failed#signing-in"));
    return done(await codePage(env, email, back, undefined, "confirm"));
  }

  if ((path === "/account/password" || path === "/account/email" || path === "/account/email/remove" || path === "/account/delete") && post && !confirmation.isConfirmed) return done(redirect("/account?confirm-first#signing-in"));

  if (path === "/account/password" && post) {
    const password = passwordField();
    const problem = await newPasswordProblem(password, account.username);
    // From the window after Forgot your password: it opens again, saying what's wrong.
    const again = field("from", 20) === "new-password" ? new URLSearchParams({ "new-password": "", ...(next ? { next } : {}) }) : undefined;
    if (problem) return done(await accountPage(env, session, false, problem, undefined, again));
    if (!(await setPassword(env, account.id, password))) return done(message(env, "Couldn't save your password", "Something went wrong on Zaisma's side. Try again in a minute.", 502));
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
    if (await isBannedMark(env.DB, "email", email)) return done(await accountPage(env, session, false, emailBanned().messageForPeople));
    const holder = await authUserIdByEmail(env, email);
    if (holder) return done(await accountPage(env, session, false, EMAIL_TAKEN));
    const sent = holder === undefined ? "failed" : await sendEmailCode(env, { email, accountId: account.id, kind: "add_email", reason: "add_email" });
    if (sent === "too-many") return done(message(env, "Slow down", "We've sent a lot of codes. Wait a few minutes and try again.", 429));
    if (sent === "failed") return done(message(env, "Couldn't send the code", "Something went wrong on Zaisma's side. Try again in a minute.", 502));
    return done(await codePage(env, email, null, undefined, "email"));
  }

  if (path === "/account/email/code" && post) {
    if (await limited(env, request)) return done(message(env, "Slow down", SLOW_DOWN, 429));
    const email = field("email", 320).toLowerCase();
    const codeAccountId = await checkEmailCode(env, email, field("code", 20).replace(/\D/g, ""), "add_email");
    if (codeAccountId !== account.id) return done(await codePage(env, email, null, "That code didn't work. Check it, or go back and try again.", "email"));
    const isSet = await setEmail(env, account.id, email);
    if (isSet === "taken") return done(await accountPage(env, session, false, EMAIL_TAKEN));
    if (isSet === "failed") return done(message(env, "Couldn't add your email", "Something went wrong on Zaisma's side. Try again in a minute.", 502));
    await deleteEmailCodesOf(env, account.id);
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
    if (!(await removeEmail(env, account.id))) return done(message(env, "Couldn't remove your email", "Something went wrong on Zaisma's side. Try again in a minute.", 502));
    await deleteEmailCodesOf(env, account.id);
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

  // API keys are made on Developer settings (developer-settings.ts); a key is removed here too, from the window after a new password.
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
    if (!(await deleteAuthUser(env, session.userId))) return done(message(env, "Couldn't delete your account", "Something went wrong on Zaisma's side. Try again later.", 502));
    await deleteSaveFiles(env, account.id);
    await deleteForumFiles(env, account.id);
    await refundForDeletion(env, account.id);
    await forgetCardForDeletion(env, account.id);
    await disconnectStripeForDeletion(env, account.id);
    await deleteAccount(env.DB, account.id);
    await recordRestoreEvent(env, { event_kind: "account_deleted", at_ms: Date.now(), account_id: account.id });
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

/** A deleted developer's connected Stripe account stops being authorized to Zaisma (their sales stay as records); a Stripe that can't be reached doesn't stop the deletion. */
async function disconnectStripeForDeletion(env: Env, accountId: string): Promise<void> {
  const owner = await env.DB.prepare("SELECT stripe_account_id FROM owners WHERE account_id = ?").bind(accountId).first<{ stripe_account_id: string | null }>();
  if (owner?.stripe_account_id) await disconnect(env, owner.stripe_account_id).catch((error) => console.error(`Couldn't disconnect ${owner.stripe_account_id} at Stripe for the deleted account ${accountId}:`, error));
}

/** What a password try came to: a session, or why not. */
export type PasswordTry = PasswordSignIn | "no-password" | "locked" | "bot-check-failed";

/**
 * A password for an account (docs/DECISIONS.md, "Accounts open only through Zaisma"). A device with the
 * account's mark always gets its try. Any other passes the invisible check (unless it's signed in already,
 * turnstileToken null) and gets none while the day's 20 wrong passwords from unmarked devices are used up.
 * 5 tries a minute per account hold everywhere. "no-password" for an account made with an email code, Google
 * or Discord that never added one; an unknown account is just "wrong", after the same checks, so nothing
 * says whether it exists.
 */
export async function tryPassword(request: Request, env: Env, account: Account | null, password: string, options: { turnstileToken: string | null; knownEmail: string | null }): Promise<PasswordTry> {
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

/**
 * POST /api/account/confirm { passkey_tap } or { password }: the popup's proof that this is them (components/confirm-its-you.ts), for what
 * changes how the account signs in, downloads or deletes it, and adding a passkey. The same proof the "Confirm it's you" block took
 * (session-proofs.ts): a passkey's tap counts for everything; a password signs in again and counts for everything except where the account
 * has a passkey that can approve, which only lets them add a new one (it waits a day). Answers { is_confirmed: true }, or { error } with the reason.
 */
async function confirmItsYou(request: Request, env: Env): Promise<Response> {
  const session = await currentSession(request, env);
  const account = session ? await accountById(env.DB, session.userId) : null;
  const answer = (body: Record<string, unknown>, httpStatus: number, cookies: string[]) => withCookies(Response.json(body, { status: httpStatus }), cookies);
  if (!session || !account) return answer({ error: "Sign in first." }, 401, []);
  const sessionCookiesNow = session.cookies;
  if (await limited(env, request)) return answer({ error: SLOW_DOWN }, 429, sessionCookiesNow);
  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {}

  if (body.passkey_tap !== undefined) {
    const given = (body.passkey_tap && typeof body.passkey_tap === "object" ? body.passkey_tap : {}) as Record<string, unknown>;
    const text = (name: string) => (typeof given[name] === "string" ? (given[name] as string).slice(0, 20000) : "");
    const passkey = await checkPasskeyTap(request, env, account.id, "confirm", { id: text("passkey_id").slice(0, 400), clientDataJSON: text("client_data_json"), authenticatorData: text("authenticator_data"), signature: text("signature"), userHandle: text("user_handle").slice(0, 400) });
    const used = [...sessionCookiesNow, usedChallengeCookie(env)];
    if (!passkey) return answer({ error: "That passkey didn't work. Try again, or use another one." }, 403, used);
    await recordProof(env, session, "passkey", passkey.id);
    return answer({ is_confirmed: true }, 200, used);
  }

  if (typeof body.password === "string") {
    // Signed in already, so no invisible check; the limits on wrong passwords still hold.
    const signedIn = await tryPassword(request, env, account, body.password.slice(0, MAXIMUM_PASSWORD_FIELD_CHARACTER_COUNT), { turnstileToken: null, knownEmail: null });
    if (signedIn === "wrong" || signedIn === "no-password") return answer({ error: "That password isn't right." }, 403, sessionCookiesNow);
    if (signedIn === "locked") return answer({ error: LOCKED_OUT }, 429, sessionCookiesNow);
    if (signedIn === "too-many" || signedIn === "bot-check-failed") return answer({ error: SLOW_DOWN }, 429, sessionCookiesNow);
    if (signedIn === "failed") return answer({ error: "Couldn't check your password just now. Try again in a minute." }, 502, sessionCookiesNow);
    await recordProof(env, signedIn, "password");
    return answer({ is_confirmed: true }, 200, [...sessionCookies(env, signedIn), await recordSignIn(request, env, account.id, "password")]);
  }

  return answer({ error: "Send a passkey_tap or a password." }, 400, sessionCookiesNow);
}

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

/** The birth date from the join steps' cookie: under 18 only, and only when it reads as the cookie's band or a later one (joinBirthDateKept), so steps that cross midnight keep it and a forged cookie doesn't. */
function joinBirthDate(request: Request, env: Env): string | undefined {
  try {
    const joinCookie = JSON.parse(decodeURIComponent(readCookie(request, env, "zaisma_join") ?? "")) as { band?: string; birth_date?: string };
    const isKept = isAgeBand(joinCookie.band) && joinCookie.band !== "18+" && typeof joinCookie.birth_date === "string" && joinBirthDateKept(joinCookie.birth_date, joinCookie.band);
    return isKept ? joinCookie.birth_date : undefined;
  } catch {
    return undefined;
  }
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
  // In the city's look (a template of a secondary button to copy, and the field's own hint and error lines), or the account page's.
  const template = document.getElementById("username-suggestion");
  const show = (text, kind) => {
    status.textContent = text;
    if (template) { status.className = kind === "bad" ? "field-error" : "field-hint"; if (kind === "bad") status.setAttribute("role", "alert"); else status.removeAttribute("role"); }
    else status.className = "hint" + (kind ? " " + kind : "");
  };
  // In the city's look the suggestions are a row (layout.ts): each one a copy of the template's cell, its button named for it.
  const row = box.querySelector(".layout-row") || box;
  const suggest = (names) => {
    row.replaceChildren();
    if (names.length && !template) box.append(Object.assign(document.createElement("span"), { textContent: "Free:" }));
    for (const name of names) {
      let cell, button;
      if (template) { cell = template.content.querySelector(".row-cell").cloneNode(true); button = cell.querySelector("button"); button.value = name; button.querySelector(".face > span:last-child").textContent = name; }
      else cell = button = Object.assign(document.createElement("button"), { type: "button", className: "btn ghost", textContent: name });
      button.dataset.username = name;
      row.append(cell);
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
    const chosen = event.target.closest("button[data-username], button[value]");
    if (!chosen) return;
    input.value = chosen.dataset.username || chosen.value;
    input.focus();
    check();
  });
})();`);

/**
 * The game that asked the player to sign in: a game opens the tab with next going back to /account/kept?game=<slug>
 * (perhaps inside another next, as Forgot your password's is). Only a game any stranger can see is named; a made-up
 * slug, or a private one, finds none and the pane is the plain one.
 */
async function askingGame(env: Env, next: string | null): Promise<Game | null> {
  let path = next;
  for (let depthIndex = 0; path && depthIndex < 3; depthIndex++) {
    const url = new URL(path, "https://zaisma.com");
    if (url.pathname === "/account/kept") {
      const slug = url.searchParams.get("game");
      const game = slug && /^[a-z0-9-]+$/.test(slug) ? await gameBySlug(env.DB, slug) : null;
      return game && game.review_status !== "pending" && game.visibility !== "draft" && game.visibility !== "private" ? game : null;
    }
    path = url.searchParams.get("next");
  }
  return null;
}

interface SignInPageOptions {
  /** Which state on the checks' list the step is (LayoutOptions.checkedPage, html.ts). */
  checkedPage: CheckedPageName;
  /** The game that asked the player to sign in (askingGame). */
  game?: Game | null;
  httpStatus?: number;
  /** Who is looking, once they're signed in (You're in). */
  account?: Account | null;
}

/**
 * Signing in and making an account, and every step between: one glass pane over the city (docs/DECISIONS.md, "Signing in happens
 * in the city, on every device"), with only the logo above it.
 */
function signInPage(env: Env, title: string, body: Raw, options: SignInPageOptions): Response {
  // Every step allows the bot check, since each can swap in the next one's in place (CITY_PANE_SCRIPT).
  const hasTurnstileCheck = Boolean(env.TURNSTILE_SITE_KEY);
  const response = layout(env, {
    title: `${title} · Zaisma`,
    stage: cityStage(),
    isBare: true,
    checkedPage: options.checkedPage,
    pageShape: "full",
    isPrivate: true,
    hasTurnstileCheck,
    viewer: options.account === undefined ? undefined : { account: options.account },
    body: cityPane({ header: header({ current: null, isOnDeveloperPage: false, isOnSignInPage: true }), label: title, body, after: scriptTags(CITY_SCRIPT, CITY_PANE_SCRIPT, BACK_TO_GAME_SCRIPT, ...(hasTurnstileCheck ? [BOT_CHECK_SCRIPT] : [])) }),
  });
  return new Response(response.body, { status: options.httpStatus ?? 200, headers: response.headers });
}

/** A pane's heading, and when a game asked, the line that says so. */
const paneHeading = (title: string, game: Game | null | undefined) => html`<h1>${title}</h1>${game ? html`<p>${game.title} asked you to sign in.</p>` : ""}`;

/** Sign in or Make an account, at the top of both, with next kept. */
const signInSwitch = (current: "signin" | "join", next: string | null) =>
  tabSwitch({
    label: "Sign in or make an account",
    switchSize: "big",
    isFull: true,
    tabs: [
      { label: "Sign in", href: `/signin${nextQuery(next)}`, isCurrent: current === "signin" },
      { label: "Make an account", href: `/join${nextQuery(next)}`, isCurrent: current === "join" },
    ],
  });

/**
 * The guest way, at the pane's foot: Continue as guest, home; or, when a game asked, back to it as a guest, closing this tab
 * (BACK_TO_GAME_SCRIPT) so the game carries on in its own. After an "or" of its own unless the ways in above already had one.
 */
function guestWay(game: Game | null | undefined, hasOr = true): Raw {
  const button = game ? html`<div data-back>${tertiaryButton(`Back to ${game.title} as a guest`, { href: `/g/${game.slug}?play`, hasArrow: true, isFullWidth: true })}</div>` : tertiaryButton("Continue as guest", { href: "/", hasArrow: true, isFullWidth: true });
  return html`${hasOr ? html`<p class="or">or</p>` : ""}${button}`;
}

/** A problem with the whole form rather than one field (the invisible check, too many tries). */
const paneProblem = (text?: string) => (text ? notice({ text, tone: "problem", isInPlace: true }) : "");

/** The passkey's way in: shown by PASSKEY_SIGN_IN_SCRIPT where the browser has passkeys, with the ways in round it. */
const passkeyWay = (next: string, isAutofill: boolean) =>
  html`<div id="passkey-go" data-next="${next}"${isAutofill ? raw(" data-autofill") : ""} hidden>${secondaryButton("Sign in with a passkey", { type: "button", wayIn: "passkey", isFullWidth: true })}</div>`;

const providerButtons = (providers: Provider[], next: string | null) =>
  html`${providers.map((provider) => secondaryButton(`Continue with ${PROVIDERS[provider]}`, { href: `/signin/with/${provider}${nextQuery(next)}`, wayIn: provider, isFullWidth: true }))}`;

/** Which of the two the pane shows: signing in, or the first step of making an account. */
type EntryView = "signin" | "join";

/**
 * Sign in and Make an account are one pane with both in it: the switch swaps them in place (ENTRY_SWITCH_SCRIPT), so the city
 * carries on behind, and the address follows. Each is its own address too, so a link or a page without the script opens the right one.
 */
async function entryPage(env: Env, current: EntryView, next: string | null, given: { signinError?: string; login?: string; ageError?: string; via?: Provider; httpStatus?: number } = {}): Promise<Response> {
  const providers = await providersOn(env);
  const game = await askingGame(env, next);
  const view = (name: EntryView, title: string, body: Raw) =>
    html`<section class="pane-stack" id="view-${name}" data-entry-view="${name}" data-title="${title} · Zaisma"${name === current ? "" : raw(" hidden")}>${body}</section>`;
  const signin = view(
    "signin",
    "Sign in",
    html`${paneHeading("Welcome back", game)}
<form method="post" action="/signin" id="signin-form">
${nextField(next)}
${cutField({ id: "signin-username", name: "username", label: "Username", type: "text", icon: "person", text: given.login ?? "", autocomplete: "username webauthn", isRequired: true })}
${cutField({ id: "signin-password", name: "password", label: "Password", type: "password", icon: "lock", autocomplete: "current-password", isRequired: true, error: given.signinError })}
${botCheck(env, "sign_in")}
${primaryButton("Sign in", { isFullWidth: true, isBig: true, busyLabel: "Signing in" })}
<p>${textLink("Forgot your password?", `/signin/email${nextQuery(next)}`)}</p>
</form>
<div class="pane-stack" id="ways"${providers.length ? "" : raw(" hidden")}>
<p class="or">or</p>
<div class="ways">${passkeyWay(next ?? "/", true)}${providerButtons(providers, next)}</div>
<p class="field-error" role="alert" id="passkey-error" hidden></p>
</div>`,
  );
  const join = view(
    "join",
    "Make an account",
    html`${paneHeading("Make an account", game)}
<p>${given.via ? `You're new to Zaisma. Answer this first, then we'll take you back to ${PROVIDERS[given.via]} to finish.` : "Keep your progress, play with friends and get your own username."}</p>
<form method="post" action="/join/age" id="age-form">
<input type="hidden" name="today" value="">
${nextField(next)}
${given.via ? html`<input type="hidden" name="with" value="${given.via}">` : ""}
${wheelField({ id: "join-birthday", name: "birthday", label: "When's your birthday?", wheelKind: "birthday", isRequired: true, hint: "Your birthday is never shown to anyone.", error: given.ageError })}
${primaryButton("Next", { isFullWidth: true, isBig: true, busyLabel: "One moment" })}
</form>`,
  );
  // The guest way's own "or" only under Make an account: under Sign in, the ways in above already have one.
  return signInPage(
    env,
    current === "signin" ? "Sign in" : "Make an account",
    html`${signInSwitch(current, next)}
${signin}
${join}
<p class="or" data-entry-or="join"${current === "join" ? "" : raw(" hidden")}>or</p>
${guestWay(game, false)}
${scriptTags(PASSKEY_SCRIPT, PASSKEY_SIGN_IN_SCRIPT, ENTRY_SWITCH_SCRIPT, JOIN_TODAY_SCRIPT)}`,
    { checkedPage: current === "signin" ? (given.signinError ? "Sign in, wrong password" : "Sign in") : given.ageError ? "New account, no birthday" : "Make an account", game, httpStatus: given.httpStatus },
  );
}

// The age question counts the date on the player's own device, so a 13th birthday comes at their midnight (the server holds it within Earth's time zones).
const JOIN_TODAY_SCRIPT = pageScript("join-today", `(() => {
  const form = document.getElementById("age-form");
  if (!form) return;
  const setToday = () => {
    const now = new Date();
    form.elements.today.value = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  };
  setToday();
  form.addEventListener("submit", setToday);
})();`);

// Sign in and Make an account swap in place: the other view shows, the switch's slab slides to it, and the address and title follow
// (back and forward too). Anything but a plain click (a new tab, a modifier) goes to its own address as a link does.
const ENTRY_SWITCH_SCRIPT = pageScript("entry-switch", `(() => {
  const sw = document.querySelector(".city-pane .tab-switch");
  const views = [...document.querySelectorAll("[data-entry-view]")];
  if (!sw || views.length < 2) return;
  const tabs = [...sw.querySelectorAll(":scope > a")];
  const viewOf = (url) => (new URL(url, location.href).pathname === "/join" ? "join" : "signin");
  function show(name) {
    for (const view of views) view.hidden = view.dataset.entryView !== name;
    for (const or of document.querySelectorAll("[data-entry-or]")) or.hidden = or.dataset.entryOr !== name;
    const tab = tabs.find((each) => viewOf(each.href) === name);
    for (const each of tabs) { if (each === tab) each.setAttribute("aria-current", "page"); else each.removeAttribute("aria-current"); }
    if (tab && sw.pickTab) sw.pickTab(tab);
    document.title = views.find((view) => view.dataset.entryView === name).dataset.title;
  }
  for (const tab of tabs) tab.addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (tab.getAttribute("aria-current") === "page") return;
    history.pushState({ entryView: viewOf(tab.href) }, "", tab.href);
    show(viewOf(tab.href));
  });
  addEventListener("popstate", () => { if (sw.isConnected && /^\\/(signin|join)$/.test(location.pathname)) show(viewOf(location.href)); });
})();`);

async function signinPage(env: Env, next: string | null, error?: string, httpStatus = 200, login = ""): Promise<Response> {
  return entryPage(env, "signin", next, { signinError: error, login, httpStatus });
}

/**
 * Forgot your password: a code to the account's email, or a passkey. After it, a window on the account
 * page asks for a new password, then goes on to wherever they were headed.
 */
async function emailSigninPage(env: Env, next: string | null, error?: string, given = ""): Promise<Response> {
  const back = `/account?new-password${next ? `&next=${encodeURIComponent(next)}` : ""}`;
  const game = await askingGame(env, next);
  return signInPage(
    env,
    "Forgot your password?",
    html`${paneHeading("Forgot your password?", game)}
<p>Get back in with the email or a passkey on your account, then set a new password.</p>
<form method="post" action="/signin/email" id="code-form">
${nextField(back)}
${cutField({ id: "signin-email", name: "email", label: "Email", type: "email", icon: "mail", text: given, autocomplete: "email", isRequired: true, error })}
${botCheck(env, "email_code")}
${primaryButton("Email me a code", { isFullWidth: true, isBig: true, busyLabel: "Sending" })}
</form>
<div class="pane-stack" id="ways" hidden>
<p class="or">or</p>
<div class="ways">${passkeyWay(back, false)}</div>
<p class="field-error" role="alert" id="passkey-error" hidden></p>
</div>
<p class="note">Added neither? Then the account can't be recovered, but you can always ${textLink("make a new one", `/join${nextQuery(next)}`)}.</p>
${guestWay(game)}
${scriptTags(PASSKEY_SCRIPT, PASSKEY_SIGN_IN_SCRIPT)}`,
    { checkedPage: error ? "Forgot your password, no email" : "Forgot your password", game, httpStatus: error ? 400 : 200 },
  );
}

/** What a code is for: signing in, confirming it's you on the account page, or adding an email. */
type CodeKind = "signin" | "confirm" | "email";

async function codePage(env: Env, email: string, next: string | null, error?: string, kind: CodeKind = "signin"): Promise<Response> {
  const lead = {
    signin: html`If <strong>${email}</strong> is on a Zaisma account, a code is on its way.`,
    confirm: html`We sent a code to <strong>${email}</strong>. Enter it to confirm it's you.`,
    email: html`We sent a code to <strong>${email}</strong>. Enter it to add the email to your account.`,
  }[kind];
  // Signing in with a code is a step of signing in, so it's in the city; confirming and adding an email are the account page's.
  if (kind === "signin") {
    const game = await askingGame(env, next);
    return signInPage(
      env,
      "Check your email",
      html`${paneHeading("Check your email", game)}
<p>${lead}</p>
<form method="post" action="/signin/code">
${nextField(next)}
<input type="hidden" name="email" value="${email}">
${cutField({ id: "signin-code", name: "code", label: "Code", type: "text", icon: "lock", autocomplete: "one-time-code", inputMode: "numeric", isRequired: true, error })}
${primaryButton("Continue", { isFullWidth: true, isBig: true })}
</form>
<p class="note">No email after a minute? Check spam, or ${textLink("try again", `/signin/email${nextQuery(next)}`)}.</p>
${guestWay(game)}`,
      { checkedPage: error ? "Check email, wrong code" : "Check your email", game, httpStatus: error ? 400 : 200 },
    );
  }
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
<p class="muted">No email after a minute? Check spam, or ${html`<a href="/account#signing-in">go back</a> and try again`}.</p>`,
    error ? 400 : 200,
  );
}

/** The first step of making an account: the birthday, on the wheels. Each starts blank, so nothing suggests an age. */
async function agePage(env: Env, next: string | null, error?: string, via?: Provider): Promise<Response> {
  return entryPage(env, "join", next, { ageError: error, via, httpStatus: error ? 400 : 200 });
}

export const SOCIAL_MODE_LABELS: Record<SocialMode, string> = { solo_focused: "Solo-focused", friends_focused: "Friends-focused", open_and_social: "Open and social" };

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
  solo_focused: "I want to play without chat.",
  friends_focused: "I want to play and chat with my friends.",
  open_and_social: "I like meeting new players.",
};

/** How each feels, at a glance: on your own with headphones on, with your friends, out meeting everyone. */
const JOIN_SOCIAL_MODE_ICONS: Record<SocialMode, IconName> = {
  solo_focused: "headphones",
  friends_focused: "friends",
  open_and_social: "globe",
};

/**
 * The last step of making an account, for 16 and over, whichever way they came in: How do you play? The account
 * already exists (made at the step before, on the band's default), so this only sets the preset; leaving here keeps
 * the default, which is the one shown picked.
 */
async function joinPlayPage(env: Env, next: string | null, account: Account, error?: string): Promise<Response> {
  const game = await askingGame(env, next);
  const current = socialModeOf(socialSettingsOf(account), account.age_band);
  return signInPage(
    env,
    "How do you play?",
    html`${paneHeading("How do you play?", game)}
<form method="post" action="/join/play" class="is-play-step">
${nextField(next)}
${choiceCards({ id: "join-play", name: "social_mode", label: "How do you play?", isLabelHidden: true, pickedValue: current === "custom" ? defaultSocialMode(account.age_band) : current, choices: socialModesFor(account.age_band).map((socialMode) => ({ label: SOCIAL_MODE_LABELS[socialMode], choiceValue: socialMode, text: JOIN_SOCIAL_MODE_LINES[socialMode], icon: JOIN_SOCIAL_MODE_ICONS[socialMode] })) })}
${paneProblem(error)}
<p class="note">You can change this any time in Settings.</p>
${primaryButton("Make my account", { isFullWidth: true, isBig: true, busyLabel: "One moment" })}
</form>`,
    { checkedPage: "How do you play", game, httpStatus: error ? 400 : 200, account },
  );
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

const SOCIAL_CHOICE_LABELS: Record<string, string> = { nobody: "Nobody", friends: "Friends", played_with: "People I play with", anyone: "Anyone" };

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

/** What a join form shows again when it comes back: what they typed (never the password), free usernames, and what was wrong with which. */
interface JoinGiven {
  username?: string;
  suggestions?: string[];
  usernameError?: string;
  passwordError?: string;
}

/**
 * Cloudflare's invisible check on a form, when it's set up: an empty box it can use, and its answer's
 * field. A page with one passes hasTurnstileCheck to page(), which brings the check's script.
 */
const botCheck = (env: Env, action: TurnstileAction) => (env.TURNSTILE_SITE_KEY ? html`<input type="hidden" name="turnstile_token"><div data-bot-check="${action}" data-site-key="${env.TURNSTILE_SITE_KEY}"></div>` : "");

/**
 * The username, in the city's look: what it says as it's typed (free, taken, why not) under it, and free ones close
 * to it to tap, a row of small buttons (USERNAME_SCRIPT, which copies the template's cell for each). The server says the same when the form
 * comes back, so it works without the script.
 */
function usernameCutField(given: JoinGiven): Raw {
  const freeUsernames = given.suggestions ?? [];
  const suggestions = (usernames: string[]) => row({ widths: "fit", items: usernames.map((username) => ({ kind: "control" as const, markup: secondaryButton(username, { type: "button", isSmall: true, buttonValue: username }) })) });
  return html`<div class="cut-field">${cutField({ id: "username-box", name: "username", label: "Username", type: "text", icon: "person", text: given.username ?? "", autocomplete: "username", isRequired: true })}
<p class="${given.usernameError ? "field-error" : "field-hint"}" id="username-status" data-resting="${USERNAME_HINT}"${given.usernameError ? raw(' role="alert"') : ""}>${given.usernameError ?? USERNAME_HINT}</p>
<div id="username-suggestions"${freeUsernames.length ? "" : raw(" hidden")}>${suggestions(freeUsernames)}</div>
<template id="username-suggestion">${suggestions([""])}</template></div>`;
}

const TERMS_LINE = html`<p class="note">By making an account you agree to the ${textLink("terms of service", "/legal/terms")}, including the ${textLink("content rules", "/legal/content-rules")} and the ${textLink("privacy policy", "/legal/privacy")}.</p>`;

/** Step A: a username and a password, or Google or Discord instead (then a username on its own, joinUsernamePage). The account is made here. */
async function joinAccountPage(env: Env, next: string | null, error?: string, given: JoinGiven = {}): Promise<Response> {
  const providers = await providersOn(env);
  const game = await askingGame(env, next);
  // With Google or Discord to choose from, the step is choosing how you'll sign in; their way picks the username on the next step.
  const title = providers.length ? "How will you sign in?" : "Pick a username";
  return signInPage(
    env,
    title,
    html`${paneHeading(title, game)}
${providers.length ? html`<div class="ways">${providerButtons(providers, next)}</div><p class="or">or a username and password</p>` : ""}
<form method="post" action="/join/account" id="join-form">
${nextField(next)}
${usernameCutField(given)}
${cutField({ id: "join-password", name: "password", label: "Password", type: "password", icon: "lock", autocomplete: "new-password", isRequired: true, hint: PASSWORD_HINT, error: given.passwordError })}
${botCheck(env, "join")}
${paneProblem(error)}
${primaryButton("Next", { isFullWidth: true, isBig: true, busyLabel: "One moment" })}
</form>
${TERMS_LINE}
${guestWay(game)}
${scriptTags(USERNAME_SCRIPT)}`,
    { checkedPage: "How will you sign in", game, httpStatus: error || given.usernameError || given.passwordError ? 400 : 200 },
  );
}

/** Step A after Google or Discord: just a username, since they sign in with those. The account is made here. */
async function joinUsernamePage(env: Env, next: string | null, error?: string, given: JoinGiven = {}): Promise<Response> {
  const game = await askingGame(env, next);
  return signInPage(
    env,
    "Pick a username",
    html`${paneHeading("Pick a username", game)}
<form method="post" action="/join/username" id="join-form">
${nextField(next)}
${usernameCutField(given)}
${botCheck(env, "join")}
${paneProblem(error)}
${primaryButton("Next", { isFullWidth: true, isBig: true, busyLabel: "One moment" })}
</form>
${TERMS_LINE}
${scriptTags(USERNAME_SCRIPT)}`,
    { checkedPage: "Pick a username", game, httpStatus: error || given.usernameError ? 400 : 200 },
  );
}

/**
 * A closed account (a whole-account ban, bans.ts), once it proved it's theirs: why, and how to appeal. It makes no session, so
 * Sign out only goes back to the sign-in page, which clears a cookie the ban left behind.
 * Child safety says no rule and no why, like a takedown.
 */
function closedAccountPage(env: Env, account: Account): Response {
  const rule = account.ban_content_rule && account.ban_content_rule !== "child_safety" && isContentRule(account.ban_content_rule) ? account.ban_content_rule : null;
  const why = account.ban_content_rule === "child_safety" ? null : account.ban_reason?.replace(/\.$/, "");
  const broke = rule ? html`the content rules on ${textLink(CONTENT_RULE_WORDS[rule], `/legal/content-rules#${rule}`)}` : html`Zaisma's rules`;
  return signInPage(
    env,
    "This account is closed",
    html`<h1>This account is closed</h1>
<p>Zaisma closed ${account.username} for breaking ${broke}${why ? html`: ${why}` : ""}.</p>
<p class="note">It can't sign in, and any games it made are down.</p>
<p><strong>Think this is a mistake?</strong> Write to ${APPEAL_EMAIL} with the username. A person reads every appeal and answers.</p>
<div class="ways">${secondaryButton(`Email ${APPEAL_EMAIL}`, { href: `mailto:${APPEAL_EMAIL}?subject=${encodeURIComponent(`Appeal: ${account.username}`)}`, isFullWidth: true })}
${tertiaryButton("Sign out", { href: "/signin", isFullWidth: true })}</div>`,
    { checkedPage: "Account closed", httpStatus: 403 },
  );
}

function tooYoungPage(env: Env): Response {
  return signInPage(
    env,
    "You can't make an account",
    html`<h1>You can't make an account</h1>
<p>You can still play as a guest in any game that doesn't need one.</p>
${tertiaryButton("Find a game", { href: "/", hasArrow: true, isFullWidth: true })}`,
    { checkedPage: "Make an account, too young" },
  );
}

// Just signed in or joined: tell the game tab that opened this one, and bring this device's
// recently played games over to the account.
const JOINED_SCRIPT = pageScript("joined", `(()=>{try{new BroadcastChannel("zaisma").postMessage("signed-in")}catch{}
let p=[];try{p=JSON.parse(localStorage.getItem("zaisma:played")||"[]")}catch{}
if(p.length)fetch("/api/me/played",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({played:p.slice(0,20).map(g=>({slug:g.slug,played_at_ms:g.played_at_ms??g.at}))})}).catch(()=>{})})();`);

// This tab was opened by a game: going back to it closes this tab, so the game keeps running where the player left off.
// [data-back] is the link itself or holds it.
const BACK_TO_GAME_SCRIPT = pageScript("back-to-game", `document.querySelectorAll("[data-back]").forEach((holder) => {
  const link = holder.matches("a") ? holder : holder.querySelector("a");
  if (!link) return;
  link.addEventListener("click", (e) => {
    if (!window.opener || window.opener.closed) return;
    e.preventDefault();
    try { window.opener.focus(); } catch {}
    window.close();
    // Some browsers won't close it: then just go to the game here.
    setTimeout(() => (location.href = link.href), 300);
  });
});`);

/** Where "Keep your progress" lands once the guest has an account (or signed in), in the tab it opened. */
async function keptPage(env: Env, account: Account, slug: string | null): Promise<Response> {
  const game = slug && /^[a-z0-9-]+$/.test(slug) ? await gameBySlug(env.DB, slug) : null;
  const back = game ? `/g/${game.slug}?play` : "/";
  return signInPage(
    env,
    "You're in",
    html`<h1>You're in, ${account.username}</h1>
<p>${game ? `Go back to ${game.title} to keep playing.${game.cloud_saves_enabled ? " From now on, your progress saves to your account, so it's safe and follows you to any device." : ""}` : "From now on, games you play save your progress to your account."}</p>
<div data-back>${primaryButton(game ? `Back to ${game.title}` : "Find a game", { href: back, isFullWidth: true, isBig: true })}</div>
${scriptTags(JOINED_SCRIPT)}`,
    { checkedPage: "You're in", account },
  );
}

export const LEVEL_LABELS: Record<AccessLevel, [string, string]> = {
  read: ["Read", "See games, versions, stats, the database, saves and the forum. Changes nothing."],
  upload: ["Upload", "Upload new versions as drafts, without publishing them or posting. For CI."],
  publish: ["Publish", "Upload and publish versions, change game details and tester links, and post on the forum. Can't run SQL, change saves, or change sign-in apps and webhooks."],
  full: ["Full", "Everything. For your own AI tool."],
  custom: ["Custom", "Choose for each area."],
};

/** Each area on the custom step: its name, and what it covers. */
export const AREA_LABELS: Record<AccessArea, [string, string]> = {
  game_access: ["Games", "Details, images, visibility, tester links and secrets. Write also makes new games."],
  version_access: ["Versions", "Uploading, publishing, scheduling and rolling back."],
  stats_access: ["Stats", "Stats, player reports and history."],
  database_access: ["Game databases", "Read-only sees tables and use, and exports. Write runs SQL and imports."],
  save_access: ["Players' saves", "Read-only reads saves and their copies. Write changes, resets and restores them."],
  purchase_access: ["Items and purchases", "Read-only sees items, sales and grants. Write sets items, grants them and refunds."],
  forum_access: ["Developer forum", "Write posts, replies, votes and messages to Zaisma in your name."],
  sign_in_app_access: ["Sign-in apps", "Belong to your whole account, so only a key for all your games reaches them."],
  webhook_access: ["Webhooks", "Belong to your whole account, so only a key for all your games reaches them."],
  credit_access: ["Hosting credit", "Read-only sees the balance and spending. Write also starts top-ups and refunds, and turns spending off or down; turning it on or up always needs your passkey here."],
  stripe_account_access: ["Stripe account", "Belongs to your whole account. Read-only sees the connected account. Write also turns Stripe Tax on or off and disconnects; connecting always needs your passkey here."],
};

const AREA_SHORT_LABELS: Record<AccessArea, string> = { game_access: "games", version_access: "versions", stats_access: "stats", database_access: "database", save_access: "saves", purchase_access: "items and purchases", forum_access: "forum", sign_in_app_access: "sign-in apps", webhook_access: "webhooks", credit_access: "credit", stripe_account_access: "Stripe account" };

/** The common words for each choice, as GitHub's tokens say them. */
export const CHOICE_LABELS: Record<string, string> = { none: "No access", read: "Read-only", write: "Read and write", upload: "Upload", publish: "Upload and publish" };

/** How a key stands: when it was made and last used (with what and from where), or why it stopped working. */
export function keyStandingText(key: ApiKey): string {
  const state = keyStateOf(key);
  if (state === "turned_off") return `Turned off ${day(key.turned_off_at_ms!)}: ${foundWords(key)}. Make a new key and remove this one.`;
  if (state === "ended") return `Ended ${day(key.ends_at_ms!)}. Make a new key and remove this one.`;
  const place = whereText({ device: null, network_name: key.last_used_network_name, city_name: key.last_used_city_name, region_name: key.last_used_region_name, country_code: key.last_used_country_code });
  const lastUsed = key.last_used_at_ms ? `last used ${day(key.last_used_at_ms)}${key.last_used_device ? ` with ${key.last_used_device}` : ""}${place ? ` · ${place}` : ""}` : "not used yet";
  return `${key.kind === "connected_app" ? "Connected" : "Made"} ${day(key.created_at_ms)} · ${lastUsed}${key.ends_at_ms ? ` · ends ${day(key.ends_at_ms)}` : ""}`;
}

/** What a key can do and on which games, in a few words, for the list of keys. */
/**
 * One key in a list: its name and what it can do, then how it stands. A key that works says when it was made,
 * last used (with what and from where, when the account keeps that) and its end date; one Zaisma turned off says
 * where it was found; one past its end date says so. The buttons are the list's own.
 */
function keyRow(key: ApiKey, games: { slug: string; title: string }[], buttons: Raw): Raw {
  const state = keyStateOf(key);
  const standing = keyStandingText(key);
  // A connected app (an AI app that signed in, mcp-sign-in.ts) is listed with the keys, saying where it sends you back.
  const kindNote = key.kind === "connected_app" ? html` <span class="muted small">connected app · ${key.connected_app_host ?? ""}</span>` : "";
  return html`<li${state === "on" ? "" : raw(' class="off"')}><span><span class="key-name">${key.name}</span>${kindNote} <span class="why muted small">${keyScopeText(key, games)}</span><span class="why muted small">${standing}</span></span>
${buttons}</li>`;
}

export function keyScopeText(key: ApiKey, games: { slug: string; title: string }[]): string {
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

/**
 * Confirm it's you on the account page, in the popup (components/confirm-its-you.ts): every action that needs a proof (data-confirm="strong" for
 * what changes how the account signs in, downloads or deletes it; "add" for a new passkey) is pressed once, and a button with nothing proven yet
 * opens the popup first, then goes on by itself. zaismaAskAccountConfirm(kind) answers true when it's proven (now, or just now) and false when
 * it wasn't. The server checks every proof again, so a page with a stale idea of it only asks too often or sends the old redirect.
 */
const ACCOUNT_CONFIRM_SCRIPT = pageScript("account-confirm", `(() => {
  const data = JSON.parse(document.getElementById("account-confirm-data").textContent);
  const REASONS = { strong: "This changes how you sign in, or what happens to your account, so we check it's you first.", add: "Adding a passkey takes a quick check that it's you." };
  // When each kind of proof ends, in this page's own time, a little before the server's so a press never lands on a proof about to run out.
  const SAFETY_MS = 5000;
  const until = { strong: performance.now() + data.is_confirmed_for_ms - SAFETY_MS, add: performance.now() + data.is_proven_for_ms - SAFETY_MS };
  const isProven = (kind) => performance.now() < until[kind];
  function ask(kind) {
    if (isProven(kind)) return Promise.resolve(true);
    return new Promise((resolve) => {
      let method = null;
      const opened = window.zaismaConfirmItsYou("account-confirm", {
        methods: kind === "strong" ? data.strong_methods : data.add_methods,
        reason: REASONS[kind],
        passkeyPurpose: "confirm",
        send: async (proof) => {
          const answer = await pkPost("/api/account/confirm", proof.method === "passkey" ? { passkey_tap: proof.passkey_tap } : { password: proof.password });
          if (answer.ok) method = proof.method;
          return answer.ok ? { ok: true } : { ok: false, message: answer.data.error || "That didn't work. Try again." };
        },
        onConfirmed: () => {
          // A password counts for everything unless the account has a passkey that can approve: then it only lets them add one.
          const endsAt = performance.now() + 10 * 60000 - SAFETY_MS;
          until.add = endsAt;
          if (!data.is_passkey_needed || method === "passkey") until.strong = endsAt;
          resolve(true);
        },
        onCancelled: () => resolve(false),
      });
      if (opened) return;
      // Nothing here can prove it: no passkey this browser can use, no password. A code to their email is on the page when that's the way.
      const code = document.getElementById("confirm");
      const problem = document.getElementById("confirm-problem");
      if (code) { code.open = true; code.scrollIntoView({ block: "center" }); }
      else { problem.textContent = "Confirming it's you needs your passkey, and this browser can't use passkeys. Try another browser or device."; problem.hidden = false; }
      resolve(false);
    });
  }
  window.zaismaAskAccountConfirm = ask;
  for (const form of document.querySelectorAll("form[data-confirm]")) {
    form.addEventListener("submit", (event) => {
      const kind = form.dataset.confirm;
      // Keeping where the account is used from only asks when it's being turned off.
      if (isProven(kind) || (form.dataset.confirmWhen === "unchecked" && form.querySelector('input[type="checkbox"]').checked)) return;
      event.preventDefault();
      const submitter = event.submitter || undefined;
      ask(kind).then((isRight) => { if (isRight) form.requestSubmit(submitter); });
    });
  }
  for (const link of document.querySelectorAll("a[data-confirm]")) {
    link.addEventListener("click", (event) => {
      if (isProven(link.dataset.confirm)) return;
      event.preventDefault();
      event.stopPropagation();
      ask(link.dataset.confirm).then((isRight) => { if (isRight) link.click(); });
    });
  }
})();`);

// The new key's steps: what it's called, which games, what it can do (and each area, for a custom key).

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
function activitySection(activity: ActivityEvents, query: URLSearchParams, isConfirmed: boolean): Raw {
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
<form class="stack" method="post" action="/account/where-used-from"${isConfirmed ? "" : raw(' data-confirm="strong" data-confirm-when="unchecked"')}>
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
  const [games, keys, passkeys, signIns, activity, creditKeptCents] = await Promise.all([
    gamesOwnedBy(env.DB, account.id),
    apiKeysFor(env.DB, account.id),
    passkeysFor(env.DB, account.id),
    signInGrantsFor(env.DB, account.id),
    activityAnswer(env, account, null),
    creditKeptOnDeletionCents(env, account.id),
  ]);
  // Changing how they sign in, and deleting the account, need the strongest proof the account has; otherwise "Confirm it's you" first.
  const { isConfirmed, isPasskeyNeeded, remainingMs } = await confirmationOf(env, session, account.id);
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
  // The invisible check runs on asking for an email code: adding an email, or confirming with a code.
  const hasCodeForm = Boolean(env.TURNSTILE_SITE_KEY);
  // What changes how they sign in (and downloading and deleting) asks for a proof when its button is pressed, in the popup (ACCOUNT_CONFIRM_SCRIPT):
  // a passkey when the account has one that can approve, else the password. Adding a passkey takes any proof, so the password does it too, which waits a day.
  const confirmData = {
    is_proven_for_ms: remainingMs,
    is_confirmed_for_ms: isConfirmed ? remainingMs : 0,
    is_passkey_needed: isPasskeyNeeded,
    strong_methods: isPasskeyNeeded ? ["passkey"] : hasPassword ? ["password"] : [],
    add_methods: [...(isPasskeyNeeded ? ["passkey"] : []), ...(hasPassword ? ["password"] : [])],
  };
  const needsConfirm = (kind: "strong" | "add" = "strong") => raw(` data-confirm="${kind}"`);
  // Without a password or a passkey to prove it with, a code to the email does it (a full page, so the press that asked is pressed again after).
  const confirmWithCode = html`<form method="post" action="/account/confirm" id="confirm-form">${botCheck(env, "email_code")}<button class="btn" type="submit">Email me a code</button></form>`;
  return page(
    env,
    "Your account",
    html`${welcome ? html`<p class="note">Welcome to Zaisma, ${account.username}.</p>${scriptTags(JOINED_SCRIPT)}` : ""}
<h1>${account.username}</h1>
${email ? html`<p class="lead">${email}</p>` : ""}
<p><a class="btn ghost" href="${profilePath(account.username)}">Your profile</a></p>
${banScopeOf(account) === "developer"
      ? html`<p class="note" role="status">${accountBanned({ banScope: "developer", banReasonForDeveloper: account.ban_content_rule === "child_safety" ? null : account.ban_reason }).messageForPeople} Your games are down; you can still play, and <a href="/dashboard">export your games</a>. Think this is a mistake? Write to <a href="mailto:${APPEAL_EMAIL}?subject=${encodeURIComponent(`Appeal: ${account.username}`)}">${APPEAL_EMAIL}</a> with your username. A person reads every appeal and answers.</p>`
      : ""}
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
${query.has("confirm-first") ? html`<p class="note" role="status"><strong>Confirm it's you first.</strong> Press the button again and we'll ask.</p>` : ""}
<p class="error" role="alert" id="confirm-problem" hidden></p>
${!isConfirmed && !hasPassword
      ? html`<details id="confirm"${query.has("confirm-first") ? raw(" open") : ""}><summary>Confirm with a code to your email</summary>
<p>${isPasskeyNeeded ? "Your passkey is the quickest way. Lost your passkeys? " : "You have no password or passkey to confirm with. "}A code to your email confirms it's you. Because none of your passkeys approved it, a passkey added this way can make API keys and change how you sign in a day after you add it${email ? ", and we'll email you about it" : ""}.</p>
${confirmWithCode}
</details>`
      : ""}
${scriptTags(ACCOUNT_CONFIRM_SCRIPT)}
${pageData("account-confirm-data", confirmData)}
<div class="not-steel">${confirmItsYouSheet({ id: "account-confirm" })}</div>
<h3 class="sub">Password</h3>
<p>${hasPassword ? `Set on ${day(account.password_changed_at_ms!)}.` : "No password yet. Add one to sign in with your username."}</p>
<form class="row" method="post" action="/account/password"${isConfirmed ? "" : needsConfirm()}><input type="password" name="password" minlength="${MINIMUM_PASSWORD_CHARACTER_COUNT}" autocomplete="new-password" required aria-label="New password" placeholder="New password"><button class="btn ghost" type="submit">${hasPassword ? "Change" : "Add"}</button></form>
<p class="hint">${PASSWORD_HINT}</p>
<h3 class="sub" id="email">Email</h3>
<p>${email ? html`<strong>${email}</strong>. A way back in if you forget your password. Never shown to anyone.` : "No email. Add one to get back in if you forget your password. Never shown to anyone."}</p>
<form class="row" method="post" action="/account/email" id="email-form"${isConfirmed ? "" : needsConfirm()}><input type="email" name="email" autocomplete="email" required aria-label="${email ? "New email" : "Email"}" placeholder="${email ? "New email" : "Email"}">${botCheck(env, "email_code")}<button class="btn ghost" type="submit">${email ? "Change" : "Add"}</button></form>
${email && hasPassword ? html`<form class="after-row" method="post" action="/account/email/remove"${isConfirmed ? "" : needsConfirm()}><button class="btn ghost" type="submit">Remove email</button></form>` : ""}
<h3 class="sub" id="passkeys">Passkeys</h3>
<p>Sign in with Face ID, a fingerprint or your device's PIN instead of your password.</p>
${query.has("passkey-added") ? html`<p class="note" role="status"><strong>Passkey added.</strong> Next time, choose Sign in with a passkey.</p>` : ""}
${query.has("confirmed-to-add") ? html`<p class="note" role="status">Thanks, that's you. You can add a new passkey for the next 10 minutes. It can make API keys and change how you sign in from tomorrow.</p>` : ""}
${query.has("passkey-waiting") && waitingPasskeys.length ? html`<p class="note" role="status">Passkey added. It can make API keys and change how you sign in from ${waitEndsText(Math.max(...waitingPasskeys.map((passkey) => passkey.approves_from_at_ms)))}.</p>` : ""}
${passkeys.length
      ? html`<ul class="keys">${passkeys.map(
          (passkey) => html`<li><span>Added on ${passkey.name} <span class="why muted small">${day(passkey.created_at_ms)}, ${passkey.last_used_at_ms ? `last used ${day(passkey.last_used_at_ms)}` : "not used yet"}</span>${passkey.approves_from_at_ms > nowMs ? html`<span class="why muted small">Can make API keys from ${waitEndsText(passkey.approves_from_at_ms)}</span>` : ""}</span>
<form method="post" action="/account/passkeys/${passkey.id}/remove"${isConfirmed ? "" : needsConfirm()}><button class="btn ghost" type="submit">Remove</button></form></li>`,
        )}</ul>`
      : ""}
<div class="row" id="passkey-add-row"><button class="btn${passkeys.length ? " ghost" : ""}" type="button" id="passkey-add">Add a passkey</button></div>
<p class="error" role="alert" id="passkey-error" hidden></p>
${scriptTags(PASSKEY_ADD_SCRIPT)}
${activitySection(activity, query, isConfirmed)}
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
<p>Manage your games on <a href="/dashboard">your games page</a>. API keys, connected AI apps, webhooks, sign-in apps, hosting credit and Zaisma Pro are on <a href="/dashboard/settings">Developer settings</a>.</p>
<h2>Sign out</h2>
<form method="post" action="/signout"><button class="btn ghost" type="submit">Sign out on every device</button></form>
<h2 id="your-data">Download your data</h2>
<p>A copy of everything Zaisma keeps about your account, with your game saves as files, in one .zip.</p>
<p><a class="btn ghost" href="/account/data.zip" data-download${isConfirmed ? "" : needsConfirm()}>Download your data</a></p>
<h2 id="delete-account">Delete account</h2>
<details><summary>Delete your account</summary>
<p>This deletes your username, any email, game saves and everything else on your account straight away. Unused hosting credit from the last 30 days goes back to the card it was paid with; older credit doesn't come back.${creditKeptCents > 0 ? ` That's $${(creditKeptCents / 100).toFixed(2)} of your credit.` : ""} Games you played and sites you signed in to with Zaisma are told, so their developers can erase what they kept about you. It can't be undone.</p>
${games.length
          ? html`<p>Your games are deleted with it, with their files, database and every player's saves, and their links never go to another game:</p>
<ul>${games.map((game) => html`<li>${game.title} <span class="muted">(zaisma.com/g/${game.slug})</span></li>`)}</ul>`
          : ""}
<form class="row" method="post" action="/account/delete"${isConfirmed ? "" : needsConfirm()}>
<input name="confirm" placeholder='Type "delete"' aria-label='Type "delete" to confirm' autocomplete="off" required>
<button class="btn danger" type="submit">Delete my account</button>
</form>
</details>
<p class="muted small">Account ID: <code>${account.id}</code></p>`,
    200,
    hasCodeForm,
    account,
  );
}
