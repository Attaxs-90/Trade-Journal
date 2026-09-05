# Prueft beim Start, ob im GitHub-Repo eine neuere Version als Release
# vorliegt, fragt bei Fund per Ja/Nein und spielt bei Zustimmung das
# "update.zip"-Release-Asset nach app_core\ ein (nie nach start.bat/data/
# config.json - die liegen ausserhalb von app_core\ und werden hier nie
# angefasst). Jeder Fehler (kein Internet, kein Token, Repo nicht erreichbar)
# wird abgefangen und fuehrt zu einem stillen Ueberspringen - die App muss
# auch offline ganz normal starten.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$repo = "Attaxs-90/Trade-Journal"
$tokenPath = Join-Path $PSScriptRoot "..\github_token.txt"
$versionPath = Join-Path $PSScriptRoot "VERSION"

try {
    $localVersion = (Get-Content $versionPath -Raw).Trim()

    $headers = @{ "User-Agent" = "trade-journal-update-check" }
    if (Test-Path $tokenPath) {
        $token = (Get-Content $tokenPath -Raw).Trim()
        if ($token) {
            $headers["Authorization"] = "token $token"
        }
    }

    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers $headers -TimeoutSec 8
    $remoteVersion = $release.tag_name.TrimStart("v")

    if ($remoteVersion -eq $localVersion) {
        exit 0
    }

    Write-Host ""
    Write-Host "Update verfuegbar: v$remoteVersion (aktuell installiert: v$localVersion)"
    $answer = Read-Host "Jetzt aktualisieren? (J/N)"
    if ($answer -notmatch "^[jJ]") {
        Write-Host "Update uebersprungen."
        exit 0
    }

    $asset = $release.assets | Where-Object { $_.name -eq "update.zip" }
    if (-not $asset) {
        Write-Host "Kein update.zip im Release gefunden - Update abgebrochen."
        exit 0
    }

    Write-Host "Lade Update herunter..."
    $downloadHeaders = $headers.Clone()
    $downloadHeaders["Accept"] = "application/octet-stream"
    $zipPath = Join-Path $env:TEMP "trade-journal-update.zip"
    Invoke-WebRequest -Uri $asset.url -Headers $downloadHeaders -OutFile $zipPath -TimeoutSec 60

    Write-Host "Entpacke Update..."
    $stagingPath = Join-Path $env:TEMP "trade-journal-update-staging"
    if (Test-Path $stagingPath) { Remove-Item $stagingPath -Recurse -Force }
    Expand-Archive -Path $zipPath -DestinationPath $stagingPath -Force

    Write-Host "Spiele neue Programmdateien ein..."
    # app\ und static\ werden GESPIEGELT (/MIR), nicht nur ueberschrieben:
    # /E kopiert und ersetzt zwar, loescht aber nie - Dateien, die es in der
    # neuen Version nicht mehr gibt, blieben dadurch fuer immer liegen (so
    # ueberlebte z. B. die alte static\app.js die Aufteilung in static\js\).
    # Beide Ordner enthalten ausschliesslich Programmcode und stecken
    # vollstaendig im Paket; Nutzerdaten liegen ausserhalb von app_core\.
    foreach ($dir in @("app", "static")) {
        robocopy (Join-Path $stagingPath $dir) (Join-Path $PSScriptRoot $dir) /MIR /NFL /NDL /NJH /NJS | Out-Null
        if ($LASTEXITCODE -ge 8) {
            Write-Host "Fehler beim Kopieren - Update wurde NICHT vollstaendig eingespielt."
            exit 0
        }
    }
    # Die losen Dateien im Wurzelverzeichnis werden nur kopiert, NICHT
    # gespiegelt: dort liegen auch Dateien, die nicht Teil des Pakets sind
    # (update.bat, dev_reset.*, build_release.ps1). Ohne /E und /S greift
    # robocopy ohnehin nur die oberste Ebene ab.
    robocopy $stagingPath $PSScriptRoot /XD "app" "static" /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) {
        Write-Host "Fehler beim Kopieren - Update wurde NICHT vollstaendig eingespielt."
        exit 0
    }

    Remove-Item $stagingPath -Recurse -Force
    Remove-Item $zipPath -Force

    Write-Host "Installiere evtl. neue Abhaengigkeiten..."
    python -m pip install -q -r (Join-Path $PSScriptRoot "requirements.txt")

    Set-Content -Path $versionPath -Value $remoteVersion -NoNewline
    Write-Host "Update auf v$remoteVersion abgeschlossen."
    Write-Host ""
}
catch {
    Write-Host "Update-Pruefung uebersprungen (kein Internet oder Repo nicht erreichbar)."
}
