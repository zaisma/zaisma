// The rooms Worker's game databases, as the site's tests reach them through the GAME_DATABASES service
// binding (vitest.config.ts bundles this as a second Worker named zaisma-rooms): the real database code,
// without the rest of rooms.
export { GameDatabaseObject, GameDatabaseService } from "../../apps/rooms/src/database.ts";

export default {
  fetch: () => new Response("Only the game databases are here.", { status: 404 }),
};
