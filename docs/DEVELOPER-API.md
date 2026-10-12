# Developer API

One API behind the developer MCP, the upload command and the dashboard, so they always agree. Base: `https://zaisma.com/api/dev`. Every answer is JSON; errors look like `{"error": {"code": "slug_taken", "message": "…"}}`.

## Signing in

Make an API key on your account page (zaisma.com/account, under Game developers) and send it as `Authorization: Bearer zsk_…`. The key is shown once; we keep only a hash. Any account can make up to 10 keys and remove them at any time. Pages on zaisma.com can use the signed-in session instead. Up to 120 requests a minute per account.

## Games

| Call | What it does |
| --- | --- |
| `GET /games` | Your games. |
| `POST /games` | Make a game: `{"title", "slug"?, "description"?, "devices"?, "controls"?, "screen"?}`. It starts as a draft that only you can see. Up to 50 games. |
| `GET /games/:slug` | One game with its images and versions. |
| `PATCH /games/:slug` | Change any of `title`, `description`, `visibility`, `devices`, `controls`, `screen`. |

- **visibility:** `draft`, `listed` (home page and search), `unlisted` (anyone with the link, never in lists or search engines) or `private`. Draft and private games open only through preview and tester links (coming next).
- **review** is ours and separate: `pending` (no version has passed review yet), `live`, `held` or `removed`. Changing visibility never undoes a takedown.
- **devices:** any of `phone`, `tablet`, `computer`. **controls:** any of `touch`, `keyboard-mouse`, `gamepad`. **screen:** `portrait`, `landscape`, `either` or `""`.
- Once players can see a game, a new title or description waits for review (`waiting_for_review`) before it shows.

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
