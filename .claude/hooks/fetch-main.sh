#!/bin/sh
# At the start of a Claude Code session: fetch origin and say whether this checkout is behind
# origin/main, and which pull requests are open. Other sessions merge and deploy in parallel, so a
# stale main makes work look still to do when it has already shipped.
# On a machine with the private ops repo (~/zaisma-private/ops, see scripts/ops-setup.mjs), also pull
# it and keep its skills linked into this checkout. Without it, that part is skipped silently.
# Prints a few lines for Claude to read; never changes tracked files.

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

ops_dir="${ZAISMA_OPS_DIR:-$HOME/zaisma-private/ops}"
if [ -f "$ops_dir/scripts/ops.mjs" ] && command -v node >/dev/null 2>&1; then
  ops_clone=$(node "$ops_dir/scripts/ops.mjs" pull 2>&1 | sed -n 's/^clone: //p')
  if [ -n "$ops_clone" ]; then
    echo "Ops ($ops_dir): $ops_clone."
  else
    echo "Ops ($ops_dir): the pull failed. Run node $ops_dir/scripts/ops.mjs pull to see why."
  fi
  [ -f scripts/ops-setup.mjs ] && node scripts/ops-setup.mjs --links 2>/dev/null
fi

if ! GIT_TERMINAL_PROMPT=0 git fetch --quiet origin main 2>/dev/null; then
  echo "Couldn't fetch origin. Before picking work, run: git fetch origin && git status"
  exit 0
fi

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
newest=$(git log -1 --format='%h %s' origin/main 2>/dev/null)

if [ "$behind" -gt 0 ]; then
  if [ "$branch" = "main" ]; then
    echo "This checkout's main is $behind commit(s) behind origin/main (newest: $newest). Run git pull --ff-only before picking work: other sessions merge and deploy in parallel."
  else
    echo "Branch $branch is $behind commit(s) behind origin/main (newest: $newest). Bring the branch up to date before building on it."
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
