@echo off
title GENERANDO CUENTAS DE COBRO Y PAZ Y SALVO
cd /d "%~dp0"
echo ====================================================================
echo    ROBOT DE CUENTAS DE COBRO Y PAZ Y SALVO
echo ====================================================================
echo Parametros de ejecucion: %*
node automatizaciones/generar-cuentas-cobro.js %*
if errorlevel 1 (
    echo.
    echo ====================================================================
    echo    [ERROR] El proceso termino con errores.
    echo ====================================================================
    pause
) else (
    echo.
    echo ====================================================================
    echo    Cuentas de cobro generadas exitosamente.
    echo ====================================================================
    timeout /t 5
)
