import {
  FRIEND_INVITE_DURATION_DAYS,
  MAXIMUM_FRIEND_COUNT,
  MAXIMUM_OPEN_FRIEND_INVITE_COUNT,
  acceptFriendInvite,
  accountById,
  areFriends,
  createFriendInvite,
  friendInviteByCode,
  friendInviteCodeInWords,
  friendInvitesOf,
  friendsOf,
  isIdOf,
  readFriendInviteCode,
  removeFriend,
  removeFriendInvite,
  socialSettingsOf,
  type Account,
  type FriendInvite,
} from "@zaisma/core";
import { authConfigured, currentSession, type Session } from "./auth.ts";
import type { Env } from "./env.ts";
import { accountPicture, html, layout, message, metalButton, raw, type Raw } from "./html.ts";

/**
 * Friends (docs/DECISIONS.md, "How friends work"): the friend list, invites and the page an invite
 * link opens. Friends only ever come from an invite one of them gave the other by hand.
 */
export async function handleFriends(request: Request, env: Env, path: string): Promise<Response | null> {
  const inviteMatch = path.match(/^\/friends\/add\/([A-Za-z0-9-]{1,20})$/);
  const removeInviteMatch = path.match(/^\/friends\/invites\/([A-Z0-9]{8})\/remove$/);
  const removeFriendMatch = path.match(/^\/friends\/(player_[a-z0-9]{1,40})\/remove$/);
  if (!["/friends", "/friends/add", "/friends/invites"].includes(path) && !inviteMatch && !removeInviteMatch && !removeFriendMatch) return null;
  if (!authConfigured(env)) return message(env, "Accounts aren't on yet", "You can still play as a guest.", 404);

  const post = request.method === "POST";
  if (post) {
    // Forms only come from our own pages.
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return new Response("Bad origin", { status: 403 });
  }
  const session = await currentSession(request, env);
  const account = session ? await accountById(env.DB, session.userId) : null;
  const done = (response: Response) => withCookies(response, session?.cookies ?? []);

  // An invite link: who it's from, then Add friend. Anyone with the link sees the name, as on a profile.
  if (inviteMatch) {
    const inviteCode = readFriendInviteCode(inviteMatch[1]);
    // A code typed by hand in another case or with its dash goes to its one address.
    if (inviteCode && inviteCode !== inviteMatch[1] && !post) return done(redirect(`/friends/add/${inviteCode}`));
    const invite = inviteCode ? await friendInviteByCode(env.DB, inviteCode) : null;
    if (!invite) return done(invitePage(env, html`<h1>This invite doesn't work</h1><p class="lead">It was already used, taken back or ran out: invites work once, for ${FRIEND_INVITE_DURATION_DAYS} days. Ask your friend for a new one.</p>${account ? html`<a class="btn ghost" href="/friends">Your friends</a>` : ""}`, 404));
    if (!session || !account) {
      const back = encodeURIComponent(`/friends/add/${invite.invite_code}`);
      return done(
        invitePage(
          env,
          html`${inviter(invite.name)}<h1>${invite.name} invited you to be friends</h1>
<p class="lead">Friends on Zaisma can find each other in games and chat where their chat settings allow. Sign in, or make an account, to say yes.</p>
<div class="row">${metalButton("Sign in", { href: `/signin?next=${back}` })}<a class="btn ghost" href="/join?next=${back}">Make an account</a></div>`,
        ),
      );
    }
    if (post) {
      const accepted = await acceptFriendInvite(env.DB, account.id, invite.invite_code);
      if ("friend" in accepted) return done(redirect(`/friends?added=${accepted.friend.player_id}`));
      return done(invitePage(env, html`${inviter(invite.name)}<h1>Couldn't add ${invite.name}</h1><p class="lead">${ACCEPT_ERRORS[accepted.error](invite.name)}</p><a class="btn ghost" href="/friends">Your friends</a>`, 409));
    }
    if (invite.account_id === account.id) {
      return done(invitePage(env, html`<h1>This is your own invite</h1><p class="lead">Send it to a friend: when they open it and say yes, you're friends.</p><p><code class="key">${inviteUrl(env, invite.invite_code)}</code></p><a class="btn ghost" href="/friends">Your friends</a>`));
    }
    if (await areFriends(env.DB, account.id, invite.account_id)) {
      return done(invitePage(env, html`${inviter(invite.name)}<h1>You and ${invite.name} are already friends</h1><a class="btn ghost" href="/friends">Your friends</a>`));
    }
    return done(
      invitePage(
        env,
        html`${inviter(invite.name)}<h1>Add ${invite.name} as a friend?</h1>
<p class="lead">${invite.name} sent you this invite. Friends can find each other in games and chat where both their chat settings allow it. Either of you can remove the other at any time.</p>
<form method="post" action="/friends/add/${invite.invite_code}">${metalButton("Add friend", { type: "submit" })}</form>
<p class="muted small">Don't know who this is? Just close this page.</p>`,
      ),
    );
  }

  if (!session) return redirect(`/signin?next=${encodeURIComponent("/friends")}`);
  if (!account) return done(redirect("/join"));
  const form = post ? await request.formData() : null;

  // A code typed into the box: the invite's own page says who it's from before anything happens.
  if (path === "/friends/add" && post) {
    if (await limited(env, request)) return done(message(env, "Slow down", "Too many tries. Wait a minute and try again.", 429));
    const inviteCode = readFriendInviteCode(String(form?.get("invite_code") ?? "").slice(0, 20));
    if (!inviteCode) return done(await friendsPage(env, session, account, new URLSearchParams(), "An invite code is 8 letters and numbers, like K7Q2-MX9P."));
    return done(redirect(`/friends/add/${inviteCode}`));
  }
  if (path === "/friends/invites" && post) {
    const made = await createFriendInvite(env.DB, account.id);
    if ("error" in made) {
      const why = made.error === "too_many_friends" ? `You have ${MAXIMUM_FRIEND_COUNT} friends, the most there can be. Remove one to invite someone new.` : `You have ${MAXIMUM_OPEN_FRIEND_INVITE_COUNT} invites waiting. Take one back, or wait for a friend to use one.`;
      return done(await friendsPage(env, session, account, new URLSearchParams(), why));
    }
    return done(redirect(`/friends?invite=${made.invite.invite_code}#invite`));
  }
  if (removeInviteMatch && post) {
    await removeFriendInvite(env.DB, account.id, removeInviteMatch[1]!);
    return done(redirect("/friends#invite"));
  }
  if (removeFriendMatch && post && isIdOf("player", removeFriendMatch[1])) {
    await removeFriend(env.DB, account.id, removeFriendMatch[1]!);
    return done(redirect("/friends?removed"));
  }
  if (path === "/friends" && !post) return done(await friendsPage(env, session, account, new URL(request.url).searchParams));
  return done(redirect("/friends"));
}

const ACCEPT_ERRORS: Record<"invite_not_found" | "own_invite" | "already_friends" | "too_many_friends" | "inviter_has_too_many_friends", (name: string) => string> = {
  invite_not_found: () => "The invite was just used or ran out. Ask for a new one.",
  own_invite: () => "That's your own invite. Send it to a friend instead.",
  already_friends: (name) => `You and ${name} are already friends.`,
  too_many_friends: () => `You have ${MAXIMUM_FRIEND_COUNT} friends, the most there can be. Remove one first.`,
  inviter_has_too_many_friends: (name) => `${name} has ${MAXIMUM_FRIEND_COUNT} friends, the most there can be.`,
};

const inviteUrl = (env: Env, inviteCode: string) => `${env.SITE_ORIGIN}/friends/add/${inviteCode}`;

const inviter = (name: string) => html`<div class="who-invites">${accountPicture(name, "md")}</div>`;

function daysLeft(invite: FriendInvite): string {
  const dayCount = Math.max(1, Math.ceil((invite.expires_at_ms - Date.now()) / 86400_000));
  return dayCount === 1 ? "works for 1 more day" : `works for ${dayCount} more days`;
}

/** What the player's chat setting means for friends, in a line under the list. */
function chatLine(account: Account): Raw {
  const whoCanChat = socialSettingsOf(account).who_can_chat;
  if (whoCanChat === "nobody") return html`<p class="hint">Nobody can chat with you, so you don't chat with anyone in games, friends included. <a href="/account#social">Change it</a>.</p>`;
  if (whoCanChat === "friends") return html`<p class="hint">In games that have chat, you chat only with friends. <a href="/account#social">Social settings</a>.</p>`;
  return html`<p class="hint">In games that have chat, you chat with friends and with others who let anyone chat with them. <a href="/account#social">Social settings</a>.</p>`;
}

async function friendsPage(env: Env, session: Session, account: Account, query: URLSearchParams, error?: string): Promise<Response> {
  const [friends, invites] = await Promise.all([friendsOf(env.DB, account.id), friendInvitesOf(env.DB, account.id)]);
  const added = friends.find((friend) => friend.player_id === query.get("added"));
  const newInvite = invites.find((invite) => invite.invite_code === query.get("invite"));
  // The one just made is shown big above; the list is the others still waiting.
  const otherInvites = invites.filter((invite) => invite !== newInvite);
  return page(
    env,
    "Friends",
    html`<h1>Friends</h1>
<p class="lead">Friends join by an invite you give them yourself, as a link or a code. Nobody else can add you.</p>
${added ? html`<p class="note" role="status">You and ${added.name} are friends now.</p>` : ""}
${query.has("removed") ? html`<p class="note" role="status">Removed. You're no longer friends on either side.</p>` : ""}
${error ? html`<p class="error" role="alert">${error}</p>` : ""}
<h2 class="rule-h" id="invite">Invite a friend</h2>
${newInvite
      ? html`<div class="note invite-made" role="status"><p><strong>Send this to one friend.</strong> It works once, for ${FRIEND_INVITE_DURATION_DAYS} days.</p>
<p class="invite-code">${friendInviteCodeInWords(newInvite.invite_code)}</p>
<div class="row"><input readonly value="${inviteUrl(env, newInvite.invite_code)}" aria-label="Invite link"><button class="btn" type="button" data-share="${inviteUrl(env, newInvite.invite_code)}">Share</button></div></div>`
      : html`<p>Make a link for one friend. It works once, for ${FRIEND_INVITE_DURATION_DAYS} days, and they can also type its code here.</p>`}
<form method="post" action="/friends/invites">${newInvite ? html`<button class="btn ghost" type="submit">Make another</button>` : metalButton("Make an invite", { type: "submit" })}</form>
${otherInvites.length
      ? html`<ul class="keys">${otherInvites.map(
          (invite) => html`<li><span><code>${friendInviteCodeInWords(invite.invite_code)}</code> <span class="why muted small">${daysLeft(invite)}</span></span>
<span class="row"><button class="btn ghost" type="button" data-share="${inviteUrl(env, invite.invite_code)}">Share</button><form method="post" action="/friends/invites/${invite.invite_code}/remove"><button class="btn ghost" type="submit">Take back</button></form></span></li>`,
        )}</ul>`
      : ""}
<h2 class="rule-h">Got a code?</h2>
<form class="row" method="post" action="/friends/add">
<input name="invite_code" maxlength="12" placeholder="K7Q2-MX9P" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Invite code" required>
<button class="btn ghost" type="submit">Next</button>
</form>
<h2 class="rule-h" id="list">Your friends${friends.length ? ` (${friends.length})` : ""}</h2>
${friends.length
      ? html`<ul class="keys friends">${friends.map(
          (friend) => html`<li><span class="friend">${accountPicture(friend.name, "sm")}<span>${friend.name} <span class="why muted small">friends since ${day(friend.created_at_ms)}</span></span></span>
<form method="post" action="/friends/${friend.player_id}/remove" data-confirm="Remove ${friend.name} as a friend? You'd need a new invite to be friends again."><button class="btn ghost" type="submit">Remove</button></form></li>`,
        )}</ul>`
      : html`<p class="note">No friends yet. Make an invite above and send it to someone you play with.</p>`}
${chatLine(account)}
<p><a href="/account">Your account</a></p>
<style>${raw(FRIENDS_STYLES)}</style>
<script>${raw(FRIENDS_SCRIPT)}</script>`,
  );
}

const FRIENDS_STYLES = `.invite-made p{margin:0 0 10px}
.invite-code{font-family:var(--display);font-size:32px;font-weight:600;letter-spacing:.12em;color:var(--text)}
.invite-made .row input{flex:1;min-width:0}
.friends .friend{display:flex;align-items:center;gap:12px}
.who-invites{margin-bottom:16px}
.keys .row{gap:8px;flex-wrap:nowrap}
.keys code{white-space:nowrap}`;

// Share opens the share sheet on phones, otherwise copies the link; Remove asks first.
const FRIENDS_SCRIPT = `(()=>{document.querySelectorAll("[data-share]").forEach(b=>b.onclick=async()=>{const url=b.dataset.share;
if(navigator.share&&matchMedia("(pointer:coarse)").matches){try{await navigator.share({title:"Be my friend on Zaisma",url});return}catch(e){if(e.name==="AbortError")return}}
try{await navigator.clipboard.writeText(url);b.textContent="Copied";setTimeout(()=>b.textContent="Share",2000)}catch{const i=b.parentElement.querySelector("input");if(i)i.select()}});
document.querySelectorAll("form[data-confirm]").forEach(f=>f.addEventListener("submit",e=>{if(!confirm(f.dataset.confirm))e.preventDefault()}))})();`;

const day = (atMs: number) => new Date(atMs).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function page(env: Env, title: string, body: Raw, httpStatus = 200): Response {
  const response = layout(env, { title: `${title} · Zaisma`, body: html`<div class="narrow">${body}</div>`, isPrivate: true });
  return new Response(response.body, { status: httpStatus, headers: response.headers });
}

const invitePage = (env: Env, body: Raw, httpStatus = 200) => page(env, "Friend invite", body, httpStatus);

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
}

function withCookies(response: Response, cookies: string[]): Response {
  const out = new Response(response.body, response);
  for (const cookie of cookies) out.headers.append("Set-Cookie", cookie);
  out.headers.set("Cache-Control", "no-store");
  return out;
}

async function limited(env: Env, request: Request): Promise<boolean> {
  // Keyed by connection address, checked by Cloudflare and never stored.
  return env.SIGNIN_LIMIT ? !(await env.SIGNIN_LIMIT.limit({ key: request.headers.get("cf-connecting-ip") ?? "local" })).success : false;
}
