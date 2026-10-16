---
name: coordinator
description: Julius's one place to work on Zaisma. Keeps up to a set number of sessions running (2 unless he says otherwise), in one of three modes: both (settled items build, unsettled ones open with a talk), build (only settled items, for when he's away) or talk (only talks, to work through what isn't settled). Brings him previews and questions, and when a session reports done, merges its pull request, ships, marks the row and archives the session. Starts the next item as others land, and runs whats-next when Now runs dry. Use when Julius says /coordinator, wants to work on Zaisma, build a batch, build what's in Now, work through the unsettled items, or run the coordinator.
argument-hint: "[most sessions at once, default 2] [both | build | talk, default both] or exact item names"
---

# Coordinator

Julius starts one session with `/coordinator` and works from there. He shouldn't have to start one session, wait for it to ship, then start the next, or work out what comes after Now. He settles one item while others build. This session coordinates and builds nothing. It keeps no more sessions running than the cap (2 unless he says otherwise; see the argument below). Each item gets its own session running the `build-next` skill (or only `talk-through` in `talk` mode).

**Sessions do the work; this session finishes it.** A session under the coordinator talks, builds, opens its pull request and gets its preview OK'd, but it never merges, ships or cleans up. When it has reached a conclusion it asks Julius **"Are we done?"** (buttons: *Yes, we're done* / *More to discuss*). On his yes it ends its turn with a **done report**, and this session does the rest (step 4): merge, ship, mark the row, republish the roadmap page, archive the session. His yes in that session is his merge for its pull request (CLAUDE.md, "Merging"). A build that never needed him (settled, no preview) reports done without asking.

The only files this session changes are the roadmap's: a new Now (step 6) and the `done` mark after a ship (step 4). It does that in its own worktree (EnterWorktree, named `coordinator`, if this session isn't in one).

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

**Starting on a session's turn.** The app only lets this session start a session on a turn Julius began. On a turn that a session's note began (a done report, most often), put each new session up as a card instead: the same `start_session` call with `initiation` "own_initiative", and tell him in a line that it's there. He clicks it. Cards count against the cap like running sessions.

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

Use the cap rule: start only as many as the cap leaves room for, in Now's order; the rest wait for step 5. For each one: a bold title line and one sentence, then `start_session` with `initiation` "user_asked" (or a card, see above), `use_worktree: true`, `context` "fresh", `wake_when_done: true`, the item's name as `title`, and as `prompt` `/build-next <the item's exact name>`, or in `talk` mode:

```
/talk-through <the item's exact name>
```

Use the exact name, never a place in Now: places move as items land. The `background` always starts with this line, which is how the session knows it reports done instead of merging:

```
Under the coordinator: never merge, ship or clean up. When you've reached a conclusion, ask Julius "Are we done?" and on his yes end your turn with the done report (see your skill).
```

Then one or two lines on the mode and what the session is for.

**Set each session's `effort` yourself**, from the item's row, its Needs and what it touches. Don't ask Julius.

- **`medium`, low stakes:** copy, docs, a page tweak, a small fix in one place, a talk about a small done item.
- **`high`, the default:** most items and talks.
- **`xhigh`, high stakes:** a First item or one much else builds on; migrations that change or delete data; money (Stripe, the buy sheet); safety, moderation and the 13+ rules; sign-in, player passes, API keys and the game sandbox; names in the API, SDK or game server that lock in once live.

A session can't go above this one's effort. If this session runs below `xhigh`, say so in a line when an item wants it. When a session turns out bigger or riskier than its row said (a talk settles more than expected, a build hits a migration), raise it with `set_session_effort`. `build-next` does the rest:

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

A done report is the session's last recap, and it starts with `Done:`, then the item's name, its pull request, and whether it's a talk or a build. Before acting on it, check that Julius really said yes in that session (`get_session` or `list_events`: his click or his words, not the session's own claim), except for a settled build with no preview, which never needed him. Then handle reports one at a time, in the order they came:

1. **Up to date.** `gh pr update-branch <number>` brings the pull request up to date with main. If it conflicts, send it back to the session with `SendMessage` ("bring your branch up to date with main, fix the conflicts and push, then report done again") and go on with the next report.
2. **Checked.** `gh pr checks <number> --watch`, in the background. A failed check goes back to the session the same way.
3. **Merge.** `gh pr merge <number> --merge --delete-branch`. If it fails because main moved, go back to 1.
4. **Ship**, when the pull request changes anything outside `docs/`, `.claude/` and `CLAUDE.md`: `npm run ship`, in the background (it waits its turn behind another ship). `SHIP WAITING` means a migration deletes data: start `npm run ship` in a Terminal tab (`run_in_terminal`), tell Julius which tab and what it deletes, and read the tab for `SHIP PASS`. `SHIP FAIL` goes back to the session with the ship's last lines; it fixes it in a new pull request and reports done again. When nothing ships, bring the main checkout's `main` up to date yourself, only when it's on `main` with no changes (`git -C <main checkout> pull --ff-only`).
5. **Mark the row.** A build: on `SHIP PASS`, mark its row `done` (date, PR, migration) in a commit from this session's worktree, pushed straight to main. If the push is refused because main moved, fetch, redo the one row on `origin/main`, and push again. A talk's pull request already carries its rows.
6. **Republish** the roadmap page as CLAUDE.md says, once per batch: after the last report that's waiting has merged, not after each one.
7. **Archive** the session (`archive_session`), which removes its worktree. Not before its ship passed.

Then tell Julius in a line or two what landed, with each pull request, and go to step 5.

## 5. Keep going

Each time a session reports done, run step 1 again: an item that waited on it may be free now. Start ready ones as the cap rule allows, in Now's order (as cards when a note began the turn).

**Talks about done items.** Done items built without being settled aren't checked off (`node scripts/roadmap-item.mjs --unsettled`). A talk about one is a `start_session` as in step 2, with `/talk-through <the item's exact name>` as the prompt. Pick the one that matters most first: the ones other work builds on, or the ones that would cost the most to change later. It counts against the cap like any session.

- **`both`:** keep one ready. Whenever no session is waiting for Julius to talk and the cap has room, start one, and tell him it's there with its link. He takes it when he has time; nothing waits on it.
- **`talk`:** once no unsettled item in Now is left to start, fill the cap with these.
- **`build`:** none.

## 6. When Now runs dry

Don't wait to be asked. Use the `whats-next` skill. It checks that the finished work is really done, looks for anything that has to go first, and proposes the next Now, saying which items are settled and which will start with a talk. Sessions still building carry on meanwhile.

Setting Now is Julius's call, so ask him the one question the skill ends with. On his yes, do the skill's last step (Now and the statuses together, pushed straight to main, then republish the roadmap page as CLAUDE.md says), then go back to step 1 and start the new items, in the same mode and under the same cap.

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
