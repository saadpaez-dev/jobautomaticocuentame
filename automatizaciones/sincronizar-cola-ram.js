/**
 * sincronizar-cola-ram.js
 * Script de ejecución directa para sincronizar la cola de RAMs pendientes
 * reportados desde el Portal Web (Render) hacia la plataforma oficial Cuéntame.
 */

process.env.MODO_RAM_DIRECTO = 'FASE3';

if (process.argv[2]) {
    process.env.RADICADO_OBJETIVO = process.argv[2];
}

require('./llenar-asistencia.js');
