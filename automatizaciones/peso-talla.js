/**
 * peso-talla.js
 * Script interactivo para el registro de toma de peso y talla.
 * Fase 1: Selección de Asociación y Jardín (UDS), e ingreso al módulo correspondiente.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { chromium } = require('playwright');
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

async function main() {
  const USUARIO = process.env.CUENTAME_USUARIO;
  const PASSWORD = process.env.CUENTAME_PASSWORD;
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

  if (!USUARIO || !PASSWORD) {
    console.error(c.rojo('\n❌ Faltan credenciales en el archivo .env\n'));
    process.exit(1);
  }

  // Cargar datos
  const RUTA_EXCEL = process.env.RUTA_EXCEL || 'C:\\GENERAL.xlsx';
  const { porAsociacion } = leerJardines(RUTA_EXCEL);
  const asociaciones = Object.values(porAsociacion);

  if (asociaciones.length === 0) {
    console.log(c.rojo('❌ No se encontraron asociaciones en el Excel.'));
    return;
  }

  console.log(c.cyan('\n======================================================'));
  console.log(c.cyan('   ⚖️  REGISTRO DE PESO Y TALLA (FASE 1)'));
  console.log(c.cyan('======================================================\n'));

  let browser = null;
  let context = null;
  let page = null;
  let loggedIn = false;

  try {
    while (true) {
      console.log(c.cyan('\n------------------------------------------------------'));
      console.log(c.cyan('  📋 SELECCION DE ASOCIACION'));
      console.log(c.cyan('------------------------------------------------------'));
      asociaciones.forEach((asc, i) => console.log(`  ${i + 1}. ${asc.nombreCorto}`));
      console.log(`  0. Salir`);

      let idxAsociacion = -1;
      while (idxAsociacion < 0 || idxAsociacion > asociaciones.length) {
        const res = readline.question(c.negrita('\n  > Selecciona la asociacion (0 para salir): '));
        idxAsociacion = parseInt(res, 10);
        if (isNaN(idxAsociacion)) idxAsociacion = -1;
      }

      if (idxAsociacion === 0) {
        console.log(c.verde('\n  ✅ Proceso finalizado. Cerrando navegador...'));
        if (browser) await browser.close();
        break;
      }

      const ascSeleccionada = asociaciones[idxAsociacion - 1];

      const jardines = ascSeleccionada.jardines;
      if (!jardines || jardines.length === 0) {
          console.log(c.rojo(`  ❌ No hay jardines (UDS) configurados para esta asociacion en el Excel.`));
          continue;
      }

      console.log(c.cyan('\n------------------------------------------------------'));
      console.log(c.cyan(`  📋 SELECCION DE JARDIN (UDS) - ${ascSeleccionada.nombreCorto}`));
      console.log(c.cyan('------------------------------------------------------'));
      jardines.forEach((jardin, i) => console.log(`  ${i + 1}. ${jardin.codigo} - ${jardin.nombre}`));
      console.log(`  0. Volver a seleccionar asociacion`);

      let idxJardin = -1;
      while (idxJardin < 0 || idxJardin > jardines.length) {
        const res = readline.question(c.negrita('\n  > Selecciona el Jardin (0 para volver): '));
        idxJardin = parseInt(res, 10);
        if (isNaN(idxJardin)) idxJardin = -1;
      }

      if (idxJardin === 0) {
        continue;
      }

      const jardinSeleccionado = jardines[idxJardin - 1];

      // Lanzar navegador e iniciar sesión SOLO si no se ha hecho
      if (!browser) {
          console.log(c.cyan('\n  🌐 Abriendo navegador e iniciando sesion...\n'));
          browser = await chromium.launch({
            headless: false,
            slowMo: 100,
            args: ['--start-maximized'],
            executablePath: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
          });
          context = await browser.newContext({ viewport: null });
          page = await context.newPage();
      }

      if (!loggedIn) {
          await loginYLlegarARoles(page, {
            usuario: USUARIO,
            password: PASSWORD,
            gmailUser: GMAIL_USER,
            gmailAppPassword: GMAIL_APP_PASSWORD
          });
          console.log(c.verde('  ✅ Login exitoso en Cuentame.'));
          loggedIn = true;
      } else {
          // Si ya estábamos logueados, navegamos de vuelta a la selección de roles
          await page.goto('https://rubonline.icbf.gov.co/Page/General/General/SeleccionRol.aspx');
      }

      console.log(c.amarillo(`  🏢 Entrando con la asociacion ${ascSeleccionada.nombreCorto}...`));
      await seleccionarRolYEntrar(page, ascSeleccionada);
      
      // Esperar a que cargue la página principal
      console.log(c.amarillo('  ⏳ Esperando a que cargue el menu de Cuentame...'));
      await page.waitForTimeout(4000); 
      
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
      
      console.log(c.cyan('\n  🚀 Navegando al modulo de Seguimiento nutricional...'));
      try {
          // Buscamos directamente el enlace hijo y forzamos el clic con JS
          const childMenu = rootMenu.locator('a:has-text("Seguimiento nutricional")').first();
          if (await childMenu.count() > 0) {
              await childMenu.evaluate(node => node.click());
              await page.waitForTimeout(4000);
              console.log(c.verde('  ✅ Clic en "Seguimiento nutricional".'));
          } else {
              console.log(c.amarillo('  ⚠️ No se encontro "Seguimiento nutricional" con texto exacto. Intentando alternativa...'));
              await rootMenu.locator('a[onclick*="SeguimientoNutricional"]').first().evaluate(node => node.click());
              await page.waitForTimeout(4000);
              console.log(c.verde('  ✅ Clic en "Seguimiento nutricional".'));
          }
      } catch (err) {
          console.log(c.rojo(`  ❌ Error al intentar acceder a Seguimiento nutricional: ${err.message}`));
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
      const rootContent = contentFrame || page;

      // Hacer clic en la lupa para abrir la ventana emergente de UDS
      console.log(c.cyan('  🔍 Abriendo ventana emergente de UDS...'));
      
      let lupaLocator = rootContent.locator('input[id*="cphCont_btnFiltrar"], input[name*="btnFiltrar"], input[src*="lupa"]').first();
      
      const [popup] = await Promise.all([
          page.waitForEvent('popup'),
          lupaLocator.evaluate(node => node.click())
      ]);

      await popup.waitForLoadState('networkidle');
      console.log(c.verde('  ✅ Ventana emergente "Lupa Unidades de Servicio" abierta.'));

      // Llenar datos en el popup
      console.log(c.cyan(`  📝 Ingresando codigo de la UDS: ${jardinSeleccionado.codigo}...`));
      await popup.locator('input[id*="txtCodigoUnidadServicio"], input[name*="CodigoUnidadServicio"]').first().fill(String(jardinSeleccionado.codigo));

      console.log(c.cyan('  📝 Seleccionando Departamento: BOGOTA D.C.'));
      let ddlDepto = popup.locator('select[id*="ddlDepartamento"], select[name*="ddlDepartamento"]').first();
      
      if (await ddlDepto.count() === 0) {
          // Fallback: buscar el select cuyo texto anterior (label o td) sea "Departamento"
          console.log(c.amarillo('    ⚠️ No se encontro select por ID. Buscando por estructura DOM...'));
          const tdLabel = popup.locator('td:has-text("Departamento")').last();
          ddlDepto = tdLabel.locator('xpath=following-sibling::td//select').first();
          if (await ddlDepto.count() === 0) {
              ddlDepto = popup.locator('select').nth(1); // Asumiendo que es el 2do select
          }
      }

      try {
          // Usar una expresión regular para lidiar con tildes y espacios dobles
          await ddlDepto.selectOption({ label: /BOGOT. D\.C\./i });
          console.log(c.verde('    ✅ Departamento BOGOTA D.C. seleccionado.'));
      } catch (err) {
          console.log(c.rojo(`    ❌ Fallo al seleccionar BOGOTA D.C.: ${err.message}`));
          console.log(c.amarillo('    Intentando buscar la opcion que contenga BOGOTA...'));
          try {
              const options = await ddlDepto.locator('option').allInnerTexts();
              const bogotaOpt = options.find(o => o.toUpperCase().includes('BOGOT'));
              if (bogotaOpt) {
                  await ddlDepto.selectOption({ label: bogotaOpt });
                  console.log(c.verde(`    ✅ Seleccionado fallback: ${bogotaOpt}`));
              } else {
                  console.log(c.rojo(`    ❌ No existe ninguna opcion con BOGOTA en el select.`));
              }
          } catch (e) {
              console.log(c.rojo(`    ❌ Error fatal al intentar fallback del departamento.`));
          }
      }

      console.log(c.cyan('  🔍 Haciendo clic en buscar/aceptar dentro de la Lupa...'));
      await popup.locator('input[type="image"][id*="btnBuscar"], input[name*="btnBuscar"], a[id*="btnBuscar"]').first().click();

      console.log(c.amarillo('  ⏳ Esperando a que el sistema procese la busqueda...'));
      
      try {
          // Esperar a que la tabla de resultados (grid) se cargue y el botón de info aparezca
          const btnInfo = popup.locator('input[type="image"][id*="btnInfo"], input[src*="info.jpg"]').first();
          await btnInfo.waitFor({ state: 'visible', timeout: 15000 });
          
          console.log(c.verde('  ✅ Resultado encontrado. Seleccionando la UDS...'));
          await btnInfo.click();
      } catch (err) {
          console.log(c.rojo(`  ❌ Error: No se encontraron resultados o el boton de info no aparecio.`));
      }

      console.log(c.amarillo('  ⏳ Esperando a que el popup se cierre y transfiera la UDS...'));
      try {
          await popup.waitForEvent('close', { timeout: 10000 });
      } catch (e) {
          // A veces el postback no cierra la ventana inmediatamente si no hay resultados
      }
      
      console.log(c.verde(`\n  🎉 ¡Fase 1 completada! El sistema tiene la UDS cargada y la grilla de ninos visible.`));
      
      // =========================================================================
      // FASE 2: SELECCION DE NINO EN LA GRILLA
      // =========================================================================
      
      // Esperamos a que la grilla de ninos termine de cargar en la pagina principal
      await page.waitForTimeout(3000);
      
      // Refrescar rootContent
      let currentContentFrame = page.frame({ name: 'frameContent' });
      if (!currentContentFrame) {
          for (const f of page.frames()) {
              if (f.name() === 'frameContent') {
                  currentContentFrame = f;
                  break;
              }
          }
      }
      const content = currentContentFrame || page;

      while (true) {
          console.log(c.cyan('\n------------------------------------------------------'));
          console.log(c.cyan('  📋 SELECCION DE BENEFICIARIO (NINO)'));
          console.log(c.cyan('------------------------------------------------------'));
          
          console.log(c.amarillo('  ⏳ Extrayendo lista de ninos de la tabla...'));
          
          // Extraer las filas de la tabla de ninos
          // Normalmente es una tabla con clase o id especifico. Buscamos filas que tengan el boton azul
          const filas = content.locator('tr:has(input[src*="info.jpg"], input[id*="btnInfo"])');
          const count = await filas.count();
          
          if (count === 0) {
              console.log(c.rojo('  ❌ No se encontraron ninos listados para esta UDS.'));
              break;
          }

          let listaNinos = [];
          for (let i = 0; i < count; i++) {
              const fila = filas.nth(i);
              // Solo tomar los <td> que son hijos directos de esta fila (evita tablas anidadas)
              const celdas = fila.locator(':scope > td');
              const numCeldas = await celdas.count();
              
              // Una fila normal de niños tiene unas 8-10 columnas. Ignoramos filas contenedoras.
              if (numCeldas < 5 || numCeldas > 15) {
                  continue;
              }

              const textoCeldas = await celdas.allInnerTexts();
              const datos = textoCeldas.map(t => t.trim()).filter(t => t.length > 0);
              
              let documento = "N/A";
              let nombreCompleto = "";
              let tomas = "N/A";

              if (datos.length >= 6) {
                  const docIndex = datos.findIndex(d => /^\d{6,15}$/.test(d));
                  if (docIndex !== -1) {
                      documento = datos[docIndex];
                      let nombres = [];
                      for (let j = docIndex + 1; j < datos.length - 2; j++) { 
                          nombres.push(datos[j]);
                      }
                      nombreCompleto = nombres.join(' ');
                      tomas = datos[datos.length - 2];
                  } else {
                      documento = datos[1] || "N/A";
                      nombreCompleto = datos.slice(2, -2).join(' ');
                      tomas = datos[datos.length - 2] || "N/A";
                  }
              }

              listaNinos.push({
                  index: listaNinos.length,
                  documento,
                  nombreCompleto,
                  tomas,
                  locator: fila.locator('input[type="image"][src*="info.jpg"], input[id*="btnInfo"]').first()
              });
          }

          console.log(c.verde(`  ✅ Se encontraron ${listaNinos.length} ninos en la UDS:`));
          listaNinos.forEach((n, idx) => {
              console.log(`  ${idx + 1}. ${c.cyan(n.documento)} - ${n.nombreCompleto} (Tomas: ${c.amarillo(n.tomas)})`);
          });

          console.log(c.amarillo('\n  [0] Salir y volver a seleccionar UDS'));
          const input = readline.question(c.negrita('  > Ingresa el numero de la lista (ej. 1), o escribe texto para buscar: '));

          if (input.trim() === '0') {
              break;
          }
          if (input.trim() === '') {
              continue;
          }

          let ninoSeleccionado = null;
          const numParsed = parseInt(input.trim(), 10);
          
          if (!isNaN(numParsed) && numParsed > 0 && numParsed <= listaNinos.length) {
              ninoSeleccionado = listaNinos[numParsed - 1];
          } else {
              // Buscar por texto
              const busqueda = input.trim().toLowerCase();
              const resultados = listaNinos.filter(n => 
                  n.documento.includes(busqueda) || 
                  n.nombreCompleto.toLowerCase().includes(busqueda)
              );
              
              if (resultados.length === 1) {
                  ninoSeleccionado = resultados[0];
              } else if (resultados.length > 1) {
                  console.log(c.amarillo(`  ⚠️ Hay ${resultados.length} coincidencias. Por favor se mas especifico o usa el numero de la lista.`));
                  continue;
              }
          }

          if (!ninoSeleccionado) {
              console.log(c.rojo(`  ❌ No se encontro ningun nino que coincida con "${input}".`));
              continue;
          }

          try {
              console.log(c.verde(`\n  ✅ Nino seleccionado: ${ninoSeleccionado.nombreCompleto}`));
              console.log(c.gris(`  Accediendo a su formulario de peso y talla...`));
              
              await Promise.all([
                  content.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
                  ninoSeleccionado.locator.evaluate(node => node.click())
              ]);

              console.log(c.verde(`  ✅ Formulario del niño abierto exitosamente.`));
              
              // =========================================================================
              // FASE 3 (Prueba de Navegación): AGREGAR O EDITAR TOMA
              // =========================================================================
              
              while (true) {
                  console.log(c.amarillo('\n  ⏳ Extrayendo historial de tomas del niño...'));
                  await page.waitForTimeout(3000); // Esperar a que cargue la tabla del niño
                  
                  // Localizar la tabla de tomas (Seguimiento nutrición Unidad de servicio Actual)
                  const tablaTomas = content.locator('table:has(tr:has-text("Fecha Toma"))').last();
                  const filasTomas = tablaTomas.locator('tr').filter({ has: content.locator('td') });
                  const numTomas = await filasTomas.count();
                  
                  let listaTomas = [];
                  for (let i = 0; i < numTomas; i++) {
                      const fila = filasTomas.nth(i);
                      const celdas = fila.locator('td');
                      if (await celdas.count() > 3) {
                          const fechaToma = await celdas.nth(2).innerText().catch(()=>'');
                          const peso = await celdas.nth(7).innerText().catch(()=>'');
                          const talla = await celdas.nth(8).innerText().catch(()=>'');
                          if (fechaToma.trim()) {
                              listaTomas.push({
                                  index: i,
                                  fechaToma: fechaToma.trim(),
                                  peso: peso.trim(),
                                  talla: talla.trim(),
                                  chkLocator: fila.locator('input[type="checkbox"]').first(),
                                  btnInfoLocator: fila.locator('input[type="image"][src*="info.jpg"], input[id*="btnInfo"]').first()
                              });
                          }
                      }
                  }

                  console.log(c.cyan('\n------------------------------------------------------'));
                  console.log(c.cyan(`  📊 TOMAS ACTUALES DE: ${ninoSeleccionado.nombreCompleto}`));
                  console.log(c.cyan('------------------------------------------------------'));
                  
                  if (listaTomas.length === 0) {
                      console.log(c.gris('  (No hay tomas registradas previamente)'));
                  } else {
                      listaTomas.forEach((toma, idx) => {
                          console.log(`  ${idx + 1}. Fecha Toma: ${c.cyan(toma.fechaToma)} | Peso: ${toma.peso}kg | Talla: ${toma.talla}cm`);
                      });
                  }

                  console.log(c.amarillo('\n  ¿Que accion deseas realizar?'));
                  console.log(`  [+] Escribe "+" para Agregar una NUEVA toma.`);
                  if (listaTomas.length > 0) {
                      console.log(`  [1-${listaTomas.length}] Escribe el numero de una toma para EDITARLA.`);
                  }
                  console.log(`  [0] Salir y volver a buscar otro nino`);
                  
                  const accion = readline.question(c.negrita('\n  > Selecciona una accion: '));

                  if (accion.trim() === '0') {
                      break; // Regresa al bucle de selección de niño
                  }
                  
                  if (accion.trim() === '+') {
                      console.log(c.amarillo('  ⏳ Haciendo clic en el boton (+) Nuevo...'));
                      // Intentar encontrar el botón de Nuevo (suele ser una imagen o botón con title/value Nuevo o Agregar)
                      const btnNuevo = content.locator('input[type="image"][src*="nuevo"], input[type="image"][title*="Nuevo"], a[title*="Nuevo"], input[id*="btnNuevo"]').first();
                      
                      if (await btnNuevo.count() > 0) {
                          await Promise.all([
                              content.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
                              btnNuevo.evaluate(node => node.click())
                          ]);
                          console.log(c.verde('  ✅ Nueva ventana (Nuevo) cargada.'));
                          console.log(c.amarillo('  ⏸️  Script en pausa. Por favor enviale un pantallazo a Antigravity.'));
                          while (true) {
                              const resp = readline.question(c.negrita('\n  > Escribe "salir" para volver: '));
                              if (resp.toLowerCase() === 'salir') break;
                          }
                      } else {
                          console.log(c.rojo('  ❌ No se encontro el boton (+) Nuevo en la pantalla.'));
                      }
                      continue;
                  }

                  const numAccion = parseInt(accion.trim(), 10);
                  if (!isNaN(numAccion) && numAccion > 0 && numAccion <= listaTomas.length) {
                      const tomaSeleccionada = listaTomas[numAccion - 1];
                      console.log(c.amarillo(`  ⏳ Editando la toma del ${tomaSeleccionada.fechaToma}...`));
                      
                      try {
                          // Marcar el checkbox
                          if (await tomaSeleccionada.chkLocator.count() > 0) {
                              await tomaSeleccionada.chkLocator.check();
                          }
                          // Hacer clic en el icono azul (Detalle)
                          if (await tomaSeleccionada.btnInfoLocator.count() > 0) {
                              await Promise.all([
                                  content.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
                                  tomaSeleccionada.btnInfoLocator.evaluate(node => node.click())
                              ]);
                              console.log(c.verde('  ✅ Ventana de Edicion cargada.'));
                              console.log(c.amarillo('  ⏸️  Script en pausa. Por favor enviale un pantallazo a Antigravity.'));
                              while (true) {
                                  const resp = readline.question(c.negrita('\n  > Escribe "salir" para volver: '));
                                  if (resp.toLowerCase() === 'salir') break;
                              }
                          } else {
                              console.log(c.rojo('  ❌ No se encontro el boton azul (detalle) para esta fila.'));
                          }
                      } catch (e) {
                          console.log(c.rojo(`  ❌ Error al editar: ${e.message}`));
                      }
                      continue;
                  }
                  
                  console.log(c.rojo('  ❌ Opcion no valida.'));
              }
              
              console.log(c.amarillo('  🔄 Regresando al listado de ninos (simulado)...'));

          } catch (err) {
              console.log(c.rojo(`  ❌ Error al abrir formulario del nino: ${err.message}`));
          }
      }
    }
  } catch (err) {
    console.error(c.rojo(`\n  ❌ Error en el proceso: ${err.message}`));
  }
}

main();
