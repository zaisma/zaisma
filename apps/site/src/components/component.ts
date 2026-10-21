import type { Raw } from "../markup.ts";

/**
 * Every page is built from one gallery of components (docs/DECISIONS.md): zaisma.com/design shows each
 * one in every state, rendered from the same code the pages use, so changing a component changes it
 * everywhere at once. A component is its CSS, the markup function pages call, and the examples the
 * gallery shows. Each group file (foundations.ts, actions.ts, …) defines its components as it loads;
 * components/index.ts imports them all and bundles their styles and scripts for the pages.
 */
export type ComponentGroup = "foundations" | "actions" | "inputs" | "navigation" | "panes" | "data";

export const COMPONENT_GROUPS: { group: ComponentGroup; name: string }[] = [
  { group: "foundations", name: "Foundations" },
  { group: "actions", name: "Actions" },
  { group: "inputs", name: "Inputs" },
  { group: "navigation", name: "Navigation" },
  { group: "panes", name: "Panes" },
  { group: "data", name: "Data" },
];

export interface ComponentExample {
  /** The state or variant shown: "Rest", "Pointed", "Pressed", "Keyboard focus", "Busy", "Error", "Small", "Full width". The gallery shows it in a few quiet words under the example. */
  label: string;
  markup: Raw;
  /** Spans the whole stage width. */
  isWide?: boolean;
  /** A fixed state (pointed, pressed, focused, busy): shown still, not something to point at or press. */
  isStill?: boolean;
}

export interface Component {
  /** The gallery's heading: "Runner button". */
  name: string;
  /** Lowercase words joined by dashes, unique: the anchor #<slug> and the frame path /design/frame/<slug>. */
  slug: string;
  group: ComponentGroup;
  /** One plain line on when to use it. */
  summary: string;
  /** Its CSS, copied from its draft with the draft's comments. */
  styles: string;
  /** The markup function pages call. Foundations have none. */
  render?: (...renderArguments: never[]) => Raw;
  examples: ComponentExample[];
}

const componentsBySlug = new Map<string, Component>();

export function component(definition: Component): Component {
  if (!/^[a-z]+(-[a-z]+)*$/.test(definition.slug)) throw new Error(`A component's slug is lowercase words joined by dashes, not ${definition.slug}`);
  if (componentsBySlug.has(definition.slug)) throw new Error(`Two components are called ${definition.slug}`);
  componentsBySlug.set(definition.slug, definition);
  return definition;
}

/** Every component in gallery order: by group as ComponentGroup lists them, then in the order they were defined. */
export const COMPONENTS = (): Component[] => COMPONENT_GROUPS.flatMap(({ group }) => [...componentsBySlug.values()].filter((each) => each.group === group));

export const componentBySlug = (slug: string): Component | undefined => componentsBySlug.get(slug);
