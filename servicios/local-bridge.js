/**
 * local-bridge.js
 * Servidor HTTP local (http://127.0.0.1:3939) que actúa como puente
 * entre el Portal Web (Render/cloud) y el bot local de Playwright (jobautomatico).
 *
 * Cuando el administrador hace clic en "⚡ Ejecutar" en el portal,
 * el navegador hace fetch a http://localhost:3939/api/ejecutar-ram
 * y este servidor lanza sincronizar-cola-ram.js en una nueva terminal.
 *
 * Uso:
 *   node servicios/local-bridge.js
 *   (o arrancarlo desde Iniciar_Agente_Local.bat)
 */

'use strict';

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const url = require('url');

const PUERTO = 3939;
const HOST = '127.0.0.1';
const ROOT = path.join(__dirname, '..');

// ─── Colores para consola ────────────────────────────────────────────────────
const c = {
    verde:    (t) => `\x1b[32m${t}\x1b[0m`,
    amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
    cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
    rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
    gris:     (t) => `\x1b[90m${t}\x1b[0m`,
    negrita:  (t) => `\x1b[1m${t}\x1b[0m`,
};

// ─── Estado: proceso en ejecución ───────────────────────────────────────────
let procesoActivo = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function responderJSON(res, statusCode, body) {
    const json = JSON.stringify(body);
    res.writeHead(statusCode, {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(json);
}

function log(nivel, msg) {
    const ts = new Date().toLocaleTimeString('es-CO');
    const prefijos = { info: c.cyan('[INFO]'), ok: c.verde('[OK]'), warn: c.amarillo('[WARN]'), err: c.rojo('[ERR]') };
    console.log(`${c.gris(ts)} ${prefijos[nivel] || '[LOG]'} ${msg}`);
}

// ─── Lanzar sincronizar-cola-ram.js en una terminal nueva visible ─────────────
function lanzarSincronizacion(radicado) {
    if (procesoActivo && !procesoActivo.exitCode) {
        log('warn', 'Ya hay un proceso de sincronización activo. Esperando a que termine...');
        return { ya_ejecutando: true };
    }

    const args = radicado ? [`--radicado=${radicado}`] : [];
    const scriptPath = path.join(ROOT, 'automatizaciones', 'sincronizar-cola-ram.js');

    log('info', `Lanzando sincronización RAM${radicado ? ` para radicado: ${radicado}` : ' (todos los pendientes)'}...`);

    // En Windows: abre una nueva ventana de cmd con título descriptivo
    const cmd = `start "🤖 SINCRONIZANDO RAMS - CUENTAME" cmd /k "node \"${scriptPath}\" ${args.join(' ')} && echo. && echo ✅ Sincronización completada! && pause"`;

    const proc = spawn('cmd', ['/c', cmd], {
        cwd: ROOT,
        detached: true,
        shell: false,
        stdio: 'ignore',
    });

    proc.unref(); // No bloquear el servidor al liberar el proceso hijo
    procesoActivo = proc;

    log('ok', `Terminal de sincronización abierta (PID ${proc.pid})`);
    return { ok: true, pid: proc.pid };
}

// ─── Servidor HTTP ────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const ruta = parsed.pathname;
    const query = parsed.query;

    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        });
        return res.end();
    }

    log('info', `${req.method} ${req.url}`);

    // ── GET /api/ping ── (para que el portal verifique si el agente está activo)
    if (ruta === '/api/ping' && req.method === 'GET') {
        return responderJSON(res, 200, {
            ok: true,
            version: '1.0.0',
            agente: 'local-bridge-cuentame',
            mensaje: '🤖 Agente Local activo y listo para ejecutar RAMs.',
            timestamp: new Date().toISOString(),
        });
    }

    // ── GET /api/ejecutar-ram ── (trigger desde portal web)
    if (ruta === '/api/ejecutar-ram' && req.method === 'GET') {
        const radicado = query.radicado || null;
        const resultado = lanzarSincronizacion(radicado);

        if (resultado.ya_ejecutando) {
            return responderJSON(res, 409, {
                ok: false,
                error: 'Ya hay una sincronización en ejecución. Espera a que termine antes de iniciar otra.',
            });
        }

        return responderJSON(res, 200, {
            ok: true,
            mensaje: `✅ Robot de sincronización iniciado. Revisa la nueva terminal que se abrió en tu computador.`,
            radicado: radicado || 'TODOS_LOS_PENDIENTES',
            pid: resultado.pid,
        });
    }

    // ── GET /api/estado ── (estado del proceso actual)
    if (ruta === '/api/estado' && req.method === 'GET') {
        const activo = procesoActivo && procesoActivo.exitCode === null;
        return responderJSON(res, 200, {
            ok: true,
            en_ejecucion: activo,
            pid: procesoActivo ? procesoActivo.pid : null,
        });
    }

    // 404 para todo lo demás
    return responderJSON(res, 404, { ok: false, error: `Ruta no encontrada: ${ruta}` });
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(c.rojo(`\n❌ El puerto ${PUERTO} ya está en uso. ¿Ya tienes el Agente Local corriendo?\n`));
    } else {
        console.error(c.rojo(`\n❌ Error del servidor: ${err.message}\n`));
    }
    process.exit(1);
});

server.listen(PUERTO, HOST, () => {
    console.clear();
    console.log(c.cyan(`
  ╔══════════════════════════════════════════════════════╗
  ║   🤖  AGENTE LOCAL CUÉNTAME — Portal Bridge v1.0    ║
  ╚══════════════════════════════════════════════════════╝`));
    console.log(c.verde(`\n  ✅ Servidor escuchando en: http://${HOST}:${PUERTO}`));
    console.log(c.amarillo(`\n  Endpoints disponibles:`));
    console.log(c.gris(`     GET http://${HOST}:${PUERTO}/api/ping            → Verificar estado`));
    console.log(c.gris(`     GET http://${HOST}:${PUERTO}/api/ejecutar-ram    → Lanzar sincronización`));
    console.log(c.gris(`     GET http://${HOST}:${PUERTO}/api/estado          → Estado del proceso\n`));
    console.log(c.cyan(`  🌐 Ve al portal web y haz clic en "⚡ Ejecutar" en los RAMs pendientes.`));
    console.log(c.gris(`\n  Presiona Ctrl+C para detener el agente.\n`));
    console.log(c.gris(`  ─────────────────────────────────────────────────────────`));
    console.log(c.gris(`  Log de peticiones:\n`));
});
