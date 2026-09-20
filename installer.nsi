!include "MUI2.nsh"

Name "Muthuwadige Hardware ERP Server"
OutFile "dist\Hardware-ERP-Server-Setup.exe"
InstallDir "$PROGRAMFILES64\Muthuwadige Hardware ERP Server"

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File "dist\server-backend.exe"
  File "hardware.db"
  File ".env"
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd
