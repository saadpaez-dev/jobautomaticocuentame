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
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { leerJardines } = require('../servicios/excel-reader');
const { seleccionarRolYEntrar, verificarConexionOCaida, loginYLlegarARoles } = require('../servicios/autenticacion');

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
    console.log(c.cyan('   🎫 TICKET PARA ERRORES DE DIGITACIÓN'));
    console.log(c.cyan('======================================================\n'));

    console.log(c.gris('Selecciona una asociación para iniciar el proceso.'));
    asociaciones.forEach((asc, i) => console.log(`  ${i + 1}. ${asc.nombreCorto}`));
    console.log(`  ${c.rojo('0')}. Volver al menú principal`);

    let idxAsociacion = -1;
    while (idxAsociacion < 0 || idxAsociacion > asociaciones.length) {
        const res = readline.question(c.negrita('\n  > Selecciona la asociacion: '));
        idxAsociacion = parseInt(res, 10);
        if (isNaN(idxAsociacion)) idxAsociacion = -1;
    }

    if (idxAsociacion === 0) {
        console.log(c.verde('\n  👋 Volviendo al menú principal...'));
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
    
    // Verificación inicial de sesión
    if (await verificarConexionOCaida(page)) {
        console.log(c.amarillo('  ⚠️ La sesión inicial expiró o se perdió.'));
        console.log(c.amarillo('  ⏳ Iniciando sesión automáticamente (2FA)...'));
        await loginYLlegarARoles(page, {
            usuario: USUARIO,
            password: PASSWORD,
            gmailUser: GMAIL_USER,
            gmailAppPassword: GMAIL_APP_PASSWORD
        });
        console.log(c.verde('  ✅ Login inicial restaurado exitosamente.'));
    }

    console.log(c.amarillo('  ⏳ Seleccionando el rol / asociación...'));
    await seleccionarRolYEntrar(page, ascSeleccionada);
    
    // Bucle interactivo para ingresar varios tickets
    while (true) {
        console.log(c.cyan('\n------------------------------------------------------'));
        console.log(c.amarillo('  [1] Consultar otro beneficiario'));
        console.log(c.rojo('  [0] Volver al menú principal'));
        
        let accion = readline.question(c.negrita('\n  > Tu opcion (1 o 0): ')).trim();
        if (accion === '0') {
            break;
        } else if (accion !== '1') {
            continue;
        }

        // Verificar si la sesión se cayó antes de continuar
        if (await verificarConexionOCaida(page)) {
            console.log(c.amarillo('  ⚠️ La sesión de Cuéntame expiró o se perdió.'));
            console.log(c.amarillo('  ⏳ Intentando iniciar sesión automáticamente (2FA)...'));
            await loginYLlegarARoles(page, {
                usuario: USUARIO,
                password: PASSWORD,
                gmailUser: GMAIL_USER,
                gmailAppPassword: GMAIL_APP_PASSWORD
            });
            console.log(c.verde('  ✅ Login restaurado exitosamente. Seleccionando asociación nuevamente...'));
            await seleccionarRolYEntrar(page, ascSeleccionada);
        }

        // Navegar al menú de Beneficiario
        console.log(c.amarillo('  ⏳ Entrando al menú "Beneficiario" > "Beneficiario"...'));
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
                console.log(c.rojo('  ⚠️ No se encontró el menú Beneficiario.'));
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
        '2': 'PERMISO POR PROTECCIÓN TEMPORAL',
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

    // Llenar datos de búsqueda
    console.log(c.amarillo('  ⏳ Buscando beneficiario en Cuéntame...'));
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
    
    // Seleccionar Estado Atención: Todos
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
        console.log(c.rojo('  ⚠️ No se encontró ningún registro "Activo" en la tabla.'));
        continue;
    }

    // Preguntar por el error DESPUÉS de entrar al detalle del niño
    console.log(c.cyan('\n  > ¿De quién es el error de digitación?'));
    console.log(c.cyan('    1. Beneficiario (Niño/Niña)'));
    console.log(c.cyan('    2. Acudiente / Jefe de Grupo Familiar'));
    let tipoError = '';
    while(tipoError !== '1' && tipoError !== '2') {
        tipoError = readline.question(c.cyan('  > Elige una opcion (1-2): ')).trim();
    }

        if (tipoError === '1') {
            // Error del Beneficiario (Niño/Niña)
            console.log(c.amarillo('\n  ⏳ Extrayendo datos del Beneficiario de Cuéntame...'));
            
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

            const datosCuentame = {
                tipoDoc: await frame.locator('select[id*="ddlTipoDocumento"] option:checked, select[id*="TipoDocumento"] option:checked').innerText().catch(()=>''),
                numDoc: await frame.locator('input[type="text"][id*="txtIdentificacion"]').inputValue().catch(()=>''),
                primerNombre: await frame.locator('input[type="text"][id*="txtPrimerNombre"]').inputValue().catch(()=>''),
                segundoNombre: await frame.locator('input[type="text"][id*="txtSegundoNombre"]').inputValue().catch(()=>''),
                primerApellido: await frame.locator('input[type="text"][id*="txtPrimerApellido"]').inputValue().catch(()=>''),
                segundoApellido: await frame.locator('input[type="text"][id*="txtSegundoApellido"]').inputValue().catch(()=>''),
                fechaNacimiento: await frame.locator('input[type="text"][id*="txtFechaNacimiento"]').inputValue().catch(()=>''),
                sexo: await frame.locator('select[id*="ddlSexo"] option:checked').innerText().catch(()=>''),
                pais: await frame.locator('select[id*="ddlPaisNacimiento"] option:checked, select[id*="ddlPais"] option:checked').innerText().catch(()=>'COLOMBIA'),
                departamento: await frame.locator('select[id*="ddlDepartamentoNacimiento"] option:checked, select[id*="ddlDepartamento"] option:checked').innerText().catch(()=>''),
                municipio: await frame.locator('select[id*="ddlMunicipioNacimiento"] option:checked, select[id*="ddlMunicipio"] option:checked').innerText().catch(()=>'')
            };

            const mapTipoDoc = (tipoFull) => {
                const t = tipoFull.toUpperCase();
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

            datosCuentame.tipoDocCod = mapTipoDoc(datosCuentame.tipoDoc);
            
            console.log(c.verde('  ✅ Datos extraídos de Cuéntame:'));
            console.log(c.gris(`     - Nombre: ${datosCuentame.primerNombre} ${datosCuentame.segundoNombre} ${datosCuentame.primerApellido} ${datosCuentame.segundoApellido}`));
            console.log(c.gris(`     - Documento: ${datosCuentame.tipoDocCod} ${datosCuentame.numDoc}`));
            console.log(c.gris(`     - Nacimiento: ${datosCuentame.fechaNacimiento}, Sexo: ${datosCuentame.sexo}`));
            console.log(c.gris(`     - Lugar: ${datosCuentame.pais}, ${datosCuentame.departamento}, ${datosCuentame.municipio}`));

            // Pedir datos reales
            console.log(c.cyan('\n  > Ingresa los DATOS REALES (según documento físico)'));
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
            const sexoReal = ask('Sexo (HOMBRE/MUJER)', datosCuentame.sexo.toUpperCase());
            
            // Generar observación automática
            const obs = [];
            const nombresMal = (pNombreReal !== datosCuentame.primerNombre) || (sNombreReal !== datosCuentame.segundoNombre);
            const apellidosMal = (pApellidoReal !== datosCuentame.primerApellido) || (sApellidoReal !== datosCuentame.segundoApellido);
            
            if (nombresMal && apellidosMal) {
                obs.push("DATOS DE NOMBRES Y APELLIDOS MAL DIGITADOS");
            } else {
                if (nombresMal) {
                    if (pNombreReal !== datosCuentame.primerNombre && sNombreReal !== datosCuentame.segundoNombre) obs.push("NOMBRES MAL DIGITADOS");
                    else if (pNombreReal !== datosCuentame.primerNombre) obs.push("PRIMER NOMBRE MAL DIGITADO");
                    else if (sNombreReal !== datosCuentame.segundoNombre) obs.push("SEGUNDO NOMBRE MAL DIGITADO");
                }
                if (apellidosMal) {
                    if (pApellidoReal !== datosCuentame.primerApellido && sApellidoReal !== datosCuentame.segundoApellido) obs.push("APELLIDOS MAL DIGITADOS");
                    else if (pApellidoReal !== datosCuentame.primerApellido) obs.push("PRIMER APELLIDO MAL DIGITADO");
                    else if (sApellidoReal !== datosCuentame.segundoApellido) obs.push("SEGUNDO APELLIDO MAL DIGITADO");
                }
            }
            
            if (mapTiposInversos[tipoDocReal] !== datosCuentame.tipoDocCod) obs.push("TIPO DE DOCUMENTO MAL DIGITADO");
            if (numDocReal !== datosCuentame.numDoc) obs.push("NUMERO DE DOCUMENTO MAL DIGITADO");
            if (fechaNacReal !== datosCuentame.fechaNacimiento) obs.push("FECHA DE NACIMIENTO MAL DIGITADA");
            if (sexoReal !== datosCuentame.sexo.toUpperCase()) obs.push("SEXO MAL DIGITADO");
            // Nota: Pais, depto y mpio los asumimos correctos para la prueba a menos que se solicite.

            const observacion = obs.join(" - ") || "DATOS ACTUALIZADOS";
            console.log(c.amarillo(`\n  📝 Observación generada: ${observacion}`));

            // Escribir en Excel
            console.log(c.amarillo('\n  ⏳ Guardando en el archivo de Excel...'));
            const ExcelJS = require('exceljs');
            const workbook = new ExcelJS.Workbook();
            const excelPath = path.join(__dirname, '..', 'docs', 'f4.m3.pp_formato_cambio_datos_basicos_personas_v5.xlsx');
            
            try {
                await workbook.xlsx.readFile(excelPath);
                const sheet = workbook.worksheets[0];
                
                // Encontrar la primera fila vacía después de la 5
                let nextRow = 6;
                while (sheet.getRow(nextRow).getCell('N').value != null && sheet.getRow(nextRow).getCell('N').value !== '') {
                    nextRow++;
                }

                const row = sheet.getRow(nextRow);
                
                // Datos Reales (Columnas C a M, indices 3 a 13)
                row.getCell(3).value = mapTiposInversos[tipoDocReal]; // C
                row.getCell(4).value = numDocReal; // D
                row.getCell(5).value = pNombreReal; // E
                row.getCell(6).value = sNombreReal; // F
                row.getCell(7).value = pApellidoReal; // G
                row.getCell(8).value = sApellidoReal; // H
                row.getCell(9).value = fechaNacReal; // I
                row.getCell(10).value = sexoReal; // J
                row.getCell(11).value = 'COLOMBIA'; // K
                row.getCell(12).value = datosCuentame.departamento; // L
                row.getCell(13).value = datosCuentame.municipio; // M

                // Datos Cuéntame (Columnas N a X, indices 14 a 24)
                row.getCell(14).value = datosCuentame.tipoDocCod; // N
                row.getCell(15).value = datosCuentame.numDoc; // O
                row.getCell(16).value = datosCuentame.primerNombre; // P
                row.getCell(17).value = datosCuentame.segundoNombre; // Q
                row.getCell(18).value = datosCuentame.primerApellido; // R
                row.getCell(19).value = datosCuentame.segundoApellido; // S
                row.getCell(20).value = datosCuentame.fechaNacimiento; // T
                row.getCell(21).value = datosCuentame.sexo.toUpperCase(); // U
                row.getCell(22).value = datosCuentame.pais.toUpperCase(); // V
                row.getCell(23).value = datosCuentame.departamento.toUpperCase(); // W
                row.getCell(24).value = datosCuentame.municipio.toUpperCase(); // X

                // Novedad
                row.getCell(25).value = 'Error en Diligenciamiento de Datos Básicos'; // Y
                row.getCell(28).value = observacion; // AB

                row.commit();
                await workbook.xlsx.writeFile(excelPath);
                console.log(c.verde(`  ✅ Ticket guardado exitosamente en la fila ${nextRow} del Excel.`));
                
            } catch (err) {
                console.log(c.rojo(`  ❌ Error escribiendo el Excel: ${err.message}`));
            }
        } else {
            // Error del Acudiente
            console.log(c.amarillo('\n  ⏳ Habilitando edición (clic en Lápiz superior)...'));
            
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

            console.log(c.amarillo('  ⏳ Accediendo a la pestaña "Grupo Familiar"...'));
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
                // El campo responsable es usualmente la columna 7 (índice 6)
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
                console.log(c.rojo(`  ⚠️ No se encontró ningún familiar marcado como Responsable ('S') en el grupo familiar.`));
                continue;
            }

            console.log(c.amarillo('  ⏳ Extrayendo datos del Acudiente de Cuéntame...'));
            
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

            const datosCuentame = {
                tipoDoc: await frame.locator('select[id*="TipoDocumento"] option:checked, select[id*="ddlTipoDocumento"] option:checked').last().innerText({timeout: 1000}).catch(()=>''),
                numDoc: await frame.locator('input[type="text"][id*="txtIdentificacion"]').last().inputValue({timeout: 1000}).catch(()=>''),
                primerNombre: await frame.locator('input[type="text"][id*="txtPrimerNombre"]').last().inputValue({timeout: 1000}).catch(()=>''),
                segundoNombre: await frame.locator('input[type="text"][id*="txtSegundoNombre"]').last().inputValue({timeout: 1000}).catch(()=>''),
                primerApellido: await frame.locator('input[type="text"][id*="txtPrimerApellido"]').last().inputValue({timeout: 1000}).catch(()=>''),
                segundoApellido: await frame.locator('input[type="text"][id*="txtSegundoApellido"]').last().inputValue({timeout: 1000}).catch(()=>''),
                fechaNacimiento: await frame.locator('input[type="text"][id*="txtFechaNacimiento"]').last().inputValue({timeout: 1000}).catch(()=>''),
                sexo: await frame.locator('select[id*="ddlSexo"] option:checked').last().innerText({timeout: 1000}).catch(()=>''),
                pais: await frame.locator('select[id*="ddlPaisNacimiento"] option:checked, select[id*="ddlPais"] option:checked').last().innerText({timeout: 1000}).catch(()=>'COLOMBIA'),
                departamento: await frame.locator('select[id*="ddlDepartamentoNacimiento"] option:checked, select[id*="ddlDepartamento"] option:checked').last().innerText({timeout: 1000}).catch(()=>''),
                municipio: await frame.locator('select[id*="ddlMunicipioNacimiento"] option:checked, select[id*="ddlMunicipio"] option:checked').last().innerText({timeout: 1000}).catch(()=>'')
            };

            datosCuentame.tipoDocCod = mapTipoDoc(datosCuentame.tipoDoc);
            
            console.log(c.verde('  ✅ Datos extraídos del Acudiente en Cuéntame:'));
            console.log(c.gris(`     - Nombre: ${datosCuentame.primerNombre} ${datosCuentame.segundoNombre} ${datosCuentame.primerApellido} ${datosCuentame.segundoApellido}`));
            console.log(c.gris(`     - Documento: ${datosCuentame.tipoDocCod} ${datosCuentame.numDoc}`));
            console.log(c.gris(`     - Nacimiento: ${datosCuentame.fechaNacimiento}, Sexo: ${datosCuentame.sexo}`));
            console.log(c.gris(`     - Lugar: ${datosCuentame.pais}, ${datosCuentame.departamento}, ${datosCuentame.municipio}`));

            // Pedir datos reales
            console.log(c.cyan('\n  > Ingresa los DATOS REALES (según documento físico)'));
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
            const sexoReal = ask('Sexo (HOMBRE/MUJER)', datosCuentame.sexo.toUpperCase());
            
            // Generar observación automática
            const obs = [];
            const nombresMal = (pNombreReal !== datosCuentame.primerNombre) || (sNombreReal !== datosCuentame.segundoNombre);
            const apellidosMal = (pApellidoReal !== datosCuentame.primerApellido) || (sApellidoReal !== datosCuentame.segundoApellido);
            
            if (nombresMal && apellidosMal) {
                obs.push("DATOS DE NOMBRES Y APELLIDOS MAL DIGITADOS");
            } else {
                if (nombresMal) {
                    if (pNombreReal !== datosCuentame.primerNombre && sNombreReal !== datosCuentame.segundoNombre) obs.push("NOMBRES MAL DIGITADOS");
                    else if (pNombreReal !== datosCuentame.primerNombre) obs.push("PRIMER NOMBRE MAL DIGITADO");
                    else if (sNombreReal !== datosCuentame.segundoNombre) obs.push("SEGUNDO NOMBRE MAL DIGITADO");
                }
                if (apellidosMal) {
                    if (pApellidoReal !== datosCuentame.primerApellido && sApellidoReal !== datosCuentame.segundoApellido) obs.push("APELLIDOS MAL DIGITADOS");
                    else if (pApellidoReal !== datosCuentame.primerApellido) obs.push("PRIMER APELLIDO MAL DIGITADO");
                    else if (sApellidoReal !== datosCuentame.segundoApellido) obs.push("SEGUNDO APELLIDO MAL DIGITADO");
                }
            }
            
            if (mapTiposInversos[tipoDocReal] !== datosCuentame.tipoDocCod) obs.push("TIPO DE DOCUMENTO MAL DIGITADO");
            if (numDocReal !== datosCuentame.numDoc) obs.push("NUMERO DE DOCUMENTO MAL DIGITADO");
            if (fechaNacReal !== datosCuentame.fechaNacimiento) obs.push("FECHA DE NACIMIENTO MAL DIGITADA");
            if (sexoReal !== datosCuentame.sexo.toUpperCase()) obs.push("SEXO MAL DIGITADO");

            const observacion = obs.join(" - ") || "DATOS ACTUALIZADOS";
            console.log(c.amarillo(`\n  📝 Observación generada: ${observacion}`));

            // Escribir en Excel
            console.log(c.amarillo('\n  ⏳ Guardando en el archivo de Excel...'));
            const ExcelJS = require('exceljs');
            const workbook = new ExcelJS.Workbook();
            const excelPath = path.join(__dirname, '..', 'docs', 'f4.m3.pp_formato_cambio_datos_basicos_personas_v5.xlsx');
            
            try {
                await workbook.xlsx.readFile(excelPath);
                const sheet = workbook.worksheets[0];
                
                // Encontrar la primera fila vacía después de la 5
                let nextRow = 6;
                while (sheet.getRow(nextRow).getCell('N').value != null && sheet.getRow(nextRow).getCell('N').value !== '') {
                    nextRow++;
                }

                const row = sheet.getRow(nextRow);
                
                // Datos Reales (Columnas C a M)
                row.getCell(3).value = mapTiposInversos[tipoDocReal];
                row.getCell(4).value = numDocReal;
                row.getCell(5).value = pNombreReal;
                row.getCell(6).value = sNombreReal;
                row.getCell(7).value = pApellidoReal;
                row.getCell(8).value = sApellidoReal;
                row.getCell(9).value = fechaNacReal;
                row.getCell(10).value = sexoReal;
                row.getCell(11).value = 'COLOMBIA';
                row.getCell(12).value = datosCuentame.departamento;
                row.getCell(13).value = datosCuentame.municipio;

                // Datos Cuéntame (Columnas N a X)
                row.getCell(14).value = datosCuentame.tipoDocCod;
                row.getCell(15).value = datosCuentame.numDoc;
                row.getCell(16).value = datosCuentame.primerNombre;
                row.getCell(17).value = datosCuentame.segundoNombre;
                row.getCell(18).value = datosCuentame.primerApellido;
                row.getCell(19).value = datosCuentame.segundoApellido;
                row.getCell(20).value = datosCuentame.fechaNacimiento;
                row.getCell(21).value = datosCuentame.sexo.toUpperCase();
                row.getCell(22).value = datosCuentame.pais.toUpperCase();
                row.getCell(23).value = datosCuentame.departamento.toUpperCase();
                row.getCell(24).value = datosCuentame.municipio.toUpperCase();

                // Novedad
                row.getCell(25).value = 'Error en Diligenciamiento de Datos Básicos'; // Y
                row.getCell(28).value = observacion; // AB

                row.commit();
                await workbook.xlsx.writeFile(excelPath);
                console.log(c.verde(`  ✅ Ticket de Acudiente guardado exitosamente en la fila ${nextRow} del Excel.`));
                
            } catch (err) {
                console.log(c.rojo(`  ❌ Error escribiendo el Excel: ${err.message}`));
            }
        }
    } // Cierra el while(true)
    
    // Desconectar
    await browser.close();
}

main().catch(err => {
    console.error(c.rojo(`\n  ❌ Error crítico: ${err.message}`));
});
