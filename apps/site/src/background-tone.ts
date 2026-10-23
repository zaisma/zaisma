import type { BackgroundTone } from "@zaisma/core";
import { glassTint, pngPixels, toneOfPixels, toneOfPng } from "../../../packages/cli/shader-check.mjs";
import type { Env } from "./env.ts";

/**
 * A background's tone: its average color and the glass Zaisma puts over it, measured once from the whole picture (a background
 * picture, when it's added) or the still (a shader, when the check draws it) and kept on its row. Pages send it with the background,
 * so the home opens on the game's own color with its glass already right, and the backdrop script (components/backdrop-script.ts)
 * takes the glass from it instead of measuring. The rule is the backdrop script's pickGlass, which measures backgrounds kept before
 * tones were; keep the two in step: light glass (dark words) or smoked glass (light words), whichever can be thinner while every word
 * keeps its contrast against the harsh side of what's behind. The measuring itself (toneOfPixels, toneOfPng, glassTint, pngPixels) is in
 * packages/cli/shader-check.mjs, which `zaisma check` shares.
 */
export { glassTint, pngPixels, toneOfPixels, toneOfPng };

/** What a page sends with a background: its color and its glass. */
export interface ShownTone {
  averageColor: string;
  isGlassSmoked: boolean;
  glassTint: string;
}
type KeptTone = { [Name in keyof BackgroundTone]: BackgroundTone[Name] | null };
export const shownTone = (kept: KeptTone): ShownTone | null =>
  kept.average_color !== null && kept.is_glass_smoked !== null && kept.glass_tint_pct !== null
    ? { averageColor: kept.average_color, isGlassSmoked: kept.is_glass_smoked === 1, glassTint: glassTint(kept as BackgroundTone) }
    : null;

/** A picture's tone, made small with Cloudflare Images and measured; null without the Images binding or when it fails. */
export async function toneOfPicture(env: Env, bytes: Uint8Array): Promise<BackgroundTone | null> {
  if (!env.IMAGES) return null;
  try {
    const small = await env.IMAGES.input(new Blob([bytes]).stream()).transform({ width: 96, height: 96, fit: "scale-down" }).output({ format: "image/png" });
    return await toneOfPng(new Uint8Array(await new Response(small.image()).arrayBuffer()));
  } catch (error) {
    console.error("background tone failed", error);
    return null;
  }
}
