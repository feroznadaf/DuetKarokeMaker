@echo off
title Push Duet Karaoke Maker to GitHub
cd /d "%~dp0"

echo ===================================================
echo     Pushing Duet Karaoke Maker to GitHub
echo     Target: https://github.com/firoznadafsnabbit/duetkarokemaker
echo ===================================================
echo.

set "GIT_CMD=C:\Users\firoz\AppData\Local\Microsoft\WinGet\Packages\Git.MinGit_Microsoft.Winget.Source_8wekyb3d8bbwe\cmd\git.exe"

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
