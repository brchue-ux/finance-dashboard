# sync-check.ps1 — SessionStart hook. Fetches origin, fast-forwards if the
# pull is clean, warns (never merges) on divergence, and lists any local
# commits still waiting to be pushed. Never pushes.
$ErrorActionPreference = 'SilentlyContinue'
Set-Location (Join-Path $PSScriptRoot '..')

git fetch origin --quiet 2>$null

$Local = git rev-parse HEAD
$Remote = git rev-parse origin/main
$Base = git merge-base HEAD origin/main

if (-not $Local -or -not $Remote) { exit 0 }

$Msg = ""

if ($Local -eq $Remote) {
    # already in sync
}
elseif ($Local -eq $Base) {
    # origin is strictly ahead — clean fast-forward
    $Incoming = git log --format="  %h %s" "HEAD..origin/main"
    git merge --ff-only origin/main --quiet 2>$null
    if ($LASTEXITCODE -eq 0) {
        $Msg += "Pulled from origin/main:`n$Incoming`n"
    } else {
        $Msg += "origin/main has new commits but fast-forward failed — check manually.`n"
    }
}
elseif ($Remote -eq $Base) {
    # local is strictly ahead — surfaced by the unpushed-commits check below
}
else {
    $Msg += "DIVERGED from origin/main - local and remote each have commits the other lacks. Not auto-merging; resolve manually (git log HEAD..origin/main and git log origin/main..HEAD).`n"
}

$Unpushed = git log --format="  %h %s" origin/main..HEAD
if ($Unpushed) {
    $Msg += "Unpushed local commits (not pushed automatically):`n$Unpushed`n"
}

if ($Msg) {
    $Json = @{ systemMessage = $Msg } | ConvertTo-Json -Compress
    Write-Output $Json
}
