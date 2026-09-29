[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Get-Process -Name 'AgentUsage', 'AgentUsageFrame' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
foreach ($name in @('Agent Usage.lnk', 'Startup\Agent Usage.lnk', 'Update Agent Usage.lnk')) {
    Remove-Item -LiteralPath (Join-Path $menu $name) -Force -ErrorAction SilentlyContinue
}
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'Agent Usage' -ErrorAction SilentlyContinue
# The key helper exits within one second of its parent stopping.
Start-Sleep -Milliseconds 1200
Remove-Item -LiteralPath (Join-Path $env:LOCALAPPDATA 'AgentUsage') -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'Removed the desktop app. Settings, prototype source/state, and SSH/WSL collectors are preserved.'
