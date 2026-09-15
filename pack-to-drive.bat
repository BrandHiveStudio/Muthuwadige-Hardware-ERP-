@echo off
title Package Muthuwadige Hardware ERP for Spark
setlocal EnableDelayedExpansion

set "PROJECT_DIR=E:\HARDWARE-ERP-GOLDEN-MASTER-2026-08-27\🔒 Golden Master"
set "TARGET_FOLDER=G:\My Drive\Muthuwadige Hardware ERP"
set "OUTPUT_ZIP=%TARGET_FOLDER%\Muthuwadige-ERP-Latest.zip"

echo ========================================================
echo  Packaging Clean ERP Source for Gemini Spark...
echo ========================================================
echo Project Directory: %PROJECT_DIR%
echo Target Archive   : %OUTPUT_ZIP%
echo.

if not exist "%TARGET_FOLDER%" mkdir "%TARGET_FOLDER%"

cd /d "%PROJECT_DIR%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$targetFolder = '%TARGET_FOLDER%';" ^
  "$outputZip = '%OUTPUT_ZIP%';" ^
  "Write-Host 'Cleaning any older archives in Google Drive folder...';" ^
  "Get-ChildItem -Path $targetFolder -Filter '*.zip' | ForEach-Object { Remove-Item -Force $_.FullName };" ^
  "$excludeFolders = @('node_modules', '.git', 'dist', 'release-dist', 'win-unpacked', 'backups', 'coverage', '.gemini', '.vscode', 'scratch');" ^
  "$excludeFiles = @('*.db', '*.db-wal', '*.db-shm', '*.db-journal', '*.log', '*.exe', '*.zip', '*.tar.gz');" ^
  "Write-Host 'Collecting clean source code files...';" ^
  "$files = Get-ChildItem -Recurse -File | Where-Object {" ^
  "  $path = $_.FullName;" ^
  "  $skip = $false;" ^
  "  foreach ($folder in $excludeFolders) { if ($path -match ('[\\\\/]' + [regex]::Escape($folder) + '[\\\\/]')) { $skip = $true; break } }" ^
  "  if (-not $skip) {" ^
  "    foreach ($pattern in $excludeFiles) { if ($_ -like $pattern) { $skip = $true; break } }" ^
  "  }" ^
  "  -not $skip" ^
  "};" ^
  "Write-Host ('Compressing ' + $files.Count + ' files to Google Drive...');" ^
  "Compress-Archive -Path $files.FullName -DestinationPath $outputZip -CompressionLevel Optimal -Force;" ^
  "Write-Host 'Clean package successfully created!'"

echo.
echo ========================================================
echo  Complete! Single latest archive ready in Google Drive.
echo ========================================================
timeout /t 3