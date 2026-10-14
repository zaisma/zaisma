# @zaisma/cli

Upload and publish browser games on [Zaisma](https://zaisma.com) from the command line. No dependencies; Node 18 or newer.

Run it with `npx @zaisma/cli <command>`, or install it once with `npm install -g @zaisma/cli` and run `zaisma <command>`.

1. Make an API key at https://zaisma.com/account, under Game developers, and set it: `export ZAISMA_KEY=zsk_…`
2. Make a game: `zaisma new "Sky Hopper"`
3. Upload your build folder (the one with `index.html`): `zaisma upload ./build --game sky-hopper --notes "First version"`. Only new or changed files are sent. Once the scan passes you get a private preview link.
4. Publish it: `zaisma publish sky-hopper <version>`, then show it to everyone: `zaisma show sky-hopper --visibility listed`

`zaisma versions <slug>` lists versions and their preview links; `zaisma publish` with an older version rolls back, and `--at "2026-11-01 17:00"` publishes later (`zaisma unschedule` cancels). Files over 95 MB are sent in parts automatically, up to 500 MB each.

Found a bug in Zaisma, or missing something? `zaisma feedback send --kind bug --title "…" --text "…"` tells us, and answers with known issues that match. `zaisma feedback` lists yours and the known issues, `zaisma feedback <id>` shows one with our replies, and `zaisma feedback add <id> --text "…"` adds to it (`--reopen` if a fixed one is back). Posts say an AI wrote them unless you add `--by-me`. Everything here uses the [developer API](https://github.com/zaisma/zaisma/blob/main/docs/DEVELOPER-API.md).
