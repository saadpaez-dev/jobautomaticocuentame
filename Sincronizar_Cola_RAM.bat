@echo off
title SINCRONIZAR COLA DE RAM - CUENTAME ICBF
cd /d "%~dp0"
echo ====================================================================
echo    ROBOT SINCRONIZADOR DE RAMS - PORTAL CUENTAME A PLATAFORMA ICBF
echo ====================================================================
if not "%~1"=="" (
    echo [OBJETIVO] Sincronizando radicado especifico: %~1
    set RADICADO_OBJETIVO=%~1
    node automatizaciones/sincronizar-cola-ram.js "%~1"
) else (
    echo [COLA] Sincronizando todos los RAMs pendientes...
    node automatizaciones/sincronizar-cola-ram.js
)
echo.
echo ====================================================================
echo    Proceso finalizado. Cerrando esta ventana en 2 segundos...
echo ====================================================================
timeout /t 2 /nobreak >nul
exit
