import { SHADER_LIMITS } from "@zaisma/core";
import type { Env } from "./env.ts";
import { html, layout, scriptTags, type Raw } from "./html.ts";
import type { Viewer } from "./viewer.ts";
import { textLink } from "./components/actions.ts";
import { STAND_IN_BACKGROUNDS_SCRIPT, gameBackgroundFrame, glassPane, tray } from "./components/foundations.ts";
import { grid, stack } from "./components/layout.ts";
import { readingText } from "./components/reading.ts";
import { SHADER_HELPERS, STAND_IN_BACKGROUNDS, type StandInBackground } from "./components/shaders.ts";

/**
 * zaisma.com/developers/backgrounds: the background guide, beside the cover guide ("Richer game shaders" in docs/DECISIONS.md). The lines
 * that keep a background clear under Zaisma's glass, each with why, and the stand-in worlds drawn live with their sources open at
 * /developers/backgrounds/<slug>.glsl, as starting points for any AI. docs/BACKGROUNDS.md says the same for any AI, word for word:
 * test/node/background-guide.test.ts keeps the two in step. Its numbers come from SHADER_LIMITS, so it says what the check does.
 */

export const BACKGROUND_GUIDE_PATH = "/developers/backgrounds";

/** One line of the guide: a rule anyone can check against their background, and why it holds. Words in backticks are set as code. */
export interface BackgroundGuideLine {
  rule: string;
  reason: string;
}

const drawnShare = SHADER_LIMITS.runtimeResolutionScale === 0.5 ? "half" : `${Math.round(SHADER_LIMITS.runtimeResolutionScale * 100)}% of`;

/** The guide's words, the same on the page and in docs/BACKGROUNDS.md. */
export const BACKGROUND_GUIDE = {
  title: "Backgrounds behind the glass",
  lead: "Your background is your game's world behind Zaisma's glass, on the home and on your game page: a picture, or a shader that paints it live. Style is yours. These lines keep the glass over it thin and the words on the glass clear, and anyone can check a background against them. The worlds further down are drawn live, and their sources are open to start from.",
  linesHeading: "The lines",
  linesIntro: "What keeps a background clear under the glass, each with why. The first three are for pictures and shaders alike; the rest are for shaders.",
  lines: [
    { rule: "Keep most of it light, or most of it dark.", reason: "Zaisma reads your whole background once and makes its glass as thin as the words on it allow. A busy mix of bright and dark forces thick glass, which hides your world." },
    { rule: "Keep your subject clear of the glass.", reason: "On a wide screen Zaisma's glass sits on the left, so put the subject on the right. On a phone the glass takes the bottom half, so put it in the top half." },
    { rule: "No words, titles or logos.", reason: "Those go on your cover, and a background with them doesn't show (`text_on_background`). Words that are part of the scene, like a sign on a building, are fine." },
    { rule: "Compose by the screen's shape.", reason: "Phones show your wide shader until you send one for them, drawn at the phone's shape. Place things by `iResolution`'s width over its height, never by fixed pixels, and one shader serves both." },
    { rule: `Nothing flashes more than ${SHADER_LIMITS.maximumFlashCountPerSec} times a second.`, reason: "Flashing can cause seizures, so the check refuses a shader that does (`shader_flashes`)." },
    { rule: `No detail finer than about ${Math.round(1 / SHADER_LIMITS.runtimeResolutionScale)} pixels, and soft edges.`, reason: `Players' browsers draw a shader at ${drawnShare} the screen's resolution and scale it up, so finer or hard-edged detail shimmers as it moves.` },
    { rule: "Make every moment a finished picture.", reason: `The check keeps a still at ${SHADER_LIMITS.stillTimeSec} seconds and frames through the first ${SHADER_LIMITS.sampledFramesOverSec}, Zaisma picks the glass from that still, and the still is what shows under reduced motion. Nothing should fade in from black or build up first.` },
    { rule: "Stay within the check's time.", reason: `The check draws ${SHADER_LIMITS.checkFrameCount} frames at ${SHADER_LIMITS.checkWidthPx} by ${SHADER_LIMITS.checkHeightPx} on a software renderer and takes their median, scaled so Zaisma's own background takes ${SHADER_LIMITS.referenceFrameMs} ms. Yours can take up to ${SHADER_LIMITS.maximumCheckFrameMs} ms (\`shader_too_slow\` past it), and \`check_frame_ms\` says what it took. Layers of noise and long loops cost the most.` },
  ] satisfies BackgroundGuideLine[],
  worldsHeading: "Worlds to start from",
  worldsIntro: "The stand-in games' backgrounds, drawn live as a game's own would be. Each source is the whole shader, with the helpers it calls written in, as a game sends it. They're under the MIT license: copy one, hand it to your AI and make it yours.",
  worldsSource: "The same shaders are in Zaisma's source: `STAND_IN_BACKGROUNDS` in `apps/site/src/components/shaders.ts`, with the helpers they call in `SHADER_HELPERS`.",
  whatHappensHeading: "What happens",
  whatHappens: "A picture is checked like a cover, in about a minute. A shader is drawn and timed before anyone sees it, usually within a minute: it must compile, keep within the time and not flash, and its still and frames go through the same checks as pictures. Your dashboard, and your AI through `get_game`, say what passed and how to fix what didn't. Choosing what each screen shows is a step of its own, so you see a shader's still and frames before it shows anywhere.",
};

/** Where a stand-in world's source is served, as plain text. */
export const backgroundSourcePath = (slug: string) => `${BACKGROUND_GUIDE_PATH}/${slug}.glsl`;

/** A stand-in world's source as a game would send it: a line naming it, the helpers it calls, then its mainImage. */
export function backgroundSourceText(background: StandInBackground): string {
  return `${[`// ${background.title}, a stand-in world from zaisma.com${BACKGROUND_GUIDE_PATH}. MIT licensed: free to start from.`, SHADER_HELPERS.trim(), background.shader.trim()].join("\n\n")}\n`;
}

/** GET /developers/backgrounds/<slug>.glsl: the source, or null when no stand-in world has that slug. */
export function backgroundSourceResponse(slug: string): Response | null {
  const background = STAND_IN_BACKGROUNDS.find((each) => each.slug === slug);
  if (!background) return null;
  return new Response(backgroundSourceText(background), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}

/** Words with `code` in backticks, as markup: the words escaped, the code set as code. */
const withCode = (words: string): Raw => html`${words.split("`").map((part, partIndex) => (partIndex % 2 ? html`<code>${part}</code>` : html`${part}`))}`;

/**
 * A world, framed and live, with Zaisma's glass over it naming it, as the gallery's Game background shows each one (foundations.ts): the
 * Backdrop's frame and its glass, drawn by the backdrop script once STAND_IN_BACKGROUNDS_SCRIPT gives the canvas its shader, the glass
 * light or smoked by what the world shows.
 */
const worldFrame = (background: StandInBackground): Raw => gameBackgroundFrame({ standInSlug: background.slug, title: background.title, note: background.genre });

/** The page's content, inside the shell (the header, Zaisma's backdrop and the footer). */
export function backgroundGuideBody(): Raw {
  const guide = BACKGROUND_GUIDE;
  const intro = glassPane({
    paneWidth: "fit",
    body: stack({
      items: [
        { kind: "words", markup: html`<h1>${guide.title}</h1>` },
        { kind: "words", markup: html`<p>${guide.lead}</p>` },
        {
          kind: "words",
          markup: html`<p>What goes on your cover is in ${textLink("the cover guide", "/developers/covers")}. How to send a background and choose where it shows is in ${textLink("the developer docs", "https://github.com/zaisma/zaisma/blob/main/docs/DEVELOPER-API.md#backgrounds")}, and this guide is also ${textLink("a file your AI can read", "https://github.com/zaisma/zaisma/blob/main/docs/BACKGROUNDS.md")}.</p>`,
        },
      ],
    }),
  });
  const lines = glassPane({
    paneWidth: "fit",
    label: guide.linesHeading,
    body: stack({
      items: [
        { kind: "words", markup: html`<h2>${guide.linesHeading}</h2>` },
        { kind: "words", markup: html`<p>${guide.linesIntro}</p>` },
        { kind: "words", markup: readingText({ markup: html`<ol>${guide.lines.map((line) => html`<li><strong>${line.rule}</strong> ${withCode(line.reason)}</li>`)}</ol>` }) },
      ],
    }),
  });
  // The worlds on a tray beneath their words, each framed with its source under it; the tray ends in words, so no world's sits at its foot.
  const worlds = tray({
    label: guide.worldsHeading,
    head: readingText({ markup: html`<h2>${guide.worldsHeading}</h2><p>${guide.worldsIntro}</p>` }),
    body: stack({
      items: [
        {
          kind: "block",
          markup: grid({
            itemSize: "card",
            items: STAND_IN_BACKGROUNDS.map((background) => ({
              kind: "block" as const,
              markup: stack({
                label: background.title,
                items: [
                  { kind: "block", markup: worldFrame(background) },
                  { kind: "words", markup: readingText({ markup: html`<p>${background.summary}</p><p>${textLink(`${background.title}'s source`, backgroundSourcePath(background.slug))}</p>` }) },
                ],
              }),
            })),
          }),
        },
        { kind: "words", markup: readingText({ markup: html`<p>${withCode(guide.worldsSource)}</p>` }) },
      ],
    }),
  });
  const whatHappens = glassPane({
    paneWidth: "fit",
    body: stack({ items: [{ kind: "words", markup: html`<h2>${guide.whatHappensHeading}</h2>` }, { kind: "words", markup: readingText({ markup: html`<p>${withCode(guide.whatHappens)}</p>` }) }] }),
  });
  return stack({ items: [intro, lines, worlds, whatHappens].map((markup) => ({ kind: "block" as const, markup })) });
}

export function backgroundGuidePage(env: Env, viewer: Viewer): Response {
  // The worlds' shaders come from a cached script, too long to write into the page.
  const response = layout(env, { title: `${BACKGROUND_GUIDE.title} · Zaisma`, body: html`${backgroundGuideBody()}${scriptTags(STAND_IN_BACKGROUNDS_SCRIPT)}`, nav: "developer", viewer, isRebuilt: true });
  for (const cookie of viewer.cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}
