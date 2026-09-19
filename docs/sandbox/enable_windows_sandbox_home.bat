@echo off
:: Enable Windows Sandbox on Windows 11 Home
:: Run this script as Administrator (Right click -> Run as administrator)

echo ======================================================================
echo ENABLING WINDOWS SANDBOX ON WINDOWS 11 HOME (BUILD %OS%)
echo ======================================================================
echo.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] This script must be run as Administrator!
    echo Right click this file and select 'Run as administrator'.
    echo.
    pause
    exit /b 1
)

echo [1/3] Registering Containers-DisposableClientVM packages...
for /f "tokens=*" %%i in ('dir /b /s "%SystemRoot%\servicing\Packages\*Containers-DisposableClientVM*.mum"') do (
    echo Installing %%~nxi...
    dism /online /norestart /add-package:"%%i"
)

echo.
echo [2/3] Enabling Windows Sandbox Optional Feature...
dism /online /enable-feature /featurename:Containers-DisposableClientVM /All /NoRestart

echo.
echo ======================================================================
echo [3/3] SETUP COMPLETED
echo A computer RESTART is required to finalize Windows Sandbox activation.
echo After rebooting, double-click 'muthuwadige_erp_isolated.wsb' to launch.
echo ======================================================================
pause
