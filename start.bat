@echo off
cd /d "%~dp0"
title Trade Journal

rem Duenner, kaum aenderbarer Einstiegspunkt - der eigentliche Code liegt in
rem app_core\ und wird darueber aktualisiert. start.bat selbst bleibt stabil,
rem damit sich eine laufende .bat-Datei nie selbst ueberschreiben muss.
powershell -NoProfile -ExecutionPolicy Bypass -File "app_core\update_check.ps1"

cd /d "%~dp0"
python app_core\run.py

if errorlevel 1 (
    echo.
    echo ============================================
    echo   Start fehlgeschlagen.
    echo ============================================
    echo Moegliche Ursache: Python ist nicht installiert, oder
    echo benoetigte Pakete fehlen. Versuche jetzt die Installation
    echo der Pakete...
    echo.
    python -m pip install -r app_core\requirements.txt
    echo.
    echo Bitte "start.bat" jetzt noch einmal ausfuehren.
    echo.
    pause
)
