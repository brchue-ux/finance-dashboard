#!/usr/bin/env bash
# sync-check.sh — SessionStart hook. Fetches origin, fast-forwards if the
# pull is clean, warns (never merges) on divergence, and lists any local
# commits still waiting to be pushed. Never pushes.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 0

git fetch origin --quiet 2>/dev/null

LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE=$(git rev-parse origin/main 2>/dev/null)
BASE=$(git merge-base HEAD origin/main 2>/dev/null)

[[ -z "$LOCAL" || -z "$REMOTE" ]] && exit 0

MSG=""

if [[ "$LOCAL" == "$REMOTE" ]]; then
  : # already in sync
elif [[ "$LOCAL" == "$BASE" ]]; then
  # origin is strictly ahead — clean fast-forward
  INCOMING=$(git log --format='  %h %s' "HEAD..origin/main")
  if git merge --ff-only origin/main --quiet 2>/dev/null; then
    MSG+="Pulled from origin/main:
${INCOMING}
"
  else
    MSG+="origin/main has new commits but fast-forward failed — check manually.
"
  fi
elif [[ "$REMOTE" == "$BASE" ]]; then
  : # local is strictly ahead — surfaced by the unpushed-commits check below
else
  MSG+="⚠ DIVERGED from origin/main — local and remote each have commits the other lacks. Not auto-merging; resolve manually (git log HEAD..origin/main and git log origin/main..HEAD).
"
fi

UNPUSHED=$(git log --format='  %h %s' origin/main..HEAD 2>/dev/null)
if [[ -n "$UNPUSHED" ]]; then
  MSG+="Unpushed local commits (not pushed automatically):
${UNPUSHED}
"
fi

if [[ -n "$MSG" ]]; then
  printf '{"systemMessage": %s}' "$(printf '%s' "$MSG" | jq -Rs .)"
fi
