@echo off
:: =========================================================================
::  MUTHUWADIGE HARDWARE ERP - ZERO-RESIDUE CLEAN & RESET SCRIPT
::  Target: Test / Counter Workstation
:: =========================================================================
title ERP Deep Clean Utility
color 0C
cls

echo =========================================================================
echo    MUTHUWADIGE HARDWARE ERP - PURGING APP DATA, PROCESSES & CACHES
echo =========================================================================
echo.
echo  WARNING: This will close the ERP, terminate lingering Node/Electron
echo  tasks, and completely wipe the local SQLite database and Chromium cache.
echo.
echo  Press any key to proceed, or close this window to cancel...
pause >nul

color 0E
cls
echo =========================================================================
echo  [STEP 1/4] Terminating all active and orphaned processes...
echo =========================================================================
taskkill /F /IM "Muthuwadige Hardware ERP.exe" /T 2>nul
taskkill /F /IM "electron.exe" /T 2>nul
taskkill /F /IM "node.exe" /T 2>nul
timeout /t 2 /nobreak >nul
echo Done.
echo.

echo =========================================================================
echo  [STEP 2/4] Wiping AppData Roaming (DB, LocalStorage, Chromium Cache)...
echo =========================================================================
set "TARGET_ROAMING=%APPDATA%\Muthuwadige Hardware ERP"
if exist "%TARGET_ROAMING%" (
    echo Deleting: "%TARGET_ROAMING%"
    rmdir /S /Q "%TARGET_ROAMING%" 2>nul
    if exist "%TARGET_ROAMING%" (
        echo [!] Warning: Some files are locked. Retrying after task kill...
        taskkill /F /IM "electron.exe" /T 2>nul
        rmdir /S /Q "%TARGET_ROAMING%" 2>nul
    )
    echo Roaming data successfully purged.
) else (
    echo Roaming directory is already clean.
)
echo.

echo =========================================================================
echo  [STEP 3/4] Wiping AppData Local (Updater, Cache, Unpacked Binaries)...
echo =========================================================================
set "TARGET_LOCAL_UPDATER=%LOCALAPPDATA%\muthuwadige_hardware_erp-updater"
if exist "%TARGET_LOCAL_UPDATER%" (
    echo Deleting updater cache...
    rmdir /S /Q "%TARGET_LOCAL_UPDATER%" 2>nul
)

set "TARGET_LOCAL_PROGRAMS=%LOCALAPPDATA%\Programs\muthuwadige-hardware-erp"
if exist "%TARGET_LOCAL_PROGRAMS%" (
    echo Deleting local program files...
    rmdir /S /Q "%TARGET_LOCAL_PROGRAMS%" 2>nul
)

set "TARGET_ELECTRON_CACHE=%LOCALAPPDATA%\electron\Cache"
if exist "%TARGET_ELECTRON_CACHE%" (
    echo Deleting generic Electron cache...
    rmdir /S /Q "%TARGET_ELECTRON_CACHE%" 2>nul
)
echo Local caches successfully purged.
echo.

echo =========================================================================
echo  [STEP 4/4] Clearing Windows Temp files associated with the ERP...
echo =========================================================================
del /F /Q /S "%TEMP%\*muthuwadige*" 2>nul
del /F /Q /S "%TEMP%\*electron*" 2>nul
echo Temp directories cleared.
echo.

color 0A
echo =========================================================================
echo  STATUS: COMPLETE! The PC is 100%% clean of previous ERP data.
echo  You can now install 'Muthuwadige Hardware ERP Setup 0.0.2.exe'.
echo =========================================================================
echo.
echo Press any key to exit...
pause >nul
exit /b 0