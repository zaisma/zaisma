import type { World } from "../site/access-world.ts";

/**
 * What an MCP tool takes that its API call's sample (test/site/access-world.ts) doesn't say by the same name, for
 * test/grid/mcp.grid.ts. The rest of a tool's arguments come from that sample by name.
 */
/** A PNG's first bytes, 1280 by 720: all the image checks read. */
const coverBase64 = () => {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, 1280);
  new DataView(bytes.buffer).setUint32(20, 720);
  return btoa(String.fromCharCode(...bytes));
};

export const TOOL_ARGUMENTS: Readonly<Record<string, (world: World) => Record<string, unknown>>> = {
  add_image: () => ({ kind: "cover", image_base64: coverBase64() }),
  upload_files: () => ({ files: [{ path: "index.html", content_text: "<!doctype html><p>hi</p>" }] }),
  check_game: () => ({ files: [{ path: "index.html", content_text: "<!doctype html><p>hi</p>" }] }),
  set_background: () => ({ image_id: undefined }),
  post_topic: () => ({ category: "servers" }),
  rate_post: () => ({ rating: "like" }),
  get_stats: () => ({ period_duration_days: 7 }),
  get_save: () => ({ keys: ["coins"] }),
  list_rooms: () => ({ labels: [{ label_name: "Region", label_value: "North" }] }),
};
