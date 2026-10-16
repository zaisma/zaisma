---
name: build-batch
description: Build Zaisma's Now list as a batch, one session per item, and see each through to live without Julius running them one by one. Settled items build straight away; unsettled ones start with a talk in their own session, which Julius opens while the others build. Passes Julius previews and questions in one place and starts items as they become free. Use when Julius says to build a batch, build what's in Now, or run the coordinator.
argument-hint: "[how many items, or their exact names; empty for every item that's free to start]"
---

# Build a batch

Julius uses this so he doesn't have to start one session, wait for it to ship, then start the next, and so he can settle one item while others build. This session coordinates; it builds nothing and changes no file itself. Each item gets its own session running the `build-next` skill. A settled item is built, merged and shipped by itself (CLAUDE.md, "Merging"). An unsettled one starts with the `talk-through` skill in that session, and once Julius settles it there, the same session builds it.

The argument is `$ARGUMENTS`: empty means every item that's free to start, a number means at most that many, names mean those items.

## 1. Pick the items

`git fetch origin`, then:

```
node scripts/roadmap-item.mjs --now
```

It prints every item in Now, settled or not, and whether it's free to start or what it waits on (Needs, a First item, another session's claim). An item is in the batch when it's **free to start** and no open pull request (`gh pr list`) is already about it, settled or not. If nothing is free, say why in a line or two and stop.

## 2. Start one session per item

For each item, in Now's order: a bold title line and one sentence, then `start_session` with `initiation` "user_asked", `use_worktree: true`, `context` "fresh", the item's name as `title`, and as `prompt`:

```
/build-next <the item's exact name>
```

The exact name, never a place in Now: places move as items land. `build-next` does the rest. It claims the row. If the item isn't settled, it prepares the talk's brief and waits for Julius. Then it builds, opens the pull request, runs a preview on a free port when one's needed, merges once it's up to date, checked and OK'd, ships (a ship waits its turn behind another), and marks the row done.

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

Each time a session finishes (its row is `done` on `origin/main` and its last ship said `SHIP PASS`), run step 1 again: an item that waited on it may be free now. Start any newly free ones, unless the argument capped the batch.

## 5. Finish

When every session is done or stopped, answer in a few lines:

- What went live, with each pull request.
- What's left and why: a talk still open, waiting on something, stuck.
- Then `/whats-next` if Now is empty.

Each session republishes the roadmap page after its own push, so this session doesn't.
