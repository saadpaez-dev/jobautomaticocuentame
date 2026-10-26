/**
 * sincronizar-base-pantallazos.js
 * 
 * Sincroniza la base completa de pantallazos oficiales desde el computador local (jobautomatico)
 * hacia el servidor en la nube de Render (portal-cuentame.onrender.com).
 * 
 * Uso:
 *   node servicios/sincronizar-base-pantallazos.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const RENDER_API = process.env.RENDER_API || 'https://portal-cuentame.onrender.com';

const c = {
    verde: (t) => `\x1b[32m${t}\x1b[0m`,
    amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
    cyan: (t) => `\x1b[36m${t}\x1b[0m`,
    rojo: (t) => `\x1b[31m${t}\x1b[0m`,
    gris: (t) => `\x1b[90m${t}\x1b[0m`,
    negrita: (t) => `\x1b[1m${t}\x1b[0m`
};

async function enviarPantallazoARender(asociacion, filename, buffer) {
    const postData = JSON.stringify({
        asociacion,
        filename,
        imagenBase64: buffer.toString('base64')
    });

    return new Promise((resolve) => {
        const u = new URL(`${RENDER_API}/api/admin/sincronizar-pantallazo`);
        const reqModule = u.protocol === 'https:' ? https : http;

        const req = reqModule.request(u, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 25000
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve({ ok: res.statusCode === 200 && parsed.success, data: parsed });
                } catch(e) {
                    resolve({ ok: res.statusCode === 200, data: null });
                }
            });
        });

        req.on('error', (err) => resolve({ ok: false, error: err.message }));
        req.on('timeout', () => { req.abort(); resolve({ ok: false, error: 'Timeout de conexión' }); });
        req.write(postData);
        req.end();
    });
}

async function sincronizarBasePantallazos(opciones = {}) {
    const { silent = false } = opciones;
    const dirBase = path.join(__dirname, '..', 'docs', 'pantallazos');

    if (!silent) {
        console.log(c.negrita(c.cyan('\n╔══════════════════════════════════════════════════════════════╗')));
        console.log(c.negrita(c.cyan('║     📸 SINCRONIZADOR DE BASE DE PANTALLAZOS (PC -> NUBE)     ║')));
        console.log(c.negrita(c.cyan('╚══════════════════════════════════════════════════════════════╝\n')));
        console.log(c.gris(`Directorio origen: ${dirBase}`));
        console.log(c.gris(`Destino en la nube: ${RENDER_API}\n`));
    }

    if (!fs.existsSync(dirBase)) {
        if (!silent) console.log(c.amarillo('⚠️ No existe el directorio docs/pantallazos.'));
        return { total: 0, sincronizados: 0 };
    }

    const subdirs = fs.readdirSync(dirBase).filter(f => {
        try { return fs.statSync(path.join(dirBase, f)).isDirectory(); } catch(e) { return false; }
    });

    const listaArchivos = [];
    for (const asoc of subdirs) {
        const dirAsoc = path.join(dirBase, asoc);
        const files = fs.readdirSync(dirAsoc).filter(f => f.endsWith('.png') || f.endsWith('.jpg'));
        for (const f of files) {
            listaArchivos.push({
                asociacion: asoc,
                filename: f,
                fullPath: path.join(dirAsoc, f)
            });
        }
    }

    if (!silent) {
        console.log(c.cyan(`🔍 Encontrados ${listaArchivos.length} archivos de pantallazos en disco.\n`));
    }

    let sincronizados = 0;
    let fallidos = 0;

    for (let i = 0; i < listaArchivos.length; i++) {
        const item = listaArchivos[i];
        const buffer = fs.readFileSync(item.fullPath);
        const progreso = `[${String(i + 1).padStart(2, '0')}/${listaArchivos.length}]`;

        if (!silent) {
            process.stdout.write(`${c.gris(progreso)} ${item.asociacion} -> ${c.negrita(item.filename)}: `);
        }

        const res = await enviarPantallazoARender(item.asociacion, item.filename, buffer);
        if (res.ok) {
            sincronizados++;
            if (!silent) console.log(c.verde('✅ Sincronizado'));
        } else {
            fallidos++;
            if (!silent) console.log(c.rojo(`❌ Error (${res.error || (res.data && res.data.message) || 'HTTP error'})`));
        }
    }

    if (!silent) {
        console.log(c.negrita(c.verde(`\n🎉 RESUMEN DE SINCRONIZACIÓN:`)));
        console.log(c.verde(`   ✅ Exitosos sincronizados con la nube: ${sincronizados}`));
        if (fallidos > 0) console.log(c.rojo(`   ❌ Fallidos: ${fallidos}`));
        console.log(c.cyan(`   🌐 Las madres y el administrador ya pueden ver y descargar estos pantallazos en vivo.\n`));
    }

    return { total: listaArchivos.length, sincronizados, fallidos };
}

if (require.main === module) {
    sincronizarBasePantallazos().then(() => process.exit(0)).catch(err => {
        console.error(c.rojo('Error:'), err);
        process.exit(1);
    });
}

module.exports = { sincronizarBasePantallazos, enviarPantallazoARender };
