@echo off
echo =======================================================
echo   Laboratorio de Transmision de Datos - Simulador Web
echo =======================================================
echo.
echo Iniciando servidor HTTP en http://localhost:8000
echo Presiona Ctrl+C para detener el servidor.
echo.

cd /d "%~dp0"
start "" "http://localhost:8000"
python -m http.server 8000

pause

