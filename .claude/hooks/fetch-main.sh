#!/bin/sh
# At the start of a Claude Code session: fetch origin and say whether this checkout is behind
# origin/main, and which pull requests are open. Other sessions merge and deploy in parallel, so a
# stale main makes docs/ROADMAP.md look like work is still to do when it has already shipped.
# Prints a few lines for Claude to read; never changes the working tree.

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

if ! GIT_TERMINAL_PROMPT=0 git fetch --quiet origin main 2>/dev/null; then
  echo "Couldn't fetch origin. Before reading docs/ROADMAP.md or picking work, run: git fetch origin && git status"
  exit 0
fi

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
newest=$(git log -1 --format='%h %s' origin/main 2>/dev/null)

if [ "$behind" -gt 0 ]; then
  if [ "$branch" = "main" ]; then
    echo "This checkout's main is $behind commit(s) behind origin/main (newest: $newest). Run git pull --ff-only before reading docs/ROADMAP.md or picking work: other sessions merge and deploy in parallel."
  else
    echo "Branch $branch is $behind commit(s) behind origin/main (newest: $newest). Read the roadmap from origin/main (git show origin/main:docs/ROADMAP.md) and bring the branch up to date before building on it."
  fi
else
  echo "Fetched origin: $branch has everything on origin/main (newest: $newest)."
fi

# Work other sessions have in review, so nobody starts the same item twice.
if command -v gh >/dev/null 2>&1; then
  open=$(gh pr list --state open --limit 10 --json number,title,headRefName --jq '.[] | "#\(.number) \(.title) (\(.headRefName))"' 2>/dev/null)
  if [ -n "$open" ]; then
    echo "Open pull requests (check none is the item you're about to start):"
    echo "$open"
  fi
fi
exit 0
