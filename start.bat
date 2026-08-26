@echo off
cd /d "%~dp0"
title Trade Journal

python run.py

if errorlevel 1 (
    echo.
    echo ============================================
    echo   Start fehlgeschlagen.
    echo ============================================
    echo Moegliche Ursache: Python ist nicht installiert, oder
    echo benoetigte Pakete fehlen. Versuche jetzt die Installation
    echo der Pakete...
    echo.
    python -m pip install -r requirements.txt
    echo.
    echo Bitte "start.bat" jetzt noch einmal ausfuehren.
    echo.
    pause
)
