# sync-commit.ps1 — Stop hook. Fires at EVERY turn end (not once per session);
# it is usually silent only because the tree is usually clean. Commits any
# uncommitted changes locally. Never pushes — the next SessionStart lists what's
# unpushed. Refuses to commit unless HEAD is on a real, non-default branch.
$ErrorActionPreference = 'SilentlyContinue'
Set-Location (Join-Path $PSScriptRoot '..')

$Status = git status --porcelain
if (-not $Status) { exit 0 }

function Write-Refusal($Message) {
    Write-Output (@{ systemMessage = $Message } | ConvertTo-Json -Compress)
    exit 0
}

$Branch = (git rev-parse --abbrev-ref HEAD) | Select-Object -First 1
if (-not $Branch -or $Branch -eq 'HEAD') {
    Write-Refusal "Uncommitted changes on a detached HEAD — auto-commit refused, because a commit here would be silently lost. Check out a real branch and commit deliberately."
}

# Resolve the repository's default branch — never hardcode a name.
$DefaultBranch = (git symbolic-ref --short refs/remotes/origin/HEAD) | Select-Object -First 1
if ($DefaultBranch) { $DefaultBranch = $DefaultBranch -replace '^origin/', '' }
if (-not $DefaultBranch) {
    # Fallback: exactly one of the conventional default names exists locally.
    foreach ($Candidate in @('main', 'master', 'trunk')) {
        git show-ref --verify --quiet "refs/heads/$Candidate"
        if ($LASTEXITCODE -eq 0) {
            if ($DefaultBranch) {
                $DefaultBranch = ''   # ambiguous — treat as unresolvable
                break
            }
            $DefaultBranch = $Candidate
        }
    }
}

if (-not $DefaultBranch) {
    Write-Refusal "Uncommitted changes, but this repository's default branch could not be resolved — auto-commit refused rather than guessing. Commit deliberately on a real branch."
}

if ($Branch -eq $DefaultBranch) {
    Write-Refusal "Uncommitted changes on the default branch ($DefaultBranch) — auto-commit refused. Move them to a real branch and make a real commit."
}

git add -A
$Timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
git commit -m "auto-commit: session end $Timestamp" --quiet

$Summary = git log -1 --format="%h %s"
$Json = @{ systemMessage = "Committed local changes (not pushed): $Summary" } | ConvertTo-Json -Compress
Write-Output $Json
