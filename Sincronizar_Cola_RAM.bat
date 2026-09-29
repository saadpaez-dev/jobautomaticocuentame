@echo off
title SINCRONIZAR COLA DE RAMS - CUENTAME ICBF
cd /d "%~dp0"
echo ====================================================================
echo    ROBOT SINCRONIZADOR DE RAMS - PORTAL CUENTAME A PLATAFORMA ICBF
echo ====================================================================
echo.
node automatizaciones/sincronizar-cola-ram.js
pause
