@echo off
title AGENTE LOCAL CUENTAME - Portal Bridge
cd /d "%~dp0"
echo ====================================================================
echo    AGENTE LOCAL CUENTAME - Puente Portal Web a Computador Local v2.0
echo ====================================================================
echo.
echo  Este proceso debe quedar ABIERTO mientras usas el portal web o celular.
echo  Cuando hagas clic en "Ejecutar" en los RAMs pendientes desde tu celular
echo  o computador, este agente abrira automaticamente el robot en pantalla.
echo.
echo  Puerto Local: http://127.0.0.1:3939
echo  Nube: Conectado a https://portal-cuentame.onrender.com
echo.
echo ====================================================================
echo.
node servicios/local-bridge.js
pause
