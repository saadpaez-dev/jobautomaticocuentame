/**
 * local-bridge.js
 * Servidor HTTP local (http://127.0.0.1:3939) y Cliente Poller en la nube
 * que conecta el Portal Web (Render/celulares/remoto) con el bot local de Playwright (jobautomatico).
 *
 * Características:
 * 1. Escucha en http://127.0.0.1:3939 para peticiones locales directas.
 * 2. Consulta activamente cada 3s en la nube (Render) por órdenes enviadas desde móviles/web.
 * 3. Al recibir una orden, abre inmediatamente la terminal con Sincronizar_Cola_RAM.bat.
 *
 * Uso:
 *   node servicios/local-bridge.js
 *   (o arrancarlo desde Iniciar_Agente_Local.bat)
 */

'use strict';

const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const path = require('path');
const url = require('url');

const PUERTO = 3939;
const HOST = '127.0.0.1';
const ROOT = path.join(__dirname, '..');
const RENDER_API = 'https://portal-cuentame.onrender.com';

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
let revisandoComandos = false;

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
    const batPath = path.join(ROOT, 'Sincronizar_Cola_RAM.bat');

    log('info', `Lanzando sincronización RAM${radicado ? ` radicado: ${radicado}` : ' (todos los pendientes)'}...`);

    const args = ['/c', 'start', 'SINCRONIZANDO RAMS', 'cmd.exe', '/c', batPath];
    if (radicado) {
        args.push(radicado);
    }

    const proc = spawn('cmd.exe', args, {
        cwd: ROOT,
        detached: true,
        stdio: 'ignore',
    });

    proc.on('error', (err) => log('err', `No se pudo abrir la terminal: ${err.message}`));
    proc.unref();

    log('ok', `Terminal abierta en pantalla para ejecución (PID ${proc.pid})`);
    return { ok: true, pid: proc.pid };
}

// ─── Comunicación con la Nube (Render): Tiempo Real (SSE) + Fallback ────────
let streamReq = null;
let reconectarTimeout = null;

function conectarStreamRender() {
    if (streamReq) {
        try { streamReq.destroy(); } catch(e) {}
        streamReq = null;
    }

    try {
        const streamUrl = new url.URL(`${RENDER_API}/api/admin/agente/stream`);
        log('info', `Conectando canal de eventos en tiempo real (SSE) con Render...`);

        streamReq = https.get(streamUrl, (res) => {
            if (res.statusCode !== 200) {
                log('warn', `Canal SSE no disponible (HTTP ${res.statusCode}). Reintentando en 5s...`);
                programarReconexion();
                return;
            }

            log('ok', `⚡ Conexión en TIEMPO REAL establecida con Render (Latencia Cero).`);

            let buffer = '';
            res.on('data', (chunk) => {
                buffer += chunk.toString();
                const lineas = buffer.split('\n\n');
                buffer = lineas.pop(); // guardar fragmento incompleto

                for (const bloque of lineas) {
                    if (!bloque.trim()) continue;
                    procesarBloqueSSE(bloque);
                }
            });

            res.on('end', () => {
                log('warn', `Canal SSE cerrado por el servidor. Reconectando en 4s...`);
                programarReconexion();
            });

            res.on('error', (err) => {
                log('warn', `Error en canal SSE: ${err.message}. Reconectando...`);
                programarReconexion();
            });
        });

        streamReq.on('error', (err) => {
            log('warn', `Fallo de conexión SSE (${err.message}). Activo fallback de consulta periódica.`);
            programarReconexion();
        });

        streamReq.setTimeout(45000, () => {
            log('warn', `Timeout en canal SSE sin datos. Reiniciando stream...`);
            if (streamReq) streamReq.destroy();
        });

    } catch(e) {
        log('err', `Error iniciando stream SSE: ${e.message}`);
        programarReconexion();
    }
}

function programarReconexion() {
    if (reconectarTimeout) clearTimeout(reconectarTimeout);
    reconectarTimeout = setTimeout(conectarStreamRender, 5000);
}

async function procesarBloqueSSE(bloque) {
    const lineas = bloque.split('\n');
    let evento = 'message';
    let dataStr = '';

    for (const l of lineas) {
        if (l.startsWith('event:')) evento = l.substring(6).trim();
        else if (l.startsWith('data:')) dataStr = l.substring(5).trim();
    }

    if (evento === 'ping') return;

    if (evento === 'comando' && dataStr) {
        try {
            const cmd = JSON.parse(dataStr);
            if (cmd && cmd.id) {
                log('ok', `⚡ [LATENCIA 0] ¡Orden recibida en tiempo real desde celular/web! Radicado: ${cmd.radicado || 'TODOS'}`);
                await marcarComandoEnNube(cmd.id, 'EN_PROCESO', 'Iniciando robot en PC (latencia 0)...');
                lanzarSincronizacion(cmd.radicado);
                await marcarComandoEnNube(cmd.id, 'EJECUTANDO', 'Terminal de ejecución abierta en PC.');
            }
        } catch(e) {
            log('err', `Error procesando comando SSE: ${e.message}`);
        }
    }
}

async function consultarComandosEnNube() {
    if (revisandoComandos) return;
    revisandoComandos = true;

    try {
        const urlStr = `${RENDER_API}/api/admin/agente/comandos-pendientes`;
        const data = await new Promise((resolve, reject) => {
            const req = https.get(urlStr, { timeout: 6000 }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(body)); } catch(e) { resolve(null); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.abort(); reject(new Error('Timeout')); });
        });

        if (data && data.comandos && data.comandos.length > 0) {
            for (const cmd of data.comandos) {
                log('ok', `📱 ¡Orden de ejecución recibida desde el Móvil / Portal Web! Radicado: ${cmd.radicado || 'TODOS'}`);
                
                // 1. Marcar como en proceso en la nube
                await marcarComandoEnNube(cmd.id, 'EN_PROCESO', 'Iniciando robot en PC...');

                // 2. Disparar sincronización
                lanzarSincronizacion(cmd.radicado);

                // 3. Marcar como ejecutando
                await marcarComandoEnNube(cmd.id, 'EJECUTANDO', 'Terminal de ejecución abierta en PC.');
            }
        }
    } catch(e) {
        // Ignorar fallos transitorios de red
    } finally {
        revisandoComandos = false;
    }
}

async function marcarComandoEnNube(id, estado, mensaje) {
    try {
        const postData = JSON.stringify({ id, estado, mensaje });
        await new Promise((resolve) => {
            const u = new url.URL(`${RENDER_API}/api/admin/agente/marcar-comando`);
            const req = https.request(u, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 5000
            }, (res) => {
                res.on('data', () => {});
                res.on('end', resolve);
            });
            req.on('error', () => resolve());
            req.on('timeout', () => { req.abort(); resolve(); });
            req.write(postData);
            req.end();
        });
    } catch(e) {}
}

// ─── Servidor HTTP Local (127.0.0.1:3939) ────────────────────────────────────
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

    // ── GET /api/ping ──
    if (ruta === '/api/ping' && req.method === 'GET') {
        return responderJSON(res, 200, {
            ok: true,
            version: '2.0.0',
            agente: 'local-bridge-cuentame',
            mensaje: '🤖 Agente Local activo y listo para ejecutar RAMs.',
            timestamp: new Date().toISOString(),
        });
    }

    // ── GET /api/ejecutar-ram ──
    if (ruta === '/api/ejecutar-ram' && req.method === 'GET') {
        const radicado = query.radicado || null;
        const resultado = lanzarSincronizacion(radicado);

        return responderJSON(res, 200, {
            ok: true,
            mensaje: `✅ Robot de sincronización iniciado. Revisa la nueva terminal que se abrió en tu computador.`,
            radicado: radicado || 'TODOS_LOS_PENDIENTES',
            pid: resultado.pid,
        });
    }

    // ── GET /api/estado ──
    if (ruta === '/api/estado' && req.method === 'GET') {
        const activo = procesoActivo && procesoActivo.exitCode === null;
        return responderJSON(res, 200, {
            ok: true,
            en_ejecucion: activo,
            pid: procesoActivo ? procesoActivo.pid : null,
        });
    }

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
  ║   🤖  AGENTE LOCAL CUÉNTAME — Portal Bridge v2.0    ║
  ╚══════════════════════════════════════════════════════╝`));
    console.log(c.verde(`\n  ✅ Servidor local escuchando en: http://${HOST}:${PUERTO}`));
    console.log(c.verde(`  ☁️  Conectado con el Portal Web (Render): Escuchando órdenes desde celulares y web...`));
    console.log(c.amarillo(`\n  Endpoints locales:`));
    console.log(c.gris(`     GET http://${HOST}:${PUERTO}/api/ping            → Verificar estado`));
    console.log(c.gris(`     GET http://${HOST}:${PUERTO}/api/ejecutar-ram    → Lanzar sincronización`));
    console.log(c.gris(`     GET http://${HOST}:${PUERTO}/api/estado          → Estado del proceso\n`));
    console.log(c.cyan(`  📱 Puedes enviar la orden "⚡ Ejecutar" desde tu celular o desde el PC.`));
    console.log(c.gris(`\n  Presiona Ctrl+C para detener el agente.\n`));
    console.log(c.gris(`  ─────────────────────────────────────────────────────────`));
    console.log(c.gris(`  Log de actividad en vivo:\n`));

    // 1. Iniciar conexión SSE en TIEMPO REAL con Render (Latencia Cero)
    conectarStreamRender();

    // 2. Consulta periódica como respaldo (cada 12 segundos)
    setInterval(consultarComandosEnNube, 12000);
    // Y una primera consulta inmediata de respaldo
    consultarComandosEnNube();
});
