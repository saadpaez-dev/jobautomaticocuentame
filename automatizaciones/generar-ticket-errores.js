const { chromium } = require('playwright');
const readline = require('readline-sync');
const c = {
    verde: (t) => `\x1b[32m${t}\x1b[0m`,
    amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
    cyan: (t) => `\x1b[36m${t}\x1b[0m`,
    rojo: (t) => `\x1b[31m${t}\x1b[0m`,
    gris: (t) => `\x1b[90m${t}\x1b[0m`,
    negrita: (t) => `\x1b[1m${t}\x1b[0m`,
};
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { leerJardines } = require('../servicios/excel-reader');
const { resolverRutaConEspeciales } = require('../servicios/excel-parser');
const { seleccionarRolYEntrar, verificarConexionOCaida, loginYLlegarARoles } = require('../servicios/autenticacion');

async function convertirImagenOConplanarPdf(rutaInput, rutaSalidaPdf) {
    if (!fs.existsSync(rutaInput)) throw new Error(`El archivo no existe: ${rutaInput}`);
    const lower = rutaInput.toLowerCase();

    if (lower.endsWith('.pdf')) {
        return rutaInput;
    }

    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.bmp') || lower.endsWith('.webp')) {
        console.log(c.cyan(`  🖼️  Convirtiendo imagen (${path.basename(rutaInput)}) a documento PDF...`));
        const pdfDoc = await PDFDocument.create();
        const imageBytes = fs.readFileSync(rutaInput);
        let image;

        if (lower.endsWith('.png')) {
            image = await pdfDoc.embedPng(imageBytes);
        } else {
            image = await pdfDoc.embedJpg(imageBytes);
        }

        const page = pdfDoc.addPage([image.width, image.height]);
        page.drawImage(image, {
            x: 0,
            y: 0,
            width: image.width,
            height: image.height,
        });

        const pdfBytes = await pdfDoc.save();
        fs.writeFileSync(rutaSalidaPdf, pdfBytes);
        console.log(c.verde(`  ✅ Documento de soporte convertido a PDF: ${path.basename(rutaSalidaPdf)}`));
        return rutaSalidaPdf;
    }

    return rutaInput;
}

function normalizarTexto(str) {
    if (!str) return '';
    return str.toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .trim();
}

async function extraerDatosPersonaDeFormulario(frame, esAcudiente = false) {
    await frame.locator('input[id*="txtIdentificacion"], input[id*="txtPrimerNombre"]').first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});

    const datos = await frame.evaluate((isAcudiente) => {
        const getVal = (selectors) => {
            for (const s of selectors) {
                const elements = Array.from(document.querySelectorAll(s));
                if (elements.length > 0) {
                    const el = isAcudiente ? elements[elements.length - 1] : elements[0];
                    if (el && el.value && el.value.trim() !== '') return el.value.trim();
                }
            }
            return '';
        };
        const getSelectText = (selectors) => {
            for (const s of selectors) {
                const elements = Array.from(document.querySelectorAll(s));
                if (elements.length > 0) {
                    const el = isAcudiente ? elements[elements.length - 1] : elements[0];
                    if (el && el.selectedIndex >= 0) {
                        const txt = el.options[el.selectedIndex]?.text;
                        if (txt && txt.trim() !== '' && !txt.toLowerCase().includes('select')) return txt.trim();
                    }
                }
            }
            return '';
        };

        const tipoDoc = getSelectText(['select[id*="TipoDocumento"]', 'select[id*="ddlTipoDocumento"]']);
        const numDoc = getVal(['input[id*="txtIdentificacion"]', 'input[id*="Identificacion"]']);
        const primerNombre = getVal(['input[id*="txtPrimerNombre"]', 'input[id*="PrimerNombre"]']);
        const segundoNombre = getVal(['input[id*="txtSegundoNombre"]', 'input[id*="SegundoNombre"]']);
        const primerApellido = getVal(['input[id*="txtPrimerApellido"]', 'input[id*="PrimerApellido"]']);
        const segundoApellido = getVal(['input[id*="txtSegundoApellido"]', 'input[id*="SegundoApellido"]']);
        
        const fechaNacimiento = getVal(['input[id*="txtFechaNacimiento"]', 'input[id*="FechaNacimiento"]', 'input[id*="txtFechaNac"]']);
        const sexo = getSelectText(['select[id*="ddlSexo"]', 'select[id*="ddlGenero"]', 'select[id*="Sexo"]']);
        
        const pais = getSelectText(['select[id*="ddlPaisNacimiento"]', 'select[id*="ddlPais"]']) || 'COLOMBIA';
        const departamento = getSelectText(['select[id*="ddlDepartamentoNacimiento"]', 'select[id*="ddlDeptoNacimiento"]', 'select[id*="ddlDepartamento"]']);
        const municipio = getSelectText(['select[id*="ddlMunicipioNacimiento"]', 'select[id*="ddlMpioNacimiento"]', 'select[id*="ddlMunicipio"]']);

        return {
            tipoDoc,
            numDoc,
            primerNombre,
            segundoNombre,
            primerApellido,
            segundoApellido,
            fechaNacimiento,
            sexo,
            pais,
            departamento,
            municipio
        };
    }, esAcudiente);

    const mapTipoDoc = (tipoFull) => {
        const t = (tipoFull || '').toUpperCase();
        if (t.includes('REGISTRO CIVIL')) return 'RC';
        if (t.includes('TARJETA DE IDENTIDAD')) return 'TI';
        if (t.includes('CEDULA DE CIUDADANIA')) return 'CC';
        if (t.includes('CEDULA DE EXTRANJERIA')) return 'CE';
        if (t.includes('PASAPORTE')) return 'PA';
        if (t.includes('SIN DOCUMENTO')) return 'SD';
        if (t.includes('ACTA DE NACIMIENTO')) return 'AN';
        if (t.includes('PROTECCI')) return 'PPT';
        return 'CC'; // Default
    };

    datos.tipoDocCod = mapTipoDoc(datos.tipoDoc);
    return datos;
}

function generarObservacionTicket({
    mapTiposInversos,
    tipoDocReal,
    numDocReal,
    pNombreReal,
    sNombreReal,
    pApellidoReal,
    sApellidoReal,
    fechaNacReal,
    sexoReal,
    muniNacReal,
    datosCuentame
}) {
    const obs = [];

    const tipoDocRealCod = mapTiposInversos[tipoDocReal];
    if (tipoDocRealCod && datosCuentame.tipoDocCod && tipoDocRealCod !== datosCuentame.tipoDocCod) {
        obs.push(`CAMBIAR DE (${datosCuentame.tipoDocCod}) A (${tipoDocRealCod})`);
    }

    if (normalizarTexto(numDocReal) !== normalizarTexto(datosCuentame.numDoc)) {
        obs.push("NUMERO DE DOCUMENTO MAL DIGITADO");
    }

    const nombresMal = (normalizarTexto(pNombreReal) !== normalizarTexto(datosCuentame.primerNombre)) || 
                       (normalizarTexto(sNombreReal) !== normalizarTexto(datosCuentame.segundoNombre));
    const apellidosMal = (normalizarTexto(pApellidoReal) !== normalizarTexto(datosCuentame.primerApellido)) || 
                         (normalizarTexto(sApellidoReal) !== normalizarTexto(datosCuentame.segundoApellido));

    if (nombresMal && apellidosMal) {
        obs.push("DATOS DE NOMBRES Y APELLIDOS MAL DIGITADOS");
    } else {
        if (nombresMal) {
            const pMal = normalizarTexto(pNombreReal) !== normalizarTexto(datosCuentame.primerNombre);
            const sMal = normalizarTexto(sNombreReal) !== normalizarTexto(datosCuentame.segundoNombre);
            if (pMal && sMal) obs.push("NOMBRES MAL DIGITADOS");
            else if (pMal) obs.push("PRIMER NOMBRE MAL DIGITADO");
            else if (sMal) obs.push("SEGUNDO NOMBRE MAL DIGITADO");
        }
        if (apellidosMal) {
            const pMal = normalizarTexto(pApellidoReal) !== normalizarTexto(datosCuentame.primerApellido);
            const sMal = normalizarTexto(sApellidoReal) !== normalizarTexto(datosCuentame.segundoApellido);
            if (pMal && sMal) obs.push("APELLIDOS MAL DIGITADOS");
            else if (pMal) obs.push("PRIMER APELLIDO MAL DIGITADO");
            else if (sMal) obs.push("SEGUNDO APELLIDO MAL DIGITADO");
        }
    }

    if (datosCuentame.fechaNacimiento && normalizarTexto(fechaNacReal) !== normalizarTexto(datosCuentame.fechaNacimiento)) {
        obs.push("FECHA DE NACIMIENTO MAL DIGITADA");
    }

    if (datosCuentame.sexo && normalizarTexto(sexoReal) !== normalizarTexto(datosCuentame.sexo)) {
        obs.push("SEXO MAL DIGITADO");
    }

    if (datosCuentame.municipio && normalizarTexto(muniNacReal) !== normalizarTexto(datosCuentame.municipio)) {
        obs.push("MUNICIPIO DE NACIMIENTO MAL DIGITADO");
    }

    return obs.join(" - ") || "DATOS ACTUALIZADOS";
}

async function generarTicketExcelLimpio({
    mapTiposInversos,
    tipoDocReal,
    numDocReal,
    pNombreReal,
    sNombreReal,
    pApellidoReal,
    sApellidoReal,
    fechaNacReal,
    sexoReal,
    deptoNacReal,
    muniNacReal,
    datosCuentame,
    observacion
}) {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const masterExcelPath = path.join(__dirname, '..', 'docs', 'f4.m3.pp_formato_cambio_datos_basicos_personas_v5.xlsx');
    
    await workbook.xlsx.readFile(masterExcelPath);
    const sheet = workbook.worksheets[0];

    // Limpiar todas las filas de datos anteriores (de la fila 6 a la 100)
    for (let r = 6; r <= 100; r++) {
        const rowClear = sheet.getRow(r);
        for (let c = 1; c <= 30; c++) {
            rowClear.getCell(c).value = null;
        }
        rowClear.commit();
    }

    // Escribir el ticket estrictamente en la Fila 6 (Limpio para esta persona)
    const row = sheet.getRow(6);
    row.getCell(3).value = mapTiposInversos[tipoDocReal]; // C
    row.getCell(4).value = numDocReal; // D
    row.getCell(5).value = pNombreReal; // E
    row.getCell(6).value = sNombreReal; // F
    row.getCell(7).value = pApellidoReal; // G
    row.getCell(8).value = sApellidoReal; // H
    row.getCell(9).value = fechaNacReal; // I
    row.getCell(10).value = sexoReal; // J
    row.getCell(11).value = 'COLOMBIA'; // K
    row.getCell(12).value = deptoNacReal; // L (Departamento Nacimiento Real)
    row.getCell(13).value = muniNacReal; // M (Municipio Nacimiento Real)

    row.getCell(14).value = datosCuentame.tipoDocCod; // N
    row.getCell(15).value = datosCuentame.numDoc; // O
    row.getCell(16).value = datosCuentame.primerNombre; // P
    row.getCell(17).value = datosCuentame.segundoNombre; // Q
    row.getCell(18).value = datosCuentame.primerApellido; // R
    row.getCell(19).value = datosCuentame.segundoApellido; // S
    row.getCell(20).value = datosCuentame.fechaNacimiento; // T
    row.getCell(21).value = (datosCuentame.sexo || '').toUpperCase(); // U
    row.getCell(22).value = (datosCuentame.pais || 'COLOMBIA').toUpperCase(); // V
    row.getCell(23).value = (datosCuentame.departamento || '').toUpperCase(); // W
    row.getCell(24).value = (datosCuentame.municipio || '').toUpperCase(); // X

    row.getCell(25).value = 'Error en Diligenciamiento de Datos Basicos'; // Y
    row.getCell(28).value = observacion; // AB

    row.commit();

    const scratchDir = path.join(__dirname, '..', 'scratch');
    if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
    const singleExcelPath = path.join(scratchDir, `f4.m3.pp_formato_cambio_datos_basicos_personas_${numDocReal}.xlsx`);
    await workbook.xlsx.writeFile(singleExcelPath);

    // Intentar refrescar la plantilla limpia en docs/ si no esta bloqueada por Excel
    try {
        await workbook.xlsx.writeFile(masterExcelPath);
    } catch(e) {}

    return singleExcelPath;
}

async function procesarEnvioCorreoTicket({ ascSeleccionada, numDocReal, excelPath }) {
    console.log(c.cyan('\n  📧 GENERACION DE CORREO Y ADJUNTOS'));
    const armarCorreoResp = readline.question(c.negrita('  > Deseas armar/enviar el correo de ticket a la Regional? (s/n) [por defecto s]: ')).trim().toLowerCase();

    if (armarCorreoResp === 's' || armarCorreoResp === 'si' || armarCorreoResp === '') {
        console.log(c.cyan('\n  📄 Documento de Soporte Fisico (Registro Civil, TI o Cedula):'));
        console.log(c.gris('     • Puedes arrastrar un PDF o una Imagen (.jpg, .jpeg, .png).'));
        console.log(c.gris('     • Si es una imagen, se convertira AUTOMATICAMENTE a PDF.\n'));

        const docInputRaw = readline.question(c.negrita('  > Arrastra el documento de soporte (o 0 para omitir adjunto): ')).trim();
        const docInput = docInputRaw.replace(/^["']|["']$/g, '');

        let rutaPdfAdjunto = null;
        if (docInput !== '0' && docInput !== '') {
            const resolvedDoc = resolverRutaConEspeciales(docInput);
            if (fs.existsSync(resolvedDoc)) {
                const scratchDir = path.join(__dirname, '..', 'scratch');
                if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
                const tempPdfPath = path.join(scratchDir, `DOCUMENTO_${numDocReal}.pdf`);

                try {
                    rutaPdfAdjunto = await convertirImagenOConplanarPdf(resolvedDoc, tempPdfPath);
                } catch (e) {
                    console.log(c.rojo(`  ❌ Error procesando el archivo de soporte: ${e.message}`));
                }
            } else {
                console.log(c.amarillo(`  ⚠️ No se encontro el archivo: ${docInput}`));
            }
        }

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

        const attachments = [
            {
                filename: 'f4.m3.pp_formato_cambio_datos_basicos_personas_v5.xlsx',
                path: excelPath
            }
        ];

        if (rutaPdfAdjunto) {
            attachments.push({
                filename: `DOCUMENTO_${numDocReal}.pdf`,
                path: rutaPdfAdjunto
            });
        }

        const asuntoCorreo = 'Edicion de Datos Primera Infancia';
        const destinatario = 'Mis.Aplicaciones@icbf.gov.co';

        console.log(c.cyan('\n  ✉️  Opciones de envio:'));
        console.log('  1. Enviar correo DIRECTAMENTE via SMTP');
        console.log('  2. Guardar BORRADOR en Gmail (para revisar antes de enviar)');
        const modoEnvio = readline.question(c.negrita('  > Selecciona (1 o 2) [por defecto 2]: ')).trim();

        const gmailUser = process.env.GMAIL_USER;
        const gmailPass = process.env.GMAIL_APP_PASSWORD;

        if (!gmailUser || !gmailPass) {
            console.log(c.rojo('  ❌ Faltan GMAIL_USER o GMAIL_APP_PASSWORD en el .env.'));
        } else if (modoEnvio === '1') {
            console.log(c.amarillo('  ⏳ Enviando correo directamente...'));
            const { enviarCorreo } = require('../servicios/gmail-sender');
            await enviarCorreo(gmailUser, gmailPass, {
                to: destinatario,
                subject: asuntoCorreo,
                html: cuerpoCorreoHtml,
                attachments: attachments
            });
            console.log(c.verde(`  🎉 ¡Correo enviado exitosamente a ${destinatario} con los adjuntos!`));
        } else {
            console.log(c.amarillo('  ⏳ Guardando borrador en Gmail...'));
            const MailComposer = require('nodemailer/lib/mail-composer');
            const { guardarEnBorradores } = require('../servicios/gmail-draft');

            const mail = new MailComposer({
                from: gmailUser,
                to: destinatario,
                subject: asuntoCorreo,
                html: cuerpoCorreoHtml,
                attachments: attachments
            });

            const messageBuffer = await mail.compile().build();
            await guardarEnBorradores(gmailUser, gmailPass, messageBuffer);
            console.log(c.verde(`  🎉 ¡Borrador guardado exitosamente en tu carpeta "Borradores" de Gmail!`));
        }
    }
}

// Helpers
function removeAccents(str) {
    if (!str) return '';
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

async function waitForAndSelect(selectLocator, textToMatch, page) {
    let opts = [];
    let isEnabled = false;
    for (let attempts = 0; attempts < 20; attempts++) {
        isEnabled = await selectLocator.evaluate(s => !s.disabled).catch(()=>false);
        if (isEnabled) {
            const raw = await selectLocator.evaluate(s => Array.from(s.options).map(o => ({ v: o.value, t: o.text }))).catch(()=>[]);
            opts = raw.filter(o => o.v !== '' && o.v !== '-1' && o.t !== 'Seleccione');
            
            let match = null;
            if (textToMatch) {
                const cleanTarget = removeAccents(textToMatch.toUpperCase());
                match = opts.find(o => removeAccents(o.t.toUpperCase()) === cleanTarget);
                if (!match) match = opts.find(o => removeAccents(o.t.toUpperCase()).includes(cleanTarget));
                if (match) {
                    const currentVal = await selectLocator.inputValue().catch(()=>null);
                    if (currentVal !== match.v) {
                        const hasPostback = await selectLocator.evaluate(el => {
                            const oc = el.getAttribute('onchange');
                            return oc && oc.includes('doPostBack');
                        }).catch(() => false);

                        let postPromise = null;
                        if (hasPostback && page) {
                            postPromise = page.waitForResponse(resp => resp.request().method() === 'POST', { timeout: 8000 }).catch(() => {});
                        }
                        
                        await selectLocator.selectOption(match.v, { force: true }).catch(()=>{});
                        await selectLocator.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true }))).catch(() => {});
                        
                        if (postPromise) {
                            await postPromise;
                            await page.waitForTimeout(500);
                        } else {
                            await page.waitForTimeout(200);
                        }
                    }
                    break;
                }
            } else if (opts.length > 0) {
                break;
            }
        }
        if (page) await page.waitForTimeout(200);
    }
    return opts;
}

async function main() {
    const USUARIO = process.env.CUENTAME_USUARIO;
    const PASSWORD = process.env.CUENTAME_PASSWORD;
    const GMAIL_USER = process.env.GMAIL_USER;
    const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

    if (!USUARIO || !PASSWORD) {
        console.error(c.rojo('\n❌ Faltan credenciales en el archivo .env\n'));
        process.exit(1);
    }

    const RUTA_EXCEL = process.env.RUTA_EXCEL || 'C:\\GENERAL.xlsx';
    const { porAsociacion } = leerJardines(RUTA_EXCEL);
    const asociaciones = Object.values(porAsociacion);

    if (asociaciones.length === 0) {
        console.log(c.rojo('❌ No se encontraron asociaciones en el Excel.'));
        return;
    }

    console.log(c.cyan('\n======================================================'));
    console.log(c.cyan('   🎫 TICKET PARA ERRORES DE DIGITACION'));
    console.log(c.cyan('======================================================\n'));

    console.log(c.gris('Selecciona una asociacion para iniciar el proceso.'));
    asociaciones.forEach((asc, i) => console.log(`  ${i + 1}. ${asc.nombreCorto}`));
    console.log(`  ${c.rojo('0')}. Volver al menu principal`);

    let idxAsociacion = -1;
    while (idxAsociacion < 0 || idxAsociacion > asociaciones.length) {
        const res = readline.question(c.negrita('\n  > Selecciona la asociacion: '));
        idxAsociacion = parseInt(res, 10);
        if (isNaN(idxAsociacion)) idxAsociacion = -1;
    }

    if (idxAsociacion === 0) {
        console.log(c.verde('\n  👋 Volviendo al menu principal...'));
        return;
    }
    const ascSeleccionada = asociaciones[idxAsociacion - 1];

    console.log(c.amarillo('\n  Conectando al navegador...'));
    let browser;
    try {
        browser = await chromium.connectOverCDP('http://localhost:9222');
    } catch (e) {
        console.log(c.rojo(`  ❌ Error al conectar al navegador: ${e.message}`));
        return;
    }
    const context = browser.contexts()[0];
    const page = context.pages().find(p => p.url().includes('rubonline.icbf.gov.co')) || context.pages()[0];
    
    // Verificacion inicial de sesion
    if (await verificarConexionOCaida(page)) {
        console.log(c.amarillo('  ⚠️ La sesion inicial expiro o se perdio.'));
        console.log(c.amarillo('  ⏳ Iniciando sesion automaticamente (2FA)...'));
        await loginYLlegarARoles(page, {
            usuario: USUARIO,
            password: PASSWORD,
            gmailUser: GMAIL_USER,
            gmailAppPassword: GMAIL_APP_PASSWORD
        });
        console.log(c.verde('  ✅ Login inicial restaurado exitosamente.'));
    }

    console.log(c.amarillo('  ⏳ Seleccionando el rol / asociacion...'));
    await seleccionarRolYEntrar(page, ascSeleccionada);
    
    // Bucle interactivo para ingresar varios tickets
    while (true) {
        console.log(c.cyan('\n------------------------------------------------------'));
        console.log(c.amarillo('  [1] Consultar otro beneficiario'));
        console.log(c.rojo('  [0] Volver al menu principal'));
        
        let accion = readline.question(c.negrita('\n  > Tu opcion (1 o 0): ')).trim();
        if (accion === '0') {
            break;
        } else if (accion !== '1') {
            continue;
        }

        // Verificar si la sesion se cayo antes de continuar
        if (await verificarConexionOCaida(page)) {
            console.log(c.amarillo('  ⚠️ La sesion de Cuentame expiro o se perdio.'));
            console.log(c.amarillo('  ⏳ Intentando iniciar sesion automaticamente (2FA)...'));
            await loginYLlegarARoles(page, {
                usuario: USUARIO,
                password: PASSWORD,
                gmailUser: GMAIL_USER,
                gmailAppPassword: GMAIL_APP_PASSWORD
            });
            console.log(c.verde('  ✅ Login restaurado exitosamente. Seleccionando asociacion nuevamente...'));
            await seleccionarRolYEntrar(page, ascSeleccionada);
        }

        // Navegar al menu de Beneficiario
        console.log(c.amarillo('  ⏳ Entrando al menu "Beneficiario" > "Beneficiario"...'));
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
            const links = await rootMenu.locator('a:text-is("Beneficiario")').all();
            if (links.length >= 2) {
                await links[1].evaluate(n => n.click());
            } else if (links.length === 1) {
                await links[0].evaluate(n => n.click());
                await page.waitForTimeout(500);
                const nuevosLinks = await rootMenu.locator('a:text-is("Beneficiario")').all();
                if (nuevosLinks.length >= 2) {
                    await nuevosLinks[1].evaluate(n => n.click());
                }
            } else {
                console.log(c.rojo('  ⚠️ No se encontro el menu Beneficiario.'));
            }
            await page.waitForTimeout(3000);
        } catch(e) {
            console.log(c.rojo(`  ❌ Error al intentar acceder a Beneficiario: ${e.message}`));
        }
        
        // Cambiar al frame principal
        let currentFrame = page.frame({ name: 'frameContent' });
        if (!currentFrame) {
            for (const f of page.frames()) {
                if (f.name() === 'frameContent') {
                    currentFrame = f;
                    break;
                }
            }
        }
        if (!currentFrame) currentFrame = page;

    // Preguntar documento
    console.log(c.cyan('\n  > Tipo de Documento del Beneficiario:'));
    console.log(c.cyan('    1. Registro Civil'));
    console.log(c.cyan('    2. Permiso por Proteccion Temporal'));
    console.log(c.cyan('    3. Partida o Acta de Nacimiento'));
    console.log(c.cyan('    4. Sin Documento'));
    let tipoDocSel = '';
    while(!['1','2','3','4'].includes(tipoDocSel)) {
        tipoDocSel = readline.question(c.cyan('  > Elige una opcion (1-4): ')).trim();
    }
    const docsMap = {
        '1': 'REGISTRO CIVIL',
        '2': 'PERMISO POR PROTECCION TEMPORAL',
        '3': 'PARTIDA O ACTA DE NACIMIENTO',
        '4': 'SIN DOCUMENTO'
    };
    const valTipoDoc = docsMap[tipoDocSel];
    
    let numDoc = '';
    let pNombreBusq = '';
    let pApellidoBusq = '';
    let fechaNacBusq = '';
    
    if (valTipoDoc === 'SIN DOCUMENTO') {
        pNombreBusq = readline.question(c.negrita('\n  > Primer Nombre Beneficiario: ')).trim().toUpperCase();
        pApellidoBusq = readline.question(c.negrita('  > Primer Apellido Beneficiario: ')).trim().toUpperCase();
        fechaNacBusq = readline.question(c.negrita('  > Fecha de Nacimiento (DD/MM/AAAA): ')).trim();
    } else {
        numDoc = readline.question(c.negrita('\n  > Numero de Documento: ')).trim();
    }

    // Llenar datos de busqueda
    console.log(c.amarillo('  ⏳ Buscando beneficiario en Cuentame...'));
    const selTipoDoc = currentFrame.locator('select:visible[id*="TipoDocumento"], select:visible[id*="ddlTipoDocumento"]').first();
    await waitForAndSelect(selTipoDoc, valTipoDoc, page);
    
    if (valTipoDoc === 'SIN DOCUMENTO') {
        const txtNombre = currentFrame.locator('input[type="text"]:visible[id*="txtPrimerNombre"]').first();
        if (await txtNombre.count() > 0) await txtNombre.fill(pNombreBusq);
        
        const txtApellido = currentFrame.locator('input[type="text"]:visible[id*="txtPrimerApellido"]').first();
        if (await txtApellido.count() > 0) await txtApellido.fill(pApellidoBusq);
        
        const txtFechaNac = currentFrame.locator('input[type="text"]:visible[id*="txtFecha"], input[type="text"]:visible[id*="FechaNacimiento"]').first();
        if (await txtFechaNac.count() > 0) {
            await txtFechaNac.evaluate((el, v) => {
                el.value = v;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: true }));
            }, fechaNacBusq);
            await page.waitForTimeout(500); // Dar tiempo para que procese el evento
        }
    } else {
        const txtDoc = currentFrame.locator('input[type="text"]:visible[id*="txtIdentificacion"]').first();
        if (await txtDoc.count() > 0) {
            await txtDoc.fill(numDoc);
        }
    }
    
    // Seleccionar Estado Atencion: Todos
    const radioTodos = currentFrame.locator('input[type="radio"][id*="rdbEstadoAtencion_2"]').first(); // 0: Activo, 1: Inactivo, 2: Todos
    if (await radioTodos.count() > 0) {
        await radioTodos.click().catch(()=>{});
    } else {
        const labelTodos = currentFrame.locator('label:has-text("Todos")').first();
        if (await labelTodos.count() > 0) await labelTodos.click().catch(()=>{});
    }

    // Click Buscar Lupa
    const btnBuscar = currentFrame.locator('img[alt="Consultar"], input[type="image"][id*="btnBuscar"], a[id*="btnBuscar"]').first();
    if (await btnBuscar.count() > 0) {
        const postPromise = page.waitForResponse(resp => resp.request().method() === 'POST', { timeout: 10000 }).catch(() => {});
        await btnBuscar.click();
        await postPromise;
        await page.waitForTimeout(1500);
    }

    // Buscar la fila con "Activo" en la tabla y dar click en Detalle (Lupa) SIEMPRE
    console.log(c.amarillo('  ⏳ Buscando estado Activo en los resultados...'));
    const rows = currentFrame.locator('table[id*="gvBeneficiario"] tbody tr.rowA, table[id*="gvBeneficiario"] tbody tr.rowB, table[id*="gvBeneficiario"] tr');
    const rowsCount = await rows.count();
    let filaEncontrada = false;

    for (let i = 0; i < rowsCount; i++) {
        const row = rows.nth(i);
        const text = await row.innerText();
        if (text.includes('Activo')) {
            filaEncontrada = true;
            console.log(c.verde('  ✅ Beneficiario Activo encontrado. Abriendo detalle (Lupa)...'));
            const btnDetalle = row.locator('input[type="image"][title*="Detalle"], img[title*="Detalle"]').first();
            if (await btnDetalle.count() > 0) {
                const postDetalle = page.waitForResponse(resp => resp.request().method() === 'POST', { timeout: 10000 }).catch(() => {});
                await btnDetalle.click();
                await postDetalle;
                await page.waitForTimeout(2000);
            }
            break;
        }
    }

    if (!filaEncontrada) {
        console.log(c.rojo('  ⚠️ No se encontro ningun registro "Activo" en la tabla.'));
        continue;
    }

    // Preguntar por el error DESPUES de entrar al detalle del nino
    console.log(c.cyan('\n  > De quien es el error de digitacion?'));
    console.log(c.cyan('    1. Beneficiario (Nino/Nina)'));
    console.log(c.cyan('    2. Acudiente / Jefe de Grupo Familiar'));
    let tipoError = '';
    while(tipoError !== '1' && tipoError !== '2') {
        tipoError = readline.question(c.cyan('  > Elige una opcion (1-2): ')).trim();
    }

        if (tipoError === '1') {
            // Error del Beneficiario (Nino/Nina)
            console.log(c.amarillo('\n  ⏳ Extrayendo datos del Beneficiario de Cuentame...'));
            
            // Re-evaluar currentFrame porque pudo cambiar al cargar el detalle
            await page.waitForTimeout(1000);
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

            const datosCuentame = await extraerDatosPersonaDeFormulario(frame);
            
            console.log(c.verde('  ✅ Datos extraidos de Cuentame:'));
            console.log(c.gris(`     - Nombre: ${datosCuentame.primerNombre} ${datosCuentame.segundoNombre} ${datosCuentame.primerApellido} ${datosCuentame.segundoApellido}`));
            console.log(c.gris(`     - Documento: ${datosCuentame.tipoDocCod} ${datosCuentame.numDoc}`));
            console.log(c.gris(`     - Nacimiento: ${datosCuentame.fechaNacimiento}, Sexo: ${datosCuentame.sexo}`));
            console.log(c.gris(`     - Lugar: ${datosCuentame.pais}, ${datosCuentame.departamento}, ${datosCuentame.municipio}`));

            // Pedir datos reales
            console.log(c.cyan('\n  > Ingresa los DATOS REALES (segun documento fisico)'));
            const mapTiposInversos = { '1': 'RC', '2': 'TI', '3': 'CC', '4': 'CE', '5': 'PPT', '6': 'PA' };
            console.log(c.cyan('    1. Registro Civil\n    2. Tarjeta de Identidad\n    3. Cedula de Ciudadania\n    4. Cedula de Extranjeria\n    5. PPT\n    6. Pasaporte'));
            
            let tipoDocReal = '';
            while(!mapTiposInversos[tipoDocReal]) tipoDocReal = readline.question(c.cyan('  > Tipo Documento (1-6) [Deja en blanco si es igual]: ')).trim() || Object.keys(mapTiposInversos).find(k => mapTiposInversos[k] === datosCuentame.tipoDocCod);
            
            const ask = (label, current) => {
                const res = readline.question(`  > ${label} [${current}]: `).trim().toUpperCase();
                return res === '' ? current : res;
            };

            const numDocReal = ask('Numero Documento', datosCuentame.numDoc);
            const pNombreReal = ask('Primer Nombre', datosCuentame.primerNombre);
            const sNombreReal = ask('Segundo Nombre', datosCuentame.segundoNombre);
            const pApellidoReal = ask('Primer Apellido', datosCuentame.primerApellido);
            const sApellidoReal = ask('Segundo Apellido', datosCuentame.segundoApellido);
            const fechaNacReal = ask('Fecha de Nacimiento (DD/MM/AAAA)', datosCuentame.fechaNacimiento);
            const sexoReal = ask('Sexo (HOMBRE/MUJER)', (datosCuentame.sexo || 'MUJER').toUpperCase());
            const deptoNacReal = ask('Departamento de Nacimiento', (datosCuentame.departamento || 'BOGOTA D.C.').trim());
            const muniNacReal = ask('Municipio de Nacimiento', (datosCuentame.municipio || 'BOGOTA D.C.').trim());
            
            // Generar observacion automatica
            const observacion = generarObservacionTicket({
                mapTiposInversos,
                tipoDocReal,
                numDocReal,
                pNombreReal,
                sNombreReal,
                pApellidoReal,
                sApellidoReal,
                fechaNacReal,
                sexoReal,
                muniNacReal,
                datosCuentame
            });

            console.log(c.amarillo(`\n  📝 Observacion generada: ${observacion}`));

            // Escribir en Excel Limpio
            console.log(c.amarillo('\n  ⏳ Guardando ticket en formato Excel...'));
            let singleExcelPath = null;
            try {
                singleExcelPath = await generarTicketExcelLimpio({
                    mapTiposInversos,
                    tipoDocReal,
                    numDocReal,
                    pNombreReal,
                    sNombreReal,
                    pApellidoReal,
                    sApellidoReal,
                    fechaNacReal,
                    sexoReal,
                    deptoNacReal,
                    muniNacReal,
                    datosCuentame,
                    observacion
                });
                console.log(c.verde(`  ✅ Ticket de Beneficiario guardado exitosamente en el Excel.`));
            } catch (err) {
                console.log(c.rojo(`  ❌ Error escribiendo el Excel: ${err.message}`));
            }

            // Procesar envio/borrador de correo
            await procesarEnvioCorreoTicket({ ascSeleccionada, numDocReal, excelPath: singleExcelPath });
        } else {
            // Error del Acudiente
            console.log(c.amarillo('\n  ⏳ Habilitando edicion (clic en Lapiz superior)...'));
            
            await page.waitForTimeout(1000);
            let frame = page.frame({ name: 'frameContent' });
            if (!frame) frame = page;

            const btnEditarTop = frame.locator('a[id*="btnEditar"], img[alt="Editar"], input[title*="Editar"]').first();
            if (await btnEditarTop.count() > 0) {
                const postEditarTop = page.waitForResponse(resp => resp.request().method() === 'POST', { timeout: 10000 }).catch(() => {});
                await btnEditarTop.click();
                await postEditarTop;
                await page.waitForTimeout(2000);
            }

            console.log(c.amarillo('  ⏳ Accediendo a la pestana "Grupo Familiar"...'));
            const btnGrupoFamiliar = frame.locator('a[id*="grupofamiliar_tab"], span:has-text("Grupo Familiar")').first();
            if (await btnGrupoFamiliar.count() > 0) {
                await btnGrupoFamiliar.click();
                await page.waitForTimeout(2000);
            }

            console.log(c.amarillo(`  ⏳ Buscando al familiar "Responsable" (marcado con 'S') en la tabla del grupo familiar...`));
            
            // Buscar en la tabla GwvGrupoFamiliar
            const rowsFamiliar = frame.locator('table[id*="GwvGrupoFamiliar"] tbody tr.rowA, table[id*="GwvGrupoFamiliar"] tbody tr.rowB, table[id*="GwvGrupoFamiliar"] tr');
            const rowsFamiliarCount = await rowsFamiliar.count();
            let familiarEncontrado = false;

            for (let i = 0; i < rowsFamiliarCount; i++) {
                const row = rowsFamiliar.nth(i);
                // El campo responsable es usualmente la columna 7 (indice 6)
                const tds = row.locator('td');
                if (await tds.count() > 6) {
                    const textoResponsable = await tds.nth(6).innerText().catch(() => '');
                    if (textoResponsable.trim() === 'S') {
                        familiarEncontrado = true;
                        const nombreFamiliar = await tds.nth(3).innerText().catch(() => 'Responsable');
                        console.log(c.verde(`  ✅ Familiar responsable encontrad@ (${nombreFamiliar.trim()}). Abriendo detalle (info)...`));
                        const btnDetalleFam = row.locator('input[type="image"][title*="Detalle"], img[title*="Detalle"]').first();
                        if (await btnDetalleFam.count() > 0) {
                            const postFam = page.waitForResponse(resp => resp.request().method() === 'POST', { timeout: 10000 }).catch(() => {});
                            await btnDetalleFam.click();
                            await postFam;
                            await page.waitForTimeout(2000);
                        }
                        break;
                    }
                }
            }

            if (!familiarEncontrado) {
                console.log(c.rojo(`  ⚠️ No se encontro ningun familiar marcado como Responsable ('S') en el grupo familiar.`));
                continue;
            }

            console.log(c.amarillo('  ⏳ Extrayendo datos del Acudiente de Cuentame...'));
            
            const datosCuentame = await extraerDatosPersonaDeFormulario(frame, true);
            
            console.log(c.verde('  ✅ Datos extraidos del Acudiente en Cuentame:'));
            console.log(c.gris(`     - Nombre: ${datosCuentame.primerNombre} ${datosCuentame.segundoNombre} ${datosCuentame.primerApellido} ${datosCuentame.segundoApellido}`));
            console.log(c.gris(`     - Documento: ${datosCuentame.tipoDocCod} ${datosCuentame.numDoc}`));
            console.log(c.gris(`     - Nacimiento: ${datosCuentame.fechaNacimiento}, Sexo: ${datosCuentame.sexo}`));
            console.log(c.gris(`     - Lugar: ${datosCuentame.pais}, ${datosCuentame.departamento}, ${datosCuentame.municipio}`));

            // Pedir datos reales
            console.log(c.cyan('\n  > Ingresa los DATOS REALES (segun documento fisico)'));
            const mapTiposInversos = { '1': 'TI', '2': 'CC', '3': 'CE', '4': 'PPT', '5': 'PA' };
            console.log(c.cyan('    1. Tarjeta de Identidad\n    2. Cedula de Ciudadania\n    3. Cedula de Extranjeria\n    4. PPT\n    5. Pasaporte'));
            
            let tipoDocReal = '';
            while(!mapTiposInversos[tipoDocReal]) tipoDocReal = readline.question(c.cyan('  > Tipo Documento (1-5) [Deja en blanco si es igual]: ')).trim() || Object.keys(mapTiposInversos).find(k => mapTiposInversos[k] === datosCuentame.tipoDocCod);
            
            const ask = (label, current) => {
                const res = readline.question(`  > ${label} [${current}]: `).trim().toUpperCase();
                return res === '' ? current : res;
            };

            const numDocReal = ask('Numero Documento', datosCuentame.numDoc);
            const pNombreReal = ask('Primer Nombre', datosCuentame.primerNombre);
            const sNombreReal = ask('Segundo Nombre', datosCuentame.segundoNombre);
            const pApellidoReal = ask('Primer Apellido', datosCuentame.primerApellido);
            const sApellidoReal = ask('Segundo Apellido', datosCuentame.segundoApellido);
            const fechaNacReal = ask('Fecha de Nacimiento (DD/MM/AAAA)', datosCuentame.fechaNacimiento);
            const sexoReal = ask('Sexo (HOMBRE/MUJER)', (datosCuentame.sexo || 'MUJER').toUpperCase());
            const deptoNacReal = ask('Departamento de Nacimiento', (datosCuentame.departamento || 'BOGOTA D.C.').trim());
            const muniNacReal = ask('Municipio de Nacimiento', (datosCuentame.municipio || 'BOGOTA D.C.').trim());
            
            // Generar observacion automatica
            const observacion = generarObservacionTicket({
                mapTiposInversos,
                tipoDocReal,
                numDocReal,
                pNombreReal,
                sNombreReal,
                pApellidoReal,
                sApellidoReal,
                fechaNacReal,
                sexoReal,
                muniNacReal,
                datosCuentame
            });

            console.log(c.amarillo(`\n  📝 Observacion generada: ${observacion}`));

            // Escribir en Excel Limpio
            console.log(c.amarillo('\n  ⏳ Guardando ticket en formato Excel...'));
            let singleExcelPath = null;
            try {
                singleExcelPath = await generarTicketExcelLimpio({
                    mapTiposInversos,
                    tipoDocReal,
                    numDocReal,
                    pNombreReal,
                    sNombreReal,
                    pApellidoReal,
                    sApellidoReal,
                    fechaNacReal,
                    sexoReal,
                    deptoNacReal,
                    muniNacReal,
                    datosCuentame,
                    observacion
                });
                console.log(c.verde(`  ✅ Ticket de Acudiente guardado exitosamente en el Excel.`));
            } catch (err) {
                console.log(c.rojo(`  ❌ Error escribiendo el Excel: ${err.message}`));
            }

            // Procesar envio/borrador de correo
            await procesarEnvioCorreoTicket({ ascSeleccionada, numDocReal, excelPath: singleExcelPath });
        }
    } // Cierra el while(true)
    
    // Desconectar
    await browser.close();
}

main().catch(err => {
    console.error(c.rojo(`\n  ❌ Error critico: ${err.message}`));
});
