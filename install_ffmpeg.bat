@echo off
title Install FFmpeg (Duet Karaoke Maker)
echo ===================================================
echo     Installing FFmpeg via Windows Package Manager
echo ===================================================
echo.
echo Installing Gyan.FFmpeg for high-speed video rendering...
echo.
winget install Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements

if %ERRORLEVEL% equ 0 (
    echo.
    echo ===================================================
    echo [SUCCESS] FFmpeg installed successfully!
    echo Please restart your terminal/browser if needed.
    echo ===================================================
) else (
    echo.
    echo [NOTE] Winget install returned code %ERRORLEVEL%.
    echo If winget requires administrator privileges, please right-click this file and select "Run as administrator".
    echo Alternatively, you can always use the "In-Browser 1080p Video" render button which requires zero FFmpeg installation!
)

echo.
pause
