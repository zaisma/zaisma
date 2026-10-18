import { zipSync, strToU8 } from "fflate";

/** Build a zip in memory from { path: contents }. */
export function makeZip(files: Record<string, string | Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, body] of Object.entries(files)) entries[path] = typeof body === "string" ? strToU8(body) : body;
  return zipSync(entries);
}

export const CLEAN_GAME = {
  "index.html": '<!doctype html><title>Test</title><canvas></canvas><script src="game.js"></script>',
  "game.js": "const c = document.querySelector('canvas'); let score = 0; requestAnimationFrame(function loop(){ score++; requestAnimationFrame(loop); });",
  "assets/data.json": '{"levels":[1,2,3]}',
};

/** Let an account make, upload and publish games, as Julius does on /admin/publishing until the beta. */
export async function letPublish(database: D1Database, accountId: string): Promise<void> {
  await database.prepare("UPDATE accounts SET can_publish = 1 WHERE id = ?").bind(accountId).run();
}
