// The rooms Worker's game databases and secrets, as the site's tests reach them through the GAME_DATABASES
// and GAME_SECRETS service bindings (vitest.config.ts bundles this as a second Worker named zaisma-rooms):
// the real code, without the rest of rooms.
export { GameDatabaseObject, GameDatabaseService } from "../../apps/rooms/src/database.ts";
export { GameSecretsObject, GameSecretsService } from "../../apps/rooms/src/secrets.ts";

export default {
  fetch: () => new Response("Only the game databases and secrets are here.", { status: 404 }),
};
