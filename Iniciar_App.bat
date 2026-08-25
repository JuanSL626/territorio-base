@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   Territorio Base
echo ============================================
echo.

where uv >nul 2>nul
if errorlevel 1 (
    echo No se encontro "uv" instalado en esta computadora.
    echo Instalandolo automaticamente, un momento...
    echo.
    powershell -NoProfile -ExecutionPolicy ByPass -Command "irm https://astral.sh/uv/install.ps1 | iex"
    if errorlevel 1 (
        echo.
        echo No se pudo instalar "uv" automaticamente.
        echo Instalalo a mano desde https://docs.astral.sh/uv/getting-started/installation/
        echo y despues volve a hacer doble click en este archivo.
        pause
        exit /b 1
    )
    set "PATH=%USERPROFILE%\.local\bin;%PATH%"
    echo.
)

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
