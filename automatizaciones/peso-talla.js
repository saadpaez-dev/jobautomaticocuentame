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
      console.log(c.cyan('  📋 SELECCIÓN DE ASOCIACIÓN'));
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
          console.log(c.rojo(`  ❌ No hay jardines (UDS) configurados para esta asociación en el Excel.`));
          continue;
      }

      console.log(c.cyan('\n------------------------------------------------------'));
      console.log(c.cyan(`  📋 SELECCIÓN DE JARDÍN (UDS) - ${ascSeleccionada.nombreCorto}`));
      console.log(c.cyan('------------------------------------------------------'));
      jardines.forEach((jardin, i) => console.log(`  ${i + 1}. ${jardin.codigo} - ${jardin.nombre}`));
      console.log(`  0. Volver a seleccionar asociación`);

      let idxJardin = -1;
      while (idxJardin < 0 || idxJardin > jardines.length) {
        const res = readline.question(c.negrita('\n  > Selecciona el Jardín (0 para volver): '));
        idxJardin = parseInt(res, 10);
        if (isNaN(idxJardin)) idxJardin = -1;
      }

      if (idxJardin === 0) {
        continue;
      }

      const jardinSeleccionado = jardines[idxJardin - 1];

      // Lanzar navegador e iniciar sesión SOLO si no se ha hecho
      if (!browser) {
          console.log(c.cyan('\n  🌐 Abriendo navegador e iniciando sesión...\n'));
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
          console.log(c.verde('  ✅ Login exitoso en Cuéntame.'));
          loggedIn = true;
      } else {
          // Si ya estábamos logueados, navegamos de vuelta a la selección de roles
          await page.goto('https://rubonline.icbf.gov.co/Page/General/General/SeleccionRol.aspx');
      }

      console.log(c.amarillo(`  🏢 Entrando con la asociación ${ascSeleccionada.nombreCorto}...`));
      await seleccionarRolYEntrar(page, ascSeleccionada);
      
      // Esperar a que cargue la página principal
      console.log(c.amarillo('  ⏳ Esperando a que cargue el menú de Cuéntame...'));
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
      
      console.log(c.cyan('\n  🚀 Navegando al módulo de Seguimiento nutricional...'));
      try {
          // Buscamos directamente el enlace hijo y forzamos el clic con JS
          const childMenu = rootMenu.locator('a:has-text("Seguimiento nutricional")').first();
          if (await childMenu.count() > 0) {
              await childMenu.evaluate(node => node.click());
              await page.waitForTimeout(4000);
              console.log(c.verde('  ✅ Clic en "Seguimiento nutricional".'));
          } else {
              console.log(c.amarillo('  ⚠️ No se encontró "Seguimiento nutricional" con texto exacto. Intentando alternativa...'));
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
      console.log(c.cyan(`  📝 Ingresando código de la UDS: ${jardinSeleccionado.codigo}...`));
      await popup.locator('input[id*="txtCodigoUnidadServicio"], input[name*="CodigoUnidadServicio"]').first().fill(String(jardinSeleccionado.codigo));

      console.log(c.cyan('  📝 Seleccionando Departamento: BOGOTA D.C.'));
      let ddlDepto = popup.locator('select[id*="ddlDepartamento"], select[name*="ddlDepartamento"]').first();
      
      if (await ddlDepto.count() === 0) {
          // Fallback: buscar el select cuyo texto anterior (label o td) sea "Departamento"
          console.log(c.amarillo('    ⚠️ No se encontró select por ID. Buscando por estructura DOM...'));
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
          console.log(c.rojo(`    ❌ Falló al seleccionar BOGOTA D.C.: ${err.message}`));
          console.log(c.amarillo('    Intentando buscar la opción que contenga BOGOTA...'));
          try {
              const options = await ddlDepto.locator('option').allInnerTexts();
              const bogotaOpt = options.find(o => o.toUpperCase().includes('BOGOT'));
              if (bogotaOpt) {
                  await ddlDepto.selectOption({ label: bogotaOpt });
                  console.log(c.verde(`    ✅ Seleccionado fallback: ${bogotaOpt}`));
              } else {
                  console.log(c.rojo(`    ❌ No existe ninguna opción con BOGOTA en el select.`));
              }
          } catch (e) {
              console.log(c.rojo(`    ❌ Error fatal al intentar fallback del departamento.`));
          }
      }

      console.log(c.cyan('  🔍 Haciendo clic en buscar/aceptar dentro de la Lupa...'));
      await popup.locator('input[type="image"][id*="btnBuscar"], input[name*="btnBuscar"], a[id*="btnBuscar"]').first().click();

      console.log(c.amarillo('  ⏳ Esperando a que el sistema procese la búsqueda...'));
      
      try {
          // Esperar a que la tabla de resultados (grid) se cargue y el botón de info aparezca
          const btnInfo = popup.locator('input[type="image"][id*="btnInfo"], input[src*="info.jpg"]').first();
          await btnInfo.waitFor({ state: 'visible', timeout: 15000 });
          
          console.log(c.verde('  ✅ Resultado encontrado. Seleccionando la UDS...'));
          await btnInfo.click();
      } catch (err) {
          console.log(c.rojo(`  ❌ Error: No se encontraron resultados o el botón de info no apareció.`));
      }

      console.log(c.amarillo('  ⏳ Esperando a que el popup se cierre y transfiera la UDS...'));
      try {
          await popup.waitForEvent('close', { timeout: 10000 });
      } catch (e) {
          // A veces el postback no cierra la ventana inmediatamente si no hay resultados
      }
      
      console.log(c.verde(`\n  🎉 ¡Fase 1 completada! El sistema tiene la UDS cargada y la grilla de niños visible.`));
      
      // =========================================================================
      // FASE 2: SELECCIÓN DE NIÑO EN LA GRILLA
      // =========================================================================
      
      // Esperamos a que la grilla de niños termine de cargar en la página principal
      await page.waitForTimeout(3000);
      
      while (true) {
          console.log(c.cyan('\n------------------------------------------------------'));
          console.log(c.cyan('  📋 SELECCIÓN DE BENEFICIARIO (NIÑO)'));
          console.log(c.cyan('------------------------------------------------------'));
          console.log(c.amarillo('  [0] Salir y volver a seleccionar UDS'));
          const documento = readline.question(c.negrita('\n  > Escribe el número de documento del niño: '));

          if (documento.trim() === '0') {
              break; // Rompe este bucle y vuelve al bucle principal de UDS/Asociación
          }
          if (documento.trim() === '') {
              continue;
          }

          console.log(c.gris(`  Buscando beneficiario con documento: ${documento}...`));
          
          // Refrescar rootContent por si acaso
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

          try {
              // Buscar en la tabla principal (asumiendo id similar a cphCont_GvBusquedaBeneficiario o GvSeguimientoNutricional)
              // Buscamos cualquier celda (td) que contenga exactamente el documento
              const filaBeneficiario = content.locator(`tr:has(td:text-is("${documento.trim()}"))`).first();
              
              if (await filaBeneficiario.count() === 0) {
                  console.log(c.rojo(`  ❌ No se encontró ningún niño con el documento ${documento} en la grilla.`));
                  continue;
              }

              // Si encontramos la fila, hacemos clic en su botón azul de información
              console.log(c.verde(`  ✅ Niño encontrado. Accediendo a su formulario de peso y talla...`));
              const btnDetalleNino = filaBeneficiario.locator('input[type="image"][src*="info.jpg"], input[id*="btnInfo"]').first();
              
              if (await btnDetalleNino.count() === 0) {
                  console.log(c.rojo(`  ❌ Se encontró el niño, pero no tiene botón de detalle (lupa azul).`));
                  continue;
              }
              
              // Al hacer clic, probablemente cargue otra pantalla dentro del frame
              await Promise.all([
                  content.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
                  btnDetalleNino.evaluate(node => node.click())
              ]);

              console.log(c.verde(`  ✅ Formulario abierto exitosamente.`));
              console.log(c.amarillo(`  ⏸️  El script se detendrá aquí por ahora. Verifica la pantalla de peso/talla.`));
              
              // Bucle infinito temporal para no cerrar el navegador y poder inspeccionar
              while (true) {
                  const resp = readline.question(c.negrita('\n  > Escribe "salir" para volver a buscar otro niño: '));
                  if (resp.toLowerCase() === 'salir') break;
              }
              
              // Si tuviéramos que volver a la grilla de niños, normalmente hay un botón "Volver"
              // Por ahora, solo simularemos regresar para el test
              console.log(c.amarillo('  🔄 Regresando a la grilla (simulado)...'));

          } catch (err) {
              console.log(c.rojo(`  ❌ Error al buscar/seleccionar el niño: ${err.message}`));
          }
      }
    }
  } catch (err) {
    console.error(c.rojo(`\n  ❌ Error en el proceso: ${err.message}`));
  }
}

main();
