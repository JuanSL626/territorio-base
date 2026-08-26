@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   Territorio Base
echo ============================================
echo.

if not exist "pyproject.toml" (
    echo No encuentro "pyproject.toml" en esta carpeta.
    echo Es probable que este .bat se haya ejecutado desde ADENTRO del ZIP
    echo descargado, sin extraerlo antes.
    echo.
    echo Solucion: haz click derecho sobre el archivo ZIP que descargaste de
    echo GitHub, elegi "Extraer todo..." y despues abri la carpeta ya
    echo extraida y hace doble click en Iniciar_App.bat desde ahi.
    pause
    exit /b 1
)

where uv >nul 2>nul
if not errorlevel 1 goto :have_uv

echo No se encontro "uv" instalado en esta computadora.
echo Instalandolo automaticamente, un momento...
echo.

where winget >nul 2>nul
if errorlevel 1 goto :install_with_powershell

winget install --id=astral-sh.uv -e --source winget --accept-package-agreements --accept-source-agreements
if errorlevel 1 goto :install_with_powershell
set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"
goto :check_uv_installed

:install_with_powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing https://astral.sh/uv/install.ps1 | Invoke-Expression"
set "PATH=%USERPROFILE%\.local\bin;%PATH%"

:check_uv_installed
where uv >nul 2>nul
if errorlevel 1 (
    echo.
    echo No se pudo instalar "uv" automaticamente en esta computadora.
    echo Esto puede pasar si el antivirus/la politica de la empresa bloquea
    echo instalar programas por PowerShell o winget.
    echo.
    echo Instalalo a mano desde https://docs.astral.sh/uv/getting-started/installation/
    echo y despues volve a hacer doble click en este archivo.
    pause
    exit /b 1
)
echo uv instalado correctamente.
echo.

:have_uv
echo Instalando dependencias del proyecto...
echo (la primera vez puede tardar varios minutos; las siguientes es instantaneo)
echo.
uv sync
if errorlevel 1 (
    echo.
    echo Hubo un error instalando las dependencias. Revisa el mensaje de arriba.
    pause
    exit /b 1
)

echo.
echo Abriendo la app en el navegador...
echo (para cerrarla, volve a esta ventana y presiona Ctrl+C, o simplemente cerrala)
echo.
uv run streamlit run app.py

echo.
echo La app se cerro. Presiona una tecla para cerrar esta ventana.
pause >nul
