import { html, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";
import { runButton } from "./components/actions.ts";
import { stack } from "./components/layout.ts";
import { playingCard } from "./components/playing.ts";

/*
 * "Still there?" beside the game on its page. After a while without input the game's SDK asks the page
 * (zaisma:still-there with untilMs, when the room lets the player go if nothing happens); the page shows
 * this card with the time counting down and answers "showing", so the game draws no plate of its own.
 * I'm here answers "here", which the SDK counts as input. The SDK says untilMs: null once the asking is
 * over (input, or the time ran out), and the card hides. In full screen only the game shows, so the page
 * doesn't answer and the game draws its own plate.
 */

/** The card, hidden until the game asks. */
export function stillThereCard(): Raw {
  return playingCard({
    id: "still-there",
    title: "Still there?",
    body: stack({
      items: [
        { kind: "words", markup: html`<p>If nothing happens, the room lets you go in <span id="still-there-time">30 seconds</span>.</p>` },
        { kind: "control", markup: runButton("I'm here", { id: "still-here", type: "button" }) },
      ],
    }),
  });
}

/** The card's script: it needs the page's frame and gameOrigin (pages.ts), whose script comes first. */
export const STILL_THERE_SCRIPT = pageScript("still-there", `const stillThere = document.getElementById("still-there");
const stillThereTime = document.getElementById("still-there-time");
let stillThereTimer = null;
const tellStillThere = (status) => frame && frame.contentWindow.postMessage({ type: "zaisma:still-there", status }, gameOrigin);
function hideStillThere() {
  clearInterval(stillThereTimer);
  stillThereTimer = null;
  stillThere.hidden = true;
}
function showStillThereTime(untilMs) {
  const leftSec = Math.max(0, Math.ceil((untilMs - Date.now()) / 1000));
  stillThereTime.textContent = leftSec === 1 ? "1 second" : leftSec + " seconds";
  if (!leftSec) hideStillThere();
}
// Only the game's own frame asks.
addEventListener("message", (e) => {
  if (!frame || e.origin !== gameOrigin || e.source !== frame.contentWindow) return;
  const d = e.data;
  if (!d || d.type !== "zaisma:still-there") return;
  hideStillThere();
  if (typeof d.untilMs !== "number" || !Number.isFinite(d.untilMs) || document.fullscreenElement) return;
  // The SDK asks for 30 seconds; a game's own clock never keeps the card up longer than a minute.
  const untilMs = Math.min(d.untilMs, Date.now() + 60000);
  stillThere.hidden = false;
  showStillThereTime(untilMs);
  stillThereTimer = setInterval(() => showStillThereTime(untilMs), 250);
  tellStillThere("showing");
});
document.getElementById("still-here").onclick = () => {
  hideStillThere();
  tellStillThere("here");
  if (frame) frame.focus();
};`);
