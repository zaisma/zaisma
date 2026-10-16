---
name: coordinator
description: Julius's one place to work on Zaisma. Keeps up to a set number of sessions running (2 unless he says otherwise), in one of three modes: both (settled items build, unsettled ones open with a talk), build (only settled items, for when he's away) or talk (only talks, to work through what isn't settled). Brings him previews and questions, starts the next item as others land, and runs whats-next when Now runs dry. Use when Julius says /coordinator, wants to work on Zaisma, build a batch, build what's in Now, work through the unsettled items, or run the coordinator.
argument-hint: "[most sessions at once, default 2] [both | build | talk, default both] or exact item names"
---

# Coordinator

Julius starts one session with `/coordinator` and works from there. He shouldn't have to start one session, wait for it to ship, then start the next, or work out what comes after Now. He settles one item while others build. This session coordinates. It builds nothing. The only file it changes is the roadmap, when `whats-next` sets a new Now. It keeps no more sessions running than the cap (2 unless he says otherwise; see the argument below). Each item gets its own session running the `build-next` skill (or only `talk-through` in `talk` mode):

- A settled item is built, merged and shipped by itself (CLAUDE.md, "Merging").
- An unsettled item opens with the `talk-through` skill in its session. Once Julius settles it there, the same session builds it.

## The argument: how many and which mode

The argument is `$ARGUMENTS`, in any order: `/coordinator`, `/coordinator 3`, `/coordinator build`, `/coordinator 4 talk`.

- **A number is the cap:** the most sessions this coordinator has running at once, of every kind: builds, talks and fixes. **Empty means 2.** Julius is often near his usage limit, so never start past the cap, and never raise it on your own.
- **The mode** says what those sessions are. Empty means `both`.
  - **`both`:** settled items build; unsettled items in Now open with a talk in their own session and build once he settles them; and one talk about a done item is kept ready (step 4).
  - **`build`:** for when Julius is away. Only settled items get a session. Unsettled ones are skipped, no talks start, and nothing waits for him except a preview he must OK. Name the skipped items in your first message.
  - **`talk`:** for working through what isn't settled at his desk. Nothing builds. Every session is a talk (`/talk-through`): first the unsettled items in Now, in Now's order, then the done items that aren't settled (step 4). A talk that settles an item in Now ends with its own pull request, and the item builds later in `both` or `build`.
- **Names** mean only those items, in the current mode, still under the cap.

Say the cap and the mode in your first message, so he can correct them.

**The cap rule**, used every time steps 2, 4 and 5 start anything: count the sessions that are still running, then start only up to the cap. Running means a session this coordinator started (`list_sessions` with `linked: true`) that hasn't finished: it's working, or waiting for Julius (a talk, a preview, a question, `SHIP WAITING`). A build has finished when its row is `done` on `origin/main` and its last ship said `SHIP PASS`; a talk has finished when it closed or he set it aside. On the first run, an item in Now that `--now` shows as claimed by another session counts too: it's likely still running from an earlier coordinator. When the cap is full, start nothing and wait for a session to finish.

If this session isn't in a worktree, enter one (EnterWorktree, named `coordinator`) before the roadmap change in step 5.

## 1. Pick the items

`git fetch origin`, then:

```
node scripts/roadmap-item.mjs --now
```

It prints every item in Now, settled or not, and whether it's free to start or what it waits on (Needs, a First item, another session's claim). An item is ready to start when no open pull request (`gh pr list`) is already about it, no session is on it, and:

- **`both`:** it's **free to start**, settled or not.
- **`build`:** it's free to start and settled.
- **`talk`:** it isn't settled. It may still wait on Needs: a talk doesn't need what the item builds on to be built.

If none is ready, and nothing in Now waits only on an item that's being built now, Now has run dry: go to step 5. In `talk` mode, go to the done items that aren't settled instead (step 4), and to step 5 only when those are gone too.

## 2. Start one session per item, up to the cap

Use the cap rule: start only as many as the cap leaves room for, in Now's order; the rest wait for step 4. For each one: a bold title line and one sentence, then `start_session` with `initiation` "user_asked", `use_worktree: true`, `context` "fresh", the item's name as `title`, and as `prompt` `/build-next <the item's exact name>`, or in `talk` mode:

```
/talk-through <the item's exact name>
```

Use the exact name, never a place in Now: places move as items land.

**Set each session's `effort` yourself**, from the item's row, its Needs and what it touches. Don't ask Julius.

- **`medium`, low stakes:** copy, docs, a page tweak, a small fix in one place, a talk about a small done item.
- **`high`, the default:** most items and talks.
- **`xhigh`, high stakes:** a First item or one much else builds on; migrations that change or delete data; money (Stripe, the buy sheet); safety, moderation and the 13+ rules; sign-in, player passes, API keys and the game sandbox; names in the API, SDK or game server that lock in once live.

A session can't go above this one's effort. If this session runs below `xhigh`, say so in a line when an item wants it. When a session turns out bigger or riskier than its row said (a talk settles more than expected, a build hits a migration), raise it with `set_session_effort`. `build-next` does the rest:

1. It claims the row.
2. If the item isn't settled, it prepares the talk's brief and waits for Julius.
3. It builds and opens the pull request.
4. It runs a preview on a free port when one's needed.
5. It merges once the branch is up to date, checked and OK'd.
6. It ships (a ship waits its turn behind another) and marks the row done.

Then tell Julius in one message which items are building, which are **waiting for a talk**, and which wait for room under the cap, each linked to its session. He talks in that session itself, not through this one.

## 3. Pass on what needs Julius

When a session ends a turn, read its note, and check its pull request before believing it.

- **A talk's brief, or a talk going on:** don't relay it. Remind Julius in a line, with the link, only when the session has been waiting for him and nothing else needs him.
- **A preview:** give Julius its links, under the item's name. Several at once go in one message, one item per block. Forward his answer to that session with `SendMessage`, quoting his words: an OK ("looks good", "ship it") or what to change.
- **A question** during a build about design or scope: ask Julius, with the session's options and its recommendation, and forward his answer quoted. If it needs more than one round, send him to the session instead.
- **`SHIP WAITING`:** a migration deletes data. The session has started `npm run ship` in a Terminal tab. Tell Julius which tab, and what the migration deletes.
- **Stuck or failed** (a check that won't pass, a conflict it can't settle, `SHIP FAIL`): say what's wrong in one line and what you'd do; don't fix it from here.

Never approve a preview or answer a design question on Julius's behalf.

## 4. Keep going

Each time a session finishes (see the cap rule), run step 1 again: an item that waited on it may be free now. Start ready ones as the cap rule allows, in Now's order.

**Talks about done items.** Done items built without being settled aren't checked off (`node scripts/roadmap-item.mjs --unsettled`). A talk about one is a `start_session` as in step 2, with `/talk-through <the item's exact name>` as the prompt. Pick the one that matters most first: the ones other work builds on, or the ones that would cost the most to change later. It counts against the cap like any session.

- **`both`:** keep one ready. Whenever no session is waiting for Julius to talk and the cap has room, start one, and tell him it's there with its link. He takes it when he has time; nothing waits on it.
- **`talk`:** once no unsettled item in Now is left to start, fill the cap with these.
- **`build`:** none.

## 5. When Now runs dry

Don't wait to be asked. Use the `whats-next` skill. It checks that the finished work is really done, looks for anything that has to go first, and proposes the next Now, saying which items are settled and which will start with a talk. Sessions still building carry on meanwhile.

Setting Now is Julius's call, so ask him the one question the skill ends with. On his yes, do the skill's last step (Now and the statuses together, pushed straight to main, then republish the roadmap page as CLAUDE.md says), then go back to step 1 and start the new items, in the same mode and under the same cap.

If he says no or wants changes, change the proposal and ask again. If he wants to stop, go to step 7.

## 6. Anything else Julius brings up

This is where he works, so take whatever he says here:

- **A new idea or item:** if it's real work, offer to start a session that talks it through (`/talk-through`), and add it to the roadmap only as that talk settles it. A passing thought goes in `docs/IDEAS.md` through that session or the next roadmap change.
- **A question** about Zaisma or where things stand: answer it here.
- **A fix he wants now:** its own session, like any item. It counts against the cap; when the cap is full, say so in a line and start it only if he says to.
- **A new cap or mode** ("make it 3", "switch to build"): use it from the next start on. Sessions already running carry on.

## 7. Finish

When Julius says to stop, or nothing is building and he has turned down a new Now, answer in a few lines:

- What went live, with each pull request.
- What's left and why: a talk still open, waiting on something, stuck.
- How many done items still aren't settled.

Each session republishes the roadmap page after its own push. This session republishes only after its own Now change.
