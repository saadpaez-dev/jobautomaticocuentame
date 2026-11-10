/**
 * capturador-masivo-pantallazos.js
 * 
 * Módulo especializado para capturar masivamente los comprobantes visuales oficiales
 * de todas las UDS / Jardines en Cuéntame:
 *   1. Pantallazos Oficiales de Beneficiarios Activos (Grilla de Desvinculación)
 *   2. Pantallazos Oficiales de Asistencia RAM (Planilla mensual oficial)
 * 
 * Y sincronizarlos automáticamente en tiempo real con el servidor de Render (Portal Web).
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const { loginYLlegarARoles, seleccionarRolYEntrar, obtenerNavegador, validarYCambiarAsociacion } = require('./autenticacion');
const { leerJardines } = require('./excel-reader');
const { obtenerJardinesDeAsociacion } = require('./bd-beneficiarios');
const { capturarJardin, sanitizarNombreArchivo } = require('../automatizaciones/capturar-pantallazo-jardin');
const { sincronizarBasePantallazos } = require('./sincronizar-base-pantallazos');

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

/**
 * Helper para selección en dropdowns con espera
 */
async function selectDropdown(contentFrame, workPage, keyword, textOrIndex) {
    const sel = contentFrame.locator(`select[id*="${keyword}" i], select[name*="${keyword}" i]`).first();
    let attempts = 0;
    while (await sel.count() === 0 && attempts < 20) {
        await workPage.waitForTimeout(200);
        attempts++;
    }
    if (await sel.count() === 0) return null;

    let isEnabled = await sel.evaluate(s => !s.disabled).catch(() => false);
    if (!isEnabled) return null;

    let valueToSelect = null;
    for (let retry = 0; retry < 30; retry++) {
        if (typeof textOrIndex === 'string') {
            valueToSelect = await sel.evaluate((s, t) => {
                const opts = Array.from(s.options).filter(o => o.value && o.value !== "0" && o.value !== "-1" && o.value !== "");
                const tNorm = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
                let opt = opts.find(o => {
                    const oNorm = o.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
                    return oNorm.includes(tNorm) || tNorm.includes(oNorm);
                });
                if (opt) return opt.value;
                const mapaMeses = {
                    'ENERO': '1', 'FEBRERO': '2', 'MARZO': '3', 'ABRIL': '4',
                    'MAYO': '5', 'JUNIO': '6', 'JULIO': '7', 'AGOSTO': '8',
                    'SEPTIEMBRE': '9', 'OCTUBRE': '10', 'NOVIEMBRE': '11', 'DICIEMBRE': '12'
                };
                const numMes = mapaMeses[tNorm] || '';
                if (numMes) {
                    opt = opts.find(o => String(o.value).trim() === numMes || o.text.trim().startsWith(numMes));
                    if (opt) return opt.value;
                }
                return null;
            }, textOrIndex);
        } else if (typeof textOrIndex === 'number') {
            valueToSelect = await sel.evaluate(s => {
                const opt = Array.from(s.options).find(o => o.value && o.value !== "0" && o.value !== "");
                return opt ? opt.value : null;
            });
        }
        if (valueToSelect) break;
        await workPage.waitForTimeout(150);
    }

    if (valueToSelect) {
        const currentValue = await sel.evaluate(s => s.value).catch(() => null);
        if (currentValue === valueToSelect) return valueToSelect;
        await sel.selectOption(valueToSelect, { timeout: 5000 }).catch(() => {});
        await workPage.waitForTimeout(300);
        return valueToSelect;
    }
    return null;
}

/**
 * Sube un pantallazo de RAM al servidor en Render
 */
async function subirPantallazoRAMARender(postPayload) {
    const postData = JSON.stringify(postPayload);
    const targets = [
        'https://portal-cuentame.onrender.com/api/admin/subir-pantallazo-ram',
        'http://127.0.0.1:3000/api/admin/subir-pantallazo-ram'
    ];

    for (const targetUrl of targets) {
        try {
            const u = new URL(targetUrl);
            const reqModule = u.protocol === 'https:' ? https : http;
            await new Promise((resolve) => {
                const req = reqModule.request(u, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    },
                    timeout: 10000
                }, (res) => {
                    res.resume();
                    resolve();
                });
                req.on('error', () => resolve());
                req.on('timeout', () => { req.abort(); resolve(); });
                req.write(postData);
                req.end();
            });
        } catch(e) {}
    }
}

/**
 * Captura el pantallazo de RAM oficial de un Jardín
 */
async function capturarRAMDeJardin({ page, ascObj, jardinObj, mesAtencion = 'Noviembre', anio = 2026, forzar = true }) {
    const nombreJardin = jardinObj.nombreUds || jardinObj.nombre;
    const codClean = String(jardinObj.codigoUds || jardinObj.codigo || '').trim();
    const asocClean = sanitizarNombreArchivo(ascObj.nombreCorto) || 'GENERAL';
    const jardinClean = sanitizarNombreArchivo(nombreJardin) || (codClean ? `UDS_${codClean}` : 'UDS');
    const mesClean = sanitizarNombreArchivo(mesAtencion || 'Noviembre');

    const filename = `RAM_${jardinClean}_${mesClean}_${anio}.png`;
    const filenameCod = codClean ? `RAM_${codClean}_${mesClean}_${anio}.png` : null;
    const filenameSimple = `RAM_${jardinClean}.png`;

    const dirs = [
        path.join(__dirname, '..', 'docs', 'pantallazos', asocClean),
        path.join(__dirname, '..', '..', 'app-cuentame', 'docs', 'pantallazos', asocClean),
        path.join(__dirname, '..', 'docs', 'reportes', 'ram', asocClean),
        path.join(__dirname, '..', '..', 'app-cuentame', 'docs', 'reportes', 'ram', asocClean)
    ];

    for (const d of dirs) {
        if (!fs.existsSync(d)) {
            try { fs.mkdirSync(d, { recursive: true }); } catch(e) {}
        }
    }

    const pathJob = path.join(dirs[0], filename);
    const pathApp = path.join(dirs[1], filename);

    if (!forzar && fs.existsSync(pathJob) && fs.existsSync(pathApp)) {
        const stats = fs.statSync(pathJob);
        if (stats.size > 20000) {
            console.log(c.verde(`    ⏭️  [YA EXISTE RAM]: ${filename} (${(stats.size/1024).toFixed(1)} KB) - Omitiendo.`));
            return { success: true, yaExiste: true, filename };
        }
    }

    console.log(c.cyan(`    📸 Capturando RAM de: [${ascObj.nombreCorto}] ${nombreJardin} (${codClean}) - Mes: ${mesAtencion}`));

    let contentFrame = page.frame({ name: 'frameContent' }) || page.frames().find(f => f.name() === 'frameContent') || page;

    // Verificar si estamos en la pantalla de RAM
    const urlActual = page.url();
    if (!urlActual.includes('RegistroAsistencia/List.aspx')) {
        await page.goto('https://rubonline.icbf.gov.co/Page/RUBONLINE/RegistroAsistencia/List.aspx', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(800);
        contentFrame = page.frame({ name: 'frameContent' }) || page.frames().find(f => f.name() === 'frameContent') || page;
    }

    // 1. Llenar filtros base si no están puestos
    await selectDropdown(contentFrame, page, 'Direcciones', 'Primera Infancia');
    await selectDropdown(contentFrame, page, 'Regional', 'Bogota');
    await selectDropdown(contentFrame, page, 'Centro', 'USAQUEN');
    await selectDropdown(contentFrame, page, 'Vigencia', String(ascObj.vigenciaContrato || '2026'));
    await selectDropdown(contentFrame, page, 'Contrato', String(ascObj.numeroContrato || '1'));
    await selectDropdown(contentFrame, page, 'Mes', mesAtencion);
    await selectDropdown(contentFrame, page, 'Estado', 'Todos');

    // 2. Seleccionar Servicio
    const jMod = (jardinObj.modalidad || '').toUpperCase();
    const jNom = (nombreJardin || '').toUpperCase();
    const esAgrupado = jMod.includes('JARDIN') || jMod.includes('AGRUPAD') || jNom.includes('SALA') || jNom.includes('GRUPAL') || jNom.includes('MARAVILLAS') || jNom.includes('ESTRELLITAS') || jNom.includes('SOLECITO') || jNom.includes('ANGELITOS');
    const servKeyword = esAgrupado ? 'JARDIN COMUNITARIO' : 'HCB';
    await selectDropdown(contentFrame, page, 'Servicio', servKeyword);
    await page.waitForTimeout(500);

    // 3. Seleccionar UDS
    const selUds = await selectDropdown(contentFrame, page, 'ddlUDS', codClean || nombreJardin);
    if (!selUds) {
        await selectDropdown(contentFrame, page, 'UDS', nombreJardin);
    }

    // Esperar a que la tabla o mensaje cargue
    await page.waitForTimeout(1200);
    contentFrame = page.frame({ name: 'frameContent' }) || page.frames().find(f => f.name() === 'frameContent') || page;

    const tablaRAM = contentFrame.locator('table[id*="grdConsulta"], table[id*="gvLista"], table[id*="GridView"], table.mGrid, table[id*="Grid"]').first();
    let tablaVisible = false;
    try {
        await tablaRAM.waitFor({ state: 'visible', timeout: 8000 });
        tablaVisible = true;
    } catch(e) {}

    // Scroll para enfocar
    await contentFrame.evaluate(() => {
        const t = document.querySelector('table[id*="grdConsulta"], table[id*="gvLista"], table[id*="GridView"], table.mGrid');
        if (t) t.scrollIntoView({ behavior: 'instant', block: 'center' });
    }).catch(() => {});
    await page.waitForTimeout(300);

    let buffer = null;
    if (tablaVisible) {
        buffer = await tablaRAM.screenshot().catch(() => null);
    }
    if (!buffer) {
        buffer = await page.screenshot({ fullPage: true }).catch(() => null);
    }

    if (!buffer) {
        console.log(c.amarillo(`    ⚠️ No se pudo capturar el buffer de imagen para ${nombreJardin}`));
        return { success: false, motivo: 'Error al capturar buffer' };
    }

    // Limpiar anteriores para esta UDS
    for (const d of dirs) {
        if (!fs.existsSync(d)) continue;
        try {
            const existentes = fs.readdirSync(d);
            for (const arch of existentes) {
                const archUp = arch.toUpperCase();
                if (!archUp.startsWith('RAM_')) continue;
                const coincideCod = codClean && archUp.includes(codClean.toUpperCase());
                const coincideJar = jardinClean && archUp.includes(jardinClean.toUpperCase());
                if (coincideCod || coincideJar) {
                    try { fs.unlinkSync(path.join(d, arch)); } catch(e) {}
                }
            }
        } catch(e) {}
    }

    // Guardar en todas las rutas
    for (const d of dirs) {
        try {
            fs.writeFileSync(path.join(d, filename), buffer);
            if (filenameCod) fs.writeFileSync(path.join(d, filenameCod), buffer);
            fs.writeFileSync(path.join(d, filenameSimple), buffer);
        } catch(e) {}
    }

    console.log(c.verde(`    💾 [GUARDADO RAM]: ${filename}`));

    // Enviar inmediatamente a Render
    await subirPantallazoRAMARender({
        asociacion: ascObj.nombreCorto,
        jardin: nombreJardin,
        codigoUds: codClean,
        mes: mesAtencion,
        anio,
        filename,
        imagenBase64: buffer.toString('base64')
    });

    return { success: true, filename };
}

/**
 * Función Maestra: Ejecuta la captura completa de Beneficiarios y RAM
 */
async function capturarPantallazosCompletos(opciones = {}) {
    const {
        page: pageExistente = null,
        asociaciones = [],
        mesAtencion = 'Noviembre',
        capturarBeneficiarios = true,
        capturarRAM = true,
        forzar = true
    } = opciones;

    console.log(c.negrita(c.cyan('\n╔══════════════════════════════════════════════════════════════╗')));
    console.log(c.negrita(c.cyan('║  📸 ACTUALIZACIÓN DE PANTALLAZOS OFICIALES (PAQUETE COMPLETO)║')));
    console.log(c.negrita(c.cyan('╚══════════════════════════════════════════════════════════════╝')));
    console.log(c.gris(`• Asociaciones a procesar: ${asociaciones.length}`));
    console.log(c.gris(`• Mes de Atención (RAM):   ${mesAtencion}`));
    console.log(c.gris(`• Beneficiarios Activos:   ${capturarBeneficiarios ? 'SÍ' : 'NO'}`));
    console.log(c.gris(`• Asistencia RAM:          ${capturarRAM ? 'SÍ' : 'NO'}`));
    console.log(c.gris(`• Modo sobrescritura:      ${forzar ? 'FORZAR' : 'OMITIR EXISTENTES'}\n`));

    let page = pageExistente;
    let browser = null;

    if (!page) {
        const nav = await obtenerNavegador();
        page = nav.page;
        browser = nav.browser;
    }

    page.on('dialog', async dialog => {
        console.log(c.magenta(`  💬 [Cuéntame Dialog] ${dialog.message()}`));
        await dialog.accept().catch(() => {});
    });

    for (let aIdx = 0; aIdx < asociaciones.length; aIdx++) {
        const asc = asociaciones[aIdx];
        const jList = obtenerJardinesDeAsociacion(asc.nombreCorto) || [];

        console.log(c.negrita(c.amarillo(`\n══════════════════════════════════════════════════════════════`)));
        console.log(c.negrita(c.amarillo(`🏢 ASOCIACIÓN [${aIdx + 1}/${asociaciones.length}]: ${asc.nombreCorto} (${jList.length} Jardines)`)));
        console.log(c.negrita(c.amarillo(`══════════════════════════════════════════════════════════════`)));

        try {
            const mismaAsc = await validarYCambiarAsociacion(page, asc);
            if (!mismaAsc) {
                await loginYLlegarARoles(page, {
                    usuario: process.env.CUENTAME_USUARIO,
                    password: process.env.CUENTAME_PASSWORD,
                    gmailUser: process.env.GMAIL_USER,
                    gmailAppPassword: process.env.GMAIL_APP_PASSWORD
                });
                await seleccionarRolYEntrar(page, asc);
            }

            // ── FASE 1: PANTALLAZOS DE BENEFICIARIOS ACTIVOS ──
            if (capturarBeneficiarios) {
                console.log(c.cyan(`\n  👥 FASE 1: Capturando Pantallazos de Beneficiarios Activos en ${asc.nombreCorto}...`));
                for (let jIdx = 0; jIdx < jList.length; jIdx++) {
                    const jardin = jList[jIdx];
                    console.log(c.gris(`    [${jIdx + 1}/${jList.length}] ${jardin.nombreUds}`));
                    try {
                        await capturarJardin({ page, ascObj: asc, jardinObj: jardin, forzar });
                    } catch(errB) {
                        console.error(c.rojo(`    ❌ Error capturando beneficiarios de ${jardin.nombreUds}: ${errB.message}`));
                    }
                    await page.waitForTimeout(400);
                }
            }

            // ── FASE 2: PANTALLAZOS DE ASISTENCIA RAM ──
            if (capturarRAM) {
                console.log(c.cyan(`\n  📅 FASE 2: Capturando Pantallazos de Asistencia RAM (${mesAtencion}) en ${asc.nombreCorto}...`));
                await page.goto('https://rubonline.icbf.gov.co/Page/RUBONLINE/RegistroAsistencia/List.aspx', { waitUntil: 'domcontentloaded', timeout: 45000 });
                await page.waitForTimeout(1000);

                for (let jIdx = 0; jIdx < jList.length; jIdx++) {
                    const jardin = jList[jIdx];
                    console.log(c.gris(`    [${jIdx + 1}/${jList.length}] ${jardin.nombreUds}`));
                    try {
                        await capturarRAMDeJardin({ page, ascObj: asc, jardinObj: jardin, mesAtencion, anio: 2026, forzar });
                    } catch(errR) {
                        console.error(c.rojo(`    ❌ Error capturando RAM de ${jardin.nombreUds}: ${errR.message}`));
                    }
                    await page.waitForTimeout(400);

                    // Recargar filtros para la siguiente UDS
                    if (jIdx < jList.length - 1) {
                        await page.goto('https://rubonline.icbf.gov.co/Page/RUBONLINE/RegistroAsistencia/List.aspx', { waitUntil: 'domcontentloaded' }).catch(() => {});
                        await page.waitForTimeout(600);
                    }
                }
            }

        } catch(errA) {
            console.error(c.rojo(`❌ Error procesando ${asc.nombreCorto}: ${errA.message}`));
        }
    }

    // ── FASE 3: SINCRONIZACIÓN TOTAL CON LA NUBE (RENDER) ──
    try {
        console.log(c.cyan('\n🌐 Sincronizando todos los pantallazos actualizados con Render...'));
        await sincronizarBasePantallazos({ silent: false });
    } catch(eSync) {
        console.log(c.amarillo(`  ⚠️ No se pudo completar sincronización a Render: ${eSync.message}`));
    }

    console.log(c.verde('\n  🎉 PROCESO COMPLETO DE PANTALLAZOS FINALIZADO EXITOSAMENTE.\n'));
}

module.exports = {
    capturarRAMDeJardin,
    capturarPantallazosCompletos
};

if (require.main === module) {
    (async () => {
        const RUTA_EXCEL = process.env.RUTA_EXCEL || 'C:\\GENERAL_BOTS.xlsx';
        const { porAsociacion } = leerJardines(RUTA_EXCEL);
        let asociaciones = Object.values(porAsociacion).filter(a => a.numeroContrato);

        const argAsoc = process.argv.find(a => a.startsWith('--asociacion='));
        if (argAsoc) {
            const asocVal = argAsoc.split('=')[1].toUpperCase();
            asociaciones = asociaciones.filter(a => (a.nombreCorto || '').toUpperCase().includes(asocVal));
        }

        const argMes = process.argv.find(a => a.startsWith('--mes='));
        const mesAtencion = argMes ? argMes.split('=')[1] : 'Noviembre';

        await capturarPantallazosCompletos({
            asociaciones,
            mesAtencion,
            capturarBeneficiarios: true,
            capturarRAM: true,
            forzar: true
        });

        process.exit(0);
    })().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
