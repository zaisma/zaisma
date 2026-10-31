// The stand-in covers' placeholders (brand/design/covers), for the gallery's game cards: each cover PICTURE_PLACEHOLDER.widthPx wide as a
// WebP data: URL, as Cloudflare Images makes a game's own when it's approved (apps/site/src/placeholders.ts), drawn here in headless Chrome
// (scripts/chrome.mjs). It writes apps/site/src/generated/stand-in-placeholders.generated.ts; run it again when a stand-in cover changes.
//
//   node scripts/stand-in-placeholders.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openChrome } from "./chrome.mjs";
import { chromeToRun } from "./layout-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COVERS = join(ROOT, "brand/design/covers");
// PICTURE_PLACEHOLDER, read from its line in packages/core (whose TypeScript Node can't load on its own).
const PICTURE_PLACEHOLDER = (() => {
  const line = /export const PICTURE_PLACEHOLDER = (\{[^}]*\})/.exec(readFileSync(join(ROOT, "packages/core/src/developers.ts"), "utf8"))?.[1];
  if (!line) throw new Error("No PICTURE_PLACEHOLDER in packages/core/src/developers.ts");
  return JSON.parse(line.replace(/(\w+):/g, '"$1":'));
})();

const chrome = await openChrome(await chromeToRun(), "zaisma-placeholders-");
try {
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const entries = [];
  for (const file of readdirSync(COVERS).filter((name) => name.endsWith(".webp")).sort()) {
    const base64 = readFileSync(join(COVERS, file)).toString("base64");
    const { result } = await chrome.send(
      "Runtime.evaluate",
      {
        expression: `(async () => { const image = new Image(); image.src = "data:image/webp;base64,${base64}"; await image.decode();
          const canvas = document.createElement("canvas"); canvas.width = ${PICTURE_PLACEHOLDER.widthPx}; canvas.height = Math.max(1, Math.round(image.naturalHeight * ${PICTURE_PLACEHOLDER.widthPx} / image.naturalWidth));
          const context = canvas.getContext("2d"); context.imageSmoothingQuality = "high"; context.drawImage(image, 0, 0, canvas.width, canvas.height);
          return JSON.stringify({ widthPx: image.naturalWidth, heightPx: image.naturalHeight, placeholderDataUrl: canvas.toDataURL("${PICTURE_PLACEHOLDER.format}", ${PICTURE_PLACEHOLDER.quality / 100}) }); })()`,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
    );
    const made = JSON.parse(result.value);
    if (made.placeholderDataUrl.length > PICTURE_PLACEHOLDER.maximumLength) throw new Error(`${file}'s placeholder is ${made.placeholderDataUrl.length} characters, over ${PICTURE_PLACEHOLDER.maximumLength}`);
    entries.push(`  ${JSON.stringify(file.replace(/\.webp$/, ""))}: { imageUrl: ${JSON.stringify(`/design/covers/${file}`)}, widthPx: ${made.widthPx}, heightPx: ${made.heightPx}, placeholderDataUrl: ${JSON.stringify(made.placeholderDataUrl)} },`);
    console.log(`${file}: placeholder ${made.placeholderDataUrl.length} characters`);
  }
  writeFileSync(
    join(ROOT, "apps/site/src/generated/stand-in-placeholders.generated.ts"),
    `// Made by scripts/stand-in-placeholders.mjs from brand/design/covers: never edit it by hand.\nimport type { ShownPicture } from "../components/foundations.ts";\n\nexport const STAND_IN_COVER_PICTURES: Record<string, ShownPicture> = {\n${entries.join("\n")}\n};\n`,
  );
} finally {
  await chrome.close();
}
