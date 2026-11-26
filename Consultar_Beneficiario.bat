@echo off
title CONSULTANDO BENEFICIARIO EN CUENTAME ICBF
cd /d "%~dp0"
echo ====================================================================
echo    ROBOT DE CONSULTA DE BENEFICIARIO (HISTORIAL) - CUENTAME ICBF
echo ====================================================================
echo Parametros de ejecucion: %*
node automatizaciones/consultar-beneficiario-cuentame.js %*
if errorlevel 1 (
    echo.
    echo ====================================================================
    echo    [ERROR] La consulta de beneficiario termino con errores.
    echo ====================================================================
    pause
) else (
    echo.
    echo ====================================================================
    echo    Consulta y extraccion de historial finalizada con exito.
    echo ====================================================================
    timeout /t 5
)
