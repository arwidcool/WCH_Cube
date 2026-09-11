<#
  Launch the three round-5 agents on this Windows box.

  This replaces run_agents.sh (round 1) and run_round3.ps1 / run_round4.ps1, which pointed
  at per-round packs that no longer exist. There is ONE pack now, in this folder, and ONE
  prompt template: agents/PROMPT.txt. The only thing that differs between the three
  sessions is the agent number, which is substituted into the template and then followed
  by that agent's own AGENT_n_*.md.

  Differences from the old .sh, which does not run here:
    - it needs tmux and git worktrees. Worktrees are SUSPENDED until a remote exists
      (agents/README.md, "Git model"), so all three agents share ONE working tree and
      commit straight to main.
    - it points each agent at the round-1 pack.

  Run from the repository root, on a machine you are willing to give an agent full shell
  access to. Every session starts with permission prompts disabled.

      powershell -File agents\run_agents.ps1            # start all three
      powershell -File agents\run_agents.ps1 -Only 2    # start just AGENT-2
      powershell -File agents\run_agents.ps1 -DryRun    # print, start nothing

  NOTE: this file is deliberately ASCII-only. Windows PowerShell 5.1 reads a .ps1 as ANSI
  unless it has a UTF-8 BOM, and a stray em-dash then decodes into a quote character that
  breaks the parser somewhere further down the file. Keep it ASCII, or save with a BOM.
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 3)] [int[]] $Only,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'

$root = (& git rev-parse --show-toplevel 2>$null)
if (-not $root) { throw "Not inside a git repository. Run this from the repo root." }
$root = $root -replace '/', '\'
Set-Location $root

$pack = Join-Path $root 'agents'
$template = Join-Path $pack 'PROMPT.txt'
if (-not (Test-Path $template)) { throw "Prompt template not found at $template" }

# Suppress the one-time bypass-mode confirmation, the way the old script did.
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
    @{ N = 1; Name = 'DATA';         File = 'AGENT_1_DATA.md' }
    @{ N = 2; Name = 'APP';          File = 'AGENT_2_APP.md' }
    @{ N = 3; Name = 'QA + RELEASE'; File = 'AGENT_3_QA_RELEASE.md' }
)

if ($Only) { $agents = $agents | Where-Object { $Only -contains $_.N } }

$promptTemplate = Get-Content $template -Raw
$rule = '-' * 78

foreach ($a in $agents) {
    $rolePath = Join-Path $pack $a.File
    if (-not (Test-Path $rolePath)) { throw "AGENT-$($a.N) ($($a.Name)) has no instruction file at $rolePath" }

    # The single substitution the whole scheme rests on: AGENT-N -> AGENT-<n>.
    $common = $promptTemplate -replace 'AGENT-N', "AGENT-$($a.N)"
    $role = Get-Content $rolePath -Raw
    $prompt = $common.TrimEnd() + "`n`n" + $rule + "`n`n" + $role

    # Written to a file rather than built inline: the prompt is long, and a temp file also
    # gives the human something to inspect when a session starts badly.
    $promptFile = Join-Path $env:TEMP "wchcube-agent-$($a.N).txt"
    if (-not $DryRun) { Set-Content -Path $promptFile -Value $prompt -Encoding UTF8 }

    if ($DryRun) {
        Write-Host "AGENT-$($a.N)  $($a.Name)"
        Write-Host "  prompt file : $promptFile"
        Write-Host "  size        : $($prompt.Length) chars (PROMPT.txt + $($a.File))"
        Write-Host "  working dir : $root"
        Write-Host "  command     : claude --permission-mode bypassPermissions -p <that file>"
        Write-Host ""
        continue
    }

    Write-Host "Starting AGENT-$($a.N) ($($a.Name)). Prompt: $promptFile"
    Start-Process -FilePath 'claude' -ArgumentList @(
        '--permission-mode', 'bypassPermissions', '-p', $prompt
    ) -WorkingDirectory $root
}

if (-not $DryRun) {
    Write-Host ""
    Write-Host "Three sessions launched. Watch agents/BOARD.md for progress;"
    Write-Host "the round closes when it contains 'ROUND 5 DONE'."
}
