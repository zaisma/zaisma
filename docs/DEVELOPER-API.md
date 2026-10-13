# Developer API

One API behind the developer MCP, the upload command (`packages/cli`) and the dashboard (zaisma.com/dashboard, `apps/site/src/dashboard.ts`), so they always agree. Base: `https://zaisma.com/api/dev`. Every answer is JSON; errors look like `{"error": {"code": "slug_taken", "message": "…"}}`.

## The MCP

Any AI tool that supports remote MCP servers can manage your games at `https://zaisma.com/mcp`, signed in with the same API key. In Claude Code:

```bash
claude mcp add --transport http zaisma https://zaisma.com/mcp --header "Authorization: Bearer $ZAISMA_KEY"
```

Every tool is a call to this API (`apps/site/src/mcp.ts`): `list_games`, `create_game`, `get_game`, `update_game`, `upload_files` (small games up to 5 MB, sent as file contents), `get_version`, `publish_version` (also rolls back and publishes later), `cancel_scheduled_publish`, `add_image`, `remove_image`, `add_tester_link`, `remove_tester_link`, `get_reports`, `get_stats` and `get_history`. Bigger builds go through the upload command. Making a game players can play private or a draft again needs `"confirm": true`, so the AI asks you first.

## Signing in

Make an API key on your account page (zaisma.com/account, under Game developers) and send it as `Authorization: Bearer zsk_…`. The key is shown once; we keep only a hash. Any account can make up to 10 keys and remove them at any time. Pages on zaisma.com can use the signed-in session instead. Up to 120 requests a minute per account, plus up to 1,000 a minute for sending files.

## Games

| Call | What it does |
| --- | --- |
| `GET /games` | Your games. |
| `POST /games` | Make a game: `{"title", "slug"?, "description"?, "devices"?, "controls"?, "screen"?}`. It starts as a draft that only you can see. Up to 50 games. |
| `GET /games/:slug` | One game with its images, versions and tester links. |
| `PATCH /games/:slug` | Change any of `title`, `description`, `visibility`, `devices`, `controls`, `screen`, `players`, `cloud_saves`, `room_browsing`, `multiplayer`. |

- **visibility:** `draft`, `listed` (home page and search), `unlisted` (anyone with the link, never in lists or search engines) or `private`. Draft and private games open only through preview links and tester links (below).
- **review** is ours and separate: `pending` (no version has passed review yet), `live`, `held` or `removed`. Changing visibility never undoes a takedown.
- **players:** how it's played, shown on the game page with icons: `{"single": true, "local": {"min": 2, "max": 4, "style": "co-op"}, "online": {"min": 2, "max": null, "style": "versus"}}`. `local` is together on one device or screen, `online` is each on their own device; either can be `null`. `style` is `co-op`, `versus` or `both`; `max: null` means no limit ("2+ players"). `null` clears it.
- **devices:** any of `phone`, `tablet`, `computer`. **controls:** any of `touch`, `keyboard-mouse`, `gamepad`. **screen:** `portrait`, `landscape`, `either` or `""`.
- **cloud_saves:** `true` (the default) copies signed-in players' browser saves to their account, so their progress follows them to any device with no code in the game. It covers localStorage and IndexedDB (Unity, Godot and localForage saves included; databases with "cache" in the name, like Unity's download cache, are skipped), up to 5 MB per player. Set `false` for games that keep their own saves on a server.
- **multiplayer:** `none`, `relay` (Zaisma passes each message to the others, no server code) or `own`: your game server, from the live version's `zaisma-server/` folder (`index.js` first, importing the folder's other `.js`, `.json` and `.wasm` files) or one `zaisma-server.js`, runs on Zaisma rooms in a sandbox with no internet (see "Your game server on Zaisma" in the README). If the live version has no game server, or one over 500 files or 5 MB, the change is saved with a `note` saying why, and rooms open once a version that works is published. Games already on a game server built into Zaisma show `built-in` and can't change it themselves. Rooms on the old setting end within a minute.
- **room_browsing:** for games on Zaisma rooms (`zaisma_rooms: true`), where open rooms are listed so players can join them: `page` (the default) on the game page and to the game through `Zaisma.rooms.list()`, `game` only to the game (for games with their own lobby or server browser), or `off`. Room codes and invite links work either way, and the game can hide single rooms itself (see Multiplayer in the README). Whatever the setting, the game page says how many are playing now once it's 3 or more (no names). Rooms on your own servers aren't listed or counted.
- Once players can see a game, a new title or description waits for review (`waiting_for_review`) before it shows.

| Call | What it does |
| --- | --- |
| `GET /games/:slug/reports?since=` | Player reports from the last 90 days, counted by reason (`open` or `closed`), and the bug reports: reports that report triage sorted as bugs, each with what the player wrote, a one-line summary and the version they played. Pass the `next_since` from your last call as `since` to get only the bug reports that arrived after it. Child-safety reports are never counted or shown. |
| `GET /games/:slug/stats?days=30` | How the game is played, up to 90 days (see Play stats below), and multiplayer use per day: rooms, player minutes and messages. For games running their own game server on our rooms, also per day `game_server`: calls, crashes (a handler threw; that call is lost), stopped (ran on too long, like an endless loop; the match froze about 2 seconds) and matches_ended (stopped twice), plus `game_server_errors`: the 20 most recent distinct errors with the file and line they came from, how often and when. |
| `GET /games/:slug/history` | What happened to the game, newest first, and whether you or Zaisma did it. |

### Play stats

`plays` in the stats answer, counted by the game page with no code in the game:

- **days:** per day (UTC), `plays` (presses of Play, and room links that start the game), `players` (browsers that played that day), `new_players` (browsers playing it for the first time) and `minutes_played` (time the game was on screen).
- **plays**, **new_players** and **minutes_played** over the period, and **minutes_per_play**.
- **came_back:** `after_1_day`, `after_7_days` and `after_30_days`, each `{"percent", "players", "of"}`: of the new players in the 30 days before, how many played again that many days after their first play. Only days that are over count, so `percent` is `null` until there are some.

A player is a browser: one person on two devices counts twice, and clearing the browser makes them new. Plays through tester and preview links aren't counted. We keep only these counts: nothing that says who played.

## Tester links

Secret links that open the game's live version for anyone who has them, whatever its visibility, so a private or draft game can be played before it's public. Testers need no account. Make one per group (your team, playtesters, a streamer) and name it for them, so you can turn one off without the others.

| Call | What it does |
| --- | --- |
| `GET /games/:slug/testers` | The links that are on: `{"id", "name", "url", "created_at", "opened_at"}`. `opened_at` is when someone last opened it (to the hour), or `null`. |
| `POST /games/:slug/testers` | Make one: `{"name"}`, 1 to 60 characters. Up to 50 per game. |
| `DELETE /games/:slug/testers/:id` | Turn one off for good. It stops opening the game straight away, and players who came through it are let go from their multiplayer matches within about 10 seconds. A game already open in their browser keeps running until they leave or reload. Make a new one to let that group back in. |

- A link looks like `https://zaisma.com/t/<secret>`: the game page with the game, marked as a test and kept out of search engines. The game itself runs at `https://<slug>--<secret>.zaismausercontent.com/`.
- Multiplayer works through it: room invites and `Zaisma.rooms.list()` links point back to the tester link, not the public page. The game page's room list isn't shown on tester links.
- Testers' progress stays in their browser (no cloud saves), and the game stays off their Continue playing.
- With no published version yet, the link says there's nothing to play. A held or taken-down game is closed to testers too.

## Covers and screenshots

| Call | What it does |
| --- | --- |
| `POST /games/:slug/images?kind=cover` or `?kind=screenshot` | Send the image file as the request body. |
| `DELETE /games/:slug/images/:id` | Remove one. |

PNG, JPEG or WebP, checked from the file itself; SVG and other types are refused. Up to 5 MB, 320 to 8,192 px on each side, one cover and up to 8 screenshots. Each image is `pending` until it's reviewed, then shows at `https://zaisma.com/img/:id`; a newly approved cover replaces the old one. Until then only you can see it.

```bash
curl -X POST "https://zaisma.com/api/dev/games/sky-hopper/images?kind=cover" \
  -H "Authorization: Bearer $ZAISMA_KEY" --data-binary @cover.png
```

## Uploading versions

The `zaisma` command ([`@zaisma/cli` on npm](https://www.npmjs.com/package/@zaisma/cli), source in `packages/cli`) does all of this for you: `npx @zaisma/cli upload ./build --game sky-hopper`.

Files are stored once, by their SHA-256, and shared by every version that has them, so an update only sends what changed.

| Call | What it does |
| --- | --- |
| `POST /games/:slug/uploads` | Send the file list, `{"files": [{"path", "sha256", "bytes"}]}`. Answers with the hashes we don't have yet (`missing`). |
| `PUT /files/:sha256` | Send one missing file as the request body. Storage checks the hash; programs and archives are refused. |
| `POST /games/:slug/versions` | Make the version from the same list, plus `notes` (patch notes, up to 2,000 characters) and optionally `"publish": "when-approved"`. |
| `GET /games/:slug/versions/:id` | `scan` (`scanning`, `held`, `approved` or `rejected`), what the scan found, and `preview_url` once it passes. |
| `POST /games/:slug/versions/:id/publish` | Publish a draft that passed, or roll back to an older version. With `{"at": "2026-11-01T17:00:00Z"}` it publishes later instead (a few minutes to 90 days ahead; checked every 5 minutes). A version still being scanned goes live at that time if it has passed by then. |
| `DELETE /games/:slug/versions/:id/publish` | Cancel a publish-later. |

- Same rules as zips: `index.html` at the top, no hidden files, no pre-compressed `.gz` or `.br` files, only the file types games use. Up to 20,000 files, 2 GB per game and 500 MB per file. Up to 20 versions per game a day.
- Each version is scanned. One that passes waits as a draft with a private preview link (`https://<slug>--<secret>.zaismausercontent.com/`) that works even while the game is a draft or private. Preview saves stay in that link's own browser storage.
- Publishing makes it the version players get. We keep the live version plus the last 5 that passed, for rolling back.
- Drafts nobody publishes are deleted after 30 days, and files no version uses after a day. Held and rejected versions are kept.
- Publishing doesn't change visibility: a draft game stays hidden until you set it to `listed` or `unlisted`.

### Big files

Files over 95 MB are sent in parts, 50 MB each (the last can be smaller):

1. `POST /files/:sha256/parts` with `{"bytes"}` answers `{"upload", "part_bytes", "parts"}`.
2. `PUT /files/:sha256/parts/:n?upload=…` for each part, numbered from 1. Each answers `{"part", "etag"}`.
3. `POST /files/:sha256/parts/done` with `{"upload", "parts": [{"part", "etag"}]}`.

Storage can't check the hash of a file sent in parts, so it's kept for your own games only: another developer with the same file sends their own copy. The scan reads it like any other file.
