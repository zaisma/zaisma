---
name: build-batch
description: Build every settled item in Zaisma's Now list at once, one session each, and see them through to live without Julius running each one. Starts a session per item that's settled and free to start, passes Julius only their previews and questions, and keeps going until the batch is live. Use when Julius says to build a batch, build what's settled, or run the coordinator.
argument-hint: "[how many items, or their exact names; empty for every one that's ready]"
---

# Build a batch

Julius uses this so he doesn't have to start one session, wait for it to ship, then start the next. This session coordinates; it builds nothing and changes no file itself. Each item is built by its own session running the `build-next` skill, which merges and ships settled items by itself (CLAUDE.md, "Merging"). Julius only answers previews and questions, and this session brings them to him in one place.

The argument is `$ARGUMENTS`: empty means every item that's ready, a number means at most that many, names mean those items.

## 1. Pick the items

`git fetch origin`, then:

```
node scripts/roadmap-item.mjs --now
```

It prints every item in Now, settled or not, and whether it's free to start or what it waits on (Needs, a First item, another session's claim). An item is in the batch when it's **settled** and **free to start**, and no open pull request (`gh pr list`) is already about it.

Items that aren't settled stay out. Name them to Julius in one line, each with the command for its talk in his own session (`/talk-through <name>`); never start one. If nothing is ready, say why in a line or two and stop.

## 2. Start one session per item

For each item, in Now's order: a bold title line and one sentence, then `start_session` with `initiation` "user_asked", `use_worktree: true`, `context` "fresh", the item's name as `title`, and as `prompt`:

```
/build-next <the item's exact name>
```

The exact name, never a place in Now: places move as items land. `build-next` does the rest: it claims the row, builds, opens the pull request, runs a preview on a free port when one's needed, merges once it's up to date, checked and OK'd, ships (a ship waits its turn behind another), and marks the row done.

## 3. Pass on what needs Julius

When a session ends a turn, read its note, and check its pull request before believing it.

- **A preview:** give Julius its links, under the item's name. Several at once go in one message, one item per block. Forward his answer to that session with `SendMessage`, quoting his words: an OK ("looks good", "ship it") or what to change.
- **A question** about design or scope: ask Julius, with the session's options and its recommendation, and forward his answer quoted.
- **`SHIP WAITING`:** a migration deletes data. The session has started `npm run ship` in a Terminal tab. Tell Julius which tab, and what the migration deletes.
- **Stuck or failed** (a check that won't pass, a conflict it can't settle, `SHIP FAIL`): say what's wrong in one line and what you'd do; don't fix it from here.

Never approve a preview or answer a design question on Julius's behalf.

## 4. Keep going

Each time a session finishes (its row is `done` on `origin/main` and its last ship said `SHIP PASS`), run step 1 again: an item that waited on it may be free now. Start any newly ready ones, unless the argument capped the batch.

## 5. Finish

When every session is done or stopped, answer in a few lines:

- What went live, with each pull request.
- What's left and why: not settled, waiting on something, stuck.
- Then `/whats-next` if Now is empty.

Each session republishes the roadmap page after its own push, so this session doesn't.
