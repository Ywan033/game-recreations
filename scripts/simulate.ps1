# Local simulation of the launcher. Uses a throwaway sandbox repo and a mock
# generator; never calls the model and never touches GitHub. ASCII-only.
param([string]$SandboxRoot = '')

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$projects = Split-Path -Parent $repo
if (-not $SandboxRoot) {
    $SandboxRoot = Join-Path $projects ('game-recreations-cache\sim\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
$sim = $SandboxRoot
$simRepo = Join-Path $sim 'repo'
$simTrees = Join-Path $sim 'trees'
$simCache = Join-Path $sim 'cache'
$simDeliv = Join-Path $sim 'deliveries'
$checks = Join-Path $sim 'checks'
$utf8 = New-Object System.Text.UTF8Encoding $false
New-Item -ItemType Directory -Force -Path $simRepo, $simTrees, $simCache, $simDeliv, $checks | Out-Null
$results = @()

function Check {
    param([string]$Name, [bool]$Ok)
    $script:results += New-Object psobject -Property @{ Name = $Name; Ok = $Ok }
    Write-Host ("  [{0}] {1}" -f $(if ($Ok) { 'PASS' } else { 'FAIL' }), $Name)
}

function G {
    param([string]$Dir, [string[]]$A)
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = & git -C $Dir @A 2>&1 | ForEach-Object { "$_" }; $c = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
    if ($c -ne 0) { throw "git $($A -join ' ') failed: $($o -join ' ')" }
    return @($o)
}

# --- sandbox repo with two fake games ---
G $simRepo @('init', '-q', '-b', 'main') | Out-Null
G $simRepo @('config', 'user.name', 'Sim User') | Out-Null
G $simRepo @('config', 'user.email', 'sim@example.invalid') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $simRepo 'tasks'), (Join-Path $simRepo 'scripts') | Out-Null
Copy-Item (Join-Path $repo 'scripts\run-games.ps1'), (Join-Path $repo 'scripts\progress-labels.json') (Join-Path $simRepo 'scripts')
Copy-Item (Join-Path $repo '.gitignore') $simRepo
[IO.File]::WriteAllText((Join-Path $simRepo 'CLAUDE.md'), "MARK_SHARED rules`n", $utf8)
[IO.File]::WriteAllText((Join-Path $simRepo 'PROGRESS.md'), "placeholder`n", $utf8)
$queue = '[{"id":"sim-alpha","branch":"game/sim-alpha","title":"Alpha","titleEn":"Sim Alpha","delivery":"alpha-out.html","budgetUsd":2},' +
         '{"id":"sim-beta","branch":"game/sim-beta","title":"Beta","titleEn":"Sim Beta","delivery":"beta-out.html","budgetUsd":2}]'
[IO.File]::WriteAllText((Join-Path $simRepo 'tasks\queue.json'), $queue, $utf8)
foreach ($id in 'sim-alpha', 'sim-beta') {
    [IO.File]::WriteAllText((Join-Path $simRepo "tasks\$id.md"), "MARK_TASK_$id brief`n", $utf8)
}
G $simRepo @('add', '-A') | Out-Null
G $simRepo @('commit', '-q', '-m', 'sim setup') | Out-Null
foreach ($id in 'sim-alpha', 'sim-beta') {
    G $simRepo @('worktree', 'add', '-q', '-b', "game/$id", (Join-Path $simTrees $id)) | Out-Null
    $g = Join-Path $simTrees "$id\games\$id"
    New-Item -ItemType Directory -Force -Path $g | Out-Null
    [IO.File]::WriteAllText((Join-Path $g 'CLAUDE.md'), "MARK_GAME_$id rules`n", $utf8)
}

# --- mock generator: checks the prompt, writes a tiny buildable package ---
$mock = Join-Path $sim 'mock-generator.ps1'
$mockBody = @'
param([string]$Id, [string]$GameDir, [string]$PromptFile)
$checks = '__CHECKS__'
$utf8 = New-Object System.Text.UTF8Encoding $false
$stdin = [Console]::In.ReadToEnd()
$prompt = $stdin   # the prompt arrives on stdin exactly as it does for the real CLI
$count = @(Get-ChildItem $checks -Filter "$Id.call-*.txt").Count + 1
$ok = $prompt.Contains('MARK_SHARED') -and $prompt.Contains("MARK_TASK_$Id") -and $prompt.Contains("MARK_GAME_$Id") -and $stdin.Contains("MARK_TASK_$Id")
$mode = if ($prompt.Contains('Continue the existing work')) { 'continue' } else { 'generate' }
[IO.File]::WriteAllText((Join-Path $checks "$Id.call-$count.txt"), "promptOk=$ok mode=$mode", $utf8)
# sim-beta fails its offline test on the first call and is fixed on the second.
$testCmd = 'node -e "process.exit(0)"'
if ($Id -eq 'sim-beta' -and $count -eq 1) { $testCmd = 'node -e "process.exit(1)"' }
$pkg = @{ name = $Id; version = '1.0.0'; private = $true; scripts = @{
    build = 'node build.js'; 'install:browsers' = 'node -e "process.exit(0)"'; 'test:offline' = $testCmd } }
[IO.File]::WriteAllText((Join-Path $GameDir 'package.json'), ($pkg | ConvertTo-Json -Depth 5), $utf8)
$lock = '{"name":"' + $Id + '","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"' + $Id + '","version":"1.0.0"}}}'
[IO.File]::WriteAllText((Join-Path $GameDir 'package-lock.json'), $lock, $utf8)
[IO.File]::WriteAllText((Join-Path $GameDir 'build.js'), "const fs=require('fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/play.html','<!doctype html><title>$Id</title>call $count');", $utf8)
[IO.File]::WriteAllText((Join-Path $GameDir 'DELIVERY.md'), "# $Id simulated delivery`n", $utf8)
Write-Output '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0.25,"result":"mock done"}'
'@
[IO.File]::WriteAllText($mock, $mockBody.Replace('__CHECKS__', $checks), $utf8)

$launcher = Join-Path $simRepo 'scripts\run-games.ps1'
$common = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $launcher,
    '-RepoRoot', $simRepo, '-TreesRoot', $simTrees, '-CacheRoot', $simCache,
    '-DeliveriesRoot', $simDeliv, '-GeneratorScript', $mock)

function Run-Launcher {
    param([string[]]$Extra, [string]$Tag)
    $log = Join-Path $sim "$Tag.out.log"
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & powershell.exe @common @Extra *> $log; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
    return New-Object psobject -Property @{ Code = $code; Text = (Get-Content $log -Raw) }
}
function State { param([string]$Id) return (Get-Content (Join-Path $simCache "state\$Id.json") -Raw | ConvertFrom-Json) }

Write-Host "Sandbox: $sim"
Write-Host 'Precheck (no -Run):'
$r = Run-Launcher @() 'precheck'
Check 'precheck exits 0 and parses both queue entries' ($r.Code -eq 0 -and $r.Text -match 'sim-alpha' -and $r.Text -match 'sim-beta' -and $r.Text -match 'PRECHECK READY')
Check 'precheck reports per-game budget from queue.json' ($r.Text -match 'budget \$2\.00')
Check 'precheck does not generate' (@(Get-ChildItem $checks).Count -eq 0)

Write-Host 'Run 1 (no origin, notification forced to fail, no repairs):'
$r = Run-Launcher @('-Run', '-NotifyMode', 'fail', '-MaxRepairs', '0') 'run1'
Check 'run 1 exits non-zero because one game failed' ($r.Code -eq 1)
Check 'alpha delivered under its delivery name' (Test-Path (Join-Path $simDeliv 'alpha-out.html'))
Check 'beta not delivered after failed offline test' (-not (Test-Path (Join-Path $simDeliv 'beta-out.html')))
Check 'queue continued to beta after alpha' (Test-Path (Join-Path $checks 'sim-beta.call-1.txt'))
Check 'prompt carried shared rules, brief, and game rules (alpha)' ((Get-Content (Join-Path $checks 'sim-alpha.call-1.txt') -Raw) -match 'promptOk=True mode=generate')
Check 'prompt carried shared rules, brief, and game rules (beta)' ((Get-Content (Join-Path $checks 'sim-beta.call-1.txt') -Raw) -match 'promptOk=True')
Check 'notification fell back to terminal/log' ($r.Text -match 'NOTIFY-FALLBACK\] Alpha \(Sim Alpha\) delivered')
Check 'alpha committed locally with push pending' ((State 'sim-alpha').push -eq 'pending' -and (State 'sim-alpha').commit)
Check 'beta state is failed, cost recorded' ((State 'sim-beta').status -eq 'failed' -and [double](State 'sim-beta').spent -eq 0.25)
$progress = Get-Content (Join-Path $simRepo 'PROGRESS.md') -Raw -Encoding UTF8
Check 'PROGRESS.md lists both games' ($progress -match 'Sim Alpha' -and $progress -match 'Sim Beta' -and $progress -match 'alpha-out\.html')

Write-Host 'Run 2 (local bare origin added, repairs allowed):'
$bare = Join-Path $sim 'origin.git'
G $sim @('init', '-q', '--bare', $bare) | Out-Null
G $simRepo @('remote', 'add', 'origin', $bare) | Out-Null
$r = Run-Launcher @('-Run', '-NotifyMode', 'log') 'run2'
Check 'run 2 exits 0' ($r.Code -eq 0)
Check 'alpha generation skipped on rerun' ($r.Text -match 'SKIP\] sim-alpha' -and @(Get-ChildItem $checks -Filter 'sim-alpha.call-*.txt').Count -eq 1)
Check 'alpha pending milestone pushed on rerun' ((State 'sim-alpha').push -eq 'pushed')
Check 'beta resumed in continue mode, not regenerated' ((Get-Content (Join-Path $checks 'sim-beta.call-2.txt') -Raw) -match 'promptOk=True mode=continue')
Check 'beta delivered and pushed' ((Test-Path (Join-Path $simDeliv 'beta-out.html')) -and (State 'sim-beta').push -eq 'pushed')
Check 'beta budget is cumulative across sessions' ([double](State 'sim-beta').spent -eq 0.5)
$refs = (G $bare @('for-each-ref', '--format=%(refname)')) -join ' '
Check 'bare origin has main and both game branches' ($refs -match 'refs/heads/main' -and $refs -match 'game/sim-alpha' -and $refs -match 'game/sim-beta')
$files = (G $bare @('ls-tree', '-r', '--name-only', 'game/sim-beta')) -join ' '
Check 'milestone commit excludes dist and node_modules' ($files -match 'games/sim-beta/package.json' -and $files -notmatch 'dist/' -and $files -notmatch 'node_modules')
$msgs = (G $bare @('log', '--all', '--format=%an|%B')) -join ' '
Check 'commit messages carry no tool attribution' ($msgs -notmatch '(?i)claude|anthropic|co-authored')

$failed = @($results | Where-Object { -not $_.Ok })
Write-Host ("Simulation: {0} passed, {1} failed. Sandbox kept at {2}" -f ($results.Count - $failed.Count), $failed.Count, $sim)
if ($failed.Count -gt 0) { exit 1 }
exit 0
