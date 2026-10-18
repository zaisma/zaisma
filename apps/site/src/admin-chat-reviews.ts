import { isIdOf, type ChatReview, type ChatReviewStatus } from "@zaisma/core";
import { CHAT_REVIEW_DECISIONS, MAXIMUM_REVIEW_ATTEMPT_COUNT, decideChatReview, type ChatReviewDecision } from "./chat-review.ts";
import type { Env } from "./env.ts";
import { html, type Raw } from "./html.ts";
import { profilePath } from "./profiles.ts";

/**
 * Chat the filter kept for review (chat-review.ts), for a person: ones the AI was unsure of, ones from a
 * developer's own server, ones the AI couldn't review, and confirmed ones until they're reported. False
 * alarm deletes it and lifts the sender's pause; Remove chat confirms it; Reported to NCMEC confirms it
 * and records the report.
 */

export type AdminChatReview = ChatReview & { game_slug: string | null; sender_username: string | null };

/** Which kept messages to list: the ones waiting for a person by default. */
export type ChatReviewFilter = ChatReviewStatus | "waiting" | "all";

export async function chatReviewsForAdmin(env: Env, filter: ChatReviewFilter = "waiting", maximumReviewCount = 100): Promise<AdminChatReview[]> {
  const where =
    filter === "all"
      ? "1"
      : filter === "waiting"
        ? "(chat_reviews.chat_review_status = 'needs_person' OR (chat_reviews.chat_review_status = 'confirmed' AND chat_reviews.reported_at_ms IS NULL) OR (chat_reviews.chat_review_status = 'pending' AND chat_reviews.check_attempt_count >= ?))"
        : "chat_reviews.chat_review_status = ?";
  const statement = env.DB.prepare(
    `SELECT chat_reviews.*, games.slug AS game_slug, accounts.username AS sender_username FROM chat_reviews LEFT JOIN games ON games.id = chat_reviews.game_id LEFT JOIN accounts ON accounts.id = chat_reviews.sender_account_id WHERE ${where} ORDER BY chat_reviews.created_at_ms LIMIT ?`,
  );
  const bound = filter === "all" ? statement.bind(maximumReviewCount) : filter === "waiting" ? statement.bind(MAXIMUM_REVIEW_ATTEMPT_COUNT, maximumReviewCount) : statement.bind(filter, maximumReviewCount);
  return (await bound.all<AdminChatReview>()).results;
}

export async function chatReviewById(env: Env, id: string): Promise<AdminChatReview | null> {
  return env.DB.prepare("SELECT chat_reviews.*, games.slug AS game_slug, accounts.username AS sender_username FROM chat_reviews LEFT JOIN games ON games.id = chat_reviews.game_id LEFT JOIN accounts ON accounts.id = chat_reviews.sender_account_id WHERE chat_reviews.id = ?").bind(id).first<AdminChatReview>();
}

/** Why a kept message is on the page, in words. */
export function chatReviewState(review: ChatReview): string {
  if (review.chat_review_status === "confirmed") return review.reported_at_ms ? "Confirmed and reported" : "Confirmed: report it to NCMEC";
  if (review.chat_review_status === "needs_person") return review.source === "own_server" ? "From a developer's own server: you decide" : "The AI was unsure";
  return review.check_attempt_count >= MAXIMUM_REVIEW_ATTEMPT_COUNT ? "The AI couldn't review it" : "Waiting for the AI's review";
}

export async function adminChatReviewsPage(env: Env): Promise<Raw> {
  const reviews = await chatReviewsForAdmin(env);
  return html`<h1>Chat reviews (${reviews.length})</h1>
<p class="lead">Sexual messages from adults to teens the chat filter stopped, that need you: the AI was unsure, they came from a developer's own server, or they're confirmed and still to report to NCMEC's CyberTipline (report.cybertip.org). Don't delete anything that's real: confirmed ones are kept a year.</p>
${reviews.length
    ? html`<table><tr><th>Sender</th><th>Message</th><th>Why it's here</th><th></th></tr>${reviews.map(
        (review) => html`<tr><td>${review.sender_username ? html`<a href="${profilePath(review.sender_username)}">@${review.sender_username}</a>` : html`<span class="muted">Account deleted</span>`}<br><span class="muted">${review.game_slug ? html`<a href="/admin/games/${review.game_id}">${review.game_slug}</a>` : review.game_id} · ${review.source === "rooms" ? "Zaisma rooms" : "own server"}</span></td>
<td><strong style="white-space:pre-line">${review.text}</strong>${(JSON.parse(review.recent_texts_json) as string[]).length ? html`<br><span class="muted">Before it:</span>${(JSON.parse(review.recent_texts_json) as string[]).map((recentText) => html`<br><span class="muted">${recentText}</span>`)}` : ""}</td>
<td>${chatReviewState(review)}${review.ai_reason ? html`<br><span class="muted">AI: ${review.ai_reason}</span>` : ""}</td>
<td><div class="row"><form method="post" action="/admin/chat-reviews/${review.id}/false-alarm"><button class="btn ghost" type="submit">False alarm</button></form>${review.chat_review_status === "confirmed" ? "" : html`<form method="post" action="/admin/chat-reviews/${review.id}/remove-chat"><button class="btn" type="submit">Remove chat</button></form>`}${review.reported_at_ms ? "" : html`<form method="post" action="/admin/chat-reviews/${review.id}/reported"><button class="btn" type="submit">Reported to NCMEC</button></form>`}</div></td></tr>`,
      )}</table>`
    : html`<p class="note">Nothing waiting.</p>`}`;
}

/** The page's buttons: answers where to go next, or null when the path isn't one of these. */
export async function adminChatReviewAction(env: Env, path: string, actor: string): Promise<string | null> {
  const match = path.match(/^\/admin\/chat-reviews\/([a-z0-9_]+)\/(false-alarm|remove-chat|reported)$/);
  if (!match || !isIdOf("chat_review", match[1])) return null;
  const review = await chatReviewById(env, match[1]);
  const decision = match[2]!.replace(/-/g, "_") as ChatReviewDecision;
  if (review && CHAT_REVIEW_DECISIONS.includes(decision)) await decideChatReview(env, review, decision, actor);
  return "/admin/chat-reviews";
}
