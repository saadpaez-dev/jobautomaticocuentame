@echo off
title AGENTE LOCAL CUENTAME - Portal Bridge
cd /d "%~dp0"
echo ====================================================================
echo    AGENTE LOCAL CUENTAME - Puente Portal Web a Computador Local
echo ====================================================================
echo.
echo  Este proceso debe quedar ABIERTO mientras usas el portal web.
echo  Cuando hagas clic en "Ejecutar" en los RAMs pendientes del portal,
echo  este agente abrira automaticamente el robot en una nueva terminal.
echo.
echo  Puerto: http://127.0.0.1:3939
echo.
echo ====================================================================
echo.
node servicios/local-bridge.js
pause
