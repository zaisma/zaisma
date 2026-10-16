# What's live keeps working

The principle "What's live keeps working" in [`DECISIONS.md`](../DECISIONS.md), which sets out how strict it is for each layer. This file is its casebook: what it means, how to test a change against it, and the real calls made under it. Every case is a real Zaisma call. When a talk settles a new one, it's added here in the same change.

## The rule

**From the day the beta opens, a developer's game, their game server and their AI's habits keep working without them touching anything.** Inside games, v1 only gains things; a breaking change becomes v2, served beside v1. In the API, MCP and upload command, renames answer with a coded error that names the replacement, and answer fields stay at least 90 days beside their replacements. Zaisma's own insides make no promise.

## Why it exists

A published game runs for years with nobody watching it. If an SDK change breaks it, nobody notices until the players leave. And an AI that learned a call yesterday should be able to fix today's renamed one in one step, not by guessing (Oct 16, 2026).

## The test

1. **Does this change something a published game, a game server or an AI's call depends on?**
2. **Inside games** (the SDK, the game server API, the save format, player passes): does v1 only gain things? If not, it's v2.
3. **API, MCP, upload command:** is it an addition? If it renames or retires something, does the old name answer with `renamed_field` or `retired_tool`, and does a removed answer field stay 90 days?
4. **Is the beta open yet?** Before it, clean changes win: nobody else builds on Zaisma, so never carry two names.

## Cases

### Passes

- **Before the beta, renames are clean:** old names don't keep working, because carrying two would only cost us (Oct 14 and 16, 2026).
- **Saves without Zaisma screens** removes the conflict chooser and the player-facing restore before the beta, while only Julius and Gleb use Zaisma (Julius, Oct 16, 2026).

### Fails

- After the beta: changing what an SDK call returns in v1, or dropping an answer field without the 90 days.
