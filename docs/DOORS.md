# Doors

A door is any way into Zaisma: an API call, MCP tool, page, page form, game-file address, rooms address, room message, stored value or admin tool. Every door states who may call it, what it may reach and what it trusts from other doors, and goes through one check before any of its own code runs. A door with no contract fails the build.

## The contract

`packages/game-server/src/doors.ts` holds the shape and the check, in the game server package's internal part, so a room on a developer's own server goes through it too.

- **`whoMayCall`:** `anyone`, `signed_in`, `developer`, `admin`, `room_member`, `room_player` or `room_host`, which the door's guard proves, or `api_caller`, `link_holder`, `token_holder`, `signed_sender`, `game_page` or `pass_holder`, which a named function proves.
- **`reaches`:** what the door may touch: `account`, `player_save`, `game`, `webhook`, `sign_in_app` and `forum_topic` are the caller's own or what the caller may read, `nothing_private` is what anyone may see, `room` and `purchase` are what they say, and `any_game`, `any_account` and `zaisma_settings` are only ever Zaisma's own people's.
- **`trusts`:** what it takes from other doors, in the security map's words: `session`, `api_key`, `player_pass`, `tester_link` and so on.
- **`provenBy`:** the function that proves a caller the guard can't, because the proof takes the door's own data. A caller of that kind can't be stated without it, and a test fails on a function that no longer exists.

## Where each kind lives

| Door | Table | What fails with no contract |
|---|---|---|
| Page, page form | `SITE_DOORS`, `apps/site/src/doors.ts` | The guard answers a path with no row as nothing there; `test/node/doors.test.ts` fails on a path a handler names |
| API call | `API_ROUTES`, `apps/site/src/developer.ts` | The declaration doesn't type-check |
| MCP tool | The API calls it makes | `test/node/doors.test.ts` fails on a tool that makes none |
| Admin tool | `ADMIN_TOOLS`, `apps/site/src/admin-mcp.ts` | `reaches` is required by type |
| Game-file address | `GAME_FILE_DOORS`, `apps/games/src/doors.ts` | `test/node/doors.test.ts` fails on an `_zaisma/` address in the Worker's code |
| Rooms address | `ROOM_ADDRESS_DOORS`, `apps/rooms/src/doors.ts` | The Worker answers an address with no row as nothing there |
| Room message | `ROOM_MESSAGE_DOORS`, `packages/game-server/src/room.ts` | `receive`'s switch is over its names, so a new case doesn't type-check |
| Stored value | `STORED_VALUES`, `apps/site/src/stored-values.ts` | `test/node/stored-values.test.ts` and `test/node/doors.test.ts` |

`apps/compress` and `apps/photodna` have no public address, so they have no doors; a test holds them to that. The files in `brand/` are served by Cloudflare before the site's Worker runs, the same for everyone, so they have no row.

## The site's guard

`guardSiteDoor`, `apps/site/src/guard.ts`, runs first in the site's `route`. In order, for the row at the request's path and method:

1. No row at the path: nothing there (404). A row at the path but not for the method: 405. `GET` takes `HEAD` too.
2. The request's `Origin`, as the row's `origin` says: `own_pages`, `own_pages_if_sent` or `anywhere`.
3. Who: `admin` runs Cloudflare Access; `signed_in` and `developer` read the session and answer the row's `whenSignedOut` without one; `developer` also needs a finished account and no developer ban, unless the row says `isOpenToBannedDeveloper`. A `signed_in` row with `isClosedToBannedDeveloper` turns a banned developer away too.

A door needing no session reads none, so a guest's page costs the same. A door's own code asks `currentSession` for the same session the guard read: it's kept per request. A door's own code keeps what only it can decide, and its own session read stays as the backstop.

## Adding a door

Add its row to the table for its kind, then its code. For a page: the path with `:parts` (their shapes in `PATH_PARTS`), the methods, the contract through the helpers, the origin it takes and what it answers without a session. `test/site/door-guard.test.ts` tries each row of `SITE_DOORS` from its declarations, so the new row is tested by being written. The security map reads these same tables (`scripts/security-map/doors.mjs`).
