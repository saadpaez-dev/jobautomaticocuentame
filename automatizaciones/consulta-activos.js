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
            console.log(c.gris('  Esperando resultados...'));
            await page.waitForTimeout(4000);

            // Leer resultados
            const headerResultados = frame.locator('text="Información Atención Beneficiarios"').last();
            if (await headerResultados.count() === 0) {
                console.log(c.rojo(`  ⚠️ No se encontró tabla de resultados para el documento ${documento}.`));
                // Vemos si hay mensaje de que no se encontraron datos
                const sinDatos = frame.locator('text="No se encontraron datos"').first();
                if (await sinDatos.count() > 0) {
                    console.log(c.amarillo('  👉 El sistema dice: "No se encontraron datos, verifique por favor."'));
                }
                continue;
            }

            // Buscar la tabla que está debajo de este título
            // Una forma robusta es buscar todas las filas de tabla en el frame y mostrar las que tengan al menos 10 columnas
            const filas = await frame.locator('table tr').all();
            let encontradas = 0;
            
            console.log(c.verde(`\n  ✅ Resultados para ${documento}:`));

            for (let j = 0; j < filas.length; j++) {
                const fila = filas[j];
                const celdas = await fila.locator('td').allInnerTexts();
                
                // Si la fila tiene muchas celdas, es la fila de datos
                if (celdas.length > 10) {
                    encontradas++;
                    // Índices aproximados según la imagen:
                    // 1: Regional, 2: Entidad, 3: Vigencia, 4: Codigo UDS, 5: Nombre UDS
                    // 11: 1er Nombre, 13: 1er Apellido, 17: Estado
                    const nombreUDS = celdas[5]?.trim() || '';
                    const estado = celdas[celdas.length - 1]?.trim() || ''; // El estado suele ser el último
                    const primerNombre = celdas[11]?.trim() || '';
                    const primerApellido = celdas[13]?.trim() || '';
                    const fechaAtencion = celdas[celdas.length - 3]?.trim() || '';

                    console.log(`    🔹 UDS: ${c.cyan(nombreUDS)} | Niño(a): ${primerNombre} ${primerApellido} | Estado: ${c.amarillo(estado)}`);
                }
            }

            if (encontradas === 0) {
                console.log(c.amarillo(`  ⚠️ El documento arrojó resultados pero no pudimos leer las filas.`));
            }

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
