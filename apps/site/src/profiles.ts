import {
  AGE_BAND_FLOOR_YEARS,
  MAXIMUM_BIO_CHARACTER_COUNT,
  MAXIMUM_DISPLAY_NAME_CHARACTER_COUNT,
  MAXIMUM_LINK_COUNT,
  PLAYED_PERIOD_WORDS,
  PROFILE_REPORT_REASONS,
  accountById,
  accountByUsername,
  areFriends,
  hasBlocked,
  linkUrlsOf,
  playingNowOf,
  profileView,
  readProfileText,
  reportProfile,
  saveProfileText,
  type Account,
  type ProfileReportReason,
  type ProfileViewer,
} from "@zaisma/core";
import { authConfigured, currentSession } from "./auth.ts";
import { sendAlert } from "./email.ts";
import type { Env } from "./env.ts";
import { JOIN_OFF_STYLES, joinButton } from "./friends-now.ts";
import { tile } from "./home.ts";
import { accountPicture, html, layout, message, metalButton, raw, scriptTags, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";
import { checkProfile } from "./profile-check.ts";

/**
 * Profiles (docs/DECISIONS.md, "What a profile shows"): zaisma.com/@username. Mostly covers, under a
 * short header: a developer's own games first, then Playing now, then Played with rough times. The
 * owner edits it in place and can see it as a friend or anyone would. What each viewer sees is worked
 * out in packages/core/src/profiles.ts, the same as the API's public profile.
 */

/** Where an account's profile is. Usernames are letters, numbers and underscores, so nothing needs escaping. */
export const profilePath = (username: string) => `/@${username}`;

/** A name or face that opens the profile, for anywhere a player is named. */
export function profileLink(username: string, content: Raw | string): Raw {
  return html`<a class="to-profile" href="${profilePath(username)}">${content}</a>`;
}

export async function handleProfiles(request: Request, env: Env, path: string): Promise<Response | null> {
  const match = path.match(/^\/@([A-Za-z0-9_]{1,40})(\/edit|\/report)?$/);
  if (!match) return null;
  if (!authConfigured(env)) return message(env, "Accounts aren't on yet", "You can still play as a guest.", 404);
  const [, wantedUsername, sub] = match as unknown as [string, string, string | undefined];
  const post = request.method === "POST";
  if (post) {
    // Forms only come from our own pages.
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return new Response("Bad origin", { status: 403 });
  }
  const owner = await accountByUsername(env.DB, wantedUsername);
  if (!owner) return message(env, "No one here", "No player has that username. They may have changed it.", 404);
  // One address per profile: any other case goes to the username as it's kept.
  if (owner.username !== wantedUsername && !post) return redirect(`${profilePath(owner.username)}${sub ?? ""}${new URL(request.url).search}`);

  const session = await currentSession(request, env);
  const visitor = session ? await accountById(env.DB, session.userId) : null;
  const done = (response: Response) => withCookies(response, session?.cookies ?? []);
  const query = new URL(request.url).searchParams;
  const isOwner = visitor?.id === owner.id;

  if (sub === "/edit") {
    if (!isOwner) return done(redirect(profilePath(owner.username)));
    if (!post) return done(redirect(`${profilePath(owner.username)}?edit`));
    const form = await request.formData();
    const read = readProfileText({ display_name: form.get("display_name"), bio: form.get("bio"), link_urls: form.getAll("link_url").map(String) }, owner);
    if ("error" in read) return done(await profilePage(env, owner, visitor, { kind: "owner" }, query, { error: read.error, given: form }));
    if (await saveProfileText(env.DB, owner.id, read.profileText)) await checkProfile(env, owner.id);
    return done(redirect(`${profilePath(owner.username)}?saved`));
  }

  if (sub === "/report") {
    if (!visitor) return done(redirect(`/signin?next=${encodeURIComponent(`${profilePath(owner.username)}/report`)}`));
    if (isOwner) return done(redirect(profilePath(owner.username)));
    if (!post) return done(reportPage(env, owner));
    const form = await request.formData();
    const reason = String(form.get("reason") ?? "");
    if (!(reason in PROFILE_REPORT_REASONS)) return done(reportPage(env, owner, "Choose what's wrong."));
    const details = String(form.get("details") ?? "").trim().slice(0, 1000);
    await reportProfile(env.DB, owner, visitor.id, reason as ProfileReportReason, details);
    if (reason === "child_safety") {
      await sendAlert(env, "Profile reported: puts a young person at risk", `A profile was reported as putting a young person at risk. Its name, bio and links are hidden until you look.\n\nOpen: ${env.SITE_ORIGIN}/admin/profiles`);
    }
    return done(redirect(`${profilePath(owner.username)}?reported`));
  }

  if (post) return done(redirect(profilePath(owner.username)));
  // The owner can see their profile as a friend or anyone would.
  const viewAs = isOwner ? query.get("view_as") : null;
  const viewer: ProfileViewer =
    isOwner && viewAs === "friend" ? { kind: "friend", accountId: null }
    : isOwner && viewAs === "anyone" ? { kind: "anyone" }
    : isOwner ? { kind: "owner" }
    : !visitor ? { kind: "anyone" }
    : (await areFriends(env.DB, visitor.id, owner.id)) ? { kind: "friend", accountId: visitor.id }
    : { kind: "signed_in", accountId: visitor.id };
  return done(await profilePage(env, owner, visitor, viewer, query));
}

/** Covers for the games on a profile, by slug. */
async function coversOf(env: Env, slugs: string[]): Promise<Map<string, { cover: string | null; square: string | null }>> {
  if (!slugs.length) return new Map();
  const { results } = await env.DB.prepare(
    `SELECT games.slug,
       (SELECT id FROM game_images WHERE game_id = games.id AND kind = 'cover' AND review_status = 'approved' ORDER BY created_at_ms DESC LIMIT 1) AS cover,
       (SELECT id FROM game_images WHERE game_id = games.id AND kind = 'square' AND review_status = 'approved' ORDER BY created_at_ms DESC LIMIT 1) AS square
     FROM games WHERE slug IN (SELECT value FROM json_each(?))`,
  )
    .bind(JSON.stringify(slugs))
    .all<{ slug: string; cover: string | null; square: string | null }>();
  return new Map(results.map((row) => [row.slug, { cover: row.cover ? `/img/${row.cover}` : null, square: row.square ? `/img/${row.square}` : null }]));
}

interface EditState {
  error: string;
  given: FormData;
}

async function profilePage(env: Env, owner: Account, visitor: Account | null, viewer: ProfileViewer, query: URLSearchParams, editState?: EditState): Promise<Response> {
  // Games for players older than the one looking stay off the page (18 signed out: every listed game).
  const viewerAgeFloorYears = visitor ? AGE_BAND_FLOOR_YEARS[visitor.age_band] : 18;
  const view = await profileView(env.DB, owner, viewer, viewerAgeFloorYears);
  // Only the blocker's own menu says they blocked this player.
  const hasVisitorBlocked = visitor !== null && visitor.id !== owner.id && (await hasBlocked(env.DB, visitor.id, owner.id));
  // Playing now goes through the same rules as /friends (friends-now.ts); the owner previewing as a friend sees it as a friend would.
  const viewerAccountId = viewer.kind === "owner" ? owner.id : viewer.kind === "friend" ? (viewer.accountId ?? owner.id) : viewer.kind === "signed_in" ? viewer.accountId : null;
  const playingNow = view.can_see_playing_now ? await playingNowOf(env.DB, owner.id, viewerAccountId, viewerAgeFloorYears) : null;
  const covers = await coversOf(env, [...view.published_games, ...(view.played_games ?? [])].map((game) => game.slug));
  const card = (game: { slug: string; title: string }, flag?: string) => tile({ slug: game.slug, title: game.title, ...(covers.get(game.slug) ?? { cover: null, square: null }) }, flag ? { flag } : {});
  const isOwnView = viewer.kind === "owner";
  const isOwner = visitor?.id === owner.id;
  const name = view.display_name ?? owner.username;
  // Played leaves out what's already under Made by.
  const madeSlugs = new Set(view.published_games.map((game) => game.slug));
  const played = view.played_games?.filter((game) => !madeSlugs.has(game.slug)) ?? null;

  const body = html`<div class="profile">
${isOwner ? ownerBar(owner, viewer, query) : ""}
${query.has("reported") && !isOwner ? html`<p class="note" role="status">Thanks. A person at Zaisma will look at this profile. ${owner.username} isn't told who reported it.</p>` : ""}
<section class="who plate bevel">
  <div class="face">${accountPicture(name, "md")}</div>
  <div class="who-text">
    <h1>${name}</h1>
    <p class="handle">@${owner.username}</p>
    ${view.bio ? html`<p class="bio">${view.bio}</p>` : ""}
    ${view.link_urls.length ? html`<ul class="links">${view.link_urls.map((linkUrl) => html`<li>${outLink(linkUrl)}</li>`)}</ul>` : ""}
  </div>
  ${visitor && !isOwner ? html`<details class="more"><summary class="btn ghost" aria-label="More">${raw(MORE_ICON)}</summary><div class="menu plate bevel-s">${blockItem(owner, hasVisitorBlocked, viewer.kind === "friend")}<a href="${profilePath(owner.username)}/report">Report</a></div></details>` : ""}
</section>
${isOwnView ? editForm(owner, editState) : ""}
${view.is_private ? html`<p class="private plate bevel-s">${name}'s profile is private.</p>` : ""}
${view.published_games.length
    ? html`<h2 class="rule-h">Made by ${name}</h2><div class="grid games">${view.published_games.map((game) => card(game))}</div>`
    : ""}
${playingNow
    ? html`<h2 class="rule-h">Playing now</h2><div class="grid games playing-now">${playingNow.game
        ? html`<div>${tile({ slug: playingNow.game.slug, title: playingNow.game.title, cover: playingNow.game.cover_image_id ? `/img/${playingNow.game.cover_image_id}` : null, square: playingNow.game.square_image_id ? `/img/${playingNow.game.square_image_id}` : null })}${playingNow.join && viewer.kind !== "owner" ? html`<div class="join-row">${joinButton(playingNow.game.slug, playingNow.join)}</div>` : ""}</div>`
        : html`<div class="hit block"><span class="tile"><span class="pic"><span class="named"><span>A game that isn't out yet</span></span></span></span></div>`}</div>`
    : ""}
${played?.length
    ? html`<h2 class="rule-h">Played</h2><div class="grid games">${played.map((game) => card(game, PLAYED_PERIOD_WORDS[game.played_period]))}</div>`
    : isOwnView && !view.played_games?.length
      ? html`<h2 class="rule-h">Played</h2><p class="muted">Games you play show here, newest first.</p>`
      : ""}
${view.mutual_friends.length
    ? html`<h2 class="rule-h">Friends you both have</h2><ul class="faces">${view.mutual_friends.map((friend) => html`<li>${profileLink(friend.username, html`${accountPicture(friend.username, "sm")}<span>${friend.username}</span>`)}</li>`)}</ul>`
    : ""}
</div>
<style>${raw(PROFILE_STYLES)}.playing-now .join-row{display:flex;justify-content:flex-end;margin-top:10px}${raw(JOIN_OFF_STYLES)}</style>
${scriptTags(PROFILE_SCRIPT)}`;
  const response = layout(env, { title: `${name} (@${owner.username}) · Zaisma`, body, isPrivate: true });
  return new Response(response.body, { status: editState ? 400 : 200, headers: response.headers });
}

/** Block in the profile's menu, asking first; Unblock instead for someone the visitor blocked (docs/DECISIONS.md, "How blocks work"). */
function blockItem(owner: Account, hasVisitorBlocked: boolean, isFriend: boolean): Raw {
  if (hasVisitorBlocked) return html`<form method="post" action="/friends/blocks/${owner.player_id}/remove" data-confirm="Unblock ${owner.username}? You can see each other in games again. They aren't told."><button type="submit">Unblock</button></form>`;
  const ask = `Block ${owner.username}? In every game on Zaisma, nothing either of you sends reaches the other, and neither of you shows up in the other's friends or profile.${isFriend ? " You're friends, so this ends that too." : ""} ${owner.username} isn't told.`;
  return html`<form method="post" action="/friends/blocks/${owner.player_id}" data-confirm="${ask}"><button type="submit">Block</button></form>`;
}

/** The owner's bar: what others see of their words, and the profile as a friend or anyone would see it. */
function ownerBar(owner: Account, viewer: ProfileViewer, query: URLSearchParams): Raw {
  const here = (kind: ProfileViewer["kind"]) => (viewer.kind === kind ? raw(' aria-current="page"') : "");
  const status =
    owner.profile_check_status === "pending" ? "Others see your new name and bio once they're checked. It usually takes a few seconds; refresh to see."
    : owner.profile_check_status === "held" ? "A person at Zaisma is looking at your name and bio before others see them, usually within a day. Until then, others see your username."
    : null;
  return html`<div class="owner-bar">
  <nav class="seg" aria-label="See your profile as"><a href="${profilePath(owner.username)}"${here("owner")}>You</a><a href="${profilePath(owner.username)}?view_as=friend"${here("friend")}>A friend</a><a href="${profilePath(owner.username)}?view_as=anyone"${here("anyone")}>Anyone</a></nav>
  <a class="muted small" href="/account#social">Who sees what</a>
</div>
${query.has("saved") && !status ? html`<p class="note" role="status">Saved.</p>` : ""}
${status ? html`<p class="note" role="status">${status}</p>` : ""}
${viewer.kind !== "owner" ? html`<p class="hint">This is your profile as ${viewer.kind === "friend" ? "a friend" : "someone who isn't your friend"} sees it.</p>` : ""}`;
}

/** Editing in place: the name, bio and (18+) links, open when there's nothing written yet or an error. */
function editForm(owner: Account, editState?: EditState): Raw {
  const given = (name: string, kept: string | null) => (editState ? String(editState.given.get(name) ?? "") : (kept ?? ""));
  const links = editState ? editState.given.getAll("link_url").map(String) : linkUrlsOf(owner);
  const isOpen = Boolean(editState) || (!owner.display_name && !owner.bio);
  return html`<details class="edit"${isOpen ? raw(" open") : ""}>
<summary class="btn ghost">Edit profile</summary>
<form class="stack plate bevel-s" method="post" action="${profilePath(owner.username)}/edit">
  ${editState ? html`<p class="error" role="alert">${editState.error}</p>` : ""}
  <label>Name <span class="hint">Shown beside @${owner.username}. Leave it empty to show just your username.</span>
    <input name="display_name" maxlength="${MAXIMUM_DISPLAY_NAME_CHARACTER_COUNT}" value="${given("display_name", owner.display_name)}" placeholder="${owner.username}" autocomplete="off"></label>
  <label>Bio <span class="hint">A few words about you and the games you like. No contact details: others see it once it's checked.</span>
    <textarea name="bio" maxlength="${MAXIMUM_BIO_CHARACTER_COUNT}" rows="3">${given("bio", owner.bio)}</textarea></label>
  ${owner.age_band === "18+"
    ? html`<fieldset class="link-fields"><legend>Links</legend><p class="hint">Your Instagram, Discord, TikTok, channel or site, up to ${MAXIMUM_LINK_COUNT}.</p>
${Array.from({ length: MAXIMUM_LINK_COUNT }, (_, i) => html`<input name="link_url" type="url" inputmode="url" maxlength="200" value="${links[i] ?? ""}" placeholder="https://" aria-label="Link ${i + 1}">`)}</fieldset>`
    : ""}
  <div class="row">${metalButton("Save", { type: "submit" })}</div>
</form>
</details>`;
}

/** A link out of Zaisma says where it goes first, like a forum link (unless the site is trusted in this browser). */
function outLink(linkUrl: string): Raw {
  const parsedUrl = new URL(linkUrl);
  const label = (parsedUrl.hostname.replace(/^www\./, "") + parsedUrl.pathname).replace(/\/$/, "");
  return html`<a class="out" href="/forum/out?to=${encodeURIComponent(parsedUrl.href)}" data-out="${parsedUrl.href}" data-host="${parsedUrl.hostname}" rel="nofollow ugc noopener">${label}</a>`;
}

function reportPage(env: Env, owner: Account, error?: string): Response {
  const body = html`<div class="narrow">
<form class="stack" method="post" action="${profilePath(owner.username)}/report">
  <h1>Report @${owner.username}</h1>
  <p class="lead">About their name, bio or links. ${owner.username} isn't told who reported it. Trouble in a game? Report it from the game, so the room goes with it.</p>
  ${error ? html`<p class="error" role="alert">${error}</p>` : ""}
  <fieldset class="choices"><legend>What's wrong?</legend>
  ${Object.entries(PROFILE_REPORT_REASONS).map(([reason, label]) => html`<label class="check"><input type="radio" name="reason" value="${reason}" required> <span>${label}</span></label>`)}
  </fieldset>
  <label>Anything else we should know? (optional)<textarea name="details" maxlength="1000" rows="3"></textarea></label>
  <div class="row">${metalButton("Send report", { type: "submit" })}<a class="btn ghost" href="${profilePath(owner.username)}">Back</a></div>
</form>
</div>`;
  const response = layout(env, { title: `Report @${owner.username} · Zaisma`, body, isPrivate: true });
  return new Response(response.body, { status: error ? 400 : 200, headers: response.headers });
}

const MORE_ICON = '<svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="4" cy="10" r="1.8"/><circle cx="10" cy="10" r="1.8"/><circle cx="16" cy="10" r="1.8"/></svg>';

const PROFILE_STYLES = `.profile{max-width:1100px;margin:0 auto}
.owner-bar{display:flex;flex-wrap:wrap;align-items:center;gap:12px 18px;margin:0 0 18px}
.who{position:relative;display:flex;align-items:flex-start;gap:24px;padding:28px}
.who .face .av{width:96px;height:96px;font-size:38px}
.who-text{flex:1;min-width:0}
.who h1{margin:0;font-size:clamp(30px,3.6vw,44px);overflow-wrap:anywhere}
.who .handle{margin:4px 0 0;color:var(--muted);font-family:var(--display);font-size:16px}
.who .bio{margin:14px 0 0;max-width:62ch;font-size:17px;line-height:1.55;color:var(--text-2);white-space:pre-line;overflow-wrap:anywhere}
.who .links{list-style:none;display:flex;flex-wrap:wrap;gap:6px 18px;margin:14px 0 0;padding:0;font-size:15px}
.who .links a{color:var(--text);text-underline-offset:3px;overflow-wrap:anywhere}
.more{position:relative;flex:none}
.more summary{list-style:none;min-height:40px;width:44px;padding:0;justify-content:center}
.more summary::-webkit-details-marker{display:none}
.more .menu{position:absolute;right:0;top:calc(100% + 6px);z-index:5;min-width:160px;padding:6px;display:grid}
.more .menu a,.more .menu button{display:block;width:100%;padding:10px 12px;border:0;background:none;color:var(--text);font:inherit;text-align:left;text-decoration:none;cursor:pointer}
.more .menu a:hover,.more .menu button:hover{background:rgba(255,255,255,.06)}
.edit{margin:16px 0 0}
.edit summary{list-style:none;width:fit-content}
.edit summary::-webkit-details-marker{display:none}
.edit[open] summary{margin-bottom:12px}
.edit form{padding:22px;max-width:640px}
.edit label .hint{display:block;margin:2px 0 6px}
.edit textarea{width:100%;resize:vertical}
.link-fields{display:grid;gap:8px;border:0;margin:0;padding:0}
.link-fields .hint{margin:0 0 4px}
.private{margin:22px 0 0;padding:18px 22px;font-size:17px;color:var(--text-2)}
.faces{list-style:none;display:flex;flex-wrap:wrap;gap:14px 22px;margin:0;padding:0}
.faces a{display:flex;align-items:center;gap:10px;color:var(--text);text-decoration:none}
.faces a:hover span{text-decoration:underline;text-underline-offset:3px}
@media (max-width:640px){.who{flex-direction:column;gap:16px;padding:22px}.more{position:absolute;top:16px;right:16px}}`;

// Links out say where they go first, unless the site is trusted in this browser (the forum keeps the list).
const PROFILE_SCRIPT = pageScript("profile", `(()=>{const TRUST="zaisma-trusted-sites",trusted=()=>{try{return JSON.parse(localStorage.getItem(TRUST)||"[]")}catch{return[]}};
document.addEventListener("click",e=>{const out=e.target.closest("a.out");if(out&&!e.metaKey&&!e.ctrlKey&&trusted().includes(out.dataset.host)){e.preventDefault();window.open(out.dataset.out,"_blank","noopener,noreferrer")}});
document.addEventListener("click",e=>{document.querySelectorAll("details.more[open]").forEach(d=>{if(!d.contains(e.target))d.removeAttribute("open")})});
document.querySelectorAll("form[data-confirm]").forEach(f=>f.addEventListener("submit",e=>{if(!confirm(f.dataset.confirm))e.preventDefault()}))})();`);

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
}

function withCookies(response: Response, cookies: string[]): Response {
  const out = new Response(response.body, response);
  for (const cookie of cookies) out.headers.append("Set-Cookie", cookie);
  out.headers.set("Cache-Control", "no-store");
  return out;
}

