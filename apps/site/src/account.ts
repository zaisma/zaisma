import {
  MAX_API_KEYS,
  NAME_RULES,
  accountById,
  ageBand,
  ageOn,
  apiKeysFor,
  checkName,
  createAccount,
  createApiKey,
  deleteAccount,
  gameBySlug,
  gamesOwnedBy,
  passkeysFor,
  revokeApiKey,
  updateAccount,
  type AgeBand,
} from "@zaisma/core";
import {
  authConfigured,
  clearSessionCookies,
  currentSession,
  deleteAuthUser,
  readCookie,
  sendCode,
  sessionCookies,
  setCookie,
  signOutEverywhere,
  verifyCode,
  type Session,
} from "./auth.ts";
import type { Env } from "./env.ts";
import { html, layout, message, metalButton, raw, type Raw } from "./html.ts";
import { PASSKEY_SCRIPT, RECENT_SIGNIN_MS } from "./passkeys.ts";
import { deleteSaveFiles } from "./saves.ts";

/**
 * Sign-in, account creation and the account page.
 *
 * New accounts answer the age question before they type an email, so we collect
 * nothing from under-13s. The birth date is used once and never stored; we keep
 * the band (13–17 or 18+). "Sign in" never creates accounts, so it can't skip the question.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const BLOCK_SECONDS = 24 * 3600;
const JOIN_SECONDS = 3600;

export async function handleAccount(request: Request, env: Env, path: string): Promise<Response | null> {
  if (
    !["/signin", "/signin/code", "/join", "/join/age", "/join/email", "/join/name", "/account", "/account/kept", "/account/name", "/account/age", "/account/delete", "/account/keys", "/signout"].includes(path) &&
    !/^\/account\/keys\/[a-z0-9]+\/revoke$/.test(path)
  ) return null;
  if (!authConfigured(env)) return message(env, "Accounts aren't on yet", "You can play every game as a guest.", 404);

  const post = request.method === "POST";
  if (post) {
    // Forms only come from our own pages.
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return new Response("Bad origin", { status: 403 });
  }
  const form = post ? await request.formData() : null;
  const field = (name: string, max = 200) => String(form?.get(name) ?? "").trim().slice(0, max);
  const next = safeNext(form ? field("next") : new URL(request.url).searchParams.get("next"));
  const session = await currentSession(request, env);
  const done = (res: Response) => withCookies(res, session?.cookies ?? []);

  if (path === "/signin" && !post) return done(session ? redirect(next ?? "/account") : signinPage(env, next));
  if (path.startsWith("/join") && readCookie(request, env, "zaisma_age") === "no") return done(tooYoungPage(env));

  if (path === "/signin" || path === "/join/email") {
    if (await limited(env, request)) return message(env, "Slow down", "Too many tries. Wait a minute and try again.", 429);
    const email = field("email", 320).toLowerCase();
    if (!EMAIL.test(email)) return path === "/signin" ? signinPage(env, next, "Enter your email address.") : joinEmailPage(env, next, field("name"), "Enter your email address.");
    const cookies: string[] = [];
    if (path === "/join/email") {
      const band = joinBand(request, env);
      if (!band) return redirect("/join");
      const checked = checkName(field("name", 60));
      if ("error" in checked) return joinEmailPage(env, next, field("name"), checked.error, email);
      cookies.push(setCookie(env, "zaisma_join", encodeURIComponent(JSON.stringify({ band, name: checked.name })), { maxAge: JOIN_SECONDS }));
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
    await createAccount(env.DB, { id: signedIn.userId, name: join.name, ageBand: join.band });
    cookies.push(setCookie(env, "zaisma_join", "", { maxAge: 0 }));
    return withCookies(redirect(next ?? "/account?welcome"), cookies);
  }

  // --- Making an account ---
  if (path.startsWith("/join")) {
    const account = session ? await accountById(env.DB, session.userId) : null;
    if (account) return done(redirect(next ?? "/account"));

    if (path === "/join" && !post) return done(agePage(env, next));

    if (path === "/join/age" && post) {
      const age = ageOn({ year: Number(field("year")), month: Number(field("month")), day: Number(field("day")) }, new Date());
      if (age === null) return done(agePage(env, next, "Choose your full birth date."));
      const band = ageBand(age);
      if (!band) {
        // Under 13: no account. Anything Supabase already holds (a half-finished sign-in) is deleted now.
        const cookies = [setCookie(env, "zaisma_age", "no", { maxAge: BLOCK_SECONDS }), setCookie(env, "zaisma_join", "", { maxAge: 0 })];
        if (session) {
          await deleteAuthUser(env, session.userId);
          cookies.push(...clearSessionCookies(env));
        }
        return withCookies(tooYoungPage(env), cookies);
      }
      const cookie = setCookie(env, "zaisma_join", encodeURIComponent(JSON.stringify({ band })), { maxAge: JOIN_SECONDS });
      // Already signed in (they verified an email but never finished): skip straight to the name.
      return withCookies(session ? joinNamePage(env, next) : joinEmailPage(env, next), [...(session?.cookies ?? []), cookie]);
    }

    if (path === "/join/name" && post && session) {
      const band = joinBand(request, env);
      if (!band) return done(redirect("/join"));
      const checked = checkName(field("name", 60));
      if ("error" in checked) return done(joinNamePage(env, next, checked.error, field("name")));
      await createAccount(env.DB, { id: session.userId, name: checked.name, ageBand: band });
      return withCookies(redirect(next ?? "/account?welcome"), [...session.cookies, setCookie(env, "zaisma_join", "", { maxAge: 0 })]);
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

  // Teens can move to 18+ once they're 18. Nobody moves the other way, and the date isn't kept.
  if (path === "/account/age" && post && account.age_band === "13-17") {
    const age = ageOn({ year: Number(field("year")), month: Number(field("month")), day: Number(field("day")) }, new Date());
    if (age === null || age < 18) return done(await accountPage(env, session, false, "That birth date isn't 18 or over yet."));
    await updateAccount(env.DB, account.id, { ageBand: "18+" });
    return done(redirect("/account"));
  }

  // API keys for the developer MCP and upload command. The key is shown once, here.
  if (path === "/account/keys" && post) {
    const name = field("name", 40) || "My key";
    if ((await apiKeysFor(env.DB, account.id)).length >= MAX_API_KEYS) return done(await accountPage(env, session, false, `You can have up to ${MAX_API_KEYS} keys. Remove one first.`));
    const { token } = await createApiKey(env.DB, account.id, name);
    return done(await accountPage(env, session, false, undefined, { name, token }));
  }
  const revoke = path.match(/^\/account\/keys\/([a-z0-9]+)\/revoke$/);
  if (revoke && post) {
    await revokeApiKey(env.DB, account.id, revoke[1]!);
    return done(redirect("/account#developer"));
  }

  if (path === "/account/delete" && post) {
    if (field("confirm").toLowerCase() !== "delete") return done(await accountPage(env, session, false, 'Type "delete" to confirm.'));
    if (!(await deleteAuthUser(env, session.userId))) return done(message(env, "Couldn't delete your account", "Something went wrong on our side. Try again later.", 502));
    await deleteSaveFiles(env, account.id);
    await deleteAccount(env.DB, account.id);
    return withCookies(message(env, "Your account is deleted", "Your email, name, game saves and everything else on your account are gone. You can still play as a guest."), clearSessionCookies(env));
  }

  return done(redirect("/account"));
}

// --- Helpers ---

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
}

function withCookies(res: Response, cookies: string[]): Response {
  const out = new Response(res.body, res);
  for (const c of cookies) out.headers.append("Set-Cookie", c);
  out.headers.set("Cache-Control", "no-store");
  return out;
}

/** Only our own paths, never another site. */
function safeNext(value: string | null | undefined): string | null {
  return value && /^\/(?![/\\])[\w\-./?=&%]*$/.test(value) && value.length < 200 ? value : null;
}

const nextQuery = (next: string | null) => (next ? `?next=${encodeURIComponent(next)}` : "");

async function limited(env: Env, request: Request): Promise<boolean> {
  // Keyed by connection address, checked by Cloudflare and never stored.
  return env.SIGNIN_LIMIT ? !(await env.SIGNIN_LIMIT.limit({ key: request.headers.get("cf-connecting-ip") ?? "local" })).success : false;
}

function joinDetails(request: Request, env: Env): { band: AgeBand; name?: string } | null {
  try {
    const j = JSON.parse(decodeURIComponent(readCookie(request, env, "zaisma_join") ?? "")) as { band?: string; name?: string };
    return j.band === "13-17" || j.band === "18+" ? { band: j.band, name: typeof j.name === "string" ? j.name : undefined } : null;
  } catch {
    return null;
  }
}

const joinBand = (request: Request, env: Env) => joinDetails(request, env)?.band ?? null;

// --- Pages ---

function page(env: Env, title: string, body: Raw, status = 200): Response {
  const res = layout(env, { title: `${title} · Zaisma`, body: html`<div class="narrow">${body}</div>`, private: true });
  return new Response(res.body, { status, headers: res.headers });
}

const err = (text?: string) => (text ? html`<p class="error" role="alert">${text}</p>` : "");
const nextField = (next: string | null) => (next ? html`<input type="hidden" name="next" value="${next}">` : "");

function signinPage(env: Env, next: string | null, error?: string): Response {
  return page(
    env,
    "Sign in",
    html`<h1>Sign in</h1>
<p class="lead">We'll email you a code. No password needed.</p>
${err(error)}
<div class="passkey-in" id="passkey-in" hidden>
<button class="btn" type="button" id="passkey-go">${raw(ICON_PASSKEY)}Sign in with a passkey</button>
<p class="error" role="alert" id="passkey-error" hidden></p>
<p class="or"><span>or get a code</span></p>
</div>
<form class="stack" method="post" action="/signin">
${nextField(next)}
<label>Email<input type="email" name="email" autocomplete="email webauthn" required autofocus></label>
<button class="btn" type="submit" id="code-go">Email me a code</button>
</form>
<p class="muted">New here? <a href="/join${nextQuery(next)}">Make an account</a>. You don't need one to play.</p>
<script>${raw(PASSKEY_SCRIPT)}
(() => {
  if (!window.PublicKeyCredential) return;
  // Passkeys first, the email code as the way in for new devices.
  document.getElementById("passkey-in").hidden = false;
  document.getElementById("code-go").classList.add("ghost");
  const next = ${raw(JSON.stringify(next ?? "/").replace(/</g, "\u003c"))};
  const show = (e) => { const p = document.getElementById("passkey-error"); p.textContent = e || ""; p.hidden = !e; };
  document.getElementById("passkey-go").onclick = async () => show(await zaismaPasskeySignIn(next, false));
  // Browsers that can also offer passkeys in the email box's autofill.
  if (PublicKeyCredential.isConditionalMediationAvailable) PublicKeyCredential.isConditionalMediationAvailable().then((ok) => ok && zaismaPasskeySignIn(next, true).then(show));
})();
</script>`,
  );
}

export function codePage(env: Env, email: string, next: string | null, error?: string, confirm = false): Response {
  return page(
    env,
    "Check your email",
    html`<h1>Check your email</h1>
<p class="lead">${confirm ? html`We sent a code to <strong>${email}</strong>. Enter it to confirm it's you.` : html`If <strong>${email}</strong> has a Zaisma account or you're making one, a code is on its way.`}</p>
${err(error)}
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
  const year = new Date().getUTCFullYear();
  return html`<div class="row birth">
<label>Month<select name="month" required><option value="">Month</option>${MONTHS.map((m, i) => html`<option value="${i + 1}">${m}</option>`)}</select></label>
<label>Day<select name="day" required><option value="">Day</option>${Array.from({ length: 31 }, (_, i) => html`<option>${i + 1}</option>`)}</select></label>
<label>Year<select name="year" required><option value="">Year</option>${Array.from({ length: 100 }, (_, i) => html`<option>${year - i}</option>`)}</select></label>
</div>`;
}

function agePage(env: Env, next: string | null, error?: string): Response {
  return page(
    env,
    "Make an account",
    html`<h1>Make an account</h1>
<p class="lead">Keep your progress, play with friends and get your own name. Guests can still play everything.</p>
${err(error)}
<form class="stack" method="post" action="/join/age">
${nextField(next)}
<fieldset><legend>When's your birthday?</legend>${birthFields()}</fieldset>
<p class="muted">We only keep your age group, never your birth date.</p>
<button class="btn" type="submit">Next</button>
</form>
<p class="muted">Have an account? <a href="/signin${nextQuery(next)}">Sign in</a>.</p>`,
  );
}

function joinEmailPage(env: Env, next: string | null, name = "", error?: string, email = ""): Response {
  return page(
    env,
    "Make an account",
    html`<h1>Make an account</h1>
${err(error)}
<form class="stack" method="post" action="/join/email">
${nextField(next)}
<label>Your name<input name="name" value="${name}" minlength="3" maxlength="20" autocomplete="nickname" required autofocus><span class="hint">What other players see. ${NAME_RULES} Don't use your real name.</span></label>
<label>Email<input type="email" name="email" value="${email}" autocomplete="email" required><span class="hint">Only for signing in. Never shown to anyone.</span></label>
<button class="btn" type="submit">Email me a code</button>
</form>
<p class="muted">By making an account you agree to the <a href="/legal/content-rules">content rules</a> and our <a href="/legal/privacy">privacy policy</a>.</p>`,
    error ? 400 : 200,
  );
}

function joinNamePage(env: Env, next: string | null, error?: string, name = ""): Response {
  return page(
    env,
    "Pick a name",
    html`<h1>Pick a name</h1>
${err(error)}
<form class="stack" method="post" action="/join/name">
${nextField(next)}
<label>Your name<input name="name" value="${name}" minlength="3" maxlength="20" autocomplete="nickname" required autofocus><span class="hint">What other players see. ${NAME_RULES} Don't use your real name.</span></label>
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
<p class="lead">You can't make a Zaisma account yet, but you can still play every game as a guest.</p>
<a class="btn" href="/">Find a game</a>`,
  );
}

// Just signed in or joined: tell the game tab that opened this one, and bring this device's
// recently played games over to the account.
const JOINED_SCRIPT = `<script>(()=>{try{new BroadcastChannel("zaisma").postMessage("signed-in")}catch{}
let p=[];try{p=JSON.parse(localStorage.getItem("zaisma:played")||"[]")}catch{}
if(p.length)fetch("/api/me/played",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({played:p.slice(0,20)})}).catch(()=>{})})()</script>`;

/** Where "Keep your progress" lands once the guest has an account (or signed in), in the tab it opened. */
async function keptPage(env: Env, name: string, slug: string | null): Promise<Response> {
  const game = slug && /^[a-z0-9-]+$/.test(slug) ? await gameBySlug(env.DB, slug) : null;
  const back = game ? `/g/${game.slug}?play` : "/";
  return page(
    env,
    "You're in",
    html`<h1>You're in, ${name}</h1>
<p class="lead">${game ? `Go back to ${game.title} to keep playing. From now on, your progress saves to your account, so it's safe and follows you to any device.` : "From now on, games you play save your progress to your account."}</p>
${metalButton(game ? `Back to ${game.title}` : "Find a game", { href: back, data: { back: "" } })}
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

const ICON_PASSKEY = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.9 3.1-7 7-7 1.2 0 2.4.3 3.4.9"/><circle cx="18" cy="13" r="2.5"/><path d="M18 15.5V21l1.5-1.2M18 18.5h1.5"/></svg>';

const BAND_TEXT: Record<AgeBand, string> = { "13-17": "13 to 17", "18+": "18 or over" };

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function accountPage(env: Env, session: Session, welcome: boolean, error?: string, made?: { name: string; token: string }, query = new URLSearchParams()): Promise<Response> {
  const account = (await accountById(env.DB, session.userId))!;
  const [games, keys, passkeys] = await Promise.all([gamesOwnedBy(env.DB, account.id), apiKeysFor(env.DB, account.id), passkeysFor(env.DB, account.id)]);
  // Adding a passkey needs a recent sign-in; otherwise an email code first.
  const recent = Date.now() - session.authAt < RECENT_SIGNIN_MS;
  return page(
    env,
    "Your account",
    html`${welcome ? html`<p class="note">Welcome to Zaisma, ${account.name}.</p>${raw(JOINED_SCRIPT)}` : ""}
<h1>${account.name}</h1>
<p class="lead">${session.email}</p>
${err(error)}
<h2>Name</h2>
<form class="row" method="post" action="/account/name">
<input name="name" value="${account.name}" minlength="3" maxlength="20" required aria-label="Name">
<button class="btn ghost" type="submit">Save</button>
</form>
<h2>Age group</h2>
<p>${BAND_TEXT[account.age_band]}.${account.age_band === "13-17" ? " Accounts for 13 to 17 year olds get safer settings." : ""}</p>
${account.age_band === "13-17"
      ? html`<details><summary>Turned 18?</summary><form class="stack" method="post" action="/account/age">${birthFields()}<button class="btn ghost" type="submit">Update</button></form></details>`
      : ""}
<h2 id="passkeys">Passkeys</h2>
<p>Sign in with Face ID, a fingerprint or your device's PIN instead of an email code. Your email still works if you lose a device.</p>
${query.has("passkey-added") ? html`<p class="note" role="status"><strong>Passkey added.</strong> Next time, choose Sign in with a passkey.</p>` : ""}
${query.has("passkey") && recent ? html`<p class="note" role="status">Thanks, that's you. Now add your passkey.</p>` : ""}
${query.has("passkey-failed") ? html`<p class="error" role="alert">Couldn't send a code. Wait a minute and try again.</p>` : ""}
${passkeys.length
      ? html`<ul class="keys">${passkeys.map(
          (k) => html`<li><span>Added on ${k.name} <span class="why muted small">${day(k.created_at)}, ${k.last_used_at ? `last used ${day(k.last_used_at)}` : "not used yet"}</span></span>
<form method="post" action="/account/passkeys/${k.id}/remove"><button class="btn ghost" type="submit">Remove</button></form></li>`,
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
${games.length
      ? html`<h2>Your games</h2><ul>${games.map((g) => html`<li><a href="/dashboard/${g.slug}">${g.title}</a> <span class="pill ${g.status}">${g.status}</span></li>`)}</ul>`
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
          (k) => html`<li><span>${k.name} <span class="muted small">made ${day(k.created_at)}, ${k.last_used_at ? `last used ${day(k.last_used_at)}` : "not used yet"}</span></span>
<form method="post" action="/account/keys/${k.id}/revoke"><button class="btn ghost" type="submit">Remove</button></form></li>`,
        )}</ul>`
      : ""}
<form class="row" method="post" action="/account/keys">
<input name="name" maxlength="40" placeholder="Key name, like My laptop" aria-label="Key name">
<button class="btn ghost" type="submit">Make an API key</button>
</form>
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
