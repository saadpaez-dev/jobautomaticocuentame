require('dotenv').config();
const { chromium } = require('playwright');
const { login } = require('./servicios/autenticacion');

async function run() {
  console.log('Iniciando debug HTML...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await login(page, {
    usuario: process.env.CUENTAME_USUARIO,
    password: process.env.CUENTAME_PASSWORD,
    gmailUser: process.env.GMAIL_USER,
    gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
  });
  
  console.log('Navegando a Rub online...');
  const menuDestino = page.locator('text="Seguimiento formación a padres/cuidadores"').first();
  const submenuVisible = await menuDestino.isVisible();
  
  if (!submenuVisible) {
    await page.locator('text="Rub online"').first().click();
    await page.waitForTimeout(1000);
  }
  
  await menuDestino.click();
  await page.waitForTimeout(3000);
  
  console.log('Obteniendo HTML de todas las imagenes e inputs tipo imagen...');
  const elements = await page.locator('img, input[type="image"]').all();
  for (const el of elements) {
    try {
      const html = await el.evaluate(node => node.outerHTML);
      if (html.includes('src')) {
         console.log(html);
      }
    } catch(e) {}
  }
  
  console.log('Tomando captura completa de debug...');
  await page.screenshot({ path: 'logs/debug-pantalla.png', fullPage: true });
  
  await browser.close();
  console.log('Fin.');
}

run().catch(console.error);
