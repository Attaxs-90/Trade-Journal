@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo   Trade Journal - Update
echo ================================================
echo.

if not exist "update.zip" (
    echo Keine update.zip in diesem Ordner gefunden.
    echo.
    echo Bitte die neue update.zip-Datei in diesen Ordner legen
    echo ^(neben update.bat, in app_core\^) und update.bat erneut per
    echo Doppelklick starten.
    echo.
    pause
    exit /b 1
)

echo Beende Trade Journal, falls es noch laeuft...
rem Gezielt nur den Prozess auf Port 8420 beenden, nicht jeden Python-Prozess
rem auf dem Rechner (siehe CLAUDE.md).
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :8420 ^| findstr LISTENING') do (
    taskkill /F /PID %%p >nul 2>&1
)

echo Entpacke Update...
if exist "_update_tmp" rd /s /q "_update_tmp"
mkdir "_update_tmp"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path 'update.zip' -DestinationPath '_update_tmp' -Force"
if errorlevel 1 (
    echo.
    echo Fehler beim Entpacken der update.zip. Update wurde NICHT eingespielt.
    echo Deine Daten sind unangetastet.
    echo.
    pause
    exit /b 1
)

echo Spiele neue Programmdateien ein ^(deine Trades, Konten, Notizen und
echo Bilder in "data\" sowie "config.json" bleiben unangetastet^)...
robocopy "_update_tmp" "." /E /XF "config.json" "update.zip" /XD "data" "_update_tmp" /NFL /NDL /NJH /NJS >nul
if %errorlevel% GEQ 8 (
    echo.
    echo Beim Kopieren ist ein Fehler aufgetreten. Bitte pruefen, ob
    echo Trade Journal wirklich beendet ist, und update.bat erneut starten.
    echo.
    pause
    exit /b 1
)

echo Raeume temporaere Dateien auf...
rd /s /q "_update_tmp"
del "update.zip"

echo.
echo Installiere evtl. neue Abhaengigkeiten ^(kann einen Moment dauern^)...
python -m pip install -q -r requirements.txt

echo.
echo ================================================
echo   Update abgeschlossen! Deine Daten sind erhalten.
echo ================================================
echo.
echo Trade Journal kann jetzt ueber start.bat gestartet werden.
echo.
pause
