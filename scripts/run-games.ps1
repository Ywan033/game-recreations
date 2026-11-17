# Unattended launcher: precheck, generate, verify, deliver, milestone, notify.
# Compatible with Windows PowerShell 5.1. Keep this file ASCII-only.
param(
    [switch]$Run,
    # Fallback cumulative client-side cost threshold per game (USD).
    # A "budgetUsd" value in tasks\queue.json takes precedence.
    [ValidateRange(1, 1000)]
    [double]$BudgetPerGame = 50,
    [string]$Only = '',
    # Name of an upgrade pass for already delivered games; uses tasks\<id>.<name>.md.
    [string]$Upgrade = '',
    [int]$MaxRepairs = 3,
    [int]$SessionTimeoutMinutes = 240,
    [int]$MaxLimitWaitMinutes = 420,
    [ValidateSet('toast', 'fail', 'log')]
    [string]$NotifyMode = 'toast',
    [switch]$NoPush,
    [int]$PagesWaitMinutes = 12,
    # Overrides used by scripts\simulate.ps1. Leave empty for real runs.
    [string]$RepoRoot = '',
    [string]$TreesRoot = '',
    [string]$CacheRoot = '',
    [string]$DeliveriesRoot = '',
    [string]$GeneratorScript = ''
)

$ErrorActionPreference = 'Stop'
$repo = if ($RepoRoot) { $RepoRoot } else { Split-Path -Parent $PSScriptRoot }
$projects = Split-Path -Parent $repo
$trees = if ($TreesRoot) { $TreesRoot } else { Join-Path $projects 'game-recreations-worktrees' }
$cache = if ($CacheRoot) { $CacheRoot } else { Join-Path $projects 'game-recreations-cache' }
$deliveries = if ($DeliveriesRoot) { $DeliveriesRoot } else { Join-Path $projects 'game-recreations-deliveries' }
$stateDir = Join-Path $cache 'state'
$model = 'claude-fable-5-2'
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$utf8 = New-Object System.Text.UTF8Encoding $false
$allowed = 'Read,Write,Edit,Glob,Grep,Bash(npm *),Bash(npm.cmd *),Bash(npx *),Bash(node *),Bash(cd *),Bash(ls *),Bash(mkdir *),Bash(cat *),Bash(git status*),Bash(git diff*),PowerShell(npm *),PowerShell(npx *),PowerShell(node *)'
$script:launcherLog = $null

function Write-Log {
    param([string]$Message)
    $line = ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message)
    Write-Host $line
    if ($script:launcherLog) {
        [System.IO.File]::AppendAllText($script:launcherLog, $line + "`r`n", $utf8)
    }
}

function Read-Utf8 {
    param([string]$Path)
    return [System.IO.File]::ReadAllText($Path, $utf8)
}

function Invoke-Git {
    param([string]$Dir, [string[]]$GitArgs)
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & git -C $Dir @GitArgs 2>&1 | ForEach-Object { "$_" }
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $old
    }
    return New-Object psobject -Property @{ Code = $code; Out = @($out) }
}

function Invoke-Step {
    param([string]$Dir, [string]$CommandLine, [string]$Log)
    [System.IO.File]::AppendAllText($Log, "`r`n>>> [$Dir] $CommandLine`r`n", $utf8)
    Push-Location -LiteralPath $Dir
    try {
        $env:RG_STEP_LOG = $Log
        & cmd.exe /d /c "$CommandLine >> %RG_STEP_LOG% 2>&1"
        return $LASTEXITCODE
    } finally {
        Pop-Location
    }
}

# ---------- state ----------

function Get-State {
    param([string]$Id)
    $path = Join-Path $stateDir "$Id.json"
    $s = @{
        status = 'pending'; offline = 'pending'; spent = 0.0; sessions = 0
        commit = ''; push = 'none'; reason = ''; deliveredAt = ''; pages = 'none'; pagesUrl = ''; upgradeDone = ''
    }
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        $saved = Read-Utf8 $path | ConvertFrom-Json
        foreach ($p in $saved.PSObject.Properties) { $s[$p.Name] = $p.Value }
        $s.spent = [double]$s.spent
        $s.sessions = [int]$s.sessions
    }
    return $s
}

function Save-State {
    param([string]$Id, [hashtable]$State)
    $path = Join-Path $stateDir "$Id.json"
    [System.IO.File]::WriteAllText($path, ($State | ConvertTo-Json), $utf8)
}

function Get-JobBudget {
    param($Job)
    if ($Job.PSObject.Properties.Name -contains 'budgetUsd') { return [double]$Job.budgetUsd }
    return $BudgetPerGame
}

function Get-WebUrl {
    $r = Invoke-Git $repo @('remote', 'get-url', 'origin')
    if ($r.Code -ne 0 -or $r.Out.Count -eq 0) { return '' }
    $u = "$($r.Out[0])".Trim()
    if ($u -match '^https://github\.com/') { return ($u -replace '\.git$', '') }
    return ''
}

function Get-OnlineText {
    param($State, $Labels)
    if ($State.pages -eq 'verified' -and $State.pagesUrl) { return "[$($Labels.onlinePlay)]($($State.pagesUrl))" }
    if ($State.pages -eq 'published') { return $Labels.onlineUnverified }
    return $Labels.onlinePending
}

function Write-Readme-Online {
    $labels = Read-Utf8 (Join-Path $repo 'scripts\progress-labels.json') | ConvertFrom-Json
    $path = Join-Path $repo 'README.md'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return }
    $text = Read-Utf8 $path
    $a = $text.IndexOf('<!-- online-play:start -->')
    $b = $text.IndexOf('<!-- online-play:end -->')
    if ($a -lt 0 -or $b -lt $a) { return }
    $lines = @()
    foreach ($job in $allJobs) {
        $s = Get-State $job.id
        $lines += "- **$($job.title) ($($job.titleEn))**: $(Get-OnlineText $s $labels)"
    }
    $block = "<!-- online-play:start -->`n" + ($lines -join "`n") + "`n"
    $new = $text.Substring(0, $a) + $block + $text.Substring($b)
    if ($new -ne $text) { [System.IO.File]::WriteAllText($path, $new, $utf8) }
}

function Get-PagesUrl {
    param($Job)
    $web = Get-WebUrl
    if ($web -match '^https://github\.com/([^/]+)/([^/]+)$') {
        return "https://$($Matches[1].ToLower()).github.io/$($Matches[2])/play/$($Job.delivery)"
    }
    return ''
}

# Publish the delivered HTML to docs/play on main, wait for GitHub Pages,
# then verify the live URL in a fresh browser session.
function Invoke-Pages {
    param($Job)
    $id = $Job.id
    $s = Get-State $id
    if ($s.pages -eq 'verified') { return 'verified' }
    $url = Get-PagesUrl $Job
    if ($NoPush -or -not $url) { Write-Log "[PAGES] $id skipped (no GitHub origin or -NoPush)"; return 'none' }
    $src = Join-Path $deliveries $Job.delivery
    $rel = "docs/play/$($Job.delivery)"
    $dst = Join-Path $repo ($rel -replace '/', '\')
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst -Force
    Invoke-Git $repo @('add', '--', $rel) | Out-Null
    if ((Invoke-Git $repo @('diff', '--cached', '--quiet', '--', $rel)).Code -ne 0) {
        $r = Invoke-Git $repo @('commit', '-q', '-m', "Publish $($Job.titleEn) to GitHub Pages", '--', $rel)
        if ($r.Code -ne 0) { Write-Log "[PAGES] commit failed: $($r.Out -join ' ')"; return 'none' }
    }
    $r = Invoke-Git $repo @('push', 'origin', 'main')
    if ($r.Code -ne 0) { Write-Log "[PAGES] push of main failed: $($r.Out -join ' ')"; return 'none' }
    $s.pagesUrl = $url
    $s.pages = 'published'
    Save-State $id $s

    $size = (Get-Item -LiteralPath $src).Length
    $live = $false
    $deadline = (Get-Date).AddMinutes($PagesWaitMinutes)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri ($url + '?v=' + [DateTime]::UtcNow.Ticks) -UseBasicParsing -TimeoutSec 60
            if ($resp.StatusCode -eq 200 -and $resp.RawContentLength -eq $size) { $live = $true; break }
        } catch { }
        Start-Sleep -Seconds 20
    }
    if (-not $live) {
        Write-Log "[PAGES] $url did not serve the delivered file within $PagesWaitMinutes minutes. If GitHub Pages is not enabled: repository Settings > Pages > Source 'Deploy from a branch' > Branch main, folder /docs > Save. Then rerun the launcher."
        return 'published'
    }
    $log = Join-Path $runLogs "$id.online.log"
    [System.IO.File]::WriteAllText($log, '', $utf8)
    $verifier = Join-Path $repo 'scripts\verify-online.cjs'
    $code = Invoke-Step (Join-Path (Join-Path $trees $id) "games\$id") "node $verifier $id $url" $log
    if ($code -ne 0) { Write-Log "[PAGES] Live verification failed for $url (exit $code). See $log"; return 'published' }
    $s.pages = 'verified'
    Save-State $id $s
    Write-Log "[PAGES] Verified live: $url"
    Write-Progress-File
    Write-Readme-Online
    Invoke-Git $repo @('add', '--', 'README.md', 'PROGRESS.md') | Out-Null
    Invoke-Git $repo @('commit', '-q', '-m', "Add online play link for $($Job.titleEn)", '--', 'README.md', 'PROGRESS.md') | Out-Null
    $r = Invoke-Git $repo @('push', 'origin', 'main')
    if ($r.Code -ne 0) { Write-Log "[PAGES] push of README failed: $($r.Out -join ' ')" }
    return 'verified'
}

function Write-Progress-File {
    $labels = Read-Utf8 (Join-Path $repo 'scripts\progress-labels.json') | ConvertFrom-Json
    $web = Get-WebUrl
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append($labels.header)
    $cols = @($labels.columns) + @($labels.onlineColumn)
    [void]$sb.Append("`n| " + ($cols -join ' | ') + " |`n")
    [void]$sb.Append('|' + (' --- |' * $cols.Count) + "`n")
    foreach ($job in $allJobs) {
        $s = Get-State $job.id
        $key = $s.status
        if ($key -eq 'delivered' -and $s.push -ne 'pushed') { $key = 'deliveredPendingPush' }
        $status = $labels.status.$key
        $offline = $labels.offline.($s.offline)
        $mile = $labels.none
        if ($s.commit) {
            $short = "$($s.commit)".Substring(0, 7)
            if ($s.push -eq 'pushed' -and $web) {
                $mile = "[$short]($web/commit/$($s.commit)) / [DELIVERY.md]($web/blob/$($job.branch)/games/$($job.id)/DELIVERY.md)"
            } else {
                $mile = "``$short`` ($($labels.localOnly))"
            }
        }
        $html = $labels.none
        if ($s.status -eq 'delivered') { $html = "``$($job.delivery)``" }
        $name = "$($job.title) ($($job.titleEn))"
        $online = Get-OnlineText $s $labels
        [void]$sb.Append("| $name | $status | $offline | $mile | $html | $($labels.acceptance) | $online |`n")
    }
    [void]$sb.Append($labels.footer)
    [System.IO.File]::WriteAllText((Join-Path $repo 'PROGRESS.md'), $sb.ToString(), $utf8)
}

# ---------- notification ----------

function Send-Notice {
    param([string]$Title, [string]$Body)
    $sent = $false
    if ($NotifyMode -eq 'toast') {
        try {
            [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
            [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
            $t = [System.Security.SecurityElement]::Escape($Title)
            $b = [System.Security.SecurityElement]::Escape($Body)
            $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
            $xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual></toast>")
            $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
            $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
            [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
            $sent = $true
        } catch {
            Write-Log "[NOTIFY] Toast unavailable: $($_.Exception.Message)"
        }
    } elseif ($NotifyMode -eq 'fail') {
        Write-Log '[NOTIFY] Toast unavailable: forced failure (NotifyMode=fail)'
    }
    if ($sent) {
        Write-Log "[NOTIFY] Toast sent: $Title | $Body"
    } else {
        Write-Log "[NOTIFY-FALLBACK] $Title | $Body"
    }
}

# ---------- generation ----------

function New-Prompt {
    param($Job, [string]$Mode, [string]$FailureInfo)
    $id = $Job.id
    $rules = Read-Utf8 (Join-Path $repo 'CLAUDE.md')
    $brief = Read-Utf8 (Join-Path $repo "tasks\$id.md")
    $gameDoc = Join-Path (Join-Path $trees $id) "games\$id\CLAUDE.md"
    $gameRules = '(none provided)'
    if (Test-Path -LiteralPath $gameDoc -PathType Leaf) { $gameRules = Read-Utf8 $gameDoc }

    $upgradeBrief = ''
    if ($Upgrade) {
        $upPath = Join-Path $repo "tasks\$id.$Upgrade.md"
        if (Test-Path -LiteralPath $upPath -PathType Leaf) {
            $upgradeBrief = "`n===== CURRENT TASK: UPGRADE BRIEF (tasks/$id.$Upgrade.md) =====`n" + (Read-Utf8 $upPath) + "`n"
        }
    }
    if ($Mode -eq 'upgrade') {
        $head = @"
The game in games/$id is already delivered and its checks pass. Your task
now is the upgrade brief below (section CURRENT TASK). Work on the existing
code; do not start over. Keep combat rules, controls, test options, the
state probe, and the existing tests working. Keep all changes inside that
game directory. Do not commit, push, publish, or request intermediate
reviews.
"@
        $cmpRel = 'compare'
        if ($upgradeBrief.Contains("compare/$Upgrade/")) { $cmpRel = "compare\$Upgrade" }
        if (Test-Path -LiteralPath (Join-Path (Join-Path $trees $id) "games\$id\$cmpRel\before-title.png") -PathType Leaf) {
            $head += @"

An earlier session of this upgrade was interrupted before it finished. The
compare/before-*.png screenshots already exist and show the version before
the upgrade: do not regenerate or overwrite them. Review what is already
done on disk against every item of the brief, finish what is missing,
re-verify, re-capture the after-* screenshots, and write the report section.
"@
        }
    } elseif ($Mode -eq 'generate') {
        $head = @"
Implement this game autonomously in games/$id in the current worktree.
Keep all project changes inside that game directory. Do not commit, push,
publish, or request intermediate reviews. Fix build and test failures.
First get a fight that is playable from opening to result screen, then
polish scene, motion, and audio.
"@
    } else {
        $head = @"
Continue the existing work in games/$id in the current worktree. Do not
start over: inspect what is there, keep what works, and finish or repair
it. Keep all changes inside that game directory. Do not commit, push,
publish, or request intermediate reviews.

State of the previous attempt:
$FailureInfo
"@
    }

    return @"
$head

===== SHARED RULES (repository CLAUDE.md) =====
$rules

===== GAME BRIEF (tasks/$id.md) =====
$brief

===== GAME RULES (games/$id/CLAUDE.md) =====
$gameRules
$upgradeBrief
===== LAUNCHER CONTRACT =====
Provide npm scripts named build, install:browsers, and test:offline.
The build must produce dist/play.html. install:browsers must install
the Playwright browser used by test:offline. The offline suite must
copy only play.html to a fresh temporary directory, open it via file://
with networking disabled, and exercise the real controls, win, loss,
retry, and the brief-specific mechanics. Fail on uncaught page errors.
Use package scripts or Node for shell-independent filesystem operations.
After you finish, the launcher runs: npm ci, npm run build,
npm run install:browsers, npm run test:offline. All four must exit 0.
Run the checks yourself and record actual results in DELIVERY.md.
"@
}

function Invoke-Session {
    param($Job, [string]$PromptFile, [double]$Budget, [string]$OutFile, [string]$ErrFile)
    $tree = Join-Path $trees $Job.id
    if ($GeneratorScript) {
        $exe = 'powershell.exe'
        $argLine = "-NoProfile -ExecutionPolicy Bypass -File `"$GeneratorScript`" -Id $($Job.id) -GameDir `"$(Join-Path $tree "games\$($Job.id)")`" -PromptFile `"$PromptFile`""
    } else {
        $exe = (Get-Command claude -ErrorAction Stop).Source
        $b = $Budget.ToString('0.00', $inv)
        $argLine = "--print --model $model --permission-mode dontAsk --allowedTools `"$allowed`" --max-budget-usd $b --output-format stream-json --verbose"
    }
    $p = Start-Process -FilePath $exe -ArgumentList $argLine -WorkingDirectory $tree `
        -RedirectStandardInput $PromptFile -RedirectStandardOutput $OutFile `
        -RedirectStandardError $ErrFile -NoNewWindow -PassThru
    $null = $p.Handle
    $timedOut = $false
    if (-not $p.WaitForExit($SessionTimeoutMinutes * 60000)) {
        $timedOut = $true
        & taskkill.exe /PID $p.Id /T /F | Out-Null
        $p.WaitForExit(30000) | Out-Null
    }

    $res = @{ ExitCode = -1; Cost = $null; IsError = $true; Text = ''; TimedOut = $timedOut; Limit = $false; ResetAt = $null }
    if (-not $timedOut) { $res.ExitCode = $p.ExitCode }
    $resultLine = $null
    $limitReset = $null
    if (Test-Path -LiteralPath $OutFile) {
        foreach ($line in [System.IO.File]::ReadLines($OutFile, $utf8)) {
            if ($line.Contains('"status":"rejected"') -and $line -match '"resetsAt":(\d{10})') { $limitReset = [long]$Matches[1] }
            # Key order in the result object is not fixed; match on content.
            if ($line.StartsWith('{') -and $line.Contains('"type":"result"') -and $line.Contains('"total_cost_usd"')) { $resultLine = $line }
        }
    }
    if ($resultLine) {
        try {
            $obj = $resultLine | ConvertFrom-Json
            if ($null -ne $obj.total_cost_usd) { $res.Cost = [double]$obj.total_cost_usd }
            $res.IsError = [bool]$obj.is_error
            $res.Text = "$($obj.subtype) $($obj.result)"
            if ("$($obj.api_error)" -eq 'usage_limit_reached') { $res.Text += ' usage limit reached' }
        } catch { }
    }
    $errText = ''
    if (Test-Path -LiteralPath $ErrFile) { $errText = Read-Utf8 $ErrFile }
    $probe = "$($res.Text)`n$errText"
    if (($res.IsError -or $res.ExitCode -ne 0) -and $probe -match '(?i)usage limit|rate limit|limit reached|hit your [\w\- ]{0,20}limit|out of extra usage') {
        $res.Limit = $true
        if ($limitReset) {
            $res.ResetAt = [DateTimeOffset]::FromUnixTimeSeconds($limitReset).LocalDateTime
        } elseif ($probe -match '\|(\d{10})\b') {
            $res.ResetAt = [DateTimeOffset]::FromUnixTimeSeconds([long]$Matches[1]).LocalDateTime
        } elseif ($probe -match '(?i)resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)') {
            $h = [int]$Matches[1] % 12
            if ($Matches[3] -match '(?i)pm') { $h += 12 }
            $m = 0
            if ($Matches[2]) { $m = [int]$Matches[2] }
            $t = (Get-Date).Date.AddHours($h).AddMinutes($m)
            if ($t -le (Get-Date)) { $t = $t.AddDays(1) }
            $res.ResetAt = $t
        }
    }
    return $res
}

# ---------- verification ----------

function Invoke-Verify {
    param([string]$Game, [string]$Log, [string[]]$ExtraFiles = @())
    foreach ($file in (@('package.json', 'package-lock.json', 'DELIVERY.md') + $ExtraFiles)) {
        if (-not (Test-Path -LiteralPath (Join-Path $Game $file) -PathType Leaf)) {
            [System.IO.File]::AppendAllText($Log, "Missing deliverable: $file`r`n", $utf8)
            return "missing $file"
        }
    }
    $steps = @(
        @('npm ci', 'npm.cmd ci'),
        @('build', 'npm.cmd run build'),
        @('install:browsers', 'npm.cmd run install:browsers'),
        @('test:offline', 'npm.cmd run test:offline')
    )
    foreach ($step in $steps) {
        $code = Invoke-Step $Game $step[1] $Log
        if ($code -ne 0) { return "$($step[0]) exited with code $code" }
        if ($step[0] -eq 'build') {
            $html = Join-Path $Game 'dist\play.html'
            if (-not (Test-Path -LiteralPath $html -PathType Leaf) -or (Get-Item -LiteralPath $html).Length -eq 0) {
                [System.IO.File]::AppendAllText($Log, "dist/play.html missing or empty`r`n", $utf8)
                return 'dist/play.html missing or empty'
            }
            $text = Read-Utf8 $html
            if ($text -match '<(script|link|img|audio|video|source|iframe)\b[^>]*\b(src|href)\s*=\s*["'']?(https?:)?//') {
                Write-Log "[WARN] play.html may reference an external URL in a tag; the offline test is the gate."
            }
        }
    }
    return ''
}

# ---------- milestone ----------

function Invoke-Milestone {
    param($Job, [string]$Message = '')
    $id = $Job.id
    $tree = Join-Path $trees $id
    $s = Get-State $id
    if ($s.push -eq 'pushed') { return 'pushed' }

    $r = Invoke-Git $tree @('add', '--', "games/$id")
    if ($r.Code -ne 0) { Write-Log "[GIT] add failed for ${id}: $($r.Out -join ' ')"; return 'pending' }
    $staged = @((Invoke-Git $tree @('diff', '--cached', '--name-only')).Out | Where-Object { $_ })
    $bad = @($staged | Where-Object {
        ($_ -notlike "games/$id/*") -or ($_ -match '(^|/)(node_modules|dist|test-results|playwright-report|run-logs)/') -or
        ($_ -match '(^|/)\.env') -or ($_ -match '\.(log|pem|key|pfx)$')
    })
    if ($bad.Count -gt 0) {
        Invoke-Git $tree @('reset', '-q') | Out-Null
        Write-Log "[GIT] Refusing to commit ${id}; unexpected staged paths: $($bad -join ', ')"
        $s.reason = 'milestone blocked: unexpected staged paths'
        Save-State $id $s
        return 'pending'
    }
    if ($staged.Count -gt 0) {
        $msg = if ($Message) { $Message } else { "Deliver $($Job.titleEn) ($id): source, docs, and offline tests" }
        $r = Invoke-Git $tree @('commit', '-q', '-m', $msg)
        if ($r.Code -ne 0) { Write-Log "[GIT] commit failed for ${id}: $($r.Out -join ' ')"; return 'pending' }
        Write-Log "[GIT] Committed $($staged.Count) files on $($Job.branch)"
    }
    $s.commit = "$((Invoke-Git $tree @('rev-parse', 'HEAD')).Out[0])".Trim()
    Save-State $id $s

    $pushed = $false
    $hasOrigin = ((Invoke-Git $repo @('remote', 'get-url', 'origin')).Code -eq 0)
    if ($NoPush) {
        Write-Log "[GIT] -NoPush set; leaving $($Job.branch) unpushed"
    } elseif (-not $hasOrigin) {
        Write-Log '[GIT] No origin remote; push pending'
    } else {
        $r = Invoke-Git $tree @('push', 'origin', $Job.branch)
        if ($r.Code -eq 0) {
            $pushed = $true
            Write-Log "[GIT] Pushed $($Job.branch) at $($s.commit)"
        } else {
            Write-Log "[GIT] Push failed for $($Job.branch): $($r.Out -join ' ')"
        }
    }
    $s.push = if ($pushed) { 'pushed' } else { 'pending' }
    Save-State $id $s
    Sync-Progress "Update progress: $($Job.titleEn) delivered"
    return $s.push
}

function Sync-Progress {
    param([string]$Message)
    Write-Progress-File
    Write-Readme-Online
    $branch = "$((Invoke-Git $repo @('branch', '--show-current')).Out[0])".Trim()
    if ($branch -ne 'main') { Write-Log "[GIT] Main repo is on '$branch', not main; PROGRESS.md left uncommitted"; return }
    Invoke-Git $repo @('add', '--', 'PROGRESS.md', 'README.md') | Out-Null
    $diff = Invoke-Git $repo @('diff', '--cached', '--quiet', '--', 'PROGRESS.md', 'README.md')
    if ($diff.Code -ne 0) {
        $r = Invoke-Git $repo @('commit', '-q', '-m', $Message, '--', 'PROGRESS.md', 'README.md')
        if ($r.Code -ne 0) { Write-Log "[GIT] PROGRESS.md commit failed: $($r.Out -join ' ')"; return }
    }
    if ($NoPush) { return }
    if ((Invoke-Git $repo @('remote', 'get-url', 'origin')).Code -ne 0) { return }
    $r = Invoke-Git $repo @('push', 'origin', 'main')
    if ($r.Code -eq 0) { Write-Log '[GIT] Pushed main (PROGRESS.md)' }
    else { Write-Log "[GIT] Push of main failed: $($r.Out -join ' ')" }
}

# ---------- precheck ----------

$queuePath = Join-Path $repo 'tasks\queue.json'
# PowerShell 5.1 emits a JSON array as one object; assign first, then enumerate.
$parsedQueue = Read-Utf8 $queuePath | ConvertFrom-Json
$queue = @($parsedQueue | ForEach-Object { $_ })
$allJobs = $queue   # documents always list every game, even with -Only
if ($Only) { $queue = @($queue | Where-Object { $_.id -eq $Only }) }
if ($queue.Count -eq 0) { throw 'The game queue is empty.' }

$tools = @('git', 'node', 'npm.cmd')
if (-not $GeneratorScript) { $tools += 'claude' }
foreach ($tool in $tools) { Get-Command $tool -ErrorAction Stop | Out-Null }
foreach ($doc in 'CLAUDE.md', 'scripts\progress-labels.json') {
    if (-not (Test-Path -LiteralPath (Join-Path $repo $doc) -PathType Leaf)) { throw "Missing $doc" }
}

foreach ($job in $queue) {
    foreach ($field in 'id', 'branch', 'title', 'titleEn', 'delivery') {
        if (-not $job.$field) { throw "Queue entry missing '$field'" }
    }
    $tree = Join-Path $trees $job.id
    $brief = Join-Path $repo "tasks\$($job.id).md"
    if (-not (Test-Path -LiteralPath $tree -PathType Container)) { throw "Missing worktree: $tree" }
    if (-not (Test-Path -LiteralPath $brief -PathType Leaf)) { throw "Missing brief: $brief" }
    if ($Upgrade -and -not (Test-Path -LiteralPath (Join-Path $repo "tasks\$($job.id).$Upgrade.md") -PathType Leaf)) { throw "Missing upgrade brief: tasks\$($job.id).$Upgrade.md" }
    $branch = "$((Invoke-Git $tree @('branch', '--show-current')).Out[0])".Trim()
    if ($branch -ne $job.branch) { throw "Expected $($job.branch) in $tree, found '$branch'" }
    $gameDoc = Join-Path $tree "games\$($job.id)\CLAUDE.md"
    $docNote = if (Test-Path -LiteralPath $gameDoc) { 'game CLAUDE.md present' } else { 'game CLAUDE.md MISSING' }
    $budget = (Get-JobBudget $job).ToString('0.00', $inv)
    Write-Host "[READY] $($job.id) ($($job.titleEn)) on $branch; budget `$$budget; delivery $($job.delivery); $docNote"
}

if (-not $GeneratorScript) {
    $claudeHelp = claude --help | Out-String
    foreach ($flag in '--print', '--model', '--permission-mode', '--allowedTools', '--max-budget-usd', '--output-format') {
        if (-not $claudeHelp.Contains($flag)) { throw "Claude CLI missing $flag" }
    }
    & claude auth status --text | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Claude Code is not logged in.' }
}

$origin = Invoke-Git $repo @('remote', 'get-url', 'origin')
if ($origin.Code -eq 0) { Write-Host "[READY] origin = $($origin.Out[0])" }
else { Write-Host '[WARN] No origin remote; milestones will stay local (push pending).' }

if (-not $Run) {
    Write-Host '[PRECHECK READY] Use -Run to start generation.'
    return
}

# ---------- run ----------

$env:npm_config_cache = Join-Path $cache 'npm'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $cache 'playwright'
$env:TEMP = Join-Path $cache 'temp'
$env:TMP = $env:TEMP
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'never'
$runLogs = Join-Path $repo ('run-logs\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path $runLogs, $deliveries, $env:TEMP, $stateDir | Out-Null
$script:launcherLog = Join-Path $runLogs 'launcher.log'
Write-Log "Run logs: $runLogs"
Write-Log "Deliveries: $deliveries"

$incomplete = @()
$batchBlocked = ''
foreach ($job in $queue) {
    $id = $job.id
    $tree = Join-Path $trees $id
    $game = Join-Path $tree "games\$id"
    $target = Join-Path $deliveries $job.delivery
    $budget = Get-JobBudget $job
    $s = Get-State $id

    $isUpgrade = $false
    try {
        $delivered = (Test-Path -LiteralPath $target -PathType Leaf) -and $s.status -eq 'delivered'
        $isUpgrade = [bool]$Upgrade -and $delivered -and ($s.upgradeDone -ne $Upgrade)
        if ($delivered -and -not $isUpgrade) {
            Write-Log "[SKIP] $id already delivered: $target"
            if ($s.push -ne 'pushed') {
                $push = Invoke-Milestone $job
                Write-Log "[MILESTONE] $id push state: $push"
            }
            if ($s.pages -ne 'verified') {
                $pg = Invoke-Pages $job
                if ($pg -eq 'verified') {
                    Send-Notice "$($job.title) ($($job.titleEn)) online" "$((Get-State $id).pagesUrl) | local: $target"
                }
            }
            continue
        }
        if ($batchBlocked) {
            if (-not $isUpgrade) { $s.status = 'blocked' }
            $s.reason = $batchBlocked
            Save-State $id $s
            $incomplete += $id
            Write-Log "[BLOCKED] $id not started: $batchBlocked"
            continue
        }

        # Bring the shared rules on the game branch up to date when it is a clean fast-forward.
        $ff = Invoke-Git $tree @('merge', '--ff-only', '-q', 'main')
        if ($ff.Code -ne 0) { Write-Log "[WARN] $id could not fast-forward to main: $($ff.Out -join ' ')" }

        New-Item -ItemType Directory -Force -Path $game | Out-Null
        if (-not $isUpgrade) { $s.status = 'developing' }
        $s.reason = ''
        Save-State $id $s
        Write-Progress-File

        $failure = ''
        $needSession = -not (Test-Path -LiteralPath (Join-Path $game 'package.json') -PathType Leaf)
        $mode = if ($needSession) { 'generate' } else { 'continue' }
        $extraFiles = @()
        if ($isUpgrade) {
            $needSession = $true
            $mode = 'upgrade'
            # A brief that names compare/<upgrade>/ keeps its evidence in that subfolder.
            $cmp = 'compare'
            $upText = Read-Utf8 (Join-Path $repo "tasks\$id.$Upgrade.md")
            if ($upText.Contains("compare/$Upgrade/")) { $cmp = "compare\$Upgrade" }
            $extraFiles = @("$cmp\before-title.png", "$cmp\before-explore.png", "$cmp\before-combat.png",
                            "$cmp\after-title.png", "$cmp\after-explore.png", "$cmp\after-combat.png")
            if ($upText.Contains("compare/$Upgrade/gameplay.webm")) { $extraFiles += "$cmp\gameplay.webm" }
            Write-Log "[UPGRADE] $id pass '$Upgrade' on the delivered game; current delivery stays until the new build passes."
        }
        $ok = $false
        $round = 0
        while ($true) {
            $round++
            if ($needSession) {
                $remaining = $budget - $s.spent
                if ($remaining -lt 0.5) { $s.reason = ('budget exhausted: spent {0} of {1} USD' -f $s.spent.ToString('0.00', $inv), $budget.ToString('0.00', $inv)); break }
                $n = $s.sessions + 1
                $promptFile = Join-Path $runLogs "$id.prompt-$n.md"
                $outFile = Join-Path $runLogs "$id.session-$n.jsonl"
                $errFile = Join-Path $runLogs "$id.session-$n.stderr.log"
                [System.IO.File]::WriteAllText($promptFile, (New-Prompt $job $mode $failure), $utf8)
                Write-Log ("[SESSION] {0} #{1} mode={2} budget={3} (spent {4} of {5}). Output: {6}" -f $id, $n, $mode, $remaining.ToString('0.00', $inv), $s.spent.ToString('0.00', $inv), $budget.ToString('0.00', $inv), $outFile)
                $res = Invoke-Session $job $promptFile $remaining $outFile $errFile
                $s.sessions = $n
                if ($null -ne $res.Cost) { $s.spent += $res.Cost }
                elseif (-not $res.Limit) { $s.spent += $remaining }   # unknown cost: assume the allotment was used
                Save-State $id $s
                Write-Log ("[SESSION] {0} #{1} exit={2} cost={3} timedOut={4} limit={5} {6}" -f $id, $n, $res.ExitCode, $res.Cost, $res.TimedOut, $res.Limit, ($res.Text -replace '\s+', ' ').Substring(0, [Math]::Min(200, ($res.Text -replace '\s+', ' ').Length)))

                if ($res.Limit) {
                    $wait = $null
                    if ($res.ResetAt) { $wait = [int][Math]::Ceiling(($res.ResetAt - (Get-Date)).TotalMinutes) + 3 }
                    if ($null -ne $wait -and $wait -le $MaxLimitWaitMinutes) {
                        if ($wait -lt 1) { $wait = 1 }
                        Write-Log "[LIMIT] Usage limit hit; reset at $($res.ResetAt). Waiting $wait minutes, then continuing $id."
                        if (-not $isUpgrade) { $s.status = 'blocked' }
                        $s.reason = "usage limit; auto-resume after $($res.ResetAt)"
                        Save-State $id $s
                        Write-Progress-File
                        Start-Sleep -Seconds ($wait * 60)
                        if (-not $isUpgrade) { $s.status = 'developing' }
                        $s.reason = ''
                        $mode = 'continue'
                        $failure = 'The previous session stopped because the account usage limit was reached. Continue from the files on disk.'
                        $round--
                        continue
                    }
                    $batchBlocked = "account usage limit (reset time: $($res.ResetAt)); see $outFile"
                    $s.reason = $batchBlocked
                    break
                }
            }

            if (-not $isUpgrade) { $s.status = 'verifying' }
            Save-State $id $s
            Write-Progress-File
            $verifyLog = Join-Path $runLogs "$id.verify-$round.log"
            [System.IO.File]::WriteAllText($verifyLog, '', $utf8)
            Write-Log "[VERIFY] $id round $round. Log: $verifyLog"
            $failStep = Invoke-Verify $game $verifyLog $extraFiles
            if (-not $failStep) { $ok = $true; break }

            Write-Log "[VERIFY] $id failed: $failStep"
            $tail = (Get-Content -LiteralPath $verifyLog -Tail 120 -Encoding UTF8) -join "`n"
            $failure = "The launcher's verification failed at step: $failStep`nLast lines of the verification log:`n$tail"
            if (-not $isUpgrade) { $s.status = 'developing'; $s.offline = 'failed' }
            Save-State $id $s
            $needSession = $true
            $mode = 'continue'
            if ($round -ge (1 + $MaxRepairs)) { $s.reason = "verification still failing after $round rounds: $failStep"; break }
        }

        if ($ok) {
            $html = Join-Path $game 'dist\play.html'
            $commitMsg = ''
            if ($isUpgrade) {
                $prevDir = Join-Path $deliveries 'previous'
                New-Item -ItemType Directory -Force -Path $prevDir | Out-Null
                $prevName = [System.IO.Path]::GetFileNameWithoutExtension($job.delivery) + '.before-' + $Upgrade + '.html'
                # Keep the first backup: a resumed upgrade must not replace it with a partial build.
                if (-not (Test-Path -LiteralPath (Join-Path $prevDir $prevName) -PathType Leaf)) {
                    Copy-Item -LiteralPath $target -Destination (Join-Path $prevDir $prevName) -Force
                }
                Write-Log ("[UPGRADE] Previous delivery kept at {0} ({1} bytes); new build is {2} bytes" -f (Join-Path $prevDir $prevName), (Get-Item -LiteralPath $target).Length, (Get-Item -LiteralPath $html).Length)
                $s.upgradeDone = $Upgrade
                $s.push = 'pending'
                $s.pages = 'none'
                $commitMsg = "$($job.titleEn): $Upgrade visual pass, verified offline"
            }
            Copy-Item -LiteralPath $html -Destination "$target.tmp" -Force
            Move-Item -LiteralPath "$target.tmp" -Destination $target -Force
            $s.status = 'delivered'; $s.offline = 'passed'; $s.reason = ''
            $s.deliveredAt = (Get-Date -Format 's')
            Save-State $id $s
            Write-Progress-File
            Write-Log "[DELIVERED] $id -> $target"
            $push = Invoke-Milestone $job $commitMsg
            $pushText = if ($push -eq 'pushed') { "GitHub: pushed $($job.branch)" } else { 'GitHub: push pending (local delivery kept)' }
            $pg = Invoke-Pages $job
            $pgText = if ($pg -eq 'verified') { "Online: $((Get-State $id).pagesUrl)" } else { 'Online: pending' }
            Send-Notice "$($job.title) ($($job.titleEn)) delivered" "$target | $pushText | $pgText"
        } elseif ($isUpgrade) {
            Save-State $id $s
            $incomplete += $id
            Write-Log "[UPGRADE-INCOMPLETE] ${id}: $($s.reason). The previous delivery is unchanged."
        } else {
            $s.status = if ($s.reason -match 'limit|budget') { 'blocked' } else { 'failed' }
            Save-State $id $s
            Write-Progress-File
            $incomplete += $id
            Write-Log "[$($s.status.ToUpper())] ${id}: $($s.reason)"
        }
    } catch {
        if (-not $isUpgrade) { $s.status = 'failed' }
        $s.reason = "launcher error: $($_.Exception.Message)"
        Save-State $id $s
        $incomplete += $id
        Write-Log "[FAILED] $id launcher error: $($_ | Out-String)"
        try { Write-Progress-File } catch { }
    }
}

try { Sync-Progress 'Update progress' } catch { Write-Log "[GIT] Progress sync error: $($_.Exception.Message)" }

if ($incomplete.Count -gt 0) {
    Write-Log ("Incomplete: " + ($incomplete -join ', '))
    $resume = 'Resume: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-games.ps1 -Run'
    if ($Upgrade) { $resume += " -Upgrade $Upgrade" }
    Write-Log $resume
    exit 1
}
Write-Log 'All queued games are delivered.'
exit 0
