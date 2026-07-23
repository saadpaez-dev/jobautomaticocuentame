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
  
  // En lugar de hacer clic en el menú (que es inestable), 
  // vamos directo a la URL del reporte que nos reveló el log
  await page.goto('https://rubonline.icbf.gov.co/Page/Reportes/TransversalReportes/List.aspx?oRp=1177', {
    waitUntil: 'networkidle',
    timeout: 60000
  });

  console.log('Esperando a que cargue el reporte...');
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
