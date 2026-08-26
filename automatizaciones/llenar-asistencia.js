/**
 * llenar-asistencia.js
 * Script para automatizar el llenado masivo de RAM y el desmarcado de inasistencias interactivamente.
 * FASE 1: Llenado masivo de asociaciones.
 * FASE 2: Subida individual y especifica.
 */

require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const readline = require('readline-sync');
const { loginYLlegarARoles, seleccionarRolYEntrar, obtenerNavegador, validarYCambiarAsociacion } = require('../servicios/autenticacion');
const { leerJardines } = require('../servicios/excel-reader');

const c = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
  rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
  gris:     (t) => `\x1b[90m${t}\x1b[0m`,
  negrita:  (t) => `\x1b[1m${t}\x1b[0m`,
};

const removeAccentsStr = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();

// Mapa de servicios para optimizar la busqueda. 
// Solo buscamos servicios de 2026.
const SERVICIOS_2026 = ["2026"];

function filtrarServiciosPorAsociacion(servOptions, ascNombre, tipoServicio) {
    // Filtrar por el año 2026 al FINAL de la opción (ej: -2026), evitando falsos positivos con 420267 / 420269
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
        // Asociaciones mixtas (BUENAVISTA, VERBENAL Y REFUGIO, CANAIMA)
        if (tipoServicio === 'Individual') {
            options = options.filter(o => (o.text.includes("420267") || o.text.toUpperCase().includes("HCB")) && !o.text.includes("420269"));
        } else if (tipoServicio === 'Agrupado') {
            options = options.filter(o => o.text.includes("420269") || o.text.toUpperCase().includes("JARDIN COMUNITARIO"));
        }
    }

    if (options.length === 0) {
        options = options2026.length > 0 ? options2026 : servOptions;
    }

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
  // Fix contract numbers
  const overrideContratos = {
    'VERBENAL Y REFUGIO': '11027492024',
    'BRISAS DE BUENAVISTA': '11026892024'
  };
  for (let asc of asociaciones) {
      if (overrideContratos[asc.nombreCorto]) {
          asc.numeroContrato = overrideContratos[asc.nombreCorto];
      }
  }


  if (asociaciones.length === 0) {
    console.error(c.rojo("  ⚠️ No hay asociaciones validas con contrato en el Excel."));
    process.exit(1);
  }

  console.log(c.cyan('\n  ======================================================'));
  console.log(c.cyan('  🤖 BOT DE ASISTENCIA CUENTAME - V3'));
  console.log(c.cyan('  ======================================================'));
  
  while (true) {
      const fases = [
        'Subida de RAM Masiva', 
        'Asistencias/Inasistencias'
      ];
      const faseIndex = readline.keyInSelect(fases, c.negrita('  > ESCOGER LA OPCION A EJECUTAR: '), { cancel: 'Volver al Menu Principal' });
      
      if (faseIndex === -1) break; // Volver al menu principal
      
      const todosLosMeses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      const fechaActual = new Date();
      const mesActualIdx = fechaActual.getMonth();
      const mesAnteriorIdx = mesActualIdx === 0 ? 11 : mesActualIdx - 1;
      const mesesOpciones = [todosLosMeses[mesAnteriorIdx], todosLosMeses[mesActualIdx]];
      
      const mesIndex = readline.keyInSelect(mesesOpciones, c.negrita('  > Selecciona el mes a diligenciar: '), { cancel: 'Atras' });
      if (mesIndex === -1) continue; // Atras
      
      const mesAtencion = mesesOpciones[mesIndex];

      if (faseIndex === 0) {
          await ejecutarFase1(asociaciones, mesAtencion);
      } else {
          await ejecutarFase2(asociaciones, mesAtencion);
      }
  }
  console.log(c.verde('\n  👋 Volviendo al menu principal...\n'));
  process.exit(0);
}

async function iniciarNavegador() {
    console.log(c.cyan('\n  🌐 Inicializando entorno de navegador...\n'));
    const navData = await obtenerNavegador();
    return { browser: navData.browser, context: navData.context, mainPage: navData.page };
}

// ==========================================
// FASE 1: SUBIDA DE RAM MASIVA
// ==========================================
async function ejecutarFase1(asociaciones, mesAtencion) {
    console.log(c.cyan('\n  📋 [SUBIDA DE RAM MASIVA] SELECCIONA LA ASOCIACION PARA SUBIDA GENERAL:'));
    console.log(c.amarillo(`  T. 🌟 TODAS LAS ASOCIACIONES`));
    console.log(c.amarillo(`  0. Atras`));
    asociaciones.forEach((asc, idx) => {
        console.log(`  ${idx + 1}. ${asc.nombreCorto} (Contrato: ${asc.numeroContrato})`);
    });
    
    let ascAProcesar = [];
    while (ascAProcesar.length === 0) {
        console.log(c.gris('  (Puedes ingresar varios numeros separados por coma, ej: 1,3,4)'));
        const respuesta = readline.question(c.negrita('\n  > Ingresa el numero de la(s) opcion(es) (o 0 para Atras): '));
        
        const respTrim = respuesta.trim().toUpperCase();
        if (respTrim === '0') return; // Atras
        if (respTrim === 'T') {
            ascAProcesar = asociaciones;
            break;
        }

        const partes = respuesta.split(',').map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n));
        if (partes.length === 0) continue;

        const invalidos = partes.filter(n => n < 1 || n > asociaciones.length);
        if (invalidos.length > 0) {
            console.log(c.rojo(`  ⚠️ Opciones invalidas: ${invalidos.join(', ')}`));
            continue;
        }
        ascAProcesar = partes.map(n => asociaciones[n - 1]);
    }

    // Configurar dias a ignorar (Capacitaciones, etc)
    let diasIgnorarStr = readline.question(c.negrita('\n  > Dias a ignorar en todo el mes (separados por coma, ej: 20,25) o ENTER para ninguno: '));
    const diasIgnorar = diasIgnorarStr.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));

    // Configurar dias para marcar asistencia (por defecto HOY)
    const diaHoy = new Date().getDate();
    let diasMarcarStr = readline.question(c.negrita(`  > Dias para marcar asistencia por defecto (hoy) [ENTER por defecto = HOY (dia ${diaHoy})]: `)).trim();
    
    let diasAMarcar = null;
    if (diasMarcarStr === '') {
        diasAMarcar = [diaHoy];
    } else if (diasMarcarStr.toUpperCase() !== 'TODOS' && diasMarcarStr.toUpperCase() !== 'ALL') {
        diasAMarcar = diasMarcarStr.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));
        if (diasAMarcar.length === 0) diasAMarcar = [diaHoy];
    }

    let finalAscAProcesar = [];
    for (let asc of ascAProcesar) {
        if (['BUENAVISTA', 'VERBENAL Y REFUGIO', 'CANAIMA'].some(x => asc.nombreCorto.toUpperCase().includes(x))) {
            const opciones = ['Individuales (HCB - 420267)', 'Agrupados (JARDIN COMUNITARIO - 420269)', 'Ambas (Individuales + Agrupados)'];
            const res = readline.keyInSelect(opciones, c.negrita(`\n  > La asociacion ${asc.nombreCorto} es MIXTA. Que jardines desea procesar?`), { cancel: false });
            if (res === 2) {
                finalAscAProcesar.push({ ...asc, tipoServicio: 'Individual' });
                finalAscAProcesar.push({ ...asc, tipoServicio: 'Agrupado' });
            } else {
                asc.tipoServicio = res === 0 ? 'Individual' : 'Agrupado';
                finalAscAProcesar.push(asc);
            }
        } else {
            finalAscAProcesar.push(asc);
        }
    }
    ascAProcesar = finalAscAProcesar;

    const descMarcar = diasAMarcar ? `[${diasAMarcar.join(',')}]` : 'TODOS los dias del mes';
    console.log(c.verde(`\n  ✅ Iniciando Subida de RAM Masiva: ${ascAProcesar.length} Asociacion(es) | Dias a marcar: ${descMarcar} | Ignorando dias: [${diasIgnorar.join(',') || 'Ninguno'}]`));

    const { browser, context, mainPage } = await iniciarNavegador();

    for (let i = 0; i < ascAProcesar.length; i++) {
        const asc = ascAProcesar[i];
        console.log(c.cyan(`\n======================================================`));
        console.log(c.cyan(`▶ Procesando Asociacion [${i+1}/${ascAProcesar.length}]: ${asc.nombreCorto}${asc.tipoServicio ? ' (' + asc.tipoServicio + ')' : ''}`));
        console.log(c.cyan(`======================================================`));

        try {
            console.log(`  🏢 Validando y seleccionando entidad/asociacion: "${asc.nombreCorto}"...`);
            const mismaAsc = await validarYCambiarAsociacion(mainPage, asc);
            if (!mismaAsc) {
                await loginYLlegarARoles(mainPage, { 
                    usuario: process.env.CUENTAME_USUARIO, 
                    password: process.env.CUENTAME_PASSWORD,
                    gmailUser: process.env.GMAIL_USER,
                    gmailAppPassword: process.env.GMAIL_APP_PASSWORD
                });
                await seleccionarRolYEntrar(mainPage, asc);
            }
            const workPage = mainPage;
            console.log(c.verde(`  ✅ Asociacion "${asc.nombreCorto}" cargada e ingresada limpia en la plataforma.`));
            
            console.log('  🚀 Navegando a Unidad -> Registro de asistencia mensual - ram...');
            await workPage.goto('https://rubonline.icbf.gov.co/Page/RUBONLINE/RegistroAsistencia/List.aspx', { waitUntil: 'networkidle', timeout: 60000 });
            await workPage.waitForTimeout(1200);

            let contentFrame = workPage.frame({ name: 'frameContent' }) || workPage.frames().find(f => f.name() === 'frameContent') || workPage;
            if (!contentFrame) throw new Error('No se encontro el frameContent.');

            console.log('  📝 Llenando filtros del RAM...');
            const selectDropdown = async (keyword, textOrIndex) => {
            try {
                const sel = contentFrame.locator(`select[id*="${keyword}"]`).first();
                
                // Esperar hasta que el select aparezca (max 10 segs)
                let attempts = 0;
                while (await sel.count() === 0 && attempts < 20) {
                    await workPage.waitForTimeout(300);
                    attempts++;
                }
                if (await sel.count() === 0) return;
                
                let isEnabled = await sel.evaluate(s => !s.disabled);
                if (!isEnabled) return; // Skip if disabled

                let valueToSelect = null;

                // Intentar encontrar la opcion esperada con reintentos (UpdatePanels son lentos)
                for (let retry = 0; retry < 40; retry++) {
                    if (typeof textOrIndex === 'string') {
                        valueToSelect = await sel.evaluate((s, t) => {
                            const opt = Array.from(s.options).find(o => o.text.toUpperCase().includes(t.toUpperCase()));
                            return opt ? opt.value : null;
                        }, textOrIndex);
                    } else if (typeof textOrIndex === 'number') {
                        valueToSelect = await sel.evaluate(s => {
                            const opt = Array.from(s.options).find(o => o.value && o.value !== "0" && o.value !== "");
                            return opt ? opt.value : null;
                        });
                    }

                    if (valueToSelect) {
                        break; // Encontrado
                    }
                    await workPage.waitForTimeout(100); // Esperar a que Cuentame actualice el select
                }

                if (valueToSelect) {
                    const currentValue = await sel.evaluate(s => s.value);
                    if (currentValue === valueToSelect) return;
                    console.log(c.gris(`    [DEBUG] Seleccionando en ${keyword}: ${valueToSelect}`));
                    await sel.selectOption(valueToSelect, { timeout: 5000 });
                    await workPage.waitForTimeout(100);
                } else {
                    console.log(c.rojo(`    ⚠️ No se encontro la opcion para ${keyword} (${textOrIndex}). Intentando fallback a la primera opcion valida...`));
                    const fallbackVal = await sel.evaluate(s => {
                        const opt = Array.from(s.options).find(o => o.value && o.value !== "0" && o.value !== "-1" && o.value !== "");
                        return opt ? opt.value : null;
                    });
                    if (fallbackVal) {
                        const currentValue = await sel.evaluate(s => s.value);
                        if (currentValue === fallbackVal) return;
                        console.log(c.amarillo(`    ⚠️ Fallback exitoso: Seleccionando valor: ${fallbackVal} en ${keyword}`));
                        await sel.selectOption(fallbackVal, { timeout: 5000 });
                        await workPage.waitForTimeout(100);
                    } else {
                        console.log(c.rojo(`    ❌ Fallback fallo: No hay opciones validas en ${keyword}.`));
                    }
                }
            } catch (e) {
                console.log(c.gris(`    (No se pudo seleccionar en ${keyword}: ${e.message})`));
            }
        };
            
            await selectDropdown('Direcciones', 'Primera Infancia');
            await selectDropdown('Regional', 'Bogota');
            await selectDropdown('Centro', 'USAQUEN'); // A veces se requiere
            await selectDropdown('Vigencia', (asc.vigenciaContrato || '2026').toString());
            await selectDropdown('Contrato', asc.numeroContrato ? asc.numeroContrato.toString() : 1);
            await selectDropdown('Mes', mesAtencion);
            await selectDropdown('Estado', 'Todos');
        await workPage.waitForTimeout(500);

        const servicioLocator = contentFrame.locator(`select[id*="Servicio"]`).first();
            let serviciosOptions = [];
            if (await servicioLocator.count() > 0) {
                serviciosOptions = await servicioLocator.evaluate(s => {
                    return Array.from(s.options)
                        .filter(o => o.value && o.value !== "0" && o.value !== "-1" && o.value !== "" && !o.text.toUpperCase().includes("SELECCIONE"))
                        .map(o => ({ value: o.value, text: o.text }));
                });
            }

            // Filtrar servicios de 2026 y por reglas de asociacion
            console.log(c.gris(`    [DEBUG] Servicios encontrados sin filtrar: ${serviciosOptions.map(s => s.text).join(' | ')}`));
        let serviciosFiltrados = filtrarServiciosPorAsociacion(serviciosOptions, asc.nombreCorto, asc.tipoServicio);
            console.log(c.cyan(`  Encontrados ${serviciosFiltrados.length} servicios validos (2026).`));

            for (let sIdx = 0; sIdx < serviciosFiltrados.length; sIdx++) {
                const serv = serviciosFiltrados[sIdx];
                console.log(c.amarillo(`\n  >> Probando Servicio [${sIdx+1}/${serviciosFiltrados.length}]: ${serv.text}`));
                
                await servicioLocator.selectOption(serv.value, { timeout: 5000 });
            await workPage.waitForTimeout(400); 

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
                    await workPage.waitForTimeout(800);

                    console.log('    👉 Buscando (clic en la lupa)...');
                    const lupa = contentFrame.locator('a#btnBuscar, a#btnConsultar, input[type="image"][id*="btnConsultar" i], input[type="image"][id*="btnBuscar" i], img[title*="Consultar" i], img[title*="Buscar" i], img[alt*="Consultar" i], img[alt*="Buscar" i]').first();
                    if (await lupa.count() > 0 && await lupa.isVisible()) {
                         await lupa.click();
                    } else {
                         const genericBtn = contentFrame.locator('a:has(img[src*="list.png"]):visible, input[type="image"]:visible, img[src*="lupa"]:visible').first(); 
                         if (await genericBtn.count() > 0) await genericBtn.click();
                    }
                    await workPage.waitForTimeout(800);

                    console.log('    👉 Habilitando edicion (clic en el lapiz)...');
                    const lapiz = contentFrame.locator('a#btnEditar, a#btnModificar, input[type="image"][id*="btnEditar" i], input[type="image"][id*="btnModificar" i], img[title*="Editar" i], img[title*="Modificar" i], img[alt*="Editar" i], img[alt*="Modificar" i]').first();
                    if (await lapiz.count() > 0 && await lapiz.isVisible()) {
                        await lapiz.click();
                        await workPage.waitForTimeout(800);
                    } else {
                        const genericEdit = contentFrame.locator('a:has(img[src*="edit.png"]):visible, input[type="image"]:visible, img[src*="edit"]:visible, img[src*="lapiz"]:visible').first();
                        if (await genericEdit.count() > 0) {
                            await genericEdit.click();
                            await workPage.waitForTimeout(800);
                        }
                    }

                    const descDias = diasAMarcar ? `[${diasAMarcar.join(',')}]` : 'Todo el mes';
                    console.log(`    ✅ Marcando asistencia (Dias: ${descDias} | Excepto ignorados)...`);
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
                                const debeMarcar = (!diasAMarcar || diasAMarcar.includes(dayNumber)) && !diasIgnorar.includes(dayNumber);
                                if (debeMarcar) {
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

                    console.log(c.verde(`    ✔️ Se procesaron ${ninosActivos} ninos activos y se marcaron ${checksMarcados} asistencias.`));

                    console.log('    💾 Guardando asistencia...');
                    const disco = contentFrame.locator('a#btnGuardar, input[type="image"][id*="btnGuardar" i], img[title*="Guardar" i], img[alt*="Guardar" i]').first();
                    if (await disco.count() > 0 && await disco.isVisible()) {
                        await disco.click();
                    } else {
                         const genericSave = contentFrame.locator('a:has(img[src*="save.png"]):visible, input[type="image"]:visible, img[src*="save"]:visible, img[src*="guardar"]:visible').last();
                         if (await genericSave.count() > 0) await genericSave.click();
                    }
                    await workPage.waitForTimeout(800); 
                    console.log(c.verde('    ✅ Guardado exitoso.'));

                    const isUltimoServicio = (sIdx === serviciosFiltrados.length - 1);
                    const isUltimaUds = (u === udsOptionsFiltradas.length - 1);

                    if (isUltimoServicio && isUltimaUds) {
                        console.log(c.gris('    ⏭️  Ultima UDS procesada, saltando la recarga de filtros para cambiar de asociacion...'));
                        continue;
                    }

                    console.log(c.gris('    🔄 Recargando pagina para desbloquear filtros de la siguiente UDS...'));
                    await workPage.goto('https://rubonline.icbf.gov.co/Page/RUBONLINE/RegistroAsistencia/List.aspx', { waitUntil: 'domcontentloaded' });
                    await workPage.waitForTimeout(800);
                    contentFrame = workPage.frame({ name: 'frameContent' }) || workPage.frames().find(f => f.name() === 'frameContent') || workPage;
                    
                    // Volver a llenar los filtros para la siguiente UDS
                    await selectDropdown('Direcciones', 'Primera Infancia');
                    await selectDropdown('Regional', 'Bogota');
                    await selectDropdown('Centro', 'USAQUEN');
                    await selectDropdown('Vigencia', (asc.vigenciaContrato || '2026').toString());
                    await selectDropdown('Contrato', asc.numeroContrato ? asc.numeroContrato.toString() : 1);
                    await selectDropdown('Mes', mesAtencion);
                    await selectDropdown('Estado', 'Todos');
                    
                    const servicioLocator2 = contentFrame.locator(`select[id*="Servicio"]`).first();
                    if (await servicioLocator2.count() > 0) {
                        await servicioLocator2.selectOption(serv.value, { timeout: 5000 });
                        await workPage.waitForTimeout(800);
                    }

                } // fin loop UDS
            } // fin loop SERVICIOS
        } catch (err) {
            console.error(c.rojo(`  ❌ Ocurrio un error con ${asc.nombreCorto}: ${err && err.message ? err.message : err}`));
            console.error(err); 
        }
    }
    console.log(c.verde('\n  🎉 FASE 1 COMPLETADA CON EXITO. Navegador mantenido activo.'));
}

// ==========================================
// FASE 2: PRE-CONSULTA INTERACTIVA Y LOTE
// ==========================================
async function ejecutarFase2(asociaciones, mesAtencion) {
    const { obtenerJardinesDeAsociacion, obtenerNinosDeJardin } = require('../servicios/bd-beneficiarios');
    const removeAccentsStr = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();

    const tareasPreparadas = [];
    let baseAsc = null;
    let asociacionForzada = false;

    if (process.env.ASOCIACION_ACTIVA) {
        try {
            const ascObj = JSON.parse(process.env.ASOCIACION_ACTIVA);
            baseAsc = asociaciones.find(a => removeAccentsStr(a.nombreCorto) === removeAccentsStr(ascObj.nombreCorto)) || ascObj;
            asociacionForzada = true;
        } catch(e) {}
    }

    console.log(c.cyan('\n===================================================================='));
    console.log(c.cyan('  ⚡ FASE 2: PRE-CONSULTA INTERACTIVA Y EDICION EN LOTE (OFF-LINE)'));
    console.log(c.cyan('  (Configura todos los cambios de una vez sin esperar a la web)'));
    console.log(c.cyan('===================================================================='));

    while (true) {
        // 1. Seleccionar Asociacion (si no viene de la Suite Principal)
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

        // 2. Seleccionar Jardin (desde BD Master Local)
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

        // 3. Seleccionar Nino/Nina (desde BD Master Local)
        const ninosLocal = obtenerNinosDeJardin(baseAsc.nombreCorto, jardinElegido.nombreUds);
        if (!ninosLocal || ninosLocal.length === 0) {
            console.log(c.rojo(`  ⚠️ No se encontraron ninos registrados en ${jardinElegido.nombreUds}.`));
            continue;
        }

        while (true) {
            console.log(c.cyan(`\n  📂 Beneficiarios en ${jardinElegido.nombreUds} (${ninosLocal.length}):`));
            console.log(c.amarillo('  0. 🌟 TODOS LOS NINOS DEL JARDIN'));
            ninosLocal.forEach((n, idx) => {
                console.log(`  ${idx + 1}. ${n.nombreCompleto} (${n.tipoDoc}: ${n.documento} - ${n.edad} anos)`);
            });

            const respNino = readline.question(c.negrita('\n  > Ingrese el Numero (ej: 1), Nombre, Apellido o 0 (o Vacio para cambiar de Jardin): ')).trim();
            if (!respNino) break;

            let ninosSeleccionados = [];
            const numNino = parseInt(respNino, 10);

            if (respNino === '0' || respNino.toUpperCase() === 'TODOS') {
                ninosSeleccionados = ninosLocal;
            } else if (!isNaN(numNino) && numNino >= 1 && numNino <= ninosLocal.length) {
                ninosSeleccionados = [ninosLocal[numNino - 1]];
            } else {
                const qName = removeAccentsStr(respNino);
                ninosSeleccionados = ninosLocal.filter(n => removeAccentsStr(n.nombreCompleto).includes(qName) || n.documento.includes(qName));
                if (ninosSeleccionados.length === 0) {
                    console.log(c.rojo(`  ❌ No se encontro ningun nino que coincida con "${respNino}".`));
                    continue;
                }
            }

            // 4. Seleccionar Accion
            console.log(c.cyan(`\n  🎯 Nino(s) seleccionado(s): ${ninosSeleccionados.map(n => n.nombreCompleto).join(', ')}`));
            const acciones = [
                'Marcar ASISTENCIAS (poner checks [X])',
                'Marcar INASISTENCIAS (quitar checks [ ])'
            ];
            const accionIdx = readline.keyInSelect(acciones, c.negrita(`  > Accion a aplicar: `), { cancel: 'Cancelar' });
            if (accionIdx === -1) continue;

            const tipoAccion = accionIdx === 0 ? 'ASISTENCIA' : 'INASISTENCIA';

            // 5. Seleccionar Dias
            const diasInput = readline.question(c.negrita('\n  > Ingrese los dias. Ejemplo: 1,5,8 o 1-15: ')).trim();
            if (!diasInput) continue;

            let dias = [];
            const partes = diasInput.split(',');
            for (let p of partes) {
                p = p.trim();
                if (p.includes('-')) {
                    const rangos = p.split('-');
                    const ini = parseInt(rangos[0], 10);
                    const fin = parseInt(rangos[1], 10);
                    if (!isNaN(ini) && !isNaN(fin) && ini <= fin) {
                        for (let i = ini; i <= fin; i++) dias.push(i);
                    }
                } else {
                    const num = parseInt(p, 10);
                    if (!isNaN(num)) dias.push(num);
                }
            }

            if (dias.length === 0) {
                console.log(c.rojo('  ❌ Dias invalidos. Intenta nuevamente.'));
                continue;
            }

            // Agregar a tareas preparadas
            for (const nino of ninosSeleccionados) {
                tareasPreparadas.push({
                    asociacion: baseAsc,
                    jardin: jardinElegido,
                    nino: nino,
                    tipoAccion: tipoAccion,
                    dias: dias,
                    mesAtencion: mesAtencion
                });
                console.log(c.verde(`  ➕ [LOTE] ${tipoAccion} -> ${nino.nombreCompleto} (${jardinElegido.nombreUds}) | Dias: [${dias.join(', ')}]`));
            }

            const mas = readline.question(c.negrita('\n  > Deseas agregar otra tarea en este mismo jardin? (s/n) [por defecto s]: ')).trim();
            if (mas.toLowerCase() === 'n') break;
        }

        const continuarMas = readline.question(c.negrita('\n  > Deseas agregar tareas en otro jardin o asociacion? (s/n) [por defecto n]: ')).trim();
        if (continuarMas.toLowerCase() !== 's') break;
    }

    if (tareasPreparadas.length === 0) {
        console.log(c.amarillo('\n  ⚠️ No se me preparo ninguna tarea. Volviendo al menu principal...'));
        return;
    }

    // RESUMEN FINAL DEL LOTE
    console.log(c.cyan('\n===================================================================='));
    console.log(c.cyan(`  📋 RESUMEN FINAL DEL LOTE A EJECUTAR EN CUENTAME (${tareasPreparadas.length} TAREAS):`));
    console.log(c.cyan('===================================================================='));
    tareasPreparadas.forEach((t, idx) => {
        console.log(`  ${idx + 1}. [${t.asociacion.nombreCorto} | ${t.jardin.nombreUds}] ${t.tipoAccion}: ${t.nino.nombreCompleto} (Doc: ${t.nino.documento}) -> Dias: [${t.dias.join(', ')}]`);
    });

    const confirm = readline.question(c.negrita('\n  > Confirmar y ejecutar automaticamente en Cuentame? (ENTER = Si, n = Cancelar): ')).trim();
    if (confirm.toLowerCase() === 'n') {
        console.log(c.amarillo('  ⚠️ Operacion cancelada por el usuario.'));
        return;
    }

    // EJECUCIÓN AUTOMÁTICA EN CUÉNTAME
    console.log(c.cyan('\n===================================================================='));
    console.log(c.cyan('  🚀 INICIANDO EJECUCIÓN AUTOMÁTICA EN CUÉNTAME...'));
    console.log(c.cyan('===================================================================='));

    const nav = await iniciarNavegador();
    const { browser, context, mainPage } = nav;

    // Agrupar por asociación para hacer 1 solo login/cambio de asociación por grupo
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
        console.log(c.cyan(`\n▶ Procesando Asociación en Cuéntame: ${asc.nombreCorto}`));

        try {
            const mismaAsc = await validarYCambiarAsociacion(mainPage, asc);
            if (!mismaAsc) {
                await loginYLlegarARoles(mainPage, { 
                    usuario: process.env.CUENTAME_USUARIO, 
                    password: process.env.CUENTAME_PASSWORD,
                    gmailUser: process.env.GMAIL_USER,
                    gmailAppPassword: process.env.GMAIL_APP_PASSWORD
                });
                await seleccionarRolYEntrar(mainPage, asc);
            }

            await mainPage.goto('https://rubonline.icbf.gov.co/Page/RUBONLINE/RegistroAsistencia/List.aspx', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await mainPage.waitForTimeout(800);

            let contentFrame = mainPage.frame({ name: 'frameContent' }) || mainPage.frames().find(f => f.name() === 'frameContent') || mainPage;

            // Agrupar tareas por Jardín dentro de esta Asociación
            const gruposJardin = new Map();
            for (const t of grupo.tareas) {
                const jKey = t.jardin.nombreUds;
                if (!gruposJardin.has(jKey)) {
                    gruposJardin.set(jKey, { jardin: t.jardin, tareas: [] });
                }
                gruposJardin.get(jKey).tareas.push(t);
            }

            for (const [jNombre, jGrupo] of gruposJardin) {
                console.log(c.amarillo(`\n  🏢 Cargando Jardín en Cuéntame: ${jNombre}...`));
                
                contentFrame = mainPage.frame({ name: 'frameContent' }) || mainPage.frames().find(f => f.name() === 'frameContent') || mainPage;

                // Llenar filtros de RAM
                const selectDropdown = async (keyword, textOrIndex) => {
                    try {
                        const sel = contentFrame.locator(`select[id*="${keyword}"]`).first();
                        if (await sel.count() === 0) return;
                        
                        for (let r = 0; r < 30; r++) {
                            const disabled = await sel.evaluate(s => s.disabled).catch(() => true);
                            if (!disabled) break;
                            await mainPage.waitForTimeout(100);
                        }

                        let valueToSelect = null;
                        for (let retry = 0; retry < 30; retry++) {
                            if (typeof textOrIndex === 'string') {
                                const targetText = removeAccentsStr(textOrIndex);
                                valueToSelect = await sel.evaluate((s, t) => {
                                    const opt = Array.from(s.options).find(o => {
                                        const tNorm = o.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
                                        return tNorm.includes(t) || t.includes(tNorm);
                                    });
                                    return opt ? opt.value : null;
                                }, targetText);
                            }
                            if (valueToSelect) break;
                            await mainPage.waitForTimeout(100);
                        }

                        if (valueToSelect) {
                            const curVal = await sel.evaluate(s => s.value);
                            if (curVal !== valueToSelect) {
                                console.log(c.gris(`    [Filtro] Seleccionando ${keyword}: ${valueToSelect}`));
                                await sel.selectOption(valueToSelect, { timeout: 5000 }).catch(() => {});
                                await sel.evaluate(el => {
                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                    if (typeof __doPostBack === 'function') {
                                        try { __doPostBack(el.name || el.id, ''); } catch(e) {}
                                    }
                                }).catch(() => {});

                                await mainPage.waitForTimeout(150);
                                await mainPage.waitForFunction(() => {
                                    if (typeof Sys === 'undefined' || !Sys.WebForms || !Sys.WebForms.PageRequestManager) return true;
                                    var prm = Sys.WebForms.PageRequestManager.getInstance();
                                    return !prm.get_isInAsyncPostBack();
                                }, { timeout: 5000 }).catch(() => {});
                                await mainPage.waitForTimeout(300);
                            }
                        }
                    } catch(e) {}
                };

                await selectDropdown('Direcciones', 'Primera Infancia');
                await selectDropdown('Regional', 'Bogota');
                await selectDropdown('Centro', 'USAQUEN');
                await selectDropdown('Vigencia', (asc.vigenciaContrato || '2026').toString());
                await selectDropdown('Contrato', asc.numeroContrato ? asc.numeroContrato.toString() : 1);
                await selectDropdown('Mes', mesAtencion);
                await selectDropdown('Estado', 'Todos');
                await mainPage.waitForTimeout(400);

                // 1. Seleccionar Servicio (requerido para habilitar el dropdown de UDS - 2026)
                const servicioLocator = contentFrame.locator('select[id*="Servicio"]').first();
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

                    const jModalidad = (jGrupo.jardin.modalidad || '').toUpperCase();
                    const tipoServ = (jModalidad.includes('JARDIN') || jModalidad.includes('AGRUPADO')) ? 'Agrupado' : 'Individual';
                    
                    let servValidos = filtrarServiciosPorAsociacion(servOpts, asc.nombreCorto, tipoServ);
                    if (servValidos.length === 0) {
                        servValidos = servOpts.filter(o => /-2026\b/.test(o.text) || o.text.endsWith("2026"));
                    }
                    if (servValidos.length === 0) {
                        servValidos = servOpts;
                    }

                    const chosenServ = servValidos[0];

                    if (chosenServ) {
                        console.log(c.gris(`    [Filtro] Seleccionando Servicio (2026): ${chosenServ.text}`));
                        await servicioLocator.selectOption(chosenServ.value, { timeout: 5000 }).catch(() => {});
                        await servicioLocator.evaluate(el => {
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                            if (typeof __doPostBack === 'function') {
                                try { __doPostBack(el.name || el.id, ''); } catch(e) {}
                            }
                        }).catch(() => {});

                        await mainPage.waitForTimeout(200);
                        await mainPage.waitForFunction(() => {
                            if (typeof Sys === 'undefined' || !Sys.WebForms || !Sys.WebForms.PageRequestManager) return true;
                            var prm = Sys.WebForms.PageRequestManager.getInstance();
                            return !prm.get_isInAsyncPostBack();
                        }, { timeout: 6000 }).catch(() => {});
                        await mainPage.waitForTimeout(500); // Esperar postback de ASP.NET para actualizar UDS
                    }
                }

                // 2. Seleccionar UDS por codigoUds o nombreUds
                const uLoc = contentFrame.locator(`select[id*="Uds"], select[id*="UDS"], select[id*="Unidad"]`).first();
                if (await uLoc.count() > 0) {
                    let udsValue = null;
                    const codigoSearch = (jGrupo.jardin.codigoUds || '').trim();
                    const nombreSearch = removeAccentsStr(jNombre);

                    // Esperar a que el UpdatePanel de ASP.NET cargue las opciones de UDS (hasta 60 reintentos x 100ms = 6s)
                    for (let r = 0; r < 60; r++) {
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

                    if (udsValue) {
                        console.log(c.gris(`    [Filtro] Seleccionando UDS: ${jNombre}`));
                        await uLoc.selectOption(udsValue, { timeout: 5000 }).catch(() => {});
                        await uLoc.evaluate(el => {
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                            if (typeof __doPostBack === 'function') {
                                try { __doPostBack(el.name || el.id, ''); } catch(e) {}
                            }
                        }).catch(() => {});

                        await mainPage.waitForTimeout(150);
                        await mainPage.waitForFunction(() => {
                            if (typeof Sys === 'undefined' || !Sys.WebForms || !Sys.WebForms.PageRequestManager) return true;
                            var prm = Sys.WebForms.PageRequestManager.getInstance();
                            return !prm.get_isInAsyncPostBack();
                        }, { timeout: 5000 }).catch(() => {});
                        await mainPage.waitForTimeout(500);
                    } else {
                        console.log(c.rojo(`    ⚠️ No se encontro la UDS "${jNombre}" en el dropdown de Cuentame.`));
                        continue;
                    }
                }

                // Clic en la Lupa para desplegar la lista de ninos en Cuentame
                console.log(c.gris('    [Filtro] Clic en Lupa para consultar beneficiarios...'));
                const lupa = contentFrame.locator('a#btnBuscar, a#btnConsultar, input[type="image"][id*="btnConsultar" i], input[type="image"][id*="btnBuscar" i], img[title*="Consultar" i], img[title*="Buscar" i], img[alt*="Consultar" i], img[alt*="Buscar" i]').first();
                if (await lupa.count() > 0 && await lupa.isVisible()) {
                    await lupa.click();
                } else {
                    const genericBtn = contentFrame.locator('a:has(img[src*="list.png"]):visible, input[type="image"]:visible, img[src*="lupa"]:visible').first();
                    if (await genericBtn.count() > 0) await genericBtn.click();
                }
                await mainPage.waitForTimeout(1000);

                contentFrame = mainPage.frame({ name: 'frameContent' }) || mainPage.frames().find(f => f.name() === 'frameContent') || mainPage;

                // Buscar las filas de la tabla de niños
                const filasNuevas = await contentFrame.locator('table[id*="grdConsulta"] tbody tr, table[id*="gvLista"] tbody tr, table[id*="GridView"] tbody tr, table.mGrid tbody tr, table.rgMasterTable tbody tr, table[id*="Grid"] tbody tr').all();
                
                const listaNinosTabla = [];
                for (let j = 0; j < filasNuevas.length; j++) {
                    const rowText = await filasNuevas[j].innerText();
                    const nombre = rowText.split('\t')[0].trim();
                    if (nombre && rowText.includes('Activo')) {
                        listaNinosTabla.push({ nombre: nombre, row: filasNuevas[j] });
                    }
                }

                // Habilitar edición (Clic en el lápiz si existe)
                const lapiz = contentFrame.locator('input[title*="Editar" i], img[title*="Editar" i], a:has(img[src*="edit"]), input[src*="edit"]').first();
                if (await lapiz.count() > 0 && await lapiz.isVisible()) {
                    await lapiz.click();
                    await mainPage.waitForTimeout(800);
                }

                // Aplicar las tareas del lote para este Jardín
                for (const tarea of jGrupo.tareas) {
                    console.log(c.cyan(`    👉 Aplicando [${tarea.tipoAccion}] para ${tarea.nino.nombreCompleto}...`));
                    
                    const qTarget = removeAccentsStr(tarea.nino.nombreCompleto);

                    let filaTarget = listaNinosTabla.find(n => {
                        const nClean = removeAccentsStr(n.nombre);
                        return nClean.includes(qTarget) || qTarget.includes(nClean);
                    });

                    if (!filaTarget) {
                        const partesNom = qTarget.split(' ').filter(p => p.length > 2);
                        filaTarget = listaNinosTabla.find(n => {
                            const nClean = removeAccentsStr(n.nombre);
                            return partesNom.filter(p => nClean.includes(p)).length >= 2;
                        });
                    }

                    if (!filaTarget) {
                        console.log(c.rojo(`    ❌ No se encontró la fila en Cuéntame para ${tarea.nino.nombreCompleto}.`));
                        continue;
                    }

                    const checkboxes = await filaTarget.row.locator('input[type="checkbox"]').all();
                    const marcar = (tarea.tipoAccion === 'ASISTENCIA');

                    for (const d of tarea.dias) {
                        const chkIndex = d - 1;
                        if (chkIndex >= 0 && chkIndex < checkboxes.length) {
                            const isChecked = await checkboxes[chkIndex].isChecked();
                            if (marcar && !isChecked) {
                                await checkboxes[chkIndex].check({ force: true }).catch(() => checkboxes[chkIndex].click());
                            } else if (!marcar && isChecked) {
                                await checkboxes[chkIndex].uncheck({ force: true }).catch(() => checkboxes[chkIndex].click());
                            }
                        }
                    }

                    console.log(c.verde(`    ✅ ${tarea.tipoAccion} aplicada para ${tarea.nino.nombreCompleto} (Días: ${tarea.dias.join(', ')})`));
                }

                // Guardar cambios en Cuéntame
                console.log(c.amarillo('    💾 Guardando cambios de asistencia en Cuéntame...'));
                const btnGuardar = contentFrame.locator('input[value*="Guardar" i], input[title*="Guardar" i], a:has(img[src*="save"]), input[src*="save"], button:has-text("Guardar")').first();
                if (await btnGuardar.count() > 0 && await btnGuardar.isVisible()) {
                    await btnGuardar.click();
                    await mainPage.waitForTimeout(1500);
                    console.log(c.verde('    ✅ Guardado exitoso.'));
                }
            }
        } catch (err) {
            console.error(c.rojo(`  ❌ Error en la ejecución del lote para ${ascNombre}: ${err.message}`));
        }
    }

    console.log(c.verde('\n  🎉 LOTE PROCESADO Y GUARDADO CON ÉXITO EN CUÉNTAME.'));
}

async function modificarAsistenciaIndividual(workPage, contentFrame, elegida, mesAtencion, asc, selectDropdown) {
    const { obtenerNinosDeJardin } = require('../servicios/bd-beneficiarios');
    const ninosLocal = obtenerNinosDeJardin(asc.nombreCorto, elegida.uds.text);

    while (true) {
        if (ninosLocal && ninosLocal.length > 0) {
            console.log(c.cyan(`\n    📂 [Base de Datos Master Local] Beneficiarios Activos en ${elegida.uds.text} (${ninosLocal.length}):`));
            ninosLocal.forEach((n, idx) => {
                console.log(`      ${idx + 1}. ${n.nombreCompleto} (${n.tipoDoc}: ${n.documento} - ${n.edad} anos)`);
            });
        }

        console.log(c.cyan('\n    Leyendo lista de ninos en Cuentame...'));
        contentFrame = workPage.frame({ name: 'frameContent' }) || workPage.frames().find(f => f.name() === 'frameContent') || workPage;

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
            console.log(c.rojo('    ⚠️ No se encontraron ninos activos en la tabla de Cuentame.'));
            break; 
        }

        console.log(c.cyan('\n    --- Lista de Ninos Activos en Plataforma ---'));
        listaNinos.forEach((n, idx) => console.log(`      ${idx + 1}. ${n.nombre}`));

        const seleccionNina = readline.question(c.negrita('\n    > Ingrese el NUMERO de la opcion (ej: 1), nombre, apellido o "TODOS"\n    > (Deje vacio para CAMBIAR DE JARDIN): ')).trim();
        if (!seleccionNina) break;

        let ninosAfectados = [];
        const numSel = parseInt(seleccionNina, 10);

        if (seleccionNina.toUpperCase() === 'TODOS') {
            ninosAfectados = listaNinos;
        } else if (!isNaN(numSel) && numSel >= 1 && numSel <= listaNinos.length) {
            ninosAfectados = [listaNinos[numSel - 1]];
        } else {
            const nombreBuscado = seleccionNina.toUpperCase();
            ninosAfectados = listaNinos.filter(n => n.nombre.toUpperCase().includes(nombreBuscado));
            if (ninosAfectados.length === 0) {
                console.log(c.rojo(`    ⚠️ No se encontro ningun nino con "${seleccionNina}"`));
                continue;
            }
            if (ninosAfectados.length > 1) {
                console.log(c.amarillo(`    ⚠️ Se encontraron varios ninos que coinciden:`));
                ninosAfectados.forEach(n => console.log(`      - ${n.nombre}`));
                console.log(c.amarillo(`    Por favor sea mas especifico o elija por numero.`));
                continue;
            }
        }

        console.log(c.verde(`\n    Ninos seleccionados: ${ninosAfectados.length}`));

        const acciones = [
            'Marcar ASISTENCIAS (poner checks [X])',
            'Marcar INASISTENCIAS (quitar checks [ ])'
        ];
        const accionIdx = readline.keyInSelect(acciones, c.negrita(`  > Que desea hacer con los ninos seleccionados?`), { cancel: 'Cancelar' });
        if (accionIdx === -1) continue;

        const marcarAsistencia = accionIdx === 0;

        const diasInput = readline.question(c.negrita('\n    > Ingrese los dias. Puede usar comas (1,5) o rangos (1-15): ')).trim();
        if (!diasInput) continue;

        // Parsear dias
        let diasAfectados = [];
        const partes = diasInput.split(',');
        for (let p of partes) {
            p = p.trim();
            if (p.includes('-')) {
                const rangos = p.split('-');
                const inicio = parseInt(rangos[0]);
                const fin = parseInt(rangos[1]);
                if (!isNaN(inicio) && !isNaN(fin) && inicio <= fin) {
                    for (let i = inicio; i <= fin; i++) diasAfectados.push(i);
                }
            } else {
                const num = parseInt(p);
                if (!isNaN(num)) diasAfectados.push(num);
            }
        }

        if (diasAfectados.length === 0) {
            console.log(c.rojo('    ⚠️ No se detectaron dias validos.'));
            continue;
        }

        console.log(`    👉 Habilitando edicion (clic en el lapiz)...`);
        const lapizNuevo = contentFrame.locator('a#btnEditar, a#btnModificar, input[type="image"][id*="btnEditar" i], input[type="image"][id*="btnModificar" i], img[title*="Editar" i], img[title*="Modificar" i], img[alt*="Editar" i], img[alt*="Modificar" i]').first();
        if (await lapizNuevo.count() > 0 && await lapizNuevo.isVisible()) {
            await lapizNuevo.click();
            await workPage.waitForTimeout(800);
            contentFrame = workPage.frame({ name: 'frameContent' }) || workPage.frames().find(f => f.name() === 'frameContent') || workPage;
            
            // Re-vincular los locators de las filas de los ninos seleccionados porque el DOM cambio
            const rowsNuevas = await contentFrame.locator('table[id*="grdConsulta"] tbody tr, table[id*="gvLista"] tbody tr, table[id*="GridView"] tbody tr, table.mGrid tbody tr, table.rgMasterTable tbody tr, table[id*="Grid"] tbody tr').all();
            for (let n of ninosAfectados) {
                if (n.idxOriginal < rowsNuevas.length) {
                    n.row = rowsNuevas[n.idxOriginal];
                }
            }
        }

        let modificados = 0;
        console.log(c.cyan(`    Aplicando cambios a ${diasAfectados.length} dias para ${ninosAfectados.length} ninos...`));

        for (const nino of ninosAfectados) {
            const celdas = await nino.row.locator(':scope > td').all();
            for (const dia of diasAfectados) {
                const colIndex = dia + 2; 
                if (colIndex < celdas.length) {
                    const chk = celdas[colIndex].locator('input[type="checkbox"]');
                    if (await chk.count() > 0) {
                        const isEnabled = await chk.isEnabled();
                        const isChecked = await chk.isChecked();
                        if (isEnabled) {
                            if (marcarAsistencia && !isChecked) {
                                await chk.check();
                                modificados++;
                            } else if (!marcarAsistencia && isChecked) {
                                await chk.uncheck();
                                modificados++;
                            }
                        }
                    }
                }
            }
        }

        const accionStr = marcarAsistencia ? 'asistencias marcadas' : 'inasistencias registradas (desmarcadas)';
        console.log(c.verde(`    ✔️ Se aplicaron ${modificados} cambios (${accionStr}).`));

        // PREGUNTAR AL USUARIO QUE HACER
        const opcionesFin = ['Continuar con OTRO nino (Sin guardar aun)', 'Guardar todos los cambios', 'Cancelar cambios y salir'];
        const finIdx = readline.keyInSelect(opcionesFin, c.negrita(`  > Que desea hacer ahora?`), { cancel: false });

        if (finIdx === 0) {
            // Continuar con otro nino sin guardar
            console.log(c.amarillo('    👉 Los cambios estan en pantalla. Selecciona el siguiente nino...'));
            continue;
        } else if (finIdx === 1) {
            // Guardar
            console.log('    💾 Guardando asistencia...');
            const discoNuevo = contentFrame.locator('a#btnGuardar, input[type="image"][id*="btnGuardar" i], img[title*="Guardar" i], img[alt*="Guardar" i]').first();
            if (await discoNuevo.count() > 0 && await discoNuevo.isVisible()) {
                await discoNuevo.click();
            } else {
                 const genericSave2 = contentFrame.locator('a:has(img[src*="save.png"]):visible, input[type="image"]:visible, img[src*="save"]:visible, img[src*="guardar"]:visible').last();
                 if (await genericSave2.count() > 0) await genericSave2.click();
            }
            await workPage.waitForTimeout(800);
            console.log(c.verde('    ✅ Guardado exitoso.'));
            // Cuando guarda, normalmente la pagina vuelve al modo solo lectura.
            // Recargamos los filtros para que pueda seleccionar otro jardin correctamente
            console.log(c.gris('    🔄 Recargando pagina para desbloquear filtros (equivalente a Volver)...'));
            await workPage.goto('https://rubonline.icbf.gov.co/Page/RUBONLINE/RegistroAsistencia/List.aspx', { waitUntil: 'domcontentloaded' });
            await workPage.waitForTimeout(800);
            contentFrame = workPage.frame({ name: 'frameContent' }) || workPage.frames().find(f => f.name() === 'frameContent') || workPage;
            
            // Volver a llenar los filtros base
            await selectDropdown('Direcciones', 'Primera Infancia');
            await selectDropdown('Regional', 'Bogota');
            await selectDropdown('Centro', 'USAQUEN');
            await selectDropdown('Vigencia', (asc.vigenciaContrato || '2026').toString());
            await selectDropdown('Contrato', asc.numeroContrato ? asc.numeroContrato.toString() : 1);
            await selectDropdown('Mes', mesAtencion);
            await selectDropdown('Estado', 'Todos');
            
            break;
        } else {
            // Cancelar
            console.log(c.rojo('    ❌ Cancelando cambios y saliendo de este jardin...'));
            
            console.log(c.gris('    🔄 Recargando pagina para restaurar el estado original...'));
            await workPage.goto('https://rubonline.icbf.gov.co/Page/RUBONLINE/RegistroAsistencia/List.aspx', { waitUntil: 'domcontentloaded' });
            await workPage.waitForTimeout(800);
            contentFrame = workPage.frame({ name: 'frameContent' }) || workPage.frames().find(f => f.name() === 'frameContent') || workPage;
            
            await selectDropdown('Direcciones', 'Primera Infancia');
            await selectDropdown('Regional', 'Bogota');
            await selectDropdown('Centro', 'USAQUEN');
            await selectDropdown('Vigencia', (asc.vigenciaContrato || '2026').toString());
            await selectDropdown('Contrato', asc.numeroContrato ? asc.numeroContrato.toString() : 1);
            await selectDropdown('Mes', mesAtencion);
            await selectDropdown('Estado', 'Todos');

            break;
        }
    }
}

main().catch(console.error);
