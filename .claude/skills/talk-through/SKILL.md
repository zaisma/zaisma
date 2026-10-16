---
name: talk-through
description: Talk a Zaisma roadmap item through with Julius until it's settled (ready to build). Prepares a short brief first (what it is in plain words, how it got on the roadmap, what's true today, what it locks in, cost), then asks only the calls that are his, and closes with the exact wording to write down and the Settled mark. Use when Julius wants to discuss, plan or think through an item, when build-next finds an item isn't settled, or when he asks "should we…" about something on the roadmap.
argument-hint: "[an item's exact name, a place in Now, or nothing to pick from what isn't settled]"
---

# Talk an item through

An item is **settled** when Julius and Claude have gone through what it is, its design and its scope, and he said so. Then it's built, merged and shipped without him. So this talk is where his judgment goes in, and it's the one place to slow down. Its job is not to invent ideas or list everything that could be better. It's to give him what he needs to decide, ask only what's his to decide, and write down what he decided where a future session will find it.

The argument is `$ARGUMENTS`: an item's name or place in Now. Empty means: list the items in Now that aren't settled (`node scripts/roadmap-item.mjs --now`) and ask which one. Julius often opens with an open question rather than a name. Then find the item it's about, or say it isn't on the roadmap yet.

Don't build anything during the talk, and don't change a file until the close.

## 1. Prepare before the first question

`git fetch origin`, then gather this quietly and write the brief from it:

- **The item:** `node scripts/roadmap-item.mjs <name>`: its row, Needs, project goal and "Done when".
- **How it got here:** `git log --reverse -S "<item name>" --format="%h %ad %s" --date=short -- docs/ROADMAP.md` for the commit that added it, and that commit's message or PR. Also look at what `docs/DECISIONS.md` and `docs/IDEAS.md` say about it, and `search_session_transcripts` with its name for the session where it came up. Julius often doesn't remember why an item exists, and items added in a quick pass have been redesigned from scratch once talked through.
- **What's true today:** the code it builds on, in plain words: what exists, what a player or developer can do now, what's missing. Facts from the repo, not from memory: decisions made in side chats get lost, and a stale rule quoted as current costs a round.
- **What it locks in:** whether it becomes a contract under "What's live keeps working" (SDK, game server, save format, passes, API, MCP, upload command), and whether it gets dearer the longer it waits.
- **Cost:** in dollars, at the scale in `docs/PLAN.md`, when it touches hosting, rooms, storage or AI.
- **The rules it meets:** "The direction" in `docs/DECISIONS.md` (the developer's game is theirs; building blocks over Zaisma-run features; not Roblox), the 13+ rules, and the legal side when it touches players, chat, money or content.
- **Reality:** only Julius and Gleb use Zaisma until the beta. No caution for users who don't exist, no announcement posts, no backwards compatibility before launch.

## 2. Open with the brief

One message of about 300 to 600 words:

1. **What it is**, in two or three plain sentences, with one concrete scenario: a player or developer doing something.
2. **How it got on the roadmap:** when, from which session or decision, and what it already assumes.
3. **Where things stand today**, in broad strokes. Implications, not variable names.
4. **What it locks in and what it costs**, a line each, only when they matter.
5. **The calls that are Julius's:** two to four, numbered. These are what it is, who it's for, scope, how it fits the direction, anything that changes pricing, positioning or a settled decision. Each comes with the options that matter, a concrete case where they differ, and your pick with one line of why.

Define any term he may not have met (a Cloudflare product, an industry word) the first time it appears. A table helps when comparing options feature by feature or cost by cost. Anything that's yours to decide (names, numbers, limits, internals), decide, and list it under "Calls I made, overrule any" instead of asking.

## 3. During the talk

- **He replies in blocks:** `<!-- reply N -->` then a quoted line, then his answer, several per message, or numbered answers to numbered questions. Answer every block, including passing questions. A question skipped in one round got lost twice before.
- **Hold a position when you have a reason**, and change it when he gives you one. Say which it is. Don't flip just because he questioned it.
- **Test every option against the direction yourself:** does it give the developer a building block, or make Zaisma run something? Would Roblox do it this way, and is that a reason? He shouldn't have to be the one who catches a Roblox default.
- **Anything with a page:** agree on what it looks like before it's built. Name a real product it should feel like, or ask him for one. A forum that was built as a private inbox once cost a whole session.
- **Keep it to the item.** When he opens a new topic, take it. If it's real work outside the item, put it in `docs/IDEAS.md` at the close or propose its own session.
- **No building, no file changes** until the close.

## 4. Close

When his answers settle the open calls, end with one message:

- **What this settles**, numbered: each decision in a line.
- **What gets written, word for word:** new or changed `docs/DECISIONS.md` lines in blockquotes, roadmap rows (name, Must or Nice, Needs, notes; one row per slice when it's too big for one pull request), and any `docs/NAMING.md`, `docs/PLAN.md` or `CLAUDE.md` line. Mark anything that changes a settled decision, pricing, positioning or who we serve.
- One question: whether to write it down and mark it settled.

On his yes, in a worktree, write the docs as shown. Set the item's `Settled` cell to `yes`, and every slice row's when he OK'd the slices. Parked ideas go in `docs/IDEAS.md`. Then:

- **Inside `build-next`** (the usual way, also under the coordinator): don't open a separate pull request. The docs go in with the build, in this worktree, and you go back to `build-next` and build. The pull request merges by the settled rule. Its decision lines are the exact words he said yes to; say so in its description.
- **On its own** (he wanted to settle it but not build it now): `npm test` (the roadmap test checks names and the Settled column), then a pull request for Julius to merge, since it changes settled docs. Tell him in a line that it's ready to build: `/build-next <name>`, or the `/coordinator` picks it up with the rest of Now.
