/**
 * autenticacion.js
 * Maneja el login completo al sistema Cuentame incluyendo 2FA por correo.
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
 * Realiza el login completo en el sistema Cuentame.
 * Maneja usuario, contrasena, codigo 2FA y seleccion de asociacion.
 *
 * @param {import('playwright').Page} page
 * @param {object} credenciales
 */
async function loginYLlegarARoles(page, credenciales) {
  const { usuario, password, gmailUser, gmailAppPassword } = credenciales;

  console.log('\n  🔐 Iniciando login en el sistema Cuentame...');
  
  // Limpiar buzon 2FA ANTES de entrar, para no agarrar correos pasados
  await limpiarBuzon2FA(gmailUser, gmailAppPassword);

  const currentUrl = page.url();
  const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
  const pageTextClean = removeAccents(pageText);
  
  const esLoginO2FA = pageTextClean.includes('INICIAR SESION') || 
                      pageTextClean.includes('INGRESE SU CODIGO') || 
                      pageTextClean.includes('SE HA ENVIADO UN CODIGO') || 
                      pageTextClean.includes('OLVIDASTE TU CONTRASEÑA') ||
                      pageTextClean.includes('OLVIDASTE TU CONTRASENA');

  if (!esLoginO2FA && (currentUrl.includes('Roles.aspx') || currentUrl.includes('MasterPrincipal') || currentUrl.includes('General') || pageTextClean.includes('SELECCIONE LA ENTIDAD'))) {
      console.log('  ✅ Ya se detecto una sesion activa en Cuentame. Omitiendo inicio de sesion.');
      return;
  }

  const fechaInicio = new Date();
  
  // Verificar si la pagina YA esta en la pantalla de 2FA
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

      // Llenar usuario y contrasena
      await page.locator('input[type="text"]').first().fill(usuario);
      await page.locator('input[type="password"]').first().fill(password);

      const hasCaptcha = await page.locator('img[src*="Captcha"]:visible').count() > 0;

      if (hasCaptcha) {
        console.log('\n  ⚠️ CAPTCHA DETECTADO. Por favor, ingresa el Captcha y haz clic en "Iniciar Sesion" manualmente en el navegador.');
        console.log('  ⏳ Esperando a que inicies sesion...');

        let captchaActivo = true;
        while (captchaActivo) {
          try {
            await page.waitForNavigation({ timeout: 120000 });
            captchaActivo = await page.locator('img[src*="Captcha"]:visible').count() > 0;
            if (captchaActivo) {
              console.log('  ⚠️ El Captcha fue incorrecto. Por favor, intentalo de nuevo.');
            }
          } catch (e) {
            captchaActivo = await page.locator('img[src*="Captcha"]').count() > 0;
          }
        }
        console.log('  ✅ Captcha resuelto exitosamente, continuando con el proceso automatico...');
      } else {
        await Promise.all([
          page.waitForLoadState('networkidle'),
          page.locator('input[value="Iniciar Sesion"], input[type="submit"]').first().click()
        ]);
      }

      // ─── Verificar si la cuenta fue bloqueada ───────────────────────────────
      const contenidoTras = await page.content();
      if (contenidoTras.includes('bloqueado') || contenidoTras.includes('numero de intentos')) {
        throw new Error(
          '🔒 CUENTA BLOQUEADA: el sistema bloqueo el usuario por demasiados intentos fallidos.\n' +
          '   ➡️  Solucion: ve a rubonline.icbf.gov.co y usa "Olvidaste tu Contrasena?" para desbloquearte.\n' +
          '   ⚠️  NO vuelvas a intentar el login hasta desbloquear la cuenta.'
        );
      }

      // ─── Verificar si las credenciales fueron rechazadas ────────────────────
      const credencialesInvalidas = contenidoTras.includes('Usuario o contrasena incorrectos') ||
                                    contenidoTras.includes('Datos incorrectos') ||
                                    contenidoTras.includes('no valido') ||
                                    contenidoTras.includes('incorrecto');

      if (credencialesInvalidas) {
        if (intentoActual >= MAX_INTENTOS) {
          throw new Error(
            `🔒 Login fallido ${MAX_INTENTOS} veces seguidas. Se detuvo el proceso para EVITAR EL BLOQUEO de la cuenta.\n` +
            '   ➡️  Verifica que el usuario y contrasena en el archivo .env sean correctos.'
          );
        }
        console.log(c.rojo(`  ❌ Credenciales incorrectas. Intento ${intentoActual} de ${MAX_INTENTOS}.`));
        console.log(c.amarillo(`  ⚠️  CUIDADO: ${MAX_INTENTOS - intentoActual} intento(s) restante(s) antes del bloqueo.`));
        await page.waitForTimeout(2000);
        continue; // Reintentar
      }

      // ─── Si llego aqui, las credenciales fueron aceptadas ────────────────
      break;
    }

    tiene2FA = await detectar2FA(page);
  }

  if (tiene2FA) {
    console.log('  🔑 El sistema solicita codigo 2FA...');

    // Leer el codigo del Gmail pasando el momento en que iniciamos el login
    const codigo = await obtenerCodigo2FA(gmailUser, gmailAppPassword, fechaInicio);
    console.log(); // salto de linea despues del spinner

    // Ingresar el codigo
    const campoCodigo = page.locator('input[placeholder*="codigo" i], input[placeholder*="codigo" i], input[id*="Codigo" i], input[type="text"]:visible').first();
    await campoCodigo.fill(codigo);

    // Click en boton "Verificar Codigo"
    await Promise.all([
      page.waitForLoadState('networkidle').catch(() => {}),
      page.locator('input[value*="Verificar" i], button:has-text("Verificar"), input[type="submit"][value*="Verificar" i]').first().click()
    ]);
    // Darle tiempo extra a ASP.NET para asimilar el 2FA
    await page.waitForTimeout(3000);
  }

  // Verificar si pide seleccion de asociacion/entidad
  const contenidoFinal = await page.content();
  const contenidoFinalClean = removeAccents(contenidoFinal);
  if (contenidoFinalClean.includes('SELECCIONE LA ENTIDAD')) {
    const rolesUrl = page.url();
    console.log(`  🔗 [DEBUG] URL de Roles detectada: ${rolesUrl}`);
    return rolesUrl; // Retornamos la URL de roles para poder duplicar pestanas
  }
  
  // Si no pide roles, verificamos que haya entrado directo
  await verificarLoginExitoso(page);
  return page.url();
}

async function seleccionarRolYEntrar(page, ascInput, mantenerRolesTab = false) {
  const nombreCorto = typeof ascInput === 'string' ? ascInput : ascInput.nombreCorto;
  const nombreLargo = typeof ascInput === 'string' ? '' : (ascInput.nombreLargo || '');

  let contenidoFinal = await page.content();
  let contenidoFinalClean = removeAccents(contenidoFinal);

  // Si la pagina actual no esta en la pantalla de seleccion de entidad (DefaultF.aspx),
  // forzar la navegacion a DefaultF.aspx para elegir la nueva asociacion limpia
  if (!contenidoFinalClean.includes('SELECCIONE LA ENTIDAD')) {
      console.log(c.amarillo('  ⏳ Navegando a la pantalla de seleccion de asociacion (DefaultF.aspx)...'));
      try {
          await page.goto('https://rubonline.icbf.gov.co/DefaultF.aspx', { waitUntil: 'networkidle', timeout: 30000 });
          await page.waitForTimeout(1500);
      } catch(e) {}
      contenidoFinal = await page.content();
      contenidoFinalClean = removeAccents(contenidoFinal);
  }

  let intentos = 0;
  const MAX_INTENTOS = 3;

  while (intentos < MAX_INTENTOS) {
      if (contenidoFinalClean.includes('SELECCIONE LA ENTIDAD')) {
        if (intentos === 0) console.log('  🏢 Seleccionando entidad (asociacion)...');
        
        // Esperar a que el select este visible y habilitado
        let selectLocator = page.locator('select:visible').first();
        await selectLocator.waitFor({ state: 'visible', timeout: 10000 });
        
        if (nombreCorto) {
          const nameToSearch = nombreCorto.toUpperCase();
          if (intentos === 0) console.log(`  Buscando asociacion que coincida con: ${nameToSearch}`);
          const opciones = await selectLocator.locator('option').allInnerTexts();
          
          let indexToSelect = 1; // Default
          let mejorSimilitud = -1;

          for (let i = 0; i < opciones.length; i++) {
              const optText = opciones[i].toUpperCase();
              if (optText.includes(nameToSearch)) {
                  // Si tenemos nombreLargo, usamos heuristica de similitud para evitar falsos positivos
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
          
          if (intentos === 0) console.log(`  ✅ Encontrada mejor coincidencia en el menu: ${opciones[indexToSelect]}`);
          await selectLocator.selectOption({ index: indexToSelect });
        } else {
          // Seleccionar la primera opcion valida si no se especifica
          await selectLocator.selectOption({ index: 1 });
        }
        
        // Darle tiempo al servidor si el dropdown tiene AutoPostBack
        await page.waitForTimeout(3000);
        
        // --- VERIFICAR ERROR DE SERVIDOR DESPUES DEL POSTBACK ---
        let errorServidor = await page.evaluate(() => document.body.innerText.includes('Server Error in'));
        if (errorServidor) {
            intentos++;
            console.log(c.rojo(`  ❌ Cuentame arrojo un Server Error 500. Reintentando (${intentos}/${MAX_INTENTOS})...`));
            await page.goto('https://rubonline.icbf.gov.co/DefaultF.aspx', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000);
            contenidoFinal = await page.content();
            contenidoFinalClean = removeAccents(contenidoFinal);
            continue;
        }
        
        // Si se pidio mantener la pestana de roles intacta, obligamos al form a hacer POST a _blank
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
            // Comportamiento normal, usar la misma pestana
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
      throw new Error('El servidor de Cuentame arrojo demasiados errores 500. Por favor, intenta de nuevo mas tarde.');
  }
  
  // Fallback si no habia dropdown de entidad (ya estaba seleccionada)
  return page;
}

async function verificarLoginExitoso(page) {
  // Verificar que entramos correctamente al menu principal
  const urlActual = page.url();
  const pageText = await page.evaluate(() => document.body.innerText.substring(0, 1000));
  
  if (!urlActual.includes('MasterPrincipal') && !urlActual.includes('General')) {
    throw new Error(`❌ Login fallido: URL incorrecta tras pasar filtros de seguridad.\n  URL Actual: ${urlActual}\n  Contenido: ${pageText.replace(/\n/g, ' ')}`);
  }

  // Verificar falso positivo por Server.Transfer de ASP.NET (URL de MasterPrincipal pero contenido de Login)
  if (pageText.toLowerCase().includes('iniciar sesion') || pageText.toLowerCase().includes('contrasena') && pageText.toLowerCase().includes('usuario')) {
    throw new Error(`❌ Login fallido: La sesion expiro o Cuentame te redirigio al Login internamente.\n  URL Actual: ${urlActual}`);
  }

  console.log('  ✅ Login exitoso en Cuentame.\n');
}

/**
 * Detecta si la pagina actual es un campo de codigo 2FA.
 */
async function detectar2FA(page) {
  try {
    const url = page.url();
    const esLoginPage = url.includes('DefaultF.aspx');

    if (esLoginPage) {
      const contenido = await page.content();
      const menciona2FA =
        contenido.toLowerCase().includes('codigo') ||
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
 * Verifica si la sesion se ha perdido o si hay un error critico del servidor.
 * Devuelve true si la sesion se perdio y requiere re-login.
 */
async function verificarConexionOCaida(page) {
    try {
        if (!page || page.isClosed()) return true;

        // Verificar si la URL nos mando al Login o fuera del sistema
        const urlActual = page.url();
        const pageText = await page.evaluate(() => document.body ? document.body.innerText.substring(0, 2000) : '').catch(() => '');
        const pageTextClean = removeAccents(pageText);

        if (urlActual.includes('DefaultF.aspx') && pageTextClean.includes('INICIAR SESION')) return true;
        if (urlActual.includes('Login')) return true;

        // Falso positivo: URL correcta pero contenido de Login
        if (pageTextClean.includes('OLVIDASTE TU CONTRASE') || pageTextClean.includes('INICIAR SESION')) return true;
        
        // Error de servidor
        if (pageText.includes('Server Error in') || pageText.includes('Runtime Error')) {
            console.log(c.rojo('  ⚠️ Servidor de Cuentame arrojo un Error 500 (Server Error).'));
            return true;
        }

        return false;
    } catch (e) {
        // Si el contexto del navegador fue destruido o target closed
        return true;
    }
}

/**
 * Intenta conectarse a un navegador existente en modo depuracion (puerto 9222).
 * Si no lo encuentra, lanza un navegador nuevo en modo Bot Automatico.
 */
function removeAccents(str) {
    if (!str) return '';
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}

/**
 * Valida si la sesion activa en Cuentame corresponde a la asociacion seleccionada.
 * Si la asociacion activa es diferente, cierra sesion (clic en boton Logout)
 * y hace clic en la casita (Home) para volver a la pantalla de login/roles.
 *
 * @param {import('playwright').Page} page
 * @param {object|string} asociacionObj
 * @returns {Promise<boolean>} true si la asociacion activa es la misma (no requiere cambio), false si cerro sesion.
 */
async function validarYCambiarAsociacion(page, asociacionObj) {
    const targetNombre = typeof asociacionObj === 'string' ? asociacionObj : (asociacionObj.nombreCorto || asociacionObj.nombre);
    if (!targetNombre) return true;

    const targetClean = removeAccents(targetNombre);
    let pageUrl = page.url();
    const pageText = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    const pageTextClean = removeAccents(pageText);

    const esLoginO2FA = pageTextClean.includes('INICIAR SESION') || 
                        pageTextClean.includes('INGRESE SU CODIGO') || 
                        pageTextClean.includes('SE HA ENVIADO UN CODIGO') || 
                        pageTextClean.includes('OLVIDASTE TU CONTRASEÑA') ||
                        pageTextClean.includes('OLVIDASTE TU CONTRASENA');

    if (esLoginO2FA) {
        return false;
    }

    if (pageUrl.includes('DefaultF.aspx') && pageTextClean.includes('SELECCIONE LA ENTIDAD')) {
        await seleccionarRolYEntrar(page, asociacionObj);
        return true;
    }

    // Si el script anterior dejo el navegador atrapado en una vista de reporte puro, 
    // regresamos al layout MasterPrincipal ANTES de validar la cabecera.
    if (pageUrl.toLowerCase().includes('list.aspx') || pageUrl.toLowerCase().includes('reportviewer')) {
        console.log(c.amarillo(`  🔄 Detectada vista de reporte. Devolviendo al menu principal de Cuentame (MasterPrincipal)...`));
        await page.goto('https://rubonline.icbf.gov.co/General/General/Master/MasterPrincipal.aspx', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1500);
        pageUrl = page.url();
    }

    // Extraer texto de la cabecera donde Cuentame muestra la asociacion activa
    const headerText = await page.evaluate(() => {
        const cab = document.querySelector('#CabeceraPrincipal, div.ui-layout-north, table#CabeceraPrincipal');
        return cab ? cab.innerText : document.body.innerText;
    }).catch(() => '');

    const headerClean = removeAccents(headerText);

    // Si la cabecera contiene la asociacion deseada, la sesion es perfecta!
    if (headerClean.includes(targetClean)) {
        console.log(c.verde(`  ✅ Sesion activa confirmada para la asociacion "${targetNombre}". Preservando sesion.`));
        
        // Garantizar que la pagina este en el layout principal si todavia no lo esta
        if (!pageUrl.toLowerCase().includes('masterprincipal.aspx') && !pageUrl.toLowerCase().includes('defaultf.aspx')) {
             console.log(c.amarillo(`  🔄 Refrescando el layout al menu principal (MasterPrincipal)...`));
             await page.goto('https://rubonline.icbf.gov.co/General/General/Master/MasterPrincipal.aspx', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
             await page.waitForTimeout(1000);
        }
        
        return true;
    }

    console.log(c.amarillo(`  🔄 Cambiando a la asociacion "${targetNombre}"...`));
    try {
        await page.goto('https://rubonline.icbf.gov.co/DefaultF.aspx', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(2000);
        
        // Verificar si nos boto al login al intentar ir a DefaultF.aspx
        const newPageText = removeAccents(await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => ''));
        if (newPageText.includes('INICIAR SESION') || newPageText.includes('OLVIDASTE TU CONTRASE')) {
            console.log(c.rojo(`  ❌ La sesion expiro. Se requiere iniciar sesion nuevamente.`));
            return false;
        }

        await seleccionarRolYEntrar(page, asociacionObj);
        return true;
    } catch(e) {
        console.log(c.rojo(`  ❌ Error al cambiar asociacion: ${e.message}`));
        return false;
    }
}

module.exports = {
  loginYLlegarARoles,
  seleccionarRolYEntrar,
  obtenerNavegador,
  verificarConexionOCaida,
  validarYCambiarAsociacion
};

async function obtenerNavegador() {
    try {
        console.log(c.cyan('\n  🔍 Buscando navegador en Modo Humano (Puerto 9222)...'));
        const browser = await chromium.connectOverCDP('http://localhost:9222');
        console.log(c.verde('  ✅ Conectado al navegador del usuario exitosamente.'));
        
        const context = browser.contexts()[0];
        let cuentamePage = null;
        
        // Buscar si el usuario ya tiene la pestana de Cuentame abierta
        for (const page of context.pages()) {
            if (page.url().includes('rubonline.icbf.gov.co')) {
                cuentamePage = page;
                break;
            }
        }
        
        if (!cuentamePage) {
            console.log(c.amarillo('  ⚠️ No se encontro una pestana de Cuentame abierta. Creando una nueva...'));
            cuentamePage = await context.newPage();
            await cuentamePage.goto('https://rubonline.icbf.gov.co/DefaultF.aspx');
        } else {
            // Traer la pestana al frente
            await cuentamePage.bringToFront();
        }
        
        return { browser, context, page: cuentamePage, isCDP: true };
    } catch (e) {
        console.log(c.gris('  ℹ️ No se detecto navegador en Modo Humano. Abriendo Bot Automatico...'));
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
