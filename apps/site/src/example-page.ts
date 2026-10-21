import type { Env } from "./env.ts";
import { html, layout } from "./html.ts";
import { runButton, textLink } from "./components/actions.ts";
import { cutField, longField, toggle } from "./components/inputs.ts";
import { glassPane } from "./components/foundations.ts";

/**
 * zaisma.com/design/example: a small page built only from the gallery's components, in the page shell (the header, the backdrop,
 * the footer), as every page is rebuilt. It shows how a page is put together: pick the components for what the page does, call
 * their functions with the options the catalog in docs/DESIGN.md lists, and write no markup or CSS of your own. The pane stacks what
 * it holds, so the controls sit in it as direct children, never in a wrapper of their own. test/site/design.test.ts
 * holds it to the same checks as the gallery, so a piece that comes from no component fails there.
 */
export function examplePage(env: Env): Response {
  const body = glassPane({
    paneSize: "medium",
    body: html`<h2>Tell players about your game</h2>
<p>A page is components in a pane: this one asks for a name, a few words and one setting, and saves nothing.</p>
${cutField({ id: "example-page-title", name: "title", label: "Title", type: "text", icon: "person", placeholder: "Tiny Farm" })}
${longField({ id: "example-page-description", name: "description", label: "Description", rowCount: 4, maximumCharacterCount: 500, placeholder: "What is it, and who is it for?" })}
${toggle({ id: "example-page-listed", name: "is_listed", label: "Show it to players", isOn: true, hint: "Only people with the link can play it while this is off." })}
${runButton("Save", { type: "button", isFullWidth: true })}
<p>${textLink("Every component", "/design")}, in every state.</p>`,
  });
  return layout(env, { title: "Example page · Design · Zaisma", body, isRebuilt: true });
}
