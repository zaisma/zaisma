import { Raw } from "../markup.ts";

/** How tall a control is, by its size class (tokens.ts's --control-height-*): a row sets every control in it to its tallest's. */
export type ControlHeight = "tiny" | "small" | "regular" | "field" | "big";

/** The size classes from shortest to tallest, so a row can take its tallest. */
export const CONTROL_HEIGHTS: ControlHeight[] = ["tiny", "small", "regular", "field", "big"];

/**
 * A control's markup: what a layout (layout.ts) takes as a control, in a row, a stack or a pane's corner. It's a type of its own, made only
 * by the controls' own functions (actions.ts, fields.ts, choices.ts, inputs.ts, and switch.ts), so a paragraph can't be
 * passed as a control and a corner can't be given two things: the compiler refuses it. design.test.ts checks no other file makes one.
 */
export class ControlMarkup extends Raw {
  /** Makes it a type of its own: plain markup isn't a control. */
  private declare readonly isControlMarkup: true;
  constructor(
    html: string,
    /** Its size class: how tall it is, for the row it sits in. */
    readonly controlHeight: ControlHeight,
    /** It shows words of its own round it (a field's label), so a stack spaces it as a block. */
    readonly hasOwnWords: boolean,
    /** It's words alone, with no edge of its own (a tertiary button), so it keeps the words' margin in a pane, like words. */
    readonly isWordsAlone: boolean,
  ) {
    super(html);
  }
}

/** Marks a control's markup as a control, for its own function to return. */
export function controlMarkup(markup: Raw, controlHeight: ControlHeight, options: { hasOwnWords?: boolean; isWordsAlone?: boolean } = {}): ControlMarkup {
  return new ControlMarkup(markup.html, controlHeight, Boolean(options.hasOwnWords), Boolean(options.isWordsAlone));
}
