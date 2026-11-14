@echo off
title REGISTRO DE PESO Y TALLA - CUENTAME
cd /d "%~dp0"
echo ====================================================================
echo    ROBOT DE REGISTRO DE PESO Y TALLA (NUTRICION) - CUENTAME ICBF
echo ====================================================================
echo Parametros de ejecucion: %*
node automatizaciones/peso-talla.js %*
if errorlevel 1 (
    echo.
    echo ====================================================================
    echo    [ERROR] El proceso termino con errores.
    echo ====================================================================
    pause
) else (
    echo.
    echo ====================================================================
    echo    Registro de Peso y Talla finalizado.
    echo ====================================================================
    timeout /t 5
)
