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
    
    // El SSRS normalmente usa un iframe principal
    // Vamos a buscar el frame. Si no hay frame, usaremos page.
    let reportFrame = page.frames().find(f => f.url().includes('ReportViewer') || f.url().includes('ReportServer'));
    if (!reportFrame) {
        // En algunos casos no es un iframe, o el iframe no tiene url distintiva.
        // Asumimos que los elementos están en la página principal si no encontramos el frame
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

      // Llenar formulario SSRS
      // Función helper para seleccionar en dropdowns de SSRS (usualmente son selectores que están junto a su label)
      // Como no conocemos los IDs exactos, usamos una estrategia que busca el <select> en el DOM.
      // O, como SSRS usa IDs terminados en _ddValue, podemos intentar localizar por el contenido actual si es posible.
      
      const seleccionarSSRS = async (labelName, valueOrText) => {
          // Buscamos el div/span que contiene el texto del label exacto
          // y luego tomamos el select más cercano o que le sigue.
          // En SSRS los selects tienen IDs largos
          try {
              // Un enfoque robusto es evaluar en el navegador para encontrar el select que está cerca del label
              const selectId = await reportFrame.evaluate((name) => {
                  const td = Array.from(document.querySelectorAll('td')).find(el => el.textContent.trim() === name || el.textContent.trim() === name + ' *');
                  if (!td) return null;
                  // El select suele estar en un td hermano o padre cercano
                  const select = td.parentElement.querySelector('select') || td.nextElementSibling?.querySelector('select');
                  return select ? select.id : null;
              }, labelName);

              if (selectId) {
                  const selectLocator = reportFrame.locator(`#${selectId}`);
                  await selectLocator.waitFor({ state: 'visible', timeout: 5000 });
                  
                  // Para SSRS a veces hay que seleccionar por label (texto)
                  // Validar si valueOrText es numérico (como año) o texto
                  await selectLocator.selectOption({ label: valueOrText });
                  // SSRS requiere a veces esperar un postback de red si las dependencias se actualizan
                  await page.waitForTimeout(2000); 
              } else {
                  console.log(c.rojo(`    ⚠️ No se encontró el campo: ${labelName}`));
              }
          } catch (e) {
              console.log(c.rojo(`    ⚠️ Error al seleccionar ${labelName}: ${e.message}`));
          }
      };

      // 3.1. Llenar los campos
      await seleccionarSSRS('Tipo Unidad', 'Unidad de Servicio');
      await seleccionarSSRS('Dirección', 'Dirección de Primera Infancia');
      await seleccionarSSRS('Regional', 'Bogota D.C.');
      await seleccionarSSRS('Centro Zonal de la UDS', 'CZ USAQUEN');
      await seleccionarSSRS('Municipio', 'Bogota, D.C.');
      await seleccionarSSRS('Vigencia Contrato', asc.vigenciaContrato);
      
      // Número Contrato
      await seleccionarSSRS('Número Contrato', asc.numeroContrato);
      
      await seleccionarSSRS('Año de atención', '2026');

      // 3.2. Código de la UDS -> Marcar checkbox NULL
      console.log('    👉 Marcando casilla NULL en Código de la UDS...');
      try {
          const nullCheckboxId = await reportFrame.evaluate(() => {
              const td = Array.from(document.querySelectorAll('td')).find(el => el.textContent.trim() === 'Código de la UDS');
              if (!td) return null;
              // El checkbox de NULL suele estar cerca del input text, con el texto "NULL"
              const lbl = Array.from(td.parentElement.querySelectorAll('label')).find(l => l.textContent.trim() === 'NULL');
              if (lbl && lbl.htmlFor) return lbl.htmlFor;
              // Alternativa: buscar input type checkbox next to text
              const chk = td.parentElement.querySelector('input[type="checkbox"]');
              return chk ? chk.id : null;
          });
          
          if (nullCheckboxId) {
              const chkLocator = reportFrame.locator(`#${nullCheckboxId}`);
              const isChecked = await chkLocator.isChecked();
              if (!isChecked) {
                  await chkLocator.check();
                  await page.waitForTimeout(1000); // postback
              }
          }
      } catch(e) {}

      // 3.3. Clic en "Ver Reporte"
      console.log('    👉 Generando reporte...');
      // SSRS usa "View Report" o "Ver informe" en inputs type submit
      const viewReportBtn = reportFrame.locator('input[type="submit"][value*="Report"], input[type="submit"][value*="informe"], input[type="submit"][value*="reporte"], input[name$="SubmitButton"]').first();
      await viewReportBtn.click();
      
      // Esperar a que el spinner desaparezca o cargue el reporte
      // En SSRS hay un div que dice "Loading..." o AsyncWait
      console.log('    ⏳ Esperando a que el sistema procese el reporte (esto puede tardar unos minutos)...');
      await page.waitForTimeout(10000); // Espera inicial obligatoria
      // Detectar fin de carga (estrategia genérica)
      await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(()=> {}); 

      // 3.4. Exportar a Excel
      console.log('    👉 Iniciando descarga en Excel...');
      
      // SSRS Export Menu: Primero click en el icono de exportar (un disquete)
      const exportMenu = reportFrame.locator('a[title*="Export"], a[title*="Exportar"], img[alt*="Export"]').first();
      if (await exportMenu.isVisible()) {
          await exportMenu.click();
          await page.waitForTimeout(1000);
          
          // Preparar para recibir la descarga
          const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
          
          // Clic en la opción de Excel
          // Normalmente es un link con texto "Excel"
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
