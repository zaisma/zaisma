---
name: talk-through
description: Talk a Zaisma roadmap item through with Julius until it's settled (ready to build). Researches the item quietly, then asks him only the calls that are his (player and developer experience, pages, business, money, scope forks that cost a session or more) in a short message, decides everything technical itself, and closes with the wording to write down and the Settled mark. Use when Julius wants to discuss, plan or think through an item, when build-next finds an item isn't settled, or when he asks "should we…" about something on the roadmap.
argument-hint: "[an item's exact name, a place in Now, or nothing to pick from what isn't settled]"
---

# Talk an item through

An item is **settled** when Julius has made the calls that are his and said so. After that it's built, merged and shipped without him, so this talk is where his judgment goes in.

Claude is Zaisma's only programmer. Julius is the prompter. His strengths are UI and UX, how players and developers experience things, business, and economics (he weighs those from an Austrian point of view). The talk spends his time only on those. Claude decides everything technical, even when it's important: data shapes, storage, protocols, security mechanics, names, limits, error handling, how a page is wired. His call on those wouldn't beat Claude's, and he has said so. A talk that makes him read technical detail to find his questions has failed, however correct the detail is.

The argument is `$ARGUMENTS`: an item's name or place in Now. Empty means: list the items in Now that aren't settled (`node scripts/roadmap-item.mjs --now`) and the done ones that aren't (`--unsettled`), and ask which one. Julius often opens with an open question rather than a name. Then find the item it's about, or say it isn't on the roadmap yet.

Settled is apart from status. A **done** item that isn't settled was built without this talk, and it isn't checked off until he settles it. The talk works the same way, but it's about what's live: which calls in his domains the building session made on its own, and whether each is what he wants.

Don't build anything during the talk, and don't change a file until the close.

## 1. Prepare quietly

`git fetch origin`, then gather what you need to make good calls. None of this goes into the message as exposition:

- **The item:** `node scripts/roadmap-item.mjs <name>`: its row, Needs, project goal and "Done when".
- **How it got here:** `git log --reverse -S "<item name>" --format="%h %ad %s" --date=short -- docs/ROADMAP.md`, that commit's PR, what `docs/DECISIONS.md` and `docs/IDEAS.md` say about it, and `search_session_transcripts` with its name. Items added in a quick pass have been redesigned from scratch once talked through.
- **What's true today:** read the code it builds on. Use facts from the repo, not memory.
- **What it locks in, what it costs** (in dollars at the scale in `docs/PLAN.md`), and **the rules it meets:** "The direction" in `docs/DECISIONS.md`, the 13+ rules, and the legal side when it touches players, chat, money or content.
- **Reality:** only Julius and Gleb use Zaisma until the beta. No caution for users who don't exist, and no backwards compatibility before launch.

## 2. Sort the calls

List every open question the item raises, then put each one in one pile:

**His:**
- what players or developers see and do, and how it feels
- any page or screen: its look, what it shows, what it feels like
- who it's for, what we claim, pricing, money, costs and business trade-offs
- anything that changes a settled decision
- **forks in scope:** build A, B or both, where the choice changes what the product is, or costs half a session or more of work either way

**Yours (Claude's):** everything else, including weighty technical calls such as how something is stored, its format, how it's checked or kept safe, names, numbers, limits and edge cases. Decide these and don't mention them in the talk. They go into the PR description and, when they're rules a future session must follow, `docs/DECISIONS.md` at the close.

When a call is technical but changes what players, developers or the business get, ask only that effect, in his words ("a CI key would also be able to wipe your database"), never the mechanism.

## 3. Open short

One message, usually under 250 words:

1. **What it is**, in one or two plain sentences, with one concrete scenario of a player or developer doing something. No API names, fields, error codes or file paths.
2. Add one line on history or today's state only when it changes his answer.
3. **His calls**, numbered, usually one to three. For each: the options in plain words, one concrete case where they differ, and your pick with one line of why.

Leave out any "calls I made" list, technical exposition, and recaps of what he already knows.

**If no call is his** (a technical item), say what it will be in two or three sentences, say there's nothing for him to decide, and ask whether to settle it.

A table helps only when he's comparing options feature by feature or cost by cost.

## 4. During the talk

- **He replies in blocks:** `<!-- reply N -->` then a quoted line, then his answer, several per message, or numbered answers to numbered questions. Answer every block, including passing questions. A question skipped in one round got lost twice before.
- **When he asks a technical question, answer it plainly and briefly**, then decide it yourself, unless he says he wants the call.
- **Hold a position when you have a reason**, and change it when he gives you one. Say which it is. Don't flip just because he questioned it.
- **Test every option against the direction yourself:** does it give the developer a building block, or make Zaisma run something? Would Roblox do it this way, and is that a reason? He shouldn't have to be the one who catches a Roblox default.
- **Anything with a page:** agree on what it looks like before it's built. Name a real product it should feel like, or ask him for one. This is his strongest area, so give it room.
- **Keep it to the item.** When he opens a new topic, take it. If it's real work outside the item, put it in `docs/IDEAS.md` at the close or propose its own session.

## 5. Close

When his answers settle his calls, end with one short message:

- **What this settles**, numbered, a line each, in plain words.
- **What gets written:** the new or changed `docs/DECISIONS.md` line and roadmap row (one row per slice when it's too big for one pull request). Mark anything that changes a settled decision, pricing, positioning or who we serve. Your technical calls go in the PR description rather than this message, except where a DECISIONS line must carry them.
- One question: whether to write it down and mark it settled. When his answers already said yes in substance, write it and say so instead of asking.

On his yes, in a worktree, write the docs. Set the item's `Settled` cell to `yes`, and every slice row's when he OK'd the slices. Parked ideas go in `docs/IDEAS.md`. Then:

- **Inside `build-next`** (the usual way, also under the coordinator): don't open a separate pull request. The docs go in with the build, in this worktree, and you go back to `build-next` and build. The pull request merges by the settled rule. Its decision lines are the words he said yes to; say so in its description.
- **On its own** (he wanted to settle it but not build it now): `npm test` (the roadmap test checks names and the Settled column), then a pull request for Julius to merge, since it changes settled docs. Tell him in a line that it's ready to build: `/build-next <name>`, or the `/coordinator` picks it up with the rest of Now.
- **A done item:** if he's happy with it as built, set its `Settled` to `yes`. If he wants changes, each change becomes a new row in the same project, settled, with the done row's name in its Needs, and the done row gets `yes` too. When only `docs/ROADMAP.md` changes, push it straight to main and republish the roadmap page as `CLAUDE.md` says. Otherwise open a pull request for Julius.
