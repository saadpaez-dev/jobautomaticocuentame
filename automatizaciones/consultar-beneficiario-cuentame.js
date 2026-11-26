/**
 * consultar-beneficiario-cuentame.js
 * 
 * Automatización para consultar en tiempo real el historial de un beneficiario
 * en la plataforma oficial Cuéntame ICBF (módulo: Información del Beneficiario).
 * 
 * Extrae:
 *   - Historial de todas las UDS donde ha sido atendido (Bolívar, Atlántico, Bogotá, etc.)
 *   - El registro MÁS ACTUAL (mayor vigencia y fecha de atención más reciente)
 *   - Estado actual: "Desvinculado" (apto para vincular) o "Vinculado" (requiere ticket)
 *   - Captura el pantallazo oficial del historial (como en la vista de Cuéntame)
 *   - Sincroniza los datos y la imagen con el servidor local y la nube (Render).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { loginYLlegarARoles, seleccionarRolYEntrar, obtenerNavegador } = require('../servicios/autenticacion');
const { leerJardines } = require('../servicios/excel-reader');
const { esperarPostBackReactivo } = require('../servicios/filtro-monitor');

const c = {
    verde: (t) => `\x1b[32m${t}\x1b[0m`,
    amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
    cyan: (t) => `\x1b[36m${t}\x1b[0m`,
    rojo: (t) => `\x1b[31m${t}\x1b[0m`,
    gris: (t) => `\x1b[90m${t}\x1b[0m`,
    negrita: (t) => `\x1b[1m${t}\x1b[0m`,
    magenta: (t) => `\x1b[35m${t}\x1b[0m`
};

const removeAccentsStr = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();

function sanitizarNombreArchivo(texto) {
    return (texto || '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9_\-]/g, '')
        .trim();
}

/**
 * Sincroniza el resultado con el servidor de app-cuentame (Local y Render)
 */
async function sincronizarResultadoConServidores(payload) {
    const targets = [
        'http://127.0.0.1:3000/api/admin/guardar-resultado-consulta-cuentame',
        'https://portal-cuentame.onrender.com/api/admin/guardar-resultado-consulta-cuentame'
    ];

    const postPayload = JSON.stringify(payload);

    for (const targetUrl of targets) {
        try {
            const httpModule = targetUrl.startsWith('https') ? https : http;
            const parsed = new URL(targetUrl);
            await new Promise((resolve) => {
                const req = httpModule.request(targetUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postPayload)
                    },
                    timeout: 8000
                }, (res) => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        const destino = parsed.hostname.includes('render') ? 'Render (Nube)' : 'Localhost';
                        console.log(c.verde(`    ☁️ Resultado de consulta sincronizado con ${destino}.`));
                    }
                    resolve();
                });
                req.on('error', () => resolve());
                req.on('timeout', () => { req.destroy(); resolve(); });
                req.write(postPayload);
                req.end();
            });
        } catch(e) {}
    }
}

/**
 * Navega a Información del Beneficiario en Cuéntame
 */
async function navegarAInformacionBeneficiario(page) {
    console.log(c.cyan('  🚀 Navegando a: Información del Beneficiario...'));

    let menuFrame = page.frame({ name: 'frameMenu' });
    if (!menuFrame) {
        for (const f of page.frames()) {
            if (f.name() === 'frameMenu') { menuFrame = f; break; }
        }
    }
    const rootMenu = menuFrame || page;

    try {
        const directUrl = await rootMenu.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const target = links.find(a => a.href && a.href.toUpperCase().includes('INFORMACIONBENEFICIARIO'));
            return target ? target.href : null;
        }).catch(() => null);

        let contentFrame = page.frame({ name: 'frameContent' });
        if (directUrl && contentFrame) {
            await contentFrame.goto(directUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            await page.waitForTimeout(1000);
            return page.frame({ name: 'frameContent' }) || page;
        }

        // Clic en el menú lateral
        await rootMenu.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const norm = s => (s || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            const target = links.find(a => (a.href && a.href.toUpperCase().includes('INFORMACIONBENEFICIARIO')) || norm(a.innerText).includes('informacion beneficiario'));
            if (target) {
                target.click();
            } else {
                const rubLink = links.find(a => norm(a.innerText).trim() === 'rub online' && a.classList.contains('desplegable'));
                if (rubLink) rubLink.click();
            }
        });
        await page.waitForTimeout(600);

        await rootMenu.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const norm = s => (s || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            const target = links.find(a => (a.href && a.href.toUpperCase().includes('INFORMACIONBENEFICIARIO')) || norm(a.innerText).includes('informacion beneficiario'));
            if (target) target.click();
        }).catch(() => {});
        await page.waitForTimeout(1200);
    } catch(e) {
        console.log(c.amarillo(`  ⚠️ Error al interactuar con el menú: ${e.message}`));
    }

    let contentFrame = page.frame({ name: 'frameContent' });
    if (!contentFrame) {
        for (const f of page.frames()) {
            if (f.name() === 'frameContent') { contentFrame = f; break; }
        }
    }
    return contentFrame || page;
}

async function main() {
    console.clear();
    console.log(c.negrita(c.cyan(`
╔══════════════════════════════════════════════════════════════════════════════╗
║     🔍 CONSULTA OFICIAL DE HISTORIAL DE BENEFICIARIO - CUÉNTAME ICBF         ║
║          (Extracción de UDS actual, estado y comprobante histórico)          ║
╚══════════════════════════════════════════════════════════════════════════════╝
`)));

    const USUARIO = process.env.CUENTAME_USUARIO;
    const PASSWORD = process.env.CUENTAME_PASSWORD;
    const GMAIL_USER = process.env.GMAIL_USER;
    const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

    if (!USUARIO || !PASSWORD) {
        console.error(c.rojo('\n❌ Faltan CUENTAME_USUARIO o CUENTAME_PASSWORD en el archivo .env\n'));
        process.exit(1);
    }

    // Parsear argumentos CLI / Payload
    const args = process.argv.slice(2);
    let documentoArg = null;
    let tipoDocArg = 'REGISTRO CIVIL';
    let asociacionArg = null;
    let jardinArg = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--payload' && args[i + 1]) {
            const pPath = args[++i].replace(/^["'\\]+|["'\\]+$/g, '');
            if (fs.existsSync(pPath)) {
                try {
                    const pData = JSON.parse(fs.readFileSync(pPath, 'utf8'));
                    documentoArg = pData.documento || pData.doc || null;
                    tipoDocArg = pData.tipoDoc || pData.tipo || tipoDocArg;
                    asociacionArg = pData.asociacion || null;
                    jardinArg = pData.jardin || null;
                } catch(e) {}
            }
        } else if (args[i] === '--documento' && args[i + 1]) {
            documentoArg = args[++i].replace(/^["'\\]+|["'\\]+$/g, '');
        } else if (args[i] === '--tipoDoc' && args[i + 1]) {
            tipoDocArg = args[++i].replace(/^["'\\]+|["'\\]+$/g, '');
        } else if (args[i] === '--asociacion' && args[i + 1]) {
            asociacionArg = args[++i].replace(/^["'\\]+|["'\\]+$/g, '');
        } else if (args[i] === '--jardin' && args[i + 1]) {
            jardinArg = args[++i].replace(/^["'\\]+|["'\\]+$/g, '');
        }
    }

    if (!documentoArg) {
        console.error(c.rojo('\n❌ Se requiere el número de documento (--documento o vía --payload).\n'));
        process.exit(1);
    }

    const docClean = String(documentoArg).trim();
    console.log(c.gris(`  Documento: ${docClean}`));
    console.log(c.gris(`  Tipo Doc:  ${tipoDocArg}`));
    console.log(c.gris(`  Jardín Solicitante: ${jardinArg || 'General'}\n`));

    // Cargar asociaciones disponibles
    const RUTA_EXCEL = process.env.RUTA_EXCEL || (fs.existsSync('C:\\GENERAL_BOTS.xlsx') ? 'C:\\GENERAL_BOTS.xlsx' : path.join(__dirname, '..', 'GENERAL_BOTS.xlsx'));
    let asociaciones = [];
    try {
        const { porAsociacion } = leerJardines(RUTA_EXCEL);
        asociaciones = Object.values(porAsociacion).filter(a => a.numeroContrato);
    } catch(e) {}

    const ascObj = asociaciones.length > 0 ? asociaciones[0] : null;

    // Conectar o iniciar navegador
    console.log(c.cyan('🚀 Conectando al navegador...'));
    const nav = await obtenerNavegador();
    const { browser, page: mainPage } = nav;

    mainPage.on('dialog', async dialog => {
        console.log(c.magenta(`  💬 Alerta Cuéntame: ${dialog.message()}`));
        await dialog.accept().catch(() => {});
    });

    if (ascObj) {
        await loginYLlegarARoles(mainPage, { usuario: USUARIO, password: PASSWORD, gmailUser: GMAIL_USER, gmailAppPassword: GMAIL_APP_PASSWORD });
        await seleccionarRolYEntrar(mainPage, ascObj);
    }

    // Navegar a Información del Beneficiario
    let contentFrame = await navegarAInformacionBeneficiario(mainPage);

    // 1. Asegurar opción "Consulta por: Número de Documento"
    console.log(c.gris('    • Seleccionando Consulta por: Número de Documento...'));
    try {
        const radioDoc = contentFrame.locator('#cphCont_rblOpcionConsulta_0, input[type="radio"][value="S"], input[type="radio"]').first();
        if (await radioDoc.count() > 0) {
            await radioDoc.check().catch(() => {});
            await mainPage.waitForTimeout(300);
        }
    } catch(e) {}

    // 2. Seleccionar Tipo de Documento
    console.log(c.gris(`    • Seleccionando Tipo de Documento: ${tipoDocArg}...`));
    const MAPA_TIPOS_DOC = {
        'RC': 'REGISTRO CIVIL',
        'TI': 'TARJETA DE IDENTIDAD',
        'CC': 'CEDULA DE CIUDADANIA',
        'CE': 'CEDULA DE EXTRANJERIA',
        'PEP': 'PERMISO ESPECIAL DE PERMANENCIA',
        'PPT': 'PERMISO POR PROTECCIÓN TEMPORAL',
        'DNI': 'DOCUMENTO NACIONAL DE IDENTIDAD',
        'PAS': 'PASAPORTE',
        'SIN': 'SIN DOCUMENTO'
    };
    const labelBuscada = MAPA_TIPOS_DOC[tipoDocArg.toUpperCase()] || tipoDocArg.toUpperCase();

    try {
        const selectDoc = contentFrame.locator('select#cphCont_ddlIdTipoDocumento, select[id*="ddlIdTipoDocumento"], select').first();
        await selectDoc.waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});

        let seleccionado = false;
        try {
            await selectDoc.selectOption({ label: labelBuscada });
            seleccionado = true;
        } catch(e) {}

        if (!seleccionado) {
            await selectDoc.evaluate((s, targetLabel) => {
                const norm = str => (str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
                const target = norm(targetLabel);
                const opts = Array.from(s.options);
                const m = opts.find(o => norm(o.text).includes(target) || target.includes(norm(o.text)) || norm(o.value) === target);
                if (m) {
                    s.value = m.value;
                    s.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, labelBuscada);
        }
        await mainPage.waitForTimeout(400);
    } catch(e) {}

    // 3. Escribir Número de Documento
    console.log(c.gris(`    • Ingresando Número de Documento: ${docClean}...`));
    const inputDoc = contentFrame.locator('#cphCont_txtIdentificacion, input[name*="txtIdentificacion"], input[type="text"][id*="Identificacion"], input[type="text"]').first();
    await inputDoc.click();
    await inputDoc.fill(docClean);
    await mainPage.waitForTimeout(300);

    // 4. Clic en Buscar (Lupa)
    console.log(c.gris('    👉 Clic en Consultar/Buscar...'));
    await esperarPostBackReactivo(mainPage, async () => {
        await contentFrame.evaluate(() => {
            const btn = document.getElementById('btnBuscar');
            if (btn) {
                btn.click();
            } else {
                const img = document.querySelector('img[title="Consultar"], img[alt="Consultar"]');
                if (img) img.click();
            }
        });
    }, 15000);

    await mainPage.waitForTimeout(2500);
    contentFrame = mainPage.frame({ name: 'frameContent' }) || mainPage.frames().find(f => f.name() === 'frameContent') || mainPage;

    // 5. Evaluar resultados de la tabla o mensaje "No se encontraron datos"
    console.log(c.gris('    ⏳ Analizando respuesta de Cuéntame...'));
    let sinDatos = false;
    try {
        const msgSinDatos = contentFrame.locator('text="No se encontraron datos", text="No se encontraron registros", div.alert, span[id*="lblMensaje"]').first();
        if (await msgSinDatos.count() > 0 && await msgSinDatos.isVisible()) {
            const txt = await msgSinDatos.innerText();
            if (txt.toLowerCase().includes('no se encontraron')) {
                sinDatos = true;
            }
        }
    } catch(e) {}

    let registros = [];
    if (!sinDatos) {
        const tablas = await contentFrame.locator('table').all();
        for (let i = 0; i < tablas.length; i++) {
            const filas = await tablas[i].locator('tr').all();
            if (filas.length > 1) {
                const celdasHeader = await filas[0].locator('th, td').allInnerTexts().catch(() => []);
                if (celdasHeader.length >= 15) {
                    for (let j = 1; j < filas.length; j++) {
                        const celdas = await filas[j].locator('td').allInnerTexts().catch(() => []);
                        if (celdas.length >= 15) {
                            const info = celdas.map(t => t.trim().replace(/\s+/g, ' '));
                            const docFila = (info[11] || '').replace(/\D/g, '');
                            // Validar que la fila contenga un número de documento válido
                            if (docFila && docFila.length >= 5) {
                                registros.push({
                                    regional: info[1] || '',
                                    entidad: info[2] || '',
                                    vigencia: info[3] || '',
                                    contrato: info[4] || '',
                                    codigoUds: info[5] || '',
                                    nombreUds: info[6] || '',
                                    servicioUds: info[7] || '',
                                    direccionUds: info[8] || '',
                                    tipoBeneficiario: info[9] || '',
                                    tipoDoc: info[10] || '',
                                    numDoc: info[11] || '',
                                    primerNombre: info[12] || '',
                                    segundoNombre: info[13] || '',
                                    primerApellido: info[14] || '',
                                    segundoApellido: info[15] || '',
                                    nombreCompleto: `${info[12] || ''} ${info[13] || ''} ${info[14] || ''} ${info[15] || ''}`.replace(/\s+/g, ' ').trim(),
                                    fechaAtencion: info[16] || '',
                                    fechaDesvinculacion: info[17] || '',
                                    estado: info[18] || ''
                                });
                            }
                        }
                    }
                    if (registros.length > 0) break;
                }
            }
        }
    }

    const encontrado = registros.length > 0;
    let masActual = null;

    if (encontrado) {
        const parseFechaStr = (str) => {
            if (!str) return 0;
            const p = str.trim().split('/');
            if (p.length === 3) return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])).getTime();
            return 0;
        };

        const ordenados = [...registros].sort((a, b) => {
            // 1. Si está Vinculado (Activo) en alguna UDS, esa es la condición vigente prioritaria
            const esVincA = (a.estado || '').toUpperCase().includes('VINCULAD') && !(a.estado || '').toUpperCase().includes('DESVINCULAD');
            const esVincB = (b.estado || '').toUpperCase().includes('VINCULAD') && !(b.estado || '').toUpperCase().includes('DESVINCULAD');
            if (esVincA && !esVincB) return -1;
            if (esVincB && !esVincA) return 1;

            // 2. Fecha de atención más reciente
            const fAtenA = parseFechaStr(a.fechaAtencion);
            const fAtenB = parseFechaStr(b.fechaAtencion);
            if (fAtenB !== fAtenA) return fAtenB - fAtenA;

            // 3. Fecha de desvinculación más reciente
            const fDesvA = parseFechaStr(a.fechaDesvinculacion);
            const fDesvB = parseFechaStr(b.fechaDesvinculacion);
            if (fDesvB !== fDesvA) return fDesvB - fDesvA;

            // 4. Mayor vigencia
            const vigA = parseInt(a.vigencia, 10) || 0;
            const vigB = parseInt(b.vigencia, 10) || 0;
            return vigB - vigA;
        });

        masActual = ordenados[0];
        console.log(c.verde(`\n  ✅ Beneficiario encontrado con ${registros.length} registros históricos.`));
        console.log(c.negrita(c.cyan(`  👶 Nombre: ${masActual.nombreCompleto}`)));
        console.log(c.cyan(`  🏢 Última Entidad: ${masActual.entidad}`));
        console.log(c.cyan(`  🏡 Última UDS:     ${masActual.nombreUds} (${masActual.codigoUds})`));
        console.log(c.cyan(`  📅 Vigencia:       ${masActual.vigencia} | Contrato: ${masActual.contrato}`));
        console.log(c.cyan(`  🗓️ Periodo:        ${masActual.fechaAtencion} al ${masActual.fechaDesvinculacion || 'Activo'}`));
        console.log(c.negrita(masActual.estado.toLowerCase().includes('desvinculad') ? c.verde(`  🟢 Estado Actual:  ${masActual.estado}`) : c.rojo(`  🔴 Estado Actual:  ${masActual.estado}`)));
    } else {
        console.log(c.amarillo(`\n  ℹ️ No se registraron datos en Cuéntame ICBF para el documento ${docClean}.`));
    }

    // 6. Capturar pantallazo oficial del historial (como en la tercera imagen)
    console.log(c.cyan('\n  📸 Capturando comprobante oficial del historial en Cuéntame...'));
    let buffer = null;
    try {
        const formEl = contentFrame.locator('form#form1, form, body').first();
        buffer = await formEl.screenshot().catch(() => null);
    } catch(e) {}

    if (!buffer) {
        buffer = await mainPage.screenshot({ fullPage: true });
    }

    // Rutas de guardado
    const docSanitizado = sanitizarNombreArchivo(docClean);
    const filename = `HISTORIAL_${docSanitizado}.png`;

    const dirs = [
        path.join(__dirname, '..', 'docs', 'pantallazos', 'historial'),
        path.join(__dirname, '..', '..', 'app-cuentame', 'docs', 'pantallazos', 'historial')
    ];

    for (const d of dirs) {
        try {
            if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
            fs.writeFileSync(path.join(d, filename), buffer);
        } catch(e) {}
    }

    // Guardar JSON de consulta local
    const resultadoPayload = {
        success: true,
        encontrado,
        documento: docClean,
        tipoDoc: tipoDocArg,
        masActual,
        registros,
        filename,
        fechaConsulta: new Date().toISOString()
    };

    const consultasDirs = [
        path.join(__dirname, '..', 'docs', 'consultas_cuentame'),
        path.join(__dirname, '..', '..', 'app-cuentame', 'docs', 'consultas_cuentame')
    ];
    for (const d of consultasDirs) {
        try {
            if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
            fs.writeFileSync(path.join(d, `${docSanitizado}.json`), JSON.stringify(resultadoPayload, null, 2), 'utf8');
        } catch(e) {}
    }

    console.log(c.verde(`  💾 Pantallazo guardado en disco: ${filename}`));

    // 7. Sincronizar con servidores (Render y Localhost)
    const base64Data = buffer.toString('base64');
    await sincronizarResultadoConServidores({
        ...resultadoPayload,
        imagenBase64: base64Data
    });

    console.log(c.negrita(c.verde(`\n  ✅ Proceso de Consulta de Beneficiario finalizado con éxito.\n`)));
    process.exit(0);
}

if (require.main === module) {
    main().catch(err => {
        console.error(c.rojo(`\n❌ Error fatal en consulta: ${err.message}`));
        process.exit(1);
    });
}

module.exports = { main };
