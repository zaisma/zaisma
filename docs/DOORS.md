# Doors

A door is any way into Zaisma: an API call, MCP tool, page, page form, game-file address, rooms address, room message, stored value or admin tool. Every door states who may call it, what it may reach, what it trusts from other doors, what it takes, what it answers and how much it can be used, and goes through one check before any of its own code runs. A door with no contract fails the build.

## The contract

`packages/game-server/src/doors.ts` holds the shape and the check, in the game server package's internal part, so a room on a developer's own server goes through it too.

- **`whoMayCall`:** `anyone`, `signed_in`, `developer`, `admin`, `room_member`, `room_player` or `room_host`, which the door's guard proves, or `api_caller`, `link_holder`, `token_holder`, `signed_sender`, `game_page` or `pass_holder`, which a named function proves.
- **`reaches`:** what the door may touch: `account`, `player_save`, `game`, `webhook`, `sign_in_app` and `forum_topic` are the caller's own or what the caller may read, `nothing_private` is what anyone may see, `room` and `purchase` are what they say, and `any_game`, `any_account` and `zaisma_settings` are only ever Zaisma's own people's.
- **`trusts`:** what it takes from other doors, in the security map's words: `session`, `api_key`, `player_pass`, `tester_link` and so on.
- **`provenBy`:** the function that proves a caller the guard can't, because the proof takes the door's own data. A caller of that kind can't be stated without it, and a test fails on a function that no longer exists.
- **`takes`:** its query's names and its body, each with a type and a bound. Only the helpers make a shape (`text`, `integer`, `realNumber`, `yesOrNo`, `listOf`, `fieldsOf`, `anyOf`, `orNothing`), and each takes its bound, so "accepts anything" can't be written. A game's own data (`gameData`: saves, room messages, database rows) goes by size alone, at the caps it has. A shape is the outer wall: what a door allows inside it stays the door's to say, with its own fix.
- **`answers`:** a JSON schema, or `page`, `empty`, `redirect`, `file` or `bytes`. On live requests a JSON answer goes out with only what its door declares: a field it didn't declare is cut, the caller still gets the answer, and Zaisma's people hear once a door a day (`list_security_spikes`). Only a door's own answers are cut, and only when they succeed. Room messages are checked in tests only: they're the busiest path there is.
- **`limit`:** `{ level, counts, group? }` or `{ whyNoLimit }`. The levels are calls a minute, one binding each: `very_rare` 2, `guess` 5, `rare` 10, `steady` 30, `busy` 120, `building` 1000. It counts the `player`, `account` or `game` wherever Zaisma knows one, and the `address` only before it does, and only at `building`, the level a whole building clears, so a limit can't be aimed at someone else and 25 players on one school's wifi play like anyone. `whyNoLimit` comes from a fixed list (`DOOR_NO_LIMIT_REASONS`), and the daily review reads each door that gives one. A door's own code can keep something tighter for what costs a person's or an AI's time, like wrong passwords or reports.

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
4. Its limit: an address's before anything else is read, an account's once its session is. Past it: 429.
5. Its shape: the query's values, the body's size from `content-length` before reading any of it, then its fields. A page ignores query names it doesn't declare, since share links pick some up; a form's or a JSON body's unknown names are refused. OAuth's own doors, by their RFCs, drop what they don't know, and go by size alone. A room's messages leave unknown names alone too, unread: a game's SDK comes from Zaisma and its server may be an older one of the developer's own.

The API's router (`checkCall`) does the same for each call, from `API_INPUT_SHAPES`, one shape per input's name, and answers `wrong_shape`. An MCP tool checks the types of its arguments against its `inputSchema`, and the API call behind it holds the rest. The rooms Worker's `guardRoomDoor` and the game domain's `serve` do the same for their rows.

## The contract test grid

Every door is tried by every kind of caller on every pull request, with no AI: the owner, another account, a stranger with no credential, the owner banned in each scope, the owner's key with less access, and the owner's key for another game. What each should get comes from the door's own contract (`test/grid/cells.ts`): a door that must refuse must refuse, and nobody but the owner may change or see the owner's things. Each caller sends what the owner sends, and the owner's own call must go through, so a refusal can only be the door's.

| Doors | Tried in |
|---|---|
| Pages and forms | `test/grid/pages.grid.ts`, with `test/grid/samples.ts` |
| API calls | `test/grid/api.grid.ts` |
| MCP tools and admin tools | `test/grid/mcp.grid.ts`, with `test/grid/tool-samples.ts` |
| Rooms addresses and `hello` | `test/grid/rooms.grid.ts` |
| Room messages | `test/grid/room-messages.grid.ts` |
| Game-file addresses | `test/grid/game-files.grid.ts` |

A stored value has no caller of its own: it's tried through the doors that save and show it, by `test/site/stored-values.test.ts`.

```
npm run grid
```

runs it and prints every failure. GitHub's check runs `npm run grid -- --compare <the commit a change left>`: anyone can read a check's log, so it prints and fails only on what the change adds. A change to the grid itself gets a count, and a local run says the rest. A failure already on main is a security item, kept privately until it's fixed; a fix needs no change here, since main stops failing that cell.

The grid also sends each door a request of the wrong shape, and calls it with its limit's binding refusing everything, as the `wrong_shape` and `past_limit` cells; a door that doesn't refuse fails.

## Adding a door

Add its row to the table for its kind, then its code. For a page: the path with `:parts` (their shapes in `PATH_PARTS`), the methods, the contract through the helpers, what it takes, answers and how much it can be used, the origin it takes and what it answers without a session. `test/site/door-guard.test.ts` tries each row of `SITE_DOORS` from its declarations, so the new row is tested by being written. A page or form that writes also needs a sample in `PAGE_SAMPLES` (`test/grid/samples.ts`), or a line in `OWNER_NOT_PROVEN` saying where the owner's call is tried, or `test/node/contract-grid.test.ts` fails; a new API call's is its `SAMPLES` entry. The security map reads these same tables (`scripts/security-map/doors.mjs`).
