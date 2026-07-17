#!/usr/bin/env bash
# sync-commit.sh — Stop hook. Commits any uncommitted changes locally at
# session end. Never pushes — the next SessionStart lists what's unpushed.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 0

[[ -z "$(git status --porcelain 2>/dev/null)" ]] && exit 0

git add -A
git commit -m "auto-commit: session end $(date '+%Y-%m-%d %H:%M')" --quiet

SUMMARY=$(git log -1 --format='%h %s')
printf '{"systemMessage": %s}' "$(printf 'Committed local changes (not pushed): %s' "$SUMMARY" | jq -Rs .)"
