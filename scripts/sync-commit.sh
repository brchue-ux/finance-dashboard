#!/usr/bin/env bash
# sync-commit.sh — Stop hook. Fires at EVERY turn end (not once per session);
# it is usually silent only because the tree is usually clean. Commits any
# uncommitted changes locally. Never pushes — the next SessionStart lists what's
# unpushed. Refuses to commit unless HEAD is on a real, non-default branch.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 0

[[ -z "$(git status --porcelain 2>/dev/null)" ]] && exit 0

refuse() {
  printf '{"systemMessage": %s}' "$(printf '%s' "$1" | jq -Rs .)"
  exit 0
}

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [[ -z "$BRANCH" || "$BRANCH" == "HEAD" ]]; then
  refuse "Uncommitted changes on a detached HEAD — auto-commit refused, because a commit here would be silently lost. Check out a real branch and commit deliberately."
fi

# Resolve the repository's default branch — never hardcode a name.
DEFAULT_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)
DEFAULT_BRANCH=${DEFAULT_BRANCH#origin/}
if [[ -z "$DEFAULT_BRANCH" ]]; then
  # Fallback: exactly one of the conventional default names exists locally.
  for CANDIDATE in main master trunk; do
    if git show-ref --verify --quiet "refs/heads/$CANDIDATE"; then
      if [[ -n "$DEFAULT_BRANCH" ]]; then
        DEFAULT_BRANCH=""   # ambiguous — treat as unresolvable
        break
      fi
      DEFAULT_BRANCH="$CANDIDATE"
    fi
  done
fi

if [[ -z "$DEFAULT_BRANCH" ]]; then
  refuse "Uncommitted changes, but this repository's default branch could not be resolved — auto-commit refused rather than guessing. Commit deliberately on a real branch."
fi

if [[ "$BRANCH" == "$DEFAULT_BRANCH" ]]; then
  refuse "Uncommitted changes on the default branch ($DEFAULT_BRANCH) — auto-commit refused. Move them to a real branch and make a real commit."
fi

git add -A
git commit -m "auto-commit: session end $(date '+%Y-%m-%d %H:%M')" --quiet

SUMMARY=$(git log -1 --format='%h %s')
printf '{"systemMessage": %s}' "$(printf 'Committed local changes (not pushed): %s' "$SUMMARY" | jq -Rs .)"
