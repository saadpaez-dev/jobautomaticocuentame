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
      
      const menuFrame = page.frameLocator('frame[name="frameMenu"], iframe[name="frameMenu"]');
      
      console.log(c.cyan('\n  🚀 Navegando al módulo de Seguimiento nutricional...'));
      try {
          // Desplegar menú Beneficiario
          await menuFrame.locator('a:has-text("Beneficiario")').first().click();
          await page.waitForTimeout(1000);
          
          const enlaceSeguimiento = menuFrame.locator('a:has-text("Seguimiento nutricional")').first();
          if (await enlaceSeguimiento.count() > 0) {
              await enlaceSeguimiento.evaluate(node => node.click());
          } else {
              await menuFrame.locator('a[onclick*="SeguimientoNutricional"]').first().evaluate(node => node.click());
          }
          console.log(c.verde('  ✅ Clic en "Seguimiento nutricional".'));
      } catch (err) {
          console.log(c.rojo(`  ❌ Error al intentar acceder a Seguimiento nutricional: ${err.message}`));
          console.log(c.amarillo('  ⚠️ Navegando por URL directa como plan B...'));
          await page.goto('https://rubonline.icbf.gov.co/Page/RUBONLINE/SeguimientoNutricional/SeguimientoNutricion.aspx');
      }

      // Esperar a que cargue la página principal de seguimiento nutricional
      await page.waitForTimeout(4000);
      
      // Intentar acceder al frame de contenido; si falla o estamos en URL directa, usar la página
      let contentFrame = page.frameLocator('frame[name="frameContent"], iframe[name="frameContent"]');
      
      // Hacer clic en la lupa para abrir la ventana emergente de UDS
      console.log(c.cyan('  🔍 Abriendo ventana emergente de UDS...'));
      
      // Intentar encontrar el botón de filtrar (lupa) en el frame, o en la página entera si falló
      let lupaLocator = contentFrame.locator('input[id*="cphCont_btnFiltrar"], input[name*="btnFiltrar"], input[src*="lupa"]').first();
      
      const [popup] = await Promise.all([
          page.waitForEvent('popup'),
          lupaLocator.evaluate(node => node.click()).catch(() => page.locator('input[id*="cphCont_btnFiltrar"], input[name*="btnFiltrar"]').first().evaluate(node => node.click()))
      ]);

      await popup.waitForLoadState('networkidle');
      console.log(c.verde('  ✅ Ventana emergente "Lupa Unidades de Servicio" abierta.'));

      // Llenar datos en el popup
      console.log(c.cyan(`  📝 Ingresando código de la UDS: ${jardinSeleccionado.codigo}...`));
      await popup.locator('input[id*="txtCodigoUnidadServicio"], input[name*="CodigoUnidadServicio"]').first().fill(String(jardinSeleccionado.codigo));

      console.log(c.cyan('  📝 Seleccionando Departamento: BOGOTA D.C.'));
      const ddlDepto = popup.locator('select[id*="ddlDepartamento"], select[name*="ddlDepartamento"]').first();
      await ddlDepto.selectOption({ label: 'BOGOTA D.C.' }).catch(async () => {
          await ddlDepto.selectOption({ label: 'BOGOTÁ D.C.' }).catch(() => {});
      });

      console.log(c.cyan('  🔍 Haciendo clic en buscar/aceptar dentro de la Lupa...'));
      await popup.locator('input[type="image"][id*="btnBuscar"], input[name*="btnBuscar"], a[id*="btnBuscar"]').first().click();

      console.log(c.amarillo('  ⏳ Esperando a que el sistema procese y cierre la Lupa...'));
      try {
          await popup.waitForEvent('close', { timeout: 10000 });
      } catch (e) {
      }
      
      console.log(c.verde(`\n  🎉 ¡Fase 1 completada! El sistema debería tener la UDS cargada.`));
      console.log(c.amarillo(`  ⏸️  El script se detendrá ahora para que puedas revisar la pantalla en el navegador.`));
      console.log(c.amarillo(`  (Cierra el script con Ctrl+C cuando estés listo para continuar con la Fase 2)`));
      
      break;
    }
  } catch (err) {
    console.error(c.rojo(`\n  ❌ Error en el proceso: ${err.message}`));
  }
}

main();
