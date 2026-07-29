/**
 * descargar-reportes.js
 * Script base para navegar al módulo de reportes y preparar la automatización.
 *
 * Uso: npm run reportes
 */

require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const { loginYLlegarARoles, seleccionarRolYEntrar } = require('../servicios/autenticacion');

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

  const { leerJardines } = require('../servicios/excel-reader');
  const readline = require('readline-sync');
  
  // Cargar datos del Excel
  const RUTA_EXCEL = process.env.RUTA_EXCEL || 'C:\\GENERAL.xlsx';
  const { porAsociacion } = leerJardines(RUTA_EXCEL);
  let asociaciones = Object.values(porAsociacion);
  
  console.log(c.cyan('\n  📋 Selecciona el Reporte a generar:'));
  console.log(c.amarillo(`  1. Beneficiarios vinculados`));
  console.log(c.amarillo(`  2. Seguimiento nutricional de niños y niñas por toma`));
  console.log(c.amarillo(`  3. Informe de registro asistencia mensual`));
  console.log(c.amarillo(`  4. Unidades de servicio`));
  
  let opcionReporte = -1;
  while (opcionReporte < 1 || opcionReporte > 4) {
    const respuesta = readline.question(c.negrita('\n  > Ingresa el numero del reporte (1, 2, 3 o 4): '));
    opcionReporte = parseInt(respuesta, 10);
    if (isNaN(opcionReporte)) opcionReporte = -1;
  }
  
  let seleccionToma = '(Select All)';
  let mesAtencion = '(Select All)';
  if (opcionReporte === 2) {
    console.log(c.cyan('\n  📋 Selecciona el mes de Toma:'));
    console.log(c.gris(`  Puedes escribir "(Select All)" o el nombre exacto como "Julio".`));
    const respuestaToma = readline.question(c.negrita('\n  > Ingresa la Toma [por defecto (Select All)]: '));
    if (respuestaToma.trim() !== '') {
        seleccionToma = respuestaToma.trim();
    }
  } else if (opcionReporte === 3 || opcionReporte === 4) {
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
    
    if (partes.length === 0) continue;

    if (partes.includes(0)) {
        asociacionesSeleccionadas = asociaciones;
        break;
    }

    const invalidos = partes.filter(n => n < 1 || n > asociaciones.length);
    if (invalidos.length > 0) {
        console.log(c.rojo(`  ⚠️ Opciones inválidas: ${invalidos.join(', ')}`));
        continue;
    }

    // Filtrar duplicados en caso de que el usuario repita números
    const partesUnicas = [...new Set(partes)];
    asociacionesSeleccionadas = partesUnicas.map(n => asociaciones[n - 1]);
  }
  
  asociaciones = asociacionesSeleccionadas;

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
  
  console.log(c.cyan('\n  🌐 Abriendo navegador...\n'));
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
    args: ['--start-maximized'],
    executablePath: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
  });
  
  const fs = require('fs');
  const reportesDir = path.join(__dirname, '..', 'reportes');
  if (!fs.existsSync(reportesDir)) {
      fs.mkdirSync(reportesDir, { recursive: true });
  }

  // Filtrar asociaciones que tengan contrato para procesarlas
  const ascValidas = asociaciones.filter(a => a.numeroContrato);

  if (ascValidas.length === 0) {
    console.log(c.rojo("  ⚠️ No hay asociaciones válidas con contrato."));
    await browser.close();
    return;
  }

  const context = await browser.newContext({ viewport: null });
  const mainPage = await context.newPage();

  console.log(c.amarillo(`\n======================================================`));
  console.log(c.amarillo(`▶ Iniciando sesión única y 2FA...`));
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
    // Guardar el estado del DOM de la pantalla de roles
    rolesHtml = await mainPage.content();
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

      if (i > 0) {
          console.log(c.gris(`\n    🔄 Cerrando sesión actual para cambiar de asociación...`));
          try {
              await context.clearCookies();
              rolesUrl = await loginYLlegarARoles(mainPage, {
                usuario: USUARIO,
                password: PASSWORD,
                gmailUser: GMAIL_USER,
                gmailAppPassword: GMAIL_APP_PASSWORD
              });
              rolesHtml = await mainPage.content();
          } catch (e) {
              console.log(c.rojo(`    ⚠️ Error al reloguear para la siguiente asociación: ${e.message}`));
              continue;
          }
      }

      console.log(c.amarillo(`\n======================================================`));
      console.log(c.amarillo(`▶ Procesando Asociación [${i+1}/${ascValidas.length}]: ${asc.nombreCorto}`));
      console.log(c.amarillo(`======================================================`));
      console.log(`    Contrato: ${asc.numeroContrato} (Vigencia: ${asc.vigenciaContrato})`);
      console.log('  🏢 Seleccionando entidad (asociación)...');
      await seleccionarRolYEntrar(mainPage, asc);
      console.log(c.verde('  ✅ Login exitoso en Cuéntame.'));

      try {
        // Definimos la variable para que las funciones helper la capturen.
        // Se inicializa apuntando a mainPage y luego cada reporte la reasigna a frameContent si existe.
        let reportFrame = mainPage;

        // Función helper simple
        const seleccionarSSRS = async (id, valueOrText) => {
            try {
                const selectLocator = reportFrame.locator(`#${id}`);
                await selectLocator.waitFor({ state: 'visible', timeout: 5000 });
                if (typeof valueOrText === 'number') {
                    await selectLocator.selectOption({ index: valueOrText });
                } else {
                    await selectLocator.selectOption({ label: valueOrText });
                }
                // Esperar a que SSRS haga el postback y desbloquee el resto de selects
                await mainPage.waitForTimeout(2000); 
            } catch (e) {
                console.log(c.rojo(`    ⚠️ Error al seleccionar en ${id}: ${e.message}`));
            }
        };

        const seleccionarSSRSMulti = async (id, valueOrText) => {
            try {
                const btn = reportFrame.locator(`#${id}_ddDropDownButton`);
                await btn.waitFor({ state: 'visible', timeout: 5000 });
                // Playwright click() auto-waits for element to be enabled
                await btn.click({ timeout: 15000 });
                
                const divDropdown = reportFrame.locator(`#${id}_divDropDown`);
                await divDropdown.waitFor({ state: 'visible', timeout: 5000 });
                
                // Allow time for AJAX postback to populate the dropdown
                await mainPage.waitForTimeout(2000);

                if (valueOrText === '(Check All)') {
                    const checkboxes = await divDropdown.locator('input[type="checkbox"]').all();
                    for (const chk of checkboxes) {
                        if (!(await chk.isChecked())) {
                            await chk.check({ force: true });
                        }
                    }
                } else {
                    const escapedText = valueOrText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = valueOrText === '(Select All)' 
                        ? new RegExp('^\\(Select All\\)$', 'i') 
                        : new RegExp(escapedText, 'i'); // Substring match

                    try {
                        const checkbox = divDropdown.getByRole('checkbox', { name: regex }).first();
                        await checkbox.waitFor({ state: 'visible', timeout: 4000 });
                        await checkbox.check({ force: true });
                    } catch (err) {
                        const textNode = divDropdown.getByText(regex).first();
                        await textNode.waitFor({ state: 'visible', timeout: 4000 });
                        await textNode.click({ force: true });
                    }
                }
                
                // Cerrar menú y disparar postback
                await reportFrame.locator('body').click();
                await mainPage.waitForTimeout(3000); 
            } catch (e) {
                // Log available options for debugging si todo falla
                try {
                    const divDropdown = reportFrame.locator(`#${id}_divDropDown`);
                    const labels = await divDropdown.locator('label').allInnerTexts();
                    console.log(c.amarillo(`      ⚠️ No se pudo seleccionar "${valueOrText}". Opciones vistas: ${labels.join(', ')}`));
                } catch(ign) {}
                console.log(c.rojo(`    ⚠️ Error al seleccionar múltiple en ${id}: ${e.message}`));
            }
        };

        if (opcionReporte === 1) {
            console.log('  🚀 Navegando a Reportes -> Beneficiarios vinculados...\n');
            await mainPage.goto('https://rubonline.icbf.gov.co/Page/Reportes/TransversalReportes/List.aspx?oRp=1170', {
              waitUntil: 'domcontentloaded',
              timeout: 120000
            });
            console.log(c.verde('  ✅ Pantalla de reporte alcanzada.\n'));
            await mainPage.waitForTimeout(3000);
            
            reportFrame = mainPage.frame({ name: 'frameContent' }) || mainPage;

            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl03_ddValue', 'Unidad de Servicio');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl05_ddValue', 'Dirección de Primera Infancia');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl09_ddValue', 'Bogota D.C.');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl11_ddValue', 'CZ USAQUEN');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl13_ddValue', 'Bogota, D.C.');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl07_ddValue', asc.vigenciaContrato);
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl15_ddValue', asc.numeroContrato);
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl19_ddValue', '2026');
            
            console.log('    👉 Marcando casilla NULL en Código de la UDS...');
            try {
                const nullCheckboxId = 'ctl00_cphCont_rvTransversarReportes_ctl04_ctl17_cbNull';
                const chkLocator = reportFrame.locator(`#${nullCheckboxId}`);
                if (!(await chkLocator.isChecked())) {
                    await chkLocator.check();
                    // Esperar a que SSRS procese
                    await mainPage.waitForTimeout(1500);
                }
            } catch(e) {}
        } else if (opcionReporte === 2) {
            console.log('  🚀 Navegando a Reportes -> Seguimiento nutricional de niños y niñas...\n');
            await mainPage.goto('https://rubonline.icbf.gov.co/Page/Reportes/TransversalReportes/List.aspx?oRp=1177', {
              waitUntil: 'domcontentloaded',
              timeout: 120000
            });
            console.log(c.verde('  ✅ Pantalla de reporte alcanzada.\n'));
            await mainPage.waitForTimeout(3000);
            
            reportFrame = mainPage.frame({ name: 'frameContent' }) || mainPage;

            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl03_ddValue', 'Dirección de Primera Infancia');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl05_ddValue', 'Bogota D.C.');
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl07_ddValue', 'CZ USAQUEN');
            // Municipio en el Nutricional (oRp=1177) ES MULTI-SELECT! (a diferencia del otro reporte)
            await seleccionarSSRSMulti('ctl00_cphCont_rvTransversarReportes_ctl04_ctl09', 'Bogota, D.C.');
            
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl11_ddValue', '2026');
            
            await seleccionarSSRSMulti('ctl00_cphCont_rvTransversarReportes_ctl04_ctl15', asc.nombreCorto);
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl17_ddValue', 'Mensual');
            await seleccionarSSRSMulti('ctl00_cphCont_rvTransversarReportes_ctl04_ctl13', '(Select All)');
            await seleccionarSSRSMulti('ctl00_cphCont_rvTransversarReportes_ctl04_ctl19', seleccionToma);
            await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl21_ddValue', 'NO');
        } else if (opcionReporte === 3 || opcionReporte === 4) {
            const reportName = opcionReporte === 3 ? "Informe de registro asistencia mensual" : "Unidades de servicio";
            console.log(`  🚀 Navegando a ${reportName}...\n`);
            let reportLink = mainPage.locator(`a:has-text("${reportName}"), span:has-text("${reportName}")`).first();
            
            if (await reportLink.count() === 0) {
                const contentFrame = mainPage.frame({ name: 'frameContent' });
                if (contentFrame) {
                    reportLink = contentFrame.locator(`a:has-text("${reportName}"), span:has-text("${reportName}")`).first();
                }
            }

            if (await reportLink.count() === 0) {
                const text = await mainPage.locator('body').innerText();
                console.log(c.amarillo('  ⚠️ Texto de la página principal (primeros 500 chars):\n' + text.substring(0, 500)));
                throw new Error(`No se encontró el enlace al reporte "${reportName}" en el menú.`);
            }
            
            console.log('  👉 Haciendo clic en el menú del reporte...');
            const href = await reportLink.getAttribute('href').catch(() => null);
            if (href && href !== '#' && !href.startsWith('javascript')) {
                const absoluteUrl = new URL(href, mainPage.url()).href;
                await mainPage.goto(absoluteUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
            } else {
                await reportLink.click({ force: true });
                await mainPage.waitForTimeout(5000);
            }
            
            console.log(c.verde('  ✅ Pantalla de reporte alcanzada.\n'));
            await mainPage.waitForTimeout(3000);
            reportFrame = mainPage.frame({ name: 'frameContent' }) || mainPage;

            console.log('  ⏳ Esperando filtros SSRS...');
            await reportFrame.locator('#ctl00_cphCont_rvTransversarReportes_ctl04_ctl03_ddValue').waitFor({ state: 'visible', timeout: 30000 }).catch(()=>null);
            
            try {
                if (opcionReporte === 3) {
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl03_ddValue', 'Dirección de Primera Infancia');
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl05_ddValue', 'Bogota D.C.');
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl07_ddValue', '2024'); // O el que corresponda
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl09_ddValue', asc.numeroContrato);
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl11_ddValue', '2026');
                    await seleccionarSSRSMulti('ctl00_cphCont_rvTransversarReportes_ctl04_ctl13', '(Check All)');
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl15_ddValue', 'CZ USAQUEN');
                    await seleccionarSSRSMulti('ctl00_cphCont_rvTransversarReportes_ctl04_ctl19', '(Select All)');
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl21_ddValue', mesAtencion);
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl23_ddValue', 'Todos');
                } else if (opcionReporte === 4) {
                    // Unidades de servicio filters
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl03_ddValue', 'Dirección de Primera Infancia');
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl05_ddValue', 'Bogota D.C.');
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl07_ddValue', 'CZ USAQUEN');
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl09_ddValue', 'Bogota, D.C.');
                    await seleccionarSSRS('ctl00_cphCont_rvTransversarReportes_ctl04_ctl11_ddValue', asc.vigenciaContrato);
                    await seleccionarSSRSMulti('ctl00_cphCont_rvTransversarReportes_ctl04_ctl13', asc.numeroContrato);
                }
            } catch(e) {
                console.log(c.rojo("  ⚠️ Posible problema con los filtros SSRS: " + e.message));
            }
        }


        await mainPage.waitForTimeout(1000);
        console.log('    👉 Generando reporte...');
        
        await reportFrame.locator('#ctl00_cphCont_rvTransversarReportes_ctl04_ctl00').click();
        console.log(c.cyan('    ⏳ Esperando a que el sistema procese el reporte (esto puede tardar unos minutos)...'));
        
        // Esperamos hasta 2 minutos a que aparezca el icono de exportar
        const exportButton = reportFrame.locator('#ctl00_cphCont_rvTransversarReportes_ctl05_ctl04_ctl00_ButtonImg');
        await exportButton.waitFor({ state: 'visible', timeout: 120000 });
        
        console.log('    👉 Iniciando descarga en Excel...');
        const downloadPromise = mainPage.waitForEvent('download', { timeout: 120000 });
        const exportMenu = reportFrame.locator('a[title="Export"], a[title="Exportar"], img[alt="Export"]').first();
        if (await exportMenu.isVisible()) {
            await exportMenu.click();
            await mainPage.waitForTimeout(1000);
            
            const excelOption = reportFrame.locator('a:has-text("Excel")').first();
            await excelOption.click();
            
            const download = await downloadPromise;
            const prefijo = opcionReporte === 1 ? 'Beneficiarios' : (opcionReporte === 2 ? 'Nutricion' : 'Asistencia');
            const fileName = `${prefijo}_${asc.nombreCorto.replace(/[^a-z0-9]/gi, '_')}.xlsx`;
            const savePath = path.join(reportesDir, fileName);
            await download.saveAs(savePath);
            console.log(c.verde(`    ✅ Descargado exitosamente: ${fileName}`));

            if (prepararExcel) {
                console.log('    ⚙️ Preparando reporte en Excel (limpieza, orden y filtros)...');
                // Darle tiempo al sistema a actualizar la UI tras el postback
                await mainPage.waitForTimeout(3000); 
                const { execSync } = require('child_process');
                try {
                    const psScript = path.join(__dirname, 'preparar_excel.ps1');
                    execSync(`powershell -ExecutionPolicy Bypass -File "${psScript}" -FilePath "${savePath}"`, { stdio: 'inherit' });
                } catch (psError) {
                    console.log(c.rojo(`    ⚠️ Hubo un problema al preparar el excel: ${psError.message}`));
                }
            }
        } else {
            console.log(c.rojo(`    ⚠️ No se encontró el botón de exportar. ¿Falló la generación del reporte?`));
        }
        
      } catch (error) {
        console.error(c.rojo(`\n  ❌ Ocurrió un error con ${asc.nombreCorto}:`), error.message);
      } finally {
        // La limpieza se maneja al inicio de la siguiente iteración
      }
  }

  // Al finalizar todas, cerrar contexto
  console.log(c.verde('\n  ✅ Todas las asociaciones procesadas. Cerrando navegador...'));
  await context.close().catch(() => {});

  await browser.close();
}

main().catch((err) => {
  console.error(c.rojo('\n❌ Error inesperado:'), err.message);
  process.exit(1);
});
