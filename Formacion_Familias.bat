@echo off
title FORMACION A FAMILIAS - CUENTAME
cd /d "%~dp0"
echo ====================================================================
echo    ROBOT DE FORMACION A FAMILIAS - CUENTAME ICBF
echo ====================================================================
echo Parametros de ejecucion: %*
node automatizaciones/formacion-familias.js %*
if errorlevel 1 (
    echo.
    echo ====================================================================
    echo    [ERROR] El proceso de Formacion a Familias termino con errores.
    echo ====================================================================
    pause
) else (
    echo.
    echo ====================================================================
    echo    Formacion a Familias procesada con exito.
    echo ====================================================================
    timeout /t 5
)
