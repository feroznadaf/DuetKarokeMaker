@echo off
title Push Duet Karaoke Maker to GitHub
cd /d "%~dp0"

echo ===================================================
echo     Pushing Duet Karaoke Maker to GitHub
echo     Target: https://github.com/feroznadaf/DuetKarokeMaker
echo ===================================================
echo.

set "GIT_CMD=git"
where git >nul 2>nul
if %ERRORLEVEL% neq 0 (
    if exist "C:\Program Files\Git\cmd\git.exe" (
        set "GIT_CMD=C:\Program Files\Git\cmd\git.exe"
    ) else if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\git.exe" (
        set "GIT_CMD=%LOCALAPPDATA%\Microsoft\WinGet\Links\git.exe"
    )
)

"%GIT_CMD%" push origin main

if %ERRORLEVEL% equ 0 (
    echo.
    echo ===================================================
    echo [SUCCESS] Pushed to GitHub successfully!
    echo Vercel will automatically trigger the build and deploy.
    echo ===================================================
) else (
    echo.
    echo [!] Push failed or authorization was cancelled.
)
echo.
pause

