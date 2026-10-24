import type { Env } from "./env.ts";
import { html, layout } from "./html.ts";
import { cutButton, runButton, textLink } from "./components/actions.ts";
import { cutField, longField, toggle } from "./components/inputs.ts";
import { glassPane } from "./components/foundations.ts";
import { row, stack } from "./components/layout.ts";

/**
 * zaisma.com/design/example: a small page built only from the gallery's components, in the page shell (the header, the backdrop,
 * the footer), as every page is rebuilt. It shows how a page is put together: pick the components for what the page does, call
 * their functions with the options the catalog in docs/DESIGN.md lists, lay them out with the layout components (a stack, a row),
 * saying what each thing is, and write no markup or CSS of your own: the layout picks every gap and margin. test/site/design.test.ts
 * holds it to the same checks as every page, and npm run layout:check measures it.
 */
export function examplePage(env: Env): Response {
  const body = glassPane({
    paneWidth: "fit",
    body: stack({
      items: [
        { kind: "words", markup: html`<h2>Tell players about your game</h2>` },
        { kind: "control", markup: cutField({ id: "example-page-title", name: "title", label: "Title", type: "text", icon: "pencil", placeholder: "Tiny Farm" }) },
        { kind: "block", markup: longField({ id: "example-page-description", name: "description", label: "Description", rowCount: 3, maximumCharacterCount: 500, placeholder: "What is it, and who is it for?" }) },
        { kind: "block", markup: toggle({ id: "example-page-listed", name: "is_listed", label: "Show it to players", isOn: true, hint: "Only people with the link can play it while this is off." }) },
        { kind: "block", markup: row({ widths: "equal", items: [{ kind: "control", markup: runButton("Save", { type: "button" }) }, { kind: "control", markup: cutButton("Cancel", { type: "button" }) }] }) },
        { kind: "words", markup: html`<p>This page saves nothing: it shows how one is built from the gallery. ${textLink("Every component", "/design")}, in every state.</p>` },
      ],
    }),
  });
  // The gallery shows it on the four screens (Screens, in the layout group), so the site's own pages may frame it.
  return layout(env, { title: "Example page · Design · Zaisma", body, checkedPage: "Example page", isFramedBySelf: true });
}
