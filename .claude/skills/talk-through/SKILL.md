---
name: talk-through
description: Talk a Zaisma roadmap item through with Julius until it's settled (ready to build). Curated to what he's best at. It researches quietly, checks the item against the direction, decides everything technical itself, and brings him only the calls where his judgment beats Claude's (player and developer experience, pages, business and economics, scope forks that change the product). It goes deep on those and stays silent on the rest, so a technical item settles in one click. Use when Julius wants to discuss, plan or think through an item, when build-next finds an item isn't settled, or when he asks "should we…" about something on the roadmap.
argument-hint: "[an item's exact name, a place in Now, or nothing to pick from what isn't settled]"
---

# Talk an item through

An item is **settled** when Julius has made the calls that are his and said so. After that it's built, merged and shipped without him, so this talk is where his judgment goes in.

Claude is Zaisma's only programmer. Julius is the prompter. His edge is UI and UX, how players and developers experience things, business, and economics (he weighs those from an Austrian point of view). Claude decides everything technical, even when it's important. His call on those wouldn't beat Claude's, and he has said so.

**Curated, not concise.** The talk spends his attention only where his call beats yours, and it gives those calls more rigor, not less. Everything else passes him like a breeze. If you asked a UI designer which server to host on, they'd be confused, and their answer would be no better than yours. Briefing them on servers wouldn't help either. Ask the same designer how the server list should look, and they'll make a better call than you, and a good brief makes it better still. So a technical item gets a few lines and one click. A page, an experience, a money question or a direction question gets real depth. A talk that makes him dig for what matters to him has failed, however correct its detail.

**The casebook.** [`calls.md`](calls.md), next to this skill, holds real calls that were his, ones that weren't, and why. Read it before sorting the calls, and add to it at the close when the talk taught something new.

The argument is `$ARGUMENTS`: an item's name or place in Now. Empty means list the items in Now that aren't settled (`node scripts/roadmap-item.mjs --now`) and the done ones that aren't (`--unsettled`), and ask which one. Julius often opens with an open question rather than a name. Then find the item it's about, or say it isn't on the roadmap yet.

Settled is apart from status. A **done** item that isn't settled was built without this talk, and it isn't checked off until he settles it. The talk works the same way, but it's about what's live: whether what was built is what he wants, in his domains.

Don't build anything during the talk, and don't change a file until the close.

## 1. Prepare quietly

`git fetch origin`, then gather what you need to make good calls. None of this goes into the message as exposition:

- **The item:** `node scripts/roadmap-item.mjs <name>` for its row, Needs, project goal and "Done when".
- **How it got here:** `git log --reverse -S "<item name>" --format="%h %ad %s" --date=short -- docs/ROADMAP.md`, that commit's PR, what `docs/DECISIONS.md` and `docs/IDEAS.md` say about it, and `search_session_transcripts` with its name. Items added in a quick pass have been redesigned from scratch once they were talked through.
- **What's true today:** read the code it builds on. Use facts from the repo, not memory.
- **What it locks in, what it costs** (in dollars at the scale in `docs/PLAN.md`), and the 13+ rules and the legal side when it touches players, chat, money or content.
- **Reality:** only Julius and Gleb use Zaisma until the beta. No caution for users who don't exist, and no backwards compatibility before launch.

**Check the direction before anything else.** Test the item's design against "The direction" in `docs/DECISIONS.md` and the casebooks in `docs/principles/`. The design means its row, the decisions behind it and, for a done item, what's live. Look for:

- Zaisma deciding a game rule.
- Zaisma UI drawn over or around a game.
- A feature that only exists on a page.
- A Roblox default nobody chose.

If it crosses a line, that becomes the headline call, ahead of everything else. Never offer him a set of options that all assume something the direction rules out.

## 2. Sort the calls

List every open question, then ask of each one: **would his answer be better than mine?** The test isn't whether it's important. Important technical calls are still yours.

**His:**
- what players or developers see and do, and how it feels
- any page or screen: its look, what it shows, what it feels like
- who it's for, what we claim, pricing, money, costs and business trade-offs
- anything that changes a settled decision, and anything the direction check turned up
- **forks in scope:** A, B or both, where the choice changes what the product is, or costs half a session or more either way

**Yours:** everything else, including weighty technical calls such as storage, formats, protocols, security mechanics, names, numbers, limits, edge cases and small companion rows. Also yours:

- a question that looks like product but where every option serves players fine, so he'd only say "your pick"
- a settled decision the item doesn't change, so don't re-ask it

When a technical call changes what players, developers or the business get, ask him only about that effect, in his words ("a CI key would also be able to wipe your database"), never about the mechanism.

## 3. Pick the tier

By how many calls are his, every item is one of three:

- **Quick:** nothing for him.
- **One call:** one call is his.
- **Needs you:** several calls, or one big one (a direction question, a page, money).

The opening's first line names the tier: "Quick one: nothing for you to decide.", "One call worth your eye." or "This one needs you."

## 4. Open

Start with **what it is, through his lens**: what changes for a player or developer, in a sentence or two with one concrete scenario. Don't explain how it works. Leave out files, fields, formats and error codes. Add history only when it changes his answer.

**Quick:** add "I'll settle it as:" and one line in plain words. Then ask with the wrap-up box, **"Settle it?"**, with the buttons *Settle it* and *Show me more*.

- *Settle it* is his yes (step 6). Under the coordinator, it also counts as "we're done", so don't ask that again.
- *Show me more*: in plain words, give him the decisions that come closest to his domains, then ask whether any of them is his.

**One call or Needs you:** give each of his calls the depth his edge can use:

- **A page or screen:** a sketch (an inline mockup with `show_widget`, or text when that's enough), a real product it should feel like and one it shouldn't, and what the player or developer sees under each option.
- **An experience:** one scenario per option, from the player's or developer's seat, at the moment where the options differ.
- **Money, business, economics:** real numbers at the scale in `docs/PLAN.md`, who pays, what each option rewards or discourages, and what it would cost to change later.
- **The direction:** the line it crosses, the case in `docs/principles/` it's like, and what the developer can do instead.
- **A scope fork:** what the product is in each case, what each costs in sessions, and "both" when the options aren't exclusive.

Each call ends with your pick and why. The message is as long as that depth needs, and nothing else goes in it.

**Never in the talk:** "calls I made", technical exposition, a recap of what he already knows, or commit history. Your technical calls go in the PR description, and in `docs/DECISIONS.md` when a future session must follow them.

## 5. During the talk

- **He replies in blocks:** `<!-- reply N -->` then a quoted line, then his answer, several per message. Or he gives numbered answers to numbered questions. Answer every block, including passing questions. A question skipped in one round got lost twice before.
- **"Too technical" or "your pick"** on something you asked means that call was yours. Take it, don't ask more like it, and note it for the casebook.
- **When he asks a technical question,** answer it plainly and briefly, then decide it yourself, unless he says he wants the call.
- **Hold a position when you have a reason**, and change it when he gives you one. Say which it is. Don't flip just because he questioned it.
- **Anything with a page:** agree on what it looks like before it's built. This is his strongest area, so give it room.
- **Keep it to the item.** When he opens a new topic, take it. If it's real work outside the item, put it in `docs/IDEAS.md` at the close or propose its own session.

## 6. Close

**Quick:** his *Settle it* is the close. Write it down and settle it.

**Otherwise:** end with one short message:

- **What this settles:** his decisions, numbered, a line each, in plain words.
- **What gets written:** only the `docs/DECISIONS.md` wording and roadmap rows that carry his decisions (one row per slice when it's too big for one pull request). Mark anything that changes a settled decision, pricing, positioning or who we serve. The technical lines that go with them are written but not shown; they're in the PR.
- One question: whether to write it down. When his answers already said yes in substance, write it and say so instead of asking.

On his yes, in a worktree:

1. Write the docs and set the item's `Settled` cell to `yes`, and every slice row's when he OK'd the slices.
2. Parked ideas go in `docs/IDEAS.md`.
3. A close call against a principle goes in its casebook in `docs/principles/`.
4. Anything the talk taught about which calls are his goes in [`calls.md`](calls.md): a call he waved through, one he caught that you missed, or a tier you got wrong.

Then:

- **Under the coordinator:** step 7.
- **Inside `build-next`:** don't open a separate pull request. The docs go in with the build, in this worktree, and you go back to `build-next` and build. The pull request merges by the settled rule. Its decision lines are the words he said yes to; say so in its description.
- **On its own** (he wanted to settle it but not build it now): run `npm test` (the roadmap test checks names and the Settled column), then open a pull request for Julius to merge, since it changes settled docs. Tell him in a line that it's ready to build: `/build-next <name>`, or the `/coordinator` picks it up with the rest of Now.
- **A done item:** if he's happy with it as built, set its `Settled` to `yes`. If he wants changes, each change becomes a new row in the same project, settled, with the done row's name in its Needs, and the done row gets `yes` too. When only `docs/ROADMAP.md` changes, push it straight to main and republish the roadmap page as `CLAUDE.md` says. Otherwise open a pull request for Julius.

## 7. Under the coordinator

When your brief says you're under the coordinator, the close changes. You never merge, push to main, ship, republish the roadmap page or clean up on your own; the coordinator does all of that. After a talk that started nothing, the coordinator cleans up itself. If you started anything that keeps running (a preview, a server), it asks you to run `/cleanup` once your pull request is merged: run it, stop what you started, then end your turn with one line saying it's clean.

- **On its own or a done item:** always open a pull request, after `npm test`, even when only `docs/ROADMAP.md` changes. Don't ask him to merge it.
- **Inside `build-next`:** carry on building; `build-next` ends the session the same way.

**A decision is not a yes.** His answer to your last question, "go with your pick" or "drop them" settles a call, but it doesn't end the talk. After it, write what it settles, open the pull request, and ask. Only his *Yes, we're done* or his words saying so ("we're done", "that's it") end the talk.

Once the pull request is open and nothing is left to talk about, ask one thing with the wrap-up box: **"Are we done?"**, with the buttons *Yes, we're done* and *More to discuss*. For a Quick item, his *Settle it* already said it, so skip the question. *More to discuss* means the talk goes on. On *Yes, we're done* (or his words saying so), push anything left, then end your turn with `wrap_up` and no question. Its recap starts:

```
Done: <the item's exact name>, talk, PR #<number>.
Julius: "<his exact words or click that said you're done>"
Started: nothing | <what's still running, e.g. a preview on localhost:8900>
```

followed by what it settled in one line. That recap is the done report. First send the same report to the coordinator with `SendMessage`, `to` its `local_…` id from your brief (or, if it isn't there, the row in `list_sessions` with `linked: true` that has no `startedBy`). The app doesn't wake the coordinator for a turn Julius drove himself, so without the message he'd have to tell it you're done. Ask nothing after it and don't offer a follow-up. If he sets the item aside without settling it, the report is `Done: <name>, talk, no PR.` with the reason.
