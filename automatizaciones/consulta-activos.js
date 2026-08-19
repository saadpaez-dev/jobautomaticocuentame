/**
 * consulta-activos.js
 * Script interactivo para consultar si un beneficiario se encuentra vinculado o desvinculado,
 * y en que Unidad de Servicio esta.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const readline = require('readline-sync');
const { loginYLlegarARoles, seleccionarRolYEntrar, obtenerNavegador, validarYCambiarAsociacion } = require('../servicios/autenticacion');
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
  console.log(c.gris('Selecciona una asociacion cualquiera para poder ingresar al sistema de Cuentame.'));
  console.log(c.gris('Nota: La busqueda de beneficiarios es global en el sistema.'));

  let browser = null;
  let context = null;
  let page = null;
  let loggedIn = false;

  let salirModulo = false;

  while (true) {
      if (salirModulo) break;
      asociaciones.forEach((asc, i) => console.log(`  ${i + 1}. ${asc.nombreCorto}`));
      console.log(`  ${c.rojo('0')}. Volver al menu principal`);

      let idxAsociacion = -1;
      while (idxAsociacion < 0 || idxAsociacion > asociaciones.length) {
        const res = readline.question(c.negrita('\n  > Selecciona la asociacion (0 para salir): '));
        idxAsociacion = parseInt(res, 10);
        if (isNaN(idxAsociacion)) idxAsociacion = -1;
      }

      if (idxAsociacion === 0) {
        console.log(c.verde('\n  👋 Volviendo al menu principal...'));
        break;
      }

      const ascSeleccionada = asociaciones[idxAsociacion - 1];

      if (!browser) {
          console.log(c.cyan('\n  🌐 Conectando al navegador existente (CDP)...\n'));
          const navData = await obtenerNavegador();
          browser = navData.browser;
          context = navData.context;
          page = navData.page;
      }

      try {
        const mismaAsociacion = await validarYCambiarAsociacion(page, ascSeleccionada);
        if (!mismaAsociacion) {
            console.log(c.amarillo('  🔐 Verificando inicio de sesion en Cuentame...'));
            await loginYLlegarARoles(page, {
              usuario: USUARIO,
              password: PASSWORD,
              gmailUser: GMAIL_USER,
              gmailAppPassword: GMAIL_APP_PASSWORD
            });
            loggedIn = true;
            console.log(c.amarillo(`  🏢 Seleccionando la asociacion ${ascSeleccionada.nombreCorto}...`));
            await seleccionarRolYEntrar(page, ascSeleccionada);
        } else {
            console.log(c.verde(`  ✅ Preservando sesion y asociacion activa: "${ascSeleccionada.nombreCorto}".`));
            loggedIn = true;
        }

        // Navegar a Informacion del Beneficiario
    console.log(c.cyan('  🚀 Navegando al modulo de Informacion del Beneficiario...'));
    
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
        let result = await rootMenu.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            
            // Si "Informacion beneficiario" ya esta visible, hacerle clic directamente
            const target = links.find(a => a.innerText && a.innerText.toLowerCase().includes('informacion beneficiario'));
            if (target) {
                target.click();
                return 'TARGET_CLICKED';
            }

            // Si no, buscar el enlace exacto "Rub online" para expandirlo
            const rubLink = links.find(a => a.innerText && a.innerText.trim().toLowerCase().includes('rub online'));
            if (rubLink) {
                rubLink.click();
                return 'RUB_EXPANDED';
            }
            return 'NOT_FOUND';
        }).catch(() => 'ERROR');

        console.log(c.gris(`  ℹ️ Estado del menu: ${result}`));

        if (result === 'RUB_EXPANDED') {
            await page.waitForTimeout(1500); // Esperar a que el sub-menu se expanda
            // Ahora hacer clic en "Informacion beneficiario"
            await rootMenu.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const target = links.find(a => a.innerText && a.innerText.toLowerCase().includes('informacion beneficiario'));
                if (target) target.click();
            }).catch(() => {});
        }
        
        await page.waitForTimeout(3000);
        console.log(c.verde('  ✅ Clic en "Informacion beneficiario" enviado.'));
    } catch (err) {
        console.log(c.rojo(`  ❌ Error al intentar acceder a Informacion beneficiario: ${err.message}`));
    }
    // (La obtencion del frame se hara dentro del bucle para asegurar que este listo)
    
    // Bucle interactivo de busqueda
    while (true) {
        console.log(c.cyan('\n------------------------------------------------------'));
        console.log(c.amarillo('  [0] Volver a seleccion de asociacion'));
        console.log(c.rojo('  [M] Volver al menu principal (npm start)'));
        console.log(c.amarillo('  Escribe el numero de documento del nino para consultar.'));
        const documento = readline.question(c.negrita('\n  > Documento del nino: '));

        if (documento.trim().toUpperCase() === 'M') {
            salirModulo = true;
            break;
        }
        if (documento.trim() === '0') {
            break; // Vuelve al loop de seleccion de asociacion
        }
        if (documento.trim() === '') {
            continue;
        }

        const opcionesDoc = [
            "REGISTRO CIVIL",
            "PERMISO POR PROTECCION TEMPORAL",
            "PERMISO ESPECIAL DE PERMANENCIA",
            "PARTIDA O ACTA DE NACIMIENTO",
            "SIN DOCUMENTO",
            "Volver al menu principal (Start)"
        ];
        console.log();
        const idxDoc = readline.keyInSelect(opcionesDoc, c.negrita('  > Selecciona el Tipo de Documento: '), { cancel: 'Atras' });
        
        if (idxDoc === -1) {
            console.log(c.amarillo('  Volviendo a la solicitud de documento...'));
            continue;
        }

        const tipoDocId = opcionesDoc[idxDoc];

        if (tipoDocId === "Volver al menu principal (Start)") {
            salirModulo = true;
            break;
        }

        console.log(c.gris(`  Buscando beneficiario con documento: ${tipoDocId} - ${documento}...`));
        
        try {
            // Re-evaluar el frame justo antes de interactuar, asegurando que este listo
            let frame = page.frame({ name: 'frameContent' });
            if (!frame) {
                for (const f of page.frames()) {
                    if (f.name() === 'frameContent') {
                        frame = f;
                        break;
                    }
                }
            }
            if (!frame) frame = page;

            // Llenar tipo de documento
            const selectDoc = frame.locator('select').first();
            await selectDoc.selectOption({ label: tipoDocId }).catch(() => {});
            
            // Llenar numero de documento en modo "humano" (tecla a tecla)
            const inputDoc = frame.locator('input[type="text"]').first();
            await inputDoc.click();
            await inputDoc.clear();
            await page.waitForTimeout(200);
            await inputDoc.pressSequentially(documento, { delay: 100 });
            await page.waitForTimeout(500);

            // Hacer clic en el boton buscar (que segun la imagen es <a id="btnBuscar">...</a>)
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

            // Re-obtener el frame (por si la navegacion cambio el contexto)
            frame = page.frame({ name: 'frameContent' });
            if (!frame) {
                for (const f of page.frames()) {
                    if (f.name() === 'frameContent') {
                        frame = f;
                        break;
                    }
                }
            }
            if (!frame) frame = page;

            // Vamos a buscar todas las tablas de la pagina y procesar la tabla de resultados (suele tener > 15 columnas)
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
                    console.log(c.rojo('  ❌ No se encontro ninguna tabla de resultados. Revisa si la pagina mostro un error.'));
                }
                // No hace nada especial, simplemente vuelve al top del loop
                continue;
            }

            // Parsear fechas y ordenar para tener la mas reciente primero (DD/MM/YYYY)
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
            console.log(`    Ultimo registro: ${masReciente.fechaAtencion}`);
            console.log(`    Estado actual: ${c.negrita(masReciente.estado)}`);
            console.log(`    Asociacion (Entidad): ${masReciente.entidad}`);
            console.log(`    UDS: ${masReciente.nombreUds}\n`);

            // Logica de validacion
            const estadoMayus = masReciente.estado.toUpperCase();
            const esMismaAsociacion = masReciente.entidad.toUpperCase().includes(ascSeleccionada.nombreCorto.toUpperCase());

            if (estadoMayus === 'VINCULADO') {
                if (!esMismaAsociacion) {
                    console.log(c.rojo(`  ⚠️ El nino se encuentra VINCULADO pero en OTRA asociacion (${masReciente.entidad}).`));
                    const resp = readline.question('  Deseas guardar esta novedad en el Excel oficial de ICBF? (s/n) o [M] para menu principal: ').toLowerCase();
                    if (resp === 'm') {
                        salirModulo = true;
                        break;
                    }
                    if (resp === 's' || resp === 'si') {
                        // Guardar en el formato de excel f3.m3.pp_formato_solicitud_desvinculacion_de_beneficiarios_v4.xlsx
                        console.log(c.amarillo('  ⏳ Guardando en el formato de desvinculacion...'));
                        const formatoPath = path.join(__dirname, '..', 'docs', 'f3.m3.pp_formato_solicitud_desvinculacion_de_beneficiarios_v4.xlsx');
                        const workbook = new ExcelJS.Workbook();
                        await workbook.xlsx.readFile(formatoPath);
                        
                        const ws = workbook.worksheets.find(w => w.name.toUpperCase() === 'FORMATO');
                        if (ws) {
                            // Buscar la primera fila vacia a partir de la 6
                            let filaVacia = 6;
                            while (filaVacia <= 500) {
                                const row = ws.getRow(filaVacia);
                                const celda = row.getCell(1).value;
                                if (!celda || String(celda).trim() === '') {
                                    break;
                                }
                                filaVacia++;
                            }
                            
                            // Calcular fecha "primer dia del mes actual del ano actual"
                            const hoy = new Date();
                            const dia1MesActual = `01/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;
                            
                            // Normalizar la regional para que coincida con el filtro de Excel (mayusculas, sin tildes, sin D.C.)
                            const normalizarRegional = (str) => {
                                let res = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
                                if (res.includes('BOGOTA')) return 'BOGOTA';
                                if (res.includes('VALLE DEL CAUCA') || res === 'VALLE') return 'CAUCA';
                                if (res.includes('SAN ANDRES')) return 'SAN ANDRES';
                                return res;
                            };
                            
                            const rowToFill = ws.getRow(filaVacia);
                            rowToFill.getCell(1).value = 'BOGOTA'; // Regional (siempre BOGOTA)
                            rowToFill.getCell(2).value = ascSeleccionada.nit || ''; // NIT EAS
                            rowToFill.getCell(3).value = ascSeleccionada.nombreLargo || ascSeleccionada.nombreCorto; // Nombre EAS
                            rowToFill.getCell(4).value = ascSeleccionada.numeroContrato || ''; // Contrato EAS
                            
                            rowToFill.getCell(5).value = normalizarRegional(masReciente.regionalVinculado);
                            rowToFill.getCell(6).value = masReciente.entidad;
                            rowToFill.getCell(7).value = masReciente.contratoVinculado;
                            rowToFill.getCell(8).value = masReciente.codigoUds;
                            rowToFill.getCell(9).value = masReciente.nombreUds;
                            
                            rowToFill.getCell(10).value = masReciente.tipoDoc;
                            rowToFill.getCell(11).value = documento;
                            rowToFill.getCell(12).value = masReciente.nombre;
                            rowToFill.getCell(13).value = dia1MesActual; // Fecha magica
                            
                            rowToFill.commit();
                            
                            const fs = require('fs');
                            const docsDir = path.join(__dirname, '..', 'docs', 'adjuntos', documento);
                            if (!fs.existsSync(docsDir)) {
                                fs.mkdirSync(docsDir, { recursive: true });
                            }
                            const childExcelPath = path.join(docsDir, 'f3.m3.pp_formato_solicitud_desvinculacion_de_beneficiarios_v4.xlsx');
                            
                            await workbook.xlsx.writeFile(childExcelPath);
                            
                            console.log(c.verde(`  ✅ Novedad guardada exitosamente en el Excel (solo para este nino).`));
                            
                            const armarCorreo = readline.question('  Desea armar el correo para envio a la regional? (s/n) o [M] para menu principal: ').toLowerCase();
                            if (armarCorreo === 'm') {
                                salirModulo = true;
                                break;
                            }
                            if (armarCorreo === 's' || armarCorreo === 'si') {
                                console.log(c.amarillo('  ⏳ Generando borrador del correo (.eml)...'));
                                const nodemailer = require('nodemailer');
                                const MailComposer = require('nodemailer/lib/mail-composer');
                                
                                const cuerpoCorreoHtml = `<p>
<b>Nit:</b> ${ascSeleccionada.nit || ''}<br>
<b>Nombre del EAS que requiere el ajuste:</b> ${ascSeleccionada.nombreLargo || ascSeleccionada.nombreCorto}<br>
<b>Numero de Contrato:</b> ${ascSeleccionada.numeroContrato || ''}<br>
<b>Nombre de la persona que pone el caso:</b> SAAD PAEZ<br>
<b>Numero de Identificacion:</b> 1020722462<br>
<b>Numero de contacto:</b> 3202002073<br>
<b>Area Misional si aplica:</b> Primera Infancia<br>
<b>Regional y Centro Zonal:</b> BOGOTA, CZ USAQUEN
</p>
<p>
<i>Atte</i><br><br>
<i>SAAD PAEZ</i><br>
<i>Tel: 3202002073</i>
</p>`;

                                const { procesarDocumentos } = require('../servicios/verificador-docs');
                                console.log(c.cyan('\n  ⏳ Verificando y clasificando documentos de soporte...'));
                                const docsClasificados = await procesarDocumentos(documento);
                                
                                const fs = require('fs');
                                const reportesDir = path.join(__dirname, '..', 'reportes');
                                if (!fs.existsSync(reportesDir)) {
                                    fs.mkdirSync(reportesDir);
                                }

                                const attachments = [
                                    {
                                        filename: 'f3.m3.pp_formato_solicitud_desvinculacion_de_beneficiarios_v4.xlsx',
                                        path: childExcelPath
                                    }
                                ];

                                if (docsClasificados) {
                                    const docsDir = path.join(__dirname, '..', 'docs', 'adjuntos', documento);
                                    attachments.push({ filename: 'RAM.pdf', path: path.join(docsDir, 'RAM.pdf') });
                                    attachments.push({ filename: 'RC.pdf', path: path.join(docsDir, 'RC.pdf') });
                                    attachments.push({ filename: 'CARTA.pdf', path: path.join(docsDir, 'CARTA.pdf') });
                                } else {
                                    console.log(c.amarillo(`  ⚠️ El borrador del correo se creara SOLO con el Excel, ya que los documentos de soporte estan incompletos.`));
                                }

                                const mail = new MailComposer({
                                    from: 'SAAD PAEZ',
                                    to: 'Mis.Aplicaciones@icbf.gov.co',
                                    subject: 'Desvinculacion Primera Infacia',
                                    html: cuerpoCorreoHtml,
                                    attachments: attachments
                                });
                                
                                const { guardarEnBorradores } = require('../servicios/gmail-draft');
                                require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
                                
                                const gmailUser = process.env.GMAIL_USER;
                                const gmailPass = process.env.GMAIL_APP_PASSWORD;
                                
                                if (!gmailUser || !gmailPass) {
                                    console.log(c.rojo('  ❌ No se encontraron GMAIL_USER o GMAIL_APP_PASSWORD en el .env.'));
                                } else {
                                    const messageBuffer = await mail.compile().build();
                                    await guardarEnBorradores(gmailUser, gmailPass, messageBuffer);
                                    console.log(c.verde(`  ✅ Borrador de correo subido exitosamente a la carpeta Borradores de tu Gmail.`));
                                    console.log(c.verde(`     (Revisa la carpeta "Borradores" en tu correo, alli estara listo con el Excel adjunto).`));
                                }
                            }
                        } else {
                            console.log(c.rojo('  ❌ No se encontro la hoja "FORMATO" en el archivo de Excel.'));
                        }
                    }
                } else {
                    console.log(c.verde(`  ✅ El nino se encuentra VINCULADO correctamente en tu asociacion.`));
                }
            } else if (estadoMayus === 'DESVINCULADO') {
                console.log(c.amarillo(`  👉 El nino se encuentra DESVINCULADO. (Procede a la tarea 5 para vincularlo).`));
            } else {
                console.log(c.gris(`  ℹ️ Estado desconocido: ${masReciente.estado}.`));
            }

            console.log(c.cyan('\n------------------------------------------------------'));
            console.log(c.amarillo('  [0] Volver a seleccion de asociacion'));
            console.log(c.rojo('  [M] Volver al menu principal (npm start)'));

        } catch (e) {
            console.log(c.rojo(`  ❌ Error durante la busqueda: ${e.message}`));
        }
    } // fin loop de documentos

    if (salirModulo) break; // propagar salida al loop externo

  } catch (err) {
    console.error(c.rojo(`\n  ❌ Error en el proceso: ${err.message}`));
  }
  
  } // End of outer while(true) (asociacion loop)

  console.log(c.verde('\n  👋 Modulo finalizado.\n'));
  if (browser) await browser.close().catch(() => {});
  process.exit(0);
}

main().catch(console.error);
