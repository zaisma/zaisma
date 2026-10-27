import { accountById, answerFriendRequest, friendRequestRefusalFor, gameBySlug, sendFriendRequest, waitingFriendRequestsTo, type WaitingFriendRequest } from "@zaisma/core";
import { authConfigured, currentSession } from "./auth.ts";
import { sendAlert } from "./email.ts";
import type { Env } from "./env.ts";
import { cutButton, runButton } from "./components/actions.ts";
import { listRows, pictureFrame, emptyState } from "./components/data.ts";
import { row, stack } from "./components/layout.ts";
import { banner, sheet } from "./components/panes.ts";
import { playingCard } from "./components/playing.ts";
import { accountPicture, html, pageData, scriptTags, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";
import { profilePath } from "./profiles.ts";

/**
 * Friend requests in games (docs/DECISIONS.md, "Friend requests in games"), on zaisma.com: the calls behind the
 * game page's Add friend, its sheet that asks before anything is sent, the card over the game's corner that
 * brings a request to the other player, and the Friend requests list on /friends. A game only ever asks
 * (Zaisma.friends.sendRequest); the player sends it here, on a Zaisma page, with the name Zaisma knows the other
 * player by. The sender never hears of a turn-down: their request looks waiting until it would have run out.
 *
 *   GET  /friends/requests                        { requests }: the ones waiting for the signed-in player, newest first
 *   GET  /friends/requests/about/:player_id       { player, can_send, has_sent }: what the sheet and Add friend show
 *   POST /friends/requests                        { player_id, game_slug }: send one; { status: "sent" | "friends" }
 *   POST /friends/requests/:player_id/accept      accept (JSON from the game page, a form from /friends)
 *   POST /friends/requests/:player_id/turn-down   turn it down, the same ways
 */
export async function handleFriendRequests(request: Request, env: Env, path: string): Promise<Response | null> {
  const aboutMatch = path.match(/^\/friends\/requests\/about\/(player_[a-z0-9]{1,40})$/);
  const answerMatch = path.match(/^\/friends\/requests\/(player_[a-z0-9]{1,40})\/(accept|turn-down)$/);
  if (path !== "/friends/requests" && !aboutMatch && !answerMatch) return null;
  if (!authConfigured(env)) return answer({ error: { code: "accounts_off", message: "Accounts aren't on yet." } }, 404);
  const post = request.method === "POST";
  if ((aboutMatch && post) || (answerMatch && !post)) return new Response(null, { status: 405 });
  // Changes only come from our own pages.
  if (post && request.headers.get("origin") !== new URL(request.url).origin) return answer({ error: { code: "bad_origin", message: "Not allowed from here." } }, 403);
  const isForm = (request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");
  const session = await currentSession(request, env);
  const account = session ? await accountById(env.DB, session.userId) : null;
  const done = (response: Response) => withCookies(response, session?.cookies ?? []);
  if (!account) {
    if (isForm) return done(redirect(`/signin?next=${encodeURIComponent("/friends#requests")}`));
    return done(answer({ error: { code: "not_signed_in", message: "Sign in to add friends." } }, 401));
  }
  if (post && env.FRIEND_REQUEST_LIMIT && !(await env.FRIEND_REQUEST_LIMIT.limit({ key: account.id })).success) {
    return done(isForm ? redirect("/friends#requests") : answer({ error: { code: "slow_down", message: "That's a lot of friend requests at once. Wait a minute and try again." } }, 429));
  }

  if (answerMatch) {
    const [, playerId, verb] = answerMatch as unknown as [string, string, "accept" | "turn-down"];
    const answered = await answerFriendRequest(env.DB, account, playerId, verb === "accept" ? "accepted" : "turned_down");
    if (isForm) return done(redirect("error" in answered ? "/friends#requests" : verb === "accept" ? `/friends?added=${playerId}` : "/friends?turned-down#requests"));
    if ("error" in answered) return done(answer({ error: { code: answered.error, message: ANSWER_ERRORS[answered.error] } }, answered.error === "request_not_found" ? 404 : 409));
    return done(answer({ answer: answered.answer }));
  }

  if (aboutMatch) {
    const playerId = aboutMatch[1]!;
    const other = await env.DB.prepare("SELECT username FROM accounts WHERE player_id = ?").bind(playerId).first<{ username: string }>();
    const refusal = await friendRequestRefusalFor(env.DB, account, playerId);
    return done(answer({ player: other ? { player_id: playerId, name: other.username } : null, can_send: refusal === null, has_sent: refusal === "already_sent", is_friend: refusal === "already_friends" }));
  }

  if (!post) return done(answer({ requests: account.social_stopped_at_ms ? [] : await waitingFriendRequestsTo(env.DB, account.id) }));

  const text = await request.text();
  if (text.length > 512) return done(answer({ error: { code: "too_big", message: "A friend request is a player_id and a game_slug." } }, 413));
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text || "{}") ?? {};
  } catch {
    return done(answer({ error: { code: "bad_json", message: "Send { player_id, game_slug } as JSON." } }, 400));
  }
  const unknown = Object.keys(body).filter((key) => key !== "player_id" && key !== "game_slug");
  if (unknown.length) return done(answer({ error: { code: "unknown_field", message: `A friend request takes player_id and game_slug, not ${unknown.join(", ")}.` } }, 400));
  const playerId = typeof body.player_id === "string" && /^player_[a-z0-9]{1,40}$/.test(body.player_id) ? body.player_id : null;
  if (!playerId) return done(answer({ error: { code: "bad_player_id", message: "player_id is a player's ID, like player_k7q2mx9p." } }, 400));
  const game = typeof body.game_slug === "string" && /^[a-z0-9-]{1,80}$/.test(body.game_slug) ? await gameBySlug(env.DB, body.game_slug) : null;
  const sent = await sendFriendRequest(env.DB, account, playerId, game?.id ?? null);
  if ("error" in sent) return done(answer({ error: { code: sent.error, message: SEND_ERRORS[sent.error] } }, sent.error === "too_many_friend_requests" ? 429 : 409));
  // A 13–15 account whose requests just paused for being mostly turned down or left: a person looks.
  if (sent.status === "sent" && sent.is_paused_now && account.age_band === "13-15") await flagForPattern(env, account.id, game?.slug ?? null);
  return done(answer({ status: sent.status }));
}

const SEND_ERRORS: Record<string, string> = {
  not_taking_requests: "They aren't taking friend requests from you.",
  already_friends: "You're friends already.",
  already_sent: "Your request is waiting for them.",
  not_an_account: "Only players signed in to Zaisma take friend requests.",
  own_player: "That's you.",
  account_needed: "Sign in to add friends.",
  too_many_friend_requests: "You've sent today's friend requests. Try again tomorrow.",
  too_many_friends: "You have as many friends as Zaisma keeps. Remove one on your friends page first.",
  recipient_has_too_many_friends: "They have as many friends as Zaisma keeps.",
};

const ANSWER_ERRORS: Record<string, string> = {
  request_not_found: "That request isn't waiting any more.",
  too_many_friends: "You have as many friends as Zaisma keeps. Remove one on your friends page first.",
  sender_has_too_many_friends: "They have as many friends as Zaisma keeps.",
  social_stopped: "Friends are off for your account.",
};

/** The reports queue's entry for a 13–15 sender whose requests paused: on their profile, from Zaisma, with an alert. */
async function flagForPattern(env: Env, accountId: string, gameSlug: string | null): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO profile_reports (account_id, reporter_account_id, reason, details, created_at_ms) VALUES (?, 'zaisma', 'friend_request_pattern', ?, ?)")
    .bind(accountId, `Most of this 13–15 account's friend requests in the last 30 days were turned down or left, so its requests are paused for a week.${gameSlug ? ` Latest from ${gameSlug}.` : ""}`, Date.now())
    .run();
  await sendAlert(env, "Friend requests paused: a 13–15 account", `A 13–15 account sent many friend requests that few accepted, so its requests are paused for a week. Look at who it is.\n\nOpen: ${env.SITE_ORIGIN}/admin/profiles`);
}

/** The Friend requests list on /friends, each with Accept, Turn down and Report; nothing when none are waiting. */
export function friendRequestsSection(requests: WaitingFriendRequest[], query: URLSearchParams): Raw {
  const status = query.has("turned-down") ? `Turned down. They aren't told.` : "";
  if (!requests.length) return status ? html`<p class="note" role="status" id="requests">${status}</p>` : html``;
  return html`<h2 class="rule-h" id="requests">Friend requests (${requests.length})</h2>
${status ? html`<p class="note" role="status">${status}</p>` : ""}
<ul class="keys friends">${requests.map(
    (waiting) => html`<li><span class="friend"><a class="to-profile" href="${profilePath(waiting.name)}">${accountPicture(waiting.name, "sm")}<span>${waiting.name}</span></a> <span class="why muted small">wants to be friends</span></span>
<span class="row"><form method="post" action="/friends/requests/${waiting.player_id}/accept"><button class="btn" type="submit">Accept</button></form><form method="post" action="/friends/requests/${waiting.player_id}/turn-down"><button class="btn ghost" type="submit">Turn down</button></form><a class="btn ghost" href="${profilePath(waiting.name)}/report">Report</a></span></li>`,
  )}</ul>`;
}

/**
 * The game page's side of friend requests: the sheet that asks "Send Mia a friend request?" before one is sent
 * (from Players or the game's sendRequest), and the card over the game's corner that brings a request waiting for
 * this player, with Accept and Not now. The card never takes the keyboard or pauses anything; left, it goes after
 * a few seconds, and the request waits in Players and on /friends.
 */
export function friendRequestParts(options: { gameOrigin: string; slug: string }): Raw {
  const body = stack({
    items: [
      { kind: "block", markup: listRows({ whenEmpty: emptyState({ title: "Nobody picked", text: "Who you're adding shows here." }), rows: [{ lead: pictureFrame("?", "md"), title: "?" }], id: "friend-request-who" }) },
      { kind: "words", markup: html`<p><span id="friend-request-told"></span> can accept it from their game or their friends page. Once you're friends, you can chat and join each other in games that allow it.</p>` },
      { kind: "block", markup: html`<div id="friend-request-error" role="alert" hidden>${banner({ text: "Couldn't send it. Check your connection and try again.", icon: "warning", tone: "warning" })}</div>` },
    ],
  });
  const card = playingCard({
    id: "friend-request-card",
    title: "Friend request",
    body: stack({
      items: [
        { kind: "words", markup: html`<p><strong id="friend-request-card-name"></strong> wants to be friends.</p>` },
        {
          kind: "block",
          markup: row({ widths: "fit", label: "Answer", items: [{ kind: "control", markup: runButton("Accept", { type: "button", id: "friend-request-accept" }) }, { kind: "control", markup: cutButton("Not now", { type: "button", id: "friend-request-later" }) }] }),
        },
      ],
    }),
  });
  return html`${sheet({
    id: "friend-request",
    title: "Send a friend request?",
    body,
    closeLabel: "Close",
    placement: "foot",
    buttons: [cutButton("Cancel", { type: "submit", formMethod: "dialog" }), runButton("Send request", { type: "button", id: "friend-request-yes" })],
  })}
${card}
${pageData("friend-request-data", { gameOrigin: options.gameOrigin, slug: options.slug })}
${scriptTags(FRIEND_REQUEST_SCRIPT)}`;
}

/** How long the card stays when nobody touches it, before the request waits in Players and on /friends. */
const CARD_SHOWN_MS = 8000;

// The game page's friend requests: a game (or Players) asks, the sheet asks the player, and requests for this player come as a card.
const FRIEND_REQUEST_SCRIPT = pageScript("friend-requests", String.raw`(() => {
  const sheet = document.getElementById("friend-request");
  const card = document.getElementById("friend-request-card");
  const data = document.getElementById("friend-request-data");
  if (!sheet || !card || !data) return;
  const { gameOrigin: GAME_ORIGIN, slug: SLUG } = JSON.parse(data.textContent);
  const PLAYER_ID = /^player_[a-z0-9]{1,40}$/;
  const $ = (id) => document.getElementById(id);
  const yes = $("friend-request-yes");
  const frame = () => document.getElementById("game");
  const tell = (message) => { const f = frame(); if (f && f.contentWindow) f.contentWindow.postMessage(message, GAME_ORIGIN); };
  const isSignedIn = () => /(^|; )(__Host-)?zaisma_in=1/.test(document.cookie);
  const post = (path, body) => fetch(path, { method: "POST", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }).catch(() => null);

  // The request the sheet is asking about: { id, name }.
  let asking = null;
  function finish(status) {
    if (!asking) return;
    tell({ type: "zaisma:friend-request", playerId: asking.id, status });
    if (status === "sent") dispatchEvent(new CustomEvent("zaisma:friend-request-sent", { detail: { id: asking.id } }));
    asking = null;
    if (sheet.open) sheet.close();
  }
  // Who it's for, as the page draws an account (accountPicture): initials in its own color, from the name.
  function showWho(name) {
    const who = $("friend-request-who");
    let hue = 7;
    for (const character of name) hue = (hue * 31 + character.codePointAt(0)) % 360;
    const words = name.trim().split(/\s+/).filter(Boolean);
    const letters = words.length > 1 ? [Array.from(words[0])[0], Array.from(words[1])[0]] : Array.from(words[0] || "?").slice(0, 2);
    const picture = who.querySelector(".av");
    picture.style.setProperty("--h", String(hue));
    picture.textContent = letters.join("").toUpperCase();
    who.querySelector(".list-row-title").textContent = name;
  }
  async function ask(playerId) {
    // One question at a time: another while the sheet is up is a no.
    if (asking) return tell({ type: "zaisma:friend-request", playerId, status: "cancelled" });
    if (!isSignedIn()) return tell({ type: "zaisma:friend-request", playerId, status: "cancelled" });
    tell({ type: "zaisma:friend-request", playerId, status: "asking" });
    asking = { id: playerId, name: "" };
    const about = await fetch("/friends/requests/about/" + playerId).then((res) => (res.ok ? res.json() : null)).catch(() => null);
    if (!about || !about.player) { asking = { id: playerId }; return finish("not_taking_requests"); }
    if (about.is_friend) return finish("already_friends");
    // Already waiting looks the same as just sent, whatever became of it.
    if (about.has_sent) return finish("sent");
    if (!about.can_send) return finish("not_taking_requests");
    asking.name = about.player.name;
    $("friend-request-title").textContent = "Send " + asking.name + " a friend request?";
    showWho(asking.name);
    $("friend-request-told").textContent = asking.name;
    $("friend-request-error").hidden = true;
    yes.removeAttribute("aria-busy");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    sheet.showModal();
    yes.focus();
  }
  yes.addEventListener("click", async () => {
    if (!asking || yes.getAttribute("aria-busy") === "true") return;
    yes.setAttribute("aria-busy", "true");
    $("friend-request-error").hidden = true;
    const res = await post("/friends/requests", { player_id: asking.id, game_slug: SLUG });
    yes.removeAttribute("aria-busy");
    const answer = res ? await res.json().catch(() => null) : null;
    if (res && res.ok) return finish("sent");
    const code = answer && answer.error ? answer.error.code : "";
    if (code === "already_friends") return finish("already_friends");
    if (code === "already_sent") return finish("sent");
    if (code === "not_taking_requests" || code === "not_an_account") return finish("not_taking_requests");
    const error = $("friend-request-error");
    error.querySelector(".banner-text").textContent = answer && answer.error ? answer.error.message : "Couldn't send it. Check your connection and try again.";
    error.hidden = false;
  });
  sheet.addEventListener("close", () => { finish("cancelled"); const f = frame(); if (f) f.focus(); });
  // The game asks (Zaisma.friends.sendRequest); only its own frame.
  addEventListener("message", (e) => {
    const f = frame();
    const d = e.data;
    if (!f || e.source !== f.contentWindow || e.origin !== GAME_ORIGIN || !d) return;
    if (d.type === "zaisma:friend-request" && typeof d.playerId === "string" && PLAYER_ID.test(d.playerId) && !d.status) ask(d.playerId);
    // Someone in the room sent this player one: look now.
    if (d.type === "zaisma:friend-requests") look();
  });
  // Players' Add friend.
  addEventListener("zaisma:ask-friend-request", (e) => { if (e.detail && PLAYER_ID.test(e.detail.id)) ask(e.detail.id); });

  // Requests waiting for this player, newest first; the card brings each one once a tab.
  const SHOWN_KEY = "zaisma:friend-requests-shown";
  const shown = () => { try { return new Set(JSON.parse(sessionStorage.getItem(SHOWN_KEY) || "[]")); } catch { return new Set(); } };
  const keepShown = (ids) => { try { sessionStorage.setItem(SHOWN_KEY, JSON.stringify([...ids].slice(-200))); } catch {} };
  let waiting = [];
  let showing = null;
  let cardTimer = null;
  let isLooking = false;
  let hasLooked = false;
  // The game page while its game runs (pages.ts swaps is-leaving for is-playing).
  const isPlaying = () => document.documentElement.classList.contains("is-playing");
  async function look() {
    if (!isSignedIn() || isLooking) return;
    isLooking = true;
    hasLooked = true;
    const answer = await fetch("/friends/requests").then((res) => (res.ok ? res.json() : null)).catch(() => null);
    isLooking = false;
    if (!answer || !Array.isArray(answer.requests)) return;
    waiting = answer.requests;
    dispatchEvent(new CustomEvent("zaisma:friend-requests-waiting", { detail: { requests: waiting } }));
    showNext();
  }
  function showNext() {
    if (showing || !isPlaying()) return;
    const seen = shown();
    const next = waiting.find((each) => !seen.has(each.player_id + ":" + each.created_at_ms));
    if (!next) return;
    seen.add(next.player_id + ":" + next.created_at_ms);
    keepShown(seen);
    showing = next;
    $("friend-request-card-name").textContent = next.name;
    card.hidden = false;
    clearTimeout(cardTimer);
    cardTimer = setTimeout(hideCard, ${CARD_SHOWN_MS});
  }
  function hideCard() {
    clearTimeout(cardTimer);
    card.hidden = true;
    showing = null;
    setTimeout(showNext, 600);
  }
  // A hand on the card keeps it up.
  card.addEventListener("pointerenter", () => clearTimeout(cardTimer));
  card.addEventListener("pointerleave", () => { if (showing) cardTimer = setTimeout(hideCard, 3000); });
  async function answerRequest(playerId, verb) {
    const res = await post("/friends/requests/" + playerId + "/" + verb);
    waiting = waiting.filter((each) => each.player_id !== playerId);
    dispatchEvent(new CustomEvent("zaisma:friend-requests-waiting", { detail: { requests: waiting } }));
    return Boolean(res && res.ok);
  }
  $("friend-request-accept").addEventListener("click", async () => {
    if (!showing) return;
    const playerId = showing.player_id;
    hideCard();
    await answerRequest(playerId, "accept");
  });
  $("friend-request-later").addEventListener("click", hideCard);
  // Players answers from its list too.
  addEventListener("zaisma:answer-friend-request", (e) => {
    if (!e.detail || !PLAYER_ID.test(e.detail.id) || (e.detail.verb !== "accept" && e.detail.verb !== "turn-down")) return;
    if (showing && showing.player_id === e.detail.id) hideCard();
    answerRequest(e.detail.id, e.detail.verb);
  });
  // The presence check-in says how many wait; a different count means something new to look at.
  let lastCount = -1;
  addEventListener("zaisma:presence", (e) => {
    const count = e.detail && typeof e.detail.waiting_friend_request_count === "number" ? e.detail.waiting_friend_request_count : 0;
    if (count !== lastCount) { lastCount = count; if (count || waiting.length) look(); }
  });
  // Once the game is running.
  new MutationObserver(() => { if (isPlaying()) { showNext(); if (!hasLooked) look(); } }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
})();`);

function answer(body: unknown, httpStatus = 200): Response {
  return Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
}

function withCookies(response: Response, cookies: string[]): Response {
  const out = new Response(response.body, response);
  for (const cookie of cookies) out.headers.append("Set-Cookie", cookie);
  out.headers.set("Cache-Control", "no-store");
  return out;
}
