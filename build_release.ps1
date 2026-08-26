# Baut update.zip fuer die Verteilung an Nutzer - nur Code-Dateien, siehe
# UPDATE.md "Fuer dich als Entwickler: ein Update bauen". Nie data\, nie
# config.json, nie update.bat selbst (das bleibt unveraendert beim Nutzer).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$files = @("app", "static", "run.py", "requirements.txt", "VERSION", "CHANGELOG.md", "start.bat")

foreach ($f in $files) {
    if (-not (Test-Path $f)) {
        Write-Error "Erwartete Datei/Ordner fehlt: $f"
        exit 1
    }
}

if (Test-Path "update.zip") {
    Remove-Item "update.zip" -Force
}

Compress-Archive -Path $files -DestinationPath "update.zip" -Force

Write-Host "update.zip erstellt aus: $($files -join ', ')"
Write-Host "Ausgeschlossen (wie vorgesehen): data\, config.json, update.bat, dev_reset.*"
