$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ReleaseDir = Join-Path $ProjectDir 'release'
New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null
$IncludeNames = @('manifest.json', 'background.js', 'core.js', 'api.js', 'app.html', 'app.js', 'settings.html', 'settings.js', 'styles.css', 'templates', 'README.md')
$IncludePaths = $IncludeNames | ForEach-Object { Join-Path $ProjectDir $_ }
Compress-Archive -LiteralPath $IncludePaths -DestinationPath (Join-Path $ReleaseDir 'privacy-chrome-extension.zip') -Force
Write-Host "分发包：$ReleaseDir\privacy-chrome-extension.zip"
