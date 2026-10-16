---
name: whats-next
description: Decide what Zaisma builds next when the Now list in docs/ROADMAP.md is empty or Julius asks what's next. Checks whether the finished work is really done, looks for foundations that should go before everything else, and proposes an ordered Now list for Julius to approve.
---

# What's next

Julius uses this when Now is empty or he isn't sure what comes next. He shouldn't have to explain the question each time: it's always "is what we finished really done, is there anything that should go before everything else, and in what order?"

## 1. Read where things stand

- `git fetch origin`, then read `docs/ROADMAP.md` from `origin/main` (other sessions merge in parallel): Now with its First and Next, the current phase, every project's goal and "Done when", and the rows with their Needs.
- "The direction" in `docs/DECISIONS.md`, and `CLAUDE.md`.
- Open pull requests (`gh pr list`) and the last few weeks of `git log origin/main`, so nothing already in flight is proposed again.
- Rows waiting on Julius or Gleb: say they're waiting, never plan around them as if they were ours.

## 2. Is the last work really done?

For each project whose rows all just turned `done`: does its "Done when" actually hold, and did the rows cover the goal, or is there an obvious gap? Only gaps that matter; a project isn't reopened for polish.

## 3. Does anything go before everything else?

This is the main question. An item, or a short chain of items, goes first only when one of these is true:

- **Other items build on its shape.** Identity, IDs, data models, formats, public names, the pass. Building on the old shape first means redoing that work after.
- **It gets more expensive the longer it waits.** Above all anything that becomes a contract under "What's live keeps working" once the beta opens: the inside-games level (SDK, game server API, save format, player passes) and the API, MCP and upload command. Every game, server or AI habit built on it raises the cost of changing it.
- **It makes every later item more accurate or cheaper.** Names, checks that run by themselves, the building-block recipe in `CLAUDE.md`, types: the things that compound as more AIs read and write the code.

Ask it at two levels. **Before every other item:** it goes in Now's **First**, and nothing else starts until it lands. **Before every other row of one project:** it gets a `**First:** <item>` line under that project's goal, and only that project waits. An item that holds back one or two others is a Need, not a First. First is for real gates; most of the time it's empty, so that Next can be built side by side.

Everything else can go in any order and isn't ranked by this: a feature that costs the same whether it's built now or later, UI (which goes after the features it shows), and internal structure (split or move code while working in it, when it gets in the way).

Weigh it the way Julius does:

- **Return over perfection.** Aim for the 90 to 95 percent that matters; a sweep that buys 2 to 5 percent isn't worth a session. Never surface nitpicks or random issues.
- **Lasting impact only.** Something belongs here only if it still matters as AIs get stronger and developers lean on their AI for most of the work.
- **Respect the roadmap.** Needs, the beta bar, items that are deliberately last (the Zaisma skill for every AI), and anything Julius has parked.

## 4. Answer

Short and plain, in this order:

1. **Done or not:** one line per finished project, with any real gap.
2. **What goes first, if anything:** the item or chain for Now's First, in order, and for each one sentence on what builds on it or what waiting would cost. Then any project's First, with the same sentence. If nothing does, say so: then the rest can go in any order, side by side, and say which item you'd start with and why.
3. **Foundation gaps outside the roadmap**, if any, with the same test: what it costs later, why now. Propose real work as a session card, not a paragraph.
4. **The Now list you propose**, ready to paste: a `**First:**` part (or `**First:** nothing.`) and a `**Next:**` part, numbered straight through, each item's exact name with its project in brackets. Add any project `**First:**` lines below it.

Then ask Julius one question: whether to set Now that way.

## 5. On his yes

Do the roadmap step `CLAUDE.md` describes: change Now and the statuses together (only Now's items are `next`, in Now's order), with a line in Now saying why First comes first and the date, and add or remove the project `**First:**` lines. `npm test` checks that every name in them is a real item and that none is already done. Push it to main, then republish the roadmap page from `origin/main`. Don't start building unless he says to.
