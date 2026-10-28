import type { Raw } from "../markup.ts";

/**
 * Every page is built from one gallery of components (docs/DECISIONS.md): zaisma.com/design shows each
 * one in every state, rendered from the same code the pages use, so changing a component changes it
 * everywhere at once. A component is its CSS, the markup function pages call, and the examples the
 * gallery shows. Each group file (foundations.ts, actions.ts, …) defines its components as it loads;
 * components/index.ts imports them all and bundles their styles and scripts for the pages.
 */
export type ComponentGroup = "foundations" | "layout" | "actions" | "inputs" | "navigation" | "panes" | "data";

export const COMPONENT_GROUPS: { group: ComponentGroup; name: string }[] = [
  { group: "foundations", name: "Foundations" },
  { group: "layout", name: "Layout" },
  { group: "actions", name: "Actions" },
  { group: "inputs", name: "Inputs" },
  { group: "navigation", name: "Navigation" },
  { group: "panes", name: "Panes" },
  { group: "data", name: "Data" },
];

/**
 * Each group's subgroups, a page of the gallery each (/design/<group>/<subgroup>), in gallery order. A group with none listed (Layout) is
 * one page, and its components name none.
 */
export const COMPONENT_SUBGROUPS: { group: ComponentGroup; subgroup: string; name: string }[] = [
  { group: "foundations", subgroup: "look", name: "Look" },
  { group: "foundations", subgroup: "pictures", name: "Pictures" },
  { group: "foundations", subgroup: "backgrounds", name: "Backgrounds" },
  { group: "actions", subgroup: "buttons", name: "Buttons" },
  { group: "actions", subgroup: "words", name: "Words" },
  { group: "inputs", subgroup: "fields", name: "Fields" },
  { group: "inputs", subgroup: "dates", name: "Dates" },
  { group: "inputs", subgroup: "choices", name: "Choices" },
  { group: "inputs", subgroup: "pickers", name: "Pickers" },
  { group: "navigation", subgroup: "bars", name: "Bars" },
  { group: "navigation", subgroup: "scrolling", name: "Scrolling" },
  { group: "navigation", subgroup: "places", name: "Places" },
  { group: "panes", subgroup: "glass", name: "Glass" },
  { group: "panes", subgroup: "menus", name: "Menus" },
  { group: "panes", subgroup: "cards", name: "Cards" },
  { group: "panes", subgroup: "layers", name: "Layers" },
  { group: "panes", subgroup: "buying", name: "Buying" },
  { group: "data", subgroup: "pictures", name: "Pictures" },
  { group: "data", subgroup: "lists", name: "Lists" },
  { group: "data", subgroup: "numbers", name: "Numbers" },
  { group: "data", subgroup: "states", name: "States" },
  { group: "data", subgroup: "reading", name: "Reading" },
];

/** A group's subgroups in gallery order; none for a group that's one page. */
export const subgroupsOf = (group: ComponentGroup) => COMPONENT_SUBGROUPS.filter((each) => each.group === group);

/** A page of the gallery: a group's subgroup, or a group that's one page (Layout). */
export interface GalleryPlace {
  group: ComponentGroup;
  subgroup?: string;
}

/** Every page of the gallery in order: a page per subgroup, and one for a group with none. */
export const GALLERY_PLACES = (): GalleryPlace[] =>
  COMPONENT_GROUPS.flatMap(({ group }) => {
    const subgroups = subgroupsOf(group);
    return subgroups.length ? subgroups.map(({ subgroup }) => ({ group, subgroup })) : [{ group }];
  });

/**
 * Where a page of the gallery is: Foundations' first subgroup at /design, a group with none at /design/<group>, every other subgroup at
 * /design/<group>/<subgroup>. A group without its subgroup is its first.
 */
export const galleryPagePath = (group: ComponentGroup, subgroup?: string): string => {
  const first = subgroupsOf(group)[0]?.subgroup;
  const shown = subgroup ?? first;
  if (group === "foundations" && shown === first) return "/design";
  return shown ? `/design/${group}/${shown}` : `/design/${group}`;
};

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
  /** The gallery's heading: "Primary button". */
  name: string;
  /** Lowercase words joined by dashes, unique: the anchor #<slug> and the frame path /design/frame/<slug>. */
  slug: string;
  group: ComponentGroup;
  /** Its subgroup's slug, one COMPONENT_SUBGROUPS lists for its group: the gallery page it's on. None for a group that's one page. */
  subgroup?: string;
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
  const subgroups = subgroupsOf(definition.group);
  if (subgroups.length && !subgroups.some((each) => each.subgroup === definition.subgroup)) throw new Error(`${definition.name} names its subgroup, one of ${subgroups.map((each) => each.subgroup).join(", ")}, not ${definition.subgroup}`);
  if (!subgroups.length && definition.subgroup) throw new Error(`${definition.name}'s group, ${definition.group}, is one page: it names no subgroup`);
  componentsBySlug.set(definition.slug, definition);
  return definition;
}

/** Every component in gallery order: by group as ComponentGroup lists them, then by subgroup as COMPONENT_SUBGROUPS lists them, then in the order they were defined. */
export const COMPONENTS = (): Component[] =>
  COMPONENT_GROUPS.flatMap(({ group }) => {
    const ofGroup = [...componentsBySlug.values()].filter((each) => each.group === group);
    const subgroups = subgroupsOf(group);
    return subgroups.length ? subgroups.flatMap(({ subgroup }) => ofGroup.filter((each) => each.subgroup === subgroup)) : ofGroup;
  });

export const componentBySlug = (slug: string): Component | undefined => componentsBySlug.get(slug);
