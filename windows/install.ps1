[CmdletBinding()]
param([switch]$Force, [switch]$Autostart = $true, [switch]$Interactive, [string]$Ssh)
$ErrorActionPreference = 'Stop'
$payload = Join-Path $PSScriptRoot 'app'
$installDir = Join-Path $env:LOCALAPPDATA 'AgentUsage'
$target = Join-Path $installDir 'AgentUsage.exe'
$startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$settingsDir = Join-Path $env:APPDATA 'Agent Usage'
$settingsPath = Join-Path $settingsDir 'settings.json'
$legacyPath = Join-Path $env:LOCALAPPDATA 'AgentUsageFrame\state.json'
foreach ($file in @('AgentUsage.exe', 'resources\app.asar', 'resources\InputMonitor.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $payload $file))) { throw "Missing packaged file: $file. Extract the whole ZIP first." }
}
if ((Test-Path -LiteralPath $target) -and -not $Force) { throw 'Already installed. Use -Force to update.' }
$config = @{}
if (Test-Path -LiteralPath $settingsPath) {
    $saved = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    foreach ($p in $saved.PSObject.Properties) { $config[$p.Name] = $p.Value }
}
elseif (Test-Path -LiteralPath $legacyPath) {
    $legacy = Get-Content -LiteralPath $legacyPath -Raw | ConvertFrom-Json
    $config.source = if ($legacy.Source -eq 'ssh') { 'ssh' } else { 'wsl' }
    $config.sshTarget = $legacy.SshTarget
}
if ($PSBoundParameters.ContainsKey('Ssh')) {
    $config.source = if ($Ssh) { 'ssh' } else { 'wsl' }
    $config.sshTarget = $Ssh
}
elseif ($Interactive -and -not $config.source) {
    $hostName = Read-Host 'Collector SSH host (user@host), or Enter for local WSL'
    $config.source = if ($hostName) { 'ssh' } else { 'wsl' }
    $config.sshTarget = $hostName
}
if (-not $config.source) { $config.source = 'wsl' }
if ($config.source -eq 'ssh' -and $config.sshTarget -notmatch '^[A-Za-z0-9_][A-Za-z0-9._-]*(@[A-Za-z0-9_][A-Za-z0-9._-]*)?$') { throw 'Use an SSH host or user@host.' }
$config.autostart = [bool]$Autostart
# Stop only this app and the prototypes it replaces; keep their saved state for rollback.
Get-Process -Name 'AgentUsage', 'AgentUsageFrame', 'CodexUsageFrame' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
# The key helper exits within one second of its parent stopping.
Start-Sleep -Milliseconds 1200
New-Item -ItemType Directory -Force -Path $installDir, $settingsDir, $startMenuDir | Out-Null
Copy-Item -Path (Join-Path $payload '*') -Destination $installDir -Recurse -Force
[IO.File]::WriteAllText($settingsPath, ($config | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut((Join-Path $startMenuDir 'Agent Usage.lnk'))
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $installDir
$shortcut.IconLocation = (Join-Path $installDir 'resources\icon.ico')
$shortcut.Description = 'Agent Usage - hold Ctrl+Shift+Space to reveal'
$shortcut.Save()
foreach ($name in @('Startup\Agent Usage.lnk', 'Startup\Codex Usage.lnk', 'Codex Usage.lnk', 'Update Agent Usage.lnk')) {
    Remove-Item -LiteralPath (Join-Path $startMenuDir $name) -Force -ErrorAction SilentlyContinue
}
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
New-Item -Path $runKey -Force | Out-Null
if ($Autostart) { Set-ItemProperty -Path $runKey -Name 'Agent Usage' -Value ('"' + $target + '"') }
else { Remove-ItemProperty -Path $runKey -Name 'Agent Usage' -ErrorAction SilentlyContinue }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'uninstall.ps1') -Destination $installDir -Force
Write-Host "Installed Electron build: $target"
Write-Host 'Starts invisible. Hold Ctrl+Shift+Space, then release and hover to inspect.'
Write-Host 'Right-click the notch for Pin, Settings, or Quit. Reopen from Start to reveal it.'
Write-Host 'This preview uses manual ZIP updates. Collector configuration is preserved.'
if ($Interactive) { Start-Process -FilePath $target }
