require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { loginYLlegarARoles, seleccionarRolYEntrar, obtenerNavegador, validarYCambiarAsociacion } = require('../servicios/autenticacion');
const { leerJardines } = require('../servicios/excel-reader');
const readline = require('readline-sync');

const c = {
    verde: (t) => `\x1b[32m${t}\x1b[0m`,
    amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
    cyan: (t) => `\x1b[36m${t}\x1b[0m`,
    rojo: (t) => `\x1b[31m${t}\x1b[0m`,
    gris: (t) => `\x1b[90m${t}\x1b[0m`,
    negrita: (t) => `\x1b[1m${t}\x1b[0m`,
};

function normalizarTexto(txt) {
    if (!txt) return '';
    return txt.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}

function removeAccents(str) {
    if (!str) return '';
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}

function normalizarDoc(val) {
    if (val === undefined || val === null) return '';
    return String(val).replace(/[^a-zA-Z0-9]/g, '').trim().toUpperCase();
}

function extraerNombresYApellidos(nombreCompleto) {
    if (!nombreCompleto) return { nombres: '', apellidos: '' };
    const clean = removeAccents(nombreCompleto).trim().toUpperCase();
    const parts = clean.split(/\s+/).filter(p => p.length > 0);
    
    if (parts.length <= 1) {
        return { nombres: clean, apellidos: '' };
    } else if (parts.length === 2) {
        return { nombres: parts[0], apellidos: parts[1] };
    } else if (parts.length === 3) {
        return { nombres: parts[0], apellidos: `${parts[1]} ${parts[2]}` };
    } else {
        const mitad = Math.floor(parts.length / 2);
        return {
            nombres: parts.slice(0, mitad).join(' '),
            apellidos: parts.slice(mitad).join(' ')
        };
    }
}

function buscarCoincidenciaSegura(ninoTarget, listaNinos) {
    if (!ninoTarget) return null;

    // 1. PASO 1: CONFIRMAR PRIMERO POR DOCUMENTO (Exact Normalized Document Match)
    const docTargetNorm = normalizarDoc(ninoTarget.doc || ninoTarget.documento);
    if (docTargetNorm && docTargetNorm.length >= 3) {
        const porDoc = listaNinos.find(n => {
            const docCuentameNorm = normalizarDoc(n.documento);
            return docCuentameNorm === docTargetNorm || (docCuentameNorm.length >= 6 && docTargetNorm.length >= 6 && (docCuentameNorm.includes(docTargetNorm) || docTargetNorm.includes(docCuentameNorm)));
        });
        if (porDoc) {
            return { nino: porDoc, metodo: 'DOCUMENTO' };
        }
    }

    // Extraer Nombres y Apellidos
    const infoNombre = extraerNombresYApellidos(ninoTarget.nombre || ninoTarget.nombreCompleto);
    const nombresTarget = (ninoTarget.nom1 || ninoTarget.nombres) ? removeAccents(`${ninoTarget.nom1 || ''} ${ninoTarget.nom2 || ''}`).toUpperCase() : infoNombre.nombres;
    const apellidosTarget = (ninoTarget.ape1 || ninoTarget.apellidos) ? removeAccents(`${ninoTarget.ape1 || ''} ${ninoTarget.ape2 || ''}`).toUpperCase() : infoNombre.apellidos;

    const tokensApellidos = apellidosTarget.split(/\s+/).filter(t => t.length > 1);

    // 2. PASO 2: CONFIRMAR DESPUES POR APELLIDOS (Match by Last Names)
    if (tokensApellidos.length > 0) {
        const candidatosPorApellido = listaNinos.filter(n => {
            const nombreCuentame = removeAccents(n.nombreCompleto).toUpperCase();
            return tokensApellidos.every(ape => nombreCuentame.includes(ape));
        });

        if (candidatosPorApellido.length === 1) {
            return { nino: candidatosPorApellido[0], metodo: 'APELLIDOS' };
        }

        // 3. PASO 3: SI HAY VARIOS CON EL MISMO APELLIDO, DESAMBIGUAR FINALMENTE POR NOMBRE
        if (candidatosPorApellido.length > 1) {
            const tokensNombres = nombresTarget.split(/\s+/).filter(t => t.length > 1);
            if (tokensNombres.length > 0) {
                const candidatoPorNombre = candidatosPorApellido.find(n => {
                    const nombreCuentame = removeAccents(n.nombreCompleto).toUpperCase();
                    return tokensNombres.some(nom => nombreCuentame.includes(nom));
                });
                if (candidatoPorNombre) {
                    return { nino: candidatoPorNombre, metodo: 'APELLIDOS_Y_NOMBRE' };
                }
            }
            return { nino: candidatosPorApellido[0], metodo: 'APELLIDOS' };
        }
    }

    return null;
}

async function esperarUpdatePanel(frame) {
    try {
        await frame.waitForFunction(() => {
            if (typeof Sys === 'undefined' || !Sys.WebForms) return true;
            return !Sys.WebForms.PageRequestManager.getInstance().get_isInAsyncPostBack();
        }, { timeout: 15000 });
        await frame.page().waitForTimeout(150);
    } catch (e) {
        // Ignorar timeout
    }
}

async function extraerNinosDePagina(content) {
    const filas = content.locator('tr:has(input[src*="info.jpg"], input[id*="btnInfo"])');
    const count = await filas.count();
    let listaNinos = [];
    
    for (let i = 0; i < count; i++) {
        const fila = filas.nth(i);
        const celdas = fila.locator(':scope > td');
        const numCeldas = await celdas.count();
        
        // Evitar filas contenedoras (anidadas) o de paginación
        if (numCeldas < 5 || numCeldas > 15) {
            continue;
        }

        const textoCeldas = await celdas.allInnerTexts();
        const datos = textoCeldas.map(t => t.trim()).filter(t => t.length > 0);
        
        if (datos.length >= 4) {
            const documento = datos[1] || "N/A";
            const nombreCompleto = datos.slice(2, -2).join(' ');
            const tomas = datos[datos.length - 2] || "N/A";

            listaNinos.push({
                index: listaNinos.length,
                documento,
                nombreCompleto,
                tomas,
                locator: fila.locator('input[type="image"][src*="info.jpg"], input[id*="btnInfo"]').first()
            });
        }
    }
    return listaNinos;
}

async function buscarNinoEnGrilla(content, page, ninoTarget) {
    let paginasProbadas = new Set([1]);

    while (true) {
        // 1. Extraer niños de la página actual
        const listaNinos = await extraerNinosDePagina(content);
        
        // 2. Buscar coincidencia segura
        const coincidencia = buscarCoincidenciaSegura(ninoTarget, listaNinos);
        if (coincidencia) {
            console.log(c.verde(`    ✅ Niño identificado en Cuéntame (por ${coincidencia.metodo}): [${coincidencia.nino.documento}] ${coincidencia.nino.nombreCompleto}`));
            return coincidencia.nino.locator;
        }

        // 3. Si no está en esta página, buscar enlace a la siguiente página no probada
        const pagerLinks = content.locator('a[href*="Page$"], a[href*="gvBeneficiarios"]');
        const countLinks = await pagerLinks.count();

        let linkSiguiente = null;
        let numSiguiente = -1;

        for (let k = 0; k < countLinks; k++) {
            const link = pagerLinks.nth(k);
            const href = await link.getAttribute('href').catch(() => '');
            const txt = await link.innerText().catch(() => '');

            const match = href.match(/Page\$(\d+)/) || txt.match(/^(\d+)$/);
            if (match) {
                const pageNum = parseInt(match[1], 10);
                if (!paginasProbadas.has(pageNum)) {
                    linkSiguiente = link;
                    numSiguiente = pageNum;
                    break;
                }
            }
        }

        if (!linkSiguiente || numSiguiente <= 0) {
            // Ya se recorrieron todas las páginas disponibles
            return null;
        }

        paginasProbadas.add(numSiguiente);
        console.log(c.gris(`    (Buscando en página ${numSiguiente} de la UDS...)`));

        try {
            await Promise.all([
                content.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
                linkSiguiente.evaluate(node => node.click())
            ]);
            await page.waitForTimeout(1000);
            content = page.frame({ name: 'frameContent' }) || page.frames().find(f => f.name() === 'frameContent') || page;
            await esperarUpdatePanel(content);
        } catch (e) {
            return null;
        }
    }
}

async function cargarUdsEnCuentameRapido(page, jardinSeleccionado) {
    if (!jardinSeleccionado || !jardinSeleccionado.codigo) return false;

    let contentFrame = page.frame({ name: 'frameContent' }) || page.frames().find(f => f.name() === 'frameContent') || page;

    let lupaLocator = contentFrame.locator('input[id*="cphCont_btnFiltrar"], input[name*="btnFiltrar"], input[src*="lupa"]').first();

    if (await lupaLocator.count() === 0) {
        const rootMenu = page.frame({ name: 'frameMenu' }) || page;
        const childMenu = rootMenu.locator('a:has-text("Seguimiento nutricional")').first();
        if (await childMenu.count() > 0) {
            await childMenu.evaluate(node => node.click());
            await page.waitForTimeout(600);
        }
        contentFrame = page.frame({ name: 'frameContent' }) || page;
        lupaLocator = contentFrame.locator('input[id*="cphCont_btnFiltrar"], input[name*="btnFiltrar"], input[src*="lupa"]').first();
    }

    if (await lupaLocator.count() === 0) {
        console.log(c.rojo('  ❌ No se encontro la lupa de UDS para recargar.'));
        return false;
    }

    const [popup] = await Promise.all([
        page.waitForEvent('popup'),
        lupaLocator.evaluate(node => node.click())
    ]);

    await popup.waitForLoadState('domcontentloaded');
    console.log(c.verde('  ✅ Ventana emergente Lupa abierta.'));

    console.log(c.cyan(`  📍 Ingresando codigo de UDS: ${jardinSeleccionado.codigo}...`));
    await popup.locator('input[id*="txtCodigoUnidadServicio"], input[name*="CodigoUnidadServicio"]').first().fill(String(jardinSeleccionado.codigo));

    let ddlDepto = popup.locator('select[id*="ddlDepartamento"], select[name*="ddlDepartamento"]').first();
    if (await ddlDepto.count() === 0) {
        const tdLabel = popup.locator('td:has-text("Departamento")').last();
        ddlDepto = tdLabel.locator('xpath=following-sibling::td//select').first();
        if (await ddlDepto.count() === 0) ddlDepto = popup.locator('select').nth(1);
    }

    try {
        await ddlDepto.selectOption({ label: /BOGOT. D\.C\./i });
    } catch (err) {
        try {
            const options = await ddlDepto.locator('option').allInnerTexts();
            const bogotaOpt = options.find(o => o.toUpperCase().includes('BOGOT'));
            if (bogotaOpt) await ddlDepto.selectOption({ label: bogotaOpt });
        } catch (e) {}
    }

    console.log(c.cyan('  🔍 Haciendo clic en buscar dentro de la Lupa...'));
    await popup.locator('input[type="image"][id*="btnBuscar"], input[name*="btnBuscar"], a[id*="btnBuscar"]').first().click();

    try {
        const btnInfo = popup.locator('input[type="image"][id*="btnInfo"], input[src*="info.jpg"]').first();
        await btnInfo.waitFor({ state: 'visible', timeout: 8000 });
        console.log(c.verde('  ✅ Resultado de UDS encontrado. Seleccionando...'));
        await btnInfo.click();
    } catch (err) {
        console.log(c.rojo(`  ❌ Error: No se encontraron resultados en el popup para la UDS ${jardinSeleccionado.nombre}.`));
    }

    // El click en btnInfo dentro del popup dispara window.opener.__doPostBack y cierra la ventana
    try {
        await popup.waitForEvent('close', { timeout: 1500 });
    } catch (e) {
        await popup.close().catch(() => {});
    }

    // Esperar de inmediato la actualización de la grilla en el frame principal
    contentFrame = page.frame({ name: 'frameContent' }) || page.frames().find(f => f.name() === 'frameContent') || page;
    await esperarUpdatePanel(contentFrame);
    await page.waitForTimeout(300);
    return true;
}

async function main() {
    let ninos = [];
    console.log(c.negrita('\n¿Qué método deseas usar para tomar los pantallazos?'));
    console.log('  1. Excel de Alertas generado internamente (Alertas_Nutricionales_ICBF.xlsx)');
    console.log('  2. Buscar un niño manualmente');
    console.log('  3. Leer archivo tabla_extraida.xlsx desde el Escritorio');
    let modo = readline.question(c.negrita('\n> Ingresa tu opcion (1, 2 o 3): '));

    if (modo.trim() === '1') {
        const excelPath = path.join(__dirname, '..', 'Alertas_Nutricionales_ICBF.xlsx');
        if (!fs.existsSync(excelPath)) {
            console.log(c.rojo(`❌ No se encontro el archivo ${excelPath}`));
            return;
        }

        console.log(c.cyan('📖 Leyendo Excel de alertas...'));
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(excelPath);
        const worksheet = workbook.getWorksheet(1);
        
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) { 
                const entidad = row.getCell('A').text;
                const uds = row.getCell('B').text;
                const doc = row.getCell('C').text;
                const nombre = `${row.getCell('F').text} ${row.getCell('D').text}`.trim();
                if (doc && entidad) ninos.push({ entidad, uds, doc, nombre });
            }
        });
    } else if (modo.trim() === '3') {
        const os = require('os');
        const possiblePaths = [
            path.join(os.homedir(), 'OneDrive', 'Escritorio', 'tabla_extraida.xlsx'),
            path.join(os.homedir(), 'Desktop', 'tabla_extraida.xlsx'),
            path.join(os.homedir(), 'Escritorio', 'tabla_extraida.xlsx')
        ];
        let tablaExtraidaPath = possiblePaths.find(p => fs.existsSync(p));

        if (!tablaExtraidaPath) {
            console.log(c.rojo(`❌ No se encontro el archivo tabla_extraida.xlsx en tu Escritorio.`));
            return;
        }

        console.log(c.cyan(`📖 Leyendo ${tablaExtraidaPath}...`));
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(tablaExtraidaPath);
        const worksheet = workbook.getWorksheet(1);
        
        // Encontrar índices de las columnas según los encabezados
        const headers = worksheet.getRow(1).values;
        const idxEntidad = headers.indexOf('EntidadContratista');
        const idxUds = headers.indexOf('UnidadServicio');
        const idxDoc = headers.indexOf('NumeroDocu');
        const idxNombre1 = headers.indexOf('PrimerNombreBe');
        const idxNombre2 = headers.indexOf('SegundoNom');
        const idxApe1 = headers.indexOf('PrimerApellidoBen');
        const idxApe2 = headers.indexOf('SegundoApellidoBe');

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) { 
                const entidad = row.getCell(idxEntidad).text;
                const uds = row.getCell(idxUds).text;
                const doc = row.getCell(idxDoc).text;
                
                const nom1 = row.getCell(idxNombre1).text || '';
                const nom2 = row.getCell(idxNombre2).text || '';
                const ape1 = row.getCell(idxApe1).text || '';
                const ape2 = row.getCell(idxApe2).text || '';
                const nombre = `${nom1} ${nom2} ${ape1} ${ape2}`.replace(/\s+/g, ' ').trim();

                if (doc && entidad) ninos.push({ entidad, uds, doc, nombre, nom1, nom2, ape1, ape2 });
            }
        });
    } else {
        const entidad = readline.question(c.negrita('  > Ingresa el nombre de la Asociacion (Ej: CANAIMA): '));
        const uds = readline.question(c.negrita('  > Ingresa el nombre de la UDS (Ej: ESTRELLITAS): '));
        const doc = readline.question(c.negrita('  > Ingresa el numero de documento del nino: '));
        ninos.push({ entidad, uds, doc, nombre: 'Manual' });
    }

    const outputFolder = path.join(__dirname, '..', 'pantallazos_nutricion');
    if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder);

    console.log(c.verde(`✅ Se procesaran ${ninos.length} ninos para tomar pantallazo.`));

    // Cargar diccionarios de UDS para mapear Nombre a Codigo
    const rutaGeneralBots = process.env.RUTA_EXCEL || path.join(__dirname, '..', 'GENERAL_BOTS.xlsx');
    const { porAsociacion } = leerJardines(rutaGeneralBots);

    console.log(c.amarillo('🚀 Conectando al navegador...'));
    const navData = await obtenerNavegador();
    const { browser, page } = navData;

    let loggedIn = false;
    let asociacionActual = '';

    for (let i = 0; i < ninos.length; i++) {
        const nino = ninos[i];
        console.log(c.cyan(`\n========================================================`));
        console.log(c.cyan(`Procesando (${i+1}/${ninos.length}): ${nino.nombre} - ${nino.doc}`));
        console.log(c.cyan(`========================================================`));

        try {
            if (!loggedIn) {
                await loginYLlegarARoles(page, { 
                    usuario: process.env.CUENTAME_USUARIO, 
                    password: process.env.CUENTAME_PASSWORD, 
                    gmailUser: process.env.GMAIL_USER, 
                    gmailAppPassword: process.env.GMAIL_APP_PASSWORD 
                });
                await seleccionarRolYEntrar(page, nino.entidad);
                loggedIn = true;
                asociacionActual = nino.entidad;
            } else {
                const asocCambiada = await validarYCambiarAsociacion(page, nino.entidad, asociacionActual);
                if (asocCambiada) {
                    asociacionActual = nino.entidad;
                } else if (asocCambiada === false) {
                    console.log(c.amarillo('  🔄 Relogueando forzosamente por caducidad de sesion...'));
                    await loginYLlegarARoles(page, { 
                        usuario: process.env.CUENTAME_USUARIO, 
                        password: process.env.CUENTAME_PASSWORD, 
                        gmailUser: process.env.GMAIL_USER, 
                        gmailAppPassword: process.env.GMAIL_APP_PASSWORD 
                    });
                    await seleccionarRolYEntrar(page, nino.entidad);
                    loggedIn = true;
                    asociacionActual = nino.entidad;
                }
            }

            console.log(c.gris(`Navegando a Seguimiento Nutricional...`));
            let menuFrame = page.frame({ name: 'frameMenu' }) || page.frames().find(f => f.name() === 'frameMenu') || page;

            await menuFrame.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const rubLink = links.find(a => a.innerText && a.innerText.trim() === 'Rub online' && a.classList.contains('desplegable'));
                if (rubLink) {
                    const li = rubLink.closest('li');
                    const ul = li ? li.querySelector('ul') : null;
                    if (!ul || ul.style.display === 'none' || ul.style.display === '') rubLink.click();
                }
            }).catch(()=>{});
            await page.waitForTimeout(200);

            await menuFrame.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const target = links.find(a => a.innerText && a.innerText.toLowerCase().includes('seguimiento nutricional'));
                if (target) target.click();
            }).catch(()=>{});
            
            let contentFrame = page.frame({ name: 'frameContent' }) || page.frames().find(f => f.name() === 'frameContent') || page;
            await contentFrame.locator('input[id*="btnFiltrar"], input[src*="lupa"]').first().waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
            await page.waitForTimeout(300);

            // ==========================================
            // BUSCAR CÓDIGO DE LA UDS E INVOCAR LA LUPA
            // ==========================================
            if (nino.uds && nino.uds.trim() !== '') {
                // Encontrar la asociación en nuestro diccionario (ordenando por longitud para que BRISAS DE BUENAVISTA se evalúe antes que BUENAVISTA)
                const ascNorm = normalizarTexto(nino.entidad);
                const asociacionesOrdenadas = Object.values(porAsociacion).sort((a, b) => b.nombreCorto.length - a.nombreCorto.length);
                let ascTarget = asociacionesOrdenadas.find(a => ascNorm.includes(normalizarTexto(a.nombreCorto)) || normalizarTexto(a.nombreCorto).includes(ascNorm) || normalizarTexto(a.nombreLargo).includes(ascNorm));
                
                if (ascTarget) {
                    const udsNorm = normalizarTexto(nino.uds);
                    // Mismo arreglo de ordenamiento para los jardines
                    const jardinesOrdenados = [...ascTarget.jardines].sort((a, b) => b.nombre.length - a.nombre.length);
                    const jardinTarget = jardinesOrdenados.find(j => udsNorm.includes(normalizarTexto(j.nombre)) || normalizarTexto(j.nombre).includes(udsNorm));
                    
                    if (jardinTarget && jardinTarget.codigo) {
                        console.log(c.gris(`Invocando la lupa para la UDS: ${jardinTarget.nombre} (Cod: ${jardinTarget.codigo})`));
                        
                        await cargarUdsEnCuentameRapido(page, jardinTarget);
                    } else {
                        console.log(c.rojo(`    ⚠️ No se encontro codigo de UDS para: ${nino.uds}. Asegurate de que esté en GENERAL_BOTS.xlsx`));
                        continue;
                    }
                } else {
                    console.log(c.rojo(`    ⚠️ No se encontro la Asociación "${nino.entidad}" en GENERAL_BOTS.xlsx. Saltando.`));
                    continue;
                }
            }

            // ==========================================
            // BUSCAR AL NIÑO EN LA GRILLA
            // ==========================================
            console.log(c.gris(`Buscando documento: ${nino.doc} (${nino.nombre}) en la grilla...`));
            
            contentFrame = page.frame({ name: 'frameContent' }) || page.frames().find(f => f.name() === 'frameContent') || page;
            await esperarUpdatePanel(contentFrame);
            
            const ninoLocator = await buscarNinoEnGrilla(contentFrame, page, nino);

            if (ninoLocator) {
                console.log(c.verde(`Abriendo expediente...`));
                
                await Promise.all([
                    contentFrame.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
                    ninoLocator.evaluate(node => node.click())
                ]);

                // Esperar a que aparezca la tabla de historial o perfil de inmediato
                contentFrame = page.frame({ name: 'frameContent' }) || page.frames().find(f => f.name() === 'frameContent') || page;
                await contentFrame.locator('table:has-text("Fecha Toma"), table:has-text("Fecha toma"), div:has-text("Seguimiento nutrición")').first().waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
                await page.waitForTimeout(400);

                // Tomar pantallazo!
                console.log(c.amarillo(`📸 Tomando pantallazo...`));
                const asocFolderName = normalizarTexto(nino.entidad).replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/ /g, '_');
                const asocFolder = path.join(outputFolder, asocFolderName);
                if (!fs.existsSync(asocFolder)) fs.mkdirSync(asocFolder, { recursive: true });
                
                const screenshotPath = path.join(asocFolder, `Pantallazo_${nino.doc}_${nino.nombre.replace(/ /g, '_')}.png`);
                
                // Bajar el scroll al fondo del iframe interno
                await contentFrame.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(()=>{});
                await page.waitForTimeout(300);

                await page.screenshot({ path: screenshotPath, fullPage: true });
                console.log(c.verde(`✅ Guardado exitosamente: ${screenshotPath}`));

            } else {
                console.log(c.rojo(`❌ No se encontró al niño [${nino.doc}] ${nino.nombre} en ninguna de las páginas de la UDS.`));
            }

        } catch (error) {
            console.log(c.rojo(`⚠️ Error procesando a ${nino.doc}: ${error.message}`));
        }
    }

    console.log(c.cyan(`\n🎉 Proceso finalizado. Pantallazos guardados en la carpeta "pantallazos_nutricion".\n`));
    if (!navData.isCDP) await browser.close();
}

main().catch(console.error);
