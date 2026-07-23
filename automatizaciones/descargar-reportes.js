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
  const browser = await chromium.launch({
    headless: false, // Debe ser false para que el usuario pueda ver el formulario
    slowMo: 100,
    args: ['--start-maximized'],
    executablePath: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
  });
  
  const context = await browser.newContext({ viewport: null });
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
    // El menú principal tiene un div o enlace que dice "REPORTES" (mayúsculas)
    console.log('  👉 Desplegando menú principal "REPORTES"...');
    const menuReportesPrincipal = page.locator('text="REPORTES"').first();
    await Promise.all([
      page.waitForLoadState('networkidle'),
      menuReportesPrincipal.click()
    ]);
    await page.waitForTimeout(1000);

    // Submenú "Reportes"
    console.log('  👉 Desplegando sub-menú "Reportes"...');
    // Buscamos el segundo elemento que diga Reportes o usamos un selector específico de los enlaces del panel izquierdo
    const linksReportes = page.locator('a, span').filter({ hasText: /^Reportes$/ });
    if (await linksReportes.count() > 1) {
      await linksReportes.nth(1).click();
    } else {
      await linksReportes.first().click();
    }
    await page.waitForTimeout(1000);

    // Categoría "Beneficiarios"
    console.log('  👉 Desplegando categoría "Beneficiarios"...');
    const menuBeneficiarios = page.locator('text="Beneficiarios"').first();
    await menuBeneficiarios.click();
    await page.waitForTimeout(1000);

    // Reporte final "Beneficiarios vinculados"
    console.log('  👉 Clic en reporte "Beneficiarios vinculados"...');
    const menuBeneficiariosVinculados = page.locator('text="Beneficiarios vinculados"').first();
    
    // Al dar click aquí, probablemente hace un postback y carga un iframe a la derecha
    await Promise.all([
      page.waitForLoadState('networkidle'),
      menuBeneficiariosVinculados.click()
    ]);
    
    console.log(c.verde('\n  ✅ Pantalla de reporte alcanzada.'));
    console.log(c.amarillo('  ⏳ PAUSA DE 2 MINUTOS: El script se mantendrá abierto para que puedas ver el formulario y contarme qué filtros aparecen (o mandarme un pantallazo).'));
    
    // Pausa súper larga para poder inspeccionar
    await page.waitForTimeout(120000);

  } catch (err) {
    console.error(c.rojo(`\n❌ Error navegando al reporte:`), err.message);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(c.rojo('\n❌ Error inesperado:'), err.message);
  process.exit(1);
});
