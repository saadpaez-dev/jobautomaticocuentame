/**
 * autenticacion.js
 * Maneja el login completo al sistema Cuéntame incluyendo 2FA por correo.
 */

const { chromium } = require('playwright');
const c = {
  verde: (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan: (t) => `\x1b[36m${t}\x1b[0m`,
  rojo: (t) => `\x1b[31m${t}\x1b[0m`,
  gris: (t) => `\x1b[90m${t}\x1b[0m`,
  negrita: (t) => `\x1b[1m${t}\x1b[0m`,
};
const { obtenerCodigo2FA, limpiarBuzon2FA } = require('./gmail-reader');

const URL_LOGIN = 'https://rubonline.icbf.gov.co/DefaultF.aspx';

/**
 * Realiza el login completo en el sistema Cuéntame.
 * Maneja usuario, contraseña, código 2FA y selección de asociación.
 *
 * @param {import('playwright').Page} page
 * @param {object} credenciales
 */
async function loginYLlegarARoles(page, credenciales) {
  const { usuario, password, gmailUser, gmailAppPassword } = credenciales;

  console.log('\n  🔐 Iniciando login en el sistema Cuéntame...');
  
  // Limpiar buzón 2FA ANTES de entrar, para no agarrar correos pasados
  await limpiarBuzon2FA(gmailUser, gmailAppPassword);

  const currentUrl = page.url();
  const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
  
  const esLoginO2FA = pageText.includes('Iniciar Sesión') || 
                      pageText.includes('Ingrese su código') || 
                      pageText.includes('Se ha enviado un código') || 
                      pageText.includes('¿Olvidaste tu Contraseña?');

  if (!esLoginO2FA && (currentUrl.includes('Roles.aspx') || currentUrl.includes('MasterPrincipal') || currentUrl.includes('General') || pageText.includes('Seleccione la entidad'))) {
      console.log('  ✅ Ya se detectó una sesión activa en Cuéntame. Omitiendo inicio de sesión.');
      if (!pageText.includes('Seleccione la entidad')) {
          console.log('  🔄 Navegando a la pantalla de selección de asociación...');
          await page.goto('https://rubonline.icbf.gov.co/DefaultF.aspx', { waitUntil: 'domcontentloaded' });
      }
      return;
  }

  const fechaInicio = new Date();
  
  // Verificar si la página YA está en la pantalla de 2FA
  let tiene2FA = await detectar2FA(page);

  if (!tiene2FA) {
    const MAX_INTENTOS = 3;
    let intentoActual = 0;

    while (intentoActual < MAX_INTENTOS) {
      intentoActual++;
      if (intentoActual > 1) {
        console.log(c.amarillo(`\n  🔄 Reintentando login (intento ${intentoActual} de ${MAX_INTENTOS})...`));
      }

      await page.goto(URL_LOGIN, { waitUntil: 'networkidle', timeout: 30000 });

      // Llenar usuario y contraseña
      await page.locator('input[type="text"]').first().fill(usuario);
      await page.locator('input[type="password"]').first().fill(password);

      const hasCaptcha = await page.locator('img[src*="Captcha"]:visible').count() > 0;

      if (hasCaptcha) {
        console.log('\n  ⚠️ CAPTCHA DETECTADO. Por favor, ingresa el Captcha y haz clic en "Iniciar Sesión" manualmente en el navegador.');
        console.log('  ⏳ Esperando a que inicies sesión...');

        let captchaActivo = true;
        while (captchaActivo) {
          try {
            await page.waitForNavigation({ timeout: 120000 });
            captchaActivo = await page.locator('img[src*="Captcha"]:visible').count() > 0;
            if (captchaActivo) {
              console.log('  ⚠️ El Captcha fue incorrecto. Por favor, inténtalo de nuevo.');
            }
          } catch (e) {
            captchaActivo = await page.locator('img[src*="Captcha"]').count() > 0;
          }
        }
        console.log('  ✅ Captcha resuelto exitosamente, continuando con el proceso automático...');
      } else {
        await Promise.all([
          page.waitForLoadState('networkidle'),
          page.locator('input[value="Iniciar Sesión"], input[type="submit"]').first().click()
        ]);
      }

      // ─── Verificar si la cuenta fue bloqueada ───────────────────────────────
      const contenidoTras = await page.content();
      if (contenidoTras.includes('bloqueado') || contenidoTras.includes('número de intentos')) {
        throw new Error(
          '🔒 CUENTA BLOQUEADA: el sistema bloqueó el usuario por demasiados intentos fallidos.\n' +
          '   ➡️  Solución: ve a rubonline.icbf.gov.co y usa "¿Olvidaste tu Contraseña?" para desbloquearte.\n' +
          '   ⚠️  NO vuelvas a intentar el login hasta desbloquear la cuenta.'
        );
      }

      // ─── Verificar si las credenciales fueron rechazadas ────────────────────
      const credencialesInvalidas = contenidoTras.includes('Usuario o contraseña incorrectos') ||
                                    contenidoTras.includes('Datos incorrectos') ||
                                    contenidoTras.includes('no válido') ||
                                    contenidoTras.includes('incorrecto');

      if (credencialesInvalidas) {
        if (intentoActual >= MAX_INTENTOS) {
          throw new Error(
            `🔒 Login fallido ${MAX_INTENTOS} veces seguidas. Se detuvo el proceso para EVITAR EL BLOQUEO de la cuenta.\n` +
            '   ➡️  Verifica que el usuario y contraseña en el archivo .env sean correctos.'
          );
        }
        console.log(c.rojo(`  ❌ Credenciales incorrectas. Intento ${intentoActual} de ${MAX_INTENTOS}.`));
        console.log(c.amarillo(`  ⚠️  CUIDADO: ${MAX_INTENTOS - intentoActual} intento(s) restante(s) antes del bloqueo.`));
        await page.waitForTimeout(2000);
        continue; // Reintentar
      }

      // ─── Si llegó aquí, las credenciales fueron aceptadas ────────────────
      break;
    }

    tiene2FA = await detectar2FA(page);
  }

  if (tiene2FA) {
    console.log('  🔑 El sistema solicita código 2FA...');

    // Leer el código del Gmail pasando el momento en que iniciamos el login
    const codigo = await obtenerCodigo2FA(gmailUser, gmailAppPassword, fechaInicio);
    console.log(); // salto de línea después del spinner

    // Ingresar el código
    const campoCodigo = page.locator('input[placeholder*="código" i], input[placeholder*="codigo" i], input[id*="Codigo" i], input[type="text"]:visible').first();
    await campoCodigo.fill(codigo);

    // Click en botón "Verificar Código"
    await Promise.all([
      page.waitForLoadState('networkidle').catch(() => {}),
      page.locator('input[value*="Verificar" i], button:has-text("Verificar"), input[type="submit"][value*="Verificar" i]').first().click()
    ]);
    // Darle tiempo extra a ASP.NET para asimilar el 2FA
    await page.waitForTimeout(3000);
  }

  // Verificar si pide selección de asociación/entidad
  const contenidoFinal = await page.content();
  if (contenidoFinal.includes('Seleccione la entidad')) {
    const rolesUrl = page.url();
    console.log(`  🔗 [DEBUG] URL de Roles detectada: ${rolesUrl}`);
    return rolesUrl; // Retornamos la URL de roles para poder duplicar pestañas
  }
  
  // Si no pide roles, verificamos que haya entrado directo
  await verificarLoginExitoso(page);
  return page.url();
}

async function seleccionarRolYEntrar(page, ascInput, mantenerRolesTab = false) {
  const nombreCorto = typeof ascInput === 'string' ? ascInput : ascInput.nombreCorto;
  const nombreLargo = typeof ascInput === 'string' ? '' : (ascInput.nombreLargo || '');

  let contenidoFinal = await page.content();
  let intentos = 0;
  const MAX_INTENTOS = 3;

  while (intentos < MAX_INTENTOS) {
      if (contenidoFinal.includes('Seleccione la entidad')) {
        if (intentos === 0) console.log('  🏢 Seleccionando entidad (asociación)...');
        
        // Esperar a que el select esté visible y habilitado
        let selectLocator = page.locator('select:visible').first();
        await selectLocator.waitFor({ state: 'visible', timeout: 10000 });
        
        if (nombreCorto) {
          const nameToSearch = nombreCorto.toUpperCase();
          if (intentos === 0) console.log(`  Buscando asociación que coincida con: ${nameToSearch}`);
          const opciones = await selectLocator.locator('option').allInnerTexts();
          
          let indexToSelect = 1; // Default
          let mejorSimilitud = -1;

          for (let i = 0; i < opciones.length; i++) {
              const optText = opciones[i].toUpperCase();
              if (optText.includes(nameToSearch)) {
                  // Si tenemos nombreLargo, usamos heurística de similitud para evitar falsos positivos
                  if (nombreLargo) {
                      const palabrasLargo = nombreLargo.toUpperCase().split(/[\s,.-]+/);
                      const palabrasOpt = optText.split(/[\s,.-]+/);
                      let coincidencias = 0;
                      for (const p of palabrasLargo) {
                          if (p.length > 3 && palabrasOpt.includes(p)) coincidencias++;
                      }
                      
                      if (coincidencias > mejorSimilitud) {
                          mejorSimilitud = coincidencias;
                          indexToSelect = i;
                      }
                  } else {
                      // Si no hay nombreLargo, usar la primera coincidencia
                      indexToSelect = i;
                      break;
                  }
              }
          }
          
          if (intentos === 0) console.log(`  ✅ Encontrada mejor coincidencia en el menú: ${opciones[indexToSelect]}`);
          await selectLocator.selectOption({ index: indexToSelect });
        } else {
          // Seleccionar la primera opción válida si no se especifica
          await selectLocator.selectOption({ index: 1 });
        }
        
        // Darle tiempo al servidor si el dropdown tiene AutoPostBack
        await page.waitForTimeout(3000);
        
        // --- VERIFICAR ERROR DE SERVIDOR DESPUÉS DEL POSTBACK ---
        let errorServidor = await page.evaluate(() => document.body.innerText.includes('Server Error in'));
        if (errorServidor) {
            intentos++;
            console.log(c.rojo(`  ❌ Cuéntame arrojó un Server Error 500. Reintentando (${intentos}/${MAX_INTENTOS})...`));
            await page.goto('https://rubonline.icbf.gov.co/DefaultF.aspx', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000);
            contenidoFinal = await page.content();
            continue;
        }
        
        // Si se pidió mantener la pestaña de roles intacta, obligamos al form a hacer POST a _blank
        if (mantenerRolesTab) {
            await page.evaluate(() => {
                if (document.forms.length > 0) document.forms[0].target = '_blank';
            });

            const [newPage] = await Promise.all([
                page.context().waitForEvent('page'),
                page.locator('input[value="Continuar"], button:has-text("Continuar")').first().click()
            ]);
            
            await newPage.waitForLoadState('networkidle');
            
            // Restaurar target por limpieza
            await page.evaluate(() => {
                if (document.forms.length > 0) document.forms[0].target = '';
            });
            
            await verificarLoginExitoso(newPage);
            return newPage;
        } else {
            // Comportamiento normal, usar la misma pestaña
            await Promise.all([
              page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(()=>{}),
              page.locator('input[value="Continuar"], button:has-text("Continuar")').first().click()
            ]);
            
            errorServidor = await page.evaluate(() => document.body.innerText.includes('Server Error in'));
            if (errorServidor) {
                intentos++;
                console.log(c.rojo(`  ❌ Server Error 500 al presionar Continuar. Reintentando (${intentos}/${MAX_INTENTOS})...`));
                await page.goto('https://rubonline.icbf.gov.co/DefaultF.aspx', { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(2000);
                contenidoFinal = await page.content();
                continue;
            }

            await verificarLoginExitoso(page);
            return page;
        }
      }
      break; // Salir del loop si no pide entidad
  }
  
  if (intentos >= MAX_INTENTOS) {
      throw new Error('El servidor de Cuéntame arrojó demasiados errores 500. Por favor, intenta de nuevo más tarde.');
  }
  
  // Fallback si no había dropdown de entidad (ya estaba seleccionada)
  return page;
}

async function verificarLoginExitoso(page) {
  // Verificar que entramos correctamente al menú principal
  const urlActual = page.url();
  const pageText = await page.evaluate(() => document.body.innerText.substring(0, 1000));
  
  if (!urlActual.includes('MasterPrincipal') && !urlActual.includes('General')) {
    throw new Error(`❌ Login fallido: URL incorrecta tras pasar filtros de seguridad.\n  URL Actual: ${urlActual}\n  Contenido: ${pageText.replace(/\n/g, ' ')}`);
  }

  // Verificar falso positivo por Server.Transfer de ASP.NET (URL de MasterPrincipal pero contenido de Login)
  if (pageText.toLowerCase().includes('iniciar sesión') || pageText.toLowerCase().includes('contraseña') && pageText.toLowerCase().includes('usuario')) {
    throw new Error(`❌ Login fallido: La sesión expiró o Cuéntame te redirigió al Login internamente.\n  URL Actual: ${urlActual}`);
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

/**
 * Mantiene la compatibilidad con el script original.
 */
async function login(page, credenciales) {
  await loginYLlegarARoles(page, credenciales);
  await seleccionarRolYEntrar(page, credenciales.nombreAsociacion);
}

module.exports = {
  loginYLlegarARoles,
  seleccionarRolYEntrar,
  obtenerNavegador,
  verificarConexionOCaida
};

/**
 * Verifica si la sesión se ha perdido o si hay un error crítico del servidor.
 * Devuelve true si la sesión se perdió y requiere re-login.
 */
async function verificarConexionOCaida(page) {
    try {
        if (!page || page.isClosed()) return true;

        // Verificar si la URL nos mandó al Login o fuera del sistema
        const urlActual = page.url();
        if (urlActual.includes('DefaultF.aspx') || urlActual.includes('Login')) return true;

        const pageText = await page.evaluate(() => document.body.innerText.substring(0, 2000)).catch(() => '');
        
        // Falso positivo: URL correcta pero contenido de Login
        if (pageText.includes('¿Olvidaste tu Contraseña?') || pageText.includes('Iniciar Sesión')) return true;
        
        // Error de servidor
        if (pageText.includes('Server Error in') || pageText.includes('Runtime Error')) {
            console.log(c.rojo('  ⚠️ Servidor de Cuéntame arrojó un Error 500 (Server Error).'));
            return true;
        }

        return false;
    } catch (e) {
        // Si el contexto del navegador fue destruido o target closed
        return true;
    }
}

/**
 * Intenta conectarse a un navegador existente en modo depuración (puerto 9222).
 * Si no lo encuentra, lanza un navegador nuevo en modo Bot Automático.
 */
async function obtenerNavegador() {
    try {
        console.log(c.cyan('\n  🔍 Buscando navegador en Modo Humano (Puerto 9222)...'));
        const browser = await chromium.connectOverCDP('http://localhost:9222');
        console.log(c.verde('  ✅ Conectado al navegador del usuario exitosamente.'));
        
        const context = browser.contexts()[0];
        let cuentamePage = null;
        
        // Buscar si el usuario ya tiene la pestaña de Cuéntame abierta
        for (const page of context.pages()) {
            if (page.url().includes('rubonline.icbf.gov.co')) {
                cuentamePage = page;
                break;
            }
        }
        
        if (!cuentamePage) {
            console.log(c.amarillo('  ⚠️ No se encontró una pestaña de Cuéntame abierta. Creando una nueva...'));
            cuentamePage = await context.newPage();
            await cuentamePage.goto('https://rubonline.icbf.gov.co/DefaultF.aspx');
        } else {
            // Traer la pestaña al frente
            await cuentamePage.bringToFront();
        }
        
        return { browser, context, page: cuentamePage, isCDP: true };
    } catch (e) {
        console.log(c.gris('  ℹ️ No se detectó navegador en Modo Humano. Abriendo Bot Automático...'));
        const browser = await chromium.launch({
            headless: false,
            slowMo: 100,
            args: ['--start-maximized', '--disable-blink-features=AutomationControlled']
        });
        const context = await browser.newContext({ viewport: null });
        const page = await context.newPage();
        return { browser, context, page, isCDP: false };
    }
}
