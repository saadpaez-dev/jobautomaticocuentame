@echo off
title DESVINCULANDO BENEFICIARIO - CUENTAME
cd /d "%~dp0"
echo ====================================================================
echo    ROBOT DE DESVINCULACION DE BENEFICIARIOS - CUENTAME ICBF
echo ====================================================================
echo Parametros de ejecucion: %*
node automatizaciones/desvinculacion-beneficiarios.js %*
if errorlevel 1 (
    echo.
    echo ====================================================================
    echo    [ERROR] El proceso termino con errores.
    echo ====================================================================
    pause
) else (
    echo.
    echo ====================================================================
    echo    Desvinculacion procesada con exito.
    echo ====================================================================
    timeout /t 5
)
