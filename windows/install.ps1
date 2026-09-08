[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$Autostart,
    [switch]$Interactive,
    # Read the collector on another machine over SSH instead of in WSL, e.g.
    # -Ssh user@host. Point this at whichever box actually runs your agents:
    # the usage numbers are the same either way, but only that box knows when
    # a prompt ran, which is what drives the frame's refresh cadence.
    [string]$Ssh
)

$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot 'AgentUsageFrame.cs'
$installDir = Join-Path $env:LOCALAPPDATA 'AgentUsageFrame'
$target = Join-Path $installDir 'AgentUsageFrame.exe'
$startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$startMenuShortcut = Join-Path $startMenuDir 'Agent Usage.lnk'
$startupDir = Join-Path $startMenuDir 'Startup'
$startupShortcut = Join-Path $startupDir 'Agent Usage.lnk'

# Updates preserve the selected collector host unless explicitly overridden.
$statePath = Join-Path $installDir 'state.json'
$savedSource = $null
if (Test-Path -LiteralPath $statePath) {
    try { $savedSource = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } catch { }
}
if (-not $PSBoundParameters.ContainsKey('Ssh')) {
    if ($savedSource -and $savedSource.Source -eq 'ssh') { $Ssh = $savedSource.SshTarget }
    elseif ($Interactive -and -not $savedSource) {
        $Ssh = Read-Host 'Collector SSH host (user@host), or Enter for local WSL'
    }
}

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Missing source file: $source"
}

if ($Ssh) {
    if ($Ssh -notmatch '^[A-Za-z0-9._-]+(@[A-Za-z0-9._-]+)?$') {
        throw "Invalid SSH target: $Ssh. Use host or user@host."
    }
    if (-not (Get-Command ssh.exe -ErrorAction SilentlyContinue)) {
        throw 'ssh.exe was not found. Enable the Windows OpenSSH client first.'
    }
}
elseif (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw 'wsl.exe was not found. Install or enable WSL first.'
}

if ((Test-Path -LiteralPath $target) -and -not $Force) {
    throw "Refusing to replace $target. Re-run with -Force to update it."
}

$compilerCandidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $compiler) {
    throw 'The Windows .NET Framework C# compiler was not found.'
}

if ($Ssh) {
    & ssh.exe -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new `
        $Ssh 'test -x ~/.local/bin/agent-usage' 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw ("Could not reach the collector at ${Ssh}:~/.local/bin/agent-usage. " +
            'Check key-based SSH works without a password prompt, and that ' +
            'scripts/install-agent-usage.sh has been run over there.')
    }
}
else {
    & wsl.exe --exec sh -lc 'test -x "$HOME/.local/bin/agent-usage"' 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw 'The WSL collector is missing. Run scripts/install-agent-usage.sh inside WSL first.'
    }
}

Get-Process -Name 'AgentUsageFrame' -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$buildTarget = Join-Path $env:TEMP ('AgentUsageFrame-' + [guid]::NewGuid().ToString('N') + '.exe')
try {
    & $compiler `
        /nologo `
        /target:winexe `
        /optimize+ `
        /codepage:65001 `
        "/out:$buildTarget" `
        "/win32icon:$(Join-Path $PSScriptRoot 'assets\agent-usage.ico')" `
        /reference:System.dll `
        /reference:System.Core.dll `
        /reference:System.Drawing.dll `
        /reference:System.Web.Extensions.dll `
        /reference:System.Windows.Forms.dll `
        $source
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $buildTarget)) {
        throw 'Compilation failed.'
    }

    $selfTest = Start-Process -FilePath $buildTarget -ArgumentList '--self-test' -Wait -PassThru
    if ($selfTest.ExitCode -ne 0) {
        throw 'The compiled application failed its parser self-test.'
    }

    Copy-Item -LiteralPath $buildTarget -Destination $target -Force
}
finally {
    Remove-Item -LiteralPath $buildTarget -Force -ErrorAction SilentlyContinue
}

# Record where to read from, keeping any window position already saved.
$statePath = Join-Path $installDir 'state.json'
$frameState = @{}
if (Test-Path -LiteralPath $statePath) {
    try {
        $saved = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        foreach ($property in $saved.PSObject.Properties) {
            $frameState[$property.Name] = $property.Value
        }
    }
    catch { $frameState = @{} }
}
if ($Ssh) {
    $frameState['Source'] = 'ssh'
    $frameState['SshTarget'] = $Ssh
}
else {
    $frameState['Source'] = 'wsl'
}
$frameState | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

function New-AgentUsageShortcut {
    param([Parameter(Mandatory = $true)][string]$Path)
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = $target
    $shortcut.WorkingDirectory = $installDir
    $shortcut.IconLocation = "$target,0"
    $shortcut.Description = 'Codex and Claude usage limits, read through WSL'
    $shortcut.Save()
}

New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null
New-AgentUsageShortcut -Path $startMenuShortcut

if ($Autostart) {
    New-Item -ItemType Directory -Force -Path $startupDir | Out-Null
    New-AgentUsageShortcut -Path $startupShortcut
}

# Retire the Codex-only frame this replaces, so two overlays cannot both run.
$legacyDir = Join-Path $env:LOCALAPPDATA 'CodexUsageFrame'
$legacyShortcuts = @(
    (Join-Path $startMenuDir 'Codex Usage.lnk'),
    (Join-Path $startupDir 'Codex Usage.lnk')
)
$removedLegacy = $false
foreach ($shortcut in $legacyShortcuts) {
    if (Test-Path -LiteralPath $shortcut) {
        Remove-Item -LiteralPath $shortcut -Force -ErrorAction SilentlyContinue
        $removedLegacy = $true
    }
}
Get-Process -Name 'CodexUsageFrame' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $legacyDir) {
    Remove-Item -LiteralPath $legacyDir -Recurse -Force -ErrorAction SilentlyContinue
    $removedLegacy = $true
}

$hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
Write-Host "Installed: $target"
Write-Host "SHA-256:  $hash"
if ($Ssh) {
    Write-Host "Reading usage over SSH from $Ssh."
}
else {
    Write-Host 'Reading usage from the WSL collector.'
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'update.ps1') -Destination (Join-Path $installDir 'update.ps1') -Force
$updateShortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $startMenuDir 'Update Agent Usage.lnk'))
$updateShortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$updateShortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $installDir 'update.ps1') + '"'
$updateShortcut.IconLocation = "$target,0"
$updateShortcut.Save()
Write-Host 'Launch Agent Usage from Start. Use Update Agent Usage there for future releases.'
if ($Interactive) { Start-Process -FilePath $target }
if ($Autostart) {
    Write-Host 'Enabled startup at Windows sign-in.'
}
if ($removedLegacy) {
    Write-Host 'Removed the old Codex Usage frame it replaces.'
}
