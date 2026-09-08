[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$installDir = Join-Path $env:LOCALAPPDATA 'AgentUsageFrame'
$startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'

Get-Process -Name 'AgentUsageFrame' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$paths = @(
    (Join-Path $startMenuDir 'Agent Usage.lnk'),
    (Join-Path $startMenuDir 'Startup\Agent Usage.lnk'),
    $installDir
)
foreach ($path in $paths) {
    if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Recurse -Force
        Write-Host "Removed $path"
    }
}

Write-Host 'Removed the Windows app only. WSL, Codex, Claude, and cxa are untouched.'
