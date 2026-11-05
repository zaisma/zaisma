// What makes a frame on a computer a phone: a frame answers hover and pointer as the computer does, so a phone's rules never apply. The
// screen's script (frame-script.js) rewrites every media rule through this, and its matchMedia too. The bench's own sizes need nothing:
// a frame's width and height are real. Nor does a frame get a phone's safe areas, so its rules get them through phoneSafeAreaText.
export function phoneMediaText(mediaText) {
  const IS_TRUE = "(min-width: 0px)", IS_FALSE = "(max-width: 0px)";
  return mediaText.replace(/\(\s*(?:any-)?(hover|pointer)(?:\s*:\s*(none|hover|coarse|fine))?\s*\)/gi, (_, feature, featureValue) => {
    const value = (featureValue ?? "").toLowerCase();
    if (feature.toLowerCase() === "hover") return value === "none" ? IS_TRUE : IS_FALSE;
    return value === "coarse" || value === "" ? IS_TRUE : IS_FALSE;
  });
}

/** What an iPhone 15 or 16 tells a page that fills the screen (viewport-fit=cover) to keep clear of its Dynamic Island, corners and home bar. Upright the page starts under the status bar, as in a browser, so its top is the frame's own. Any other page stops at them and is told nothing. */
export const SAFE_AREA_PX = { phone: { top: 0, right: 0, bottom: 34, left: 0 }, turned: { top: 0, right: 59, bottom: 21, left: 59 } };

/** A rule's text with each env(safe-area-inset-*) as that side's pixels, its fallback gone. */
export function phoneSafeAreaText(cssText, insetsPx) {
  return cssText.replace(/env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,[^()]*(?:\([^()]*\)[^()]*)*)?\)/g, (_, side) => `${insetsPx[side]}px`);
}
