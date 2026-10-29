$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectDir

python -m pip install -r requirements-gui.txt
python -m PyInstaller --noconfirm --clean privacy_gui.spec

Write-Host "构建完成：$ProjectDir\dist\PrivacyDocumentTool.exe"
