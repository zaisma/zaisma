# Honest clients make it smooth; the server keeps the backstop

The principle "Honest clients make it smooth; the server keeps the backstop" in [`DECISIONS.md`](../DECISIONS.md). This file is its casebook: what it means, how to test a feature against it, and the real calls made under it. Every case is a real Zaisma call. When a talk settles a new one, it's added here in the same change.

## The rule

**A client (the SDK, a game page, the upload command) may do extra work so honest players get an instant, smooth experience. Safety, fairness and money never depend on it: the server always keeps its own check, even a slower one.**

## Why it exists

Anything a good client does, a modified one can skip or fake. If the only check is in the browser, the first person who opens the developer tools wins. But making everything wait for the server makes the honest majority pay for the few. So both exist: the fast path for honest clients, and the backstop that catches everyone else (Oct 14, 2026).

## The test

1. **If a modified client skipped this or lied about it, what breaks?** If the answer is safety, fairness or money, the server needs its own check.
2. **Is the server's check there even when the client behaves?** A backstop that only runs when the client reports trouble isn't a backstop.
3. **Does the honest player wait for the backstop?** They shouldn't, when it can run behind them. Design the fast path first, then the slower check.

## Cases

### Passes

- **Leaving a room:** the SDK says goodbye the moment a player leaves; the server's ping timeout catches the clients that never do.
- **Counted plays:** the play counts only after Cloudflare's check (Turnstile) says a real browser pressed Play and the game has been on screen for a minute. The check starts when the page opens, so Play doesn't wait for it (Julius, Oct 14, 2026).
- **Multiplayer needs the check on Play:** a player pass needs a key from that check, up to 5 passes per key over 6 hours, so bots can't fill rooms or fake "playing now" (Oct 14, 2026).
- **Cloud saves:** the page syncs on its own, but the server checks which version each write started from and keeps its own copies, so a bad client can't silently overwrite newer progress or wipe a save.
- **Purchases:** games check `Zaisma.owns(item)` for speed; game servers check signed receipts, the same way they check player passes.
- **Report triage:** a report's words alone never take a game down; triage acts on what it finds in the game's files, and a griefer gets at most one pause per version.

### Fails

- Trusting a client's "this player left", "this purchase went through" or "this play counts" with no server check behind it.
- A safety check that only the SDK runs, so a game that skips the SDK skips the check.
