/**
 * descargar-reportes.js
 * Script base para navegar al módulo de reportes y preparar la automatización.
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
  console.log(c.amarillo(`  2. Seguimiento nutricional de niños y niñas por toma`));
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
    console.log(c.gris('  (Puedes ingresar números como "5,6,7" o el nombre de los meses)'));

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
    console.log(c.cyan('\n  📋 Selecciona el Mes de Atención:'));
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
  
  console.log(c.cyan('\n  📋 Selecciona la Asociación para procesar:'));
  console.log(c.amarillo(`  0. 🌟 TODAS LAS ASOCIACIONES`));
  asociaciones.forEach((asc, idx) => {
    console.log(`  ${idx + 1}. ${asc.nombreCorto} (Contrato: ${asc.numeroContrato || 'N/A'})`);
  });
  
  let asociacionesSeleccionadas = [];
  while (asociacionesSeleccionadas.length === 0) {
    console.log(c.gris('  (Puedes ingresar varios números separados por coma, ej: 1,3,4)'));
    const respuesta = readline.question(c.negrita('\n  > Ingresa el numero de la(s) opcion(es): '));
    
    const partes = respuesta.split(',').map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n));
    
    if (partes.includes(0)) {
        asociacionesSeleccionadas = asociaciones;
    } else {
        const validas = partes.filter(n => n >= 1 && n <= asociaciones.length);
        if (validas.length > 0) {
            asociacionesSeleccionadas = validas.map(n => asociaciones[n - 1]);
        } else {
            console.log(c.rojo('  ❌ Opción no válida. Intenta nuevamente.'));
        }
    }
  }

  let prepararExcel = false;
  
  if (opcionReporte === 1 || opcionReporte === 2) {
      console.log(c.cyan('\n  📋 ¿Qué acción realizar con el reporte descargado?'));
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
      console.log(c.gris('\n  ℹ️ El reporte se descargará en su formato original (sin modificar).'));
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
    console.log(c.rojo("  ⚠️ No hay asociaciones válidas con contrato seleccionadas."));
    continue;
  }

  console.log(c.amarillo(`\n======================================================`));
  console.log(c.amarillo(`▶ Iniciando sesión y navegación...`));
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

  // Iterar por cada asociación
  for (let i = 0; i < ascValidas.length; i++) {
      const asc = ascValidas[i];

      // Corrección manual de contrato solicitada por el usuario
      if (asc.nombreCorto && asc.nombreCorto.toUpperCase().includes('VERBENAL')) {
          asc.numeroContrato = '11027492024';
      }

      // La página principal se queda en la selección de roles.
      // Le pedimos a seleccionarRolYEntrar que abra Cuéntame en una pestaña nueva
      let reportPage;
      try {
          console.log(c.amarillo(`\n======================================================`));
          console.log(c.amarillo(`▶ Procesando Asociación [${i+1}/${ascValidas.length}]: ${asc.nombreCorto}`));
          console.log(c.amarillo(`======================================================`));
          console.log(`    Contrato: ${asc.numeroContrato} (Vigencia: ${asc.vigenciaContrato})`);
          
          // Navegar SIEMPRE a la pantalla de selección de roles (DefaultF.aspx) para cambiar la entidad activa en Cuéntame
          if (!rolesUrl || mainPage.isClosed()) {
              rolesUrl = await loginYLlegarARoles(mainPage, { usuario: USUARIO, password: PASSWORD, gmailUser: GMAIL_USER, gmailAppPassword: GMAIL_APP_PASSWORD });
          }

          console.log('  🏢 Navegando a la pantalla de selección de entidad...');
          await mainPage.goto(rolesUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await mainPage.waitForTimeout(2000);

          const currentText = await mainPage.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
          if (currentText.includes('Iniciar Sesión') || currentText.includes('Ingrese su código') || !mainPage.url().includes('DefaultF.aspx')) {
              console.log(c.amarillo('  🔑 Re-iniciando sesión y 2FA en Cuéntame...'));
              rolesUrl = await loginYLlegarARoles(mainPage, { usuario: USUARIO, password: PASSWORD, gmailUser: GMAIL_USER, gmailAppPassword: GMAIL_APP_PASSWORD });
          }

          console.log(`  🏢 Seleccionando entidad/asociación: "${asc.nombreCorto}"...`);
          reportPage = await seleccionarRolYEntrar(mainPage, asc, false);
          console.log(c.verde(`  ✅ Asociación "${asc.nombreCorto}" cargada exitosamente en la plataforma.`));
      } catch (e) {
          console.log(c.rojo(`  ❌ Error al cambiar a la asociación ${asc.nombreCorto}: ${e.message}`));
          continue;
      }

      try {
        // Definimos la variable para que las funciones helper la capturen.
        let reportFrame = reportPage;

        // Función helper que busca un select en SSRS a partir de su label (texto) y lo llena
        const seleccionarSSRSByLabel = async (labelText, valueOrText) => {
            try {
                const tdElements = reportFrame.locator('td', { hasText: labelText });
                
                if (await tdElements.count() === 0) {
                    console.log(c.amarillo(`    ⚠️ No se encontró la etiqueta "${labelText}" en la página.`));
                    return false;
                }
                
                const lastTd = tdElements.last();
                let selectElement = lastTd.locator('select').first();
                
                if (await selectElement.count() === 0) {
                    selectElement = lastTd.locator('xpath=following-sibling::td[1]//select').first();
                }
                
                if (await selectElement.count() === 0) {
                    selectElement = lastTd.locator('xpath=following-sibling::td[2]//select').first();
                }
                
                if (await selectElement.count() === 0) {
                    console.log(c.amarillo(`    ⚠️ Se encontró el texto "${labelText}" pero no hay un <select> cerca.`));
                    return false;
                }

                await selectElement.waitFor({ state: 'visible', timeout: 5000 });
                
                let isDisabled = await selectElement.evaluate(el => el.disabled);
                let waitAttempts = 0;
                if (isDisabled) {
                    console.log(c.gris(`      (Esperando a que "${labelText}" se habilite tras el postback...)`));
                }
                while (isDisabled && waitAttempts < 15) { 
                    await reportPage.waitForTimeout(1500);
                    isDisabled = await selectElement.evaluate(el => el.disabled);
                    waitAttempts++;
                }
                
                if (typeof valueOrText === 'number') {
                    await selectElement.selectOption({ index: valueOrText });
                } else {
                    try {
                        await selectElement.selectOption({ label: valueOrText }, { timeout: 2000 });
                    } catch (err) {
                        console.log(c.gris(`      (Buscando opción que contenga "${valueOrText}")...`));
                        const options = await selectElement.locator('option').all();
                        let foundValue = null;
                        const availableTexts = [];
                        const valBuscado = valueOrText.toUpperCase().replace(/\s+/g, ' ').trim();
                        
                        for (const opt of options) {
                            const text = await opt.textContent();
                            if (text) {
                                const cleanText = text.replace(/\s+/g, ' ').trim();
                                availableTexts.push(cleanText);
                                if (cleanText.toUpperCase().includes(valBuscado)) {
                                    foundValue = await opt.getAttribute('value');
                                    break;
                                }
                            }
                        }
                        if (foundValue !== null) {
                            await selectElement.selectOption({ value: foundValue });
                        } else {
                            throw new Error(`No se encontró ninguna opción que contenga "${valueOrText}". Opciones disponibles: [${availableTexts.join(', ')}]`);
                        }
                    }
                }
                
                await reportPage.waitForTimeout(1500); 
                return true;
            } catch (e) {
                console.log(c.rojo(`    ⚠️ Error al seleccionar "${labelText}": ${e.message}`));
                return false;
            }
        };

        const seleccionarSSRS = async (id, valueOrText) => {
            try {
                const selectLocator = reportFrame.locator(`#${id}`);
                await selectLocator.waitFor({ state: 'visible', timeout: 5000 });
                if (typeof valueOrText === 'number') {
                    await selectLocator.selectOption({ index: valueOrText });
                } else {
                    await selectLocator.selectOption({ label: valueOrText });
                }
                await reportPage.waitForTimeout(1500); 
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
                        
                        // Si no es (Select All), desmarcar (Select All) si está marcado
                        if (!vals.includes('(Select All)')) {
                            const selectAllLabel = labels.find(l => l.innerText.includes('(Select All)'));
                            if (selectAllLabel) {
                                let chk = document.getElementById(selectAllLabel.htmlFor);
                                if (!chk) chk = selectAllLabel.querySelector('input[type="checkbox"]') || selectAllLabel.previousElementSibling;
                                if (chk && chk.checked) chk.click();
                            }
                        }
                        
                        // Marcar los específicos
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
                console.log(c.rojo(`    ⚠️ Error al seleccionar múltiple en ${id}: ${e.message}`));
            }
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
                const primerControl = frame.locator('select[id*="ddValue"], div[id*="ddDropDownButton"], td:has-text("Dirección"), select').first();
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

            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl03_ddValue', 'Unidad de Servicio');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl05_ddValue', 'Dirección de Primera Infancia');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl09_ddValue', 'Bogota D.C.');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl11_ddValue', 'CZ USAQUEN');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl13_ddValue', 'Bogota, D.C.');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl07_ddValue', asc.vigenciaContrato);
            
            const okContrato = await seleccionarSSRSByLabel('Número Contrato', asc.numeroContrato);
            if (!okContrato) {
                await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl15_ddValue', asc.numeroContrato);
            }
            
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl19_ddValue', '2026');
            
            console.log('    👉 Marcando casilla NULL en Código de la UDS...');
            try {
                const nullCheckboxId = 'ctl00_cphCont_rvTransversarReportes_ctl04_ctl17_cbNull';
                const chkLocator = reportFrame.locator(`#${nullCheckboxId}`);
                if (!(await chkLocator.isChecked())) {
                    await chkLocator.check();
                    await mainPage.waitForTimeout(1500);
                }
            } catch(e) {}
        } else if (opcionReporte === 2) {
            console.log('  🚀 Navegando a Reportes -> Seguimiento nutricional de niños y niñas...\n');
            await reportPage.goto('https://rubonline.icbf.gov.co/Page/Reportes/TransversalReportes/List.aspx?oRp=1177', {
              waitUntil: 'domcontentloaded',
              timeout: 120000
            });
            reportFrame = await obtenerReportFrame(reportPage);
            console.log(c.verde('  ✅ Pantalla de reporte alcanzada.\n'));

            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl03_ddValue', 'Dirección de Primera Infancia');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl05_ddValue', 'Bogota D.C.');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl07_ddValue', 'CZ USAQUEN');
            await seleccionarSSRSMulti('ctl00_cphCont_rvTransversarReportes_ctl04_ctl09', 'Bogota, D.C.');
            
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl11_ddValue', '2026');
            
            await seleccionarSSRSMulti('ctl00_cphCont_rvTransversarReportes_ctl04_ctl15', asc.nombreCorto);
            await seleccionarSSRSByLabel('Nombre Entidad Contratista', asc.nombreCorto);
            
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl17_ddValue', 'Mensual');
            await seleccionarSSRSMulti('ctl00_cphCont_rvTransversarReportes_ctl04_ctl13', '(Select All)');
            await seleccionarSSRSMulti('ctl00_cphCont_rvTransversarReportes_ctl04_ctl19', seleccionToma);
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl21_ddValue', 'NO');
        } else if (opcionReporte === 3 || opcionReporte === 4) {
            const reportName = opcionReporte === 3 ? "Informe de registro asistencia mensual" : "Unidades de servicio";
            console.log(`  🚀 Navegando a ${reportName}...\n`);
            
            // Si es la opción 4 (Unidades de servicio), tomamos el ÚLTIMO que coincida
            // para evitar darle clic al que está bajo "Calidad de datos"
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
                console.log(c.amarillo('  ⚠️ Texto de la página principal (primeros 500 chars):\n' + text.substring(0, 500)));
                throw new Error(`No se encontró el enlace al reporte "${reportName}" en el menú.`);
            }
            
            console.log('  👉 Haciendo clic en el menú del reporte...');
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
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl03_ddValue', 'Dirección de Primera Infancia');
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
                        console.log(c.amarillo('    Por favor envíaselo a la IA (o avísale) para que lea los IDs exactos.'));
                    }

                    await seleccionarSSRSByLabel('Dirección ICBF *', 'Dirección de Primera Infancia');
                    await seleccionarSSRSByLabel('Vigencia Contrato', asc.vigenciaContrato);
                    await seleccionarSSRSByLabel('Regional UDS', 'Bogota D.C.');
                    await seleccionarSSRSByLabel('Centro Zonal de la UDS', 'CZ USAQUEN');
                    await seleccionarSSRSByLabel('Municipio', 'Bogota, D.C.');
                    await seleccionarSSRSByLabel('Número Contrato', asc.numeroContrato);
                    
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
        
        // 1. Intentar desplegar el menú de exportación
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

        // 2. Ejecutar la función interna de exportación de SSRS $find().exportReport() por JavaScript como respaldo infalible
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
                if (Date.now() - mtimeMs < 300000) { // Creado en los últimos 5 minutos
                    fs.copyFileSync(latestFile, savePath);
                    console.log(c.verde(`    ✅ Reporte recuperado y guardado exitosamente: ${fileName}`));
                } else {
                    console.log(c.rojo(`    ❌ No se encontró una descarga reciente para ${asc.nombreCorto}. El archivo en Downloads es de una ejecución anterior.`));
                }
            } else {
                console.log(c.rojo(`    ❌ No se encontró el archivo descargado en la carpeta de Descargas.`));
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
        console.error(c.rojo(`\n  ❌ Ocurrió un error con ${asc.nombreCorto}:`), error.message);
      } finally {
        // Cierra la pestaña del reporte si se abrió en una nueva (fallback)
        if (reportPage && reportPage !== mainPage) {
            await reportPage.close().catch(() => {});
        } else if (reportPage === mainPage && i < ascValidas.length - 1 && rolesUrl) {
            console.log('  🔄 Volviendo a la selección de roles para la siguiente asociación...');
            await mainPage.goto(rolesUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await mainPage.waitForTimeout(1500);
        }
      }
  }

  // Al finalizar todas, no cerramos el contexto todavía
  console.log(c.verde('\n  ✅ Todas las asociaciones procesadas exitosamente.'));

  console.log(c.cyan('\n======================================================'));
  const respFinal = readline.question(c.negrita('  > ¿Deseas generar otro reporte? (s = Si, n = Volver al panel principal) [por defecto s]: '));
  if (respFinal.toLowerCase().trim() === 'n') {
      console.log(c.verde('\n  👋 Volviendo al panel principal (AutoTrabajo)...\n'));
      break;
  }
  } // fin while (true)

  console.log(c.verde('\n  👋 Módulo finalizado.\n'));
  if (browser) await browser.disconnect().catch(() => {});
  process.exit(0);
}

main().catch((err) => {
  console.error(c.rojo('\n❌ Error inesperado:'), err.message);
  process.exit(1);
});
