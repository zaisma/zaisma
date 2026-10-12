# Developer API

One API behind the developer MCP, the upload command (`packages/cli`) and the dashboard (zaisma.com/dashboard, `apps/site/src/dashboard.ts`), so they always agree. Base: `https://zaisma.com/api/dev`. Every answer is JSON; errors look like `{"error": {"code": "slug_taken", "message": "…"}}`.

## The MCP

Any AI tool that supports remote MCP servers can manage your games at `https://zaisma.com/mcp`, signed in with the same API key. In Claude Code:

```bash
claude mcp add --transport http zaisma https://zaisma.com/mcp --header "Authorization: Bearer $ZAISMA_KEY"
```

Every tool is a call to this API (`apps/site/src/mcp.ts`): `list_games`, `create_game`, `get_game`, `update_game`, `upload_files` (small games up to 5 MB, sent as file contents), `get_version`, `publish_version` (also rolls back and publishes later), `cancel_scheduled_publish`, `add_image`, `remove_image`, `get_reports`, `get_stats` and `get_history`. Bigger builds go through the upload command. Making a game players can play private or a draft again needs `"confirm": true`, so the AI asks you first.

## Signing in

Make an API key on your account page (zaisma.com/account, under Game developers) and send it as `Authorization: Bearer zsk_…`. The key is shown once; we keep only a hash. Any account can make up to 10 keys and remove them at any time. Pages on zaisma.com can use the signed-in session instead. Up to 120 requests a minute per account, plus up to 1,000 a minute for sending files.

## Games

| Call | What it does |
| --- | --- |
| `GET /games` | Your games. |
| `POST /games` | Make a game: `{"title", "slug"?, "description"?, "devices"?, "controls"?, "screen"?}`. It starts as a draft that only you can see. Up to 50 games. |
| `GET /games/:slug` | One game with its images and versions. |
| `PATCH /games/:slug` | Change any of `title`, `description`, `visibility`, `devices`, `controls`, `screen`, `players`, `cloud_saves`. |

- **visibility:** `draft`, `listed` (home page and search), `unlisted` (anyone with the link, never in lists or search engines) or `private`. Draft and private games open only through preview and tester links (coming next).
- **review** is ours and separate: `pending` (no version has passed review yet), `live`, `held` or `removed`. Changing visibility never undoes a takedown.
- **players:** how it's played, shown on the game page with icons: `{"single": true, "local": {"min": 2, "max": 4, "style": "co-op"}, "online": {"min": 2, "max": null, "style": "versus"}}`. `local` is together on one device or screen, `online` is each on their own device; either can be `null`. `style` is `co-op`, `versus` or `both`; `max: null` means no limit ("2+ players"). `null` clears it.
- **devices:** any of `phone`, `tablet`, `computer`. **controls:** any of `touch`, `keyboard-mouse`, `gamepad`. **screen:** `portrait`, `landscape`, `either` or `""`.
- **cloud_saves:** `true` (the default) copies signed-in players' browser saves to their account, so their progress follows them to any device with no code in the game. It covers localStorage and IndexedDB (Unity, Godot and localForage saves included; databases with "cache" in the name, like Unity's download cache, are skipped), up to 5 MB per player. Set `false` for games that keep their own saves on a server.
- Once players can see a game, a new title or description waits for review (`waiting_for_review`) before it shows.

| Call | What it does |
| --- | --- |
| `GET /games/:slug/reports?since=` | Player reports from the last 90 days, counted by reason (`open` or `closed`), and the bug reports: reports that report triage sorted as bugs, each with what the player wrote, a one-line summary and the version they played. Pass the `next_since` from your last call as `since` to get only the bug reports that arrived after it. Child-safety reports are never counted or shown. |
| `GET /games/:slug/stats?days=30` | Multiplayer use per day: rooms, player minutes and messages. Plays and players coming back arrive with the Zaisma SDK. |
| `GET /games/:slug/history` | What happened to the game, newest first, and whether you or Zaisma did it. |

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
