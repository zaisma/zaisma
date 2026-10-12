# zaisma

Upload and publish browser games on [Zaisma](https://zaisma.com) from the command line. No dependencies; Node 18 or newer.

1. Make an API key at https://zaisma.com/account, under Game developers, and set it: `export ZAISMA_KEY=zsk_…`
2. Make a game: `zaisma new "Sky Hopper"`
3. Upload your build folder (the one with `index.html`): `zaisma upload ./build --game sky-hopper --notes "First version"`. Only new or changed files are sent. Once the scan passes you get a private preview link.
4. Publish it: `zaisma publish sky-hopper <version>`, then show it to everyone: `zaisma show sky-hopper --visibility listed`

`zaisma versions <slug>` lists versions and their preview links; `zaisma publish` with an older version rolls back. Everything here uses the [developer API](../../docs/DEVELOPER-API.md).
