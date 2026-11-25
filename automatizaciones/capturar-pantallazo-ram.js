/**
 * capturar-pantallazo-ram.js
 * 
 * Automatización para capturar el pantallazo oficial de ASISTENCIA RAM en Cuéntame
 * para una UDS / Jardín específico o asociación.
 * (Módulo: Registro de asistencia mensual - RAM)
 * 
 * Parámetros CLI:
 *   --asociacion "CANAIMA"
 *   --jardin "EL BEBE"
 *   --codigoUds "11001..."
 *   --mes "Noviembre"
 *   --anio 2026
 *   --forzar
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { loginYLlegarARoles, seleccionarRolYEntrar, obtenerNavegador, validarYCambiarAsociacion } = require('../servicios/autenticacion');
const { leerJardines } = require('../servicios/excel-reader');
const { seleccionarDropdownReactivo, esperarPostBackReactivo } = require('../servicios/filtro-monitor');

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

function filtrarServiciosPorAsociacion(servOptions, ascNombre, tipoServicio) {
    let options2026 = servOptions.filter(o => /-2026\b/.test(o.text) || o.text.endsWith("2026"));
    let options = options2026.length > 0 ? options2026 : servOptions;
    const ascUpper = removeAccentsStr(ascNombre);

    if (ascUpper.includes("DELICIAS DEL CARMEN")) {
        options = options.filter(o => o.text.includes("420269") || o.text.toUpperCase().includes("JARDIN COMUNITARIO"));
    } else if (ascUpper.includes("BARRIOS UNIDOS") || 
               ascUpper.includes("PROGRESO INFANTIL") || 
               ascUpper.includes("BRISAS DE BUENAVISTA")) {
        options = options.filter(o => o.text.includes("420267") || o.text.toUpperCase().includes("HCB"));
    } else {
        if (tipoServicio === 'Individual') {
            options = options.filter(o => (o.text.includes("420267") || o.text.toUpperCase().includes("HCB")) && !o.text.includes("420269"));
        } else if (tipoServicio === 'Agrupado') {
            options = options.filter(o => o.text.includes("420269") || o.text.toUpperCase().includes("JARDIN COMUNITARIO"));
        }
    }
    return options.length > 0 ? options : servOptions;
}

async function sincronizarPantallazoConServidores(payload) {
    const targets = [
        'http://127.0.0.1:3000/api/admin/subir-pantallazo-ram',
        'https://portal-cuentame.onrender.com/api/admin/subir-pantallazo-ram'
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
                        console.log(c.verde(`    ☁️ Pantallazo RAM sincronizado exitosamente con ${destino}.`));
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

async function main() {
    const USUARIO = process.env.CUENTAME_USUARIO;
    const PASSWORD = process.env.CUENTAME_PASSWORD;
    const GMAIL_USER = process.env.GMAIL_USER;
    const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

    if (!USUARIO || !PASSWORD) {
        console.error(c.rojo('\n❌ Faltan CUENTAME_USUARIO o CUENTAME_PASSWORD en .env'));
        process.exit(1);
    }

    // 1. Argumentos CLI
    const args = process.argv.slice(2);
    let asociacionArg = null;
    let jardinArg = null;
    let codigoUdsArg = null;
    let mesArg = null;
    let anioArg = 2026;
    let forzar = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--asociacion' && args[i + 1]) asociacionArg = args[++i].replace(/^"|"$/g, '');
        else if (args[i] === '--jardin' && args[i + 1]) jardinArg = args[++i].replace(/^"|"$/g, '');
        else if (args[i] === '--codigoUds' && args[i + 1]) codigoUdsArg = args[++i].replace(/^"|"$/g, '');
        else if (args[i] === '--mes' && args[i + 1]) mesArg = args[++i].replace(/^"|"$/g, '');
        else if (args[i] === '--anio' && args[i + 1]) anioArg = parseInt(args[++i], 10) || 2026;
        else if (args[i] === '--forzar') forzar = true;
    }

    const todosLosMeses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const fechaActual = new Date();
    const mesObjetivo = mesArg || todosLosMeses[fechaActual.getMonth()];

    console.log(c.negrita(c.cyan(`\n══════════════════════════════════════════════════════════════`)));
    console.log(c.negrita(c.cyan(`📸 CAPTURAR PANTALLAZO ASISTENCIA RAM - CUÉNTAME ICBF`)));
    console.log(c.negrita(c.cyan(`══════════════════════════════════════════════════════════════`)));
    console.log(c.gris(`  Asociación: ${asociacionArg || 'Detectar automáticamente'}`));
    console.log(c.gris(`  Jardín:     ${jardinArg || 'Todos / Primero disponible'}`));
    console.log(c.gris(`  Código UDS: ${codigoUdsArg || 'N/A'}`));
    console.log(c.gris(`  Mes:        ${mesObjetivo} ${anioArg}`));
    console.log(c.gris(`  Forzar:     ${forzar ? 'Sí' : 'No'}\n`));

    // 2. Cargar Excel con información de contratos
    const RUTA_EXCEL = process.env.RUTA_EXCEL || 'C:\\GENERAL_BOTS.xlsx';
    let asociaciones = [];
    try {
        const { porAsociacion } = leerJardines(RUTA_EXCEL);
        asociaciones = Object.values(porAsociacion).filter(a => a.numeroContrato);
    } catch(e) {
        console.log(c.amarillo(`  ⚠️ No se pudo leer Excel: ${e.message}`));
    }

    const overrideContratos = {
        'VERBENAL Y REFUGIO': '11027492024',
        'BRISAS DE BUENAVISTA': '11026892024'
    };
    for (let asc of asociaciones) {
        if (overrideContratos[asc.nombreCorto]) {
            asc.numeroContrato = overrideContratos[asc.nombreCorto];
        }
    }

    // 3. Obtener o conectar navegador
    console.log(c.cyan('🚀 Conectando al navegador...'));
    const nav = await obtenerNavegador();
    const { browser, page: mainPage } = nav;

    mainPage.on('dialog', async dialog => {
        console.log(c.magenta(`  💬 Alerta Cuéntame: ${dialog.message()}`));
        await dialog.accept().catch(() => {});
    });

    // 4. Validar asociación
    let ascObj = null;
    if (asociacionArg) {
        ascObj = asociaciones.find(a => 
            removeAccentsStr(a.nombreCorto).includes(removeAccentsStr(asociacionArg)) ||
            removeAccentsStr(asociacionArg).includes(removeAccentsStr(a.nombreCorto))
        );
    }

    if (!ascObj && asociaciones.length > 0) {
        ascObj = asociaciones[0];
    }

    if (ascObj) {
        const mismaAsc = await validarYCambiarAsociacion(mainPage, ascObj);
        if (!mismaAsc) {
            await loginYLlegarARoles(mainPage, { usuario: USUARIO, password: PASSWORD, gmailUser: GMAIL_USER, gmailAppPassword: GMAIL_APP_PASSWORD });
            await seleccionarRolYEntrar(mainPage, ascObj);
        }
    }

    // 5. Navegar a Registro de Asistencia Mensual - RAM
    console.log(c.cyan('\n  🚀 Navegando a: Registro de asistencia mensual - RAM...'));
    await mainPage.goto('https://rubonline.icbf.gov.co/Page/RUBONLINE/RegistroAsistencia/List.aspx', { 
        waitUntil: 'domcontentloaded', 
        timeout: 60000 
    });
    await mainPage.waitForTimeout(800);

    let contentFrame = mainPage.frame({ name: 'frameContent' }) || mainPage.frames().find(f => f.name() === 'frameContent') || mainPage;

    const selectDropdown = async (keyword, textOrIndex) => {
        try {
            const sel = contentFrame.locator(`select[id*="${keyword}" i], select[name*="${keyword}" i]`).first();
            if (await sel.count() === 0) return false;

            await contentFrame.waitForFunction((kw) => {
                const el = document.querySelector(`select[id*="${kw}" i], select[name*="${kw}" i]`);
                return el && !el.disabled && el.options && el.options.length > 0;
            }, keyword, { timeout: 8000 }).catch(() => {});

            let valueToSelect = null;
            if (typeof textOrIndex === 'string') {
                const targetText = removeAccentsStr(textOrIndex);
                valueToSelect = await sel.evaluate((s, t) => {
                    const opts = Array.from(s.options).filter(o => o.value && o.value !== "0" && o.value !== "-1" && o.value !== "" && !o.text.toUpperCase().includes("SELECCIONE"));
                    if (opts.length === 0) return null;

                    const tNorm = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
                    let opt = opts.find(o => {
                        const oNorm = o.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
                        return oNorm.includes(tNorm) || tNorm.includes(oNorm);
                    });
                    if (opt) return opt.value;

                    const mapaMeses = {
                        'ENERO': '1', 'FEBRERO': '2', 'MARZO': '3', 'ABRIL': '4', 'MAYO': '5', 'JUNIO': '6',
                        'JULIO': '7', 'AGOSTO': '8', 'SEPTIEMBRE': '9', 'OCTUBRE': '10', 'NOVIEMBRE': '11', 'DICIEMBRE': '12'
                    };
                    const numMes = mapaMeses[tNorm] || (mapaMeses[tNorm.slice(0, 3)] || '');
                    if (numMes) {
                        opt = opts.find(o => {
                            const v = String(o.value).trim();
                            const txt = o.text.trim();
                            return v === numMes || txt.startsWith(numMes + ' ') || txt.startsWith(numMes + '-') || txt.startsWith(numMes + '.');
                        });
                        if (opt) return opt.value;
                    }
                    return null;
                }, targetText);
            } else if (typeof textOrIndex === 'number') {
                valueToSelect = await sel.evaluate(s => {
                    const opt = Array.from(s.options).find(o => o.value && o.value !== "0" && o.value !== "-1" && o.value !== "");
                    return opt ? opt.value : null;
                });
            }

            if (valueToSelect) {
                await seleccionarDropdownReactivo(mainPage, contentFrame, sel, valueToSelect, { nombreEtiqueta: keyword });
                return true;
            }
        } catch(e) {}
        return false;
    };

    // 0. Dirección Misional
    console.log(c.gris('    • Seleccionando Área Misional...'));
    await selectDropdown('Direcciones', 'Primera Infancia');

    // 1. Regional
    console.log(c.gris('    • Seleccionando Regional...'));
    await selectDropdown('Regional', 'Bogota');

    // 2. Vigencia
    console.log(c.gris('    • Seleccionando Vigencia...'));
    const vigenciaStr = (ascObj && ascObj.vigenciaContrato ? ascObj.vigenciaContrato : '2024').toString();
    await selectDropdown('Vigencia', vigenciaStr);

    // 3. Contrato
    if (ascObj && ascObj.numeroContrato) {
        console.log(c.gris(`    • Seleccionando Contrato: ${ascObj.numeroContrato}...`));
        await selectDropdown('Contrato', ascObj.numeroContrato.toString());
    } else {
        await selectDropdown('Contrato', 1);
    }

    // 4. Servicio y UDS
    console.log(c.gris('    • Buscando Servicio y UDS...'));
    const servicioLocator = contentFrame.locator('select[id*="ddlNombreServicio"], select[id*="Servicio"]').first();
    if (await servicioLocator.count() > 0) {
        let servOpts = [];
        for (let r = 0; r < 40; r++) {
            servOpts = await servicioLocator.evaluate(s => {
                return Array.from(s.options)
                    .filter(o => o.value && o.value !== "0" && o.value !== "-1" && o.value !== "" && !o.text.toUpperCase().includes("SELECCIONE"))
                    .map(o => ({ value: o.value, text: o.text }));
            });
            if (servOpts.length > 0) break;
            await mainPage.waitForTimeout(100);
        }

        const esAgrupado = (jardinArg || '').toUpperCase().includes('SALA CUNA') || (jardinArg || '').toUpperCase().includes('AGRUPADO');
        const tipoServ = esAgrupado ? 'Agrupado' : 'Individual';
        let servValidos = filtrarServiciosPorAsociacion(servOpts, ascObj ? ascObj.nombreCorto : '', tipoServ);
        if (servValidos.length === 0) servValidos = servOpts;

        const uLoc = contentFrame.locator('select[id*="ddlIdContratoUnidadServicioNombreUds"], select[id*="Uds"], select[id*="UDS"], select[id*="Unidad"]').first();
        let udsValue = null;
        const codigoSearch = String(codigoUdsArg || '').trim();
        const nombreSearch = removeAccentsStr(jardinArg || '');

        for (const serv of servValidos) {
            const curServ = await servicioLocator.evaluate(s => s.value);
            if (curServ !== serv.value) {
                await seleccionarDropdownReactivo(mainPage, contentFrame, servicioLocator, serv.value, { dependienteSelector: 'select[id*="ddlIdContratoUnidadServicioNombreUds"]', nombreEtiqueta: 'Servicio' });
            }

            for (let r = 0; r < 20; r++) {
                udsValue = await uLoc.evaluate((s, { code, name }) => {
                    const validOpts = Array.from(s.options).filter(o => o.value && o.value !== "0" && o.value !== "-1" && o.value !== "" && !o.text.toUpperCase().includes("SELECCIONE"));
                    if (validOpts.length === 0) return null;

                    const opt = validOpts.find(o => {
                        const textNorm = o.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
                        return (code && textNorm.includes(code)) ||
                               (name && textNorm.includes(name)) ||
                               (name && name.includes(textNorm));
                    });
                    return opt ? opt.value : null;
                }, { code: codigoSearch, name: nombreSearch });

                if (udsValue) break;
                await mainPage.waitForTimeout(100);
            }
            if (udsValue) break;
        }

        if (udsValue) {
            console.log(c.verde(`    ✓ UDS encontrada en opciones de Cuéntame.`));
            await seleccionarDropdownReactivo(mainPage, contentFrame, uLoc, udsValue, { nombreEtiqueta: 'UDS' });
        } else {
            console.log(c.amarillo(`    ⚠️ No se encontró la UDS específica en los dropdowns. Se intentará continuar.`));
        }
    }

    // 5. Mes y Estado
    console.log(c.cyan(`    📅 Configurando Mes: "${mesObjetivo}" y Estado: "Todos"...`));
    await selectDropdown('Mes', mesObjetivo);
    await selectDropdown('Estado', 'Todos');

    // 6. Clic en Lupa (Buscar)
    console.log(c.gris('    👉 Clic en Consultar/Buscar para cargar la grilla de asistencia...'));
    const lupa = contentFrame.locator('a#btnBuscar, a#btnConsultar, input[type="image"][id*="btnConsultar" i], input[type="image"][id*="btnBuscar" i], img[title*="Consultar" i], img[title*="Buscar" i]').first();
    await esperarPostBackReactivo(mainPage, async () => {
        if (await lupa.count() > 0 && await lupa.isVisible()) {
            await lupa.click();
        } else {
            const genericBtn = contentFrame.locator('a:has(img[src*="list.png"]):visible, input[type="image"]:visible, img[src*="lupa"]:visible').first();
            if (await genericBtn.count() > 0) await genericBtn.click();
        }
    }, 15000);

    contentFrame = mainPage.frame({ name: 'frameContent' }) || mainPage.frames().find(f => f.name() === 'frameContent') || mainPage;

    // 7. Esperar a que la tabla aparezca
    const tabla = contentFrame.locator('table[id*="grdConsulta"], table[id*="gvLista"], table[id*="GridView"], table.mGrid, table.rgMasterTable, table[id*="Grid"]').first();
    await tabla.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

    // 8. Capturar pantallazo
    let buffer = null;
    try {
        if (await tabla.count() > 0 && await tabla.isVisible()) {
            console.log(c.cyan('    📸 Capturando grilla oficial del RAM...'));
            buffer = await tabla.screenshot();
        }
    } catch(e) {}

    if (!buffer) {
        console.log(c.amarillo('    📸 Capturando página completa como respaldo...'));
        buffer = await mainPage.screenshot({ fullPage: true });
    }

    // 9. Nombres y directorios de guardado
    const asocClean = sanitizarNombreArchivo(ascObj ? ascObj.nombreCorto : asociacionArg) || 'GENERAL';
    const jardinClean = sanitizarNombreArchivo(jardinArg) || 'JARDIN';
    const mesClean = sanitizarNombreArchivo(mesObjetivo);
    const codClean = codigoUdsArg ? String(codigoUdsArg).trim() : '';

    const filename = `RAM_${asocClean}_${jardinClean}_${mesClean}_${anioArg}.png`;

    const dirs = [
        path.join(__dirname, '..', 'docs', 'reportes', 'ram', asocClean),
        path.join(__dirname, '..', 'docs', 'pantallazos', asocClean),
        path.join(__dirname, '..', '..', 'app-cuentame', 'docs', 'reportes', 'ram', asocClean),
        path.join(__dirname, '..', '..', 'app-cuentame', 'docs', 'pantallazos', asocClean)
    ];

    for (const d of dirs) {
        try {
            if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

            // Borrar pantallazos anteriores de este jardín y mes
            const existentes = fs.readdirSync(d);
            for (const arch of existentes) {
                const archUp = arch.toUpperCase();
                if (!archUp.startsWith('RAM_')) continue;
                const coincideCod = codClean && archUp.includes(codClean.toUpperCase());
                const coincideNom = archUp.includes(jardinClean) && archUp.includes(mesClean);
                if (coincideCod || coincideNom) {
                    try {
                        fs.unlinkSync(path.join(d, arch));
                        console.log(c.gris(`    🗑️ Pantallazo anterior eliminado: ${arch}`));
                    } catch(err) {}
                }
            }
            fs.writeFileSync(path.join(d, filename), buffer);
        } catch(e) {}
    }

    console.log(c.verde(`\n  💾 Pantallazo RAM guardado exitosamente: ${filename}`));

    // 10. Sincronizar vía HTTP con Render y Localhost
    const base64Data = buffer.toString('base64');
    await sincronizarPantallazoConServidores({
        asociacion: ascObj ? ascObj.nombreCorto : asociacionArg,
        jardin: jardinArg,
        codigoUds: codigoUdsArg,
        mes: mesObjetivo,
        anio: anioArg,
        filename,
        imagenBase64: base64Data
    });

    console.log(c.negrita(c.verde(`\n  ✅ Proceso de Captura de Pantallazo RAM finalizado con éxito.\n`)));
    process.exit(0);
}

if (require.main === module) {
    main().catch(err => {
        console.error(c.rojo(`\n❌ Error fatal: ${err.message}`));
        process.exit(1);
    });
}
