@echo off
title CAPTURANDO PANTALLAZO ASISTENCIA RAM - CUENTAME
cd /d "%~dp0"
echo ====================================================================
echo    ROBOT DE CAPTURA DE PANTALLAZO ASISTENCIA RAM - CUENTAME
echo ====================================================================
echo Parametros de ejecucion: %*
node automatizaciones/capturar-pantallazo-ram.js %*
if errorlevel 1 (
    echo.
    echo ====================================================================
    echo    [ERROR] El proceso de captura de pantallazo RAM termino con errores.
    echo ====================================================================
    pause
) else (
    echo.
    echo ====================================================================
    echo    Captura de pantallazo RAM finalizada con exito.
    echo ====================================================================
    timeout /t 4
)
