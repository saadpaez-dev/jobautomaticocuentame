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

  console.log(c.cyan('  🌐 Abriendo navegador e iniciando sesión...\n'));
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
    args: ['--start-maximized'],
    executablePath: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
  });
  
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  try {
    // 1. Login inicial (solo una vez, incluye 2FA)
    await loginYLlegarARoles(page, {
      usuario: USUARIO,
      password: PASSWORD,
      gmailUser: GMAIL_USER,
      gmailAppPassword: GMAIL_APP_PASSWORD
    });
    console.log(c.verde('  ✅ Login exitoso en Cuéntame.'));

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
        break;
      }

      const ascSeleccionada = asociaciones[idxAsociacion - 1];

      // Ir a la página de selección de roles por si venimos de un ciclo anterior
      console.log(c.amarillo(`  🏢 Seleccionando la asociación ${ascSeleccionada.nombreCorto}...`));
      await page.goto('https://rubonline.icbf.gov.co/Page/General/General/SeleccionRol.aspx');
      await seleccionarRolYEntrar(page, ascSeleccionada);
      
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

      // Navegar a Seguimiento Nutricional
      console.log(c.cyan('\n  🚀 Navegando al módulo de Seguimiento nutricional...'));
      
      let menuFrame = page.frame({ name: 'frameMenu' });
      if (!menuFrame) {
          for (const f of page.frames()) {
              if (f.name() === 'frameMenu') {
                  menuFrame = f;
                  break;
              }
          }
      }

      if (menuFrame) {
          await menuFrame.click('text="Beneficiario"');
          await page.waitForTimeout(1000);
          
          try {
              const enlaceSeguimiento = menuFrame.locator('a:has-text("Seguimiento nutricional")').first();
              await enlaceSeguimiento.waitFor({ state: 'visible', timeout: 5000 });
              await enlaceSeguimiento.click();
              console.log(c.verde('  ✅ Clic en "Seguimiento nutricional".'));
          } catch (err) {
              console.log(c.amarillo('  ⚠️ No se encontró "Seguimiento nutricional" con texto exacto. Intentando búsqueda alternativa...'));
              // Intentar por el atributo onclick
              await menuFrame.locator('a[onclick*="SeguimientoNutricional"]').first().click();
              console.log(c.verde('  ✅ Clic en "Seguimiento nutricional".'));
          }
      } else {
          console.log(c.rojo('  ❌ No se encontró el frameMenu. Navegando por URL directa...'));
          await page.goto('https://rubonline.icbf.gov.co/Page/RUBONLINE/SeguimientoNutricional/SeguimientoNutricion.aspx');
      }

      // Esperar a que cargue la página principal de seguimiento nutricional
      await page.waitForTimeout(3000);
      let contentFrame = page.frame({ name: 'frameContent' }) || page.frames().find(f => f.name() === 'frameContent') || page;

      // Hacer clic en la lupa para abrir la ventana emergente de UDS
      console.log(c.cyan('  🔍 Abriendo ventana emergente de UDS...'));
      
      // Capturamos el evento de popup antes de hacer click
      const [popup] = await Promise.all([
          page.waitForEvent('popup'),
          contentFrame.locator('input[id*="cphCont_btnFiltrar"], input[name*="btnFiltrar"]').first().click()
      ]);

      await popup.waitForLoadState('networkidle');
      console.log(c.verde('  ✅ Ventana emergente "Lupa Unidades de Servicio" abierta.'));

      // Llenar datos en el popup
      console.log(c.cyan(`  📝 Ingresando código de la UDS: ${jardinSeleccionado.codigo}...`));
      
      // El id del input en el popup parece ser cphCont_txtCodigoUnidadServicio o similar
      await popup.locator('input[id*="txtCodigoUnidadServicio"], input[name*="CodigoUnidadServicio"]').first().fill(String(jardinSeleccionado.codigo));

      // Seleccionar BOGOTA D.C. en el departamento
      console.log(c.cyan('  📝 Seleccionando Departamento: BOGOTA D.C.'));
      // El select suele llamarse ddlDepartamento
      const ddlDepto = popup.locator('select[id*="ddlDepartamento"], select[name*="ddlDepartamento"]').first();
      // Seleccionamos BOGOTA D.C. por texto
      await ddlDepto.selectOption({ label: 'BOGOTA D.C.' }).catch(async () => {
          // Si falla, intentamos con BOGOTÁ D.C.
          await ddlDepto.selectOption({ label: 'BOGOTÁ D.C.' }).catch(() => {});
      });

      console.log(c.cyan('  🔍 Haciendo clic en buscar/aceptar dentro de la Lupa...'));
      // El botón de buscar del popup suele tener class o id con 'btnBuscar'
      await popup.locator('input[type="image"][id*="btnBuscar"], input[name*="btnBuscar"], a[id*="btnBuscar"]').first().click();

      // Esperar a que el popup se cierre y el frame principal se actualice
      console.log(c.amarillo('  ⏳ Esperando a que el sistema procese y cierre la Lupa...'));
      
      // Esperamos que el popup se haya cerrado o simplemente esperamos un par de segundos
      try {
          await popup.waitForEvent('close', { timeout: 10000 });
      } catch (e) {
          // A veces el postback no cierra la ventana inmediatamente si no hay resultados, pero si es correcto se cierra sola
      }
      
      console.log(c.verde(`\n  🎉 ¡Fase 1 completada! El sistema debería tener la UDS cargada.`));
      console.log(c.amarillo(`  ⏸️  El script se detendrá ahora para que puedas revisar la pantalla en el navegador.`));
      console.log(c.amarillo(`  (Cierra el script con Ctrl+C cuando estés listo para continuar con la Fase 2)`));
      
      // Rompemos el bucle para la fase 1, dejando el navegador abierto
      break;
    }
  } catch (err) {
    console.error(c.rojo(`\n  ❌ Error en el proceso: ${err.message}`));
  }
}

main();
