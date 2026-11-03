// What makes a frame on a computer a phone: a frame answers hover and pointer as the computer does, so a phone's rules never apply. The
// screen's script (frame-script.js) rewrites every media rule through this, and its matchMedia too. The bench's own sizes need nothing:
// a frame's width and height are real.
export function phoneMediaText(mediaText) {
  const IS_TRUE = "(min-width: 0px)", IS_FALSE = "(max-width: 0px)";
  return mediaText.replace(/\(\s*(?:any-)?(hover|pointer)(?:\s*:\s*(none|hover|coarse|fine))?\s*\)/gi, (_, feature, featureValue) => {
    const value = (featureValue ?? "").toLowerCase();
    if (feature.toLowerCase() === "hover") return value === "none" ? IS_TRUE : IS_FALSE;
    return value === "coarse" || value === "" ? IS_TRUE : IS_FALSE;
  });
}
