/**
 * llenar-asistencia.js
 * Script para automatizar el llenado masivo de RAM y el desmarcado de inasistencias interactivamente.
 * FASE 1: Llenado masivo de asociaciones.
 * FASE 2: Subida individual y específica.
 */

require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const readline = require('readline-sync');
const { loginYLlegarARoles, seleccionarRolYEntrar } = require('../servicios/autenticacion');
const { leerJardines } = require('../servicios/excel-reader');

const c = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
  rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
  gris:     (t) => `\x1b[90m${t}\x1b[0m`,
  negrita:  (t) => `\x1b[1m${t}\x1b[0m`,
};

// Mapa de servicios para optimizar la búsqueda. 
// Solo buscamos servicios de 2026.
const SERVICIOS_2026 = ["2026"];

function filtrarServiciosPorAsociacion(servOptions, ascNombre, udsWebText) {
    // Primero, siempre descartamos lo que NO sea 2026
    let options = servOptions.filter(o => o.text.includes("2026"));
    
    ascNombre = ascNombre.toUpperCase();
    udsWebText = udsWebText ? udsWebText.toUpperCase() : "";

    // Reglas específicas según el usuario:
    if (ascNombre.includes("DELICIAS DEL CARMEN")) {
        options = options.filter(o => o.text.includes("JARDÍN COMUNITARIO"));
    } else if (ascNombre.includes("BARRIOS UNIDOS") || 
               ascNombre.includes("PROGRESO INFANTIL") || 
               ascNombre.includes("BRISAS DE BUENAVISTA")) {
        options = options.filter(o => o.text.includes("HCB") && !o.text.includes("JARDÍN COMUNITARIO"));
    }
    // Para VERBENAL, CANAIMA y PROGRAMA BUENAVISTA, depende del nombre del jardín (udsWebText).
    // Pero en el momento de filtrar servicios, aún no hemos elegido el jardín (a menos que estemos en Fase 2 donde ya sabemos cuál queremos).
    // En Fase 1 (búsqueda ciega), dejaremos ambas opciones de 2026 (HCB y JARDÍN) para las asociaciones mixtas.
    return options;
}

async function main() {
  const USUARIO = process.env.CUENTAME_USUARIO;
  const PASSWORD = process.env.CUENTAME_PASSWORD;
  
  if (!USUARIO || !PASSWORD) {
    console.error(c.rojo('\n❌ Faltan CUENTAME_USUARIO o CUENTAME_PASSWORD en el archivo .env\n'));
    process.exit(1);
  }

  const RUTA_EXCEL = process.env.RUTA_EXCEL || 'C:\\GENERAL_BOTS.xlsx';
  const { porAsociacion } = leerJardines(RUTA_EXCEL);
  let asociaciones = Object.values(porAsociacion).filter(a => a.numeroContrato);

  if (asociaciones.length === 0) {
    console.error(c.rojo("  ⚠️ No hay asociaciones válidas con contrato en el Excel."));
    process.exit(1);
  }

  console.log(c.cyan('\n  ======================================================'));
  console.log(c.cyan('  🤖 BOT DE ASISTENCIA CUÉNTAME - V3'));
  console.log(c.cyan('  ======================================================'));
  
  const fases = [
    '(FASE 1) - Subida de asistencia General (Masiva)', 
    '(FASE 2) - Subida de asistencia Individual (Inasistencias / Días sueltos)'
  ];
  const faseIndex = readline.keyInSelect(fases, c.negrita('  > ESCOGER LA FASE A EJECUTAR: '), { cancel: false });
  
  const todosLosMeses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const fechaActual = new Date();
  const mesActualIdx = fechaActual.getMonth();
  const mesAnteriorIdx = mesActualIdx === 0 ? 11 : mesActualIdx - 1;
  const mesesOpciones = [todosLosMeses[mesAnteriorIdx], todosLosMeses[mesActualIdx]];
  
  const mesIndex = readline.keyInSelect(mesesOpciones, c.negrita('  > Selecciona el mes a diligenciar: '), { cancel: false });
  const mesAtencion = mesesOpciones[mesIndex];

  if (faseIndex === 0) {
      await ejecutarFase1(asociaciones, mesAtencion);
  } else {
      await ejecutarFase2(asociaciones, mesAtencion);
  }
}

async function iniciarNavegador() {
    const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
    const context = await browser.newContext({ viewport: null });
    const mainPage = await context.newPage();
    return { browser, context, mainPage };
}

// ==========================================
// FASE 1: LLENADO MASIVO
// ==========================================
async function ejecutarFase1(asociaciones, mesAtencion) {
    console.log(c.cyan('\n  📋 [FASE 1] SELECCIONA LA ASOCIACIÓN PARA SUBIDA GENERAL:'));
    console.log(c.amarillo(`  0. 🌟 TODAS LAS ASOCIACIONES`));
    asociaciones.forEach((asc, idx) => {
        console.log(`  ${idx + 1}. ${asc.nombreCorto} (Contrato: ${asc.numeroContrato})`);
    });
    
    let ascAProcesar = [];
    while (ascAProcesar.length === 0) {
        console.log(c.gris('  (Puedes ingresar varios números separados por coma, ej: 1,3,4)'));
        const respuesta = readline.question(c.negrita('\n  > Ingresa el numero de la(s) opcion(es): '));
        
        if (respuesta.trim() === '') process.exit(0);

        const partes = respuesta.split(',').map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n));
        if (partes.length === 0) continue;

        if (partes.includes(0)) {
            ascAProcesar = asociaciones;
            break;
        }

        const invalidos = partes.filter(n => n < 1 || n > asociaciones.length);
        if (invalidos.length > 0) {
            console.log(c.rojo(`  ⚠️ Opciones inválidas: ${invalidos.join(', ')}`));
            continue;
        }
        ascAProcesar = partes.map(n => asociaciones[n - 1]);
    }

    // Configurar días a ignorar (Capacitaciones, etc)
    let diasIgnorarStr = readline.question(c.negrita('\n  > Dias a ignorar en todo el mes (separados por coma, ej: 20,25) o ENTER para ninguno: '));
    const diasIgnorar = diasIgnorarStr.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));

    console.log(c.verde(`\n  ✅ Iniciando Fase 1: ${ascAProcesar.length} Asociacion(es) | Ignorando días: [${diasIgnorar.join(',') || 'Ninguno'}]`));

    const { browser, context, mainPage } = await iniciarNavegador();
    let authCookies = null;

    let rolesHtml = null;
    let rolesUrl = null;

    for (let i = 0; i < ascAProcesar.length; i++) {
        const asc = ascAProcesar[i];
        console.log(c.cyan(`\n======================================================`));
        console.log(c.cyan(`▶ Procesando Asociación [${i+1}/${ascAProcesar.length}]: ${asc.nombreCorto}`));
        console.log(c.cyan(`======================================================`));

        if (i === 0) {
            console.log(c.cyan('\n======================================================'));
            console.log(c.cyan('▶ Iniciando sesión única y 2FA...'));
            console.log(c.cyan('======================================================\n'));
            await loginYLlegarARoles(mainPage, { 
                usuario: process.env.CUENTAME_USUARIO, 
                password: process.env.CUENTAME_PASSWORD,
                gmailUser: process.env.GMAIL_USER,
                gmailAppPassword: process.env.GMAIL_APP_PASSWORD
            });
            authCookies = await context.cookies();
        } else {
            console.log(c.gris(`\n    🔄 Volviendo a la selección de roles con la sesión actual (sin 2FA)...`));
            try {
                // Simplemente navegamos a Roles.aspx usando la misma sesión activa
                await mainPage.goto('https://rubonline.icbf.gov.co/Autenticacion/Roles.aspx', { waitUntil: 'networkidle' });
            } catch (err) {
                console.error(c.rojo(`  ❌ Error al volver a la página de roles: ${err.message}`));
            }
        }

        try {
            console.log('  🏢 Seleccionando entidad (asociación)...');
            await seleccionarRolYEntrar(mainPage, asc);
            console.log(c.verde('  ✅ Login exitoso en Cuéntame.'));
            
            console.log('  🚀 Navegando a Unidad -> Registro de asistencia mensual - ram...');
            await mainPage.goto('https://rubonline.icbf.gov.co/Page/RUBONLINE/RegistroAsistencia/List.aspx', { waitUntil: 'networkidle', timeout: 60000 });
            await mainPage.waitForTimeout(3000);

            let contentFrame = mainPage.frame({ name: 'frameContent' }) || mainPage.frames().find(f => f.name() === 'frameContent') || mainPage;
            if (!contentFrame) throw new Error('No se encontró el frameContent.');

            console.log('  📝 Llenando filtros del RAM...');
            const selectDropdown = async (keyword, textOrIndex) => {
                try {
                    const sel = contentFrame.locator(`select[id*="${keyword}"]`).first();
                    if (await sel.count() === 0) return;
                    
                    const isEnabled = await sel.evaluate(s => !s.disabled);
                    if (!isEnabled) return; // Skip if disabled

                    if (typeof textOrIndex === 'string') {
                        // Seleccionar por texto parcial
                        const value = await sel.evaluate((s, t) => {
                            const opt = Array.from(s.options).find(o => o.text.toUpperCase().includes(t.toUpperCase()));
                            return opt ? opt.value : null;
                        }, textOrIndex);
                        if (value) {
                            await sel.selectOption(value, { timeout: 5000 });
                            await mainPage.waitForTimeout(2000);
                        }
                    } else if (typeof textOrIndex === 'number') {
                        // Seleccionar por índice válido (>0)
                        const valSrv = await sel.evaluate(s => {
                            const opt = Array.from(s.options).find(o => o.value && o.value !== "0" && o.value !== "");
                            return opt ? opt.value : null;
                        });
                        if (valSrv) {
                            await sel.selectOption(valSrv, { timeout: 5000 });
                            await mainPage.waitForTimeout(2000);
                        }
                    }
                } catch (e) {
                    console.log(c.gris(`    (No se pudo seleccionar en ${keyword}: ${e.message})`));
                }
            };
            
            await selectDropdown('Direcciones', 'Primera Infancia');
            await selectDropdown('Regional', 'Bogota');
            await selectDropdown('Centro', 'USAQUEN'); // A veces se requiere
            await selectDropdown('Vigencia', asc.vigenciaContrato || '2024');
            await selectDropdown('Contrato', asc.numeroContrato);
            await selectDropdown('Mes', mesAtencion);
            await selectDropdown('Estado', 'Todos');

            const servicioLocator = contentFrame.locator(`select[id*="Servicio"]`).first();
            let serviciosOptions = [];
            if (await servicioLocator.count() > 0) {
                serviciosOptions = await servicioLocator.evaluate(s => {
                    return Array.from(s.options)
                        .filter(o => o.value && o.value !== "0" && o.value !== "-1" && o.value !== "" && !o.text.toUpperCase().includes("SELECCIONE"))
                        .map(o => ({ value: o.value, text: o.text }));
                });
            }

            // Filtrar servicios de 2026 y por reglas de asociación
            let serviciosFiltrados = filtrarServiciosPorAsociacion(serviciosOptions, asc.nombreCorto);
            console.log(c.cyan(`  Encontrados ${serviciosFiltrados.length} servicios válidos (2026).`));

            for (let sIdx = 0; sIdx < serviciosFiltrados.length; sIdx++) {
                const serv = serviciosFiltrados[sIdx];
                console.log(c.amarillo(`\n  >> Probando Servicio [${sIdx+1}/${serviciosFiltrados.length}]: ${serv.text}`));
                
                await servicioLocator.selectOption(serv.value, { timeout: 5000 });
                await mainPage.waitForTimeout(2000); 

                const udsLocator = contentFrame.locator(`select[id*="Uds"], select[id*="UDS"], select[id*="Unidad"]`).first();
                let udsOptions = [];
                if (await udsLocator.count() > 0) {
                    udsOptions = await udsLocator.evaluate(s => {
                        return Array.from(s.options)
                            .filter(o => o.value && o.value !== "0" && o.value !== "-1" && o.value !== "" && !o.text.toUpperCase().includes("SELECCIONE"))
                            .map(o => ({ value: o.value, text: o.text }));
                    });
                }

                // Filtrar UDS por el Excel
                let udsOptionsFiltradas = udsOptions;
                if (asc.jardinesAProcesar && asc.jardinesAProcesar.length > 0) {
                    udsOptionsFiltradas = udsOptions.filter(webUds => {
                        return asc.jardinesAProcesar.some(jExcel => {
                            const nombreWeb = webUds.text.toUpperCase();
                            return nombreWeb.includes(jExcel.codigo) || nombreWeb.includes(jExcel.nombre.toUpperCase());
                        });
                    });
                }
                
                if (udsOptionsFiltradas.length === 0) continue;
                console.log(c.cyan(`  Encontradas ${udsOptionsFiltradas.length} UDS a procesar en este servicio.`));

                for (let u = 0; u < udsOptionsFiltradas.length; u++) {
                    const uds = udsOptionsFiltradas[u];
                    console.log(c.amarillo(`\n    ▶ Procesando UDS [${u+1}/${udsOptionsFiltradas.length}]: ${uds.text}`));
                    
                    await udsLocator.selectOption(uds.value);
                    await mainPage.waitForTimeout(2000);

                    console.log('    👉 Buscando (clic en la lupa)...');
                    const lupa = contentFrame.locator('a#btnBuscar, a#btnConsultar, input[type="image"][id*="btnConsultar" i], input[type="image"][id*="btnBuscar" i], img[title*="Consultar" i], img[title*="Buscar" i], img[alt*="Consultar" i], img[alt*="Buscar" i]').first();
                    if (await lupa.count() > 0 && await lupa.isVisible()) {
                         await lupa.click();
                    } else {
                         const genericBtn = contentFrame.locator('a:has(img[src*="list.png"]):visible, input[type="image"]:visible, img[src*="lupa"]:visible').first(); 
                         if (await genericBtn.count() > 0) await genericBtn.click();
                    }
                    await mainPage.waitForTimeout(4000);

                    console.log('    👉 Habilitando edición (clic en el lápiz)...');
                    const lapiz = contentFrame.locator('a#btnEditar, a#btnModificar, input[type="image"][id*="btnEditar" i], input[type="image"][id*="btnModificar" i], img[title*="Editar" i], img[title*="Modificar" i], img[alt*="Editar" i], img[alt*="Modificar" i]').first();
                    if (await lapiz.count() > 0 && await lapiz.isVisible()) {
                        await lapiz.click();
                        await mainPage.waitForTimeout(3000);
                    } else {
                        const genericEdit = contentFrame.locator('a:has(img[src*="edit.png"]):visible, input[type="image"]:visible, img[src*="edit"]:visible, img[src*="lapiz"]:visible').first();
                        if (await genericEdit.count() > 0) {
                            await genericEdit.click();
                            await mainPage.waitForTimeout(3000);
                        }
                    }

                    console.log('    ✅ Marcando asistencia (Todo el mes excepto ignorados)...');
                    const rows = await contentFrame.locator('table[id*="grdConsulta"] tbody tr, table[id*="gvLista"] tbody tr, table[id*="GridView"] tbody tr, table.mGrid tbody tr, table.rgMasterTable tbody tr, table[id*="Grid"] tbody tr').all();
                    
                    let ninosActivos = 0;
                    let checksMarcados = 0;

                    for (const row of rows) {
                        const text = await row.innerText();
                        if (text.includes('Activo')) {
                            ninosActivos++;
                            const cells = await row.locator(':scope > td').all();
                            for (let cIdx = 3; cIdx < cells.length; cIdx++) {
                                const dayNumber = cIdx - 2; 
                                if (!diasIgnorar.includes(dayNumber)) {
                                    const chk = cells[cIdx].locator('input[type="checkbox"]');
                                    if (await chk.count() > 0) {
                                        const isEnabled = await chk.isEnabled();
                                        const isChecked = await chk.isChecked();
                                        if (isEnabled && !isChecked) {
                                            await chk.check();
                                            checksMarcados++;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    console.log(c.verde(`    ✔️ Se procesaron ${ninosActivos} niños activos y se marcaron ${checksMarcados} asistencias.`));

                    console.log('    💾 Guardando asistencia...');
                    const disco = contentFrame.locator('a#btnGuardar, input[type="image"][id*="btnGuardar" i], img[title*="Guardar" i], img[alt*="Guardar" i]').first();
                    if (await disco.count() > 0 && await disco.isVisible()) {
                        await disco.click();
                    } else {
                         const genericSave = contentFrame.locator('a:has(img[src*="save.png"]):visible, input[type="image"]:visible, img[src*="save"]:visible, img[src*="guardar"]:visible').last();
                         if (await genericSave.count() > 0) await genericSave.click();
                    }
                    await mainPage.waitForTimeout(5000); 
                    console.log(c.verde('    ✅ Guardado exitoso.'));

                    console.log(c.gris('    🔄 Recargando página para desbloquear filtros (equivalente a Volver)...'));
                    await mainPage.goto('https://rubonline.icbf.gov.co/Page/RUBONLINE/RegistroAsistencia/List.aspx', { waitUntil: 'domcontentloaded' });
                    await mainPage.waitForTimeout(2000);
                    contentFrame = mainPage.frame({ name: 'frameContent' }) || mainPage.frames().find(f => f.name() === 'frameContent') || mainPage;
                    
                    // Volver a llenar los filtros para la siguiente UDS
                    await selectDropdown('Direcciones', 'Primera Infancia');
                    await selectDropdown('Regional', 'Bogota');
                    await selectDropdown('Centro', 'USAQUEN');
                    await selectDropdown('Vigencia', asc.vigenciaContrato || '2024');
                    await selectDropdown('Contrato', asc.numeroContrato);
                    await selectDropdown('Mes', mesAtencion);
                    await selectDropdown('Estado', 'Todos');
                    
                    const servicioLocator2 = contentFrame.locator(`select[id*="Servicio"]`).first();
                    if (await servicioLocator2.count() > 0) {
                        await servicioLocator2.selectOption(serv.value, { timeout: 5000 });
                        await mainPage.waitForTimeout(2000);
                    }

                } // fin loop UDS
            } // fin loop SERVICIOS
        } catch (err) {
            console.error(c.rojo(`  ❌ Ocurrió un error con ${asc.nombreCorto}: ${err && err.message ? err.message : err}`));
            console.error(err); 
        }
    }
    console.log(c.verde('\n  🎉 FASE 1 COMPLETADA CON ÉXITO. Cerrando navegador...'));
    await browser.close();
}

// ==========================================
// FASE 2: LLENADO INDIVIDUAL / INASISTENCIAS
// ==========================================
async function ejecutarFase2(asociaciones, mesAtencion) {
    console.log(c.cyan('\n  📋 [FASE 2] SELECCIONA *UNA SOLA* ASOCIACIÓN:'));
    const opcionesAsc = asociaciones.map(a => `${a.nombreCorto} (Contrato: ${a.numeroContrato})`);
    const ascIdx = readline.keyInSelect(opcionesAsc, c.negrita('  > Escoja la asociación: '), { cancel: 'Salir' });
    if (ascIdx === -1) process.exit(0);

    const asc = asociaciones[ascIdx];
    console.log(c.verde(`\n  ✅ Iniciando Fase 2 en la asociación: ${asc.nombreCorto}`));

    const { browser, context, mainPage } = await iniciarNavegador();

    console.log(c.cyan('\n======================================================'));
    console.log(c.cyan('▶ Iniciando sesión única y 2FA...'));
    console.log(c.cyan('======================================================\n'));
    await loginYLlegarARoles(mainPage, { 
        usuario: process.env.CUENTAME_USUARIO, 
        password: process.env.CUENTAME_PASSWORD,
        gmailUser: process.env.GMAIL_USER,
        gmailAppPassword: process.env.GMAIL_APP_PASSWORD
    });

    try {
        console.log('  🏢 Seleccionando entidad (asociación)...');
        await seleccionarRolYEntrar(mainPage, asc);
        console.log(c.verde('  ✅ Login exitoso en Cuéntame.'));
        
        console.log('  🚀 Navegando a Unidad -> Registro de asistencia mensual - ram...');
        await mainPage.goto('https://rubonline.icbf.gov.co/Page/RUBONLINE/RegistroAsistencia/List.aspx', { waitUntil: 'networkidle', timeout: 60000 });
        await mainPage.waitForTimeout(3000);

        let contentFrame = mainPage.frame({ name: 'frameContent' }) || mainPage.frames().find(f => f.name() === 'frameContent') || mainPage;

        console.log('  📝 Llenando filtros del RAM...');
        const selectDropdown = async (keyword, textOrIndex) => {
            try {
                const sel = contentFrame.locator(`select[id*="${keyword}"]`).first();
                if (await sel.count() === 0) return;
                
                const isEnabled = await sel.evaluate(s => !s.disabled);
                if (!isEnabled) return; // Skip if disabled

                if (typeof textOrIndex === 'string') {
                    // Seleccionar por texto parcial
                    const value = await sel.evaluate((s, t) => {
                        const opt = Array.from(s.options).find(o => o.text.toUpperCase().includes(t.toUpperCase()));
                        return opt ? opt.value : null;
                    }, textOrIndex);
                    if (value) {
                        await sel.selectOption(value, { timeout: 5000 });
                        await mainPage.waitForTimeout(2000);
                    }
                } else if (typeof textOrIndex === 'number') {
                    // Seleccionar por índice válido (>0)
                    const valSrv = await sel.evaluate(s => {
                        const opt = Array.from(s.options).find(o => o.value && o.value !== "0" && o.value !== "");
                        return opt ? opt.value : null;
                    });
                    if (valSrv) {
                        await sel.selectOption(valSrv, { timeout: 5000 });
                        await mainPage.waitForTimeout(2000);
                    }
                }
            } catch (e) {
                console.log(c.gris(`    (No se pudo seleccionar en ${keyword}: ${e.message})`));
            }
        };
        
        await selectDropdown('Direcciones', 'Primera Infancia');
        await selectDropdown('Regional', 'Bogota');
        await selectDropdown('Centro', 'USAQUEN'); // A veces se requiere
        await selectDropdown('Vigencia', asc.vigenciaContrato || '2024');
        await selectDropdown('Contrato', asc.numeroContrato);
        await selectDropdown('Mes', mesAtencion);
        await selectDropdown('Estado', 'Todos');

        const servicioLocator = contentFrame.locator(`select[id*="Servicio"]`).first();
        let serviciosOptions = [];
        if (await servicioLocator.count() > 0) {
            serviciosOptions = await servicioLocator.evaluate(s => {
                return Array.from(s.options)
                    .filter(o => o.value && o.value !== "0" && o.value !== "-1" && o.value !== "" && !o.text.toUpperCase().includes("SELECCIONE"))
                    .map(o => ({ value: o.value, text: o.text }));
            });
        }

        let serviciosFiltrados = filtrarServiciosPorAsociacion(serviciosOptions, asc.nombreCorto);
        console.log(c.cyan(`  Escaneando ${serviciosFiltrados.length} servicios válidos para encontrar todos los jardines...`));

        let todasLasUdsMap = [];
        
        for (const serv of serviciosFiltrados) {
            await servicioLocator.selectOption(serv.value, { timeout: 5000 });
            await mainPage.waitForTimeout(2000); 

            const udsLocator = contentFrame.locator(`select[id*="Uds"], select[id*="UDS"], select[id*="Unidad"]`).first();
            if (await udsLocator.count() > 0) {
                const udsOpts = await udsLocator.evaluate(s => {
                    return Array.from(s.options)
                        .filter(o => o.value && o.value !== "0" && o.value !== "-1" && o.value !== "" && !o.text.toUpperCase().includes("SELECCIONE"))
                        .map(o => ({ value: o.value, text: o.text }));
                });
                
                // Filtrar según el excel si es necesario, o mantenerlas todas
                let udsAIncluir = udsOpts;
                if (asc.jardinesAProcesar && asc.jardinesAProcesar.length > 0) {
                    udsAIncluir = udsOpts.filter(webUds => {
                        return asc.jardinesAProcesar.some(jExcel => {
                            const nombreWeb = webUds.text.toUpperCase();
                            return nombreWeb.includes(jExcel.codigo) || nombreWeb.includes(jExcel.nombre.toUpperCase());
                        });
                    });
                }
                
                for (const uds of udsAIncluir) {
                    todasLasUdsMap.push({ servicio: serv, uds: uds });
                }
            }
        }

        if (todasLasUdsMap.length === 0) {
            console.log(c.rojo('  ❌ No se encontró ningún jardín en los servicios de 2026.'));
            process.exit(1);
        }

        // BUCLE INFINITO DE FASE 2 HASTA QUE CANCELE
        while (true) {
            console.log(c.cyan(`\n  --- FASE 2: ${asc.nombreCorto} ---`));
            const udsOptsNombres = todasLasUdsMap.map(u => u.uds.text);
            const udsIdx = readline.keyInSelect(udsOptsNombres, c.negrita('  > ESCOJA EL JARDÍN A TRABAJAR: '), { cancel: 'Salir de Fase 2' });
            
            if (udsIdx === -1) break;

            const elegida = todasLasUdsMap[udsIdx];
            console.log(c.amarillo(`\n    Navegando a ${elegida.uds.text}...`));
            
            contentFrame = mainPage.frame({ name: 'frameContent' }) || mainPage.frames().find(f => f.name() === 'frameContent') || mainPage;
            
            const servLoc = contentFrame.locator(`select[id*="Servicio"]`).first();
            await servLoc.selectOption(elegida.servicio.value);
            await mainPage.waitForTimeout(2000);

            const uLoc = contentFrame.locator(`select[id*="Uds"], select[id*="UDS"], select[id*="Unidad"]`).first();
            await uLoc.selectOption(elegida.uds.value);
            await mainPage.waitForTimeout(2000);

            const lupa = contentFrame.locator('a#btnBuscar, a#btnConsultar, input[type="image"][id*="btnConsultar" i], input[type="image"][id*="btnBuscar" i], img[title*="Consultar" i], img[title*="Buscar" i], img[alt*="Consultar" i], img[alt*="Buscar" i]').first();
            if (await lupa.count() > 0 && await lupa.isVisible()) await lupa.click();
            else {
                 const genericBtn = contentFrame.locator('a:has(img[src*="list.png"]):visible, input[type="image"]:visible, img[src*="lupa"]:visible').first(); 
                 if (await genericBtn.count() > 0) await genericBtn.click();
            }
            await mainPage.waitForTimeout(4000);

            const tareas = [
                'Registrar INASISTENCIAS (ej. desmarcar falla a un niño)',
                'Rellenar 1 DÍA de asistencia (ej. marcar a todos solo el día 29)'
            ];
            const tareaIdx = readline.keyInSelect(tareas, c.negrita('  > ¿Qué desea hacer en este Jardín?: '), { cancel: 'Cambiar de Jardín' });

            if (tareaIdx === -1) {
                continue; // Vuelve a preguntar el Jardín
            }

            if (tareaIdx === 0) {
                // Registrar inasistencias interactivamente
                await registrarInasistenciasIndividual(mainPage, contentFrame);
            } else if (tareaIdx === 1) {
                // Rellenar un solo día
                await rellenarUnDia(mainPage, contentFrame, elegida);
            }
        } // Fin while true (Menú jardines)

    } catch (err) {
        console.error(c.rojo(`  ❌ Ocurrió un error: ${err && err.message ? err.message : err}`));
        console.error(err); 
    }
    
    console.log(c.verde('\n  🎉 FASE 2 COMPLETADA CON ÉXITO. Cerrando navegador...'));
    await browser.close();
}

async function registrarInasistenciasIndividual(mainPage, contentFrame) {
    while (true) {
        console.log(c.cyan('\n    Leyendo lista de niños...'));
        contentFrame = mainPage.frame({ name: 'frameContent' }) || mainPage.frames().find(f => f.name() === 'frameContent') || mainPage;

        const filasNuevas = await contentFrame.locator('table[id*="grdConsulta"] tbody tr, table[id*="gvLista"] tbody tr, table[id*="GridView"] tbody tr, table.mGrid tbody tr, table.rgMasterTable tbody tr, table[id*="Grid"] tbody tr').all();
        
        const listaNinos = [];
        for (let j = 0; j < filasNuevas.length; j++) {
            const rowText = await filasNuevas[j].innerText();
            const nombre = rowText.split('\t')[0].trim(); 
            if (nombre && rowText.includes('Activo')) {
                listaNinos.push({ idxOriginal: j, nombre: nombre, row: filasNuevas[j] });
            }
        }

        if (listaNinos.length === 0) {
            console.log(c.rojo('    ⚠️ No se encontraron niños activos en la tabla.'));
            break; 
        }

        console.log(c.cyan('\n    --- Lista de Niños Activos ---'));
        listaNinos.forEach(n => console.log(`      - ${n.nombre}`));

        const inputFallas = readline.question(c.negrita('\n    > Ingrese nombre o apellido y los días de falla (ej: "Perez 15,18").\n    > (Deje vacío para CAMBIAR DE JARDÍN): '));
        if (!inputFallas.trim()) break;

        const match = inputFallas.match(/^([^\d]+)([\d\s,]+)$/);
        if (!match) {
             console.log(c.rojo('    ⚠️ Formato inválido. Use algo como "Perez 15, 18"'));
             continue;
        }
        
        const nombreBuscado = match[1].trim().toUpperCase();
        const diasFaltaStr = match[2];
        const diasFalta = diasFaltaStr.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));

        const ninosEncontrados = listaNinos.filter(n => n.nombre.toUpperCase().includes(nombreBuscado));
        if (ninosEncontrados.length === 0) {
            console.log(c.rojo(`    ⚠️ No se encontró ningún niño con "${nombreBuscado}"`));
            continue;
        }
        if (ninosEncontrados.length > 1) {
            console.log(c.amarillo(`    ⚠️ Se encontraron varios niños que coinciden con "${nombreBuscado}":`));
            ninosEncontrados.forEach(n => console.log(`      - ${n.nombre}`));
            console.log(c.amarillo(`    Por favor sea más específico.`));
            continue;
        }

        const nino = ninosEncontrados[0];
        if (diasFalta.length > 0) {
            const lapizNuevo = contentFrame.locator('a#btnEditar, a#btnModificar, input[type="image"][id*="btnEditar" i], input[type="image"][id*="btnModificar" i], img[title*="Editar" i], img[title*="Modificar" i], img[alt*="Editar" i], img[alt*="Modificar" i]').first();
            if (await lapizNuevo.count() > 0 && await lapizNuevo.isVisible()) {
                await lapizNuevo.click();
                await mainPage.waitForTimeout(3000);
                contentFrame = mainPage.frame({ name: 'frameContent' }) || mainPage.frames().find(f => f.name() === 'frameContent') || mainPage;
                const rowsNuevas = await contentFrame.locator('table[id*="grdConsulta"] tbody tr, table[id*="gvLista"] tbody tr, table[id*="GridView"] tbody tr, table.mGrid tbody tr, table.rgMasterTable tbody tr, table[id*="Grid"] tbody tr').all();
                if (nino.idxOriginal < rowsNuevas.length) {
                    nino.row = rowsNuevas[nino.idxOriginal];
                }
            }

            let desmarcados = 0;
            const celdasFalla = await nino.row.locator(':scope > td').all();
            
            for (const dia of diasFalta) {
                const colIndex = dia + 2; 
                if (colIndex < celdasFalla.length) {
                    const chk = celdasFalla[colIndex].locator('input[type="checkbox"]');
                    if (await chk.count() > 0) {
                        const isEnabled = await chk.isEnabled();
                        const isChecked = await chk.isChecked();
                        if (isEnabled && isChecked) {
                            await chk.uncheck();
                            desmarcados++;
                        }
                    }
                }
            }
            console.log(c.verde(`    ✔️ Se desmarcaron ${desmarcados} días para ${nino.nombre}.`));

            const discoNuevo = contentFrame.locator('a#btnGuardar, input[type="image"][id*="btnGuardar" i], img[title*="Guardar" i], img[alt*="Guardar" i]').first();
            if (await discoNuevo.count() > 0 && await discoNuevo.isVisible()) {
                await discoNuevo.click();
            } else {
                 const genericSave2 = contentFrame.locator('a:has(img[src*="save.png"]):visible, input[type="image"]:visible, img[src*="save"]:visible, img[src*="guardar"]:visible').last();
                 if (await genericSave2.count() > 0) await genericSave2.click();
            }
            await mainPage.waitForTimeout(4000);
            console.log(c.verde('    ✅ Inasistencia guardada.'));

            console.log(c.gris('    🔄 Recargando página para desbloquear filtros (equivalente a Volver)...'));
            await mainPage.goto('https://rubonline.icbf.gov.co/Page/RUBONLINE/RegistroAsistencia/List.aspx', { waitUntil: 'domcontentloaded' });
            await mainPage.waitForTimeout(2000);
            contentFrame = mainPage.frame({ name: 'frameContent' }) || mainPage.frames().find(f => f.name() === 'frameContent') || mainPage;
            
            // Volver a llenar los filtros
            await selectDropdown('Direcciones', 'Primera Infancia');
            await selectDropdown('Regional', 'Bogota');
            await selectDropdown('Centro', 'USAQUEN');
            await selectDropdown('Vigencia', asc.vigenciaContrato || '2024');
            await selectDropdown('Contrato', asc.numeroContrato);
            await selectDropdown('Mes', mesAtencion);
            await selectDropdown('Estado', 'Todos');
            
            const servicioLocator2 = contentFrame.locator(`select[id*="Servicio"]`).first();
            if (await servicioLocator2.count() > 0) {
                await servicioLocator2.selectOption(elegida.servicio.value, { timeout: 5000 });
                await mainPage.waitForTimeout(2000);
            }
        }
    }
}

async function rellenarUnDia(mainPage, contentFrame, elegida) {
    const diaALlenar = readline.questionInt(c.negrita('\n    > Ingrese el número del DÍA que desea llenar (ej. 29): '));
    if (!diaALlenar || isNaN(diaALlenar)) return;

    console.log('    👉 Habilitando edición (clic en el lápiz)...');
    const lapiz = contentFrame.locator('a#btnEditar, a#btnModificar, input[type="image"][id*="btnEditar" i], input[type="image"][id*="btnModificar" i], img[title*="Editar" i], img[title*="Modificar" i], img[alt*="Editar" i], img[alt*="Modificar" i]').first();
    if (await lapiz.count() > 0 && await lapiz.isVisible()) {
        await lapiz.click();
        await mainPage.waitForTimeout(3000);
    } else {
        const genericEdit = contentFrame.locator('a:has(img[src*="edit.png"]):visible, input[type="image"]:visible, img[src*="edit"]:visible, img[src*="lapiz"]:visible').first();
        if (await genericEdit.count() > 0) {
            await genericEdit.click();
            await mainPage.waitForTimeout(3000);
        }
    }

    contentFrame = mainPage.frame({ name: 'frameContent' }) || mainPage.frames().find(f => f.name() === 'frameContent') || mainPage;
    console.log(`    ✅ Marcando asistencia solo para el día ${diaALlenar}...`);
    const rows = await contentFrame.locator('table[id*="grdConsulta"] tbody tr, table[id*="gvLista"] tbody tr, table[id*="GridView"] tbody tr, table.mGrid tbody tr, table.rgMasterTable tbody tr, table[id*="Grid"] tbody tr').all();
    
    let ninosActivos = 0;
    let checksMarcados = 0;

    for (const row of rows) {
        const text = await row.innerText();
        if (text.includes('Activo')) {
            ninosActivos++;
            const cells = await row.locator(':scope > td').all();
            const colIndex = diaALlenar + 2;
            if (colIndex < cells.length) {
                const chk = cells[colIndex].locator('input[type="checkbox"]');
                if (await chk.count() > 0) {
                    const isEnabled = await chk.isEnabled();
                    const isChecked = await chk.isChecked();
                    if (isEnabled && !isChecked) {
                        await chk.check();
                        checksMarcados++;
                    }
                }
            }
        }
    }

    console.log(c.verde(`    ✔️ Se marcaron ${checksMarcados} asistencias para el día ${diaALlenar}.`));

    console.log('    💾 Guardando asistencia...');
    const disco = contentFrame.locator('a#btnGuardar, input[type="image"][id*="btnGuardar" i], img[title*="Guardar" i], img[alt*="Guardar" i]').first();
    if (await disco.count() > 0 && await disco.isVisible()) {
        await disco.click();
    } else {
         const genericSave = contentFrame.locator('a:has(img[src*="save.png"]):visible, input[type="image"]:visible, img[src*="save"]:visible, img[src*="guardar"]:visible').last();
         if (await genericSave.count() > 0) await genericSave.click();
    }
    await mainPage.waitForTimeout(5000); 
    console.log(c.verde('    ✅ Guardado exitoso.'));

    contentFrame = mainPage.frame({ name: 'frameContent' }) || mainPage.frames().find(f => f.name() === 'frameContent') || mainPage;
    console.log(c.gris('    🔄 Dando clic en la lupa para desbloquear...'));
    const lupaReinicio = contentFrame.locator('a#btnBuscar, a#btnConsultar, input[type="image"][id*="btnConsultar" i], input[type="image"][id*="btnBuscar" i], img[title*="Consultar" i], img[title*="Buscar" i], img[alt*="Consultar" i], img[alt*="Buscar" i]').first();
    if (await lupaReinicio.count() > 0 && await lupaReinicio.isVisible()) {
        await lupaReinicio.click();
    } else {
         const genericBtnRein = contentFrame.locator('a:has(img[src*="list.png"]):visible, input[type="image"]:visible, img[src*="lupa"]:visible').first(); 
         if (await genericBtnRein.count() > 0) await genericBtnRein.click();
    }
    await mainPage.waitForTimeout(3000);
}

main().catch(console.error);
