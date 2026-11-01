import { describe, expect, it } from "vitest";
import { PICTURE_PLACEHOLDER } from "@zaisma/core";
import { fillMissingPlaceholders, keepImagePlaceholder, placeholderDataUrl, shownPictureOf } from "../../apps/site/src/placeholders.ts";
import type { Env } from "../../apps/site/src/env.ts";

/** A stand-in Images binding that answers bytesLong bytes for any picture, and records the transforms it was asked for. */
function imagesAnswering(bytesLong: number) {
  const asked: unknown[] = [];
  const binding = {
    input: () => ({
      transform: (options: unknown) => {
        asked.push(options);
        return { output: (output: unknown) => { asked.push(output); return Promise.resolve({ image: () => new Response(new Uint8Array(bytesLong).fill(7)).body }); } };
      },
    }),
  };
  return { binding, asked };
}

/** A stand-in database that records each statement it's asked to run, answering rows for SELECTs. */
function databaseAnswering(rows: unknown[]) {
  const ran: { sql: string; values: unknown[] }[] = [];
  const statement = (sql: string) => ({
    bind: (...values: unknown[]) => ({
      run: async () => { ran.push({ sql, values }); return {}; },
      all: async () => { ran.push({ sql, values }); return { results: sql.includes("game_images") ? rows : [] }; },
    }),
  });
  return { database: { prepare: statement }, ran };
}

const bucket = { get: async () => ({ body: new Response("picture").body, arrayBuffer: async () => new ArrayBuffer(8) }) };

describe("placeholders", () => {
  it("are the picture PICTURE_PLACEHOLDER.widthPx wide as a WebP data: URL, at its quality", async () => {
    const { binding, asked } = imagesAnswering(300);
    const dataUrl = await placeholderDataUrl({ IMAGES: binding } as unknown as Env, new ArrayBuffer(8));
    expect(dataUrl).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/);
    expect(dataUrl!.length).toBeLessThanOrEqual(PICTURE_PLACEHOLDER.maximumLength);
    expect(asked).toEqual([{ width: PICTURE_PLACEHOLDER.widthPx, fit: "scale-down" }, { format: "image/webp", quality: PICTURE_PLACEHOLDER.quality }]);
  });

  it("are null without the Images binding, and when one comes out too long to send in a page", async () => {
    expect(await placeholderDataUrl({} as Env, new ArrayBuffer(8))).toBeNull();
    expect(await placeholderDataUrl({ IMAGES: imagesAnswering(PICTURE_PLACEHOLDER.maximumLength).binding } as unknown as Env, new ArrayBuffer(8))).toBeNull();
  });

  it("are kept on an approved picture's row once, and never made for a shader's texture", async () => {
    const { database, ran } = databaseAnswering([]);
    const env = { IMAGES: imagesAnswering(300).binding, DB: database, GAMES: bucket } as unknown as Env;
    await keepImagePlaceholder(env, { id: "image_a", game_id: "game_a", kind: "cover", placeholder_data_url: null });
    await keepImagePlaceholder(env, { id: "image_b", game_id: "game_a", kind: "shader_texture", placeholder_data_url: null });
    await keepImagePlaceholder(env, { id: "image_c", game_id: "game_a", kind: "cover", placeholder_data_url: "data:image/webp;base64,AA==" });
    expect(ran.map((each) => each.values[1])).toEqual(["image_a"]);
    expect(ran[0]!.sql).toContain("placeholder_data_url IS NULL");
  });

  it("are made by the daily job for approved pictures without one, a run at most, and never when a page shows a picture", async () => {
    const rows = [{ id: "image_a", game_id: "game_a", kind: "cover", placeholder_data_url: null }];
    const { database, ran } = databaseAnswering(rows);
    await fillMissingPlaceholders({ IMAGES: imagesAnswering(300).binding, DB: database, GAMES: bucket } as unknown as Env);
    expect(ran.filter((each) => each.sql.startsWith("SELECT")).every((each) => each.sql.includes("review_status = 'approved'") && each.sql.includes("LIMIT ?"))).toBe(true);
    expect(ran.filter((each) => each.sql.startsWith("UPDATE")).map((each) => each.values[1])).toEqual(["image_a"]);
    expect(shownPictureOf({ id: "image_a", width_px: 1920, height_px: 1080, placeholder_data_url: null })).toEqual({ imageUrl: "/img/image_a", widthPx: 1920, heightPx: 1080, placeholderDataUrl: null });
  });
});
