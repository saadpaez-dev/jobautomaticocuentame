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

  console.log(c.cyan('\n  📋 Selecciona la Asociación para procesar:'));
  console.log(c.amarillo(`  0. 🌟 TODAS LAS ASOCIACIONES`));
  ascValidas.forEach((asc, idx) => {
    console.log(`  ${idx + 1}. ${asc.nombreCorto} (Contrato: ${asc.numeroContrato || 'N/A'})`);
  });
  
  let ascAProcesar = [];
  while (ascAProcesar.length === 0) {
    console.log(c.gris('  (Puedes ingresar varios números separados por coma, ej: 1,3,4)'));
    const respuesta = readline.question(c.negrita('\n  > Ingresa el numero de la(s) opcion(es): '));
    
    if (respuesta.trim() === '') {
        console.log(c.amarillo('\n  Operación cancelada.'));
        process.exit(0);
    }

    const partes = respuesta.split(',').map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n));
    
    if (partes.length === 0) continue;

    if (partes.includes(0)) {
        ascAProcesar = ascValidas;
        break;
    }

    const invalidos = partes.filter(n => n < 1 || n > ascValidas.length);
    if (invalidos.length > 0) {
        console.log(c.rojo(`  ⚠️ Opciones inválidas: ${invalidos.join(', ')}`));
        continue;
    }

    const partesUnicas = [...new Set(partes)];
    ascAProcesar = partesUnicas.map(n => ascValidas[n - 1]);
  }

  // -------------------------------------------------------------
  // NUEVO: Preguntar por Jardines (UDS) para cada Asociación elegida
  // -------------------------------------------------------------
  for (let a of ascAProcesar) {
      if (!a.jardines || a.jardines.length === 0) {
          console.log(c.amarillo(`\n  ⚠️ No hay jardines registrados en el Excel para ${a.nombreCorto}. Se procesarán todos los que aparezcan en Cuéntame.`));
          continue;
      }
      
      console.log(c.cyan(`\n  🏡 Selecciona los Jardines a procesar para: ${a.nombreCorto}`));
      console.log(c.amarillo(`  0. 🌟 TODOS LOS JARDINES`));
      a.jardines.forEach((jardin, idx) => {
          console.log(`  ${idx + 1}. ${jardin.nombre} (Código: ${jardin.codigo})`);
      });
      
      let jardinesSeleccionados = [];
      while (jardinesSeleccionados.length === 0) {
          console.log(c.gris('  (Ingresa 0 para TODOS, o varios números separados por coma, ej: 1,3)'));
          const resp = readline.question(c.negrita('  > Ingresa la opcion (ENTER para TODOS): '));
          
          if (resp.trim() === '') {
              jardinesSeleccionados = a.jardines;
              break;
          }
          
          const pts = resp.split(',').map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n));
          if (pts.length === 0) continue;
          
          if (pts.includes(0)) {
              jardinesSeleccionados = a.jardines;
              break;
          }
          
          const invs = pts.filter(n => n < 1 || n > a.jardines.length);
          if (invs.length > 0) {
              console.log(c.rojo(`  ⚠️ Opciones inválidas: ${invs.join(', ')}`));
              continue;
          }
          
          const ptsUnicos = [...new Set(pts)];
          jardinesSeleccionados = ptsUnicos.map(n => a.jardines[n - 1]);
      }
      a.jardinesAProcesar = jardinesSeleccionados;
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
        
        await mainPage.goto('https://rubonline.icbf.gov.co/Page/RUBONLINE/RegistroAsistencia/List.aspx', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        
        await mainPage.waitForTimeout(3000);

        // Al navegar directo, el formulario queda en mainPage o en frameContent (si tiene iframe interno)
        const contentFrame = mainPage.frame({ name: 'frameContent' }) || mainPage.frames().find(f => f.name() === 'frameContent') || mainPage;
        if (!contentFrame) throw new Error('No se encontró el frameContent.');

        console.log('  📝 Llenando filtros del RAM...');
        
        async function selectDropdown(keyword, textOrIndex) {
            try {
                const sel = contentFrame.locator(`select[id*="${keyword}"]`).first();
                if (await sel.count() === 0) return;
                
                const isEnabled = await sel.evaluate(s => !s.disabled);
                if (!isEnabled) return; // Skip if disabled

                if (typeof textOrIndex === 'string') {
                    // Seleccionar por texto parcial
                    const value = await sel.evaluate((s, t) => {
                        const opt = Array.from(s.options).find(o => o.text.toUpperCase().includes(t.toUpperCase()));
                        return opt ? opt.value : null;
                    }, textOrIndex);
                    if (value) {
                        await sel.selectOption(value, { timeout: 5000 });
                        await mainPage.waitForTimeout(2000);
                    }
                } else if (typeof textOrIndex === 'number') {
                    // Seleccionar por índice válido (>0)
                    const valSrv = await sel.evaluate(s => {
                        const opt = Array.from(s.options).find(o => o.value && o.value !== "0" && o.value !== "");
                        return opt ? opt.value : null;
                    });
                    if (valSrv) {
                        await sel.selectOption(valSrv, { timeout: 5000 });
                        await mainPage.waitForTimeout(2000);
                    }
                }
            } catch (e) {
                console.log(c.gris(`    (No se pudo seleccionar en ${keyword}: ${e.message})`));
            }
        }
        
        await selectDropdown('Direcciones', 'Primera Infancia');
        await selectDropdown('Regional', 'Bogota');
        await selectDropdown('Centro', 'USAQUEN'); // A veces se requiere
        await selectDropdown('Vigencia', '2024');
        await selectDropdown('Contrato', asc.numeroContrato);
        await selectDropdown('Mes', mesAtencion);
        await selectDropdown('Estado', 'Todos');

        // Obtener todos los servicios disponibles
        const servicioLocator = contentFrame.locator(`select[id*="Servicio"]`).first();
        let serviciosOptions = [];
        if (await servicioLocator.count() > 0) {
            serviciosOptions = await servicioLocator.evaluate(s => {
                return Array.from(s.options)
                    .filter(o => o.value && o.value !== "0" && o.value !== "")
                    .map(o => ({ value: o.value, text: o.text }));
            });
        }

        if (serviciosOptions.length === 0) {
            console.log(c.rojo(`  ⚠️ No se encontraron servicios para el contrato de esta asociación.`));
            continue;
        }

        console.log(c.cyan(`  Encontrados ${serviciosOptions.length} modalidades/servicios.`));

        // Mantener un registro de los jardines seleccionados que faltan por procesar
        let jardinesPendientes = asc.jardinesAProcesar ? [...asc.jardinesAProcesar] : [];

        for (let sIdx = 0; sIdx < serviciosOptions.length; sIdx++) {
            const serv = serviciosOptions[sIdx];
            console.log(c.amarillo(`\n  >> Probando Servicio [${sIdx+1}/${serviciosOptions.length}]: ${serv.text}`));
            
            await servicioLocator.selectOption(serv.value, { timeout: 5000 });
            await mainPage.waitForTimeout(2000); // Esperar postback

            // Obtener las UDS de este servicio
            const udsLocator = contentFrame.locator(`select[id*="Uds"], select[id*="UDS"], select[id*="Unidad"]`).first();
            let udsOptions = [];
            if (await udsLocator.count() > 0) {
                udsOptions = await udsLocator.evaluate(s => {
                    return Array.from(s.options)
                        .filter(o => o.value && o.value !== "0" && o.value !== "")
                        .map(o => ({ value: o.value, text: o.text }));
                });
            }

        let udsOptionsFiltradas = udsOptions;
        
        // Siempre filtramos las opciones web basado en jardinesAProcesar (incluso si son "Todos", así ignoramos basuras de Cuéntame)
        if (asc.jardinesAProcesar && asc.jardinesAProcesar.length > 0) {
            udsOptionsFiltradas = udsOptions.filter(webUds => {
                // Buscamos si algún jardín seleccionado está en el texto del <select> de la web
                return asc.jardinesAProcesar.some(jExcel => {
                    const nombreWeb = webUds.text.toUpperCase();
                    // Cuéntame a veces concatena el código y el nombre. Buscamos coincidencias razonables:
                    return nombreWeb.includes(jExcel.codigo) || nombreWeb.includes(jExcel.nombre.toUpperCase());
                });
            });
            console.log(c.cyan(`  Encontradas ${udsOptions.length} UDS en Cuéntame. Filtradas a ${udsOptionsFiltradas.length} según Excel/Selección.`));
        } else {
            console.log(c.cyan(`  Encontradas ${udsOptionsFiltradas.length} Unidades de Servicio (UDS).`));
        }

        if (udsOptionsFiltradas.length === 0) {
             console.log(c.amarillo(`  ⚠️ No se encontraron UDS para procesar tras aplicar los filtros.`));
             continue;
        }

        for (let u = 0; u < udsOptionsFiltradas.length; u++) {
            const uds = udsOptionsFiltradas[u];
            console.log(c.amarillo(`\n    ▶ Procesando UDS [${u+1}/${udsOptionsFiltradas.length}]: ${uds.text}`));
            
            // Seleccionar UDS
            await udsLocator.selectOption(uds.value);
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
        } // fin loop SERVICIOS
      } catch (err) {
        console.error(c.rojo(`  ❌ Ocurrió un error con ${asc.nombreCorto}: ${err.message}`));
      }
  }

  console.log(c.verde('\n  ✅ Proceso de RAM finalizado para todas las asociaciones. Cerrando navegador...'));
  await browser.close();
}

main();
