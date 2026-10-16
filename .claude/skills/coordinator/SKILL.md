---
name: coordinator
description: Julius's one place to work on Zaisma. Starts a build-next session for every free item in Now (settled items build straight away; unsettled ones open with a talk Julius joins in that session), brings him previews and questions, keeps starting items as others land, and runs whats-next when Now runs dry. Use when Julius says /coordinator, wants to work on Zaisma, build a batch, build what's in Now, or run the coordinator.
argument-hint: "[how many items, or their exact names; empty for every item that's free to start]"
---

# Coordinator

Julius starts one session with `/coordinator` and works from there. He shouldn't have to start one session, wait for it to ship, then start the next, or work out what comes after Now. He settles one item while others build. This session coordinates. It builds nothing. The only file it changes is the roadmap, when `whats-next` sets a new Now. Each item gets its own session running the `build-next` skill:

- A settled item is built, merged and shipped by itself (CLAUDE.md, "Merging").
- An unsettled item opens with the `talk-through` skill in its session. Once Julius settles it there, the same session builds it.

The argument is `$ARGUMENTS`: empty means every item that's free to start, a number means at most that many at once, names mean only those items.

If this session isn't in a worktree, enter one (EnterWorktree, named `coordinator`) before the roadmap change in step 5.

## 1. Pick the items

`git fetch origin`, then:

```
node scripts/roadmap-item.mjs --now
```

It prints every item in Now, settled or not, and whether it's free to start or what it waits on (Needs, a First item, another session's claim). An item is ready to start when it's **free to start** and no open pull request (`gh pr list`) is already about it, settled or not.

If none is ready, and nothing in Now waits only on an item that's being built now, Now has run dry: go to step 5.

## 2. Start one session per item

For each item, in Now's order: a bold title line and one sentence, then `start_session` with `initiation` "user_asked", `use_worktree: true`, `context` "fresh", the item's name as `title`, and as `prompt`:

```
/build-next <the item's exact name>
```

Use the exact name, never a place in Now: places move as items land. `build-next` does the rest:

1. It claims the row.
2. If the item isn't settled, it prepares the talk's brief and waits for Julius.
3. It builds and opens the pull request.
4. It runs a preview on a free port when one's needed.
5. It merges once the branch is up to date, checked and OK'd.
6. It ships (a ship waits its turn behind another) and marks the row done.

Then tell Julius in one message which items are building and which are **waiting for a talk**, each linked to its session. He talks in that session itself, not through this one.

## 3. Pass on what needs Julius

When a session ends a turn, read its note, and check its pull request before believing it.

- **A talk's brief, or a talk going on:** don't relay it. Remind Julius in a line, with the link, only when the session has been waiting for him and nothing else needs him.
- **A preview:** give Julius its links, under the item's name. Several at once go in one message, one item per block. Forward his answer to that session with `SendMessage`, quoting his words: an OK ("looks good", "ship it") or what to change.
- **A question** during a build about design or scope: ask Julius, with the session's options and its recommendation, and forward his answer quoted. If it needs more than one round, send him to the session instead.
- **`SHIP WAITING`:** a migration deletes data. The session has started `npm run ship` in a Terminal tab. Tell Julius which tab, and what the migration deletes.
- **Stuck or failed** (a check that won't pass, a conflict it can't settle, `SHIP FAIL`): say what's wrong in one line and what you'd do; don't fix it from here.

Never approve a preview or answer a design question on Julius's behalf.

## 4. Keep going

Each time a session finishes (its row is `done` on `origin/main` and its last ship said `SHIP PASS`), run step 1 again: an item that waited on it may be free now. Start any newly ready ones, unless the argument capped how many run at once.

## 5. When Now runs dry

Don't wait to be asked. Use the `whats-next` skill. It checks that the finished work is really done, looks for anything that has to go first, and proposes the next Now, saying which items are settled and which will start with a talk. Sessions still building carry on meanwhile.

Setting Now is Julius's call, so ask him the one question the skill ends with. On his yes, do the skill's last step (Now and the statuses together, pushed straight to main, then republish the roadmap page as CLAUDE.md says), then go back to step 1 and start the new items.

If he says no or wants changes, change the proposal and ask again. If he wants to stop, go to step 6.

## 6. Anything else Julius brings up

This is where he works, so take whatever he says here:

- **A new idea or item:** if it's real work, offer to start a session that talks it through (`/talk-through`), and add it to the roadmap only as that talk settles it. A passing thought goes in `docs/IDEAS.md` through that session or the next roadmap change.
- **A question** about Zaisma or where things stand: answer it here.
- **A fix he wants now:** its own session, like any item.

## 7. Finish

When Julius says to stop, or nothing is building and he has turned down a new Now, answer in a few lines:

- What went live, with each pull request.
- What's left and why: a talk still open, waiting on something, stuck.

Each session republishes the roadmap page after its own push. This session republishes only after its own Now change.
