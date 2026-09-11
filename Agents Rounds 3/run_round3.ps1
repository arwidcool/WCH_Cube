<#
  Launch the four round-3 agents on this Windows box.

  Differences from agents/run_agents.sh, which is stale and does not run here:
    - that script needs tmux and git worktrees. Worktrees are SUSPENDED until a remote
      exists (agents/README.md, "Git model"), so all four agents share ONE working tree
      and commit straight to main.
    - it points each agent at agents/AGENT_n_*.md, which is the round-1 pack.

  Run from the repository root, on a machine you are willing to give an agent full shell
  access to. Every session starts with permission prompts disabled.

      pwsh -File "Agents Rounds 3\run_round3.ps1"           # start all four
      pwsh -File "Agents Rounds 3\run_round3.ps1" -Only 2   # start just AGENT-2
      pwsh -File "Agents Rounds 3\run_round3.ps1" -DryRun   # print the commands, start nothing
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 4)] [int[]] $Only,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'

$root = (& git rev-parse --show-toplevel 2>$null)
if (-not $root) { throw "Not inside a git repository. Run this from the repo root." }
$root = $root -replace '/', '\'
Set-Location $root

$pack = Join-Path $root 'Agents Rounds 3'
if (-not (Test-Path $pack)) { throw "Round-3 pack not found at $pack" }

# Suppress the one-time bypass-mode confirmation, the way run_agents.sh does.
$settingsPath = Join-Path $HOME '.claude\settings.json'
if (-not $DryRun) {
    New-Item -ItemType Directory -Force -Path (Split-Path $settingsPath) | Out-Null
    $settings = if (Test-Path $settingsPath) {
        Get-Content $settingsPath -Raw | ConvertFrom-Json
    } else {
        [pscustomobject]@{}
    }
    $settings | Add-Member -NotePropertyName skipDangerousModePermissionPrompt -NotePropertyValue $true -Force
    if (-not $settings.permissions) {
        $settings | Add-Member -NotePropertyName permissions -NotePropertyValue ([pscustomobject]@{}) -Force
    }
    $settings.permissions | Add-Member -NotePropertyName defaultMode -NotePropertyValue 'bypassPermissions' -Force
    $settings | ConvertTo-Json -Depth 10 | Out-File -FilePath $settingsPath -Encoding utf8
}

$agents = @(
    @{ N = 1; Name = 'DATA';        File = 'AGENT_1_DATA.md' }
    @{ N = 2; Name = 'ENGINE';      File = 'AGENT_2_ENGINE.md' }
    @{ N = 3; Name = 'UI';          File = 'AGENT_3_UI.md' }
    @{ N = 4; Name = 'QA + RELEASE'; File = 'AGENT_4_QA_RELEASE.md' }
)

if ($Only) { $agents = $agents | Where-Object { $Only -contains $_.N } }

foreach ($a in $agents) {
    $brief = Join-Path $pack $a.File
    if (-not (Test-Path $brief)) { throw "Missing brief: $brief" }

    $prompt = @"
You are AGENT-$($a.N) ($($a.Name)) on WCH_CubeMX. Repo root is $root. All four agents share this
one working tree and commit directly to main - git worktrees are suspended until a remote exists.

Read, in this order, before you touch anything:
  1. agents/README.md                       the working agreement, ownership, the work cycle
  2. Agents Rounds 3/00_PROJECT.md          the round brief
  3. Agents Rounds 3/$($a.File)             your standing instructions
  4. PROGRESS.md                            where the project actually stands
  5. TASKS.md                               the backlog - claim with [~] (AGENT-$($a.N))
  6. Agents Rounds 3/BOARD.md, then the last entries of Agents Rounds 2/BOARD.md

Then start the work cycle and keep looping. Answer any board request addressed to you first.
Gate every commit on: python build.py && node tests/run.js. If you changed what the generator
emits or what an MCU file claims, also compile it: cd data/firmware && pio run -e CH32V006F8P6.
Never ask the human anything - decide, record it on the board under DECISION, and continue.
Stop when Agents Rounds 3/BOARD.md contains 'ROUND 3 DONE'.
"@

    $cmd = "claude --permission-mode bypassPermissions --dangerously-skip-permissions"

    if ($DryRun) {
        Write-Host "--- AGENT-$($a.N) $($a.Name) ---" -ForegroundColor Cyan
        Write-Host $prompt
        Write-Host ""
        continue
    }

    Write-Host "Starting AGENT-$($a.N) ($($a.Name))..." -ForegroundColor Cyan
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes(
        "Set-Location '$root'; $cmd '$($prompt -replace "'", "''")'"))
    Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoExit', '-EncodedCommand', $encoded
}

if (-not $DryRun) {
    Write-Host ""
    Write-Host "All four share one tree. Small commits, message 'AGENT-n: <task>'." -ForegroundColor Yellow
    Write-Host "A duplicate top-level const in the bundle is a fatal SyntaxError that blanks the app" -ForegroundColor Yellow
    Write-Host "for everyone - build and test before your next edit, not at the end of the cycle." -ForegroundColor Yellow
}
