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

  const { leerJardines } = require('../servicios/excel-reader');
  const readline = require('readline-sync');
  
  // Cargar datos del Excel
  const RUTA_EXCEL = process.env.RUTA_EXCEL || 'C:\\GENERAL.xlsx';
  const { porAsociacion } = leerJardines(RUTA_EXCEL);
  let asociaciones = Object.values(porAsociacion);
  
  console.log(c.cyan('\n  📋 Selecciona el Reporte a generar:'));
  console.log(c.amarillo(`  1. Beneficiarios vinculados`));
  console.log(c.amarillo(`  2. Seguimiento nutricional de niños y niñas por toma`));
  
  let opcionReporte = -1;
  while (opcionReporte < 1 || opcionReporte > 2) {
    const respuesta = readline.question(c.negrita('\n  👉 Ingresa el numero del reporte (1 o 2): '));
    opcionReporte = parseInt(respuesta, 10);
    if (isNaN(opcionReporte)) opcionReporte = -1;
  }
  
  let seleccionToma = '(Select All)';
  if (opcionReporte === 2) {
    console.log(c.cyan('\n  📋 Selecciona el mes de Toma:'));
    console.log(c.gris(`  Puedes escribir "(Select All)" o el nombre exacto como "Julio".`));
    const respuestaToma = readline.question(c.negrita('\n  👉 Ingresa la Toma [por defecto (Select All)]: '));
    if (respuestaToma.trim() !== '') {
        seleccionToma = respuestaToma.trim();
    }
  }

  console.log(c.cyan('\n  📋 Selecciona la Asociación para procesar:'));
  console.log(c.amarillo(`  0. 🌟 TODAS LAS ASOCIACIONES`));
  asociaciones.forEach((asc, idx) => {
    console.log(`  ${idx + 1}. ${asc.nombreCorto} (Contrato: ${asc.numeroContrato || 'N/A'})`);
  });
  
  let opcion = -1;
  while (opcion < 0 || opcion > asociaciones.length) {
    const respuesta = readline.question(c.negrita('\n  👉 Ingresa el numero de la opcion: '));
    opcion = parseInt(respuesta, 10);
    if (isNaN(opcion)) opcion = -1;
  }
  
  if (opcion > 0) {
    asociaciones = [asociaciones[opcion - 1]];
  }
  
  console.log(c.cyan('\n  🌐 Abriendo navegador...\n'));
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
    args: ['--start-maximized'],
    executablePath: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
  });
  
  const fs = require('fs');
  const reportesDir = path.join(__dirname, '..', 'reportes');
  if (!fs.existsSync(reportesDir)) {
      fs.mkdirSync(reportesDir, { recursive: true });
  }

  // Iterar por cada asociación
  for (const asc of asociaciones) {
      console.log(c.amarillo(`\n======================================================`));
      console.log(c.amarillo(`▶ Iniciando proceso para Asociación: ${asc.nombreCorto}`));
      console.log(c.amarillo(`======================================================`));
      console.log(`    Contrato: ${asc.numeroContrato} (Vigencia: ${asc.vigenciaContrato})`);
      
      if (!asc.numeroContrato) {
        console.log(c.rojo(`    ⚠️ No se encontró contrato para esta asociación. Omitiendo...`));
        continue;
      }

      const context = await browser.newContext({ viewport: null });
      const page = await context.newPage();

      try {
        // 1. Iniciar sesión y pasar 2FA
        await login(page, {
          usuario: USUARIO,
          password: PASSWORD,
          gmailUser: GMAIL_USER,
          gmailAppPassword: GMAIL_APP_PASSWORD,
          nombreAsociacion: asc.nombreCorto
        });

        // 2. Navegar a Reportes -> Beneficiarios vinculados
        console.log('  🚀 Navegando al menú de reportes...\n');
        
        await page.goto('https://rubonline.icbf.gov.co/Page/Reportes/TransversalReportes/List.aspx?oRp=1170', {
          waitUntil: 'networkidle',
          timeout: 60000
        });

        console.log(c.verde('  ✅ Pantalla de reporte alcanzada. Iniciando descargas...\n'));
        await page.waitForTimeout(3000); // Dar tiempo al SSRS iframe a cargar
        
        // El contenido principal de Cuéntame se carga en un iframe llamado "frameContent"
        let reportFrame = page.frame({ name: 'frameContent' });
        if (!reportFrame) {
            console.log(c.rojo('  ⚠️ No se encontró el iframe "frameContent". Usando la página principal...'));
            reportFrame = page; 
        }

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

        const seleccionarSSRSMulti = async (id, valueOrText) => {
            try {
                const btn = reportFrame.locator(`#${id}_ddDropDownButton`);
                await btn.waitFor({ state: 'visible', timeout: 5000 });
                await btn.click();
                
                const divDropdown = reportFrame.locator(`#${id}_divDropDown`);
                await divDropdown.waitFor({ state: 'visible', timeout: 5000 });
                
                const escapedText = valueOrText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const labelLocator = divDropdown.locator('label').filter({ hasText: new RegExp(`^\\s*${escapedText}\\s*$`, 'i') }).first();
                await labelLocator.waitFor({ state: 'visible', timeout: 5000 });
                
                await labelLocator.click();
                
                // Cerrar menú y disparar postback
                await reportFrame.locator('body').click();
                await page.waitForTimeout(2000); 
            } catch (e) {
                console.log(c.rojo(`    ⚠️ Error al seleccionar múltiple en ${id}: ${e.message}`));
            }
        };

        if (opcionReporte === 1) {
            console.log('  🚀 Navegando a Reportes -> Beneficiarios vinculados...\n');
            await page.goto('https://rubonline.icbf.gov.co/Page/Reportes/TransversalReportes/List.aspx?oRp=1170', {
              waitUntil: 'networkidle',
              timeout: 60000
            });
            console.log(c.verde('  ✅ Pantalla de reporte alcanzada...\n'));
            await page.waitForTimeout(3000);
            
            reportFrame = page.frame({ name: 'frameContent' }) || page;

            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl03_ddValue', 'Unidad de Servicio');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl05_ddValue', 'Dirección de Primera Infancia');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl09_ddValue', 'Bogota D.C.');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl11_ddValue', 'CZ USAQUEN');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl13_ddValue', 'Bogota, D.C.');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl07_ddValue', asc.vigenciaContrato);
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl15_ddValue', asc.numeroContrato);
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl19_ddValue', '2026');
            
            console.log('    👉 Marcando casilla NULL en Código de la UDS...');
            try {
                const nullCheckboxId = 'ctl00_cphCont_rvTransversarReportes_ctl04_ctl17_cbNull';
                const chkLocator = reportFrame.locator(`#${nullCheckboxId}`);
                if (!(await chkLocator.isChecked())) {
                    await chkLocator.check();
                    await page.waitForTimeout(1000);
                }
            } catch(e) {}
        } else if (opcionReporte === 2) {
            console.log('  🚀 Navegando a Reportes -> Seguimiento nutricional de niños y niñas...\n');
            await page.goto('https://rubonline.icbf.gov.co/Page/Reportes/TransversalReportes/List.aspx?oRp=1177', {
              waitUntil: 'networkidle',
              timeout: 60000
            });
            console.log(c.verde('  ✅ Pantalla de reporte alcanzada...\n'));
            await page.waitForTimeout(3000);
            
            reportFrame = page.frame({ name: 'frameContent' }) || page;

            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl03_ddValue', 'Dirección de Primera Infancia');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl05_ddValue', 'Bogota D.C.');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl07_ddValue', 'CZ USAQUEN');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl09_ddValue', 'Bogota, D.C.');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl11_ddValue', asc.vigenciaContrato || '2026');
            
            await seleccionarSSRSMulti('ctl00_cphCont_rvTransversarReportes_ctl04_ctl15', '(Select All)');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl17_ddValue', 'Mensual');
            await seleccionarSSRSMulti('ctl00_cphCont_rvTransversarReportes_ctl04_ctl13', '(Select All)');
            await seleccionarSSRSMulti('ctl00_cphCont_rvTransversarReportes_ctl04_ctl19', seleccionToma);
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl21_ddValue', 'NO');
        }

        // Clic en "View Report"
        console.log('    👉 Generando reporte...');
        const viewReportBtn = reportFrame.locator('#ctl00_cphCont_rvTransversarReportes_ctl04_ctl00');
        await viewReportBtn.click();
        
        console.log('    ⏳ Esperando a que el sistema procese el reporte (esto puede tardar unos minutos)...');
        await page.waitForTimeout(10000); 
        await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(()=> {}); 

        // Exportar a Excel
        console.log('    👉 Iniciando descarga en Excel...');
        
        const exportMenu = reportFrame.locator('a[title="Export"], a[title="Exportar"], img[alt="Export"]').first();
        if (await exportMenu.isVisible()) {
            await exportMenu.click();
            await page.waitForTimeout(1000);
            
            const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
            const excelOption = reportFrame.locator('a:has-text("Excel")').first();
            await excelOption.click();
            
            const download = await downloadPromise;
            const prefijo = opcionReporte === 1 ? 'Beneficiarios' : 'Nutricion';
            const fileName = `${prefijo}_${asc.nombreCorto.replace(/[^a-z0-9]/gi, '_')}.xlsx`;
            const savePath = path.join(reportesDir, fileName);
            await download.saveAs(savePath);
            console.log(c.verde(`    ✅ Descargado exitosamente: ${fileName}`));
        } else {
            console.log(c.rojo(`    ⚠️ No se encontró el botón de exportar. ¿Falló la generación del reporte?`));
        }
        
      } catch (err) {
        console.error(c.rojo(`\n❌ Error procesando la asociación ${asc.nombreCorto}:`), err.message);
      } finally {
        console.log('    🧹 Cerrando sesión y limpiando contexto...');
        await context.close();
      }
      
      console.log('    --------------------------------------------------');
    }

  await browser.close();
}

main().catch((err) => {
  console.error(c.rojo('\n❌ Error inesperado:'), err.message);
  process.exit(1);
});
