/**
 * consulta-activos.js
 * Script interactivo para consultar si un beneficiario se encuentra vinculado o desvinculado,
 * y en qué Unidad de Servicio está.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { chromium } = require('playwright');
const readline = require('readline-sync');
const { loginYLlegarARoles, seleccionarRolYEntrar } = require('../servicios/autenticacion');
const { leerJardines } = require('../servicios/excel-reader');
const ExcelJS = require('exceljs');
const path = require('path');

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
    console.error(c.rojo('\n❌ Faltan credenciales en el archivo .env\n'));
    process.exit(1);
  }

  // Cargar datos
  const RUTA_EXCEL = process.env.RUTA_EXCEL || 'C:\\GENERAL.xlsx';
  const { porAsociacion } = leerJardines(RUTA_EXCEL);
  const asociaciones = Object.values(porAsociacion);

  if (asociaciones.length === 0) {
    console.log(c.rojo('❌ No se encontraron asociaciones en el Excel.'));
    return;
  }

  console.log(c.cyan('\n======================================================'));
  console.log(c.cyan('   🔍 CONSULTA DE BENEFICIARIOS (ACTIVOS/INACTIVOS)'));
  console.log(c.cyan('======================================================\n'));
  console.log(c.gris('Selecciona una asociación cualquiera para poder ingresar al sistema de Cuéntame.'));
  console.log(c.gris('Nota: La búsqueda de beneficiarios es global en el sistema.'));

  asociaciones.forEach((asc, i) => console.log(`  ${i + 1}. ${asc.nombreCorto}`));
  console.log(`  0. Salir`);

  let idxAsociacion = -1;
  while (idxAsociacion < 0 || idxAsociacion > asociaciones.length) {
    const res = readline.question(c.negrita('\n  > Selecciona la asociacion (0 para salir): '));
    idxAsociacion = parseInt(res, 10);
    if (isNaN(idxAsociacion)) idxAsociacion = -1;
  }

  if (idxAsociacion === 0) {
    console.log('Saliendo...');
    return;
  }

  const ascSeleccionada = asociaciones[idxAsociacion - 1];

  console.log(c.cyan('\n  🌐 Abriendo navegador...\n'));
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
    args: ['--start-maximized'],
    executablePath: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
  });
  
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  try {
    await loginYLlegarARoles(page, {
      usuario: USUARIO,
      password: PASSWORD,
      gmailUser: GMAIL_USER,
      gmailAppPassword: GMAIL_APP_PASSWORD
    });

    console.log(c.amarillo(`  🏢 Seleccionando la asociación ${ascSeleccionada.nombreCorto}...`));
    await seleccionarRolYEntrar(page, ascSeleccionada);
    console.log(c.verde('  ✅ Login exitoso en Cuéntame.'));

    // Navegar a Información del Beneficiario
    console.log(c.cyan('  🚀 Navegando al módulo de Información del Beneficiario...'));
    
    let menuFrame = page.frame({ name: 'frameMenu' });
    if (!menuFrame) {
        for (const f of page.frames()) {
            if (f.name() === 'frameMenu') {
                menuFrame = f;
                break;
            }
        }
    }
    const rootMenu = menuFrame || page;
    
    try {
        const childMenu = rootMenu.locator('a:has-text("Información beneficiario")').first();
        if (await childMenu.count() > 0) {
            // En vez de lidiar con menús colapsados, disparamos el clic directamente por JS
            // Esto ignorará si el padre está cerrado o si está oculto visualmente.
            await childMenu.evaluate(node => node.click());
            await page.waitForTimeout(4000);
        } else {
            console.log(c.amarillo('  ⚠️ No se encontró el enlace de Información beneficiario en el menú.'));
        }
    } catch(e) {
        console.log(c.rojo(`  ❌ Error al intentar acceder a Información beneficiario: ${e.message}`));
    }
    
    let frame = page.frameLocator('#frameContent');
    const frameEl = await page.$('#frameContent');
    if (!frameEl) {
        frame = page;
    }

    // Bucle interactivo
    while (true) {
        console.log(c.cyan('\n------------------------------------------------------'));
        console.log(c.amarillo('  [0] Salir al menú principal'));
        console.log(c.amarillo('  Escribe el número de documento del niño para consultar.'));
        const documento = readline.question(c.negrita('\n  > Documento del niño: '));

        if (documento.trim() === '0') {
            break;
        }
        if (documento.trim() === '') {
            continue;
        }

        console.log(c.gris(`  Buscando beneficiario con documento: ${documento}...`));
        
        try {
            // Llenar tipo de documento
            const selectDoc = frame.locator('select').first();
            await selectDoc.selectOption({ label: 'REGISTRO CIVIL' }).catch(() => {});
            
            // Llenar numero de documento
            const inputDoc = frame.locator('input[type="text"]').first();
            await inputDoc.fill(documento);
            await page.waitForTimeout(500);

            // Hacer clic en el botón buscar (que según la imagen es <a id="btnBuscar">...</a>)
            const btnBuscar = frame.locator('#btnBuscar, a:has(img[alt="Consultar"])').first();
            if (await btnBuscar.count() > 0) {
                await btnBuscar.evaluate(node => node.click());
            } else {
                await inputDoc.press('Enter');
            }

            // Esperar a que cargue la tabla
            // Esperamos que recargue o muestre resultados (el frame puede recargarse)
            // En ASP.NET a menudo hay un UpdatePanel.
            await page.waitForTimeout(5000);

            // Re-obtener el frame (por si la navegación cambió el contexto)
            frame = page.frameLocator('#frameContent');
            if (await frame.locator('body').count() === 0) {
                frame = page;
            }

            // Vamos a buscar todas las tablas de la página y procesar la tabla de resultados (suele tener > 15 columnas)
            const tablas = await frame.locator('table').all();
            let registros = [];
            
            for (let i = 0; i < tablas.length; i++) {
                const filas = await tablas[i].locator('tr').all();
                if (filas.length > 2) {
                    const celdasHeader = await filas[0].locator('th, td').allInnerTexts();
                    if (celdasHeader.length >= 15) { // La tabla de datos tiene 19 columnas
                        for (let j = 1; j < filas.length; j++) {
                            const celdas = await filas[j].locator('td').allInnerTexts();
                            if (celdas.length >= 15) {
                                const info = celdas.map(t => t.trim().replace(/\s+/g, ' '));
                                registros.push({
                                    regionalVinculado: info[1] || '',
                                    entidad: info[2] || '',
                                    contratoVinculado: info[4] || '',
                                    codigoUds: info[5] || '',
                                    nombreUds: info[6] || '',
                                    tipoDoc: info[10] || '',
                                    nombre: `${info[12] || ''} ${info[13] || ''} ${info[14] || ''} ${info[15] || ''}`.replace(/\s+/g, ' ').trim(),
                                    fechaAtencion: info[16] || '',
                                    estado: info[18] || ''
                                });
                            }
                        }
                    }
                }
            }
            
            if (registros.length === 0) {
                const sinDatos = frame.locator('text="No se encontraron datos"').first();
                if (await sinDatos.count() > 0 && await sinDatos.isVisible()) {
                    console.log(c.rojo(`  ❌ El sistema reporta: No se encontraron datos para el documento ${documento}.`));
                } else {
                    console.log(c.rojo('  ❌ No se encontró ninguna tabla de resultados. Revisa si la página mostró un error.'));
                }
                console.log('\n------------------------------------------------------');
                console.log('  [0] Salir al menú principal');
                continue;
            }

            // Parsear fechas y ordenar para tener la más reciente primero (DD/MM/YYYY)
            registros.sort((a, b) => {
                const parseD = (str) => {
                    const parts = str.split('/');
                    if (parts.length === 3) return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
                    return 0;
                };
                return parseD(b.fechaAtencion) - parseD(a.fechaAtencion);
            });

            const masReciente = registros[0];
            console.log(c.verde(`\n  ✅ Beneficiario encontrado: ${c.cyan(masReciente.nombre)}`));
            console.log(`    Último registro: ${masReciente.fechaAtencion}`);
            console.log(`    Estado actual: ${c.negrita(masReciente.estado)}`);
            console.log(`    Asociación (Entidad): ${masReciente.entidad}`);
            console.log(`    UDS: ${masReciente.nombreUds}\n`);

            // Lógica de validación
            const estadoMayus = masReciente.estado.toUpperCase();
            const esMismaAsociacion = masReciente.entidad.toUpperCase().includes(ascSeleccionada.nombreCorto.toUpperCase());

            if (estadoMayus === 'VINCULADO') {
                if (!esMismaAsociacion) {
                    console.log(c.rojo(`  ⚠️ El niño se encuentra VINCULADO pero en OTRA asociación (${masReciente.entidad}).`));
                    const resp = readline.question('  ¿Deseas guardar esta novedad en el Excel oficial de ICBF? (s/n): ').toLowerCase();
                    if (resp === 's' || resp === 'si') {
                        // Guardar en el formato de excel f3.m3.pp_formato_solicitud_desvinculacion_de_beneficiarios_v4.xlsx
                        console.log(c.amarillo('  ⏳ Guardando en el formato de desvinculación...'));
                        const formatoPath = path.join(__dirname, '..', 'docs', 'f3.m3.pp_formato_solicitud_desvinculacion_de_beneficiarios_v4.xlsx');
                        const workbook = new ExcelJS.Workbook();
                        await workbook.xlsx.readFile(formatoPath);
                        
                        const ws = workbook.worksheets.find(w => w.name.toUpperCase() === 'FORMATO');
                        if (ws) {
                            // Buscar la primera fila vacía a partir de la 6
                            let filaVacia = 6;
                            while (filaVacia <= 500) {
                                const row = ws.getRow(filaVacia);
                                const celda = row.getCell(1).value;
                                if (!celda || String(celda).trim() === '') {
                                    break;
                                }
                                filaVacia++;
                            }
                            
                            // Calcular fecha "primer día del mes actual del año actual"
                            const hoy = new Date();
                            const dia1MesActual = `01/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;
                            
                            const rowToFill = ws.getRow(filaVacia);
                            rowToFill.getCell(1).value = 'BOGOTA'; // Regional (siempre BOGOTA)
                            rowToFill.getCell(2).value = ascSeleccionada.nit || ''; // NIT EAS
                            rowToFill.getCell(3).value = ascSeleccionada.nombreLargo || ascSeleccionada.nombreCorto; // Nombre EAS
                            rowToFill.getCell(4).value = ascSeleccionada.numeroContrato || ''; // Contrato EAS
                            
                            rowToFill.getCell(5).value = masReciente.regionalVinculado;
                            rowToFill.getCell(6).value = masReciente.entidad;
                            rowToFill.getCell(7).value = masReciente.contratoVinculado;
                            rowToFill.getCell(8).value = masReciente.codigoUds;
                            rowToFill.getCell(9).value = masReciente.nombreUds;
                            
                            rowToFill.getCell(10).value = masReciente.tipoDoc;
                            rowToFill.getCell(11).value = documento;
                            rowToFill.getCell(12).value = masReciente.nombre;
                            rowToFill.getCell(13).value = dia1MesActual; // Fecha mágica
                            
                            rowToFill.commit();
                            await workbook.xlsx.writeFile(formatoPath);
                            
                            console.log(c.verde(`  ✅ Novedad guardada exitosamente en la Fila ${filaVacia} del archivo Excel oficial.`));
                        } else {
                            console.log(c.rojo('  ❌ No se encontró la hoja "FORMATO" en el archivo de Excel.'));
                        }
                    }
                } else {
                    console.log(c.verde(`  ✅ El niño se encuentra VINCULADO correctamente en tu asociación.`));
                }
            } else if (estadoMayus === 'DESVINCULADO') {
                console.log(c.amarillo(`  👉 El niño se encuentra DESVINCULADO. (Procede a la tarea 5 para vincularlo).`));
            } else {
                console.log(c.gris(`  ℹ️ Estado desconocido: ${masReciente.estado}.`));
            }

            console.log('\n------------------------------------------------------');
            console.log('  [0] Salir al menú principal');

        } catch (e) {
            console.log(c.rojo(`  ❌ Error durante la búsqueda: ${e.message}`));
        }
    }

  } catch (err) {
    console.error(c.rojo(`\n  ❌ Error en el proceso: ${err.message}`));
  } finally {
    console.log(c.verde('\n  ✅ Proceso finalizado. Cerrando navegador...'));
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
