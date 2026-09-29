/**
 * capturar-pantallazo-jardin.js
 * 
 * Automatización MASIVA para capturar el pantallazo oficial de beneficiarios de jardines en Cuéntame.
 * (Módulo: Beneficiario -> Beneficiario -> Desvincular -> Grilla de Beneficiarios)
 * 
 * Modos de uso:
 *   node capturar-pantallazo-jardin.js --masivo                (Captura las 7 asociaciones completas)
 *   node capturar-pantallazo-jardin.js --asociacion "CANAIMA"  (Captura todos los jardines de una asociación)
 *   node capturar-pantallazo-jardin.js --asociacion "CANAIMA" --jardin "EL BEBE" (Un jardín específico)
 *   node capturar-pantallazo-jardin.js --forzar                (Sobrescribe pantallazos existentes)
 *   node capturar-pantallazo-jardin.js                         (Menú interactivo guiado)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const readline = require('readline-sync');
const { loginYLlegarARoles, seleccionarRolYEntrar, obtenerNavegador, validarYCambiarAsociacion } = require('../servicios/autenticacion');
const { leerJardines } = require('../servicios/excel-reader');
const { obtenerJardinesDeAsociacion } = require('../servicios/bd-beneficiarios');

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
        .replace(/[^A-Z0-9_\- ]/g, '')
        .trim()
        .replace(/\s+/g, '_');
}

/**
 * Helper de selección en dropdown con espera dinámica a AJAX/PostBack
 */
async function waitForAndSelect(page, selectLocator, textToMatch = null) {
    if (await selectLocator.count() === 0) return null;
    let opts = [];
    for (let i = 0; i < 20; i++) {
        const isEnabled = await selectLocator.evaluate(s => !s.disabled).catch(() => false);
        if (isEnabled) {
            const raw = await selectLocator.evaluate(s => Array.from(s.options).map(o => ({ v: o.value, t: o.text }))).catch(() => []);
            opts = raw.filter(o => o.v && o.v !== "0" && o.v !== "-1" && !o.t.toUpperCase().includes('SELECCIONE'));
            if (opts.length > 0) break;
        }
        await page.waitForTimeout(300);
    }
    if (opts.length === 0) return opts;

    if (textToMatch) {
        const cleanTarget = removeAccentsStr(textToMatch);
        let match = opts.find(o => removeAccentsStr(o.t).includes(cleanTarget) || o.v.includes(cleanTarget));
        if (!match && opts.length > 0) match = opts[0];
        if (match) {
            await selectLocator.selectOption(match.v).catch(() => {});
            await page.waitForTimeout(400);
            return opts;
        }
    }
    if (opts.length === 1) {
        await selectLocator.selectOption(opts[0].v).catch(() => {});
        await page.waitForTimeout(400);
    }
    return opts;
}

/**
 * Navega a Beneficiario -> Beneficiario -> Desvincular
 */
async function navegarADesvincular(page) {
    console.log(c.cyan('  🚀 Navegando a: Beneficiario -> Beneficiario...'));
    let menuFrame = page.frame({ name: 'frameMenu' });
    if (!menuFrame) {
        for (const f of page.frames()) {
            if (f.name() === 'frameMenu') { menuFrame = f; break; }
        }
    }
    const rootMenu = menuFrame || page;

    try {
        const links = await rootMenu.locator('a:text-is("Beneficiario")').all();
        if (links.length >= 2) {
            await links[1].evaluate(n => n.click());
        } else if (links.length === 1) {
            await links[0].evaluate(n => n.click());
            await page.waitForTimeout(500);
            const nuevosLinks = await rootMenu.locator('a:text-is("Beneficiario")').all();
            if (nuevosLinks.length >= 2) await nuevosLinks[1].evaluate(n => n.click());
        }
        await page.waitForTimeout(1200);
    } catch (e) {
        console.log(c.rojo(`  ⚠️ Error al acceder a Beneficiario: ${e.message}`));
    }

    let contentFrame = page.frame({ name: 'frameContent' });
    if (!contentFrame) {
        for (const f of page.frames()) {
            if (f.name() === 'frameContent') { contentFrame = f; break; }
        }
    }
    if (!contentFrame) throw new Error("No se pudo encontrar el frameContent.");

    // Clic en el botón de Desvincular (-)
    console.log(c.cyan('  🖱️ Haciendo clic en Desvincular...'));
    const btnDesvincular = contentFrame.locator('img[src*="delete.gif"], a[id*="btnDesvincular"]').first();
    if (await btnDesvincular.count() > 0 && await btnDesvincular.isVisible()) {
        await btnDesvincular.click();
        await page.waitForTimeout(1200);
    }
    return contentFrame;
}

/**
 * Captura el pantallazo de un jardín específico en Cuéntame
 */
async function capturarJardin({ page, ascObj, jardinObj, forzar = false }) {
    const nombreJardin = jardinObj.nombreUds || jardinObj.nombre;
    const codigoJardin = jardinObj.codigoUds || jardinObj.codigo || '';

    // Rutas de guardado
    const asocFolder = sanitizarNombreArchivo(ascObj.nombreCorto);
    const nombreLimpio = sanitizarNombreArchivo(nombreJardin);
    const filename = `Pantallazo_${nombreLimpio}.png`;

    const dirJob = path.join(__dirname, '..', 'docs', 'pantallazos', asocFolder);
    const dirApp = path.join(__dirname, '..', '..', 'app-cuentame', 'docs', 'pantallazos', asocFolder);

    if (!fs.existsSync(dirJob)) fs.mkdirSync(dirJob, { recursive: true });
    if (!fs.existsSync(dirApp)) fs.mkdirSync(dirApp, { recursive: true });

    const pathJob = path.join(dirJob, filename);
    const pathApp = path.join(dirApp, filename);

    // Verificar si ya existe para evitar trabajo duplicado
    const esGrande = (jardinObj.totalNinos && jardinObj.totalNinos > 20);
    const parte1File = path.join(dirJob, `Pantallazo_${nombreLimpio}_Parte_1.png`);
    const tienePartes = fs.existsSync(parte1File);

    if (!forzar && fs.existsSync(pathJob) && fs.existsSync(pathApp)) {
        if (!esGrande || tienePartes) {
            const stats = fs.statSync(pathJob);
            if (stats.size > 20000) {
                console.log(c.verde(`  ⏭️  [YA EXISTE]: ${filename} (${(stats.size/1024).toFixed(1)} KB) - Omitiendo.`));
                return { success: true, yaExiste: true, pathJob, pathApp, filename };
            }
        }
    }

    console.log(c.cyan(`\n  📸 Procesando Jardín: [${ascObj.nombreCorto}] ${nombreJardin} (${codigoJardin})`));

    let contentFrame = page.frame({ name: 'frameContent' }) || page.frames().find(f => f.name() === 'frameContent') || page;

    // Verificar si ya estamos en la pantalla de Desvincular con los filtros visibles
    const selectUdsVisible = await contentFrame.locator('select[id*="ddlUDS"], select[id*="UDS"], select[id*="Unidad"]').first().isVisible().catch(() => false);
    
    if (!selectUdsVisible) {
        contentFrame = await navegarADesvincular(page);

        // 1. Área Misional
        console.log(c.gris('    • Seleccionando Área Misional...'));
        let selectArea = contentFrame.locator('select[id*="AreaMisional"]').first();
        if (await selectArea.count() === 0) selectArea = contentFrame.locator('select').nth(0);
        await waitForAndSelect(page, selectArea, 'Primera Infancia');

        // 2. Vigencia
        console.log(c.gris('    • Seleccionando Vigencia...'));
        let vigenciaStr = ascObj.vigenciaContrato || '2026';
        let selectVigencia = contentFrame.locator('select[id*="Vigencia"]').first();
        if (await selectVigencia.count() === 0) selectVigencia = contentFrame.locator('select').nth(2);
        await waitForAndSelect(page, selectVigencia, vigenciaStr);

        // 3. Regional
        console.log(c.gris('    • Seleccionando Regional...'));
        const selectRegional = contentFrame.locator('select[id*="ddlRegional"], select[id*="Regional"]').first();
        await waitForAndSelect(page, selectRegional, 'Bogota D.C.');

        // 4. Contrato
        console.log(c.gris(`    • Seleccionando Contrato: ${ascObj.numeroContrato}...`));
        const selectContrato = contentFrame.locator('select[id*="ddlContrato"], select[id*="Contrato"]').first();
        await waitForAndSelect(page, selectContrato, ascObj.numeroContrato);
    }

    // 5. Servicio (HCB o Jardín Comunitario / Agrupado)
    const selectServicio = contentFrame.locator('select[id*="ddlServicio"], select[id*="Servicio"]').first();
    const servOpts = await waitForAndSelect(page, selectServicio);

    if (servOpts && servOpts.length > 0) {
        const jMod = (jardinObj.modalidad || '').toUpperCase();
        const jNom = (jardinObj.nombreUds || jardinObj.nombre || '').toUpperCase();
        const esAgrupado = jMod.includes('JARDIN') || jMod.includes('AGRUPAD') || jNom.includes('SALA') || jNom.includes('GRUPAL') || jNom.includes('MARAVILLAS') || jNom.includes('ESTRELLITAS') || jNom.includes('SOLECITO') || jNom.includes('ANGELITOS');
        
        const servOpts2026 = servOpts.filter(o => /-2026\b/.test(o.t) || o.t.endsWith("2026"));
        const poolServ = servOpts2026.length > 0 ? servOpts2026 : servOpts;

        let matchServ = null;
        if (esAgrupado) {
            matchServ = poolServ.find(o => o.t.toUpperCase().includes("420269") || o.t.toUpperCase().includes("JARDIN COMUNITARIO"));
        } else {
            matchServ = poolServ.find(o => o.t.toUpperCase().includes("420267") || o.t.toUpperCase().includes("HCB"));
        }
        if (!matchServ) matchServ = poolServ[0];

        const valActual = await selectServicio.inputValue().catch(() => '');
        if (valActual !== matchServ.v) {
            console.log(c.gris(`    • Cambiando Servicio a: ${matchServ.t}...`));
            await selectServicio.selectOption(matchServ.v).catch(() => {});
            await page.waitForTimeout(1000);
        }
    }

    // 6. Seleccionar UDS
    console.log(c.gris(`    • Seleccionando UDS: ${nombreJardin}...`));
    const selectUds = contentFrame.locator('select[id*="ddlUDS"], select[id*="UDS"], select[id*="Unidad"]').first();
    await waitForAndSelect(page, selectUds, codigoJardin || nombreJardin);
    await page.waitForTimeout(500);

    // 7. Ingresar Fecha de Retiro simulada (si está vacía)
    const inputFecha = contentFrame.locator('input[type="text"][id*="FechaRetiro"], input[id*="txtFechaRetiro"]').first();
    if (await inputFecha.count() > 0) {
        const valActual = await inputFecha.inputValue().catch(() => '');
        if (!valActual || valActual.trim() === '') {
            const hoy = new Date();
            const dia = String(hoy.getDate()).padStart(2, '0');
            const mes = String(hoy.getMonth() + 1).padStart(2, '0');
            const anio = hoy.getFullYear();
            const fechaStr = `${dia}/${mes}/${anio}`;

            await inputFecha.evaluate((el, val) => {
                el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.blur();
            }, fechaStr);
            await page.waitForTimeout(300);
        }
    }

    // 8. Seleccionar Motivo de Retiro simulado (si está vacío)
    const selectMotivo = contentFrame.locator('select[id*="ddlMotivo"], select[id*="Motivo"]').first();
    if (await selectMotivo.count() > 0) {
        const valMotivo = await selectMotivo.inputValue().catch(() => '');
        if (!valMotivo || valMotivo === '0' || valMotivo === '-1') {
            let mOpts = [];
            for (let k = 0; k < 15; k++) {
                const isEn = await selectMotivo.evaluate(s => !s.disabled).catch(() => false);
                if (isEn) {
                    mOpts = await selectMotivo.evaluate(s => Array.from(s.options).map(o => ({ v: o.value, t: o.text })));
                    if (mOpts.length > 1) break;
                }
                await page.waitForTimeout(300);
            }
            const matchM = mOpts.find(o => removeAccentsStr(o.t).includes('RETIRO VOLUNTARIO') || removeAccentsStr(o.t).includes('CAMBIOVIGENCIA')) || mOpts[1];
            if (matchM) {
                await selectMotivo.selectOption(matchM.v).catch(() => {});
                await page.waitForTimeout(300);
            }
        }
    }

    // 9. Clic en "Consultar beneficiario"
    console.log(c.gris('    • Consultando beneficiarios...'));
    const btnConsultar = contentFrame.locator('input[type="submit"][value*="Consultar beneficiario"], input[id*="btnBuscar"]').first();
    if (await btnConsultar.count() > 0 && await btnConsultar.isVisible()) {
        await btnConsultar.click();
        await page.waitForTimeout(1800);
    }

    contentFrame = page.frame({ name: 'frameContent' }) || page.frames().find(f => f.name() === 'frameContent') || page;

    // 10. Esperar la tabla de beneficiarios
    const tablaNinos = contentFrame.locator('table[id*="gvBeneficiarios"], table[id*="GridView"]').first();
    try {
        await tablaNinos.waitFor({ state: 'visible', timeout: 12000 });
    } catch (e) {
        console.log(c.amarillo(`    ⚠️ La tabla no se mostró o el jardín no tiene niños activos.`));
        return { success: false, motivo: 'Sin niños activos o timeout de tabla' };
    }

    const totalFilas = await tablaNinos.locator('tr').count();
    const totalNinos = totalFilas > 1 ? totalFilas - 1 : 0;
    console.log(c.verde(`    ✅ Beneficiarios en grilla: ${totalNinos}`));

    const CHUNK_SIZE = 20;

    if (totalNinos <= CHUNK_SIZE) {
        // 11. Disparar Captura única estándar
        await page.setViewportSize({ width: 1400, height: 900 });
        await contentFrame.evaluate(() => {
            const tabla = document.querySelector('table[id*="gvBeneficiarios"], table[id*="GridView"]');
            if (tabla) {
                tabla.scrollIntoView({ behavior: 'instant', block: 'start' });
            }
        }).catch(() => {});
        await page.waitForTimeout(400);

        let screenshotTomado = false;
        try {
            const contenedorCompleto = contentFrame.locator('div:has(> table[id*="gvBeneficiarios"]), div:has(> div:has(table[id*="gvBeneficiarios"]))').first();
            if (await contenedorCompleto.count() > 0 && await contenedorCompleto.isVisible()) {
                await contenedorCompleto.screenshot({ path: pathJob });
                screenshotTomado = true;
            }
        } catch (e) {}

        if (!screenshotTomado) {
            await tablaNinos.screenshot({ path: pathJob });
        }

        // Copiar a app-cuentame
        fs.copyFileSync(pathJob, pathApp);
        console.log(c.verde(`    💾 [GUARDADO HD]: ${filename}`));

        return { success: true, yaExiste: false, pathJob, pathApp, filename, totalNinos, esMultiple: false, numPartes: 1 };
    } else {
        // Jardín Agrupado / Extenso (> 20 niños): Generar partes de máx 20 niños + vista completa
        const numPartes = Math.ceil(totalNinos / CHUNK_SIZE);
        console.log(c.amarillo(`    📑 Jardín agrupado con ${totalNinos} niños. Generando ${numPartes} partes de máx ${CHUNK_SIZE} niños...`));

        const partesGeneradas = [];

        for (let parte = 1; parte <= numPartes; parte++) {
            const startIdx = (parte - 1) * CHUNK_SIZE + 1; // 1-indexado (fila 1 es el primer niño)
            const endIdx = Math.min(parte * CHUNK_SIZE, totalNinos);

            console.log(c.gris(`       • Generando Parte ${parte}: filas ${startIdx} a ${endIdx}...`));

            // Mantener fila 0 (encabezado verde) y mostrar solo rango [startIdx, endIdx]
            await contentFrame.evaluate(({ start, end }) => {
                const trs = document.querySelectorAll('table[id*="gvBeneficiarios"] tr, table[id*="GridView"] tr');
                for (let i = 1; i < trs.length; i++) {
                    if (i >= start && i <= end) {
                        trs[i].style.display = '';
                    } else {
                        trs[i].style.display = 'none';
                    }
                }
            }, { start: startIdx, end: endIdx });

            await page.waitForTimeout(250);

            const parteFilename = `Pantallazo_${nombreLimpio}_Parte_${parte}.png`;
            const pathParteJob = path.join(dirJob, parteFilename);
            const pathParteApp = path.join(dirApp, parteFilename);

            await tablaNinos.screenshot({ path: pathParteJob });
            fs.copyFileSync(pathParteJob, pathParteApp);

            partesGeneradas.push({
                parte,
                filename: parteFilename,
                pathJob: pathParteJob,
                pathApp: pathParteApp
            });
            console.log(c.verde(`       💾 [PARTE ${parte} GUARDADA]: ${parteFilename}`));
        }

        // Restaurar todas las filas visibles
        await contentFrame.evaluate(() => {
            const trs = document.querySelectorAll('table[id*="gvBeneficiarios"] tr, table[id*="GridView"] tr');
            for (let i = 0; i < trs.length; i++) {
                trs[i].style.display = '';
            }
        });

        // Generar también captura completa stitched (todos los niños continuos)
        const fullHeight = await tablaNinos.evaluate(el => el.offsetHeight);
        await page.setViewportSize({ width: 1400, height: Math.max(900, fullHeight + 300) });
        await page.waitForTimeout(300);

        const completoFilename = `Pantallazo_${nombreLimpio}_Completo.png`;
        const pathCompletoJob = path.join(dirJob, completoFilename);
        const pathCompletoApp = path.join(dirApp, completoFilename);

        await tablaNinos.screenshot({ path: pathCompletoJob });
        fs.copyFileSync(pathCompletoJob, pathCompletoApp);

        // Guardar también como Pantallazo_<JARDIN>.png (archivo principal predeterminado)
        fs.copyFileSync(pathCompletoJob, pathJob);
        fs.copyFileSync(pathCompletoJob, pathApp);

        // Restaurar viewport a dimensiones normales
        await page.setViewportSize({ width: 1400, height: 900 });

        console.log(c.verde(`    💾 [COMPLETO Y PARTES 1..${numPartes} GUARDADOS CON ÉXITO]`));

        return { 
            success: true, 
            yaExiste: false, 
            pathJob, 
            pathApp, 
            filename, 
            totalNinos, 
            esMultiple: true, 
            numPartes,
            partes: partesGeneradas
        };
    }
}

/**
 * Función principal con soporte de captura masiva
 */
async function main() {
    console.clear();
    console.log(c.negrita(c.cyan(`
╔══════════════════════════════════════════════════════════════════════════════╗
║        📸 CAPTURADOR MASIVO DE PANTALLAZOS OFICIALES - CUÉNTAME ICBF         ║
║          (Genera los comprobantes oficiales para el portal de madres)        ║
╚══════════════════════════════════════════════════════════════════════════════╝
`)));

    const USUARIO = process.env.CUENTAME_USUARIO;
    const PASSWORD = process.env.CUENTAME_PASSWORD;
    const GMAIL_USER = process.env.GMAIL_USER;
    const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

    if (!USUARIO || !PASSWORD) {
        console.error(c.rojo('\n❌ Faltan credenciales en el archivo .env\n'));
        process.exit(1);
    }

    const RUTA_EXCEL = process.env.RUTA_EXCEL || path.join(__dirname, '..', 'GENERAL_BOTS.xlsx');
    const { porAsociacion } = leerJardines(RUTA_EXCEL);
    const asociaciones = Object.values(porAsociacion).filter(a => a.numeroContrato);

    // Parsear argumentos CLI
    const args = process.argv.slice(2);
    let argAsoc = null;
    let argJardin = null;
    let argMasivo = false;
    let forzar = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--asociacion' && args[i + 1]) argAsoc = args[++i];
        if (args[i] === '--jardin' && args[i + 1]) argJardin = args[++i];
        if (args[i] === '--masivo' || args[i] === '--todo' || args[i] === '--all') argMasivo = true;
        if (args[i] === '--forzar' || args[i] === '--force') forzar = true;
    }

    let planEjecucion = []; // Array de { asociacion, jardines }

    if (argMasivo) {
        // Modo Masivo por CLI
        for (const asc of asociaciones) {
            const jList = obtenerJardinesDeAsociacion(asc.nombreCorto) || [];
            if (jList.length > 0) planEjecucion.push({ asc, jardines: jList });
        }
    } else if (argAsoc) {
        // Asociación específica por CLI
        const cleanA = removeAccentsStr(argAsoc);
        const asc = asociaciones.find(a => removeAccentsStr(a.nombreCorto).includes(cleanA) || cleanA.includes(removeAccentsStr(a.nombreCorto)));
        if (!asc) {
            console.log(c.rojo(`❌ Asociación "${argAsoc}" no encontrada.`));
            return;
        }
        const jList = obtenerJardinesDeAsociacion(asc.nombreCorto) || [];
        if (argJardin) {
            const cleanJ = removeAccentsStr(argJardin);
            const jTarget = jList.find(j => removeAccentsStr(j.nombreUds).includes(cleanJ));
            if (!jTarget) {
                console.log(c.rojo(`❌ Jardín "${argJardin}" no encontrado en ${asc.nombreCorto}.`));
                return;
            }
            planEjecucion.push({ asc, jardines: [jTarget] });
        } else {
            planEjecucion.push({ asc, jardines: jList });
        }
    } else {
        // Menú interactivo
        let ascAutoTrabajo = null;
        if (process.env.ASOCIACION_ACTIVA) {
            try {
                const ascParsed = JSON.parse(process.env.ASOCIACION_ACTIVA);
                ascAutoTrabajo = asociaciones.find(a => removeAccentsStr(a.nombreCorto) === removeAccentsStr(ascParsed.nombreCorto)) || ascParsed;
            } catch (e) {}
        }

        if (ascAutoTrabajo) {
            console.log(c.verde(`  🏢 Asociación Activa (desde AutoTrabajo): ${ascAutoTrabajo.nombreCorto}\n`));
            console.log(`  ${c.amarillo('[1]')} 🚀 Capturar TODOS los jardines de ${ascAutoTrabajo.nombreCorto}`);
            console.log(`  ${c.amarillo('[2]')} 🎯 Capturar un Jardín específico de ${ascAutoTrabajo.nombreCorto}`);
            console.log(`  ${c.amarillo('[3]')} 🌐 ${c.negrita('MODO MASIVO TOTAL')} (Las 7 Asociaciones - ~64 Jardines)`);
            console.log(`  ${c.amarillo('[0]')} 🚪 Volver al Menú Principal\n`);

            const opcion = readline.questionInt(c.negrita('Ingresa tu opción (0-3): '));
            if (opcion === 0) return;

            const jList = obtenerJardinesDeAsociacion(ascAutoTrabajo.nombreCorto) || [];

            if (opcion === 1) {
                planEjecucion.push({ asc: ascAutoTrabajo, jardines: jList });
            } else if (opcion === 2) {
                console.log(c.cyan(`\nSelecciona el Jardín en ${ascAutoTrabajo.nombreCorto}:`));
                const opcionesJ = jList.map(j => `${j.nombreUds} (${j.modalidad || 'HCB'} - ${j.totalNinos} niños)`);
                const jIdx = readline.keyInSelect(opcionesJ, c.negrita('Jardín: '), { cancel: 'Salir' });
                if (jIdx === -1) return;
                forzar = true;
                planEjecucion.push({ asc: ascAutoTrabajo, jardines: [jList[jIdx]] });
            } else if (opcion === 3) {
                for (const a of asociaciones) {
                    const jl = obtenerJardinesDeAsociacion(a.nombreCorto) || [];
                    if (jl.length > 0) planEjecucion.push({ asc: a, jardines: jl });
                }
            }
        } else {
            console.log(c.cyan('¿Qué deseas hacer hoy?\n'));
            console.log(`  ${c.amarillo('[1]')} 🚀 ${c.negrita('MODO MASIVO TOTAL')} (Capturar las 7 Asociaciones - ~64 Jardines)`);
            console.log(`  ${c.amarillo('[2]')} 🏢 Capturar todos los jardines de UNA Asociación`);
            console.log(`  ${c.amarillo('[3]')} 🎯 Capturar un Jardín específico`);
            console.log(`  ${c.amarillo('[0]')} 🚪 Salir\n`);

            const opcion = readline.questionInt(c.negrita('Ingresa tu opción (0-3): '));
            if (opcion === 0) return;

            if (opcion === 1) {
                for (const asc of asociaciones) {
                    const jList = obtenerJardinesDeAsociacion(asc.nombreCorto) || [];
                    if (jList.length > 0) planEjecucion.push({ asc, jardines: jList });
                }
            } else if (opcion === 2 || opcion === 3) {
                console.log(c.cyan('\nSelecciona la Asociación:'));
                const opcionesAsc = asociaciones.map(a => `${a.nombreCorto} (${(obtenerJardinesDeAsociacion(a.nombreCorto) || []).length} jardines)`);
                const ascIdx = readline.keyInSelect(opcionesAsc, c.negrita('Asociación: '), { cancel: 'Salir' });
                if (ascIdx === -1) return;
                const asc = asociaciones[ascIdx];
                const jList = obtenerJardinesDeAsociacion(asc.nombreCorto) || [];

                if (opcion === 2) {
                    planEjecucion.push({ asc, jardines: jList });
                } else {
                    console.log(c.cyan(`\nSelecciona el Jardín en ${asc.nombreCorto}:`));
                    const opcionesJ = jList.map(j => `${j.nombreUds} (${j.modalidad || 'HCB'} - ${j.totalNinos} niños)`);
                    const jIdx = readline.keyInSelect(opcionesJ, c.negrita('Jardín: '), { cancel: 'Salir' });
                    if (jIdx === -1) return;
                    forzar = true;
                    planEjecucion.push({ asc, jardines: [jList[jIdx]] });
                }
            }
        }
    }

    if (planEjecucion.length === 0) {
        console.log(c.amarillo('\n⚠️ No hay jardines programados para procesar.'));
        return;
    }

    let totalJardinesPlan = planEjecucion.reduce((acc, p) => acc + p.jardines.length, 0);
    console.log(c.verde(`\n📋 PLAN DE CAPTURA PROGRAMADO:`));
    console.log(c.gris(`   Asociaciones a procesar: ${planEjecucion.length}`));
    console.log(c.gris(`   Total jardines a procesar: ${totalJardinesPlan}`));
    console.log(c.gris(`   Modo sobreescritura: ${forzar ? 'ACTIVADO' : 'OMITIR EXISTENTES (Recomendado)'}\n`));

    console.log(c.cyan('🚀 Conectando al navegador...'));
    const nav = await obtenerNavegador();
    const { browser, page } = nav;

    page.on('dialog', async dialog => {
        console.log(c.magenta(`  💬 Alerta Cuéntame: ${dialog.message()}`));
        await dialog.accept().catch(() => {});
    });

    let jardinGlobalCount = 0;
    let exitosos = 0;
    let omitidos = 0;
    let errores = 0;

    for (let aIdx = 0; aIdx < planEjecucion.length; aIdx++) {
        const item = planEjecucion[aIdx];
        const asc = item.asc;
        console.log(c.negrita(c.amarillo(`\n══════════════════════════════════════════════════════════════`)));
        console.log(c.negrita(c.amarillo(`🏢 ASOCIACIÓN [${aIdx + 1}/${planEjecucion.length}]: ${asc.nombreCorto} (${item.jardines.length} jardines)`)));
        console.log(c.negrita(c.amarillo(`══════════════════════════════════════════════════════════════`)));

        try {
            const mismaAsc = await validarYCambiarAsociacion(page, asc);
            if (!mismaAsc) {
                await loginYLlegarARoles(page, { usuario: USUARIO, password: PASSWORD, gmailUser: GMAIL_USER, gmailAppPassword: GMAIL_APP_PASSWORD });
                await seleccionarRolYEntrar(page, asc);
            }

            for (let jIdx = 0; jIdx < item.jardines.length; jIdx++) {
                jardinGlobalCount++;
                const jardin = item.jardines[jIdx];
                console.log(c.gris(`\n[Progreso Total: ${jardinGlobalCount}/${totalJardinesPlan}] • Jardín ${jIdx + 1}/${item.jardines.length}`));

                try {
                    const res = await capturarJardin({ page, ascObj: asc, jardinObj: jardin, forzar });
                    if (res && res.yaExiste) {
                        omitidos++;
                    } else if (res && res.success) {
                        exitosos++;
                    } else {
                        errores++;
                    }
                } catch (errJ) {
                    console.error(c.rojo(`  ❌ Error capturando ${jardin.nombreUds}: ${errJ.message}`));
                    errores++;
                }

                await page.waitForTimeout(600);
            }

        } catch (errA) {
            console.error(c.rojo(`❌ Error en asociación ${asc.nombreCorto}: ${errA.message}`));
        }
    }

    console.log(c.negrita(c.verde(`\n╔══════════════════════════════════════════════════════════════╗`)));
    console.log(c.negrita(c.verde(`║              🎉 RESUMEN DE CAPTURA MASIVA                   ║`)));
    console.log(c.negrita(c.verde(`╠══════════════════════════════════════════════════════════════╣`)));
    console.log(c.verde(`║  ✅ Pantallazos nuevos capturados:   ${String(exitosos).padEnd(23)}║`));
    console.log(c.cyan(`║  ⏭️  Omitidos (ya existían en disco):  ${String(omitidos).padEnd(23)}║`));
    console.log(c.rojo(`║  ❌ Con observaciones / errores:     ${String(errores).padEnd(23)}║`));
    console.log(c.negrita(c.verde(`╚══════════════════════════════════════════════════════════════╝\n`)));
    console.log(c.cyan(`📁 Los archivos están listos en: c:\\Dev\\app-cuentame\\docs\\pantallazos\\\n`));
    process.exit(0);
}

module.exports = {
    capturarJardin,
    navegarADesvincular,
    sanitizarNombreArchivo
};

if (require.main === module) {
    main().catch(console.error);
}
