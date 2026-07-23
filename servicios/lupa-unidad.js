/**
 * lupa-unidad.js
 * Maneja la ventana emergente "Lupa Atención Beneficiario"
 * para seleccionar la Unidad de Servicio (jardín) correcta.
 *
 * Flujo:
 * 1. Click en ícono lupa del campo "Unidad de Servicio"
 * 2. Esperar popup
 * 3. Escribir código del jardín en "Código Unidad de Servicio"
 * 4. Buscar
 * 5. Si los resultados tienen más de una página, ir a página 2
 * 6. Encontrar la fila con Vigencia = 2026
 * 7. Click en el botón "Detalle" (ícono azul ℹ️) de esa fila
 */

/**
 * Selecciona la unidad de servicio del jardín usando la ventana emergente.
 * @param {import('playwright').Page} page - Página principal del formulario
 * @param {import('playwright').FrameLocator} frame - Iframe principal donde está la lupa
 * @param {string} codigoJardin - Código Cuéntame del jardín (ej: "110011120318")
 */
async function seleccionarUnidad(page, frame, codigoJardin) {
  // 1. Click en el ícono de lupa (dentro del iframe) con reintentos
  const lupaSelector = 'img[id*="imgBCodigoUsuario"], img[title*="Buscar"], img[src*="lupa"], img[src*="Buscar"]';
  let popup = null;
  
  for (let i = 0; i < 3; i++) {
    try {
      const lupaPromise = page.waitForEvent('popup', { timeout: 5000 });
      await frame.locator(lupaSelector).first().click({ force: true });
      popup = await lupaPromise;
      break; // Si abrió, salimos del ciclo de reintentos
    } catch (e) {
      console.log(`  ⚠️ Reintentando abrir la lupa (intento ${i + 2})...`);
    }
  }

  if (!popup) {
    throw new Error('No se pudo abrir la ventana de la lupa después de varios intentos.');
  }
  await popup.waitForLoadState('domcontentloaded');

  // 3. Buscar el campo "Código Unidad de Servicio" y escribir el código
  await popup.waitForSelector('input[type="text"]', { state: 'visible', timeout: 10000 });

  // El campo de código es el primer input de texto del popup
  const camposCodigo = popup.locator('input[type="text"]');
  const primerCampo = camposCodigo.first();
  await primerCampo.click();
  await primerCampo.fill(codigoJardin);

  // 4. Click en el botón buscar (la lupa del popup)
  const botonBuscar = popup.locator('a#btnBuscar, img[alt="Consultar"]').first();
  await Promise.all([
    popup.waitForLoadState('networkidle'),
    botonBuscar.click()
  ]);
  await popup.waitForTimeout(1000); // Pausa para renderizado de ASP.NET
  
  // Esperar a que la tabla de resultados cargue después de la búsqueda
  console.log('  👉 Esperando resultados de búsqueda en la lupa...');
  await popup.waitForSelector('#cphCont_gvLupaAtencionBeneficiario', { state: 'visible', timeout: 15000 }).catch(() => {});

  let encontrado = await buscarYSeleccionar2026(popup);
  let paginaSiguiente = 2;

  while (!encontrado) {
    // Buscar el link de la siguiente página (2, 3, 4...)
    const linkPagina = popup.locator(`a[href*="Page$${paginaSiguiente}"], a`).filter({ hasText: new RegExp(`^\\s*${paginaSiguiente}\\s*$`) }).first();
    const existePagina = await linkPagina.count() > 0;

    if (!existePagina) {
      break; // No hay más páginas para buscar
    }

    console.log(`  👉 Buscando en la página ${paginaSiguiente} de resultados...`);
    await Promise.all([
      popup.waitForLoadState('networkidle'),
      linkPagina.click()
    ]);
    await popup.waitForTimeout(1000); // Pausa para renderizado de ASP.NET
    
    encontrado = await buscarYSeleccionar2026(popup);
    paginaSiguiente++;
  }

  if (!encontrado) {
    throw new Error(`No se encontró vigencia 2026 para el jardín ${codigoJardin}`);
  }

  // Esperar que el popup se cierre y el formulario se autocomplete
  await popup.waitForEvent('close', { timeout: 10000 }).catch(() => {});
  // Al cerrarse el popup, la página principal puede estar procesando el postback
  await page.waitForLoadState('networkidle');
}

/**
 * Busca una fila con Vigencia=2026 en la tabla actual del popup
 * y hace click en su botón "Detalle".
 * @param {import('playwright').Page} popup
 * @returns {Promise<boolean>} true si encontró y seleccionó la fila
 */
async function buscarYSeleccionar2026(popup) {
  // Buscar todas las filas solo de la tabla de resultados
  const filas = popup.locator('#cphCont_gvLupaAtencionBeneficiario tr');
  const total = await filas.count();

  for (let i = 0; i < total; i++) {
    const fila = filas.nth(i);
    
    // Buscar todas las celdas (td) de la fila
    const celdas = fila.locator('td');
    const numCeldas = await celdas.count();
    let esFila2026 = false;

    // Revisar si alguna celda tiene la palabra exacta "2026"
    for (let j = 0; j < numCeldas; j++) {
      const textoCelda = await celdas.nth(j).innerText().catch(() => '');
      if (textoCelda.match(/\b2026\b/)) {
        esFila2026 = true;
        break;
      }
    }

    // Verificar si esta fila corresponde a la vigencia 2026
    if (esFila2026) {
      // Hacer click en el botón de detalle (primer enlace/botón de la fila)
      const botonDetalle = fila.locator('input[type="image"][title="Detalle"], input[id*="btnInfo"]').first();
      const existe = await botonDetalle.count() > 0;

      if (existe) {
        await botonDetalle.click();
        return true;
      }
    }
  }

  return false;
}

module.exports = { seleccionarUnidad };
