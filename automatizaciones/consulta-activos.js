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
            // Esperamos que recargue o muestre resultados (el frame puede recargarse)
            // En ASP.NET a menudo hay un UpdatePanel.
            await page.waitForTimeout(5000);

            // Re-obtener el frame (por si la navegación cambió el contexto)
            frame = page.frameLocator('#frameContent');
            if (await frame.locator('body').count() === 0) {
                frame = page;
            }

            console.log(c.amarillo('  Buscando tablas de resultados...'));
            
            // Vamos a buscar todas las tablas de la página y mostrar las que tengan sentido
            // (normalmente la tabla de resultados tiene una clase css específica o un id como gv...)
            const tablas = await frame.locator('table').all();
            let tablaResultadosEncontrada = false;
            
            for (let i = 0; i < tablas.length; i++) {
                const filas = await tablas[i].locator('tr').all();
                if (filas.length > 2) {
                    // Probablemente sea una grilla de datos
                    const celdasHeader = await filas[0].locator('th, td').allInnerTexts();
                    // Si tiene suficientes columnas, la mostramos
                    if (celdasHeader.length >= 5) {
                        tablaResultadosEncontrada = true;
                        console.log(c.verde(`\n  ✅ Tabla encontrada con ${celdasHeader.length} columnas:`));
                        console.log(c.cyan(`    Encabezados: | ${celdasHeader.map(t => t.trim().replace(/\s+/g, ' ')).join(' | ')} |`));
                        
                        console.log(c.gris('    --- Datos ---'));
                        for (let j = 1; j < filas.length; j++) {
                            const celdas = await filas[j].locator('td').allInnerTexts();
                            const info = celdas.map(t => t.trim().replace(/\s+/g, ' '));
                            console.log(`    Fila ${j}: | ${info.join(' | ')} |`);
                        }
                    }
                }
            }
            
            if (!tablaResultadosEncontrada) {
                console.log(c.rojo('  ❌ No se encontró ninguna tabla de resultados. Revisa si el documento es válido o si la página mostró un error.'));
                // Guardar HTML para debug
                const html = await frame.locator('body').innerHTML();
                const fs = require('fs');
                if (!fs.existsSync('reportes')) fs.mkdirSync('reportes');
                fs.writeFileSync('reportes/debug_resultados.html', html);
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
