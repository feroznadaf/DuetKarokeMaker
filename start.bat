@echo off
setlocal enabledelayedexpansion
title Duet Karaoke Maker (Ultra-Lite)

cd /d "%~dp0"

echo ===================================================
echo     🎤 Duet Karaoke Maker (Ultra-Lite Edition)
echo     Optimized for 4GB RAM ^& Standard Hard Disk
echo ===================================================
echo.

:: 1. Try launching with Node.js (fastest, uses ~25MB RAM, instant boot)
where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [*] Node.js detected! Starting local lite server...
    start "" http://localhost:3000
    node server.js
    goto :end
)

:: 2. Fallback to Python if Node.js is missing
where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [*] Python detected! Starting standard library server...
    start "" http://localhost:3000
    python server.py
    goto :end
)

where py >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [*] Python detected! Starting standard library server...
    start "" http://localhost:3000
    py -3 server.py
    goto :end
)

:: 3. Universal Fallback: Open index.html directly in browser
echo [*] Opening standalone browser studio directly...
start "" "%~dp0public\index.html"

:end
if %ERRORLEVEL% neq 0 (
    echo.
    echo [!] Server exited. Press any key to close this window.
    pause >nul
)
