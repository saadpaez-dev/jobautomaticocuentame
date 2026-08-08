/**
 * desvinculacion-beneficiarios.js
 * Script para retirar beneficiarios en Cuéntame.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const readline = require('readline-sync');
const { loginYLlegarARoles, seleccionarRolYEntrar, obtenerNavegador } = require('../servicios/autenticacion');
const { leerJardines } = require('../servicios/excel-reader');

const c = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
  rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
  gris:     (t) => `\x1b[90m${t}\x1b[0m`,
  negrita:  (t) => `\x1b[1m${t}\x1b[0m`,
};

async function main() {
  const USUARIO = process.env.CUENTAME_USUARIO;
  const PASSWORD = process.env.CUENTAME_PASSWORD;
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

  if (!USUARIO || !PASSWORD) {
    console.error(c.rojo('\n❌ Faltan credenciales en el archivo .env\n'));
    process.exit(1);
  }

  // Cargar datos (Asociaciones y Jardines)
  const RUTA_EXCEL = process.env.RUTA_EXCEL || 'C:\\GENERAL.xlsx';
  const { porAsociacion, jardines: listaJardines } = leerJardines(RUTA_EXCEL);
  const asociaciones = Object.values(porAsociacion);

  if (asociaciones.length === 0) {
    console.log(c.rojo('❌ No se encontraron asociaciones en el Excel.'));
    return;
  }

  console.log(c.cyan('\n======================================================'));
  console.log(c.cyan('   ❌ DESVINCULACIÓN DE BENEFICIARIOS (RETIRO)'));
  console.log(c.cyan('======================================================\n'));
  
  let browser = null;
  let context = null;
  let page = null;
  let loggedIn = false;

  let salirModulo = false;
  let ascSeleccionada = null;
  let jardinSeleccionado = null;
  let globalFechaRetiro = null;
  let globalMotivoId = null;

  while (true) {
      if (salirModulo) break;
      
      if (!ascSeleccionada) {
          console.log(c.gris('Selecciona una asociación para iniciar el proceso.'));
          asociaciones.forEach((asc, i) => console.log(`  ${i + 1}. ${asc.nombreCorto}`));
          console.log(`  ${c.rojo('0')}. Volver al menú principal`);

          let idxAsociacion = -1;
          while (idxAsociacion < 0 || idxAsociacion > asociaciones.length) {
            const res = readline.question(c.negrita('\n  > Selecciona la asociacion: '));
            idxAsociacion = parseInt(res, 10);
            if (isNaN(idxAsociacion)) idxAsociacion = -1;
          }

          if (idxAsociacion === 0) {
            console.log(c.verde('\n  👋 Volviendo al menú principal...'));
            if (browser) await browser.close();
            break;
          }
          ascSeleccionada = asociaciones[idxAsociacion - 1];
      }


      // --- Conexión al navegador ---
      if (!browser) {
          console.log(c.cyan('\n  🌐 Conectando al navegador existente (CDP)...\n'));
          const navData = await obtenerNavegador();
          browser = navData.browser;
          context = navData.context;
          page = navData.page;
      }

      try {
        if (!loggedIn) {
            const urlActual = page.url();
            const textoActual = await page.evaluate(() => document.body.innerText).catch(() => '');
            const sesionActiva = urlActual.includes('MasterPrincipal') ||
                                 urlActual.includes('SeleccionRol') ||
                                 textoActual.includes('Seleccione la entidad') ||
                                 textoActual.includes('Bienvenido');

            if (sesionActiva) {
                console.log(c.verde('  ✅ Sesión activa detectada. Saltando login...'));
                loggedIn = true;
            } else {
                console.log(c.amarillo('  🔐 Sin sesión activa. Iniciando login...'));
                await loginYLlegarARoles(page, {
                  usuario: USUARIO,
                  password: PASSWORD,
                  gmailUser: GMAIL_USER,
                  gmailAppPassword: GMAIL_APP_PASSWORD
                });
                loggedIn = true;
                console.log(c.verde('  ✅ Login exitoso en Cuéntame.'));
            }
        } else {
            await page.goto('https://rubonline.icbf.gov.co/DefaultF.aspx', { waitUntil: 'domcontentloaded' });
        }

        console.log(c.amarillo(`  🏢 Seleccionando la asociación ${ascSeleccionada.nombreCorto}...`));
        await seleccionarRolYEntrar(page, ascSeleccionada);
        
        // Navegar a Beneficiario > Beneficiario
        console.log(c.cyan('  🚀 Navegando al módulo de Beneficiarios...'));
        
        let menuFrame = page.frame({ name: 'frameMenu' });
        if (!menuFrame) {
            for (const f of page.frames()) {
                if (f.name() === 'frameMenu') {
                    menuFrame = f;
                    break;
                }
            }
        }

        const rootMenu = menuFrame || page;
        
        try {
            // Expande "Beneficiario" padre si está colapsado
            const links = await rootMenu.locator('a:text-is("Beneficiario")').all();
            if (links.length >= 2) {
                await links[1].evaluate(n => n.click());
            } else if (links.length === 1) {
                await links[0].evaluate(n => n.click());
                await page.waitForTimeout(500);
                // Si abrió submenú y aparecieron más, clic al hijo
                const nuevosLinks = await rootMenu.locator('a:text-is("Beneficiario")').all();
                if (nuevosLinks.length >= 2) {
                    await nuevosLinks[1].evaluate(n => n.click());
                }
            } else {
                console.log(c.rojo('  ⚠️ No se encontró el menú Beneficiario.'));
            }
            await page.waitForTimeout(3000);
        } catch(e) {
            console.log(c.rojo(`  ❌ Error al intentar acceder a Beneficiario: ${e.message}`));
        }

        let contentFrame = page.frame({ name: 'frameContent' });
        if (!contentFrame) {
            for (const f of page.frames()) {
                if (f.name() === 'frameContent') {
                    contentFrame = f;
                    break;
                }
            }
        }

        if (!contentFrame) {
            throw new Error("No se pudo encontrar el frame de contenido.");
        }

        // Bucle de desvinculación
        let bucleRetiro = true;
        while (bucleRetiro) {
            
            if (!jardinSeleccionado) {
                let jardinesAsociacion = listaJardines.filter(j => 
                  j.asociacion && j.asociacion.toUpperCase() === ascSeleccionada.nombreCorto.toUpperCase()
                );

                if (jardinesAsociacion.length === 0) {
                    console.log(c.amarillo(`\n  ⚠️ No se encontraron jardines para ${ascSeleccionada.nombreCorto} en el Excel.`));
                    jardinesAsociacion = [{ nombre: "Ingresar manualmente", codigo: "" }];
                }

                console.log(c.cyan('\n  Jardines de la asociación:'));
                jardinesAsociacion.forEach((j, i) => console.log(`  ${i + 1}. ${j.nombre} ${j.codigo ? '('+j.codigo+')' : ''}`));
                console.log(`  ${c.rojo('0')}. Volver a asociación`);

                let idxJardin = -1;
                while (idxJardin < 0 || idxJardin > jardinesAsociacion.length) {
                    const res = readline.question(c.negrita('\n  > Selecciona el Jardin: '));
                    idxJardin = parseInt(res, 10);
                    if (isNaN(idxJardin)) idxJardin = -1;
                }

                if (idxJardin === 0) {
                    bucleRetiro = false;
                    ascSeleccionada = null;
                    break;
                }
                jardinSeleccionado = jardinesAsociacion[idxJardin - 1];
            }

            console.log(c.cyan(`\n---------------------------------------------------------`));
            console.log(c.cyan(`Jardín actual: ${jardinSeleccionado.nombre}`));

            // Click en el botón de Desvincular (-) si existe
            console.log(c.amarillo('  ⏳ Entrando al modo de Desvinculación...'));
            const btnDesvincular = contentFrame.locator('img[src*="delete.gif"], a[id*="btnDesvincular"]').first();
            if (await btnDesvincular.count() > 0) {
                await btnDesvincular.click();
                await page.waitForTimeout(2500); // Esperar a que cargue la interfaz de desvinculación
            }

            // --- LLENAR FILTROS (Misma lógica robusta) ---
            console.log(c.amarillo(`  ⏳ Llenando filtros de Contrato para ${ascSeleccionada.nombreCorto}...`));
            
            // Área misional: Dirección de Primera Infancia
            const selectArea = contentFrame.locator('select').filter({ hasText: 'Primera Infancia' }).first();
            if (await selectArea.count() > 0) {
                await selectArea.selectOption({ label: 'Dirección de Primera Infancia' }).catch(()=>{});
                await page.waitForTimeout(1000);
            }

            // Vigencia: Usar la del Excel, si no, el año actual
            let vigenciaStr = ascSeleccionada.vigenciaContrato || new Date().getFullYear().toString();
            if (!vigenciaStr) vigenciaStr = new Date().getFullYear().toString();

            const selectVigencia = contentFrame.locator('select').filter({ hasText: vigenciaStr }).first();
            if (await selectVigencia.count() > 0) {
                await selectVigencia.selectOption({ label: vigenciaStr }).catch(()=>{});
                await page.waitForTimeout(1500);
            }

            // Función auxiliar robusta
            const waitForAndSelect = async (selectLocator, textToMatch = null) => {
                if (await selectLocator.count() === 0) return null;
                let opts = [];
                for(let i=0; i<15; i++) { // Esperar hasta 7.5 segundos
                    const isEnabled = await selectLocator.evaluate(s => !s.disabled).catch(()=>false);
                    if (isEnabled) {
                        const raw = await selectLocator.evaluate(s => Array.from(s.options).map(o => ({ v: o.value, t: o.text }))).catch(()=>[]);
                        opts = raw.filter(o => o.v && o.v !== "0" && o.v !== "-1" && !o.t.toUpperCase().includes('SELECCIONE'));
                        if (opts.length > 0) break;
                    }
                    await page.waitForTimeout(500);
                }
                if (opts.length === 0) return opts;
                
                if (textToMatch) {
                    const removeAccents = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[,.]/g, "").replace(/\s+/g, " ").trim();
                    const match = opts.find(o => removeAccents(o.t.toUpperCase()).includes(removeAccents(textToMatch.toUpperCase())));
                    if (match) {
                        await selectLocator.selectOption(match.v).catch(()=>{});
                        await selectLocator.evaluate(el => {
                            if (typeof Sys !== 'undefined' && Sys.WebForms && Sys.WebForms.PageRequestManager) {
                                var prm = Sys.WebForms.PageRequestManager.getInstance();
                                if (!window.__MiBotHandler) {
                                    window.__MiBotHandler = function() { window.__pbHecho = true; };
                                    prm.add_endRequest(window.__MiBotHandler);
                                }
                                window.__pbHecho = false;
                            }
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        });
                        
                        await page.waitForTimeout(100); // Dejar que el postback inicie
                        await page.waitForFunction(() => {
                            if (typeof Sys === 'undefined' || !Sys.WebForms || !Sys.WebForms.PageRequestManager) return true;
                            var prm = Sys.WebForms.PageRequestManager.getInstance();
                            return window.__pbHecho || !prm.get_isInAsyncPostBack();
                        }, { timeout: 4000 }).catch(()=>{});
                        
                        await page.waitForTimeout(100); // Margen extra de seguridad
                        return opts;
                    }
                }
                
                if (opts.length === 1) {
                    await selectLocator.selectOption(opts[0].v).catch(()=>{});
                    await page.waitForTimeout(1500);
                    return opts;
                }
                return opts;
            };

            // Seleccionar Regional
            const selectRegional = contentFrame.locator('select[id*="ddlRegional"], select[id*="Regional"]').first();
            await waitForAndSelect(selectRegional, 'Bogota D.C.');

            // Seleccionar Contrato
            const selectContrato = contentFrame.locator('select[id*="ddlContrato"], select[id*="Contrato"]').first();
            await waitForAndSelect(selectContrato, ascSeleccionada.numeroContrato);

            // Seleccionar Servicio
            const selectServicio = contentFrame.locator('select[id*="ddlServicio"], select[id*="Servicio"]').first();
            const servOpts = await waitForAndSelect(selectServicio);
            if (servOpts && servOpts.length > 1) {
                // --- INICIO Lógica Automática Agrupado vs Individual ---
                let esAgrupado = false;
                const nomAsc = ascSeleccionada.nombreCorto.toUpperCase();
                const nomJardin = (jardinSeleccionado.nombre || "").toUpperCase();
                
                if (nomAsc.includes("DELICIAS DEL CARMEN")) {
                    esAgrupado = true;
                } else if (nomAsc.includes("VERBENAL Y REFUGIO") && (nomJardin.includes("OSITO CARIÑOSITO") || nomJardin.includes("MUNDO DE FANTASIA"))) {
                    esAgrupado = true;
                } else if (nomAsc.includes("BUENAVISTA") && nomJardin.includes("EL SOLECITO")) {
                    esAgrupado = true;
                } else if (nomAsc.includes("CANAIMA") && (nomJardin.includes("MARAVILLAS") || nomJardin.includes("ESTRELLITAS DEL FUTURO"))) {
                    esAgrupado = true;
                }
                
                let matchInd = null;
                if (esAgrupado) {
                    matchInd = servOpts.find(o => o.t.toUpperCase().includes("JARDÍN COMUNITARIO") || o.t.toUpperCase().includes("JARDIN COMUNITARIO"));
                } else {
                    matchInd = servOpts.find(o => o.t.toUpperCase().includes("HCB FAMI") || o.t.toUpperCase().includes("BIENVENIR"));
                    // Fallback para Individual
                    if (!matchInd) matchInd = servOpts.find(o => !o.t.toUpperCase().includes("JARDÍN COMUNITARIO") && !o.t.toUpperCase().includes("JARDIN COMUNITARIO"));
                }
                
                // Fallback a lógica original si no encuentra
                if (!matchInd) matchInd = servOpts.find(o => o.t.includes(jardinSeleccionado.codigo));
                // --- FIN Lógica Automática ---

                if (matchInd) {
                    await selectServicio.selectOption(matchInd.v).catch(()=>{});
                    await page.waitForTimeout(1500);
                    console.log(c.verde(`  ✅ Servicio seleccionado automáticamente (${esAgrupado ? 'Agrupado' : 'Individual'}): ${matchInd.t}`));
                } else if (jardinSeleccionado.manualServicioV && servOpts.some(s => s.v === jardinSeleccionado.manualServicioV)) {
                    await selectServicio.selectOption(jardinSeleccionado.manualServicioV).catch(()=>{});
                    await page.waitForTimeout(1500);
                    console.log(c.verde(`  ✅ Servicio seleccionado automáticamente (recordado): ${jardinSeleccionado.manualServicioT}`));
                } else {
                    console.log(c.cyan('\n  --- SELECCIONA EL SERVICIO ---'));
                    servOpts.forEach((s, i) => console.log(`  ${i + 1}. ${s.t}`));
                    let sIdx = -1;
                    while (sIdx < 0 || sIdx >= servOpts.length) {
                        const res = readline.question(c.negrita('\n  > ESCOJA EL SERVICIO: '));
                        sIdx = parseInt(res, 10) - 1;
                        if (isNaN(sIdx)) sIdx = -1;
                    }
                    jardinSeleccionado.manualServicioV = servOpts[sIdx].v;
                    jardinSeleccionado.manualServicioT = servOpts[sIdx].t;
                    
                    await selectServicio.selectOption(servOpts[sIdx].v).catch(()=>{});
                    await page.waitForTimeout(1500);
                    console.log(c.verde(`  ✅ Servicio seleccionado: ${servOpts[sIdx].t}`));
                }
            } else if (servOpts && servOpts.length === 1) {
                console.log(c.verde(`  ✅ Servicio autoseleccionado: ${servOpts[0].t}`));
            }

            // Seleccionar UDS
            if (jardinSeleccionado.codigo) {
                const selectUds = contentFrame.locator('select[id*="ddlUDS"], select[id*="UDS"], select[id*="Unidad"]').first(); 
                await waitForAndSelect(selectUds, jardinSeleccionado.codigo);
            }
            
            console.log(c.verde(`  ✅ Filtros aplicados. (UDS: ${jardinSeleccionado.nombre})`));

            console.log(c.rojo(c.negrita('\n  ⚠️ IMPORTANTE: Validar el RAM antes de Desvincular')));
            
            // --- Preguntar Fecha y Motivo ---
            const msgFecha = globalFechaRetiro 
                ? `\n  > Fecha de retiro (vacío para mantener ${globalFechaRetiro}): `
                : `\n  > Fecha de retiro (DD/MM/YYYY): `;
            
            const nuevaFecha = readline.question(c.negrita(msgFecha)).trim();
            if (nuevaFecha !== '') {
                globalFechaRetiro = nuevaFecha;
            }
            
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

            const msgMot = globalMotivoId 
                ? `\n  > Selecciona el Motivo de retiro (vacío para mantener "${globalMotivoId}")`
                : `\n  --- SELECCIONA EL MOTIVO DE RETIRO ---`;
            
            if (globalMotivoId) {
                console.log(c.cyan(msgMot));
                const resMot = readline.question(c.negrita(`  > Opcion (vacío para mantener, 'c' para cambiar): `)).trim().toLowerCase();
                if (resMot === 'c') {
                    globalMotivoId = null; // forzar selección nueva
                }
            }

            if (!globalMotivoId) {
                console.log(c.cyan('\n  --- SELECCIONA EL MOTIVO DE RETIRO ---'));
                opcionesMotivo.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
                let sIdxMot = -1;
                while (sIdxMot < 0 || sIdxMot >= opcionesMotivo.length) {
                    const res = readline.question(c.negrita('\n  > Opcion (vacío para "otro"): ')).trim();
                    if (res === '') {
                        sIdxMot = opcionesMotivo.indexOf("otro");
                        break;
                    }
                    sIdxMot = parseInt(res, 10) - 1;
                    if (isNaN(sIdxMot)) sIdxMot = -1;
                }
                globalMotivoId = opcionesMotivo[sIdxMot];
            }
            
            // Ingresar fecha de retiro
            console.log(c.amarillo('  ⏳ Escribiendo Fecha y Motivo...'));
            const inputFechaRetiro = contentFrame.locator('input[type="text"][id*="FechaRetiro"], input[id*="txtFechaRetiro"]').first();
            if (await inputFechaRetiro.count() > 0) {
                await inputFechaRetiro.evaluate((el, val) => {
                    el.value = val;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.blur();
                }, globalFechaRetiro);
                await page.waitForTimeout(1500); // Esperar posible UpdatePanel
            }
            
            // Ingresar motivo de retiro
            const selectMotivo = contentFrame.locator('select[id*="ddlMotivo"], select[id*="Motivo"]').first();
            if (await selectMotivo.count() > 0) {
                let opts = [];
                for(let i=0; i<15; i++) { // Esperar hasta 7.5 segundos a que se habilite tras el UpdatePanel de Fecha
                    const isEnabled = await selectMotivo.evaluate(s => !s.disabled).catch(()=>false);
                    if (isEnabled) {
                        opts = await selectMotivo.evaluate(s => Array.from(s.options).map(o => ({ v: o.value, t: o.text })));
                        if (opts.length > 1) break;
                    }
                    await page.waitForTimeout(500);
                }
                
                const match = opts.find(o => o.t.toUpperCase().includes(globalMotivoId.toUpperCase()));
                if (match) {
                    await selectMotivo.selectOption(match.v).catch(()=>{});
                    await page.waitForTimeout(1000);
                }
            }
            
            // --- Cargar tabla de niños ---
            console.log(c.amarillo('\n  ⏳ Consultando lista de beneficiarios en esta UDS...'));
            const btnConsultarBeneficiario = contentFrame.locator('input[type="submit"][value*="Consultar beneficiario"], input[id*="btnBuscar"]').first();
            if (await btnConsultarBeneficiario.count() > 0) {
                await btnConsultarBeneficiario.click();
                await page.waitForTimeout(3000); // Esperar a que la tabla de niños se llene
            }

            // --- Buscar beneficiario en la tabla y marcar su checkbox ---
            let beneficiarioBuscado = "";
            let encontrado = false;
            
            while (!encontrado) {
                beneficiarioBuscado = readline.question(c.negrita('\n  > Ingresa Documento o Apellido (o "0" para cambiar de Jardin): ')).trim().toUpperCase();
                
                if (beneficiarioBuscado === "0") {
                    break;
                }
                
                const tablaNinos = contentFrame.locator('table[id*="gvBeneficiarios"] tr, table[id*="GridView"] tr');
                const numFilas = await tablaNinos.count();
                
                if (numFilas > 1 && beneficiarioBuscado.length > 0) { 
                    for (let i = 1; i < numFilas; i++) {
                        const fila = tablaNinos.nth(i);
                        const textoFila = await fila.innerText();
                        if (textoFila.toUpperCase().includes(beneficiarioBuscado)) {
                            const checkbox = fila.locator('input[type="checkbox"]').first();
                            if (await checkbox.count() > 0) {
                                await checkbox.check();
                                console.log(c.verde(`  ✅ Se ha marcado el beneficiario que coincide con: ${beneficiarioBuscado}`));
                                encontrado = true;
                                break;
                            }
                        }
                    }
                }
                
                if (!encontrado) {
                    console.log(c.amarillo(`  ⚠️ No se encontró al beneficiario "${beneficiarioBuscado}" en este jardin. Intenta otro nombre o escribe 0 para cambiar de jardin.`));
                }
            }
            
            if (beneficiarioBuscado === "0") {
                jardinSeleccionado = null; // Para que lo vuelva a pedir
                continue;
            }
            // --- GUARDAR DESVINCULACIÓN ---
            console.log(c.amarillo('\n  ⏳ Ejecutando Guardar...'));
            
            const dialogHandler = async dialog => {
                console.log(c.magenta(`  💬 Mensaje de plataforma: ${dialog.message()}`));
                await dialog.accept();
            };
            page.on('dialog', dialogHandler);

            const btnGuardar = contentFrame.locator('a[id*="btnGuardar"], input[id*="btnGuardar"], img[alt="Guardar"]').first();
            if (await btnGuardar.count() > 0) {
                await btnGuardar.click();
                await page.waitForTimeout(4000); // Esperar respuesta del servidor
                
                // Buscar si hay algún mensaje de error o éxito en la pantalla
                const lblMensaje = contentFrame.locator('span[id*="lblMensaje"], span[id*="Mensaje"]').first();
                if (await lblMensaje.count() > 0) {
                    const textoMensaje = await lblMensaje.innerText();
                    if (textoMensaje.trim() !== '') {
                        console.log(c.cyan(`  📌 Resultado: ${textoMensaje}`));
                    }
                }
                
                console.log(c.verde(`  ✅ Se ha completado la desvinculación de ${beneficiarioBuscado}.`));
            } else {
                console.log(c.rojo('  ❌ No se encontró el botón de Guardar.'));
            }
            
            page.off('dialog', dialogHandler);
            // Opciones de qué hacer a continuación
            console.log(c.cyan('\n  ¿Qué deseas hacer ahora?'));
            console.log(`  ${c.cyan('1')}. Hacer otro retiro (mismos filtros)`);
            console.log(`  ${c.cyan('2')}. Cambiar de jardín (mantiene Fecha y Motivo)`);
            console.log(`  ${c.cyan('3')}. Cambiar de asociación`);
            console.log(`  ${c.rojo('0')}. Volver al menú principal`);
            
            const reqSalir = readline.question(c.negrita('  > Opcion: ')).trim();
            if (reqSalir === '0') {
                salirModulo = true;
                bucleRetiro = false;
            } else if (reqSalir === '2') {
                jardinSeleccionado = null;
                // No rompemos bucleRetiro para que pida el jardín y siga en esta pantalla
            } else if (reqSalir === '3') {
                ascSeleccionada = null;
                jardinSeleccionado = null;
                bucleRetiro = false;
            }
        } // fin bucleRetiro
      } catch (err) {
          console.error(c.rojo(`\n❌ Error en el proceso: ${err.message}`));
          console.error(err.stack);
          const recargar = readline.question(c.amarillo('\n¿Deseas volver a seleccionar asociación? (s/n): ')).toLowerCase();
          if (recargar !== 's') {
              salirModulo = true;
          }
      }
  }

  if (browser) await browser.close();
  console.log(c.verde('\n  👋 Módulo finalizado.\n'));
}

if (require.main === module) {
  main().catch(err => console.error('Error no capturado:', err));
}

module.exports = { main };
