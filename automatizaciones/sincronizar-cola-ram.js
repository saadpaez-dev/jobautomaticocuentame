/**
 * sincronizar-cola-ram.js
 * Script de ejecución directa para sincronizar la cola de RAMs pendientes
 * reportados desde el Portal Web (Render) hacia la plataforma oficial Cuéntame.
 */

process.env.MODO_RAM_DIRECTO = 'FASE3';
require('./llenar-asistencia.js');
