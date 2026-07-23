/**
 * descargar-reportes.js
 * Script base para navegar al módulo de reportes y preparar la automatización.
 *
 * Uso: npm run reportes
 */

require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const { login } = require('../servicios/autenticacion');

// ─────────────────────────────────────────────────────────────
// Colores en terminal
// ─────────────────────────────────────────────────────────────
const c = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
  rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
  gris:     (t) => `\x1b[90m${t}\x1b[0m`,
  negrita:  (t) => `\x1b[1m${t}\x1b[0m`,
};

// ─────────────────────────────────────────────────────────────
// Script Principal
// ─────────────────────────────────────────────────────────────
async function main() {
  const USUARIO = process.env.CUENTAME_USUARIO;
  const PASSWORD = process.env.CUENTAME_PASSWORD;
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

  if (!USUARIO || !PASSWORD) {
    console.error(c.rojo('\n❌ Faltan CUENTAME_USUARIO o CUENTAME_PASSWORD en el archivo .env\n'));
    process.exit(1);
  }

  console.log(c.cyan('\n  🌐 Abriendo navegador...\n'));
  const { leerJardines } = require('../servicios/excel-reader');
  
  // Cargar datos del Excel
  const RUTA_EXCEL = process.env.RUTA_EXCEL || 'C:\\GENERAL.xlsx';
  const { porAsociacion } = leerJardines(RUTA_EXCEL);
  const asociaciones = Object.values(porAsociacion);
  
  console.log(c.cyan('\n  🌐 Abriendo navegador...\n'));
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
    args: ['--start-maximized'],
    executablePath: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
  });
  
  const fs = require('fs');
  const context = await browser.newContext({ viewport: null });
  // Set default download path to a new "reportes" directory inside the project
  const reportesDir = path.join(__dirname, '..', 'reportes');
  if (!fs.existsSync(reportesDir)) {
      fs.mkdirSync(reportesDir, { recursive: true });
  }
  const page = await context.newPage();

  // 1. Iniciar sesión y pasar 2FA
  await login(page, {
    usuario: USUARIO,
    password: PASSWORD,
    gmailUser: GMAIL_USER,
    gmailAppPassword: GMAIL_APP_PASSWORD,
  });

  console.log(c.negrita(c.cyan(`\n  🚀 Navegando al menú de reportes...\n`)));

  try {
    // 2. Navegar en el menú izquierdo (acordeones)
    const menuReportesPrincipal = page.locator('text="REPORTES"').first();
    await Promise.all([
      page.waitForLoadState('networkidle'),
      menuReportesPrincipal.click()
    ]);
    await page.waitForTimeout(1000);

    const linksReportes = page.locator('a, span').filter({ hasText: /^Reportes$/ });
    if (await linksReportes.count() > 1) {
      await linksReportes.nth(1).click();
    } else {
      await linksReportes.first().click();
    }
    await page.waitForTimeout(1000);

    const menuBeneficiarios = page.locator('text="Beneficiarios"').first();
    await menuBeneficiarios.click();
    await page.waitForTimeout(1000);

    const menuBeneficiariosVinculados = page.locator('text="Beneficiarios vinculados"').first();
    await Promise.all([
      page.waitForLoadState('networkidle'),
      menuBeneficiariosVinculados.click()
    ]);
    
    console.log(c.verde('\n  ✅ Pantalla de reporte alcanzada. Iniciando descargas...\n'));
    
    // Obtener el frame del reporte
    await page.waitForTimeout(3000); // Dar tiempo al SSRS iframe a cargar
    
    // El contenido principal de Cuéntame se carga en un iframe llamado "frameContent"
    let reportFrame = page.frame({ name: 'frameContent' });
    if (!reportFrame) {
        console.log(c.rojo('  ⚠️ No se encontró el iframe "frameContent". Usando la página principal...'));
        reportFrame = page; 
    }

    // 3. Iterar por cada asociación
    for (const asc of asociaciones) {
      console.log(c.amarillo(`\n  ▶ Procesando Asociación: ${asc.nombreCorto}`));
      console.log(`    Contrato: ${asc.numeroContrato} (Vigencia: ${asc.vigenciaContrato})`);
      
      if (!asc.numeroContrato) {
        console.log(c.rojo(`    ⚠️ No se encontró contrato para esta asociación. Omitiendo...`));
        continue;
      }

      // 3.1. Llenar los campos con IDs exactos
      // Función helper simple
      const seleccionarSSRS = async (id, valueOrText) => {
          try {
              const selectLocator = reportFrame.locator(`#${id}`);
              await selectLocator.waitFor({ state: 'visible', timeout: 5000 });
              await selectLocator.selectOption({ label: valueOrText });
              // Esperar a que SSRS haga el postback y desbloquee el resto de selects
              await page.waitForTimeout(2000); 
          } catch (e) {
              console.log(c.rojo(`    ⚠️ Error al seleccionar en ${id}: ${e.message}`));
          }
      };

      await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl03_ddValue', 'Unidad de Servicio'); // Tipo Unidad
      await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl05_ddValue', 'Dirección de Primera Infancia'); // Dirección
      await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl09_ddValue', 'Bogota D.C.'); // Regional
      
      // NOTA: Centro Zonal y Municipio aparecen como 'disabled' en el HTML inicial.
      // Posiblemente se habiliten tras seleccionar Regional, SSRS hace refresh.
      await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl11_ddValue', 'CZ USAQUEN'); // Centro Zonal
      await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl13_ddValue', 'Bogota, D.C.'); // Municipio
      
      await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl07_ddValue', asc.vigenciaContrato); // Vigencia Contrato
      
      // Número Contrato
      await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl15_ddValue', asc.numeroContrato);
      
      await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl19_ddValue', '2026'); // Año de atención

      // 3.2. Código de la UDS -> Marcar checkbox NULL
      console.log('    👉 Marcando casilla NULL en Código de la UDS...');
      try {
          const nullCheckboxId = 'ctl00_cphCont_rvTransversarReportes_ctl04_ctl17_cbNull';
          const chkLocator = reportFrame.locator(`#${nullCheckboxId}`);
          const isChecked = await chkLocator.isChecked();
          if (!isChecked) {
              await chkLocator.check();
              await page.waitForTimeout(1000); // postback
          }
      } catch(e) {}

      // 3.3. Clic en "View Report"
      console.log('    👉 Generando reporte...');
      const viewReportBtn = reportFrame.locator('#ctl00_cphCont_rvTransversarReportes_ctl04_ctl00');
      await viewReportBtn.click();
      
      console.log('    ⏳ Esperando a que el sistema procese el reporte (esto puede tardar unos minutos)...');
      await page.waitForTimeout(10000); 
      await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(()=> {}); 

      // 3.4. Exportar a Excel
      console.log('    👉 Iniciando descarga en Excel...');
      
      const exportMenu = reportFrame.locator('a[title="Export"], a[title="Exportar"], img[alt="Export"]').first();
      if (await exportMenu.isVisible()) {
          await exportMenu.click();
          await page.waitForTimeout(1000);
          
          const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
          const excelOption = reportFrame.locator('a:has-text("Excel")').first();
          await excelOption.click();
          
          const download = await downloadPromise;
          const fileName = `Beneficiarios_${asc.nombreCorto.replace(/[^a-z0-9]/gi, '_')}.xlsx`;
          const savePath = path.join(reportesDir, fileName);
          await download.saveAs(savePath);
          console.log(c.verde(`    ✅ Descargado exitosamente: ${fileName}`));
      } else {
          console.log(c.rojo(`    ⚠️ No se encontró el botón de exportar. ¿Falló la generación del reporte?`));
      }
      
      console.log('    --------------------------------------------------');
    }

  } catch (err) {
    console.error(c.rojo(`\n❌ Error navegando al reporte:`), err.message);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(c.rojo('\n❌ Error inesperado:'), err.message);
  process.exit(1);
});
