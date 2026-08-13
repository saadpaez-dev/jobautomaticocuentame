/**
 * vinculacion-beneficiarios.js
 * Script para registrar nuevos beneficiarios en Cuéntame.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const readline = require('readline-sync');
const { loginYLlegarARoles, seleccionarRolYEntrar, obtenerNavegador, verificarConexionOCaida, validarYCambiarAsociacion } = require('../servicios/autenticacion');
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
  console.log(c.cyan('   ➕ VINCULACIÓN DE BENEFICIARIOS (NUEVO REGISTRO)'));
  console.log(c.cyan('======================================================\n'));
  
  let browser = null;
  let context = null;
  let page = null;
  let loggedIn = false;

  let salirModulo = false;

  let ascSeleccionada = null;

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
            break;
          }

          ascSeleccionada = asociaciones[idxAsociacion - 1];
      }

      // --- 2. Selección de Jardín (UDS) ---
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
          ascSeleccionada = null;
          continue; // volver a seleccionar asociación
      }

      const jardinSeleccionado = jardinesAsociacion[idxJardin - 1];

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
            // Dar tiempo a que el navegador termine de cargar si nos acabamos de conectar
            await page.waitForTimeout(1000);
            
            const isSessionLost = await verificarConexionOCaida(page);
            
            const mismaAsociacion = await validarYCambiarAsociacion(page, ascSeleccionada);
            if (!mismaAsociacion) {
                console.log(c.amarillo('  🔐 Verificando inicio de sesión en Cuéntame...'));
                await loginYLlegarARoles(page, {
                  usuario: USUARIO,
                  password: PASSWORD,
                  gmailUser: GMAIL_USER,
                  gmailAppPassword: GMAIL_APP_PASSWORD
                });
                loggedIn = true;
                console.log(c.amarillo(`  🏢 Seleccionando la asociación ${ascSeleccionada.nombreCorto}...`));
                await seleccionarRolYEntrar(page, ascSeleccionada);
            } else {
                console.log(c.verde(`  ✅ Preservando sesión y asociación activa: "${ascSeleccionada.nombreCorto}".`));
                loggedIn = true;
            }
        } else {
            await page.goto('https://rubonline.icbf.gov.co/DefaultF.aspx', { waitUntil: 'domcontentloaded' });
            
            // Verificar si al forzar la redirección nos mandó al login por timeout
            await page.waitForTimeout(1000);
            if (await verificarConexionOCaida(page)) {
                console.log(c.amarillo('  ⚠️ La sesión expiró. Reiniciando login (2FA)...'));
                await loginYLlegarARoles(page, {
                  usuario: USUARIO,
                  password: PASSWORD,
                  gmailUser: GMAIL_USER,
                  gmailAppPassword: GMAIL_APP_PASSWORD
                });
                console.log(c.verde('  ✅ Login restaurado exitosamente.'));
            }
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

        const recargarPaginaBeneficiario = async () => {
            console.log(c.cyan('  🚀 Navegando al módulo de Beneficiarios...'));
            try {
                const links = await rootMenu.locator('a:text-is("Beneficiario")').all();
                if (links.length >= 2) {
                    await links[1].evaluate(n => n.click());
                } else if (links.length === 1) {
                    await links[0].evaluate(n => n.click());
                    await page.waitForTimeout(500);
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
        };

        // Navegación inicial
        await recargarPaginaBeneficiario();

        let frame = page.frame({ name: 'frameContent' });
        if (!frame) {
            for (const f of page.frames()) {
                if (f.name() === 'frameContent') {
                    frame = f;
                    break;
                }
            }
        }
        if (!frame) frame = page;

        let forceMenuClick = false;
        let docRecuperacion = null;

        // Bucle interactivo para ingresar niños en el mismo jardín
        while (true) {
            // Verificar si la sesión se cerró por inactividad
            if (await verificarConexionOCaida(page)) {
                console.log(c.rojo('  ⚠️ Se ha detectado que la sesión expiró (Timeout).'));
                loggedIn = false;
                break; // Romper bucle interno para que el bucle externo vuelva a iniciar sesión
            }

            if (forceMenuClick) {
                await recargarPaginaBeneficiario();
                forceMenuClick = false;
            }

            console.log(c.cyan('\n------------------------------------------------------'));
            console.log(c.amarillo(`  Jardín actual: ${jardinSeleccionado.nombre}`));
            console.log(c.amarillo('  [1] Ingresar nuevo beneficiario'));
            console.log(c.amarillo('  [R] Recargar página (si hubo error de conexión)'));
            console.log(c.amarillo('  [0] Volver a selección de Jardín'));
            console.log(c.rojo('  [M] Volver al menú principal (npm start)'));
            
            const accion = readline.question(c.negrita('\n  > Tu opcion: ')).trim().toUpperCase();

            if (accion === 'M') {
                salirModulo = true;
                break;
            }
            if (accion === '0') {
                break; // Vuelve al loop de selección de jardín/asociación
            }
            if (accion === 'R') {
                forceMenuClick = true;
                continue;
            }
            if (accion !== '1') {
                continue;
            }

            console.log(c.gris(`\n  📝 Preparando formulario...`));
            
            // Re-evaluar el frame por si acaso
            let currentFrame = page.frame({ name: 'frameContent' });
            if (!currentFrame) {
                for (const f of page.frames()) {
                    if (f.name() === 'frameContent') {
                        currentFrame = f;
                        break;
                    }
                }
            }
            if (!currentFrame) currentFrame = page;

            // Clic en "(+) Nuevo"
            let isSearchMode = true;
            for (let attempt = 0; attempt < 3; attempt++) {
                let btnNuevo = currentFrame.locator('#btnNuevo, a[id*="btnNuevo"], img[alt*="Nuevo"], input[src*="Nuevo"]').first();
                
                if (await btnNuevo.count() > 0) {
                    if (attempt > 0) console.log(c.amarillo(`  ⏳ Reintentando presionar botón (+) Nuevo (Intento ${attempt + 1})...`));
                    
                    // Asegurar que el elemento es interactuable
                    await btnNuevo.scrollIntoViewIfNeeded().catch(()=>{});
                    await page.waitForTimeout(500); // Pequeña pausa para asegurar eventos ASP.NET
                    
                    await btnNuevo.click({ force: true });
                    
                    // Esperar a que la página cambie a modo de creación
                    for (let i = 0; i < 15; i++) {
                        await page.waitForTimeout(300);
                        currentFrame = page.frame({ name: 'frameContent' }) || page;
                        // En modo creación hay más de 5 inputs de texto (nombres, apellidos, etc.)
                        const txtCount = await currentFrame.locator('input[type="text"]').count();
                        if (txtCount > 5) {
                            isSearchMode = false;
                            break;
                        }
                    }
                    if (!isSearchMode) break;
                } else {
                    console.log(c.rojo('  ❌ No se encontró el botón Nuevo (+). ¿Estás seguro que la página cargó?'));
                    break;
                }
            }

            if (isSearchMode) {
                console.log(c.rojo('  ⚠️ El formulario no cambió a modo Creación tras varios intentos. Abortando ingreso para evitar sobreescribir la búsqueda.'));
                continue;
            }

            // === SECCIÓN BENEFICIARIO ===
            console.log(c.cyan('\n  --- Datos del Beneficiario ---'));
            
            // Tipo de beneficiario (Auto-select)
            const selectTipoBenef = currentFrame.locator('select[id*="Beneficiario"], select').filter({ hasText: 'NIÑO O NIÑA' }).first();
            const waitForAndSelect = async (selectLocator, textToMatch = null) => {
                if (await selectLocator.count() === 0) return null;
                let opts = [];
                let match = null;
                const removeAccents = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[,.]/g, "").replace(/\s+/g, " ").trim();

                for(let i=0; i<20; i++) { // Esperar hasta 10 segundos
                    const isEnabled = await selectLocator.evaluate(s => !s.disabled).catch(()=>false);
                    if (isEnabled) {
                        const raw = await selectLocator.evaluate(s => Array.from(s.options).map(o => ({ v: o.value, t: o.text }))).catch(()=>[]);
                        opts = raw.filter(o => o.v && o.v !== "0" && o.v !== "-1" && !o.t.toUpperCase().includes('SELECCIONE'));
                        
                        if (textToMatch) {
                            const cleanTarget = removeAccents(textToMatch.toUpperCase());
                            
                            // 1. Priorizar coincidencia EXACTA
                            match = opts.find(o => removeAccents(o.t.toUpperCase()) === cleanTarget || o.v === cleanTarget);
                            
                            // 2. Si no hay coincidencia exacta, usar coincidencia parcial (includes)
                            if (!match) {
                                match = opts.find(o => removeAccents(o.t.toUpperCase()).includes(cleanTarget) || o.v.includes(cleanTarget));
                            }
                            
                            // 3. Fallback inteligente si no hay coincidencia parcial pero hay opciones válidas en el select
                            if (!match && opts.length > 0) {
                                console.log(c.amarillo(`  ℹ️ Contrato/Opción "${textToMatch}" no tiene coincidencia exacta. Seleccionando la opción disponible: "${opts[0].t}"`));
                                match = opts[0];
                            }
                            
                            if (match) break; 
                        } else if (opts.length > 0) {
                            match = opts[0];
                            break;
                        }
                    }
                    await page.waitForTimeout(200);
                }
                
                if (textToMatch && !match) {
                    console.log(`  ⚠️ No se encontró la opción "${textToMatch}" tras esperar.`);
                    console.log(`     Opciones disponibles: ${opts.map(o => o.t).join(' | ')}`);
                    return opts;
                }

                if (opts.length === 0) return opts;
                
                if (textToMatch && match) {
                    const currentVal = await selectLocator.inputValue().catch(()=>null);
                    if (currentVal !== match.v) {
                        const hasPostback = await selectLocator.evaluate(el => {
                            const oc = el.getAttribute('onchange');
                            return oc && oc.includes('doPostBack');
                        }).catch(() => false);

                        let postPromise = null;
                        if (hasPostback) {
                            postPromise = page.waitForResponse(resp => resp.request().method() === 'POST', { timeout: 8000 }).catch(() => {});
                        }
                        
                        await selectLocator.selectOption(match.v, { force: true }).catch(e => console.log(c.rojo(`  ❌ Error selectOption: ${e.message}`)));
                        await selectLocator.evaluate(el => {
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        }).catch(() => {});
                        
                        if (postPromise) {
                            await postPromise;
                            await page.waitForTimeout(500); // Margen extra de seguridad tras POST
                        } else {
                            await page.waitForTimeout(200); // Ligero respiro si no hay POST
                        }
                    }
                    return opts;
                }
                
                if (opts.length === 1 && !textToMatch) {
                    const currentVal = await selectLocator.inputValue().catch(()=>null);
                    if (currentVal !== opts[0].v) {
                        await selectLocator.selectOption(opts[0].v).catch(()=>{});
                        await selectLocator.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true }))).catch(() => {});
                        await page.waitForTimeout(3000);
                    }
                    return opts;
                }
                return opts;
            };
            // Área misional: Dirección de Primera Infancia
            const selectArea = currentFrame.locator('select').filter({ hasText: 'Primera Infancia' }).first();
            if (await selectArea.count() > 0) {
                await selectArea.selectOption({ label: 'Dirección de Primera Infancia' }).catch(()=>{});
                await page.waitForTimeout(500);
            }

            // Vigencia
            let vigenciaStr = ascSeleccionada.vigenciaContrato || new Date().getFullYear().toString();
            const selectVigencia = currentFrame.locator('select').filter({ hasText: vigenciaStr }).first();
            if (await selectVigencia.count() > 0) {
                await selectVigencia.selectOption({ label: vigenciaStr }).catch(()=>{});
                await page.waitForTimeout(500);
            }

            // Regional
            const selectRegional = currentFrame.locator('select[id*="ddlRegional"], select[id*="Regional"]').first();
            await waitForAndSelect(selectRegional, 'Bogota D.C.');

            // Contrato
            const selectContrato = currentFrame.locator('select[id*="ddlContrato"], select[id*="Contrato"]').first();
            await waitForAndSelect(selectContrato, ascSeleccionada.numeroContrato);

            // Servicio
            const selectServicio = currentFrame.locator('select[id*="ddlServicio"], select[id*="Servicio"]').first();
            const servOpts = await waitForAndSelect(selectServicio);
            if (servOpts && servOpts.length > 1) {
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
                    if (!matchInd) matchInd = servOpts.find(o => !o.t.toUpperCase().includes("JARDÍN COMUNITARIO") && !o.t.toUpperCase().includes("JARDIN COMUNITARIO"));
                }
                
                if (!matchInd) matchInd = servOpts.find(o => o.t.includes(jardinSeleccionado.codigo));
                
                if (matchInd) {
                    await waitForAndSelect(selectServicio, matchInd.t);
                }
            }

            // Seleccionar UDS Automáticamente
            const selectUDS = currentFrame.locator('select[id*="ddlUDS"], select[id*="Uds"]').first();
            await waitForAndSelect(selectUDS, jardinSeleccionado.codigo);

            await waitForAndSelect(selectTipoBenef, 'NIÑO O NIÑA ENTRE 6 MESES Y 5 AÑOS Y 11 MESES');

            // Tipo de Documento (Interactive)
            const opcionesDoc = [
                "SIN DOCUMENTO",
                "REGISTRO CIVIL",
                "PERMISO POR PROTECCIÓN TEMPORAL",
                "PERMISO ESPECIAL DE PERMANENCIA",
                "PASAPORTE",
                "PARTIDA O ACTA DE NACIMIENTO"
            ];
            // --- CUESTIONARIO INTERACTIVO CON NAVEGACIÓN HACIA ATRÁS ---
            console.log(c.cyan('\n  📝 INGRESO DE DATOS DEL BENEFICIARIO'));
            console.log(c.gris('  💡 Tip: Presiona ENTER/TAB para avanzar o escribe "<" / "b" (retroceso) para corregir el dato anterior.\n'));

            let datosNino = {
                idxDoc: 1, // Registro civil por defecto
                docNum: docRecuperacion ? docRecuperacion.docNum : '',
                pNombre: '',
                sNombre: '',
                pApellido: '',
                sApellido: '',
                fechaNac: '',
                sexo: 'Hombre'
            };

            const isGoBack = (v) => {
                if (!v) return false;
                const str = v.trim().toLowerCase();
                return str === '<' || str === 'b' || str === 'back' || str === '-' || str === 'retroceso' || str === 'sup';
            };

            let paso = docRecuperacion ? 2 : 0; // Si recuperamos doc, empezamos en Primer Nombre

            while (paso >= 0 && paso <= 7) {
                if (paso === 0) {
                    console.log(c.cyan('  --- TIPO DE DOCUMENTO ---'));
                    opcionesDoc.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
                    const defLabel = opcionesDoc[datosNino.idxDoc] || 'REGISTRO CIVIL';
                    const res = readline.question(c.negrita(`\n  > Selecciona Tipo de Documento (Enter/Tab para ${defLabel}): `)).trim();
                    if (isGoBack(res)) {
                        paso = 0;
                    } else {
                        if (res !== '') {
                            const parsed = parseInt(res, 10) - 1;
                            if (!isNaN(parsed) && parsed >= 0 && parsed < opcionesDoc.length) {
                                datosNino.idxDoc = parsed;
                            }
                        }
                        paso++;
                    }
                } else if (paso === 1) {
                    const hint = datosNino.docNum ? ` [actual: ${datosNino.docNum}]` : '';
                    const res = readline.question(c.negrita(`  > Numero de Documento${hint}: `)).trim();
                    if (isGoBack(res)) {
                        paso--;
                    } else {
                        if (res !== '') datosNino.docNum = res;
                        if (!datosNino.docNum) {
                            console.log(c.rojo('  ❌ El número de documento es obligatorio.'));
                        } else {
                            docRecuperacion = { idxDoc: datosNino.idxDoc, docNum: datosNino.docNum };
                            paso++;
                        }
                    }
                } else if (paso === 2) {
                    const hint = datosNino.pNombre ? ` [actual: ${datosNino.pNombre}]` : '';
                    const res = readline.question(c.negrita(`  > Primer Nombre${hint}: `)).trim().toUpperCase();
                    if (isGoBack(res)) {
                        paso--;
                    } else {
                        if (res !== '') datosNino.pNombre = res;
                        if (!datosNino.pNombre) {
                            console.log(c.rojo('  ❌ El primer nombre es obligatorio.'));
                        } else {
                            paso++;
                        }
                    }
                } else if (paso === 3) {
                    const hint = datosNino.sNombre ? ` [actual: ${datosNino.sNombre}]` : '';
                    const res = readline.question(c.negrita(`  > Segundo Nombre${hint} (Vacio para omitir): `)).trim().toUpperCase();
                    if (isGoBack(res)) {
                        paso--;
                    } else {
                        if (res !== '') datosNino.sNombre = res;
                        paso++;
                    }
                } else if (paso === 4) {
                    const hint = datosNino.pApellido ? ` [actual: ${datosNino.pApellido}]` : '';
                    const res = readline.question(c.negrita(`  > Primer Apellido${hint}: `)).trim().toUpperCase();
                    if (isGoBack(res)) {
                        paso--;
                    } else {
                        if (res !== '') datosNino.pApellido = res;
                        if (!datosNino.pApellido) {
                            console.log(c.rojo('  ❌ El primer apellido es obligatorio.'));
                        } else {
                            paso++;
                        }
                    }
                } else if (paso === 5) {
                    const hint = datosNino.sApellido ? ` [actual: ${datosNino.sApellido}]` : '';
                    const res = readline.question(c.negrita(`  > Segundo Apellido${hint} (Vacio para omitir): `)).trim().toUpperCase();
                    if (isGoBack(res)) {
                        paso--;
                    } else {
                        if (res !== '') datosNino.sApellido = res;
                        paso++;
                    }
                } else if (paso === 6) {
                    const hint = datosNino.fechaNac ? ` [actual: ${datosNino.fechaNac}]` : '';
                    const res = readline.question(c.negrita(`  > Fecha Nacimiento (DD/MM/YYYY)${hint}: `)).trim();
                    if (isGoBack(res)) {
                        paso--;
                    } else {
                        const valProbada = res !== '' ? res : datosNino.fechaNac;
                        const esValida = (str) => {
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

                        if (!esValida(valProbada)) {
                            console.log(c.rojo('  ❌ Formato de fecha no válido. Debe tener el formato DD/MM/YYYY (ej: 19/04/2021 o 19042021).'));
                        } else {
                            if (/^\d{8}$/.test(valProbada)) {
                                datosNino.fechaNac = `${valProbada.substring(0,2)}/${valProbada.substring(2,4)}/${valProbada.substring(4,8)}`;
                            } else {
                                datosNino.fechaNac = valProbada;
                            }
                            paso++;
                        }
                    }
                } else if (paso === 7) {
                    const hint = ` [actual: ${datosNino.sexo}]`;
                    const res = readline.question(c.negrita(`  > Sexo (1: Hombre, 2: Mujer)${hint}: `)).trim();
                    if (isGoBack(res)) {
                        paso--;
                    } else {
                        if (res === '2' || res.toLowerCase() === 'm' || res.toLowerCase() === 'mujer') {
                            datosNino.sexo = 'Mujer';
                        } else if (res === '1' || res.toLowerCase() === 'h' || res.toLowerCase() === 'hombre') {
                            datosNino.sexo = 'Hombre';
                        }
                        paso++;
                    }
                }
            }

            const tipoDocId = opcionesDoc[datosNino.idxDoc];
            const docNum = datosNino.docNum;
            const pNombre = datosNino.pNombre;
            const sNombre = datosNino.sNombre;
            const pApellido = datosNino.pApellido;
            const sApellido = datosNino.sApellido;
            const fechaNac = datosNino.fechaNac;
            const sexo = datosNino.sexo;

            const selectTipoDoc = currentFrame.locator('select').filter({ hasText: 'REGISTRO CIVIL' }).first();
            if (await selectTipoDoc.count() > 0) {
                await selectTipoDoc.selectOption({ label: tipoDocId }).catch(()=>{});
                await page.waitForTimeout(500);
            }

            // Número de documento
            const inputDoc = currentFrame.locator('input[type="text"]').first(); 
            const btnLupa = currentFrame.locator('input[type="image"][src*="icoPagBuscar"], input[id*="btnBuscar"]').first();
            
            if (await inputDoc.count() > 0) {
                await inputDoc.fill(docNum);
            }

            let continuarLlenado = true;
            let ninoExiste = false;
            let textInputs = [];

            // Damos click en la lupa para validar el documento
            console.log(c.amarillo('  ⏳ Validando Documento (Lupa)...'));
            if (await btnLupa.count() > 0) {
                const postPromise = page.waitForResponse(resp => resp.request().method() === 'POST', { timeout: 5000 }).catch(() => {});
                await btnLupa.click();
                await postPromise;
                await page.waitForTimeout(500);
            }

            textInputs = await currentFrame.locator('input[type="text"]').all();
            
            let docIndex = await currentFrame.evaluate((docNumVal) => {
                const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
                for (let i = 0; i < inputs.length; i++) {
                    const val = (inputs[i].value || '').replace(/\D/g, '');
                    const cleanDocNum = docNumVal.replace(/\D/g, '');
                    if (val.length >= 6 && (val === cleanDocNum || cleanDocNum.startsWith(val))) {
                        return i;
                    }
                }
                return -1;
            }, docNum);

            let inputPNombre = null, inputSNombre = null, inputPApellido = null, inputSApellido = null, inputFechaNac = null;
            if (docIndex !== -1 && docIndex + 5 < textInputs.length) {
                inputPNombre = textInputs[docIndex + 1];
                inputSNombre = textInputs[docIndex + 2];
                inputPApellido = textInputs[docIndex + 3];
                inputSApellido = textInputs[docIndex + 4];
                inputFechaNac = textInputs[docIndex + 5];
            }

            // Verificar si se autocompletaron los datos (Escenario 1)
            if (inputPNombre) {
                const valPNombre = await inputPNombre.inputValue().catch(()=>'');
                if (valPNombre && valPNombre.trim() !== '') {
                    ninoExiste = true;
                    const pN = await inputPNombre.inputValue();
                    const sN = await inputSNombre.inputValue();
                    const pA = await inputPApellido.inputValue();
                    const sA = await inputSApellido.inputValue();
                    console.log(c.verde(`  ✅ ¡El niño ya está creado en el sistema!`));
                    console.log(c.cyan(`     Datos recuperados: ${pN} ${sN} ${pA} ${sA}`.replace(/\s+/g, ' ')));
                }
            }

            if (continuarLlenado) {
                if (!ninoExiste) {
                    if (inputPNombre) {
                        await inputPNombre.fill(pNombre);
                        await inputSNombre.fill(sNombre);
                        await inputPApellido.fill(pApellido);
                        await inputSApellido.fill(sApellido);
                        
                        const fechaNacLimpia = fechaNac.replace(/\D/g, '');
                        await inputFechaNac.evaluate(el => { el.value = ''; });
                        await inputFechaNac.focus();
                        await inputFechaNac.pressSequentially(fechaNacLimpia, { delay: 150 });
                        
                        const nacPostPromise = page.waitForResponse(resp => resp.request().method() === 'POST', { timeout: 6000 }).catch(() => {});
                        await inputFechaNac.press('Tab');
                        await nacPostPromise;
                        await page.waitForTimeout(500);

                    } else {
                        console.log(c.rojo('  ⚠️ No se encontraron los inputs de texto (No se encontró el Documento como ancla). Verifica la pantalla.'));
                    }

                    // Sexo
                    const selectSexo = currentFrame.locator('select').filter({ hasText: 'Hombre' }).last();
                    if (await selectSexo.count() > 0) {
                        await selectSexo.selectOption({ label: sexo }).catch(()=>{});
                        await page.waitForTimeout(500);
                    }
                } else {
                    // Si ya existe, tratamos de leer el sexo del dropdown para saber qué foto subir
                    const selectSexo = currentFrame.locator('select').filter({ hasText: 'Hombre' }).last();
                    if (await selectSexo.count() > 0) {
                        const textoSexo = await selectSexo.evaluate(s => s.options[s.selectedIndex]?.text || '');
                        if (textoSexo.toUpperCase().includes('MUJER') || textoSexo.toUpperCase().includes('FEMENINO')) {
                            sexo = 'Mujer';
                        }
                    }
                }

                // Foto (SE HACE SIEMPRE, exista o no)
                console.log(c.amarillo(`  ⏳ Validando/Cargando foto de perfil (${sexo})...`));
                const inputFile = currentFrame.locator('input[type="file"]').first();
                const photoName = sexo === 'Mujer' ? 'niña.jpg' : 'niño.jpg';
                const photoPath = path.join('C:\\Dev\\jobautomatico\\docs', photoName);
                
                if (await inputFile.count() > 0) {
                    try {
                        await inputFile.setInputFiles(photoPath);
                        const btnCargarFoto = currentFrame.locator('input[type="submit"][value="Cargar foto"], input[id*="btnCargar"]').first();
                        if (await btnCargarFoto.count() > 0) {
                            await btnCargarFoto.evaluate(el => {
                                if (typeof Sys !== 'undefined' && Sys.WebForms && Sys.WebForms.PageRequestManager) {
                                    var prm = Sys.WebForms.PageRequestManager.getInstance();
                                    if (!window.__MiBotHandler2) {
                                        window.__MiBotHandler2 = function() { window.__pbHecho2 = true; };
                                        prm.add_endRequest(window.__MiBotHandler2);
                                    }
                                    window.__pbHecho2 = false;
                                }
                                el.click();
                            });
                            
                            // Esperar dinámicamente hasta que responda
                            for (let i = 0; i < 50; i++) {
                                const isDone = await page.evaluate(() => {
                                    if (typeof Sys === 'undefined' || !Sys.WebForms || !Sys.WebForms.PageRequestManager) return true;
                                    var prm = Sys.WebForms.PageRequestManager.getInstance();
                                    return window.__pbHecho2 || !prm.get_isInAsyncPostBack();
                                }).catch(()=>true);
                                if (isDone) break;
                                await page.waitForTimeout(100);
                            }
                            console.log(c.verde(`  ✅ Foto cargada automáticamente (${photoName}).`));
                        }
                    } catch (e) {
                        console.log(c.rojo(`  ❌ Error al cargar la foto: ${e.message}`));
                    }
                } else {
                    console.log(c.rojo('  ❌ No se encontró el campo para subir archivo.'));
                }

                // Campos adicionales
                let paisNac = 'COLOMBIA';
                let deptoNac = 'BOGOTA D.C.';
                let muniNac = 'BOGOTA D.C.';
                
                if (!ninoExiste) {
                    paisNac = readline.question('\n  > Pais Nacimiento [COLOMBIA]: ').trim().toUpperCase() || 'COLOMBIA';
                    deptoNac = readline.question('  > Departamento Nacimiento [BOGOTA D.C.]: ').trim().toUpperCase() || 'BOGOTA D.C.';
                    muniNac = readline.question('  > Municipio Nacimiento [BOGOTA D.C.]: ').trim().toUpperCase() || 'BOGOTA D.C.';
                }
                
                const d = new Date();
                const defaultFechaAtencion = `01/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
                let fechaAtencion = "";
                while (!fechaAtencion) {
                    fechaAtencion = readline.question(`  > Fecha de atencion (DD/MM/YYYY) [${defaultFechaAtencion}]: `).trim();
                    if (!fechaAtencion) fechaAtencion = defaultFechaAtencion;
                }
                const discapacidad = 'No'; // Fijo por solicitud del usuario


                    console.log(c.amarillo('  ⏳ Llenando campos de Nacimiento...'));
                    
                    if (!ninoExiste) {
                        const selPais = currentFrame.locator('select[id*="Pais"][id*="Nacimiento"], select[id*="ddlPaisNacimiento"]').first();
                        await selPais.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
                        if (await selPais.count() > 0) {
                            await waitForAndSelect(selPais, paisNac);
                        } else {
                            console.log(c.rojo('  ⚠️ No se encontró el desplegable de País Nacimiento (revisar locator).'));
                        }

                        const selDepto = currentFrame.locator('select[id*="Departamento"], select[id*="Depto"]').first();
                        await selDepto.waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
                        if (await selDepto.count() > 0) await waitForAndSelect(selDepto, deptoNac);

                        const selMuni = currentFrame.locator('select[id*="Municipio"], select[id*="Muni"]').first();
                        await selMuni.waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
                        if (await selMuni.count() > 0) await waitForAndSelect(selMuni, muniNac);
                    }

                    console.log(c.amarillo('  ⏳ Buscando campo Fecha de Atención...'));
                    const txtFechaAtencion = currentFrame.locator('input[type="text"][id*="txtFechaAtencion"], input[id*="FechaAtencion"]').first();
                    
                    // Esperar activamente a que el campo aparezca (hasta 5 segundos) por si el DOM de Cuéntame sigue renderizando
                    await txtFechaAtencion.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
                    
                    const countAtencion = await txtFechaAtencion.count();
                    console.log(`  🔍 Elementos encontrados: ${countAtencion}`);
                    if (countAtencion > 0) {
                        const isEnabled = await txtFechaAtencion.isEnabled().catch(()=>false);
                        const isEditable = await txtFechaAtencion.isEditable().catch(()=>false);
                        console.log(`  🔍 Estado del campo: enabled=${isEnabled}, editable=${isEditable}`);
                        
                        if (!isEditable) {
                            console.log(c.amarillo('  ⚠️ Forzando campo a editable (removiendo readonly/disabled)...'));
                            await txtFechaAtencion.evaluate(el => {
                                el.removeAttribute('readonly');
                                el.removeAttribute('disabled');
                            });
                        }

                        const fechaAtencionLimpia = fechaAtencion.replace(/\D/g, '');
                        console.log(`  🖋️ Escribiendo: ${fechaAtencionLimpia}`);
                        
                        // Limpiar y escribir como humano
                        await txtFechaAtencion.evaluate(el => { el.value = ''; }).catch(e => console.log('  ❌ Error evaluate:', e.message));
                        await txtFechaAtencion.focus().catch(e => console.log('  ❌ Error focus:', e.message));
                        await txtFechaAtencion.pressSequentially(fechaAtencionLimpia, { delay: 150 }).catch(e => console.log('  ❌ Error press:', e.message));
                        
                        // Al salir de la casilla (blur), Cuéntame hace una validación por POST
                        console.log('  ⏳ Esperando validación POST...');
                        const datePostPromise = page.waitForResponse(resp => resp.request().method() === 'POST', { timeout: 6000 }).catch(() => console.log('  ⚠️ No hubo POST.'));
                        await txtFechaAtencion.press('Tab').catch(e => console.log('  ❌ Error tab:', e.message));
                        await datePostPromise;
                        console.log('  ✅ Validación completada.');
                        await page.waitForTimeout(500);
                    } else {
                        console.log(c.rojo('  ⚠️ No se encontró la casilla de Fecha de Atención.'));
                        // DUMP de todos los inputs en pantalla para diagnosticar:
                        const allInputs = await currentFrame.evaluate(() => {
                            return Array.from(document.querySelectorAll('input[type="text"]')).map(el => ({ id: el.id, val: el.value }));
                        }).catch(()=>[]);
                        console.log(c.gris('  🔎 [DIAGNÓSTICO] Inputs de texto disponibles en pantalla:'));
                        allInputs.forEach(inp => console.log(c.gris(`     - ID: ${inp.id} | Valor actual: ${inp.val}`)));
                    }

                    const selDiscap = currentFrame.locator('select[id*="ddlDiscapacidad"], select[id*="PresentaDiscapacidad"]').first();
                    if (await selDiscap.count() > 0) await waitForAndSelect(selDiscap, discapacidad);

                if (tipoDocId === 'PARTIDA O ACTA DE NACIMIENTO') {
                    // Si es partida de nacimiento, damos click en la lupa AHORA (al final)
                    console.log(c.amarillo('  ⏳ Validando Partida de Nacimiento (Lupa)...'));
                    if (await imgLupa.count() > 0) {
                        await imgLupa.click();
                        await page.waitForTimeout(3000); 
                    }
                    
                    // Esperar a que el UpdatePanel responda (Check verde o campo de error)
                    await page.waitForTimeout(2000); // 2 segundos para el postback inicial
                }

                console.log(c.amarillo('\n  ⏳ Ejecutando Guardar automáticamente...'));
                    
                    const dialogHandler = async dialog => {
                        console.log(c.magenta(`  💬 Mensaje de plataforma: ${dialog.message()}`));
                        await dialog.accept();
                    };
                    page.on('dialog', dialogHandler);

                    const btnGuardar = currentFrame.locator('a[id*="btnGuardar"], img[alt="Guardar"]').first();
                    if (await btnGuardar.count() > 0) {
                        await btnGuardar.click();
                        await page.waitForTimeout(4000); // Esperar respuesta del servidor
                        
                        // Refrescar frame después del PostBack
                        currentFrame = page.frame({ name: 'frameContent' }) || page;
                        
                        let guardadoExitoso = true; // Asumir éxito a menos que veamos un error
                        const pageText = await currentFrame.evaluate(() => document.body.innerText).catch(()=>'');
                        
                        if (pageText.toLowerCase().includes('temporalmente') || pageText.toLowerCase().includes('éxito') || pageText.toLowerCase().includes('exito')) {
                            console.log(c.cyan(`  📌 Resultado: Guardado exitoso detectado.`));
                            guardadoExitoso = true;
                        } else if (pageText.toLowerCase().includes('error') || pageText.toLowerCase().includes('excepción')) {
                            console.log(c.rojo(`  ⚠️ Resultado: Posible error detectado en pantalla.`));
                            guardadoExitoso = false;
                        } else {
                            console.log(c.cyan(`  📌 Resultado: Guardado ejecutado (sin mensaje explícito).`));
                        }

                        if (guardadoExitoso) {
                            console.log(c.verde(`  ✅ Se ha completado el guardado de Datos Básicos.`));
                            console.log(c.amarillo('\n  ⏳ Procediendo a llenar Datos de Ubicación...'));
                            
                            const tabDatosGeo = currentFrame.locator('a[id*="tbnDatosGeo_tab"], span:has-text("Datos de Ubicación")').first();
                            if (await tabDatosGeo.count() > 0) {
                                await tabDatosGeo.click();
                                await page.waitForTimeout(2500); // Esperar que renderice la pestaña
                                
                                console.log(c.gris('     - Llenando valores fijos predeterminados (modo humano para evitar colisión de UpdatePanel)...'));

                                await waitForAndSelect(currentFrame.locator('select[id*="tbnDatosGeo"][id*="Pais"]').first(), "COLOMBIA");
                                await waitForAndSelect(currentFrame.locator('select[id*="tbnDatosGeo"][id*="Departamento"], select[id*="tbnDatosGeo"][id*="Depto"]').first(), "BOGOTA D.C.");
                                await waitForAndSelect(currentFrame.locator('select[id*="tbnDatosGeo"][id*="Municipio"]').first(), "BOGOTA D.C.");
                                await waitForAndSelect(currentFrame.locator('select[id*="tbnDatosGeo"][id*="Zona"]').first(), "CABECERA");
                                await waitForAndSelect(currentFrame.locator('select[id*="tbnDatosGeo"][id*="CentroPoblado"]').first(), "BOGOTA D.C.");
                                await waitForAndSelect(currentFrame.locator('select[id*="tbnDatosGeo"][id*="TipoCabecera"]').first(), "LOCALIDAD");
                                await waitForAndSelect(currentFrame.locator('select[id*="tbnDatosGeo"][id*="Comuna"], select[id*="tbnDatosGeo"][id*="Localidad"]').first(), "LOCALIDAD USAQUEN");
                                
                                let barrioDefecto = "";
                                const nombreAsc = ascSeleccionada.nombreCorto.toUpperCase();
                                if (nombreAsc.includes("VERBENAL")) barrioDefecto = "EL VERBENAL";
                                else if (nombreAsc.includes("CANAIMA")) barrioDefecto = "CANAIMA";
                                else if (nombreAsc.includes("BRISAS")) barrioDefecto = "CHAPARRAL";
                                else if (nombreAsc.includes("BUENAVISTA")) barrioDefecto = "BUENAVISTA";
                                else if (nombreAsc.includes("BARRIOS UNIDOS")) barrioDefecto = "BARRANCAS";
                                else if (nombreAsc.includes("PROGRESO")) barrioDefecto = "CERRO NORTE";
                                else if (nombreAsc.includes("DELICIAS")) barrioDefecto = "LAS DELICIAS DEL CARMEN";

                                if (barrioDefecto) {
                                    console.log(c.gris(`     - Seleccionando Barrio para ${ascSeleccionada.nombreCorto}: ${barrioDefecto}`));
                                    await waitForAndSelect(currentFrame.locator('select[id*="tbnDatosGeo"][id*="Barrio"]').first(), barrioDefecto);
                                } else {
                                    console.log(c.amarillo(`  ⚠️ No se determinó Barrio automático para la asociación ${ascSeleccionada.nombreCorto}.`));
                                }

                                console.log(c.amarillo('\n  🏠 Por favor, ingresa los Datos de Direccion de Residencia:'));
                                const direccionCompleta = readline.question('  > Direccion Completa (Ej: cr 7 c 181 a 39 o calle 45 sur 12 80): ').trim();
                                
                                // Parser inteligente de direccion
                                const tokens = direccionCompleta.toUpperCase().replace(/-/g, ' ').split(/\s+/).filter(t => t);
                                let dirTipoVia='', dirNumVia='', dirLetra='', dirBis='', dirSentido='', dirNumSec='', dirLetraSec='', dirPlaca='', dirSentido2='';
                                
                                if (tokens.length > 0) {
                                    const t = tokens.shift();
                                    if (['C','CL','CALLE'].includes(t)) dirTipoVia = 'CALLE';
                                    else if (['K','KR','CRA','CR','CARRERA'].includes(t)) dirTipoVia = 'CARRERA';
                                    else if (['D','DG','DIAG','DIAGONAL'].includes(t)) dirTipoVia = 'DIAGONAL';
                                    else if (['T','TV','TRANS','TRANSVERSAL'].includes(t)) dirTipoVia = 'TRANSVERSAL';
                                    else if (['AV','AVENIDA'].includes(t)) dirTipoVia = 'AVENIDA';
                                    else if (['AC','AVENIDA CALLE'].includes(t)) dirTipoVia = 'AVENIDA CALLE';
                                    else if (['AK','AVENIDA CARRERA'].includes(t)) dirTipoVia = 'AVENIDA CARRERA';
                                    else dirTipoVia = t;
                                }
                                if (tokens.length > 0) dirNumVia = tokens.shift();
                                if (tokens.length > 0 && /^[A-Z]$/.test(tokens[0])) dirLetra = tokens.shift();
                                if (tokens.length > 0 && tokens[0] === 'BIS') {
                                    dirBis = tokens.shift();
                                    if (tokens.length > 0 && /^[A-Z]$/.test(tokens[0])) dirLetra = tokens.shift();
                                }
                                if (tokens.length > 0 && ['SUR','NORTE','ESTE','OESTE','S','N','E','O'].includes(tokens[0])) {
                                    const s = tokens.shift();
                                    dirSentido = s==='S'?'SUR':s==='N'?'NORTE':s==='E'?'ESTE':s==='O'?'OESTE':s;
                                }
                                if (tokens.length > 0 && ['#','NO','N'].includes(tokens[0])) tokens.shift();
                                if (tokens.length > 0) dirNumSec = tokens.shift();
                                if (tokens.length > 0 && /^[A-Z]$/.test(tokens[0])) dirLetraSec = tokens.shift();
                                if (tokens.length > 0) dirPlaca = tokens.shift();
                                if (tokens.length > 0 && ['SUR','NORTE','ESTE','OESTE','S','N','E','O'].includes(tokens[0])) {
                                    const s = tokens.shift();
                                    dirSentido2 = s==='S'?'SUR':s==='N'?'NORTE':s==='E'?'ESTE':s==='O'?'OESTE':s;
                                }
                                
                                console.log(c.cyan(`     📍 Parseado: [${dirTipoVia}] [${dirNumVia}] [${dirLetra}] [${dirBis}] [${dirSentido}] # [${dirNumSec}] [${dirLetraSec}] - [${dirPlaca}] [${dirSentido2}]`.replace(/ \[\]/g, '')));
                                
                                const telefono = readline.question('  > Numero de Telefono: ').trim();

                                console.log(c.gris('     - Ingresando Dirección de Residencia y Teléfono...'));
                                
                                const fillText = async (locator, value) => {
                                    if (value && await locator.count() > 0) {
                                        await locator.evaluate((el, val) => {
                                            el.value = val;
                                            el.dispatchEvent(new Event('input', { bubbles: true }));
                                            el.dispatchEvent(new Event('change', { bubbles: true }));
                                            el.blur();
                                        }, value).catch(() => {});
                                        await page.waitForTimeout(500);
                                    }
                                };

                                if (dirTipoVia) await waitForAndSelect(currentFrame.locator('select[id*="tbnDatosGeo"][id*="ddlVia"]').first(), dirTipoVia);
                                await fillText(currentFrame.locator('input[id*="tbnDatosGeo"][id*="txtNombreVia"]').first(), dirNumVia);
                                if (dirLetra) await waitForAndSelect(currentFrame.locator('select[id$="txtDireccionResidencia_ddlLetra"]').first(), dirLetra);
                                if (dirBis) await waitForAndSelect(currentFrame.locator('select[id*="tbnDatosGeo"][id*="ddlBis"]').first(), dirBis);
                                if (dirSentido) await waitForAndSelect(currentFrame.locator('select[id*="tbnDatosGeo"][id*="ddlSentido"]:not([id*="2"])').first(), dirSentido);
                                await fillText(currentFrame.locator('input[id*="tbnDatosGeo"][id*="txtNumero"]').first(), dirNumSec);
                                if (dirLetraSec) await waitForAndSelect(currentFrame.locator('select[id$="txtDireccionResidencia_ddlLetra2"]').first(), dirLetraSec);
                                await fillText(currentFrame.locator('input[id*="tbnDatosGeo"][id*="txtPlaca"]').first(), dirPlaca);
                                if (dirSentido2) await waitForAndSelect(currentFrame.locator('select[id*="tbnDatosGeo"][id*="ddlSentido2"]').first(), dirSentido2);
                                
                                await fillText(currentFrame.locator('input[id*="tbnDatosGeo"][id*="txtTelefono"], input[id*="tbnDatosGeo"][id*="Telefono"]').first(), telefono);

                                console.log(c.verde(`  ✅ Pestaña "Datos de Ubicación" llenada automáticamente.`));
                                
                                // --- PESTAÑA PERTENENCIA ÉTNICA ---
                                console.log(c.amarillo('\n  ⏳ Procediendo a pestaña Pertenencia Étnica...'));
                                const tabEtnica = currentFrame.locator('.ajax__tab_tab:has-text("Etnica"), .ajax__tab_tab:has-text("Étnica"), .ajax__tab_tab:has-text("Pertenencia")').first();
                                if (await tabEtnica.count() > 0) {
                                    await tabEtnica.click().catch(() => {});
                                    await page.waitForTimeout(300);
                                    currentFrame = page.frame({ name: 'frameContent' }) || page;
                                    
                                    // Intentar autocompletar "No se autorreconoce en ninguno de los anteriores" si es posible
                                    const selEtnia = currentFrame.locator('select:visible[id*="Etnico"], select:visible[id*="Etnia"], select:visible[id*="Pertenencia"]').first();
                                    if (await selEtnia.count() > 0) {
                                        await waitForAndSelect(selEtnia, "NO SE AUTORRECONOCE EN NINGUNO DE LOS ANTERIORES");
                                    } else {
                                        console.log(c.rojo('  ⚠️ No se encontró la lista de Grupo Étnico.'));
                                    }
                                }

                                // --- PESTAÑA GRUPO FAMILIAR ---
                                console.log(c.amarillo('\n  ⏳ Procediendo a pestaña Grupo Familiar...'));
                                const tabFam = currentFrame.locator('.ajax__tab_tab:has-text("Familiar")').first();
                                if (await tabFam.count() > 0) {
                                    await tabFam.click().catch(() => {});
                                    await page.waitForTimeout(300);
                                    currentFrame = page.frame({ name: 'frameContent' }) || page;
                                    
                                    // 1. Preguntar quién es el Jefe del Grupo Familiar
                                    let tipoJefe = '';
                                    while(tipoJefe !== '1' && tipoJefe !== '2') {
                                        tipoJefe = readline.question(c.cyan('\n  > Quien es el Jefe del Grupo Familiar? (1 = MADRE, 2 = PADRE): ')).trim();
                                    }
                                    const esMadre = tipoJefe === '1';
                                    const labelJefe = esMadre ? 'la Madre' : 'el Padre';
                                    const parentescoJefeVal = esMadre ? 'MADRE' : 'PADRE';
                                    const sexoJefeVal = esMadre ? 'MUJER' : 'HOMBRE';

                                    console.log(c.amarillo(`  ⏳ Configurando datos de ${labelJefe}...`));
                                    
                                    const chkResponsable = currentFrame.locator('input[type="checkbox"]:visible[id*="chk_Responsable"]').first();
                                    if (await chkResponsable.count() > 0) {
                                        const isChecked = await chkResponsable.isChecked();
                                        if (!isChecked) {
                                            console.log(c.amarillo('  ⏳ Marcando como Responsable/Acudiente...'));
                                            const postResponsable = page.waitForResponse(resp => resp.request().method() === 'POST', { timeout: 10000 }).catch(() => {});
                                            await chkResponsable.check();
                                            await postResponsable;
                                            await page.waitForTimeout(1000);
                                        }
                                    }

                                    const selParentescoJefe = currentFrame.locator('select:visible[id*="ddlParentescoJefe"], select:visible[id*="Parentesco"]').first();
                                    await selParentescoJefe.waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
                                    await waitForAndSelect(selParentescoJefe, "JEFE DEL GRUPO FAMILIAR");

                                    // Usualmente el parentesco con el beneficiario es el segundo select o tiene ddlParentescoBeneficiario
                                    const allParentesco = currentFrame.locator('select:visible[id*="Parentesco"]');
                                    let selParentescoBen = currentFrame.locator('select:visible[id*="ddlParentescoBeneficiario"]').first();
                                    if (await selParentescoBen.count() === 0 && await allParentesco.count() > 1) {
                                        selParentescoBen = allParentesco.nth(1);
                                    }
                                    await waitForAndSelect(selParentescoBen, parentescoJefeVal);

                                    // Preguntar Tipo de Documento
                                    console.log(c.cyan(`\n  > Tipo de Documento de ${labelJefe}:`));
                                    console.log(c.cyan('    1. Cedula de Ciudadania'));
                                    console.log(c.cyan('    2. Cedula de Extranjeria'));
                                    console.log(c.cyan('    3. Permiso por Proteccion Temporal'));
                                    console.log(c.cyan('    4. Permiso Especial de Permanencia'));
                                    console.log(c.cyan('    5. Pasaporte'));
                                    let tipoDocSel = '';
                                    while(!['1','2','3','4','5'].includes(tipoDocSel)) {
                                        tipoDocSel = readline.question(c.cyan('  > Elige una opcion (1-5): ')).trim();
                                    }
                                    const docsMap = {
                                        '1': 'CEDULA DE CIUDADANIA',
                                        '2': 'CEDULA DE EXTRANJERIA',
                                        '3': 'PERMISO POR PROTECCIÓN TEMPORAL',
                                        '4': 'PERMISO ESPECIAL DE PERMANENCIA',
                                        '5': 'PASAPORTE'
                                    };
                                    const valTipoDocJefe = docsMap[tipoDocSel];

                                    const selTipoDocMadre = currentFrame.locator('select:visible[id*="ddlTipoDocumento"], select:visible[id*="TipoDoc"]').first();
                                    await waitForAndSelect(selTipoDocMadre, valTipoDocJefe);

                                    const docMadre = readline.question(c.negrita(`\n  > Numero de Documento de Identidad de ${labelJefe}: `)).trim();
                                    const txtDocMadre = currentFrame.locator('input[type="text"]:visible[id*="txtIdentificacion"], input[type="text"]:visible[id*="Documento"]').first();
                                    await txtDocMadre.fill(docMadre);

                                    // Clic en lupa
                                    const btnLupaMadre = currentFrame.locator('input[type="image"]:visible[src*="icoPagBuscar"], input[type="image"]:visible[id*="Buscar"], input[type="image"]:visible[id*="Lupa"]').first();
                                    const postPromiseMadre = page.waitForResponse(resp => resp.request().method() === 'POST', { timeout: 10000 }).catch(() => {});
                                    await btnLupaMadre.click();
                                    console.log(c.amarillo(`  ⏳ Buscando a ${labelJefe} en el sistema...`));
                                    await postPromiseMadre;
                                    await page.waitForTimeout(1000); // Esperar renderizado del UpdatePanel

                                    // Verificar si es nueva
                                    const txtPrimerNombreMadre = currentFrame.locator('input[type="text"]:visible[id*="txtPrimerNombre"]').first();
                                    await txtPrimerNombreMadre.waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
                                    
                                    const isEditable = await txtPrimerNombreMadre.isEditable().catch(() => false);
                                    const valNombre = await txtPrimerNombreMadre.inputValue().catch(() => '');

                                    if (isEditable && !valNombre) {
                                        console.log(c.cyan(`  ✨ ${labelJefe.toUpperCase()} es NUEVA(O) en el sistema. Solicitando datos...`));
                                        let pNombreMadre = '';
                                        while(!pNombreMadre) pNombreMadre = readline.question(c.negrita('  > Primer Nombre: ')).trim().toUpperCase();
                                        const sNombreMadre = readline.question(c.negrita('  > Segundo Nombre: ')).trim().toUpperCase();
                                        let pApellidoMadre = '';
                                        while(!pApellidoMadre) pApellidoMadre = readline.question(c.negrita('  > Primer Apellido: ')).trim().toUpperCase();
                                        const sApellidoMadre = readline.question(c.negrita('  > Segundo Apellido: ')).trim().toUpperCase();
                                        let fechaNacMadre = '';
                                        while(!fechaNacMadre) fechaNacMadre = readline.question(c.negrita('  > Fecha de Nacimiento (DD/MM/YYYY): ')).trim();

                                        await txtPrimerNombreMadre.fill(pNombreMadre);
                                        const txtSNombreM = currentFrame.locator('input[type="text"]:visible[id*="txtSegundoNombre"]').first();
                                        if (await txtSNombreM.count() > 0) await txtSNombreM.fill(sNombreMadre);
                                        
                                        const txtPApellidoM = currentFrame.locator('input[type="text"]:visible[id*="txtPrimerApellido"]').first();
                                        if (await txtPApellidoM.count() > 0) await txtPApellidoM.fill(pApellidoMadre);

                                        const txtSApellidoM = currentFrame.locator('input[type="text"]:visible[id*="txtSegundoApellido"]').first();
                                        if (await txtSApellidoM.count() > 0) await txtSApellidoM.fill(sApellidoMadre);

                                        const txtFechaNacM = currentFrame.locator('input[type="text"]:visible[id*="FechaNacimiento"], input[type="text"]:visible[id*="txtFechaNacimiento"]').first();
                                        if (await txtFechaNacM.count() > 0) {
                                            await txtFechaNacM.evaluate(el => { el.value = ''; }).catch(()=>{});
                                            await txtFechaNacM.focus();
                                            await txtFechaNacM.pressSequentially(fechaNacMadre.replace(/\D/g, ''), { delay: 100 });
                                            const datePost = page.waitForResponse(resp => resp.request().method() === 'POST', { timeout: 4000 }).catch(() => {});
                                            await txtFechaNacM.press('Tab');
                                            await datePost;
                                        }
                                    } else {
                                        console.log(c.verde(`  ✅ ${labelJefe.toUpperCase()} ya existe en Cuéntame: ${valNombre || 'REGISTRADA'}`));
                                    }

                                    // --- PREGUNTAR / CONFIRMAR LUGAR DE NACIMIENTO DEL ACUDIENTE ---
                                    console.log(c.cyan(`\n  📝 LUGAR DE NACIMIENTO DE ${labelJefe.toUpperCase()}`));
                                    const resPaisM = readline.question(c.negrita(`  > Pais de Nacimiento? (Enter/Tab para COLOMBIA): `)).trim().toUpperCase();
                                    const valPaisM = (resPaisM === '' || resPaisM === '1') ? 'COLOMBIA' : resPaisM;

                                    const resDeptoM = readline.question(c.negrita(`  > Departamento de Nacimiento? (Enter/Tab para BOGOTA D.C.): `)).trim().toUpperCase();
                                    const valDeptoM = (resDeptoM === '' || resDeptoM === '1') ? 'BOGOTA D.C.' : resDeptoM;

                                    const resMuniM = readline.question(c.negrita(`  > Municipio de Nacimiento? (Enter/Tab para BOGOTA, D.C.): `)).trim().toUpperCase();
                                    const valMuniM = (resMuniM === '' || resMuniM === '1') ? 'BOGOTA, D.C.' : resMuniM;

                                    // Helper para seleccionar dropdowns en cascada con postback de ASP.NET
                                    const selectCascadingDropdown = async (selectLoc, textToSelect) => {
                                        if (await selectLoc.count() === 0) return false;
                                        await selectLoc.waitFor({ state: 'attached', timeout: 4000 }).catch(() => {});
                                        const postP = page.waitForResponse(resp => resp.request().method() === 'POST', { timeout: 6000 }).catch(() => {});
                                        await waitForAndSelect(selectLoc, textToSelect);
                                        await selectLoc.evaluate(el => {
                                            el.dispatchEvent(new Event('change', { bubbles: true }));
                                        }).catch(() => {});
                                        await postP;
                                        await page.waitForTimeout(1000);
                                    };

                                    // --- AUTOCOMPLETAR CAMPOS REQUERIDOS EN CUÉNTAME ---
                                    console.log(c.amarillo(`  ℹ️ Completando campos en el formulario de ${labelJefe} (Sexo, País, Depto, Municipio)...`));
                                    
                                    const selSexoMadre = currentFrame.locator('select:visible[id*="ddlSexo"], select:visible[id*="Sexo"]').first();
                                    await selSexoMadre.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
                                    if (await selSexoMadre.count() > 0) {
                                        const vSexo = await selSexoMadre.inputValue().catch(() => '');
                                        if (!vSexo || vSexo === '0' || vSexo.includes('Seleccione')) {
                                            await waitForAndSelect(selSexoMadre, sexoJefeVal);
                                        }
                                    }

                                    // 1. País
                                    const selPaisM = currentFrame.locator('select:visible[id*="PaisNacimiento"], select:visible[id*="Pais"]').first();
                                    await selPaisM.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
                                    if (await selPaisM.count() > 0) {
                                        const vPais = await selPaisM.inputValue().catch(() => '');
                                        if (!vPais || vPais === '0' || vPais.includes('Seleccione')) {
                                            console.log(c.verde(`    👉 Seleccionando País de Nacimiento (${valPaisM})...`));
                                            await selectCascadingDropdown(selPaisM, valPaisM);
                                        }
                                    }
                                    
                                    // 2. Departamento (Cargado tras postback del País)
                                    const selDeptoM = currentFrame.locator('select:visible[id*="DepartamentoNacimiento"], select:visible[id*="DeptoNacimiento"], select:visible[id*="Departamento"], select:visible[id*="Depto"]').first();
                                    await selDeptoM.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
                                    if (await selDeptoM.count() > 0) {
                                        const vDepto = await selDeptoM.inputValue().catch(() => '');
                                        if (!vDepto || vDepto === '0' || vDepto.includes('Seleccione')) {
                                            console.log(c.verde(`    👉 Seleccionando Departamento de Nacimiento (${valDeptoM})...`));
                                            await selectCascadingDropdown(selDeptoM, valDeptoM);
                                        }
                                    }
                                    
                                    // 3. Municipio (Cargado tras postback del Departamento)
                                    const selMuniM = currentFrame.locator('select:visible[id*="MunicipioNacimiento"], select:visible[id*="MuniNacimiento"], select:visible[id*="Municipio"], select:visible[id*="Muni"]').first();
                                    await selMuniM.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
                                    if (await selMuniM.count() > 0) {
                                        const vMuni = await selMuniM.inputValue().catch(() => '');
                                        if (!vMuni || vMuni === '0' || vMuni.includes('Seleccione')) {
                                            console.log(c.verde(`    👉 Seleccionando Municipio de Nacimiento (${valMuniM})...`));
                                            await waitForAndSelect(selMuniM, valMuniM);
                                        }
                                    }

                                    const btnAgregarMadre = currentFrame.locator('a:visible:has-text("Agregar Persona"), a:visible[id*="btnAgregarPersona"], a[id*="LblAgregarPersona"]').first();
                                    await btnAgregarMadre.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
                                    if (await btnAgregarMadre.count() > 0) {
                                        console.log(c.amarillo(`  ⏳ Agregando a ${labelJefe} al grupo familiar...`));
                                        const postAgregar = page.waitForResponse(resp => resp.request().method() === 'POST', { timeout: 10000 }).catch(() => {});
                                        await btnAgregarMadre.click();
                                        await postAgregar;
                                        await page.waitForTimeout(2000); // Dar tiempo a que la grilla se actualice
                                    } else {
                                        console.log(c.rojo('  ⚠️ No se encontró el botón Agregar Persona.'));
                                    }

                                    // 2. Actualizar Niño (REGISTRO CIVIL)
                                    console.log(c.amarillo('\n  ⏳ Buscando al niño en la tabla de Familia/Responsables...'));
                                    
                                    // Buscar la fila por número de documento o tipo de documento
                                    let btnDetalleNino = currentFrame.locator(`tr:visible:has-text("${docNum}") input[type="image"][title*="Detalle"]`).first();
                                    await btnDetalleNino.waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
                                    
                                    if (await btnDetalleNino.count() === 0) {
                                        btnDetalleNino = currentFrame.locator(`tr:visible:has-text("REGISTRO CIVIL") input[type="image"][title*="Detalle"]`).first();
                                        await btnDetalleNino.waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
                                    }
                                    
                                    if (await btnDetalleNino.count() > 0) {
                                        const postDetalle = page.waitForResponse(resp => resp.request().method() === 'POST', { timeout: 10000 }).catch(() => {});
                                        await btnDetalleNino.click();
                                        console.log(c.amarillo('  ⏳ Cargando detalle del niño...'));
                                        await postDetalle;
                                        await page.waitForTimeout(2000); // Esperar que el form superior se llene con los datos del niño

                                        const selParentescoJefeNino = currentFrame.locator('select:visible[id*="ddlParentescoJefe"], select:visible[id*="Parentesco"]').first();
                                        await selParentescoJefeNino.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
                                        await waitForAndSelect(selParentescoJefeNino, "HIJO (A)");

                                        const btnActualizarNino = currentFrame.locator('a:visible:has-text("Actualizar Persona"), a:visible[id*="LblAgregarPersona"]').first();
                                        if (await btnActualizarNino.count() > 0) {
                                            console.log(c.amarillo('  ⏳ Actualizando datos del niño en la tabla...'));
                                            const postActualizar = page.waitForResponse(resp => resp.request().method() === 'POST', { timeout: 10000 }).catch(() => {});
                                            await btnActualizarNino.click();
                                            await postActualizar;
                                            await page.waitForTimeout(1500);
                                        }

                                        console.log(c.rojo('\n  🚨 VALIDA TODO EL CONTENIDO PARA EVITAR ERRORES DE DIGITACION.'));
                                        readline.question(c.negrita('  > Presiona ENTER cuando hayas revisado para Guardar y finalizar...'));

                                        const btnGuardarFam = currentFrame.locator('a[id*="btnGuardar"], img[alt="Guardar"], input[type="image"][id*="btnGuardar"]').first();
                                        if (await btnGuardarFam.count() > 0) {
                                            const postGuardarFam = page.waitForResponse(resp => resp.request().method() === 'POST', { timeout: 10000 }).catch(() => {});
                                            await btnGuardarFam.click();
                                            await postGuardarFam;
                                            console.log(c.verde('  ✅ Guardado exitoso.'));
                                        } else {
                                            console.log(c.rojo('  ⚠️ No se encontró el botón Guardar general. Guarda manualmente.'));
                                        }


                                        // Clic en + (Nuevo)
                                        const btnNuevo = currentFrame.locator('a[id*="btnNuevo"], img[alt="Nuevo"]').first();
                                        if (await btnNuevo.count() > 0) {
                                            await btnNuevo.click();
                                            await page.waitForTimeout(2000);
                                        }

                                    } else {
                                        console.log(c.rojo(`  ⚠️ No se encontró la fila del niño en la tabla (buscando por doc ${docNum} o REGISTRO CIVIL).`));
                                        readline.question(c.negrita('  > Por favor finaliza el proceso manualmente y presiona ENTER para continuar con el siguiente niño...'));
                                    }
                                }

                            } else {
                                console.log(c.rojo('  ❌ No se encontró la pestaña de Datos de Ubicación.'));
                            }
                        }

                    } else {
                        console.log(c.rojo(`  ❌ No se encontró el botón de Guardar (disco). Guardar manualmente por favor.`));
                    }
                    
                    page.off('dialog', dialogHandler);
                    
                    // Si llegamos hasta aquí sin errores, el ciclo de este niño fue exitoso. Limpiamos la memoria.
                    docRecuperacion = null;

            } // Fin de if (txtNumDoc.count() > 0)

        } // fin loop de niños

    } catch (e) {
        console.log(c.rojo(`  ❌ Error durante el llenado: ${e.message}`));
        if (await verificarConexionOCaida(page)) {
            console.log(c.rojo(`  ⚠️ Conexión perdida o error de servidor crítico detectado.`));
            console.log(c.amarillo(`  🔄 Iniciando recuperación automática de sesión...`));
            loggedIn = false;
            break; // Romper el loop interno para volver a iniciar sesión (docRecuperacion se mantiene)
        } else {
            // Error local de Playwright (timeout, elemento no encontrado), NO fue caída de sesión
            // Limpiamos la recuperación para no crear un loop infinito de un documento problemático
            docRecuperacion = null; 
        }
    }
    
    if (salirModulo) break; // propagar salida al loop externo

  }
  
  console.log(c.verde('\n  👋 Módulo finalizado.\n'));
  if (browser) await browser.disconnect().catch(() => {});
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = main;
