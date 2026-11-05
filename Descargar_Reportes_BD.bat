@echo off
title ACTUALIZANDO BD Y REPORTES - CUENTAME
cd /d "%~dp0"
echo ====================================================================
echo    ROBOT DE REPORTES Y BASE DE DATOS MASTER - CUENTAME ICBF
echo ====================================================================
echo Parametros de ejecucion: %*
node automatizaciones/descargar-reportes.js %*
if errorlevel 1 (
    echo.
    echo ====================================================================
    echo    [ERROR] El proceso termino con errores.
    echo ====================================================================
    pause
) else (
    echo.
    echo ====================================================================
    echo    Actualizacion completada exitosamente.
    echo ====================================================================
    pause
)
