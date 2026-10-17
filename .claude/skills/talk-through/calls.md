# Which calls are Julius's: the casebook

Real calls from real talks, sorted by whether his answer beat Claude's. Read it before sorting an item's calls (`SKILL.md`, step 2). Add a case at the close when a talk teaches something new: a call he waved through, one he caught that Claude missed, or a tier Claude got wrong. Keep each case to a few lines: the call, what happened, the lesson.

## The test

Would his answer be better than Claude's? His edge: UI and UX, how players and developers experience things, business, economics. The test is not importance. A weighty technical call is still Claude's. A small call about how a page feels is his.

## His

**Whether Zaisma draws save screens at all.** *Saves through the API, Oct 16, 2026.* The brief asked "what the player sees when a developer changes their save" with three options, and every one of them was a Zaisma screen. He asked whether save management was Zaisma's business at all (horror games that forbid going back, MMOs that forbid rerolls), and the talk turned into "Zaisma hosts saves; the game owns their rules". It was the only real discussion of three talks that day.
*Lesson:* check the direction before writing options (step 1). When the item's own design crosses a line, that's the headline call, and the options must not all assume the thing he'd reject.

**Fixed key levels, custom access, or both.** *Scoped API keys, Oct 16, 2026.* Asked as (a), (b) or (c). He picked "b and c": he didn't want to give up advanced setups or the convenience of fixed levels. It's a scope fork that changes what developers get.
*Lesson:* when options aren't exclusive, offer "both" yourself, with what it costs.

**The database page: a console or a spreadsheet editor.** *Game database import and export, Oct 16, 2026.* A page, so it's his domain. He said it was the only call in that brief worth surfacing, and took the pick.
*Lesson:* a page call is worth asking even when your pick is strong. Give it a sketch and a real product to compare it to.

**The account page listing every game's save copies.** *Saves through the API, Oct 16, 2026.* Asked as "should players see that a developer changed their save". He asked why players get a save manager at all. It's experience plus direction, and he caught a Zaisma-run feature built by habit.
*Lesson:* a question about what players see is his, and so is whether they should see it at all.

**What we promise once developers add their own servers.** *Games can reach our rooms and their own servers, Oct 16, 2026.* A done row that put a Zaisma approval on a building block. Asked as A (add freely, narrow the promise to what the scan can check) or B (a person OKs each address), with the fact that decided it: the approval sees a name, not what the server sends. He picked A at once.
*Lesson:* what we claim is his even when nothing public says it yet. When one option is a safety check that can't see what it checks, say that plainly; it makes the call quick.

## Not his

**The export format: SQL dump, or JSON and CSV.** *Game database import and export.* "Too technical… just implementation decisions, not system design."

**What import does to existing data: add only, or replace.** *Game database import and export.* Same answer. Semantics and safety mechanics are Claude's, even when data loss is at stake.

**Adding "restore to a time" as a companion row.** *Game database import and export.* It's a building block that follows from the item, so add it and say so in the PR, without asking.

**Which key levels can post on the forum.** *Scoped API keys.* "Sure, I like your pick." It's a security mechanic with an obvious answer.

**Keeping key-making on the account page.** *Scoped API keys.* That was already settled, and the item didn't change it. Don't re-ask settled decisions.

**Read-only, full access, or full plus bulk download.** *Saves through the API.* He answered "a" at once. The scope was obvious from the decision it came from, so it should have been Claude's call.

**Every "Calls I made, overrule any" list.** All three talks. He doesn't read them: "there doesn't appear to be anything I could decide there." They go in the PR.

## Tiers

All three talks above should have opened differently:

- **Scoped API keys:** *One call*, the levels/custom/both fork.
- **Game database import and export:** *One call*, the page.
- **Saves through the API:** *Needs you*, the direction question plus what players see.
- **Games can reach our rooms and their own servers:** *One call*, rightly: the promise, with the direction check folded into the options.
