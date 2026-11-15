@echo off
title CAPTURANDO PANTALLAZOS (BENEFICIARIOS ACTIVOS) - CUENTAME
cd /d "%~dp0"
echo ====================================================================
echo    ROBOT DE CAPTURA DE PANTALLAZOS (BENEFICIARIOS ACTIVOS) - CUENTAME
echo ====================================================================
echo Parametros de ejecucion: %*
node automatizaciones/capturar-pantallazo-jardin.js %*
if errorlevel 1 (
    echo.
    echo ====================================================================
    echo    [ERROR] El proceso de captura de pantallazos termino con errores.
    echo ====================================================================
    pause
) else (
    echo.
    echo ====================================================================
    echo    Captura de pantallazos finalizada con exito.
    echo ====================================================================
    timeout /t 5
)
