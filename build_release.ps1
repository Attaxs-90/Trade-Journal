# Baut update.zip fuer die Verteilung an Nutzer - nur Code-Dateien, siehe
# README_DEV.md "Update bauen und verteilen". Nie data\, nie config.json,
# nie update.bat selbst (das bleibt unveraendert beim Nutzer).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$files = @("app", "static", "run.py", "requirements.txt", "VERSION", "CHANGELOG.md", "start.bat", "README.md")

foreach ($f in $files) {
    if (-not (Test-Path $f)) {
        Write-Error "Erwartete Datei/Ordner fehlt: $f"
        exit 1
    }
}

if (Test-Path "update.zip") {
    Remove-Item "update.zip" -Force
}

# Ueber eine Staging-Kopie zippen statt direkt aus dem Projektordner, damit
# __pycache__-Ordner (entstehen beim lokalen Ausfuehren, ansonsten nicht Teil
# des Codes) nicht versehentlich mit ins update.zip wandern.
$staging = Join-Path $env:TEMP "trade-journal-release-staging"
if (Test-Path $staging) {
    Remove-Item $staging -Recurse -Force
}
New-Item -ItemType Directory -Path $staging | Out-Null

foreach ($f in $files) {
    Copy-Item $f -Destination $staging -Recurse
}
Get-ChildItem $staging -Directory -Recurse -Filter "__pycache__" | Remove-Item -Recurse -Force

Compress-Archive -Path (Join-Path $staging "*") -DestinationPath "update.zip" -Force
Remove-Item $staging -Recurse -Force

Write-Host "update.zip erstellt aus: $($files -join ', ')"
Write-Host "Ausgeschlossen (wie vorgesehen): data\, config.json, update.bat, dev_reset.*, __pycache__"
