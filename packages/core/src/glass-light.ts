/*
 * The glass pass every shader background runs inside (apps/site/src/components/foundations.ts, BACKDROP_SCRIPT, and the game
 * domain's background runner), and the main a buffer pass runs in. They live with the shader check's drawing in
 * packages/cli/shader-check.mjs, so Zaisma's own pages, the game domain, the shader check and `zaisma check` all compile the same thing.
 */
export { BUFFER_PASS, GLASS_LIGHT_PASS, MOST_GLASS_PANE_COUNT } from "../../cli/shader-check.mjs";
