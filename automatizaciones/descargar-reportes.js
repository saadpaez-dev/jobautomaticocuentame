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

    // 3. Imprimir el HTML del frame para depurar
    console.log(c.amarillo('\n  🔍 Inspeccionando el DOM del reporte (SSRS)...'));
    
    try {
      const html = await reportFrame.content();
      const dumpPath = path.join(reportesDir, 'debug_ssrs.html');
      fs.writeFileSync(dumpPath, html, 'utf8');
      console.log(c.verde(`  ✅ HTML guardado en: ${dumpPath}`));
      
      const selects = await reportFrame.evaluate(() => {
        const results = [];
        document.querySelectorAll('select').forEach(sel => {
           results.push({ id: sel.id, name: sel.name, title: sel.title });
        });
        return results;
      });
      console.log(c.cyan('  Selects encontrados en el iframe:'));
      console.table(selects);

      const labels = await reportFrame.evaluate(() => {
        const results = [];
        document.querySelectorAll('label').forEach(lbl => {
           results.push({ text: lbl.textContent, for: lbl.htmlFor });
        });
        return results;
      });
      console.log(c.cyan('  Labels encontrados:'));
      console.table(labels);
      
      const tds = await reportFrame.evaluate(() => {
        const results = [];
        document.querySelectorAll('td').forEach(td => {
           const txt = td.textContent.trim();
           if (txt && txt.length < 30) {
               results.push({ text: txt });
           }
        });
        return results;
      });
      console.log(c.cyan('  Textos en TD (posibles labels):'));
      console.log(tds.map(t => t.text).filter(t => t.includes('Unidad') || t.includes('Contrato') || t.includes('Dirección')));

    } catch (e) {
      console.error('Error inspeccionando:', e);
    }
    
    console.log(c.rojo('\n  ⏸️ Deteniendo script aquí para analizar la consola.'));
    await page.waitForTimeout(60000);
    process.exit(0);

  } catch (err) {
    console.error(c.rojo(`\n❌ Error navegando al reporte:`), err.message);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(c.rojo('\n❌ Error inesperado:'), err.message);
  process.exit(1);
});
