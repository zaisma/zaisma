---
name: coordinator
description: Julius's one place to work on Zaisma. Keeps up to a set number of sessions running (2 unless he says otherwise), in one of three modes: both (settled items build, unsettled ones open with a talk), build (only settled items, for when he's away) or talk (only talks, to work through what isn't settled). Brings him previews and questions, and when a session reports done, merges its pull request, ships, marks the row, has the session clean up and archives it. Offers the next batch when one lands but starts it only on his go, and runs whats-next when Now runs dry. Use when Julius says /coordinator, wants to work on Zaisma, build a batch, build what's in Now, work through the unsettled items, or run the coordinator.
argument-hint: "[most sessions at once, default 2] [both | build | talk, default both] or exact item names"
---

# Coordinator

Julius starts one session with `/coordinator` and works from there. He shouldn't have to start one session, wait for it to ship, then start the next, or work out what comes after Now. He settles one item while others build. This session coordinates and builds nothing. It keeps no more sessions running than the cap (2 unless he says otherwise; see the argument below). Each item gets its own session running the `build-next` skill (or only `talk-through` in `talk` mode).

**Sessions do the work; this session finishes it.** A session under the coordinator talks, builds, opens its pull request and gets its preview OK'd, but it never merges, ships or cleans up. When it has reached a conclusion it asks Julius **"Are we done?"** (buttons: *Yes, we're done* / *More to discuss*). On his yes it ends its turn with a **done report**, and this session does the rest (step 4): merge, ship, mark the row, republish the roadmap page, have the session run `/cleanup`, then archive it. His yes in that session is his merge for its pull request (CLAUDE.md, "Merging"). A build that never needed him (settled, no preview) reports done without asking.

The only files this session changes are the roadmap's: a new Now (step 6), the `done` mark after a ship (step 4) and the `Settled` marks for Quick items Julius settles here (step 5). It does that in its own worktree (EnterWorktree, named `coordinator`, if this session isn't in one).

## The argument: how many and which mode

The argument is `$ARGUMENTS`, in any order: `/coordinator`, `/coordinator 3`, `/coordinator build`, `/coordinator 4 talk`.

- **A number is the cap:** the most sessions this coordinator has running at once, of every kind: builds, talks and fixes. **Empty means 2.** Julius is often near his usage limit, so never start past the cap, and never raise it on your own.
- **The mode** says what those sessions are. Empty means `both`.
  - **`both`:** settled items build; unsettled items in Now open with a talk in their own session and build once he settles them; and one talk about a done item is kept ready (step 5).
  - **`build`:** for when Julius is away. Only settled items get a session. Unsettled ones are skipped, no talks start, and nothing waits for him except a preview he must OK. Name the skipped items in your first message.
  - **`talk`:** for working through what isn't settled at his desk. Nothing builds. Every session is a talk (`/talk-through`): first the unsettled items in Now, in Now's order, then the done items that aren't settled (step 5). A talk that settles an item in Now ends with its own pull request, and the item builds later in `both` or `build`.
- **Names** mean only those items, in the current mode, still under the cap.

Say the cap and the mode in your first message, so he can correct them.

**The cap rule**, used every time anything starts: count the sessions that are still running, then start only up to the cap. Running means a session this coordinator started (`list_sessions` with `linked: true`) that hasn't sent its done report: it's working, or waiting for Julius (a talk, a preview, a question, "Are we done?"). A session that reported done frees its place at once, even while step 4 is still merging it; one that a failed ship sent back (step 4) takes a place again. On the first run, an item in Now that `--now` shows as claimed by another session counts too: it's likely still running from an earlier coordinator. When the cap is full, start nothing and wait for a done report.

**Only Julius starts sessions.** Every session costs his usage, and he's often near his limit, so nothing starts without his go in this chat: `/coordinator` itself (the first batch), or his answer to an offer like "Start the next batch?". Nothing else is a go:
- "done", "I'm done with these", or a *Yes, we're done* click in a session only finishes those sessions (step 4)
- a freed place under the cap
- a new Now
- his answer to anything else

This holds in every mode, and most of all in `build`, where he may be away. When there's room and something is ready, finish what's done first. Then offer it with the wrap-up box: which items, how many sessions and in what mode, with the buttons *Start them* and *Not now*. On a turn that a session's note began, the app can't start sessions anyway, so the offer waits for his click.

## 1. Pick the items

`git fetch origin`, then:

```
node scripts/roadmap-item.mjs --now
```

It prints every item in Now, settled or not, and whether it's free to start or what it waits on (Needs, a First item, another session's claim). An item is ready to start when no open pull request (`gh pr list`) is already about it, no session is on it, and:

- **`both`:** it's **free to start**, settled or not.
- **`build`:** it's free to start and settled.
- **`talk`:** it isn't settled. It may still wait on Needs: a talk doesn't need what the item builds on to be built.

If none is ready, and nothing in Now waits only on an item that's being built now, Now has run dry: go to step 6. In `talk` mode, go to the done items that aren't settled instead (step 5), and to step 6 only when those are gone too.

## 2. Start one session per item, up to the cap

Only on Julius's go (see above). Use the cap rule: start only as many as the cap leaves room for, in Now's order; the rest wait for step 5. For each one: a bold title line and one sentence, then `start_session` with `initiation` "user_asked", `use_worktree: true`, `context` "fresh", `wake_when_done: true`, the item's name as `title`, and as `prompt` `/build-next <the item's exact name>`, or in `talk` mode:

```
/talk-through <the item's exact name>
```

Use the exact name, never a place in Now: places move as items land. The `background` always starts with this line, which is how the session knows it reports done instead of merging:

```
Under the coordinator (<this session's id>): never merge, ship or clean up. When you've reached a conclusion, ask Julius "Are we done?" and on his yes send the done report to the coordinator with SendMessage, then end your turn with it (see your skill).
```

`<this session's id>` is this coordinator's own `local_…` id: `get_session` with `"self"` gives it. Read it there before the first start; never work it out from a path (the scratchpad folder's name isn't the session's id).

**Why the message.** The app doesn't wake this session for a turn Julius drove himself in another session, and his *Yes, we're done* click is one. The note waits until he next writes here, so without the message he'd have to come back and say "done". A message from the session does wake this one.

Then one or two lines on the mode and what the session is for.

**Set each session's `effort` yourself**, from the item's row, its Needs and what it touches. Don't ask Julius which level. The app names the levels Low, Medium, High, Extra and Max; the tools call Extra `xhigh`. (Ultracode in the app's list is the multi-agent workflow mode, not a level the tools set.)

- **`medium`, low stakes:** copy, docs, a page tweak, a small fix in one place, a talk about a small done item.
- **`high`, the default:** most items and talks.
- **`xhigh` (Extra), high stakes:** a First item or one much else builds on; migrations that change or delete data; money (Stripe, the buy sheet); safety, moderation and the 13+ rules; sign-in, player passes, API keys and the game sandbox; names in the API, SDK or game server that lock in once live.

**`start_session` quietly caps `effort` at this session's own level.** Asking for `xhigh` from a coordinator at High starts the session at High, and the result doesn't say so. So before the first start, read this session's level (`get_session` with `"self"`). Start every session with `effort` at or below it, then raise each one that wants more with `set_session_effort` right after it starts: the app asks Julius to approve each raise above this session's level, and it applies from that session's next turn. Check the level that stuck with `get_session` on the new session, never from the start result. In your message about the batch, say which sessions run at which level.

When a session turns out bigger or riskier than its row said (a talk settles more than expected, a build hits a migration), raise it the same way. `build-next` does the rest:

1. It claims the row.
2. If the item isn't settled, it prepares the talk's brief and waits for Julius.
3. It builds and opens the pull request.
4. It runs a preview on a free port when one's needed, and waits for his OK.
5. It asks "Are we done?" (or, when Julius was never needed, reports done straight away).

Then tell Julius in one message which items are building, which are **waiting for a talk**, and which wait for room under the cap, each linked to its session. He talks in that session itself, not through this one.

## 3. Pass on what needs Julius

When a session ends a turn, read its note, and check its pull request before believing it.

- **A talk's brief, a talk going on, or "Are we done?":** don't relay it. Remind Julius in a line, with the link, only when the session has been waiting for him and nothing else needs him.
- **A preview:** give Julius its links, under the item's name. Several at once go in one message, one item per block. Forward his answer to that session with `SendMessage`, quoting his words: an OK ("looks good", "ship it") or what to change.
- **A question** during a build about design or scope: ask Julius, with the session's options and its recommendation, and forward his answer quoted. If it needs more than one round, send him to the session instead.
- **Stuck** (a check that won't pass, a conflict it can't settle): say what's wrong in one line and what you'd do; don't fix it from here.
- **A done report:** step 4.

Never approve a preview, answer a design question or say "we're done" on Julius's behalf.

## 4. Finish what's done

A done report is the session's last recap, and it starts with `Done:`, then the item's name, its pull request, and whether it's a talk or a build. Its second line quotes Julius's words (`Julius: "…"`) and its third says what it left running (`Started: …`). Before acting on it, check that quote against the session: `list_events` with a limit of about 15 shows his last message; page back only when it isn't there. The quote is the session's claim, his message is the proof. A settled build with no preview never needed him. A report with no yes from him (a decision isn't one) isn't done: ask him here whether that session is done, with *Yes, merge it* / *More to discuss*. Then handle reports one at a time, in the order they came:

1. **Up to date.** `gh pr update-branch <number>` brings the pull request up to date with main.
   - **A conflict in a docs-only pull request** (only `docs/`, `.claude/` and `CLAUDE.md`): settle it yourself. Talks all touch the roadmap, DECISIONS, the casebooks and IDEAS, and these conflicts are always "keep both sides". In this session's worktree: `git fetch origin`, check out the pull request's branch (`gh pr checkout <number>`), `git merge origin/main`, and keep both sides of every conflict. `.gitattributes` already does that for the append-only files. Then run `npm test`, push, and go on with step 2. If a conflict isn't plainly both sides (the same row changed two ways), send it back instead.
   - **A conflict that touches code:** send it back to the session with `SendMessage` ("bring your branch up to date with main, fix the conflicts and push, then report done again"), and go on with the next report.
2. **Checked.** After any update or push, the new check takes a few seconds to appear, and `gh pr checks --watch` returns at once when there's none yet. So wait until `gh pr checks <number>` lists a check, then `gh pr checks <number> --watch`, in the background. Merge only on a pass. A failed check goes back to the session the same way.
3. **Merge.** `gh pr merge <number> --merge --delete-branch`. If it fails because main moved, go back to 1.
4. **Ship**, when the pull request changes anything outside `docs/`, `.claude/` and `CLAUDE.md`: `npm run ship`, in the background (it waits its turn behind another ship). `SHIP WAITING` means a migration deletes data: start `npm run ship` in a Terminal tab (`run_in_terminal`), tell Julius which tab and what it deletes, and read the tab for `SHIP PASS`. `SHIP FAIL` goes back to the session with the ship's last lines; it fixes it in a new pull request and reports done again. When nothing ships, bring the main checkout's `main` up to date yourself, only when it's on `main` with no changes: `git pull --ff-only` run in the main checkout itself, since a session isolated in a worktree is refused `git -C`.
5. **Mark the row.** A build: on `SHIP PASS`, mark its row `done` (date, PR, migration) in a commit from this session's worktree, pushed straight to main. If the push is refused because main moved, fetch, redo the one row on `origin/main`, and push again. A talk's pull request already carries its rows.
6. **Republish** the roadmap page as CLAUDE.md says, once per batch: after the last report that's waiting has merged, not after each one.
7. **Clean up, then archive.** Not before its ship passed.
   - **A talk whose report says `Started: nothing`:** clean up yourself. Prune its branches with the cleanup skill's pruner, from the main checkout: `node ~/.claude/skills/cleanup/prune-branches.mjs <its branches>`. Its branches are its `talk/…` branch and the worktree's own (`list_sessions` with `linked: true` shows it). Run `--dry` first; stop and tell Julius if it keeps anything for a reason other than being checked out in that session's worktree. Then archive the session, which removes the worktree, and run the pruner once more for the branch the worktree held.
   - **Everything else** (builds, and talks that ran a preview or a server): send the session `/cleanup` with `SendMessage` ("PR #N is merged and shipped; run /cleanup, or if that skill isn't available there, read ~/.claude/skills/cleanup/SKILL.md and follow it with its pruner; then end your turn with one line saying it's clean"). A slash command sent as a message doesn't always load the skill, hence the path. Its cleanup skill confirms the work landed, stops anything it started and prunes its branches. Wait for its note. Only when it says it's clean, archive it (`archive_session`), which removes its worktree. If cleanup kept something or stopped on a check, tell Julius in a line and leave the session open.

Then tell Julius in a line or two what landed, with each pull request, and go to step 5.

## 5. Keep going

Each time a session reports done and step 4 has finished it, run step 1 again: an item that waited on it may be free now. Don't start anything. Offer what's ready as the cap rule allows, in Now's order, and start it only when he says so ("Only Julius starts sessions"). When a whole batch has finished, say what landed and make one offer for the next batch.

**Sort the done items first.** Done items built without being settled aren't checked off (`node scripts/roadmap-item.mjs --unsettled`). Most were technical, and a session each would end in "your pick". So before any talk about a done item, and again whenever new ones turn up, sort them into the `talk-through` skill's three tiers (its steps 1 to 3 and `calls.md`), without starting talks. Hand the reading to subagents, a project or a handful of items each. Each subagent returns, per item, its tier, what it is through Julius's lens in one line, and the line it would settle as. Then:

- **Quick items come to Julius here, as one list:** one line each, what it is and "settles as …", grouped by project, at most 15 per message. He answers with "settle all" or names the ones to pull out. His yes in this chat settles the rest. Write their `Settled` cells in this session's worktree, open one roadmap-only pull request, and finish it as in step 4 (his yes is its merge). A pulled-out item becomes a talk.
- **One call and Needs you items** get a talk each, offered like any session: on his go, a `start_session` as in step 2, with `/talk-through <the item's exact name>` as the prompt. Put the tier in the background so the session doesn't redo the sorting. Start with the ones other work builds on, or the ones that would cost the most to change later. Each counts against the cap like any session.

- **`both`:** offer one. Whenever no session is waiting for Julius to talk and the cap has room, offer one talk, and start it on his go.
- **`talk`:** once no unsettled item in Now is left, offer these to fill the cap.
- **`build`:** none.

## 6. When Now runs dry

Don't wait to be asked. Use the `whats-next` skill. It checks that the finished work is really done, looks for anything that has to go first, and proposes the next Now, saying which items are settled and which will start with a talk. Sessions still building carry on meanwhile.

Setting Now is Julius's call, so ask him the one question the skill ends with. On his yes, do the skill's last step (Now and the statuses together, pushed straight to main, then republish the roadmap page as CLAUDE.md says). A yes to Now isn't a go to start, so then offer the first batch from the new Now, in the same mode and under the same cap.

If he says no or wants changes, change the proposal and ask again. If he wants to stop, go to step 8.

## 7. Anything else Julius brings up

This is where he works, so take whatever he says here:

- **A new idea or item:** if it's real work, offer to start a session that talks it through (`/talk-through`), and add it to the roadmap only as that talk settles it. A passing thought goes in `docs/IDEAS.md` through that session or the next roadmap change.
- **A question** about Zaisma or where things stand: answer it here.
- **A fix he wants now:** its own session, like any item, under the coordinator line. It counts against the cap; when the cap is full, say so in a line and start it only if he says to.
- **A new cap or mode** ("make it 3", "switch to build"): use it from the next start on. Sessions already running carry on.

## 8. Finish

When Julius says to stop, or nothing is building and he has turned down a new Now, first finish every done report that's waiting (step 4), then answer in a few lines:

- What went live, with each pull request.
- What's left and why: a talk still open, waiting on something, stuck.
- How many done items still aren't settled.

This session republishes the roadmap page after the merges and row marks it makes (step 4) and after its own Now change.
