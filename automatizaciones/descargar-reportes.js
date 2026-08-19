/**
 * descargar-reportes.js
 * Script base para navegar al modulo de reportes y preparar la automatizacion.
 *
 * Uso: npm run reportes
 */

require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const { loginYLlegarARoles, seleccionarRolYEntrar, obtenerNavegador, validarYCambiarAsociacion } = require('../servicios/autenticacion');

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
  let browser = null;
  let context = null;
  let mainPage = null;
  let loggedIn = false;

  if (!USUARIO || !PASSWORD) {
    console.error(c.rojo('\n❌ Faltan CUENTAME_USUARIO o CUENTAME_PASSWORD en el archivo .env\n'));
    process.exit(1);
  }

  const { leerJardines } = require('../servicios/excel-reader');
  const readline = require('readline-sync');
  
  // Cargar datos del Excel
  const RUTA_EXCEL = process.env.RUTA_EXCEL || 'C:\\GENERAL.xlsx';
  const { porAsociacion } = leerJardines(RUTA_EXCEL);
  
  while (true) {
  let asociaciones = Object.values(porAsociacion);
  
  console.log(c.cyan('\n  📋 Selecciona el Reporte a generar:'));
  console.log(c.amarillo(`  1. Beneficiarios vinculados`));
  console.log(c.amarillo(`  2. Seguimiento nutricional de ninos y ninas por toma`));
  console.log(c.amarillo(`  3. Informe de registro asistencia mensual`));
  console.log(c.amarillo(`  4. Unidades de servicio`));
  console.log(c.rojo(`  0. Volver al panel principal (AutoTrabajo / Start)`));
  
  let opcionReporte = -1;
  while (opcionReporte < 0 || opcionReporte > 4) {
    const respuesta = readline.question(c.negrita('\n  > Ingresa el numero del reporte (0, 1, 2, 3 o 4): '));
    opcionReporte = parseInt(respuesta, 10);
    if (isNaN(opcionReporte)) opcionReporte = -1;
  }
  
  if (opcionReporte === 0) {
      console.log(c.verde('\n  👋 Volviendo al panel principal (AutoTrabajo)...\n'));
      break;
  }
  
  let seleccionToma = '(Select All)';
  let mesAtencion = '(Select All)';
  if (opcionReporte === 2) {
    console.log(c.cyan('\n  📋 Selecciona el mes de Toma (o varios meses):'));
    console.log(c.gris('   1. Enero      2. Febrero    3. Marzo       4. Abril'));
    console.log(c.gris('   5. Mayo       6. Junio      7. Julio       8. Agosto'));
    console.log(c.gris('   9. Septiembre 10. Octubre   11. Noviembre 12. Diciembre'));
    console.log(c.gris('   0. Todos los meses (Select All)\n'));
    console.log(c.gris('  (Puedes ingresar numeros como "5,6,7" o el nombre de los meses)'));

    const respuestaToma = readline.question(c.negrita('\n  > Ingresa la Toma [por defecto 0 (Todos)]: ')).trim();
    
    if (respuestaToma !== '' && respuestaToma !== '0') {
        const mapaMeses = {
            '1': 'Enero', '2': 'Febrero', '3': 'Marzo', '4': 'Abril',
            '5': 'Mayo', '6': 'Junio', '7': 'Julio', '8': 'Agosto',
            '9': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
        };

        const partes = respuestaToma.split(/[,;\s]+/);
        const mesesConvertidos = partes.map(p => {
            const cleanKey = p.trim();
            return mapaMeses[cleanKey] || cleanKey;
        });

        seleccionToma = mesesConvertidos.join(',');
    } else {
        seleccionToma = '(Select All)';
    }

    console.log(c.verde(`  ✅ Toma seleccionada: ${seleccionToma}`));
  } else if (opcionReporte === 3) {
    console.log(c.cyan('\n  📋 Selecciona el Mes de Atencion:'));
    const meses = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    meses.forEach((m, idx) => console.log(`  ${idx + 1}. ${m}`));
    
    let opcionMes = -1;
    while (opcionMes < 1 || opcionMes > meses.length) {
      const respMes = readline.question(c.negrita('\n  > Ingresa el numero del mes (1-12): '));
      opcionMes = parseInt(respMes, 10);
      if (isNaN(opcionMes)) opcionMes = -1;
    }
    mesAtencion = meses[opcionMes - 1];
  }
  
  console.log(c.cyan('\n  📋 Selecciona la Asociacion para procesar:'));
  console.log(c.amarillo(`  0. 🌟 TODAS LAS ASOCIACIONES`));
  asociaciones.forEach((asc, idx) => {
    console.log(`  ${idx + 1}. ${asc.nombreCorto} (Contrato: ${asc.numeroContrato || 'N/A'})`);
  });
  
  let asociacionesSeleccionadas = [];
  while (asociacionesSeleccionadas.length === 0) {
    console.log(c.gris('  (Puedes ingresar varios numeros separados por coma, ej: 1,3,4)'));
    const respuesta = readline.question(c.negrita('\n  > Ingresa el numero de la(s) opcion(es): '));
    
    const partes = respuesta.split(',').map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n));
    
    if (partes.includes(0)) {
        asociacionesSeleccionadas = asociaciones;
    } else {
        const validas = partes.filter(n => n >= 1 && n <= asociaciones.length);
        if (validas.length > 0) {
            asociacionesSeleccionadas = validas.map(n => asociaciones[n - 1]);
        } else {
            console.log(c.rojo('  ❌ Opcion no valida. Intenta nuevamente.'));
        }
    }
  }

  let prepararExcel = false;
  
  if (opcionReporte === 1 || opcionReporte === 2) {
      console.log(c.cyan('\n  📋 Que accion realizar con el reporte descargado?'));
      console.log(c.amarillo(`  1. Dejar por defecto (Original)`));
      console.log(c.amarillo(`  2. Preparar reporte (Elimina col A-F, ordena A-Z y agrega filtro)`));
      
      let opcionPreparar = -1;
      while (opcionPreparar < 1 || opcionPreparar > 2) {
        const respuestaPrep = readline.question(c.negrita('\n  > Ingresa la opcion (1 o 2) [por defecto 1]: '));
        if (respuestaPrep.trim() === '') opcionPreparar = 1;
        else opcionPreparar = parseInt(respuestaPrep, 10);
        if (isNaN(opcionPreparar)) opcionPreparar = -1;
      }
      prepararExcel = (opcionPreparar === 2);
  } else {
      console.log(c.gris('\n  ℹ️ El reporte se descargara en su formato original (sin modificar).'));
  }
  
  if (!browser) {
      console.log(c.cyan('\n  🌐 Inicializando entorno de navegador...\n'));
      const navData = await obtenerNavegador();
      browser = navData.browser;
      context = navData.context;
      mainPage = navData.page;
  }
  
  const fs = require('fs');
  const reportesDir = path.join(__dirname, '..', 'reportes');
  if (!fs.existsSync(reportesDir)) {
      fs.mkdirSync(reportesDir, { recursive: true });
  }

  // Filtrar asociaciones que tengan contrato para procesarlas
  const ascValidas = asociacionesSeleccionadas.filter(a => a.numeroContrato);

  if (ascValidas.length === 0) {
    console.log(c.rojo("  ⚠️ No hay asociaciones validas con contrato seleccionadas."));
    continue;
  }

  console.log(c.amarillo(`\n======================================================`));
  console.log(c.amarillo(`▶ Iniciando sesion y navegacion...`));
  console.log(c.amarillo(`======================================================`));

  let rolesUrl;
  let rolesHtml;
  try {
    rolesUrl = await loginYLlegarARoles(mainPage, {
      usuario: USUARIO,
      password: PASSWORD,
      gmailUser: GMAIL_USER,
      gmailAppPassword: GMAIL_APP_PASSWORD
    });
  } catch (err) {
    console.error(c.rojo(`  ❌ Error en login inicial: ${err.message}`));
    await browser.close();
    return;
  }

  // Iterar por cada asociacion
  for (let i = 0; i < ascValidas.length; i++) {
      const asc = ascValidas[i];

      // Correccion manual de contrato solicitada por el usuario
      if (asc.nombreCorto && asc.nombreCorto.toUpperCase().includes('VERBENAL')) {
          asc.numeroContrato = '11027492024';
      }

      // La pagina principal se queda en la seleccion de roles.
      // Le pedimos a seleccionarRolYEntrar que abra Cuentame en una pestana nueva
      let reportPage;
      try {
          console.log(c.amarillo(`\n======================================================`));
          console.log(c.amarillo(`▶ Procesando Asociacion [${i+1}/${ascValidas.length}]: ${asc.nombreCorto}`));
          console.log(c.amarillo(`======================================================`));
          console.log(`    Contrato: ${asc.numeroContrato} (Vigencia: ${asc.vigenciaContrato})`);
          
          if (i > 0) {
              console.log(c.amarillo(`  🔄 Cambiando a la asociacion "${asc.nombreCorto}"...`));
              try {
                  await mainPage.goto('https://rubonline.icbf.gov.co/DefaultF.aspx', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
                  await mainPage.waitForTimeout(800);
              } catch (e) {}
          }

          console.log(`  🏢 Seleccionando entidad/asociacion: "${asc.nombreCorto}"...`);
          reportPage = await seleccionarRolYEntrar(mainPage, asc, false);
          console.log(c.verde(`  ✅ Asociacion "${asc.nombreCorto}" cargada e ingresada limpia en la plataforma.`));
      } catch (e) {
          console.log(c.rojo(`  ❌ Error al cambiar a la asociacion ${asc.nombreCorto}: ${e.message}`));
          continue;
      }

      try {
        // Definimos la variable para que las funciones helper la capturen.
        let reportFrame = reportPage;

        // Funcion helper que busca un select en SSRS a partir de su label (texto) y lo llena
        const seleccionarSSRSByLabel = async (labelText, valueOrText) => {
            try {
                const removeAccentsStr = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u00a0\s]+/g, " ").replace(/[*:]/g, "").trim().toUpperCase();
                const targetLabel = removeAccentsStr(labelText);

                // 1. Esperar a que la etiqueta y el select existan y tengan opciones cargadas (> 1)
                let listo = false;
                let intentos = 0;
                while (intentos < 20) {
                    listo = await reportFrame.evaluate(({ targetLabel }) => {
                        const removeAccents = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u00a0\s]+/g, " ").replace(/[*:]/g, "").trim().toUpperCase();
                        const allElements = Array.from(document.querySelectorAll('td, span, label, div')).reverse();
                        let matchedTd = null;

                        for (const el of allElements) {
                            const txt = removeAccents(el.innerText);
                            if (txt && (txt === targetLabel || txt.startsWith(targetLabel) || txt.includes(targetLabel))) {
                                if (el.innerText.length < 100) {
                                    matchedTd = el.closest('td') || el;
                                    break;
                                }
                            }
                        }

                        if (!matchedTd) return false;

                        let select = matchedTd.querySelector('select');
                        if (!select && matchedTd.nextElementSibling) {
                            select = matchedTd.nextElementSibling.querySelector('select') || (matchedTd.nextElementSibling.tagName === 'SELECT' ? matchedTd.nextElementSibling : null);
                        }
                        if (!select && matchedTd.parentElement) {
                            select = matchedTd.parentElement.querySelector('select');
                        }
                        if (!select) {
                            const tr = matchedTd.closest('tr');
                            if (tr) select = tr.querySelector('select');
                        }

                        if (!select) return false;
                        return !select.disabled && select.options && select.options.length > 1;
                    }, { targetLabel }).catch(() => false);

                    if (listo) break;
                    await mainPage.waitForTimeout(500);
                    intentos++;
                }

                const exito = await reportFrame.evaluate(({ labelText, valueOrText }) => {
                    const removeAccents = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u00a0\s]+/g, " ").replace(/[*:]/g, "").trim().toUpperCase();
                    const targetLabel = removeAccents(labelText);
                    
                    const allElements = Array.from(document.querySelectorAll('td, span, label, div')).reverse();
                    let matchedTd = null;

                    for (const el of allElements) {
                        const txt = removeAccents(el.innerText);
                        if (txt && (txt === targetLabel || txt.startsWith(targetLabel) || txt.includes(targetLabel))) {
                            if (el.innerText.length < 100) {
                                matchedTd = el.closest('td') || el;
                                break;
                            }
                        }
                    }

                    if (!matchedTd) return { ok: false, reason: 'Etiqueta no encontrada en el DOM' };

                    let select = matchedTd.querySelector('select');
                    if (!select && matchedTd.nextElementSibling) {
                        select = matchedTd.nextElementSibling.querySelector('select') || (matchedTd.nextElementSibling.tagName === 'SELECT' ? matchedTd.nextElementSibling : null);
                    }
                    if (!select && matchedTd.parentElement) {
                        select = matchedTd.parentElement.querySelector('select');
                    }
                    if (!select) {
                        const tr = matchedTd.closest('tr');
                        if (tr) select = tr.querySelector('select');
                    }

                    if (!select) return { ok: false, reason: 'Select no encontrado cerca de la etiqueta' };

                    select.disabled = false;
                    select.classList.remove('aspNetDisabled');

                    if (!select.options || select.options.length === 0) {
                        return { ok: false, reason: 'El select no tiene opciones cargadas aun' };
                    }

                    let targetIdx = -1;
                    if (valueOrText !== null && valueOrText !== undefined && valueOrText !== '') {
                        const searchVal = removeAccents(String(valueOrText));
                        
                        // 1. Coincidencia exacta
                        for (let i = 0; i < select.options.length; i++) {
                            const opt = select.options[i];
                            if (!opt) continue;
                            const optText = removeAccents(opt.text || opt.innerText);
                            const optVal = removeAccents(opt.value);
                            if (optText === searchVal || optVal === searchVal) {
                                targetIdx = i;
                                break;
                            }
                        }

                        // 2. Coincidencia parcial (opcion contiene valor buscado)
                        if (targetIdx === -1) {
                            for (let i = 0; i < select.options.length; i++) {
                                const opt = select.options[i];
                                if (!opt) continue;
                                const optText = removeAccents(opt.text || opt.innerText);
                                if (optText.includes(searchVal)) {
                                    targetIdx = i;
                                    break;
                                }
                            }
                        }

                        // 3. Coincidencia inversa (valor buscado contiene opcion)
                        if (targetIdx === -1) {
                            for (let i = 0; i < select.options.length; i++) {
                                const opt = select.options[i];
                                if (!opt) continue;
                                const optText = removeAccents(opt.text || opt.innerText);
                                if (optText.length >= 4 && searchVal.includes(optText) && !optText.includes('SELECT') && !optText.includes('SELECCION')) {
                                    targetIdx = i;
                                    break;
                                }
                            }
                        }
                    }

                    if (targetIdx >= 0 && targetIdx < select.options.length) {
                        select.selectedIndex = targetIdx;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        if (typeof __doPostBack === 'function') {
                            try { __doPostBack(select.name, ''); } catch(e) {}
                        }
                        return { ok: true, textSelected: select.options[targetIdx].text };
                    }

                    return { ok: false, reason: 'Opcion no valida o lista vacia' };
                }, { labelText, valueOrText });

                if (exito && exito.ok) {
                    console.log(c.verde(`    ✅ [Filtro] "${labelText}" -> ${exito.textSelected}`));
                    await mainPage.waitForTimeout(600);
                    return true;
                } else {
                    console.log(c.amarillo(`    ⚠️ [Filtro] "${labelText}": ${exito ? exito.reason : 'No seleccionado'}`));
                    return false;
                }
            } catch (e) {
                console.log(c.amarillo(`    ⚠️ Error al seleccionar "${labelText}": ${e.message}`));
                return false;
            }
        };

        const seleccionarSSRS = async (id, valueOrText) => {
            try {
                const selectLocator = reportFrame.locator(`#${id}`);
                await selectLocator.waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});

                const exito = await selectLocator.evaluate((el, targetVal) => {
                    el.disabled = false;
                    el.classList.remove('aspNetDisabled');
                    let idx = -1;
                    if (typeof targetVal === 'number') {
                        idx = targetVal;
                    } else {
                        const search = targetVal.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
                        for (let i = 0; i < el.options.length; i++) {
                            const optText = el.options[i].text.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
                            if (optText.includes(search) || search.includes(optText)) {
                                idx = i;
                                break;
                            }
                        }
                    }
                    if (idx >= 0 && idx < el.options.length) {
                        el.selectedIndex = idx;
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        if (typeof __doPostBack === 'function') {
                            __doPostBack(el.name, '');
                        }
                        return true;
                    }
                    return false;
                }, valueOrText);

                if (!exito) {
                    if (typeof valueOrText === 'number') {
                        await selectLocator.selectOption({ index: valueOrText }).catch(() => {});
                    } else {
                        await selectLocator.selectOption({ label: valueOrText }).catch(() => {});
                    }
                }

                await reportPage.waitForTimeout(600); 
            } catch (e) {
                console.log(c.rojo(`    ⚠️ Error al seleccionar en ${id}: ${e.message}`));
            }
        };

        const seleccionarSSRSMulti = async (id, valueOrText) => {
            try {
                const btn = reportFrame.locator(`#${id}_ddDropDownButton`);
                await btn.waitFor({ state: 'visible', timeout: 5000 });
                await btn.click({ timeout: 15000 });
                
                const divDropdown = reportFrame.locator(`#${id}_divDropDown`);
                await divDropdown.waitFor({ state: 'visible', timeout: 5000 });
                
                await reportPage.waitForTimeout(800);

                if (valueOrText === '(Check All)') {
                    await divDropdown.evaluate(div => {
                        const checkboxes = div.querySelectorAll('input[type="checkbox"]');
                        checkboxes.forEach(chk => { if (!chk.checked) chk.click(); });
                    });
                } else {
                    const valores = valueOrText.split(',').map(v => v.trim());
                    
                    await divDropdown.evaluate((div, vals) => {
                        const labels = Array.from(div.querySelectorAll('label'));
                        
                        // Si no es (Select All), desmarcar (Select All) si esta marcado
                        if (!vals.includes('(Select All)')) {
                            const selectAllLabel = labels.find(l => l.innerText.includes('(Select All)'));
                            if (selectAllLabel) {
                                let chk = document.getElementById(selectAllLabel.htmlFor);
                                if (!chk) chk = selectAllLabel.querySelector('input[type="checkbox"]') || selectAllLabel.previousElementSibling;
                                if (chk && chk.checked) chk.click();
                            }
                        }
                        
                        // Marcar los especificos
                        for (const val of vals) {
                            const label = labels.find(l => l.innerText.toUpperCase().includes(val.toUpperCase()));
                            if (label) {
                                let chk = document.getElementById(label.htmlFor);
                                if (!chk) chk = label.querySelector('input[type="checkbox"]') || label.previousElementSibling;
                                if (chk && !chk.checked) chk.click();
                            }
                        }
                    }, valores);
                    
                    await reportPage.waitForTimeout(500); // Dar respiro al DOM
                }
                
                await reportFrame.locator('body').click();
                await reportPage.waitForTimeout(1500); 
            } catch (e) {
                try {
                    const divDropdown = reportFrame.locator(`#${id}_divDropDown`);
                    const labels = await divDropdown.locator('label').allInnerTexts();
                    console.log(c.amarillo(`      ⚠️ No se pudo seleccionar "${valueOrText}". Opciones vistas: ${labels.join(', ')}`));
                } catch(ign) {}
                console.log(c.rojo(`    ⚠️ Error al seleccionar multiple en ${id}: ${e.message}`));
            }
        };

        const seleccionarSSRSMultiByLabel = async (labelText, valueOrText) => {
            try {
                const removeAccents = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[*:]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
                const targetLabel = removeAccents(labelText);

                const okClicked = await reportFrame.evaluate(({ targetLabel }) => {
                    const removeAccents = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[*:]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
                    const allElements = Array.from(document.querySelectorAll('td, span, label, div')).reverse();
                    let matchedTd = null;

                    for (const el of allElements) {
                        const txt = removeAccents(el.innerText);
                        if (txt && (txt === targetLabel || txt.startsWith(targetLabel) || txt.includes(targetLabel))) {
                            if (el.innerText.length < 100) {
                                matchedTd = el.closest('td') || el;
                                break;
                            }
                        }
                    }

                    if (!matchedTd) return false;

                    let btn = matchedTd.querySelector('div[id*="ddDropDownButton"], input[id*="ddDropDownButton"]');
                    if (!btn && matchedTd.nextElementSibling) {
                        btn = matchedTd.nextElementSibling.querySelector('div[id*="ddDropDownButton"], input[id*="ddDropDownButton"]');
                    }
                    if (!btn && matchedTd.parentElement) {
                        btn = matchedTd.parentElement.querySelector('div[id*="ddDropDownButton"], input[id*="ddDropDownButton"]');
                    }

                    if (btn) {
                        btn.click();
                        return true;
                    }
                    return false;
                }, { targetLabel });

                if (okClicked) {
                    await mainPage.waitForTimeout(600);
                    
                    await reportFrame.evaluate(({ valueOrText }) => {
                        const removeAccents = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[*:]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
                        const openDropdown = document.querySelector('div[id*="divDropDown"][style*="visible"], div[id*="divDropDown"]:not([style*="display: none"])');
                        if (!openDropdown) return;

                        const labels = Array.from(openDropdown.querySelectorAll('label'));
                        
                        if (valueOrText === '(Select All)' || valueOrText === '(Check All)') {
                            const selectAll = labels.find(l => removeAccents(l.innerText).includes('SELECT ALL'));
                            if (selectAll) {
                                let chk = document.getElementById(selectAll.htmlFor) || selectAll.querySelector('input[type="checkbox"]');
                                if (chk && !chk.checked) chk.click();
                            }
                        } else {
                            const vals = String(valueOrText).split(',').map(v => removeAccents(v));
                            
                            if (!vals.includes('SELECT ALL')) {
                                const selectAll = labels.find(l => removeAccents(l.innerText).includes('SELECT ALL'));
                                if (selectAll) {
                                    let chk = document.getElementById(selectAll.htmlFor) || selectAll.querySelector('input[type="checkbox"]');
                                    if (chk && chk.checked) chk.click();
                                }
                            }

                            for (const val of vals) {
                                const matchedLabel = labels.find(l => {
                                    const txt = removeAccents(l.innerText);
                                    return txt.includes(val) || val.includes(txt);
                                });
                                if (matchedLabel) {
                                    let chk = document.getElementById(matchedLabel.htmlFor) || matchedLabel.querySelector('input[type="checkbox"]');
                                    if (chk && !chk.checked) chk.click();
                                }
                            }
                        }
                    }, { valueOrText });

                    await mainPage.waitForTimeout(400);
                    await reportFrame.locator('body').click().catch(() => {});
                    await mainPage.waitForTimeout(400);
                    console.log(c.verde(`    ✅ [Filtro Multi] "${labelText}" -> ${valueOrText}`));
                    return true;
                }
            } catch(e) {
                console.log(c.amarillo(`    ⚠️ [Filtro Multi] "${labelText}": ${e.message}`));
            }
            return false;
        };

        const obtenerReportFrame = async (targetPage) => {
            let frame = targetPage;
            try {
                await targetPage.waitForTimeout(2000);
                const iframeLoc = targetPage.locator('iframe[name="frameContent"], frame[name="frameContent"]').first();
                if (await iframeLoc.count() > 0) {
                    await iframeLoc.waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
                    await targetPage.waitForTimeout(2000);
                    frame = targetPage.frame({ name: 'frameContent' }) || targetPage;
                }
            } catch(e) {}

            try {
                const primerControl = frame.locator('select[id*="ddValue"], div[id*="ddDropDownButton"], td:has-text("Direccion"), select').first();
                await primerControl.waitFor({ state: 'visible', timeout: 35000 }).catch(() => {});
            } catch(e) {}

            return frame;
        };

        if (opcionReporte === 1) {
            console.log('  🚀 Navegando a Reportes -> Beneficiarios vinculados...\n');
            await mainPage.goto('https://rubonline.icbf.gov.co/Page/Reportes/TransversalReportes/List.aspx?oRp=1170', {
              waitUntil: 'domcontentloaded',
              timeout: 120000
            });
            reportFrame = await obtenerReportFrame(mainPage);
            console.log(c.verde('  ✅ Pantalla de reporte alcanzada.\n'));

            console.log(c.amarillo('  ⏳ Llenando filtros dinamicamente por etiqueta...'));
            
            await seleccionarSSRSByLabel('Tipo Unidad', 'Unidad de Servicio');
            await seleccionarSSRSByLabel('Direccion', 'Direccion de Primera Infancia');
            await seleccionarSSRSByLabel('Vigencia Contrato', asc.vigenciaContrato || '2024');
            await seleccionarSSRSByLabel('Regional', 'Bogota D.C.');
            await seleccionarSSRSByLabel('Centro Zonal', 'CZ USAQUEN');
            await seleccionarSSRSByLabel('Municipio', 'Bogota, D.C.');
            await seleccionarSSRSByLabel('Numero Contrato', asc.numeroContrato);
            await seleccionarSSRSByLabel('Ano de atencion', '2026');
            
            console.log('    👉 Marcando casilla NULL en Codigo de la UDS...');
            try {
                const chkLocator = reportFrame.locator('input[id*="ctl17_cbNull"], input[id*="cbNull"]').first();
                if (await chkLocator.count() > 0 && !(await chkLocator.isChecked().catch(() => false))) {
                    await chkLocator.check().catch(() => chkLocator.evaluate(n => n.checked = true));
                    await mainPage.waitForTimeout(600);
                }
            } catch(e) {}
        } else if (opcionReporte === 2) {
            console.log('  🚀 Navegando a Reportes -> Seguimiento nutricional de ninos y ninas...\n');
            await mainPage.goto('https://rubonline.icbf.gov.co/Page/Reportes/TransversalReportes/List.aspx?oRp=1177', {
              waitUntil: 'domcontentloaded',
              timeout: 120000
            });
            reportFrame = await obtenerReportFrame(mainPage);
            console.log(c.verde('  ✅ Pantalla de reporte alcanzada.\n'));

            console.log(c.amarillo('  ⏳ Aplicando filtros en pantalla de reporte...'));
            
            // 1. Area Misional
            await seleccionarSSRSByLabel('Area Misional', 'Dirección de Primera Infancia');
            await mainPage.waitForTimeout(1000);
            
            // 2. Regional
            await seleccionarSSRSByLabel('Regional', 'Bogota D.C.');
            await mainPage.waitForTimeout(1000);

            // 3. Centro Zonal
            await seleccionarSSRSByLabel('Centro Zonal', 'CZ USAQUEN');
            await mainPage.waitForTimeout(1000);

            // 4. Municipio
            await seleccionarSSRSMultiByLabel('Municipio', 'Bogota, D.C.') || await seleccionarSSRSMulti('ctl00_cphCont_rvTransversarReportes_ctl04_ctl09', 'Bogota, D.C.');
            await mainPage.waitForTimeout(800);
            
            // 5. Ano de Toma
            await seleccionarSSRSByLabel('Ano de Toma', '2026') || await seleccionarSSRSByLabel('Año de Toma', '2026');
            await mainPage.waitForTimeout(800);
            
            // 6. Entidad Contratista
            await seleccionarSSRSMultiByLabel('Entidad Contratista', asc.nombreCorto) || await seleccionarSSRSByLabel('Entidad Contratista', asc.nombreCorto);
            await mainPage.waitForTimeout(800);
            
            // 7. Periodo Toma
            await seleccionarSSRSByLabel('Periodo Toma', 'Mensual');
            await mainPage.waitForTimeout(800);

            // 8. Toma (Mes)
            await seleccionarSSRSMultiByLabel('Toma', seleccionToma) || await seleccionarSSRSMultiByLabel('Mes Toma', seleccionToma) || await seleccionarSSRSMulti('ctl00_cphCont_rvTransversarReportes_ctl04_ctl19', seleccionToma);
            await mainPage.waitForTimeout(800);
            
            // 9. TODAS LAS TOMAS
            await seleccionarSSRSByLabel('TODAS LAS TOMAS', 'NO');
        } else if (opcionReporte === 3 || opcionReporte === 4) {
            const reportName = opcionReporte === 3 ? "Informe de registro asistencia mensual" : "Unidades de servicio";
            console.log(`  🚀 Navegando a ${reportName}...\n`);
            
            // Si es la opcion 4 (Unidades de servicio), tomamos el ULTIMO que coincida
            // para evitar darle clic al que esta bajo "Calidad de datos"
            let reportLink = opcionReporte === 4 
                ? reportPage.locator(`a:text-is("${reportName}"), span:text-is("${reportName}")`).last()
                : reportPage.locator(`a:text-is("${reportName}"), span:text-is("${reportName}")`).first();
            
            if (await reportLink.count() === 0) {
                const contentFrame = reportPage.frame({ name: 'frameContent' });
                if (contentFrame) {
                    reportLink = opcionReporte === 4
                        ? contentFrame.locator(`a:text-is("${reportName}"), span:text-is("${reportName}")`).last()
                        : contentFrame.locator(`a:text-is("${reportName}"), span:text-is("${reportName}")`).first();
                }
            }

            if (await reportLink.count() === 0) {
                const text = await reportPage.locator('body').innerText();
                console.log(c.amarillo('  ⚠️ Texto de la pagina principal (primeros 500 chars):\n' + text.substring(0, 500)));
                throw new Error(`No se encontro el enlace al reporte "${reportName}" en el menu.`);
            }
            
            console.log('  👉 Haciendo clic en el menu del reporte...');
            const href = await reportLink.getAttribute('href').catch(() => null);
            if (href && href !== '#' && !href.startsWith('javascript')) {
                const absoluteUrl = new URL(href, reportPage.url()).href;
                await reportPage.goto(absoluteUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
            } else {
                await reportLink.click({ force: true });
                await reportPage.waitForTimeout(5000);
            }
            
            console.log(c.verde('  ✅ Pantalla de reporte alcanzada.\n'));
            await reportPage.waitForTimeout(2500);
            reportFrame = reportPage.frame({ name: 'frameContent' }) || reportPage;

            console.log('  ⏳ Esperando filtros SSRS...');
            await reportFrame.locator('#ctl00_cphCont_rvTransversarReportes_ctl04_ctl03_ddValue').waitFor({ state: 'visible', timeout: 30000 }).catch(()=>null);
            
            try {
                if (opcionReporte === 3) {
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl03_ddValue', 'Direccion de Primera Infancia');
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl05_ddValue', 'Bogota D.C.');
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl07_ddValue', '2024'); 
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl09_ddValue', asc.numeroContrato);
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl11_ddValue', '2026');
                    await seleccionarSSRSMulti('ctl00_cphCont_rvTransversarReportes_ctl04_ctl13', '(Check All)');
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl15_ddValue', 'CZ USAQUEN');
                    await seleccionarSSRSMulti('ctl00_cphCont_rvTransversarReportes_ctl04_ctl19', '(Select All)');
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl21_ddValue', mesAtencion);
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl23_ddValue', 'Todos');
                } else if (opcionReporte === 4) {
                    console.log('    👉 Llenando filtros de Unidades de servicio...');
                    
                    const exito = await seleccionarSSRSByLabel('Tipo Unidad', 'Unidad de Servicio');
                    if (!exito) {
                        const html = await reportFrame.locator('body').innerHTML();
                        const fs = require('fs');
                        const path = require('path');
                        fs.writeFileSync(path.join(__dirname, '..', 'reportes', 'debug_unidades_ssrs.html'), html);
                        console.log(c.amarillo('\n    ⚠️ He guardado el HTML del formulario en reportes/debug_unidades_ssrs.html'));
                        console.log(c.amarillo('    Por favor enviaselo a la IA (o avisale) para que lea los IDs exactos.'));
                    }

                    await seleccionarSSRSByLabel('Direccion ICBF *', 'Direccion de Primera Infancia');
                    await seleccionarSSRSByLabel('Vigencia Contrato', asc.vigenciaContrato);
                    await seleccionarSSRSByLabel('Regional UDS', 'Bogota D.C.');
                    await seleccionarSSRSByLabel('Centro Zonal de la UDS', 'CZ USAQUEN');
                    await seleccionarSSRSByLabel('Municipio', 'Bogota, D.C.');
                    await seleccionarSSRSByLabel('Numero Contrato', asc.numeroContrato);
                    
                    await seleccionarSSRSByLabel('Estado UDS', 'Activo');
                    await seleccionarSSRSByLabel('Estado UDS Contrato*', 'Activo');
                    await seleccionarSSRSByLabel('Vigencia del Servicio *', '2026'); 
                    await seleccionarSSRSByLabel('Tipo de Reporte*', 'Todas las UDS');
                }
            } catch(e) {
                console.log(c.rojo("  ⚠️ Posible problema con los filtros SSRS: " + e.message));
            }
        }


        await reportPage.waitForTimeout(1500);
        console.log('    👉 Generando reporte...');
        
        await reportFrame.locator('#ctl00_cphCont_rvTransversarReportes_ctl04_ctl00').click();
        console.log(c.cyan('    ⏳ Esperando a que el sistema procese el reporte (esto puede tardar unos minutos)...'));
        
        const exportButton = reportFrame.locator('#ctl00_cphCont_rvTransversarReportes_ctl05_ctl04_ctl00_ButtonImg, input[id*="ButtonImg"], a[title*="Export" i], img[alt*="Export" i], a[id*="ButtonLink"]').first();
        await exportButton.waitFor({ state: 'visible', timeout: 180000 }).catch(() => {});
        
        console.log('    👉 Iniciando descarga en Excel...');
        
        // 1. Intentar desplegar el menu de exportacion
        let exportBtn = reportFrame.locator('#ctl00_cphCont_rvTransversarReportes_ctl05_ctl04_ctl00_ButtonImg, input[id*="ButtonImg"], a[title*="Export" i], img[alt*="Export" i], a[id*="ButtonLink"]').first();
        if (await exportBtn.count() === 0) {
            exportBtn = exportButton;
        }

        if (await exportBtn.count() > 0) {
            await exportBtn.click({ force: true }).catch(() => exportBtn.evaluate(el => el.click()).catch(() => {}));
            await reportPage.waitForTimeout(1000);
            
            const excelOption = reportFrame.locator('a:has-text("Excel"), a[title*="Excel" i]').first();
            if (await excelOption.count() > 0) {
                await excelOption.click({ force: true }).catch(() => {});
            }
        }

        // 2. Ejecutar la funcion interna de exportacion de SSRS $find().exportReport() por JavaScript como respaldo infalible
        reportPage.setDefaultTimeout(180000);
        
        const [download] = await Promise.all([
            reportPage.waitForEvent('download', { timeout: 180000 }).catch(() => null),
            reportFrame.evaluate(() => {
                try {
                    const form = document.querySelector('form');
                    if (form) form.target = '_self';
                    window.open = function(url) { window.location.href = url; return window; };

                    if (typeof $find !== 'undefined') {
                        const rv = $find('ctl00_cphCont_rvTransversarReportes') || 
                                   Array.from(document.querySelectorAll('[id*="rvTransversarReportes"]'))
                                       .map(e => $find(e.id))
                                       .find(c => c && typeof c.exportReport === 'function');
                        
                        if (rv && typeof rv.exportReport === 'function') {
                            try { rv.exportReport('EXCELOPENXML'); } catch(e) { rv.exportReport('Excel'); }
                            return;
                        }
                    }

                    const links = Array.from(document.querySelectorAll('a'));
                    const excelLink = links.find(a => a.textContent && a.textContent.toLowerCase().includes('excel'));
                    if (excelLink) {
                        excelLink.removeAttribute('target');
                        excelLink.click();
                    }
                } catch (e) {
                    const links = Array.from(document.querySelectorAll('a'));
                    const excelLink = links.find(a => a.textContent && a.textContent.toLowerCase().includes('excel'));
                    if (excelLink) {
                        excelLink.removeAttribute('target');
                        excelLink.click();
                    }
                }
            })
        ]);
            
        reportPage.setDefaultTimeout(30000); // restaurar
        
        const prefijo = opcionReporte === 1 ? 'Beneficiarios' : (opcionReporte === 2 ? 'Nutricion' : (opcionReporte === 4 ? 'Unidades' : 'Asistencia'));
        const fileName = `${prefijo}_${asc.nombreCorto.replace(/[^a-z0-9]/gi, '_')}.xlsx`;
        const savePath = path.join(reportesDir, fileName);
        try {
            await download.saveAs(savePath);
            console.log(c.verde(`    ✅ Descargado exitosamente: ${fileName}`));
        } catch (saveError) {
            console.log(c.amarillo(`    ⚠️ Recuperando reporte desde carpeta de Descargas (Modo Humano)...`));
            const downloadsFolder = path.join(require('os').homedir(), 'Downloads');
            const files = fs.readdirSync(downloadsFolder).filter(f => f.endsWith('.xlsx'));
            if (files.length > 0) {
                files.sort((a, b) => fs.statSync(path.join(downloadsFolder, b)).mtimeMs - fs.statSync(path.join(downloadsFolder, a)).mtimeMs);
                const latestFile = path.join(downloadsFolder, files[0]);
                const mtimeMs = fs.statSync(latestFile).mtimeMs;
                if (Date.now() - mtimeMs < 300000) { // Creado en los ultimos 5 minutos
                    fs.copyFileSync(latestFile, savePath);
                    console.log(c.verde(`    ✅ Reporte recuperado y guardado exitosamente: ${fileName}`));
                } else {
                    console.log(c.rojo(`    ❌ No se encontro una descarga reciente para ${asc.nombreCorto}. El archivo en Downloads es de una ejecucion anterior.`));
                }
            } else {
                console.log(c.rojo(`    ❌ No se encontro el archivo descargado en la carpeta de Descargas.`));
            }
        }

        if (prepararExcel) {
            console.log('    ⚙️ Preparando reporte en Excel (limpieza, orden y filtros)...');
            // Darle tiempo al sistema a actualizar la UI tras el postback
            await reportPage.waitForTimeout(2500); 
            const { execSync } = require('child_process');
            try {
                const psScript = path.join(__dirname, 'preparar_excel.ps1');
                execSync(`powershell -ExecutionPolicy Bypass -File "${psScript}" -FilePath "${savePath}"`, { stdio: 'inherit' });
            } catch (psError) {
                console.log(c.rojo(`    ⚠️ Hubo un problema al preparar el excel: ${psError.message}`));
            }
        }
        
      } catch (error) {
        console.error(c.rojo(`\n  ❌ Ocurrio un error con ${asc.nombreCorto}:`), error.message);
      } finally {
        // Cierra la pestana del reporte si se abrio en una nueva (fallback)
        if (reportPage && reportPage !== mainPage) {
            await reportPage.close().catch(() => {});
        } else if (reportPage === mainPage && i < ascValidas.length - 1 && rolesUrl) {
            console.log('  🔄 Volviendo a la seleccion de roles para la siguiente asociacion...');
            await mainPage.goto(rolesUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await mainPage.waitForTimeout(1500);
        }
      }
  }

  // Al finalizar todas, no cerramos el contexto todavia
  console.log(c.verde('\n  ✅ Todas las asociaciones procesadas exitosamente.'));

  console.log(c.cyan('\n======================================================'));
  const respFinal = readline.question(c.negrita('  > Deseas generar otro reporte? (s = Si, n = Volver al panel principal) [por defecto s]: '));
  if (respFinal.toLowerCase().trim() === 'n') {
      console.log(c.verde('\n  👋 Volviendo al panel principal (AutoTrabajo)...\n'));
      break;
  }
  } // fin while (true)

  console.log(c.verde('\n  👋 Modulo finalizado.\n'));
  if (browser) await browser.close().catch(() => {});
  process.exit(0);
}

main().catch((err) => {
  console.error(c.rojo('\n❌ Error inesperado:'), err.message);
  process.exit(1);
});
