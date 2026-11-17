/**
 * filtro-monitor.js
 * Monitor reactivo de alto rendimiento para filtros, postbacks y UpdatePanels de Cuéntame (ASP.NET & SSRS).
 * Elimina esperas ciegas (sleeps/waitForTimeout) sustituyéndolas por detección de eventos de red y estado del DOM.
 */

const c = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
  rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
  gris:     (t) => `\x1b[90m${t}\x1b[0m`,
  negrita:  (t) => `\x1b[1m${t}\x1b[0m`,
};

function removeAccents(str) {
  if (!str) return '';
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u00a0\s]+/g, " ")
    .replace(/[*:]/g, "")
    .toUpperCase()
    .trim();
}

/**
 * Espera a que termine un PostBack asíncrono de ASP.NET (UpdatePanel) de forma reactiva y determinista.
 * Monitorea tanto la respuesta HTTP Delta de MicrosoftAjax como el PageRequestManager nativo.
 *
 * @param {import('playwright').Page} page - Página principal
 * @param {Function} accionDisparadora - Función async que dispara el evento (click, select, etc.)
 * @param {number} timeoutMs - Tiempo máximo de espera (por defecto 15s)
 * @returns {Promise<{ netMs: number, totalMs: number }>}
 */
async function esperarPostBackReactivo(page, accionDisparadora, timeoutMs = 15000) {
  const t0 = Date.now();
  let netMs = 0;

  try {
    const urlBase = page.url().split('?')[0];

    // 1. Escuchar la respuesta HTTP del postback parcial
    const responsePromise = page.waitForResponse(resp => {
      try {
        const req = resp.request();
        if (req.method() !== 'POST') return false;
        if (resp.status() !== 200) return false;
        const u = resp.url();
        const esMismaUrl = u.includes(urlBase) || u.includes('.aspx');
        const esAjax = resp.headers()['x-microsoftajax'] || req.headers()['x-microsoftajax'];
        return esMismaUrl || !!esAjax;
      } catch(e) { return false; }
    }, { timeout: timeoutMs }).catch(() => null);

    // 2. Ejecutar la acción que dispara el postback
    if (typeof accionDisparadora === 'function') {
      await accionDisparadora();
    }

    // 3. Esperar a que la red responda
    const resp = await responsePromise;
    netMs = Date.now() - t0;

    // 4. Esperar a que ASP.NET PageRequestManager procese el DOM y libere el estado de postback
    await page.waitForFunction(() => {
      if (typeof Sys === 'undefined' || !Sys.WebForms || !Sys.WebForms.PageRequestManager) return true;
      try {
        const prm = Sys.WebForms.PageRequestManager.getInstance();
        return !prm.get_isInAsyncPostBack();
      } catch(e) { return true; }
    }, { timeout: 3000 }).catch(() => {});

  } catch (err) {
    // Si hubo timeout u otro detalle, continuar sin bloquear
  }

  const totalMs = Date.now() - t0;
  return { netMs, totalMs };
}

/**
 * Espera reactiva al indicador de carga de SQL Server Reporting Services (ReportViewer AsyncWait).
 * @param {import('playwright').Page|import('playwright').Frame} frame - Frame o página del reporte
 * @param {number} timeoutMs - Tiempo máximo
 */
async function esperarSSRSAsyncWait(frame, timeoutMs = 15000) {
  const t0 = Date.now();
  try {
    await frame.waitForFunction(() => {
      const waitDiv = document.querySelector('div[id*="AsyncWait"], table[id*="AsyncWait"]');
      if (!waitDiv) return true;
      const s = window.getComputedStyle(waitDiv);
      return s.display === 'none' || s.visibility === 'hidden' || waitDiv.offsetParent === null;
    }, { timeout: timeoutMs }).catch(() => {});
  } catch(e) {}
  return Date.now() - t0;
}

/**
 * Selecciona una opción en un <select> de ASP.NET de forma determinista y reactiva.
 * Si el select tiene onchange con __doPostBack, espera el postback sin sleeps ciegos.
 *
 * @param {import('playwright').Page} page - Página principal
 * @param {import('playwright').Frame|import('playwright').Page} frame - Frame donde reside el select
 * @param {string|import('playwright').Locator} selectorOrLoc - Selector CSS o Locator del select
 * @param {string|number} valueOrText - Texto u opción a seleccionar
 * @param {object} opciones - Opciones adicionales (dependienteSelector, timeoutMs, nombreEtiqueta)
 */
async function seleccionarDropdownReactivo(page, frame, selectorOrLoc, valueOrText, opciones = {}) {
  const { dependienteSelector = null, timeoutMs = 12000, nombreEtiqueta = '' } = opciones;
  const t0 = Date.now();
  const loc = typeof selectorOrLoc === 'string' ? frame.locator(selectorOrLoc).first() : selectorOrLoc;

  try {
    await loc.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
    
    // Si el select todavía no tiene opciones (ej. acaba de dispararse la carga dependiente),
    // esperar activamente hasta que el DOM lo pueble (máximo 4s)
    await frame.waitForFunction((el) => {
      return el && el.options && (el.options.length > 1 || (el.options.length === 1 && el.options[0].value !== "" && el.options[0].value !== "-1" && el.options[0].value !== "0"));
    }, await loc.elementHandle().catch(() => null), { timeout: 4000 }).catch(() => {});

    // Inspeccionar las opciones actuales del select y si requiere postback
    const info = await loc.evaluate((el, { targetVal }) => {
      const norm = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u00a0\s]+/g, " ").replace(/[*:]/g, "").toUpperCase().trim();
      el.disabled = false;
      el.classList.remove('aspNetDisabled');

      const onchange = el.getAttribute('onchange') || '';
      const tienePostBack = onchange.includes('__doPostBack') || onchange.includes('postback') || onchange.includes('submit');

      const options = Array.from(el.options).map((o, idx) => ({
        index: idx,
        value: o.value,
        text: (o.text || o.innerText || '').trim(),
        textNorm: norm(o.text || o.innerText || ''),
        valNorm: norm(o.value)
      }));

      let matchedIdx = -1;
      let matchedVal = null;
      let matchedText = '';

      if (typeof targetVal === 'number') {
        if (targetVal >= 0 && targetVal < options.length) {
          matchedIdx = targetVal;
          matchedVal = options[targetVal].value;
          matchedText = options[targetVal].text;
        }
      } else if (targetVal !== null && targetVal !== undefined && targetVal !== '') {
        const s = norm(String(targetVal));
        
        // 1. Coincidencia exacta
        let m = options.find(o => o.textNorm === s || o.valNorm === s);
        
        // 2. Coincidencia de mes (ej. "NOVIEMBRE" <-> "11", etc.)
        if (!m) {
          const mapaMeses = {
            'ENERO': '1', 'FEBRERO': '2', 'MARZO': '3', 'ABRIL': '4', 'MAYO': '5', 'JUNIO': '6',
            'JULIO': '7', 'AGOSTO': '8', 'SEPTIEMBRE': '9', 'OCTUBRE': '10', 'NOVIEMBRE': '11', 'DICIEMBRE': '12'
          };
          const numMes = mapaMeses[s] || mapaMeses[s.slice(0, 3)];
          if (numMes) {
            m = options.find(o => o.valNorm === numMes || o.textNorm.startsWith(numMes + ' ') || o.textNorm.startsWith(numMes + '-') || o.textNorm.startsWith(numMes + '.'));
          }
        }

        // 3. StartsWith
        if (!m) {
          m = options.find(o => o.textNorm.startsWith(s));
        }

        // 4. Includes
        if (!m) {
          m = options.find(o => o.textNorm.includes(s) || (s.length > 3 && s.includes(o.textNorm)));
        }

        if (m) {
          matchedIdx = m.index;
          matchedVal = m.value;
          matchedText = m.text;
        }
      }

      const curVal = el.value;
      const curIdx = el.selectedIndex;
      const yaSeleccionado = (matchedIdx === curIdx || (matchedVal !== null && curVal === matchedVal));

      return {
        tienePostBack,
        optionsCount: options.length,
        matchedIdx,
        matchedVal,
        matchedText,
        yaSeleccionado,
        curText: el.options[curIdx] ? el.options[curIdx].text : ''
      };
    }, { targetVal: valueOrText });

    const etiquetaLog = nombreEtiqueta || (typeof selectorOrLoc === 'string' ? selectorOrLoc : 'select');

    if (info.matchedIdx === -1) {
      console.log(c.amarillo(`    ⚠️ [Filtro] "${etiquetaLog}": No se encontró opción para "${valueOrText}" (${info.optionsCount} disponibles)`));
      return false;
    }

    if (info.yaSeleccionado) {
      // Ya tiene la opción correcta
      return true;
    }

    // Si requiere postback, envolver la selección en esperarPostBackReactivo
    if (info.tienePostBack) {
      const res = await esperarPostBackReactivo(page, async () => {
        await loc.selectOption({ index: info.matchedIdx }).catch(() => {});
      }, timeoutMs);

      // Si hay un control dependiente, esperar a que se pueble
      if (dependienteSelector) {
        await frame.waitForFunction((depSel) => {
          const el = document.querySelector(depSel);
          return el && !el.disabled && el.options && el.options.length > 1;
        }, dependienteSelector, { timeout: 5000 }).catch(() => {});
      }

      console.log(c.verde(`    ⚡ [Filtro reactivo] "${etiquetaLog}" -> ${info.matchedText} (${res.totalMs}ms)`));
      return true;
    } else {
      await loc.selectOption({ index: info.matchedIdx }).catch(() => {});
      const totalMs = Date.now() - t0;
      console.log(c.verde(`    ⚡ [Filtro local] "${etiquetaLog}" -> ${info.matchedText} (${totalMs}ms)`));
      return true;
    }

  } catch (err) {
    console.log(c.amarillo(`    ⚠️ [Filtro] Error al seleccionar en "${nombreEtiqueta || selectorOrLoc}": ${err.message}`));
    return false;
  }
}

/**
 * Selecciona una opción en un control SSRS ReportViewer de forma reactiva y determinista.
 *
 * @param {import('playwright').Page} page - Página principal
 * @param {import('playwright').Frame|import('playwright').Page} reportFrame - Frame del reporte
 * @param {string} labelOId - Etiqueta visible del filtro o ID del select
 * @param {string|number} valueOrText - Opción deseada
 * @param {object} opciones - Opciones adicionales
 */
async function seleccionarSSRSReactivo(page, reportFrame, labelOId, valueOrText, opciones = {}) {
  const { nextControlSelector = null, timeoutMs = 15000 } = opciones;
  const t0 = Date.now();

  try {
    const targetLabel = removeAccents(labelOId);

    // 1. Encontrar el control select en el reporte
    let selectInfo = await reportFrame.evaluate(({ targetLabel, labelOId }) => {
      const norm = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u00a0\s]+/g, " ").replace(/[*:]/g, "").toUpperCase().trim();
      const target = norm(labelOId || targetLabel);

      // A. ID exacto
      let select = document.getElementById(labelOId);
      if (!select || select.tagName !== 'SELECT') {
        select = null;
      }

      // B. Búsqueda celda a celda en tabla de parámetros de SSRS
      if (!select) {
        const allTds = Array.from(document.querySelectorAll('td'));
        for (const td of allTds) {
          if (td.querySelector('select, input[type="text"], div[id*="ddDropDownButton"]')) continue;
          const text = norm(td.innerText);
          if (text && (text === target || text.startsWith(target) || target.startsWith(text))) {
            const nextTd = td.nextElementSibling;
            if (nextTd) {
              const s = nextTd.querySelector('select');
              if (s) { select = s; break; }
            }
          }
        }
      }

      // C. Fallback por label o span
      if (!select) {
        const allLabels = Array.from(document.querySelectorAll('label, span'));
        for (const lbl of allLabels) {
          if (lbl.children.length > 0) continue;
          const text = norm(lbl.innerText);
          if (text && (text === target || text.startsWith(target))) {
            if (lbl.htmlFor) {
              const el = document.getElementById(lbl.htmlFor);
              if (el && el.tagName === 'SELECT') { select = el; break; }
            }
            const parentTd = lbl.closest('td');
            if (parentTd && parentTd.nextElementSibling) {
              const s = parentTd.nextElementSibling.querySelector('select');
              if (s) { select = s; break; }
            }
          }
        }
      }

      if (!select) return null;
      select.disabled = false;
      select.classList.remove('aspNetDisabled');

      const options = Array.from(select.options).map((o, idx) => ({
        index: idx,
        value: o.value,
        text: (o.text || o.innerText || '').trim(),
        textNorm: norm(o.text || o.innerText || ''),
        valNorm: norm(o.value)
      }));

      return {
        id: select.id,
        name: select.name,
        options,
        curIdx: select.selectedIndex
      };
    }, { targetLabel, labelOId });

    if (!selectInfo) {
      console.log(c.amarillo(`    ⚠️ [SSRS] Control select no encontrado para "${labelOId}"`));
      return false;
    }

    // Si el select no tiene opciones todavía o solo tiene "<Select a Value>", esperar hasta 6s a que cargue opciones por cascada
    if (selectInfo.options.length <= 1) {
      await reportFrame.waitForFunction(({ selId }) => {
        const s = document.getElementById(selId);
        return s && s.options && s.options.length > 1;
      }, { selId: selectInfo.id }, { timeout: 6000 }).catch(() => {});

      const reOpts = await reportFrame.evaluate((id) => {
        const norm = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u00a0\s]+/g, " ").replace(/[*:]/g, "").toUpperCase().trim();
        const s = document.getElementById(id);
        if (!s) return [];
        return Array.from(s.options).map((o, idx) => ({
          index: idx,
          value: o.value,
          text: (o.text || o.innerText || '').trim(),
          textNorm: norm(o.text || o.innerText || ''),
          valNorm: norm(o.value)
        }));
      }, selectInfo.id).catch(() => []);

      if (reOpts.length > 0) {
        selectInfo.options = reOpts;
      }
    }

    if (selectInfo.options.length === 0) {
      console.log(c.amarillo(`    ⚠️ [SSRS] Control sin opciones para "${labelOId}"`));
      return false;
    }

    // 2. Encontrar índice objetivo
    const sSearch = removeAccents(String(valueOrText));
    let matchedIdx = -1;
    let matchedText = '';

    if (typeof valueOrText === 'number') {
      matchedIdx = valueOrText;
      matchedText = selectInfo.options[matchedIdx]?.text || '';
    } else {
      let m = selectInfo.options.find(o => o.textNorm === sSearch || o.valNorm === sSearch);
      if (!m) m = selectInfo.options.find(o => o.textNorm.startsWith(sSearch));
      if (!m) m = selectInfo.options.find(o => o.textNorm.includes(sSearch));
      if (!m) m = selectInfo.options.find(o => sSearch.includes(o.textNorm) && o.textNorm.length > 3);
      if (!m) {
        const words = sSearch.split(/[\s,.-]+/).filter(w => w.length > 3);
        if (words.length > 0) {
          m = selectInfo.options.find(o => words.some(w => o.textNorm.includes(w)));
        }
      }
      if (m) {
        matchedIdx = m.index;
        matchedText = m.text;
      }
    }

    if (matchedIdx === -1) {
      console.log(c.amarillo(`    ⚠️ [SSRS] No se encontró opción "${valueOrText}" en "${labelOId}" (opciones disponibles: ${selectInfo.options.map(o => o.text).slice(0, 4).join(', ')})`));
      return false;
    }

    if (matchedIdx === selectInfo.curIdx) {
      return true; // Ya está seleccionada
    }

    // 3. Ejecutar selección reactiva con listener de red + AsyncWait
    const selectLoc = reportFrame.locator(`#${selectInfo.id}`);
    
    const respPromise = page.waitForResponse(resp => {
      try {
        return resp.request().method() === 'POST' && resp.status() === 200;
      } catch(e) { return false; }
    }, { timeout: 4000 }).catch(() => null);

    await selectLoc.selectOption({ index: matchedIdx }).catch(() => {});
    await selectLoc.evaluate((node, idx) => {
      node.selectedIndex = idx;
      node.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof node.onchange === 'function') {
        try { node.onchange(); } catch(e) {}
      }
    }, matchedIdx).catch(() => {});

    // Esperar respuesta de red y liberación del AsyncWait de SSRS
    await respPromise;
    await esperarSSRSAsyncWait(reportFrame, timeoutMs);
    await reportFrame.waitForTimeout(300);

    // Si hay control dependiente, esperar a que tenga opciones
    if (nextControlSelector) {
      await reportFrame.waitForFunction((sel) => {
        const el = document.querySelector(sel);
        return el && !el.disabled && el.options && el.options.length > 0;
      }, nextControlSelector, { timeout: timeoutMs }).catch(() => {});
    }

    const totalMs = Date.now() - t0;
    console.log(c.verde(`    ⚡ [SSRS reactivo] "${labelOId}" -> ${matchedText} (${totalMs}ms)`));
    return true;

  } catch (err) {
    console.log(c.amarillo(`    ⚠️ [SSRS] Error en "${labelOId}": ${err.message}`));
    return false;
  }
}

/**
 * Selecciona valores en un control multi-select de SSRS ReportViewer (divDropDown con checkboxes)
 * de forma reactiva, eliminando esperas y reintentos innecesarios.
 *
 * @param {import('playwright').Page} page - Página principal
 * @param {import('playwright').Frame|import('playwright').Page} reportFrame - Frame del reporte
 * @param {string} labelOId - Etiqueta visible del filtro o ID base
 * @param {string} desiredValues - Valores separados por coma o '(Select All)'
 * @param {object} opciones - Opciones adicionales
 */
async function seleccionarSSRSMultiReactivo(page, reportFrame, labelOId, desiredValues, opciones = {}) {
  const { timeoutMs = 15000 } = opciones;
  const t0 = Date.now();
  const targetLabel = removeAccents(labelOId);

  try {
    // 1. Encontrar control dropdown button
    const controlInfo = await reportFrame.evaluate(({ targetLabel, labelOId }) => {
      const norm = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u00a0\s]+/g, " ").replace(/[*:]/g, "").toUpperCase().trim();
      const target = norm(labelOId || targetLabel);

      let btn = document.getElementById(labelOId) || document.getElementById(`${labelOId}_ddDropDownButton`);
      if (!btn) {
        const allTds = Array.from(document.querySelectorAll('td'));
        for (const td of allTds) {
          if (td.querySelector('select, input[type="text"], div[id*="ddDropDownButton"]')) continue;
          const text = norm(td.innerText);
          if (text && (text === target || text.startsWith(target) || target.startsWith(text))) {
            const nextTd = td.nextElementSibling;
            if (nextTd) {
              btn = nextTd.querySelector('div[id*="ddDropDownButton"], input[id*="ddDropDownButton"]');
              if (btn) break;
            }
          }
        }
      }

      if (!btn) {
        const allLabels = Array.from(document.querySelectorAll('label, span'));
        for (const lbl of allLabels) {
          if (lbl.children.length > 0) continue;
          const text = norm(lbl.innerText);
          if (text && (text === target || text.startsWith(target))) {
            const parentTd = lbl.closest('td');
            if (parentTd && parentTd.nextElementSibling) {
              btn = parentTd.nextElementSibling.querySelector('div[id*="ddDropDownButton"], input[id*="ddDropDownButton"]');
              if (btn) break;
            }
          }
        }
      }

      if (!btn) return null;
      btn.disabled = false;
      btn.removeAttribute('disabled');
      const baseId = btn.id.replace('_ddDropDownButton', '');
      return { btnId: btn.id, baseId };
    }, { targetLabel, labelOId });

    if (!controlInfo) {
      console.log(c.amarillo(`    ⚠️ [SSRS Multi] Dropdown no encontrado para "${labelOId}"`));
      return false;
    }

    const { btnId, baseId } = controlInfo;
    const divDropDownId = `${baseId}_divDropDown`;
    const txtValueId = `${baseId}_txtValue`;

    // 2. Abrir dropdown
    const btnLoc = reportFrame.locator(`#${btnId}`);
    await btnLoc.click({ force: true }).catch(() => btnLoc.evaluate(b => b.click()));

    // Esperar a que el contenedor de dropdown esté visible
    await reportFrame.locator(`#${divDropDownId}`).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

    // 3. Marcar los checkboxes solicitados
    const targetVals = String(desiredValues).split(',').map(v => removeAccents(v)).filter(Boolean);
    const isSelectAll = (desiredValues === '(Select All)' || desiredValues === '(Check All)');

    await reportFrame.evaluate(({ divDropDownId, targetVals, isSelectAll }) => {
      const norm = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u00a0\s]+/g, " ").replace(/[*:]/g, "").toUpperCase().trim();
      const div = document.getElementById(divDropDownId);
      if (!div) return;

      const labels = Array.from(div.querySelectorAll('label'));
      const getCheckbox = (lbl) => {
        let chk = document.getElementById(lbl.htmlFor);
        if (!chk) chk = lbl.querySelector('input[type="checkbox"]');
        if (!chk && lbl.previousElementSibling?.type === 'checkbox') chk = lbl.previousElementSibling;
        if (!chk && lbl.parentElement) chk = lbl.parentElement.querySelector('input[type="checkbox"]');
        return chk;
      };

      const selectAllLabel = labels.find(l => {
        const t = norm(l.innerText);
        return t.includes('SELECT ALL') || t.includes('SELECCIONAR TODO') || t.includes('CHECK ALL');
      });

      if (isSelectAll) {
        if (selectAllLabel) {
          const chk = getCheckbox(selectAllLabel);
          if (chk && !chk.checked) chk.click();
        }
      } else {
        if (selectAllLabel) {
          const chk = getCheckbox(selectAllLabel);
          if (chk && chk.checked) chk.click();
        }
        for (const lbl of labels) {
          const txt = norm(lbl.innerText);
          if (txt.includes('SELECT ALL') || txt.includes('SELECCIONAR TODO') || txt.includes('CHECK ALL')) continue;
          const words = targetVals.map(tv => tv.split(/[\s,.-]+/).filter(w => w.length > 3)).flat();
          const coincide = targetVals.some(t => txt === t || txt.startsWith(t) || txt.includes(t) || t.includes(txt)) || (words.length > 0 && words.some(w => txt.includes(w)));
          const chk = getCheckbox(lbl);
          if (chk) {
            if (coincide && !chk.checked) chk.click();
            else if (!coincide && chk.checked) chk.click();
          }
        }
      }
    }, { divDropDownId, targetVals, isSelectAll });

    // 4. Cerrar dropdown haciendo clic en el botón de nuevo o fuera
    const isVis = await reportFrame.locator(`#${divDropDownId}`).isVisible().catch(() => false);
    if (isVis) {
      await btnLoc.click({ force: true }).catch(() => {});
      await reportFrame.waitForTimeout(200);
      const stillVis = await reportFrame.locator(`#${divDropDownId}`).isVisible().catch(() => false);
      if (stillVis) {
        await reportFrame.locator('body').click().catch(() => {});
      }
    }
    await reportFrame.locator(`#${divDropDownId}`).waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

    // Esperar si el cierre del dropdown disparó actualización o AsyncWait
    await esperarSSRSAsyncWait(reportFrame, 5000);
    await reportFrame.waitForTimeout(300);

    const valTxt = await reportFrame.locator(`#${txtValueId}`).inputValue().catch(() => '');
    const totalMs = Date.now() - t0;
    console.log(c.verde(`    ⚡ [SSRS Multi reactivo] "${labelOId}" -> [${valTxt || desiredValues}] (${totalMs}ms)`));
    return true;

  } catch (err) {
    console.log(c.amarillo(`    ⚠️ [SSRS Multi] Error en "${labelOId}": ${err.message}`));
    return false;
  }
}

module.exports = {
  esperarPostBackReactivo,
  esperarSSRSAsyncWait,
  seleccionarDropdownReactivo,
  seleccionarSSRSReactivo,
  seleccionarSSRSMultiReactivo,
  removeAccents
};
