@echo off
title Lanzador de Navegador para el Bot de Cuentame
color 0B

echo =======================================================
echo    Lanzador de Navegador en Modo Depuracion (Puerto 9222)
echo =======================================================
echo.
echo Para que el bot pueda leer tu navegador, debes cerrarlo
echo completamente antes de usar este lanzador.
echo.
echo Selecciona tu navegador:
echo 1. Google Chrome
echo 2. Brave
echo 3. Edge
echo.
set /p navChoice="Ingresa 1, 2 o 3: "

if "%navChoice%"=="1" (
    echo Iniciando Google Chrome...
    start chrome.exe --remote-debugging-port=9222 --no-first-run --no-default-browser-check --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data Bot" https://rubonline.icbf.gov.co
) else if "%navChoice%"=="2" (
    echo Iniciando Brave...
    start brave.exe --remote-debugging-port=9222 --no-first-run --no-default-browser-check --user-data-dir="%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data Bot" https://rubonline.icbf.gov.co
) else if "%navChoice%"=="3" (
    echo Iniciando Microsoft Edge...
    start msedge.exe --remote-debugging-port=9222 --no-first-run --no-default-browser-check --user-data-dir="%LOCALAPPDATA%\Microsoft\Edge\User Data Bot" https://rubonline.icbf.gov.co
) else (
    echo Opcion invalida.
    pause
    exit
)

echo.
echo Navegador iniciado!
echo 1. Inicia sesion en Cuentame normalmente (es posible que te pida 2FA o Captcha una sola vez).
echo 2. Deja la pestana de Cuentame abierta.
echo 3. Abre otra ventana de comandos (Terminal) y ejecuta el bot (peso-talla, reportes o asistencia).
echo.
pause
