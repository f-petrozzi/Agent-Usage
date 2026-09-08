$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$work = Join-Path $env:TEMP ('AgentUsageUpdate-' + [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $work | Out-Null
    # Resolve the release once so its ZIP and checksum cannot refer to different versions.
    $release = Invoke-RestMethod 'https://api.github.com/repos/f-petrozzi/Agent-Usage/releases/latest'
    $zip = @($release.assets | Where-Object name -eq 'AgentUsage-Windows.zip')[0]
    $sum = @($release.assets | Where-Object name -eq 'SHA256SUMS.txt')[0]
    if (-not $zip -or -not $sum) { throw 'The latest release is missing its installer or checksum.' }
    $archive = Join-Path $work 'AgentUsage-Windows.zip'
    Invoke-WebRequest -UseBasicParsing $zip.browser_download_url -OutFile $archive
    $checksum = (Invoke-WebRequest -UseBasicParsing $sum.browser_download_url).Content
    $match = [regex]::Match($checksum, '(?im)^([a-f0-9]{64})\s+\*?AgentUsage-Windows\.zip\s*$')
    if (-not $match.Success -or (Get-FileHash $archive -Algorithm SHA256).Hash -ne $match.Groups[1].Value) {
        throw 'Download checksum mismatch. The installed app was not replaced.'
    }
    Expand-Archive -LiteralPath $archive -DestinationPath $work
    & (Join-Path $work 'AgentUsage\windows\install.ps1') -Force -Interactive
}
catch { Write-Host $_ -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
