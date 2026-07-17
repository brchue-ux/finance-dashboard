# sync-commit.ps1 — Stop hook. Commits any uncommitted changes locally at
# session end. Never pushes — the next SessionStart lists what's unpushed.
$ErrorActionPreference = 'SilentlyContinue'
Set-Location (Join-Path $PSScriptRoot '..')

$Status = git status --porcelain
if (-not $Status) { exit 0 }

git add -A
$Timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
git commit -m "auto-commit: session end $Timestamp" --quiet

$Summary = git log -1 --format="%h %s"
$Json = @{ systemMessage = "Committed local changes (not pushed): $Summary" } | ConvertTo-Json -Compress
Write-Output $Json
