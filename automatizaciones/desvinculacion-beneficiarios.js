/**
 * desvinculacion-beneficiarios.js
 * Script para desvincular (retirar) beneficiarios en Cuentame.
 * Soporta Pre-consulta interactiva OFF-LINE con la BD Master y ejecucion automatica en lote.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const readline = require('readline-sync');
const { loginYLlegarARoles, seleccionarRolYEntrar, obtenerNavegador, validarYCambiarAsociacion } = require('../servicios/autenticacion');
const { leerJardines } = require('../servicios/excel-reader');
const { obtenerJardinesDeAsociacion, obtenerNinosDeJardin } = require('../servicios/bd-beneficiarios');

const c = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
  rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
  gris:     (t) => `\x1b[90m${t}\x1b[0m`,
  negrita:  (t) => `\x1b[1m${t}\x1b[0m`,
  magenta:  (t) => `\x1b[35m${t}\x1b[0m`
};

const removeAccentsStr = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();

const esFechaValida = (str) => {
    if (!str) return false;
    const s = str.trim();
    if (/^\d{8}$/.test(s)) {
        const dia = parseInt(s.substring(0, 2), 10);
        const mes = parseInt(s.substring(2, 4), 10);
        const anio = parseInt(s.substring(4, 8), 10);
        return dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && anio >= 2000 && anio <= 2035;
    }
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
        const dia = parseInt(m[1], 10);
        const mes = parseInt(m[2], 10);
        const anio = parseInt(m[3], 10);
        return dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && anio >= 2000 && anio <= 2035;
    }
    return false;
};

const opcionesMotivo = [
    "Alto costo para la familia (transporte)",
    "Cambio de Grupo Familiar",
    "CambioVigencia",
    "Conflicto Armado",
    "Desplazamiento forzado",
    "Distancia en centro de atencion",
    "Edad Cumplida",
    "En casa hay quien lo cuide",
    "Enfermedad",
    "Fallecimiento",
    "No le gusta la comida",
    "otro",
    "Paso al SIMAT",
    "Retiro voluntario del programa",
    "Transito a otro Programa",
    "Traslado de municipio"
];

async function main() {
    const USUARIO = process.env.CUENTAME_USUARIO;
    const PASSWORD = process.env.CUENTAME_PASSWORD;
    const GMAIL_USER = process.env.GMAIL_USER;
    const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

    if (!USUARIO || !PASSWORD) {
        console.error(c.rojo('\n❌ Faltan credenciales en el archivo .env\n'));
        process.exit(1);
    }

    const RUTA_EXCEL = process.env.RUTA_EXCEL || 'C:\\GENERAL_BOTS.xlsx';
    const { porAsociacion } = leerJardines(RUTA_EXCEL);
    const asociaciones = Object.values(porAsociacion).filter(a => a.numeroContrato);

    if (asociaciones.length === 0) {
        console.log(c.rojo('❌ No se encontraron asociaciones validas en la configuracion.'));
        return;
    }

    console.log(c.cyan('\n===================================================================='));
    console.log(c.cyan('   ❌ DESVINCULACION DE BENEFICIARIOS (PRE-CONSULTA OFF-LINE EN LOTE)'));
    console.log(c.cyan('====================================================================\n'));

    const tareasPreparadas = [];
    let baseAsc = null;
    let asociacionForzada = false;
    let fechaGlobal = null;
    let motivoGlobal = null;

    if (process.env.ASOCIACION_ACTIVA) {
        try {
            const ascObj = JSON.parse(process.env.ASOCIACION_ACTIVA);
            baseAsc = asociaciones.find(a => removeAccentsStr(a.nombreCorto) === removeAccentsStr(ascObj.nombreCorto)) || ascObj;
            asociacionForzada = true;
        } catch (e) {}
    }

    // --- FASE 1: PREPARACION OFF-LINE INTERACTIVA ---
    while (true) {
        if (!baseAsc) {
            console.log(c.cyan('\n  📋 Selecciona la Asociacion:'));
            const opcionesAsc = asociaciones.map(a => `${a.nombreCorto} (Contrato: ${a.numeroContrato})`);
            const ascIdx = readline.keyInSelect(opcionesAsc, c.negrita('  > Asociacion: '), { cancel: tareasPreparadas.length > 0 ? 'Finalizar Seleccion y Procesar Lote' : 'Volver al Menu Principal' });

            if (ascIdx === -1) {
                if (tareasPreparadas.length === 0) {
                    console.log(c.verde('\n  👋 Volviendo al menu principal...'));
                    return;
                }
                break;
            }
            baseAsc = asociaciones[ascIdx];
        } else {
            console.log(c.verde(`\n  ✅ Asociacion Activa: ${baseAsc.nombreCorto}`));
        }

        // 2. Seleccionar Jardin desde BD Master Local
        const jardinesLocal = obtenerJardinesDeAsociacion(baseAsc.nombreCorto);
        if (!jardinesLocal || jardinesLocal.length === 0) {
            console.log(c.rojo(`  ⚠️ No se encontraron jardines para ${baseAsc.nombreCorto} en la BD Local. Descarga primero el reporte de beneficiarios.`));
            baseAsc = null;
            continue;
        }

        console.log(c.cyan(`\n  📋 Selecciona el Jardin / UDS en ${baseAsc.nombreCorto}:`));
        const opcionesJardines = jardinesLocal.map(j => `${j.nombreUds} (${j.modalidad || 'HCB'} - ${j.totalNinos} ninos)`);
        const cancelText = asociacionForzada ? (tareasPreparadas.length > 0 ? 'Finalizar Seleccion y Procesar Lote' : 'Volver al Menu Principal') : 'Cambiar de Asociacion';
        const jIdx = readline.keyInSelect(opcionesJardines, c.negrita('  > Jardin: '), { cancel: cancelText });

        if (jIdx === -1) {
            if (asociacionForzada) {
                if (tareasPreparadas.length === 0) {
                    console.log(c.verde('\n  👋 Volviendo al menu principal...'));
                    return;
                }
                break;
            } else {
                baseAsc = null;
                continue;
            }
        }

        const jardinElegido = jardinesLocal[jIdx];

        // 3. Seleccionar Beneficiario desde BD Master Local
        const ninosLocal = obtenerNinosDeJardin(baseAsc.nombreCorto, jardinElegido.nombreUds);
        if (!ninosLocal || ninosLocal.length === 0) {
            console.log(c.rojo(`  ⚠️ No se encontraron ninos registrados en ${jardinElegido.nombreUds}.`));
            continue;
        }

        while (true) {
            console.log(c.cyan(`\n  📂 Beneficiarios en ${jardinElegido.nombreUds} (${ninosLocal.length}):`));
            ninosLocal.forEach((n, idx) => {
                console.log(`  ${idx + 1}. ${n.nombreCompleto} (${n.tipoDoc}: ${n.documento} - ${n.edad} anos)`);
            });

            const respNino = readline.question(c.negrita('\n  > Ingrese el Numero (ej: 1), Documento, Nombre o Apellido (o Vacio para cambiar de Jardin): ')).trim();
            if (!respNino) break;

            let ninoSeleccionado = null;
            const numNino = parseInt(respNino, 10);

            if (!isNaN(numNino) && numNino >= 1 && numNino <= ninosLocal.length) {
                ninoSeleccionado = ninosLocal[numNino - 1];
            } else {
                const qName = removeAccentsStr(respNino);
                const coincidencias = ninosLocal.filter(n => removeAccentsStr(n.nombreCompleto).includes(qName) || n.documento.includes(qName));
                if (coincidencias.length === 0) {
                    console.log(c.rojo(`  ❌ No se encontro ningun nino que coincida con "${respNino}".`));
                    continue;
                }
                if (coincidencias.length > 1) {
                    console.log(c.amarillo(`  ⚠️ Coincidieron varios ninos:`));
                    coincidencias.forEach(n => console.log(`    - ${n.nombreCompleto} (${n.documento})`));
                    console.log(c.amarillo('  Por favor sea mas especifico o elija por numero.'));
                    continue;
                }
                ninoSeleccionado = coincidencias[0];
            }

            console.log(c.verde(`\n  ✅ Nino seleccionado: ${ninoSeleccionado.nombreCompleto} (${ninoSeleccionado.documento})`));

            // 4. Preguntar Fecha de Retiro
            let fechaRetiro = fechaGlobal;
            while (true) {
                const promptMsg = fechaGlobal
                    ? `\n  > Fecha de retiro (DD/MM/YYYY) [ENTER para mantener ${fechaGlobal}]: `
                    : `\n  > Fecha de retiro (DD/MM/YYYY): `;
                const fInput = readline.question(c.negrita(promptMsg)).trim();

                if (fInput === '' && fechaGlobal) {
                    fechaRetiro = fechaGlobal;
                    break;
                }

                if (esFechaValida(fInput)) {
                    if (/^\d{8}$/.test(fInput)) {
                        fechaRetiro = `${fInput.substring(0,2)}/${fInput.substring(2,4)}/${fInput.substring(4,8)}`;
                    } else {
                        fechaRetiro = fInput;
                    }
                    fechaGlobal = fechaRetiro;
                    break;
                } else {
                    console.log(c.rojo('  ❌ Formato de fecha invalido. Debe ser DD/MM/YYYY (ej: 15/08/2026 o 15082026).'));
                }
            }

            // 5. Preguntar Motivo de Retiro
            let motivoRetiro = motivoGlobal;
            if (motivoGlobal) {
                console.log(c.cyan(`\n  Motivo actual pre-seleccionado: "${motivoGlobal}"`));
                const resMot = readline.question(c.negrita('  > Opcion (ENTER para mantener, "c" para cambiar): ')).trim().toLowerCase();
                if (resMot === 'c') motivoRetiro = null;
            }

            if (!motivoRetiro) {
                console.log(c.cyan('\n  --- SELECCIONA EL MOTIVO DE RETIRO ---'));
                opcionesMotivo.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
                let mIdx = -1;
                while (mIdx < 0 || mIdx >= opcionesMotivo.length) {
                    const resM = readline.question(c.negrita('\n  > Opcion (vacio para "otro"): ')).trim();
                    if (resM === '') {
                        mIdx = opcionesMotivo.indexOf("otro");
                        break;
                    }
                    mIdx = parseInt(resM, 10) - 1;
                    if (isNaN(mIdx)) mIdx = -1;
                }
                motivoRetiro = opcionesMotivo[mIdx];
                motivoGlobal = motivoRetiro;
            }

            // Guardar tarea preparada
            tareasPreparadas.push({
                asociacion: baseAsc,
                jardin: jardinElegido,
                nino: ninoSeleccionado,
                fechaRetiro: fechaRetiro,
                motivo: motivoRetiro
            });

            console.log(c.verde(`  ➕ [LOTE RETIRO] Agregado: ${ninoSeleccionado.nombreCompleto} (${jardinElegido.nombreUds}) | Fecha: ${fechaRetiro} | Motivo: ${motivoRetiro}`));

            const masJardin = readline.question(c.negrita('\n  > Deseas desvincular otro nino en este mismo jardin? (s/n) [por defecto s]: ')).trim();
            if (masJardin.toLowerCase() === 'n') break;
        }

        const continuarMas = readline.question(c.negrita('\n  > Deseas agregar desvinculaciones en otro jardin o asociacion? (s/n) [por defecto n]: ')).trim();
        if (continuarMas.toLowerCase() !== 's') break;
    }

    if (tareasPreparadas.length === 0) {
        console.log(c.amarillo('\n  ⚠️ No se preparo ninguna tarea. Volviendo al menu principal...'));
        return;
    }

    // --- RESUMEN DEL LOTE DE RETIRO ---
    console.log(c.cyan('\n===================================================================='));
    console.log(c.cyan(`  📋 RESUMEN DEL LOTE A DESVINCULAR EN CUENTAME (${tareasPreparadas.length} TAREAS):`));
    console.log(c.cyan('===================================================================='));
    tareasPreparadas.forEach((t, idx) => {
        console.log(`  ${idx + 1}. [${t.asociacion.nombreCorto} | ${t.jardin.nombreUds}] ${t.nino.nombreCompleto} (Doc: ${t.nino.documento})`);
        console.log(`     -> Fecha: ${t.fechaRetiro} | Motivo: ${t.motivo}`);
    });

    const confirm = readline.question(c.negrita('\n  > Confirmar y ejecutar desvinculaciones automaticamente en Cuentame? (ENTER = Si, n = Cancelar): ')).trim();
    if (confirm.toLowerCase() === 'n') {
        console.log(c.amarillo('  ⚠️ Operacion cancelada por el usuario.'));
        return;
    }

    // --- FASE 2: EJECUCION AUTOMATICA EN CUENTAME ---
    console.log(c.cyan('\n===================================================================='));
    console.log(c.cyan('  🚀 INICIANDO EJECUCION AUTOMATICA DE DESVINCULACIONES EN CUENTAME...'));
    console.log(c.cyan('===================================================================='));

    const nav = await obtenerNavegador();
    const { browser, page } = nav;

    // Agrupar por asociacion
    const gruposAsoc = new Map();
    for (const t of tareasPreparadas) {
        const key = t.asociacion.nombreCorto;
        if (!gruposAsoc.has(key)) {
            gruposAsoc.set(key, { asc: t.asociacion, tareas: [] });
        }
        gruposAsoc.get(key).tareas.push(t);
    }

    for (const [ascNombre, grupo] of gruposAsoc) {
        const asc = grupo.asc;
        console.log(c.cyan(`\n▶ Procesando Asociacion en Cuentame: ${asc.nombreCorto}`));

        try {
            const mismaAsc = await validarYCambiarAsociacion(page, asc);
            if (!mismaAsc) {
                await loginYLlegarARoles(page, { usuario: USUARIO, password: PASSWORD, gmailUser: GMAIL_USER, gmailAppPassword: GMAIL_APP_PASSWORD });
                await seleccionarRolYEntrar(page, asc);
            }

            // Navegar a modulo Beneficiario
            console.log(c.cyan('  🚀 Navegando al modulo de Beneficiarios...'));
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
            } catch(e) {
                console.log(c.rojo(`  ⚠️ Error al intentar acceder a Beneficiario: ${e.message}`));
            }

            let contentFrame = page.frame({ name: 'frameContent' });
            if (!contentFrame) {
                for (const f of page.frames()) {
                    if (f.name() === 'frameContent') { contentFrame = f; break; }
                }
            }
            if (!contentFrame) throw new Error("No se pudo encontrar el frameContent.");

            // Agrupar por Jardin dentro de esta asociacion
            const gruposJardin = new Map();
            for (const t of grupo.tareas) {
                const jKey = t.jardin.nombreUds;
                if (!gruposJardin.has(jKey)) {
                    gruposJardin.set(jKey, { jardin: t.jardin, tareas: [] });
                }
                gruposJardin.get(jKey).tareas.push(t);
            }

            for (const [jNombre, jGrupo] of gruposJardin) {
                console.log(c.amarillo(`\n  🏢 Cargando Jardin en Cuentame: ${jNombre}...`));
                contentFrame = page.frame({ name: 'frameContent' }) || page.frames().find(f => f.name() === 'frameContent') || page;

                // Clic en el boton de Desvincular (-) si existe
                const btnDesvincular = contentFrame.locator('img[src*="delete.gif"], a[id*="btnDesvincular"]').first();
                if (await btnDesvincular.count() > 0 && await btnDesvincular.isVisible()) {
                    await btnDesvincular.click();
                    await page.waitForTimeout(1000);
                }

                // Helper de seleccion en dropdown con espera
                const waitForAndSelect = async (selectLocator, textToMatch = null) => {
                    if (await selectLocator.count() === 0) return null;
                    let opts = [];
                    for(let i=0; i<20; i++) {
                        const isEnabled = await selectLocator.evaluate(s => !s.disabled).catch(()=>false);
                        if (isEnabled) {
                            const raw = await selectLocator.evaluate(s => Array.from(s.options).map(o => ({ v: o.value, t: o.text }))).catch(()=>[]);
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
                            await selectLocator.selectOption(match.v).catch(()=>{});
                            await page.waitForTimeout(300);
                            return opts;
                        }
                    }
                    if (opts.length === 1) {
                        await selectLocator.selectOption(opts[0].v).catch(()=>{});
                        await page.waitForTimeout(300);
                    }
                    return opts;
                };

                let selectArea = contentFrame.locator('select[id*="AreaMisional"]').first();
                if (await selectArea.count() === 0) selectArea = contentFrame.locator('select').nth(0);
                await waitForAndSelect(selectArea, 'Primera Infancia');

                let vigenciaStr = asc.vigenciaContrato || '2026';
                let selectVigencia = contentFrame.locator('select[id*="Vigencia"]').first();
                if (await selectVigencia.count() === 0) selectVigencia = contentFrame.locator('select').nth(2);
                await waitForAndSelect(selectVigencia, vigenciaStr);

                const selectRegional = contentFrame.locator('select[id*="ddlRegional"], select[id*="Regional"]').first();
                await waitForAndSelect(selectRegional, 'Bogota D.C.');

                const selectContrato = contentFrame.locator('select[id*="ddlContrato"], select[id*="Contrato"]').first();
                await waitForAndSelect(selectContrato, asc.numeroContrato);

                // Seleccionar Servicio
                const selectServicio = contentFrame.locator('select[id*="ddlServicio"], select[id*="Servicio"]').first();
                const servOpts = await waitForAndSelect(selectServicio);

                if (servOpts && servOpts.length > 0) {
                    const jMod = (jGrupo.jardin.modalidad || '').toUpperCase();
                    const esAgrupado = jMod.includes('JARDIN') || jMod.includes('AGRUPADO');
                    
                    const servOpts2026 = servOpts.filter(o => /-2026\b/.test(o.t) || o.t.endsWith("2026"));
                    const poolServ = servOpts2026.length > 0 ? servOpts2026 : servOpts;

                    let matchServ = null;
                    if (esAgrupado) {
                        matchServ = poolServ.find(o => o.t.toUpperCase().includes("420269") || o.t.toUpperCase().includes("JARDIN COMUNITARIO"));
                    } else {
                        matchServ = poolServ.find(o => o.t.toUpperCase().includes("420267") || o.t.toUpperCase().includes("HCB"));
                    }
                    if (!matchServ) matchServ = poolServ[0];

                    await selectServicio.selectOption(matchServ.v).catch(()=>{});
                    await page.waitForTimeout(500);
                }

                // Seleccionar UDS
                const selectUds = contentFrame.locator('select[id*="ddlUDS"], select[id*="UDS"], select[id*="Unidad"]').first();
                const codigoSearch = (jGrupo.jardin.codigoUds || '').trim();
                const nombreSearch = jNombre;

                await waitForAndSelect(selectUds, codigoSearch || nombreSearch);
                await page.waitForTimeout(500);

                console.log(c.verde(`  ✅ Filtros aplicados para UDS: ${jNombre}`));

                // Dialog handler para alertas de la plataforma
                const dialogHandler = async dialog => {
                    console.log(c.magenta(`  💬 Alerta plataforma: ${dialog.message()}`));
                    await dialog.accept().catch(()=>{});
                };
                page.on('dialog', dialogHandler);

                // Procesar cada desvinculacion del lote para este Jardin
                for (const tarea of jGrupo.tareas) {
                    console.log(c.cyan(`\n    👉 Aplicando desvinculacion para: ${tarea.nino.nombreCompleto} (Doc: ${tarea.nino.documento})`));
                    
                    // 1. Ingresar Fecha de Retiro
                    const inputFecha = contentFrame.locator('input[type="text"][id*="FechaRetiro"], input[id*="txtFechaRetiro"]').first();
                    if (await inputFecha.count() > 0) {
                        await inputFecha.evaluate((el, val) => {
                            el.value = val;
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                            el.blur();
                        }, tarea.fechaRetiro);
                        await page.waitForTimeout(600);
                    }

                    // 2. Seleccionar Motivo
                    const selectMotivo = contentFrame.locator('select[id*="ddlMotivo"], select[id*="Motivo"]').first();
                    if (await selectMotivo.count() > 0) {
                        let mOpts = [];
                        for (let k = 0; k < 15; k++) {
                            const isEn = await selectMotivo.evaluate(s => !s.disabled).catch(()=>false);
                            if (isEn) {
                                mOpts = await selectMotivo.evaluate(s => Array.from(s.options).map(o => ({ v: o.value, t: o.text })));
                                if (mOpts.length > 1) break;
                            }
                            await page.waitForTimeout(300);
                        }
                        const matchM = mOpts.find(o => removeAccentsStr(o.t).includes(removeAccentsStr(tarea.motivo)));
                        if (matchM) {
                            await selectMotivo.selectOption(matchM.v).catch(()=>{});
                            await page.waitForTimeout(400);
                        }
                    }

                    // 3. Clic Consultar Beneficiarios en esta UDS
                    const btnConsultar = contentFrame.locator('input[type="submit"][value*="Consultar beneficiario"], input[id*="btnBuscar"]').first();
                    if (await btnConsultar.count() > 0 && await btnConsultar.isVisible()) {
                        await btnConsultar.click();
                        await page.waitForTimeout(1200);
                    }

                    contentFrame = page.frame({ name: 'frameContent' }) || page.frames().find(f => f.name() === 'frameContent') || page;

                    // 4. Buscar la fila en la tabla
                    const tablaNinos = contentFrame.locator('table[id*="gvBeneficiarios"] tr, table[id*="GridView"] tr');
                    const numFilas = await tablaNinos.count();
                    let marcado = false;

                    if (numFilas > 1) {
                        const targetDoc = tarea.nino.documento;
                        const targetName = removeAccentsStr(tarea.nino.nombreCompleto);

                        for (let i = 1; i < numFilas; i++) {
                            const fila = tablaNinos.nth(i);
                            const rowText = await fila.innerText();
                            const cleanText = removeAccentsStr(rowText);

                            if ((targetDoc && rowText.includes(targetDoc)) || cleanText.includes(targetName)) {
                                const chk = fila.locator('input[type="checkbox"]').first();
                                if (await chk.count() > 0) {
                                    await chk.check({ force: true }).catch(() => chk.click());
                                    console.log(c.verde(`    ✅ Fila encontrada y marcada en la tabla para ${tarea.nino.nombreCompleto}`));
                                    marcado = true;
                                    break;
                                }
                            }
                        }
                    }

                    if (!marcado) {
                        console.log(c.rojo(`    ❌ No se encontro la fila en la tabla de Cuentame para ${tarea.nino.nombreCompleto}.`));
                        continue;
                    }

                    // 5. Clic Guardar
                    console.log(c.amarillo('    💾 Guardando desvinculacion en Cuentame...'));
                    const btnGuardar = contentFrame.locator('a[id*="btnGuardar"], input[id*="btnGuardar"], img[alt="Guardar"]').first();
                    if (await btnGuardar.count() > 0 && await btnGuardar.isVisible()) {
                        await btnGuardar.click();
                        await page.waitForTimeout(3000);

                        const lblMensaje = contentFrame.locator('span[id*="lblMensaje"], span[id*="Mensaje"]').first();
                        if (await lblMensaje.count() > 0) {
                            const txt = await lblMensaje.innerText();
                            if (txt.trim()) console.log(c.cyan(`    📌 Respuesta Cuentame: ${txt.trim()}`));
                        }
                        console.log(c.verde(`    ✅ Desvinculacion exitosa: ${tarea.nino.nombreCompleto}`));
                    }
                }

                page.off('dialog', dialogHandler);
            }
        } catch (err) {
            console.error(c.rojo(`  ❌ Error en ejecucion de desvinculaciones para ${ascNombre}: ${err.message}`));
        }
    }

    console.log(c.verde('\n  🎉 LOTE DE DESVINCULACIONES PROCESADO CON EXITO EN CUENTAME.\n'));
}

if (require.main === module) {
    main().catch(err => console.error('Error no capturado:', err));
}

module.exports = { main };
