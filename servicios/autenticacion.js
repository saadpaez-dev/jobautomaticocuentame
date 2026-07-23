/**
 * autenticacion.js
 * Maneja el login completo al sistema Cuéntame incluyendo 2FA por correo.
 */

const { obtenerCodigo2FA } = require('./gmail-reader');

const URL_LOGIN = 'https://rubonline.icbf.gov.co/DefaultF.aspx';

/**
 * Realiza el login completo en el sistema Cuéntame.
 * Maneja usuario, contraseña, código 2FA y selección de asociación.
 *
 * @param {import('playwright').Page} page
 * @param {object} credenciales
 */
async function login(page, credenciales) {
  const { usuario, password, gmailUser, gmailAppPassword } = credenciales;

  console.log('\n  🔐 Iniciando login en el sistema Cuéntame...');
  const fechaInicio = new Date();
  await page.goto(URL_LOGIN, { waitUntil: 'networkidle', timeout: 30000 });

  // Llenar usuario y contraseña
  await page.locator('input[type="text"]').first().fill(usuario);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('input[value="Iniciar Sesión"], input[type="submit"]').first().click();

  await page.waitForTimeout(3000);

  // Verificar si la cuenta fue bloqueada por intentos fallidos
  const contenidoTras = await page.content();
  if (contenidoTras.includes('bloqueado') || contenidoTras.includes('número de intentos')) {
    throw new Error(
      '🔒 USUARIO BLOQUEADO: el sistema bloqueó la cuenta por demasiados intentos.\n' +
      '   Solución: ve a rubonline.icbf.gov.co y usa "¿Olvidaste tu Contraseña?" para desbloquear.'
    );
  }

  const tiene2FA = await detectar2FA(page);

  if (tiene2FA) {
    console.log('  🔑 El sistema solicita código 2FA...');

    // Leer el código del Gmail pasando el momento en que iniciamos el login
    const codigo = await obtenerCodigo2FA(gmailUser, gmailAppPassword, fechaInicio);
    console.log(); // salto de línea después del spinner

    // Ingresar el código
    const campoCodigo = page.locator('input[placeholder*="código"], input[placeholder*="codigo"], input[type="text"]').first();
    await campoCodigo.fill(codigo);

    // Click en botón "Verificar Código"
    await page.locator('input[value="Verificar Código"], button:has-text("Verificar"), input[value*="Verificar"]').first().click();

    await page.waitForTimeout(3000);
  }

  // Verificar si pide selección de asociación/entidad
  const contenidoFinal = await page.content();
  if (contenidoFinal.includes('Seleccione la entidad')) {
    console.log('  🏢 Seleccionando entidad (asociación)...');
    const selectores = await page.locator('select').all();
    if (selectores.length > 0) {
      // Seleccionar la primera opción válida (index 1 porque 0 es "Seleccione")
      await selectores[0].selectOption({ index: 1 });
      await page.waitForTimeout(1000);
      await page.locator('input[value="Continuar"], button:has-text("Continuar")').first().click();
      await page.waitForTimeout(4000);
    }
  }

  // Verificar que entramos correctamente al menú principal
  const urlActual = page.url();
  if (!urlActual.includes('MasterPrincipal') && !urlActual.includes('General')) {
    throw new Error('❌ Login fallido: no se pudo acceder al sistema Cuéntame tras pasar los filtros de seguridad.');
  }

  console.log('  ✅ Login exitoso en Cuéntame.\n');
}

/**
 * Detecta si la página actual es un campo de código 2FA.
 */
async function detectar2FA(page) {
  try {
    const url = page.url();
    const esLoginPage = url.includes('DefaultF.aspx');

    if (esLoginPage) {
      const contenido = await page.content();
      const menciona2FA =
        contenido.toLowerCase().includes('código') ||
        contenido.toLowerCase().includes('codigo') ||
        contenido.toLowerCase().includes('verificaci') ||
        contenido.toLowerCase().includes('enviado');

      return menciona2FA;
    }
    return false;
  } catch {
    return false;
  }
}

module.exports = { login };
