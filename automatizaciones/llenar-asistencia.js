/**
 * llenar-asistencia.js
 * Script para automatizar el llenado masivo de Registro de Asistencia Mensual (RAM) y el desmarcado de inasistencias interactivamente.
 */

require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const readline = require('readline-sync');
const { loginYLlegarARoles, seleccionarRolYEntrar } = require('../servicios/autenticacion');

const c = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
  rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
  gris:     (t) => `\x1b[90m${t}\x1b[0m`,
  negrita:  (t) => `\x1b[1m${t}\x1b[0m`,
};

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
  const RUTA_EXCEL = process.env.RUTA_EXCEL || 'C:\\GENERAL_BOTS.xlsx';
  const { porAsociacion } = leerJardines(RUTA_EXCEL);
  let asociaciones = Object.values(porAsociacion);

  console.log(c.cyan('\n  📋 Configuración de Asistencia (RAM)'));
  
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const mesIndex = readline.keyInSelect(meses, c.negrita('  > Selecciona el mes a diligenciar: '), { cancel: false });
  const mesAtencion = meses[mesIndex];

  let diaInicio = readline.questionInt(c.negrita('  > Desde que dia del mes deseas empezar a llenar? (ej: 1, 15): '), { defaultInput: '1' });
  let diasIgnorarStr = readline.question(c.negrita('  > Dias a ignorar (separados por coma, ej: 20,25) o ENTER para ninguno: '));
  const diasIgnorar = diasIgnorarStr.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));

  console.log(c.verde(`\n  Resumen: Mes [${mesAtencion}], Desde día [${diaInicio}], Ignorando [${diasIgnorar.join(', ')}]`));

  const ascValidas = asociaciones.filter(a => a.numeroContrato);

  if (ascValidas.length === 0) {
    console.log(c.rojo("  ⚠️ No hay asociaciones válidas con contrato."));
    process.exit(1);
  }

  const opcionesNombres = ascValidas.map(a => a.nombreCorto);
  opcionesNombres.unshift('TODAS LAS ASOCIACIONES');
  
  const seleccionAsc = readline.keyInSelect(opcionesNombres, c.negrita('  > Que asociacion deseas diligenciar?'), { cancel: 'Cancelar y salir' });
  
  if (seleccionAsc === -1) {
      console.log(c.amarillo('\n  Operación cancelada.'));
      process.exit(0);
  }
  
  let ascAProcesar = ascValidas;
  if (seleccionAsc > 0) {
      ascAProcesar = [ascValidas[seleccionAsc - 1]];
  }

  console.log(c.cyan('\n  🌐 Abriendo navegador...\n'));
  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: ['--start-maximized'],
    executablePath: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
  });

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
    rolesHtml = await mainPage.content();
  } catch (err) {
    console.error(c.rojo(`  ❌ Error en login inicial: ${err.message}`));
    await browser.close();
    return;
  }

  for (let i = 0; i < ascAProcesar.length; i++) {
      const asc = ascAProcesar[i];

      // Corrección manual de contrato
      if (asc.nombreCorto && asc.nombreCorto.toUpperCase().includes('VERBENAL')) {
          asc.numeroContrato = '11027492024';
      }

      if (i > 0) {
          console.log(c.gris(`\n    🔙 Restaurando la pantalla de selección de roles desde la memoria...`));
          try {
              await mainPage.goto('about:blank');
              await mainPage.setContent(rolesHtml);
              await mainPage.evaluate(() => {
                if (typeof window.history.pushState === 'function') {
                  window.history.pushState({}, '', 'https://rubonline.icbf.gov.co/Autenticacion/Roles.aspx');
                }
              });
              await mainPage.waitForTimeout(1000);
          } catch (e) {
              console.log(c.rojo(`    ⚠️ No se pudo restaurar el DOM directamente: ${e.message}`));
              console.log(c.gris(`    Navegando a la URL de roles de respaldo...`));
              await mainPage.goto(rolesUrl, { waitUntil: 'domcontentloaded' });
          }
      }

      console.log(c.amarillo(`\n======================================================`));
      console.log(c.amarillo(`▶ Procesando Asociación [${i+1}/${ascAProcesar.length}]: ${asc.nombreCorto}`));
      console.log(c.amarillo(`======================================================`));
      console.log(`    Contrato: ${asc.numeroContrato} (Vigencia: 2024)`);

      try {
        console.log('  🏢 Seleccionando entidad (asociación)...');
        await seleccionarRolYEntrar(mainPage, asc.nombreCorto);
        console.log(c.verde('  ✅ Login exitoso en Cuéntame.'));
        
        console.log('  🚀 Navegando a Unidad -> Registro de asistencia mensual - ram...');
        
        await mainPage.waitForTimeout(2000);
        
        // Desplegar Unidad en mainPage directamente (ya no existe frameMenu)
        const linkUnidad = mainPage.locator('a, span', { hasText: /^Unidad$/i }).first();
        if (await linkUnidad.isVisible()) {
            await linkUnidad.click();
            await mainPage.waitForTimeout(1000);
        }
        
        // Clic en RAM
        const linkRAM = mainPage.locator('a, span', { hasText: /Registro de asistencia mensual - ram/i }).first();
        await linkRAM.waitFor({ state: 'visible', timeout: 10000 });
        await linkRAM.click();
        
        await mainPage.waitForTimeout(4000);

        const contentFrame = mainPage.frame({ name: 'frameContent' }) || mainPage.frames().find(f => f.name() === 'frameContent');
        if (!contentFrame) throw new Error('No se encontró el frameContent.');

        console.log('  📝 Llenando filtros del RAM...');
        const selects = contentFrame.locator('select');
        
        // Función helper para seleccionar y esperar postback
        async function selectByOptionText(index, text) {
            try {
                const sel = selects.nth(index);
                const value = await sel.evaluate((s, t) => {
                    const opt = Array.from(s.options).find(o => o.text.toUpperCase().includes(t.toUpperCase()));
                    return opt ? opt.value : null;
                }, text);
                
                if (value) {
                    await sel.selectOption(value);
                    await mainPage.waitForTimeout(2000); // Esperar postback
                }
            } catch (e) {
                console.log(c.gris(`    (No se pudo seleccionar ${text} en select ${index}: ${e.message})`));
            }
        }
        
        // 0: Área misional
        await selectByOptionText(0, 'Primera Infancia');
        // 1: Regional
        await selectByOptionText(1, 'Bogota D.C.');
        // 2: Vigencia
        await selectByOptionText(2, '2024');
        // 3: Contrato
        await selectByOptionText(3, asc.numeroContrato);
        // 4: Nombre del servicio (Seleccionar el primero que no sea 0)
        try {
            const valSrv = await selects.nth(4).evaluate(s => {
                const opt = Array.from(s.options).find(o => o.value && o.value !== "0" && o.value !== "");
                return opt ? opt.value : null;
            });
            if (valSrv) {
                await selects.nth(4).selectOption(valSrv);
                await mainPage.waitForTimeout(2000);
            }
        } catch (e) {}
        
        // Mes (6) y Estado (7) los llenamos antes de iterar por UDS
        await selectByOptionText(6, mesAtencion);
        await selectByOptionText(7, 'Todos');

        // Iterar por cada UDS (index 5)
        const udsOptions = await selects.nth(5).evaluate(s => {
            return Array.from(s.options)
                .filter(o => o.value && o.value !== "0" && o.value !== "")
                .map(o => ({ value: o.value, text: o.text }));
        });

        console.log(c.cyan(`  Encontradas ${udsOptions.length} Unidades de Servicio (UDS).`));

        for (let u = 0; u < udsOptions.length; u++) {
            const uds = udsOptions[u];
            console.log(c.amarillo(`\n    ▶ Procesando UDS [${u+1}/${udsOptions.length}]: ${uds.text}`));
            
            // Seleccionar UDS
            await selects.nth(5).selectOption(uds.value);
            await mainPage.waitForTimeout(2000);

            // Clic en la lupa
            console.log('    👉 Buscando (clic en la lupa)...');
            const lupa = contentFrame.locator('input[type="image"]').filter({ hasAttribute: 'src', value: /search|lupa/i }).first();
            
            if (!(await lupa.count())) {
                 const genericBtn = contentFrame.locator('input[type="image"], img').last(); 
                 await genericBtn.click();
            } else {
                 await lupa.click();
            }
            
            await mainPage.waitForTimeout(4000);

            // Clic en el lápiz
            console.log('    👉 Habilitando edición (clic en el lápiz)...');
            const lapiz = contentFrame.locator('input[type="image"], img').filter({ hasAttribute: 'src', value: /edit|lapiz/i }).first();
            if (await lapiz.count()) {
                await lapiz.click();
                await mainPage.waitForTimeout(3000);
            } else {
                const buttons = await contentFrame.locator('input[type="image"]').all();
                if (buttons.length > 0) {
                    await buttons[0].click();
                    await mainPage.waitForTimeout(3000);
                }
            }

            console.log('    ✅ Marcando asistencia (Llenado perfecto)...');
            const rows = await contentFrame.locator('table.rgMasterTable tbody tr, table.mGrid tbody tr, table[id*="GridView"] tbody tr, table tbody tr').all();
            
            let ninosActivos = 0;
            let checksMarcados = 0;

            for (const row of rows) {
                const text = await row.innerText();
                if (text.includes('Activo')) {
                    ninosActivos++;
                    const cells = await row.locator('td').all();
                    // Columna 0: Beneficiario, 1: Periodo, 2: Estado, 3: Dia 1, ...
                    for (let cIdx = 3; cIdx < cells.length; cIdx++) {
                        const dayNumber = cIdx - 2; 
                        
                        if (dayNumber >= diaInicio && !diasIgnorar.includes(dayNumber)) {
                            const chk = cells[cIdx].locator('input[type="checkbox"]');
                            if (await chk.count() > 0) {
                                const isEnabled = await chk.isEnabled();
                                const isChecked = await chk.isChecked();
                                if (isEnabled && !isChecked) {
                                    await chk.check();
                                    checksMarcados++;
                                }
                            }
                        }
                    }
                }
            }

            console.log(c.verde(`    ✔️ Se procesaron ${ninosActivos} niños activos y se marcaron ${checksMarcados} asistencias.`));

            console.log('    💾 Guardando asistencia...');
            const disco = contentFrame.locator('input[type="image"], img').filter({ hasAttribute: 'src', value: /save|disco|guardar/i }).first();
            if (await disco.count()) {
                await disco.click();
            } else {
                const allImgBtns = await contentFrame.locator('input[type="image"]').all();
                if (allImgBtns.length > 0) {
                    await allImgBtns[allImgBtns.length - 1].click();
                }
            }
            await mainPage.waitForTimeout(5000); 
            console.log(c.verde('    ✅ Guardado exitoso.'));

            // MENÚ INTERACTIVO DE INASISTENCIAS
            while (true) {
                const quiereFallas = readline.keyInYNStrict(c.negrita('    > Desea registrar inasistencias manuales para ESTA UDS?'));
                if (!quiereFallas) break;

                console.log(c.cyan('\n    Leyendo lista de niños...'));
                const filasNuevas = await contentFrame.locator('table.rgMasterTable tbody tr, table.mGrid tbody tr, table[id*="GridView"] tbody tr, table tbody tr').all();
                
                const listaNinos = [];
                for (let j = 0; j < filasNuevas.length; j++) {
                    const rowText = await filasNuevas[j].innerText();
                    const nombre = rowText.split('\t')[0].trim(); 
                    if (nombre && rowText.includes('Activo')) {
                        listaNinos.push({ idxOriginal: j, nombre: nombre, row: filasNuevas[j] });
                    }
                }

                if (listaNinos.length === 0) {
                    console.log(c.rojo('    ⚠️ No se encontraron niños activos en la tabla.'));
                    break;
                }

                const opciones = listaNinos.map(n => n.nombre);
                const ninoIndex = readline.keyInSelect(opciones, c.negrita('    > Seleccione el nino que falto:'), { cancel: 'Cancelar / Siguiente UDS' });
                
                if (ninoIndex === -1) break;

                const nino = listaNinos[ninoIndex];
                const diasFaltaStr = readline.question(c.negrita(`    > Que dias falto ${nino.nombre}? (separados por coma, ej: 15,18): `));
                const diasFalta = diasFaltaStr.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));

                if (diasFalta.length > 0) {
                    const lapizNuevo = contentFrame.locator('input[type="image"], img').filter({ hasAttribute: 'src', value: /edit|lapiz/i }).first();
                    if (await lapizNuevo.count()) {
                        await lapizNuevo.click();
                        await mainPage.waitForTimeout(2000);
                    }

                    let desmarcados = 0;
                    const celdasFalla = await nino.row.locator('td').all();
                    
                    for (const dia of diasFalta) {
                        const colIndex = dia + 2; 
                        if (colIndex < celdasFalla.length) {
                            const chk = celdasFalla[colIndex].locator('input[type="checkbox"]');
                            if (await chk.count() > 0) {
                                const isEnabled = await chk.isEnabled();
                                const isChecked = await chk.isChecked();
                                if (isEnabled && isChecked) {
                                    await chk.uncheck();
                                    desmarcados++;
                                }
                            }
                        }
                    }
                    console.log(c.verde(`    ✔️ Se desmarcaron ${desmarcados} días para ${nino.nombre}.`));

                    const discoNuevo = contentFrame.locator('input[type="image"], img').filter({ hasAttribute: 'src', value: /save|disco|guardar/i }).first();
                    if (await discoNuevo.count()) {
                        await discoNuevo.click();
                    } else {
                        const allImgBtns = await contentFrame.locator('input[type="image"]').all();
                        if (allImgBtns.length > 0) {
                            await allImgBtns[allImgBtns.length - 1].click();
                        }
                    }
                    await mainPage.waitForTimeout(3000);
                    console.log(c.verde('    ✅ Inasistencia guardada.'));
                }
            } // fin interactivo
        } // fin loop UDS

      } catch (err) {
        console.error(c.rojo(`  ❌ Ocurrió un error con ${asc.nombreCorto}: ${err.message}`));
      }
  }

  console.log(c.verde('\n  ✅ Proceso de RAM finalizado para todas las asociaciones. Cerrando navegador...'));
  await browser.close();
}

main();
