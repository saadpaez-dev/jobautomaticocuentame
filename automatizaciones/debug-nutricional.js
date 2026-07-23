require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { login } = require('../servicios/autenticacion');
const { leerJardines } = require('../servicios/excel-reader');

async function main() {
  const USUARIO = process.env.CUENTAME_USUARIO;
  const PASSWORD = process.env.CUENTAME_PASSWORD;
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
  const RUTA_EXCEL = process.env.RUTA_EXCEL || 'C:\\Dev\\jobautomatico\\GENERAL_BOTS.xlsx';

  const browser = await chromium.launch({ headless: false, slowMo: 100, executablePath: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  const { porAsociacion } = leerJardines(RUTA_EXCEL);
  const nombreAsociacion = Object.values(porAsociacion)[0].nombreCorto;

  await login(page, {
    usuario: USUARIO,
    password: PASSWORD,
    gmailUser: GMAIL_USER,
    gmailAppPassword: GMAIL_APP_PASSWORD,
    nombreAsociacion: nombreAsociacion
  });

  console.log('Navegando a Seguimiento nutricional...');
  
  // En base al screenshot, REPORTES es un menú principal (posiblemente mayúsculas)
  const menuPrincipal = page.locator('text="REPORTES"').first();
  await menuPrincipal.click().catch(() => page.locator('text="Reportes"').first().click());
  await page.waitForTimeout(1000);

  // El submenú también dice Reportes
  const subMenu = page.locator('text="Reportes"').last();
  if (await subMenu.isVisible()) {
      await subMenu.click();
      await page.waitForTimeout(1000);
  }

  // Expandir Seguimiento nutricional
  const menuNutricional = page.locator('text="Seguimiento nutricional"').first();
  if (await menuNutricional.isVisible()) {
      await menuNutricional.click();
      await page.waitForTimeout(1000);
  }

  // Clic en Seguimiento nutricional de niños y niñas por toma
  const reporteFinal = page.locator('text="Seguimiento nutricional de niños y niñas por toma"').last();
  await reporteFinal.click();
  await page.waitForTimeout(5000);

  console.log('Esperando iframe...');
  let frame = page.frameLocator('#frameContent');
  const frameEl = await page.$('#frameContent');
  if (!frameEl) {
    frame = page; // Si no hay frame
  }

  // Esperar a que renderice algo
  await page.waitForTimeout(10000); // 10s extra para que cargue el SSRS

  // Extraer el HTML
  let html = '';
  if (frameEl) {
    html = await frame.locator('body').innerHTML();
  } else {
    html = await page.innerHTML('body');
  }

  const debugPath = path.join(__dirname, '..', 'reportes', 'debug_nutricional.html');
  fs.writeFileSync(debugPath, html, 'utf8');
  console.log('¡HTML guardado exitosamente en:', debugPath, '!');

  await browser.close();
}

main().catch(console.error);
