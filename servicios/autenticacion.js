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
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.locator('input[value="Iniciar Sesión"], input[type="submit"]').first().click()
  ]);

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
    await Promise.all([
      page.waitForLoadState('networkidle'),
      page.locator('input[value="Verificar Código"], button:has-text("Verificar"), input[value*="Verificar"]').first().click()
    ]);
    // Darle tiempo extra a ASP.NET para asimilar el 2FA
    await page.waitForTimeout(3000);
  }

  // Verificar si pide selección de asociación/entidad
  const contenidoFinal = await page.content();
  if (contenidoFinal.includes('Seleccione la entidad')) {
    console.log('  🏢 Seleccionando entidad (asociación)...');
    
    // Esperar a que el select esté visible y habilitado
    const selectLocator = page.locator('select').first();
    await selectLocator.waitFor({ state: 'visible', timeout: 10000 });
    
    if (credenciales.nombreAsociacion) {
      // Buscar la opción que contenga el nombre corto de la asociación (ignorando mayúsculas/minúsculas)
      const nameToSearch = credenciales.nombreAsociacion.toUpperCase();
      console.log(`  Buscando asociación que coincida con: ${nameToSearch}`);
      const opciones = await selectLocator.locator('option').allInnerTexts();
      
      let indexToSelect = 1; // Default
      for (let i = 0; i < opciones.length; i++) {
          if (opciones[i].toUpperCase().includes(nameToSearch)) {
              indexToSelect = i;
              console.log(`  ✅ Encontrada coincidencia en el menú: ${opciones[i]}`);
              break;
          }
      }
      await selectLocator.selectOption({ index: indexToSelect });
    } else {
      // Seleccionar la primera opción válida si no se especifica
      await selectLocator.selectOption({ index: 1 });
    }
    
    // Darle tiempo al servidor si el dropdown tiene AutoPostBack
    await page.waitForTimeout(2000);
    
    // Click en el botón Continuar
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
      page.locator('input[value="Continuar"], button:has-text("Continuar")').first().click()
    ]);
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
