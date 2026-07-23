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
 * @param {string} codigoJardin - Código Cuéntame del jardín (ej: "110011120318")
 */
async function seleccionarUnidad(page, codigoJardin) {
  // 1. Click en el ícono de lupa
  const lupaSelector = 'img[src*="lupa"], a[href*="lupa"], input[type="image"]';
  await page.locator(lupaSelector).first().click();

  // 2. Esperar que aparezca el popup
  const popup = await page.waitForEvent('popup', { timeout: 10000 });
  await popup.waitForLoadState('domcontentloaded');

  // 3. Buscar el campo "Código Unidad de Servicio" y escribir el código
  await popup.waitForTimeout(1000);

  // El campo de código es el primer input de texto del popup
  const camposCodigo = popup.locator('input[type="text"]');
  const primerCampo = camposCodigo.first();
  await primerCampo.click();
  await primerCampo.fill(codigoJardin);

  // 4. Click en el botón buscar (la lupa del popup)
  const botonBuscar = popup.locator('img[src*="buscar"], img[src*="search"], input[type="image"], input[value*="Buscar"]').first();
  await botonBuscar.click();
  await popup.waitForTimeout(2000);

  // 5. Intentar ir a la página 2 si existe (el contrato 2026 suele estar ahí)
  const encontradoEn2026 = await buscarYSeleccionar2026(popup);

  if (!encontradoEn2026) {
    // Intentar en página 2
    const linkPagina2 = popup.locator('a, span, td').filter({ hasText: /^\s*2\s*$/ }).first();
    const existePagina2 = await linkPagina2.count() > 0;

    if (existePagina2) {
      await linkPagina2.click();
      await popup.waitForTimeout(2000);
      const encontrado = await buscarYSeleccionar2026(popup);

      if (!encontrado) {
        throw new Error(`No se encontró vigencia 2026 para el jardín ${codigoJardin}`);
      }
    } else {
      throw new Error(`No se encontró vigencia 2026 para el jardín ${codigoJardin}`);
    }
  }

  // Esperar que el popup se cierre y el formulario se autocomplete
  await popup.waitForEvent('close', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

/**
 * Busca una fila con Vigencia=2026 en la tabla actual del popup
 * y hace click en su botón "Detalle".
 * @param {import('playwright').Page} popup
 * @returns {Promise<boolean>} true si encontró y seleccionó la fila
 */
async function buscarYSeleccionar2026(popup) {
  // Buscar todas las filas de la tabla
  const filas = popup.locator('table tr');
  const total = await filas.count();

  for (let i = 0; i < total; i++) {
    const fila = filas.nth(i);
    const textoFila = await fila.innerText().catch(() => '');

    // Verificar si esta fila contiene "2026"
    if (textoFila.includes('2026')) {
      // Hacer click en el botón de detalle (primer enlace/botón de la fila)
      const botonDetalle = fila.locator('a, input[type="button"], img').first();
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
