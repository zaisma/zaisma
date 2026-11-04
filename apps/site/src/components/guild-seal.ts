import { html, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { picture } from "./foundations.ts";

/** Each size it shows at, and the kept picture (brand/guild-seal-<px>.webp, npm run guild-seal: one drawing, simply smaller) that's sharp there at twice its pixels. */
const SEAL_WIDTH_PX = { small: 48, medium: 96, large: 240 } as const;
const KEPT_WIDTH_PX = { small: 128, medium: 256, large: 512 } as const;

export interface GuildSealOptions {
  /** How large it shows. */
  sealSize: keyof typeof SEAL_WIDTH_PX;
  /** It's made in front of you when it comes into view, then rests moving; under reduced motion, or until its video arrives, it's the picture. */
  isForging?: boolean;
}

/** Zaisma Pro's seal: brass on its own dark circle, so it needs nothing behind it. A picture, or two videos, never a live drawing. */
export function guildSeal(options: GuildSealOptions): Raw {
  const widthPx = SEAL_WIDTH_PX[options.sealSize], label = "The Zaisma Guild of Game Makers";
  if (options.isForging) return html`<video class="guild-seal is-${options.sealSize} guild-seal-video" poster="/guild-seal-512.webp" width="${widthPx}" height="${widthPx}" muted playsinline preload="none" aria-label="${label}" data-forging="/design/videos/guild-seal-forging.mp4" data-resting="/design/videos/guild-seal-resting.mp4"></video>`;
  const keptPx = KEPT_WIDTH_PX[options.sealSize];
  return picture({ imageUrl: `/guild-seal-${keptPx}.webp`, widthPx: keptPx, heightPx: keptPx, placeholderDataUrl: null }, { label, hasOwnShape: true, isEager: true, className: `guild-seal is-${options.sealSize}` });
}

/**
 * A forging seal plays once it's in view, then goes on to its resting loop, pausing whenever it's out of view. Under reduced motion it stays
 * the still picture. A video that can't play stays that picture too.
 */
export const GUILD_SEAL_SCRIPT = `/* guild seal */(function () {
  if (!window.IntersectionObserver || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  window.zaismaWatch.each("video.guild-seal-video", function (video) {
    var isStarted = false;
    video.addEventListener("ended", function () { video.src = video.getAttribute("data-resting"); video.loop = true; video.play().catch(function () {}); });
    new IntersectionObserver(function (entries) {
      if (entries[entries.length - 1].isIntersecting) { if (!isStarted) { isStarted = true; video.src = video.getAttribute("data-forging"); } video.play().catch(function () {}); }
      else video.pause();
    }).observe(video);
  });
})();
`;

component({
  name: "Guild seal",
  slug: "guild-seal",
  group: "foundations",
  subgroup: "pictures",
  after: "logo",
  summary: "Zaisma Pro's mark: the same seal at every size, brass on its own dark circle. Use it for Pro and nothing else; everything else about Zaisma is the Logo.",
  styles: `
/* The seal: a round picture with its own background, its size one of three. Its video is cropped to the circle a square video can't be. */
.guild-seal { display: block; flex: none; border-radius: 50%; }
.guild-seal.is-small { width: 48px; height: 48px; }
.guild-seal.is-medium { width: 96px; height: 96px; }
.guild-seal.is-large { width: min(240px, 100%); height: auto; aspect-ratio: 1; }
/* Its picture behind it, showing wherever the video hasn't, or can't. */
.guild-seal-video { background: center / cover url(/guild-seal-512.webp); }
/* A pane's mark, standing above its words as Icons' large icon does. */
.guild-seal-place { display: flex; justify-content: center; }
`,
  render: guildSeal,
  examples: [
    { label: "Large", markup: guildSeal({ sealSize: "large" }) },
    { label: "Medium", markup: guildSeal({ sealSize: "medium" }) },
    { label: "Small", markup: guildSeal({ sealSize: "small" }) },
    { label: "Being made, then resting: it plays when it comes into view", markup: guildSeal({ sealSize: "large", isForging: true }) },
  ],
});
