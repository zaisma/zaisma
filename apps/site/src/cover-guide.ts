import type { Env } from "./env.ts";
import { html, layout, raw, type Raw } from "./html.ts";

/**
 * zaisma.com/developers/covers: the cover guide ("No slop" in docs/DECISIONS.md). The lines the listing check
 * holds covers, screenshots and titles to, each with a Fine and a Not fine picture, and what the best covers do.
 * docs/COVERS.md says the same for any AI; keep the two in step. The pictures are in brand/cover-guide/: good
 * covers made from real captures of Zaisma's demo games, and stand-ins for made-up games, never a real developer's.
 */

const PICTURES = "/cover-guide";

const figure = (file: string, caption: string, verdict: "fine" | "not-fine" | "plain") =>
  html`<figure class="guide-figure ${verdict}"><img src="${PICTURES}/${file}" alt="${caption}" loading="lazy" width="1280" height="720"><figcaption>${verdict === "fine" ? html`<strong>Fine.</strong> ` : verdict === "not-fine" ? html`<strong>Not fine.</strong> ` : ""}${caption}</figcaption></figure>`;

const STYLE = raw(`<style>
.guide{max-width:960px}
.guide-pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin:12px 0 28px}
.guide-figure{margin:0}
.guide-figure img{width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:10px;display:block;background:var(--pic)}
.guide-figure figcaption{margin-top:8px;font-size:.95em;color:var(--muted)}
.guide-figure.fine img{outline:3px solid #3fb96b;outline-offset:2px}
.guide-figure.not-fine img{outline:3px solid #e5534b;outline-offset:2px}
.guide-figure strong{color:var(--text)}
.guide ol>li{margin-bottom:6px}
</style>`);

export function coverGuidePage(env: Env): Response {
  const body: Raw = html`<div class="guide">
<h1>Covers that show your game</h1>
<p class="lead">Your cover is your game's card everywhere players browse, shown alone with no title over or under it. Zaisma's lists show games whose covers and titles keep five lines anyone can check against the picture. Style is yours: here's what passes, what doesn't, and what the best covers do.</p>

<h2>What great covers do</h2>
<ol>
<li>One subject from the game, big.</li>
<li>The game's name, big enough to read on a phone.</li>
<li>The game's own art and colors.</li>
<li>A simple background, with room around the subject.</li>
<li>Still clear as a small card.</li>
</ol>
<div class="guide-pair">
${figure("good-four-in-a-row.webp", "A real board from the game, and its name.", "fine")}
${figure("good-arena.webp", "The game's own arena, and its name.", "fine")}
</div>
<p>More covers worth studying, on their own store pages: <a href="https://store.steampowered.com/app/504230/Celeste/" rel="noopener">Celeste</a>, <a href="https://store.steampowered.com/app/2379780/Balatro/" rel="noopener">Balatro</a> and <a href="https://store.steampowered.com/app/367520/Hollow_Knight/" rel="noopener">Hollow Knight</a>.</p>

<h2>The five lines</h2>
<p>An AI checks every cover, square cover and share picture in about a minute. These are the lines it holds them to, the same for every game.</p>

<h3>1. No text but the title</h3>
<p>The game's name, a subtitle and your studio's logo. No callouts, update banners, feature lists, counts or prices. Words that are part of the scene, like a sign on a building, are fine.</p>
<div class="guide-pair">
${figure("lava-leap-fine.webp", "The name, and the game.", "fine")}
${figure("lava-leap-extra-text.webp", "“NEW LEVELS!”, “+1 JUMP / SEC” and “100 STAGES” are extra text.", "not-fine")}
</div>

<h3>2. Nothing laid over the picture</h3>
<p>No buttons, menus, shop panels, reward rows, badges, stickers, or arrows and circles pointing at things.</p>
<div class="guide-pair">
${figure("lava-leap-overlay.webp", "A shop panel, a Play button and an arrow laid over it.", "not-fine")}
</div>

<h3>3. No fake rewards</h3>
<p>Nothing promising free Robux, V-Bucks, gift cards or cash, on a cover, a screenshot or in the title. This one holds the game until a person looks.</p>
<div class="guide-pair">
${figure("lava-leap-fake-reward.webp", "“FREE” and “5,000 ROBUX”: the game is held.", "not-fine")}
</div>

<h3>4. No famous characters, logos or names you don't own</h3>
<p>Only the obvious ones count: a character, logo or name a teen would name at a glance, like Mario, Naruto, Lightning McQueen, a football club's crest or the Roblox logo. Generic blocky or pixel characters are fine. If you own it or have permission, message Zaisma. What's inside your game is different: Zaisma acts on borrowed characters there only when the owner sends a notice.</p>

<h3>5. Built around something from the game</h3>
<p>The character, creature or thing your cover is built around appears in at least one of your screenshots, in any art style.</p>
<div class="guide-pair">
${figure("gem-grid-cover.webp", "A giant robot on the cover…", "not-fine")}
${figure("gem-grid-screenshot.webp", "…and a gem puzzle in the game, with no robot anywhere.", "plain")}
</div>

<h2>Busy and bright is fine</h2>
<p>Bright colors, busy art, shocked faces, piles of coins and an AI-made look are never against the lines. The covers at the top show what tends to work better.</p>
<div class="guide-pair">
${figure("coin-cascade-busy-fine.webp", "Loud, and only the title: it passes.", "fine")}
</div>

<h2>Screenshots</h2>
<p>A screenshot is a real capture of the game. Its score, menus, buttons and shop screens are welcome. Anything added afterwards isn't: a caption, an arrow or circle, a sticker, a pasted logo, a device frame. Such a screenshot doesn't show.</p>
<div class="guide-pair">
${figure("screenshot-fine.webp", "The game's own interface, as it was on screen.", "fine")}
${figure("screenshot-not-fine.webp", "A caption, an arrow and a circle added after the capture.", "not-fine")}
</div>

<h2>Titles</h2>
<p>A title names the game. No tags: a bracketed tag like [UPDATE], an emoji, or NEW, UPDATE or FREE used as a tag. “+1 Speed Run”, “Wrangler 2x” and “Free Fall” are names, so they're fine. No famous names you don't own, and no fake rewards. Patch notes are where you say what's new.</p>

<h2>What happens</h2>
<p>Pictures and new words are checked in about a minute. A cover or title that breaks a line still shows on your game's page, and the game plays by its link, but home, All games, browse and search engines leave it out until it's fixed; it's back about a minute after. Your dashboard, and your AI through <code>get_game</code>, say what and how to fix it. A fake reward holds the game until a person looks. If the check got something wrong, message Zaisma from the dashboard, or <code>message_zaisma</code>, and a person looks.</p>
</div>`;
  return layout(env, { title: "Covers that show your game · Zaisma", head: STYLE, body });
}
