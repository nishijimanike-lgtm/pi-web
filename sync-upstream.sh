#!/usr/bin/env bash
set -e

echo -e "\n====> [1/5] Checking environment and working tree..."
if ! git remote | grep -q "^upstream$"; then
  echo "Error: Remote 'upstream' not found. Run: git remote add upstream https://github.com/agegr/pi-web.git"
  exit 1
fi

CURRENT_BRANCH=$(git branch --show-current)
if [ -z "$CURRENT_BRANCH" ]; then
  echo "Error: Detached HEAD state. Please switch to a branch first."
  exit 1
fi

HAS_STASH=0
if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is dirty. Saving changes to stash..."
  git stash push -u -m "auto-stash-before-sync-$(date +%Y%m%d%H%M%S)"
  HAS_STASH=1
fi

echo -e "\n====> [2/5] Fetching upstream updates..."
git fetch upstream --prune --tags

echo -e "\n====> [3/5] Updating local upstream-main mirror branch..."
if git branch --format="%(refname:short)" | grep -q "^upstream-main$"; then
  git checkout upstream-main
  git merge upstream/main --ff-only
else
  git checkout -b upstream-main upstream/main
fi

git push origin upstream-main || true

echo -e "\n====> [4/5] Merging into $CURRENT_BRANCH..."
git checkout "$CURRENT_BRANCH"
if ! git merge upstream-main -m "chore: merge upstream changes from upstream-main"; then
  echo "Error: Conflicts detected during merge. Please resolve conflicts, commit, and then run 'git stash pop' if needed."
  exit 1
fi

echo -e "\n====> [5/5] Running TypeScript check..."
if [ -f "node_modules/.bin/tsc" ]; then
  node_modules/.bin/tsc --noEmit || echo "Warning: TypeCheck reported issues."
fi

if [ "$HAS_STASH" -eq 1 ]; then
  echo "Restoring stashed changes..."
  git stash pop
fi

echo -e "\n[√] Synchronization completed successfully!"
