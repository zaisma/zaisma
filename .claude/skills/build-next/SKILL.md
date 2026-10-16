---
name: build-next
description: Start building a Zaisma roadmap item. With no argument it takes the first item in Now (docs/ROADMAP.md); a number takes that place in Now, and a name takes that item. Use when Julius says to build, start or do the next item, or names one.
argument-hint: "[place in Now, or an item's exact name]"
---

# Build the next item

Julius invokes this instead of explaining which item he means, often in several sessions at once. The argument is `$ARGUMENTS`: empty means the first item in Now that's free to start (not done, not started, not claimed by another session and not waiting on a First item), a number means that place in Now, anything else is an item's exact name.

## 1. A worktree first

If this session isn't in a worktree, enter one (EnterWorktree, named after the item once step 2 has found it) before changing any file. Other sessions work in parallel, and the main checkout is the one `npm run ship` pulls.

## 2. Find the item

`git fetch origin`, then:

```
node scripts/roadmap-item.mjs $ARGUMENTS
```

It reads `docs/ROADMAP.md` from `origin/main` and prints the item, its place in Now (First or Next), its project's goal and "Done when", whether each of its Needs is done, its notes and the project's other rows. It also reads the roadmap in every other worktree, so an item another session has marked `doing` shows as claimed. Don't search the roadmap by hand. If it says Now is empty, stop and suggest `/whats-next`. If it says no item has that name, show Julius the close names it lists and ask which one.

When it ends with **Waits** (exit code 2), stop and tell Julius in one line what it waits on, before any work. That covers:

- a Need isn't done,
- a **First** item isn't done: one in Now holds every other item, and one in the item's project holds that project's other rows,
- another session has marked it `doing` in its worktree.

Also stop when:

- the row is already `doing`, or an open pull request (`gh pr list`) or a recent commit on `origin/main` is already about it,
- the item is waiting on Julius or Gleb (its name starts with theirs).

Otherwise claim it at once: mark the row `doing` in `docs/ROADMAP.md` in your worktree as your first edit, before reading further. Other sessions running this skill read it there and pick another item. Sessions started in the same moment can race for the same free item, so when starting several at once, give each a place in Now or a name.

## 3. Read what it touches

- The decisions behind it in `docs/DECISIONS.md`: "The direction" always, and the sections its notes name or that are about the same thing.
- `docs/NAMING.md` for every name it adds, and the "Adding a building block" checklist in `CLAUDE.md` for where its pieces go.
- The code it builds on. Delegate wide searches; read the files you'll change.

## 4. Size it

One row is one slice that lands on its own. If the item is too big for one pull request, propose the slices to Julius first, each with a name (no commas) to become its own row in the same project, and build the first one. Anything that changes pricing, positioning, who we serve or what we claim, or that a decision doesn't settle, goes to Julius as a short summary of exactly what would change before you build it.

## 5. Build

- The row is already `doing` from step 2; it ships in the same change, per CLAUDE.md's roadmap rules.
- Follow `CLAUDE.md`: the building-block checklist, the rules for code, preview before live for large or important UI (`npm run preview`, with direct links for Julius).
- `npm test` and `npm run typecheck` pass before the pull request; the pull request check runs them too.
- Open the pull request and stop there: merging is Julius's call. After he merges, `npm run ship`, then mark the row `done` (date, PR, migration) and republish the roadmap page as CLAUDE.md says.
