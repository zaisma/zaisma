import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import "../../apps/site/src/index.ts";
import { COMPONENTS, COMPONENT_STYLES } from "../../apps/site/src/components/index.ts";
import { component } from "../../apps/site/src/components/component.ts";
import * as actions from "../../apps/site/src/components/actions.ts";
import * as inputs from "../../apps/site/src/components/inputs.ts";
import * as navigation from "../../apps/site/src/components/navigation.ts";
import * as panes from "../../apps/site/src/components/panes.ts";
import * as data from "../../apps/site/src/components/data.ts";
import { html } from "../../apps/site/src/html.ts";

/**
 * Every page is built from one gallery of components (docs/DECISIONS.md): zaisma.com/design shows each one,
 * rendered from the code pages use. These check that every component is on it, that nothing ships outside it,
 * and that its views and frames answer as they should.
 */

const SITE = "https://zaisma.test";
const page = async (path: string) => {
  const response = await SELF.fetch(`${SITE}${path}`);
  return { response, text: await response.text() };
};

describe("the gallery", () => {
  it("shows every component, by name, with its examples", async () => {
    const { response, text } = await page("/design");
    expect(response.status).toBe(200);
    for (const each of COMPONENTS()) {
      const at = text.indexOf(`<section class="component-section" id="${each.slug}"`);
      expect(at, each.slug).toBeGreaterThan(-1);
      const next = text.indexOf('<section class="component-section"', at + 1);
      const section = text.slice(at, next === -1 ? undefined : next);
      expect(section, each.slug).toContain(each.name.replace(/'/g, "&#39;"));
      expect(section.split('<figure class="example').length - 1, each.slug).toBeGreaterThanOrEqual(1);
    }
  });

  it("has a component for every markup function the pages can call, so nothing ships outside it", () => {
    const renders = COMPONENTS().map((each) => each.render);
    const problems = Object.entries({ actions, inputs, navigation, panes, data }).flatMap(([file, exports]) =>
      Object.entries(exports)
        .filter(([, value]) => typeof value === "function")
        .filter(([, value]) => renders.filter((render) => render === value).length !== 1)
        .map(([name]) => `${file}.ts: ${name} isn't the render of exactly one component`),
    );
    expect(problems).toEqual([]);
  });

  it("puts every component's styles in the pages' styles", () => {
    const styles = COMPONENT_STYLES();
    for (const each of COMPONENTS()) expect(styles, each.slug).toContain(each.styles);
  });

  it("gives every component a slug of its own", () => {
    const slugs = COMPONENTS().map((each) => each.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(() => component({ name: "Again", slug: "runner-button", group: "actions", summary: "", styles: "", examples: [] })).toThrow(/Two components/);
    expect(() => component({ name: "Bad", slug: "Not_A_Slug", group: "actions", summary: "", styles: "", examples: [] })).toThrow(/lowercase/);
  });

  it("opens a view from its address: a dark game, dark, at phone width", async () => {
    const { text } = await page("/design?backdrop=dark-game&theme=dark&width=phone");
    expect(text).toMatch(/<div id="stage" class="stage smoke" data-backdrop="dark-game" data-theme-choice="dark" data-width="phone">/);
    const frames = [...text.matchAll(/<iframe class="phone-frame" src="([^"]+)"/g)].map((found) => found[1]);
    expect(frames).toEqual(COMPONENTS().map((each) => `/design/frame/${each.slug}?backdrop=dark-game&amp;theme=dark`));
  });

  it("falls back to Zaisma's own background and light for values it doesn't know", async () => {
    const { text } = await page("/design?backdrop=lava&theme=purple&width=huge");
    expect(text).toContain('<div id="stage" class="stage" data-backdrop="zaisma" data-theme-choice="light" data-width="wide">');
    expect(text).not.toContain('<iframe class="phone-frame"');
  });

  it("keeps light glass over a bright game, whatever the theme", async () => {
    const { text } = await page("/design?backdrop=bright-game&theme=dark");
    expect(text).toContain('data-backdrop="bright-game" data-theme-choice="dark"');
    expect(text).toContain('<div class="stage-glass" data-theme-choice="light">');
  });

  it("lets only the gallery frame its phone frames", async () => {
    const frame = await page("/design/frame/runner-button");
    expect(frame.response.status).toBe(200);
    expect(frame.response.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    for (const path of ["/design", "/"]) expect((await SELF.fetch(`${SITE}${path}`)).headers.get("content-security-policy"), path).toContain("frame-ancestors 'none'");
  });

  it("answers 404 for a component it doesn't have", async () => {
    const { response } = await page("/design/frame/no-such-thing");
    expect(response.status).toBe(404);
  });
});

describe("components", () => {
  it("make the runner a link with an address and a button without one", () => {
    expect(actions.runButton("Play", { href: "/g/x" }).html).toMatch(/<a class="run" href="\/g\/x">/);
    expect(actions.runButton("Play").html).toMatch(/<button class="run" type="submit">/);
  });

  it("give a password field its Show toggle, and an error its message", () => {
    expect(inputs.cutField({ name: "password", label: "Password", type: "password", icon: "lock" }).html).toMatch(/<button type="button" class="show" aria-controls="field-password" aria-pressed="false">Show<\/button>/);
    const marked = inputs.cutField({ name: "username", label: "Username", type: "text", icon: "person", error: "Use letters only." }).html;
    expect(marked).toContain('aria-invalid="true" aria-describedby="field-username-error"');
    expect(marked).toContain('<p class="field-error" id="field-username-error">Use letters only.</p>');
  });

  it("open the Developer and Forum tabs only on a developer page", () => {
    const account = { username: "emma_r", pictureMarkup: html`` };
    const onDashboard = navigation.header({ current: "developer", isOnDeveloperPage: true, account }).html;
    expect(onDashboard).toContain('<a href="/dashboard" class="dev" aria-current="page">Developer</a>');
    expect(onDashboard).toContain('<a href="/forum" class="dev">Forum</a>');
    const atHome = navigation.header({ current: "home", isOnDeveloperPage: false, account }).html;
    expect(atHome).toContain('<a href="/dashboard" class="dev off" tabindex="-1" aria-hidden="true">Developer</a>');
    expect(atHome).toContain('<a href="/forum" class="dev off" tabindex="-1" aria-hidden="true">Forum</a>');
  });
});
