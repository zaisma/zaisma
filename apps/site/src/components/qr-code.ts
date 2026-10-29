import { html, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { CUT_LINE } from "./foundations.ts";
import { secondaryButton } from "./actions.ts";
import { examplePane } from "./example-pane.ts";
import { qrCodeSvg } from "@zaisma/core";

export interface QrCodeOptions {
  /** Unique on the page: the picture's, for a page script to point it at a link (its caption is <id>-caption). */
  id: string;
  /** What a screen reader says for it: "QR code for this link". */
  label: string;
  /** The line under it: "Scan to play". */
  caption: string;
  /** The QR code's picture (an SVG Zaisma serves). Left out, a page script sets it. */
  imageUrl?: string;
  /** The game's icon, small over the code's middle: the code is drawn at error correction level H, so it still reads. Left out, the code is whole. */
  iconUrl?: string;
  /** A secret on a screen others may see (a streamer's room): blurred until a page script takes is-masked off it. */
  isMasked?: boolean;
  /** As large as the screen allows, to hold up to someone across a room: the Light box's. */
  isLarge?: boolean;
  /** Its two downloads under it, for a developer's posters and stream overlays: the SVG as it is, and a 1024px PNG drawn from it. fileName has no extension. */
  download?: { svgUrl: string; fileName: string };
}

/**
 * A QR code: a link as a picture any phone's camera reads, on a white tile raised off the glass whatever the theme, its own shape like
 * a lone control's, the game's icon over its middle when it has one, with a line under it saying what it opens.
 */
export function qrCode(options: QrCodeOptions): Raw {
  const download = options.download;
  return html`<figure class="qr-code${options.isMasked ? " is-masked" : ""}${options.isLarge ? " is-large" : ""}"><span class="qr-cast" data-on-no-pane><span class="qr-tile cut-raised" data-cut-line="8">${CUT_LINE}<img class="qr-picture" id="${options.id}"${options.imageUrl ? html` src="${options.imageUrl}"` : ""} alt="${options.label}" width="220" height="220">${options.iconUrl ? html`<img class="qr-icon" src="${options.iconUrl}" alt="" width="48" height="48">` : ""}</span></span><figcaption class="qr-caption" id="${options.id}-caption">${options.caption}</figcaption>${download ? html`<div class="control-row qr-downloads">${secondaryButton("Download SVG", { href: download.svgUrl, downloadName: `${download.fileName}.svg` })}${secondaryButton("Download PNG", { type: "button", dataAttributes: { "qr-png": `${download.fileName}.png`, "qr-svg": download.svgUrl } })}</div>` : ""}</figure>`;
}

/** Download PNG: the code's SVG drawn at 1024px, crisp, and saved under its name. */
export const QR_CODE_SCRIPT = `
(function () {
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[data-qr-png]");
    if (!button) return;
    var image = new Image();
    image.onload = function () {
      var canvas = Object.assign(document.createElement("canvas"), { width: 1024, height: 1024 }), context = canvas.getContext("2d");
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, 1024, 1024);
      canvas.toBlob(function (blob) {
        var link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: button.getAttribute("data-qr-png") });
        link.click();
        setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
      }, "image/png");
    };
    image.src = button.getAttribute("data-qr-svg");
  });
})();
`;

/** The gallery's QR code: a stand-in game's address, made as Zaisma makes every game's. */
export const STAND_IN_QR_CODE = `data:image/svg+xml,${encodeURIComponent(qrCodeSvg("https://zaisma.com/g/ashen-crown"))}`;

/** The gallery's stand-in game icon: an ember crown, as a game's own icon would sit there. */
export const STAND_IN_GAME_ICON = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b2f5c"/><stop offset="0.55" stop-color="#8c2f3a"/><stop offset="1" stop-color="#f08a2c"/></linearGradient></defs><rect width="64" height="64" fill="url(#a)"/><path d="M14 44 L12 22 L23 31 L32 16 L41 31 L52 22 L50 44 Z" fill="#ffd27a"/><rect x="14" y="46" width="36" height="5" fill="#ffd27a"/></svg>`)}`;

component({
  name: "QR code",
  slug: "qr-code",
  group: "data",
  subgroup: "pictures",
  summary: "A link as a picture a phone's camera reads: a game's address, or a room's, for someone in the same room. Black on a raised white tile whatever the glass, the game's icon at its middle, with a line saying what it opens.",
  styles: `
/* A QR code: the picture on a white tile raised off the glass, its own shape like a lone control's (data-on-no-pane), a quiet margin of
   white round the code inside it, so any phone's camera reads it on light glass or smoked; as wide as the room allows up to 220px, its line
   under it in the label's words. The game's icon sits over its middle, a fifth of its width, ringed in the tile's white: the code is drawn at
   error correction level H, which reads through it. Masked, it blurs until the page shows it. */
.qr-code { display: grid; justify-items: center; gap: var(--gap-words-control); margin: 0; min-width: 0; }
.qr-cast { display: block; width: min(220px, 100%); filter: var(--thumb-cast); }
.qr-tile { position: relative; display: block; padding: 6px; background: #fff; clip-path: var(--cut-shape); }
.qr-tile > .cut-line { --band-top: rgba(255,255,255,1); --band-left: rgba(255,255,255,0.9); --band-right: rgba(20,30,50,0.14); --band-bottom: rgba(20,30,50,0.22); }
.qr-picture { display: block; width: 100%; height: auto; aspect-ratio: 1; background: #fff; transition: filter var(--motion-state); }
.qr-icon { position: absolute; left: 50%; top: 50%; width: 20%; height: auto; aspect-ratio: 1; transform: translate(-50%, -50%); outline: 3px solid #fff; object-fit: cover; transition: filter var(--motion-state); }
/* Its words keep the margin inside it, as a field's do, however wide they run (a masked code's caption, at a large text size). */
.qr-caption { font: var(--type-label); color: var(--ink); text-align: center; padding-inline: var(--pad-inside-words); }
.qr-code.is-masked :is(.qr-picture, .qr-icon) { filter: blur(8px); }
/* Large (a light box's): as big as the screen allows, its white margin wider to match, its line under it. */
.qr-code.is-large > .qr-cast { width: min(360px, 76vw, 58dvh); }
.qr-code.is-large .qr-tile { padding: var(--pad-tray); }
/* With its downloads: a Row under its line, across the pane, its two buttons sharing it. */
.qr-code > .qr-downloads { justify-self: stretch; }
.qr-downloads > * { flex: 1 1 0; }
`,
  render: qrCode,
  examples: [
    { label: "A game's link, its icon at the middle", markup: examplePane(qrCode({ id: "example-qr-game", label: "QR code for this link", caption: "Scan to play", imageUrl: STAND_IN_QR_CODE, iconUrl: STAND_IN_GAME_ICON })) },
    { label: "A game with no icon yet: the code whole", markup: examplePane(qrCode({ id: "example-qr-plain", label: "QR code for this link", caption: "Scan to play", imageUrl: STAND_IN_QR_CODE })) },
    { label: "With its downloads, for a developer's posters and streams", markup: examplePane(qrCode({ id: "example-qr-download", label: "QR code for this link", caption: "Scans to zaisma.com/g/ashen-crown", imageUrl: STAND_IN_QR_CODE, iconUrl: STAND_IN_GAME_ICON, download: { svgUrl: STAND_IN_QR_CODE, fileName: "ashen-crown-qr-code" } })) },
    { label: "Masked, for a streamer: blurred until shown", markup: examplePane(qrCode({ id: "example-qr-masked", label: "QR code for this link", caption: "Scan to join this match", imageUrl: STAND_IN_QR_CODE, iconUrl: STAND_IN_GAME_ICON, isMasked: true })), isStill: true },
  ],
});
