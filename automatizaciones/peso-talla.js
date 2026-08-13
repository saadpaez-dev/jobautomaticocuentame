/**
 * peso-talla.js
 * Script interactivo para el registro de toma de peso y talla.
 * Fase 1: Selección de Asociación y Jardín (UDS), e ingreso al módulo correspondiente.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const xlsx = require('xlsx');
const fs = require('fs');
const { chromium } = require('playwright');
const readline = require('readline-sync');
const { loginYLlegarARoles, seleccionarRolYEntrar, obtenerNavegador, validarYCambiarAsociacion } = require('../servicios/autenticacion');
const { leerJardines, encontrarMejorAsociacionYJardin } = require('../servicios/excel-reader');
const { parsearFecha, llenarFormularioNutricion } = require('../servicios/nutricion');
const { parsearExcel, resolverRutaConEspeciales } = require('../servicios/excel-parser');

const c = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
  rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
  gris:     (t) => `\x1b[90m${t}\x1b[0m`,
  negrita:  (t) => `\x1b[1m${t}\x1b[0m`,
};

function generarReporteExcel(ninosProcesados, udsNombre, asociacionNombre) {
    if (!ninosProcesados || ninosProcesados.length === 0) return null;

    const rootReportesDir = path.join(__dirname, '..', 'reportes');
    const docsReportesDir = path.join(__dirname, '..', 'Docs', 'reportes');

    if (!fs.existsSync(rootReportesDir)) fs.mkdirSync(rootReportesDir, { recursive: true });
    if (!fs.existsSync(docsReportesDir)) fs.mkdirSync(docsReportesDir, { recursive: true });

    const now = new Date();
    const fechaHoy = now.toISOString().slice(0, 10);
    const horaHoy = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    const safeUds = (udsNombre || 'UDS').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 25);
    const fileName = `Reporte_PesoTalla_${safeUds}_${fechaHoy}_${horaHoy}.xlsx`;

    const rootFilePath = path.join(rootReportesDir, fileName);
    const docsFilePath = path.join(docsReportesDir, fileName);

    const rows = ninosProcesados.map((item, index) => ({
        '#': index + 1,
        'Documento': item.documento || '',
        'Nombre Completo': item.nombreCompleto || '',
        'Fecha Toma': item.fecha || '',
        'Peso (kg)': item.peso || '',
        'Talla (cm)': item.talla || '',
        'PB (cm)': item.perimetro || '',
        'Estado': item.estado || 'PENDIENTE',
        'Detalle / Observación': item.observacion || ''
    }));

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(rows);

    ws['!cols'] = [
        { wch: 5 },  // #
        { wch: 15 }, // Documento
        { wch: 35 }, // Nombre Completo
        { wch: 14 }, // Fecha Toma
        { wch: 10 }, // Peso
        { wch: 10 }, // Talla
        { wch: 10 }, // PB
        { wch: 25 }, // Estado
        { wch: 55 }  // Observación
    ];

    xlsx.utils.book_append_sheet(wb, ws, 'Resultados Procesamiento');
    xlsx.writeFile(wb, rootFilePath);
    xlsx.writeFile(wb, docsFilePath);

    // Abrir automáticamente el Explorador de Windows destacando el archivo del reporte
    try {
        require('child_process').exec(`explorer.exe /select,"${rootFilePath}"`);
    } catch (e) {}

    let exitosos = 0;
    let duplicados = 0;
    let noEncontrados = 0;

    ninosProcesados.forEach(item => {
        if (item.estado.includes('EXITOSO') || item.estado.includes('GUARDADO')) exitosos++;
        else if (item.estado.includes('DUPLICADO')) duplicados++;
        else noEncontrados++;
    });

    console.log(c.verde('\n========================================================================================'));
    console.log(c.verde('  📊 RESUMEN FINAL DEL PROCESAMIENTO MASIVO:'));
    console.log(c.verde('========================================================================================'));
    console.log(c.verde(`  ✅ Cargados exitosamente: ${exitosos}`));
    console.log(c.amarillo(`  ⚠️ Omitidos (Toma ya existente): ${duplicados}`));
    if (noEncontrados > 0) {
        console.log(c.rojo(`  ❌ No encontrados / Con error: ${noEncontrados}`));
    }
    console.log(c.cyan(`\n  📄 Reporte Excel generado exitosamente en:`));
    console.log(c.negrita(`     "${rootFilePath}"`));
    console.log(c.verde('========================================================================================\n'));

    return rootFilePath;
}

function removeAccents(str) {
    if (!str) return '';
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}

async function buscarYCambiarPaginaGrilla(content, page, targetDocOrName) {
    if (!targetDocOrName) return null;
    
    let targetDoc = '';
    let targetNombre = '';
    let targetApellidos = '';
    
    if (typeof targetDocOrName === 'object') {
        targetDoc = targetDocOrName.documento || '';
        targetNombre = targetDocOrName.nombreCompleto || '';
        targetApellidos = targetDocOrName.apellidos || '';
    } else {
        targetDoc = String(targetDocOrName).trim();
        targetNombre = String(targetDocOrName).trim();
    }

    let paginasProbadas = new Set([1]);

    while (true) {
        // Buscar enlaces de paginación en la tabla de Cuéntame
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
            return null; // Se recorrieron todas las páginas disponibles y no estuvo
        }

        paginasProbadas.add(numSiguiente);
        console.log(c.amarillo(`  🔍 El beneficiario no está en la página 1. Buscando en la página ${numSiguiente} de la grilla de Cuéntame...`));

        try {
            await Promise.all([
                content.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
                linkSiguiente.evaluate(node => node.click())
            ]);
            await page.waitForTimeout(1500);
        } catch(e) {
            return null;
        }

        // Re-extraer las filas de la tabla de la nueva página
        const filas = content.locator('tr:has(input[src*="info.jpg"], input[id*="btnInfo"])');
        const count = await filas.count();

        for (let i = 0; i < count; i++) {
            const fila = filas.nth(i);
            const celdas = fila.locator(':scope > td');
            const numCeldas = await celdas.count();

            if (numCeldas < 5 || numCeldas > 15) continue;

            const textoCeldas = await celdas.allInnerTexts();
            const datos = textoCeldas.map(t => t.trim()).filter(t => t.length > 0);

            if (datos.length >= 4) {
                const documento = datos[1] || "N/A";
                const nombreCompleto = datos.slice(2, -2).join(' ');
                const tomas = datos[datos.length - 2] || "N/A";

                let isMatch = false;

                // 1. Match por documento
                if (targetDoc && documento.includes(targetDoc)) isMatch = true;

                // 2. Match por nombre exacto o contenido
                if (!isMatch && targetNombre && removeAccents(nombreCompleto).includes(removeAccents(targetNombre))) isMatch = true;
                if (!isMatch && targetNombre && removeAccents(targetNombre).includes(removeAccents(nombreCompleto))) isMatch = true;

                // 3. Match por apellidos
                if (!isMatch && targetApellidos && targetApellidos.length >= 4 && removeAccents(nombreCompleto).includes(removeAccents(targetApellidos))) isMatch = true;

                // 4. Match por similitud Fuzzy (Levenshtein >= 0.78)
                if (!isMatch && targetNombre && calcularSimilitudTexto(nombreCompleto, targetNombre) >= 0.78) isMatch = true;

                if (isMatch) {
                    console.log(c.verde(`  ✅ ¡Beneficiario encontrado en la página ${numSiguiente}!: ${nombreCompleto}`));
                    return {
                        documento,
                        nombreCompleto,
                        tomas,
                        locator: fila.locator('input[type="image"][src*="info.jpg"], input[id*="btnInfo"]').first()
                    };
                }
            }
        }
    }
}

function normalizarFecha(str) {
    if (!str) return '';
    const parts = str.trim().split(/[\/-]/);
    if (parts.length === 3) {
        let d = parts[0].padStart(2, '0');
        let m = parts[1].padStart(2, '0');
        let y = parts[2];
        if (d.length === 4) { // YYYY-MM-DD
            y = parts[0];
            m = parts[1].padStart(2, '0');
            d = parts[2].padStart(2, '0');
        }
        return `${d}/${m}/${y}`;
    }
    return str.trim();
}

function calcularSimilitudTexto(str1, str2) {
    if (!str1 || !str2) return 0;
    const s1 = removeAccents(str1).toUpperCase();
    const s2 = removeAccents(str2).toUpperCase();
    if (s1 === s2) return 1.0;
    if (s1.includes(s2) || s2.includes(s1)) return 0.9;

    const len1 = s1.length;
    const len2 = s2.length;
    const matrix = Array.from({ length: len1 + 1 }, () => Array(len2 + 1).fill(0));

    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;

    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    const dist = matrix[len1][len2];
    const maxLen = Math.max(len1, len2);
    return 1 - (dist / maxLen);
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

    // 1. PASO 1: CONFIRMAR PRIMERO POR DOCUMENTO (Normalized Document Match)
    const docTargetNorm = normalizarDoc(ninoTarget.documento);
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
    const infoNombre = extraerNombresYApellidos(ninoTarget.nombreCompleto);
    const nombresTarget = ninoTarget.nombres ? removeAccents(ninoTarget.nombres).toUpperCase() : infoNombre.nombres;
    const apellidosTarget = ninoTarget.apellidos ? removeAccents(ninoTarget.apellidos).toUpperCase() : infoNombre.apellidos;

    const tokensApellidos = apellidosTarget.split(/\s+/).filter(t => t.length > 1);

    // 2. PASO 2: CONFIRMAR DESPUÉS POR APELLIDOS (Match by Last Names)
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

    // Fallback: Probar coincidencia por primer apellido
    if (tokensApellidos.length > 0) {
        const primerApellido = tokensApellidos[0];
        const candidatosPrimerApe = listaNinos.filter(n => removeAccents(n.nombreCompleto).toUpperCase().includes(primerApellido));

        if (candidatosPrimerApe.length === 1) {
            return { nino: candidatosPrimerApe[0], metodo: 'PRIMER_APELLIDO' };
        } else if (candidatosPrimerApe.length > 1) {
            const tokensNombres = nombresTarget.split(/\s+/).filter(t => t.length > 1);
            const candidatoPorNombre = candidatosPrimerApe.find(n => {
                const nombreCuentame = removeAccents(n.nombreCompleto).toUpperCase();
                return tokensNombres.some(nom => nombreCuentame.includes(nom));
            });
            if (candidatoPorNombre) {
                return { nino: candidatoPorNombre, metodo: 'PRIMER_APELLIDO_Y_NOMBRE' };
            }
        }
    }

    return null;
}

async function cargarUdsEnCuentame(page, jardinSeleccionado) {
    if (!jardinSeleccionado || !jardinSeleccionado.codigo) return false;

    let contentFrame = page.frame({ name: 'frameContent' });
    if (!contentFrame) {
        for (const f of page.frames()) {
            if (f.name() === 'frameContent') {
                contentFrame = f;
                break;
            }
        }
    }
    const rootContent = contentFrame || page;

    console.log(c.cyan(`  🔍 Cargando UDS en Cuéntame: ${jardinSeleccionado.nombre} (Código: ${jardinSeleccionado.codigo})...`));

    let lupaLocator = rootContent.locator('input[id*="cphCont_btnFiltrar"], input[name*="btnFiltrar"], input[src*="lupa"]').first();

    if (await lupaLocator.count() === 0) {
        const rootMenu = page.frame({ name: 'frameMenu' }) || page;
        const childMenu = rootMenu.locator('a:has-text("Seguimiento nutricional")').first();
        if (await childMenu.count() > 0) {
            await childMenu.evaluate(node => node.click());
            await page.waitForTimeout(3000);
        }
        let updatedFrame = page.frame({ name: 'frameContent' }) || page;
        lupaLocator = updatedFrame.locator('input[id*="cphCont_btnFiltrar"], input[name*="btnFiltrar"], input[src*="lupa"]').first();
    }

    if (await lupaLocator.count() === 0) {
        console.log(c.rojo('  ❌ No se encontró la lupa de UDS para recargar.'));
        return false;
    }

    const [popup] = await Promise.all([
        page.waitForEvent('popup'),
        lupaLocator.evaluate(node => node.click())
    ]);

    await popup.waitForLoadState('networkidle');
    console.log(c.verde('  ✅ Ventana emergente Lupa abierta.'));

    console.log(c.cyan(`  📝 Ingresando código de UDS: ${jardinSeleccionado.codigo}...`));
    await popup.locator('input[id*="txtCodigoUnidadServicio"], input[name*="CodigoUnidadServicio"]').first().fill(String(jardinSeleccionado.codigo));

    let ddlDepto = popup.locator('select[id*="ddlDepartamento"], select[name*="ddlDepartamento"]').first();
    if (await ddlDepto.count() === 0) {
        const tdLabel = popup.locator('td:has-text("Departamento")').last();
        ddlDepto = tdLabel.locator('xpath=following-sibling::td//select').first();
        if (await ddlDepto.count() === 0) ddlDepto = popup.locator('select').nth(1);
    }

    try {
        await ddlDepto.selectOption({ label: /BOGOT. D\.C\./i });
        console.log(c.verde('    ✅ Departamento BOGOTA D.C. seleccionado.'));
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
        await btnInfo.waitFor({ state: 'visible', timeout: 15000 });
        console.log(c.verde('  ✅ Resultado de UDS encontrado. Seleccionando...'));
        await btnInfo.click();
    } catch (err) {
        console.log(c.rojo(`  ❌ Error: No se encontraron resultados en el popup para la UDS ${jardinSeleccionado.nombre}.`));
    }

    try {
        await popup.waitForEvent('close', { timeout: 10000 });
    } catch (e) {}

    await page.waitForTimeout(3000);
    return true;
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

  // Cargar datos
  const RUTA_EXCEL = process.env.RUTA_EXCEL || 'C:\\GENERAL.xlsx';
  const { porAsociacion } = leerJardines(RUTA_EXCEL);
  const asociaciones = Object.values(porAsociacion);

  if (asociaciones.length === 0) {
    console.log(c.rojo('❌ No se encontraron asociaciones en el Excel.'));
    return;
  }

  console.log(c.cyan('\n======================================================'));
  console.log(c.cyan('   ⚖️  REGISTRO DE PESO Y TALLA (FASE 1)'));
  console.log(c.cyan('======================================================\n'));

  let browser = null;
  let context = null;
  let page = null;
  let loggedIn = false;

  let ascSeleccionada = null;
  let jardinSeleccionado = null;
  let salirModulo = false;

  try {
    while (true) {
      if (salirModulo) break;
      
      let preFiltroBeneficiario = null;
      let accionRapida = null;
      let modoExcel = null;
      let ninosExcel = [];
      let ninosProcesados = [];
      let idxNinoExcelActual = 0;
      let listaArchivosPendientes = [];
      let idxArchivoActual = 0;

      ascSeleccionada = null;
      jardinSeleccionado = null;
      ninosExcel = [];
      ninosProcesados = [];
      listaArchivosPendientes = [];
      idxArchivoActual = 0;
      modoExcel = null;

      console.log(c.cyan('\n======================================================'));
      console.log(c.cyan('   ⚖️  REGISTRO DE PESO Y TALLA'));
      console.log(c.cyan('======================================================\n'));
      console.log('  1. Cargar excel jardin (Procesamiento masivo / Automático)');
      console.log('  2. Cargar beneficiario con excel (Individual)');
      console.log('  3. Cargar beneficiario sin excel (Manual)');
      console.log('  4. Corregir/Editar masivo con Excel');
      console.log(c.rojo('  0. Volver al panel principal (AutoTrabajo / Start)'));
      
      let respBenef = '';
      while (!['0', '1', '2', '3', '4'].includes(respBenef.trim())) {
          respBenef = readline.question(c.negrita('\n  > Selecciona una opcion (0-4): '));
      }

      if (respBenef.trim() === '0') {
          console.log(c.verde('\n  👋 Volviendo al panel principal (AutoTrabajo)...\n'));
          break;
      }
      
      const obtenerRutasExcelMultiples = () => {
          const docsDir = require('path').join(__dirname, '..', 'Docs', 'peso y talla');
          let archivosDocs = [];
          if (require('fs').existsSync(docsDir)) {
              archivosDocs = require('fs').readdirSync(docsDir).filter(f => !f.startsWith('~') && (f.endsWith('.xlsx') || f.endsWith('.xls') || f.endsWith('.csv')));
          }
          if (archivosDocs.length > 0) {
              console.log(c.cyan('\n  Archivos Excel encontrados en "Docs/peso y talla":'));
              archivosDocs.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
          }

          console.log(c.cyan('\n  📥 SELECCIÓN Y MULTI-CARGA DE ARCHIVOS EXCEL:'));
          console.log(c.gris('     • Presiona ENTER (o escribe 0) para procesar TODOS los archivos de "Docs/peso y talla".'));
          console.log(c.gris('     • O escribe el número o lista de números (ej: 1, 3 o solo 2).'));
          console.log(c.gris('     • O arrastra UNO o VARIOS archivos / CARPETA directamente a esta consola.\n'));

          const inputRaw = readline.question(c.negrita('  > Ingresa tu opción o arrastra los archivos aqui [0 = Todos]: ')).trim();
          
          if (archivosDocs.length > 0) {
              if (!inputRaw || inputRaw === '0' || inputRaw.toUpperCase() === 'TODOS') {
                  console.log(c.verde(`  ✅ Seleccionados TODOS los ${archivosDocs.length} archivos de "Docs/peso y talla".`));
                  return archivosDocs.map(a => path.join(docsDir, a));
              }

              const partesNumericas = inputRaw.split(/[,;\s]+/).map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
              const indicesValidos = partesNumericas.filter(n => n >= 1 && n <= archivosDocs.length);

              if (indicesValidos.length > 0 && indicesValidos.length === partesNumericas.length) {
                  const setIndices = Array.from(new Set(indicesValidos));
                  const seleccionados = setIndices.map(idx => path.join(docsDir, archivosDocs[idx - 1]));
                  console.log(c.verde(`  ✅ Seleccionados ${seleccionados.length} archivo(s) especifico(s).`));
                  return seleccionados;
              }
          }

          if (!inputRaw) return [];

          const regexRutas = /"([^"]+)"|'([^']+)'|(\S+\.(?:xlsx|xls|csv))/gi;
          let rutasEncontradas = [];
          let match;

          while ((match = regexRutas.exec(inputRaw)) !== null) {
              const r = match[1] || match[2] || match[3];
              if (r && r.trim()) {
                  rutasEncontradas.push(r.trim());
              }
          }

          if (rutasEncontradas.length === 0 && inputRaw) {
              rutasEncontradas = [inputRaw.replace(/['"]/g, '').trim()];
          }

          const rutasValidadas = [];
          for (const r of rutasEncontradas) {
              const resolved = resolverRutaConEspeciales(r);
              if (fs.existsSync(resolved)) {
                  const stat = fs.statSync(resolved);
                  if (stat.isDirectory()) {
                      console.log(c.cyan(`\n  📁 Carpeta detectada: "${path.basename(resolved)}"`));
                      const enCarpeta = fs.readdirSync(resolved)
                          .filter(f => !f.startsWith('~') && (f.endsWith('.xlsx') || f.endsWith('.xls')))
                          .map(f => path.join(resolved, f));
                      console.log(c.verde(`     ✅ Encontrados ${enCarpeta.length} archivos Excel en la carpeta.`));
                      rutasValidadas.push(...enCarpeta);
                  } else if (stat.isFile() && !path.basename(resolved).startsWith('~') && (resolved.endsWith('.xlsx') || resolved.endsWith('.xls'))) {
                      rutasValidadas.push(resolved);
                  }
              } else {
                  console.log(c.amarillo(`  ⚠️ No se encontró la ruta: ${r}`));
              }
          }

          return Array.from(new Set(rutasValidadas));
      };
      
      if (respBenef.trim() === '1' || respBenef.trim() === '4') {
          const accionMsj = respBenef.trim() === '1' ? 'Crear Nuevas Tomas' : 'Corregir/Editar Tomas Existentes';
          console.log(c.amarillo(`\n  Has seleccionado Procesamiento Masivo (${accionMsj}).`));
          
          let listaArchivos = obtenerRutasExcelMultiples();
          while (listaArchivos.length === 0) {
              const reintento = readline.question(c.negrita('  > No se encontraron archivos válidos. Arrastra los archivos/carpeta nuevamente (ENTER para cancelar): ')).trim();
              if (!reintento) break;
              listaArchivos = obtenerRutasExcelMultiples();
          }

          if (listaArchivos.length === 0) continue;

          listaArchivosPendientes = listaArchivos;
          idxArchivoActual = 0;

          const fileP = listaArchivosPendientes[idxArchivoActual];
          console.log(c.verde(`\n  🚀 MULTI-PROCESAMIENTO: ${listaArchivosPendientes.length} archivo(s) Excel cargado(s) para procesar:`));
          listaArchivosPendientes.forEach((f, idx) => console.log(c.gris(`     ${idx + 1}. ${path.basename(f)}`)));

          try {
              const parseResult = parsearExcel(fileP);
              ninosExcel = parseResult.ninos;
              if (ninosExcel.length === 0) {
                  console.log(c.rojo(`  ❌ No se encontraron niños válidos en el primer Excel (${path.basename(fileP)}).`));
                  continue;
              }
              console.log(c.verde(`\n  📄 [1/${listaArchivosPendientes.length}] Leyendo Excel: ${path.basename(fileP)}`));
              console.log(c.verde(`  ✅ Excel cargado exitosamente. Detectado -> Asociación: ${parseResult.asociacion} | UDS: ${parseResult.uds}`));
              
              const match = encontrarMejorAsociacionYJardin(asociaciones, parseResult.asociacion, parseResult.uds);
              ascSeleccionada = match.ascSeleccionada;
              jardinSeleccionado = match.jardinSeleccionado;

              if (!ascSeleccionada) {
                  console.log(c.amarillo(`  ⚠️ No se encontró la Asociación automáticamente. Se pedirá selección manual.`));
              } else if (!jardinSeleccionado) {
                  console.log(c.amarillo(`  ⚠️ No se encontró la UDS automáticamente. Se pedirá selección manual.`));
              }

              console.log(c.verde(`  ✅ Se encontraron ${ninosExcel.length} niños listos para procesar.`));
              modoExcel = respBenef.trim() === '1' ? 'MASIVO_NUEVO' : 'MASIVO_EDITAR';
          } catch(e) {
              console.log(c.rojo(`  ❌ Error leyendo Excel: ${e.message}`));
              continue;
          }
      } else if (respBenef.trim() === '2') {
          const rutas = obtenerRutasExcelMultiples();
          const fileP = rutas.length > 0 ? rutas[0] : null;
          if (!fileP) continue;
          preFiltroBeneficiario = readline.question(c.negrita('\n  > Ingresa el/los nombre(s) o documento(s) (separados por coma, ej. LIAM,NICOLAS): ')).trim().toLowerCase();
          if (preFiltroBeneficiario) {
              try {
                  const parseResult = parsearExcel(fileP);
                  const busquedas = preFiltroBeneficiario.split(',').map(b => b.trim()).filter(b => b);
                  const filtrados = [];
                  
                  for (let b of busquedas) {
                      const coincidencia = parseResult.ninos.find(n => n.documento.includes(b) || n.nombreCompleto.toLowerCase().includes(b));
                      if (coincidencia) {
                          if (!filtrados.some(f => f.documento === coincidencia.documento)) {
                              filtrados.push(coincidencia);
                          }
                      } else {
                          console.log(c.amarillo(`  ⚠️ No se encontró ningún beneficiario para: "${b}"`));
                      }
                  }

                  if (filtrados.length > 0) {
                      ninosExcel = filtrados;
                      console.log(c.verde(`  ✅ Beneficiarios encontrados en Excel (${filtrados.length}):`));
                      filtrados.forEach((f, idx) => console.log(c.verde(`      ${idx+1}. ${f.nombreCompleto}`)));
                      modoExcel = 'INDIVIDUAL_EXCEL';
                      accionRapida = '1';
                      
                      const matchIndiv = encontrarMejorAsociacionYJardin(asociaciones, parseResult.asociacion, parseResult.uds);
                      ascSeleccionada = matchIndiv.ascSeleccionada;
                      jardinSeleccionado = matchIndiv.jardinSeleccionado;
                  } else {
                      console.log(c.rojo(`  ❌ No se encontró ninguno de los beneficiarios ingresados.`));
                      continue;
                  }
              } catch(e) {
                  console.log(c.rojo(`  ❌ Error leyendo Excel: ${e.message}`));
                  continue;
              }
          }
      }

      if (!ascSeleccionada) {
          console.log(c.cyan('\n------------------------------------------------------'));
          console.log(c.cyan('  📋 SELECCION DE ASOCIACION'));
          console.log(c.cyan('------------------------------------------------------'));
          asociaciones.forEach((asc, i) => console.log(`  ${i + 1}. ${asc.nombreCorto}`));
          console.log(`  0. Salir`);

          let idxAsociacion = -1;
          while (idxAsociacion < 0 || idxAsociacion > asociaciones.length) {
              const res = readline.question(c.negrita('\n  > Selecciona la asociacion (0 para salir): '));
              idxAsociacion = parseInt(res, 10);
              if (isNaN(idxAsociacion)) idxAsociacion = -1;
          }

          if (idxAsociacion === 0) {
              console.log(c.verde('\n  👋 Volviendo al panel principal...'));
              break;
          }
          ascSeleccionada = asociaciones[idxAsociacion - 1];
      } else {
          console.log(c.verde(`  ✅ Asociación seleccionada: ${ascSeleccionada.nombreCorto}`));
      }

      if (!jardinSeleccionado) {
          const jardines = ascSeleccionada.jardines;
          if (!jardines || jardines.length === 0) {
              console.log(c.rojo(`  ❌ No hay jardines (UDS) configurados para esta asociacion en el Excel.`));
              continue;
          }

          console.log(c.cyan('\n------------------------------------------------------'));
          console.log(c.cyan(`  📋 SELECCION DE JARDIN (UDS) - ${ascSeleccionada.nombreCorto}`));
          console.log(c.cyan('------------------------------------------------------'));
          jardines.forEach((jardin, i) => console.log(`  ${i + 1}. ${jardin.codigo} - ${jardin.nombre}`));
          console.log(`  0. Volver al menu principal`);

          let idxJardin = -1;
          while (idxJardin < 0 || idxJardin > jardines.length) {
              const res = readline.question(c.negrita('\n  > Selecciona el Jardin (0 para volver): '));
              idxJardin = parseInt(res, 10);
              if (isNaN(idxJardin)) idxJardin = -1;
          }

          if (idxJardin === 0) {
              continue;
          }
          jardinSeleccionado = jardines[idxJardin - 1];
      } else {
          console.log(c.verde(`  ✅ Jardín (UDS) seleccionado: ${jardinSeleccionado.nombre}`));
      }
      
      if (respBenef.trim() === '3') {
          preFiltroBeneficiario = readline.question(c.negrita('\n  > Ingresa el nombre o documento (ej. LIAM) (Vacio para omitir): ')).trim().toLowerCase();
          if (preFiltroBeneficiario) {
              console.log(c.amarillo('  ¿Que deseas hacer con este beneficiario?'));
              console.log('  1. Agregar una NUEVA toma (+)');
              console.log('  2. EDITAR una toma existente');
              const respAccion = readline.question(c.negrita('  > Selecciona (1 o 2): '));
              if (respAccion.trim() === '1' || respAccion.trim() === '2') {
                  accionRapida = respAccion.trim();
                  console.log(c.verde('  ✅ Perfecto, seleccionare automaticamente al niño en la grilla.'));
              } else {
                  preFiltroBeneficiario = null;
              }
          }
      }

      // Lanzar navegador e iniciar sesión SOLO si no se ha hecho
      if (!browser) {
          console.log(c.cyan('\n  🌐 Inicializando entorno de navegador...\n'));
          const navData = await obtenerNavegador();
          browser = navData.browser;
          context = navData.context;
          page = navData.page;
      }

      // Validar si la sesión activa pertenece a la asociación elegida
      const mismaAsociacion = await validarYCambiarAsociacion(page, ascSeleccionada);
      
      if (!mismaAsociacion) {
          console.log(c.amarillo('  🔐 Verificando inicio de sesión en Cuéntame...'));
          await loginYLlegarARoles(page, {
            usuario: USUARIO,
            password: PASSWORD,
            gmailUser: GMAIL_USER,
            gmailAppPassword: GMAIL_APP_PASSWORD
          });
          loggedIn = true;
          console.log(c.amarillo(`  🏢 Entrando con la asociacion ${ascSeleccionada.nombreCorto}...`));
          await seleccionarRolYEntrar(page, ascSeleccionada);
          console.log(c.amarillo('  ⏳ Esperando a que cargue el menú de Cuéntame...'));
          await page.waitForTimeout(3000); 
      } else {
          console.log(c.verde(`  ✅ Preservando sesión y asociación activa: "${ascSeleccionada.nombreCorto}".`));
          loggedIn = true;
      } 
      
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
      
      console.log(c.cyan('\n  🚀 Navegando al modulo de Seguimiento nutricional...'));
      try {
          // 1. Ejecutar evaluador DOM dentro del marco de menú (frameMenu) para buscar enlaces <a>
          let result = await rootMenu.evaluate(() => {
              const links = Array.from(document.querySelectorAll('a'));
              
              // Si "Seguimiento nutricional" ya está visible en el menú, hacerle clic directamente
              const target = links.find(a => a.innerText && a.innerText.toLowerCase().includes('seguimiento nutricional'));
              if (target) {
                  target.click();
                  return 'TARGET_CLICKED';
              }

              // Si no, buscar el enlace exacto "Rub online" (el <a> que tiene la flechita > Rub online)
              const rubLink = links.find(a => a.innerText && a.innerText.trim().toLowerCase().includes('rub online'));
              if (rubLink) {
                  rubLink.click();
                  return 'RUB_EXPANDED';
              }
              return 'NOT_FOUND';
          }).catch(() => 'ERROR');

          console.log(c.gris(`  ℹ️ Estado del menú: ${result}`));

          if (result === 'RUB_EXPANDED') {
              await page.waitForTimeout(1500); // Esperar a que el sub-menú se expanda
              // Ahora hacer clic en "Seguimiento nutricional"
              await rootMenu.evaluate(() => {
                  const links = Array.from(document.querySelectorAll('a'));
                  const target = links.find(a => a.innerText && a.innerText.toLowerCase().includes('seguimiento nutricional'));
                  if (target) target.click();
              }).catch(() => {});
          }
          
          await page.waitForTimeout(3000);
          console.log(c.verde('  ✅ Clic en "Seguimiento nutricional" enviado.'));
      } catch (err) {
          console.log(c.rojo(`  ❌ Error al intentar acceder a Seguimiento nutricional: ${err.message}`));
      }

      let contentFrame = page.frame({ name: 'frameContent' });
      if (!contentFrame) {
          for (const f of page.frames()) {
              if (f.name() === 'frameContent') {
                  contentFrame = f;
                  break;
              }
          }
      }
      const rootContent = contentFrame || page;

      await cargarUdsEnCuentame(page, jardinSeleccionado);
      
      // =========================================================================
      // FASE 2: SELECCION DE NINO EN LA GRILLA
      // =========================================================================
      
      // Esperamos a que la grilla de ninos termine de cargar en la pagina principal
      await page.waitForTimeout(2500);
      
      // Refrescar rootContent
      let currentContentFrame = page.frame({ name: 'frameContent' });
      if (!currentContentFrame) {
          for (const f of page.frames()) {
              if (f.name() === 'frameContent') {
                  currentContentFrame = f;
                  break;
              }
          }
      }
      const content = currentContentFrame || page;

      idxNinoExcelActual = 0;
      let consecutivosDuplicados = 0;
      ninosProcesados = [];

      while (true) {
          console.log(c.cyan('\n------------------------------------------------------'));
          console.log(c.cyan('  📋 SELECCION DE BENEFICIARIO (NINO)'));
          console.log(c.cyan('------------------------------------------------------'));
          
          console.log(c.amarillo('  ⏳ Extrayendo lista de ninos de la tabla...'));
          
          // Extraer las filas de la tabla de ninos
          // Normalmente es una tabla con clase o id especifico. Buscamos filas que tengan el boton azul
          const filas = content.locator('tr:has(input[src*="info.jpg"], input[id*="btnInfo"])');
          const count = await filas.count();
          
          if (count === 0) {
              console.log(c.rojo('  ❌ No se encontraron ninos listados para esta UDS.'));
              break;
          }

          let listaNinos = [];
          for (let i = 0; i < count; i++) {
              const fila = filas.nth(i);
              // Solo tomar los <td> que son hijos directos de esta fila (evita tablas anidadas)
              const celdas = fila.locator(':scope > td');
              const numCeldas = await celdas.count();
              
              // Una fila normal de niños tiene unas 8-10 columnas. Ignoramos filas contenedoras.
              if (numCeldas < 5 || numCeldas > 15) {
                  continue;
              }

              const textoCeldas = await celdas.allInnerTexts();
              const datos = textoCeldas.map(t => t.trim()).filter(t => t.length > 0);
              
              if (datos.length >= 4) {
                  documento = datos[1] || "N/A";
                  nombreCompleto = datos.slice(2, -2).join(' ');
                  tomas = datos[datos.length - 2] || "N/A";
              }

              listaNinos.push({
                  index: listaNinos.length,
                  documento,
                  nombreCompleto,
                  tomas,
                  locator: fila.locator('input[type="image"][src*="info.jpg"], input[id*="btnInfo"]').first()
              });
          }


    await page.waitForTimeout(3000);
    return true;
}

          console.log(c.verde(`  ✅ Se encontraron ${listaNinos.length} ninos en la UDS.`));
          
          if (modoExcel && modoExcel.startsWith('MASIVO_')) {
              if (idxNinoExcelActual >= ninosExcel.length) {
                  generarReporteExcel(ninosProcesados, jardinSeleccionado ? jardinSeleccionado.nombre : '', ascSeleccionada ? ascSeleccionada.nombreCorto : '');

                  // Si hay más archivos en la lista pendiente de multi-carga, avanzar automáticamente al siguiente jardín
                  if (listaArchivosPendientes && idxArchivoActual < listaArchivosPendientes.length - 1) {
                      idxArchivoActual++;
                      const proximoFile = listaArchivosPendientes[idxArchivoActual];
                      console.log(c.verde('\n========================================================================================'));
                      console.log(c.verde(`  🎉 JARDÍN PROCESADO EXITOSAMENTE. AVANZANDO AUTOMÁTICAMENTE AL ARCHIVO ${idxArchivoActual + 1} DE ${listaArchivosPendientes.length}:`));
                      console.log(c.verde(`  📄 ${path.basename(proximoFile)}`));
                      console.log(c.verde('========================================================================================\n'));

                      try {
                          const parseResult = parsearExcel(proximoFile);
                          ninosExcel = parseResult.ninos;
                          console.log(c.verde(`  ✅ Excel cargado exitosamente (${ninosExcel.length} niños). Detectado -> Asociación: ${parseResult.asociacion} | UDS: ${parseResult.uds}`));

                          const match = encontrarMejorAsociacionYJardin(asociaciones, parseResult.asociacion, parseResult.uds);

                          if (match.ascSeleccionada && ascSeleccionada && match.ascSeleccionada.nombreCorto !== ascSeleccionada.nombreCorto) {
                              ascSeleccionada = match.ascSeleccionada;
                              console.log(c.amarillo(`  🏢 Cambiando de Asociación a: ${ascSeleccionada.nombreCorto}...`));
                              await seleccionarRolYEntrar(page, ascSeleccionada);
                              await page.waitForTimeout(3000);
                              const rootMenu = page.frame({ name: 'frameMenu' }) || page;
                              const childMenu = rootMenu.locator('a:has-text("Seguimiento nutricional")').first();
                              if (await childMenu.count() > 0) {
                                  await childMenu.evaluate(node => node.click());
                                  await page.waitForTimeout(3000);
                              }
                          }

                          ascSeleccionada = match.ascSeleccionada || ascSeleccionada;
                          jardinSeleccionado = match.jardinSeleccionado;

                          idxNinoExcelActual = 0;
                          consecutivosDuplicados = 0;
                          ninosProcesados = [];

                          if (jardinSeleccionado) {
                              console.log(c.cyan(`  🔄 Cambiando la UDS en Cuéntame al nuevo Jardín: ${jardinSeleccionado.nombre} (Código: ${jardinSeleccionado.codigo})...`));
                              await cargarUdsEnCuentame(page, jardinSeleccionado);
                          } else {
                              console.log(c.amarillo(`  ⚠️ No se pudo emparejar la UDS automáticamente. Se mantendrá la actual.`));
                          }

                          continue; // Continúa la ejecución del loop procesando los niños del NUEVO Jardín
                      } catch(e) {
                          console.log(c.rojo(`  ❌ Error leyendo el siguiente Excel (${path.basename(proximoFile)}): ${e.message}`));
                      }
                  }

                  const numTotalArchivos = listaArchivosPendientes ? listaArchivosPendientes.length : 1;
                  console.log(c.verde('\n========================================================================================'));
                  console.log(c.verde(`  🎉 ¡MULTI-PROCESAMIENTO COMPLETADO EXITOSAMENTE PARA LOS ${numTotalArchivos} ARCHIVO(S) EXCEL!`));
                  console.log(c.verde('========================================================================================'));

                  console.log(c.cyan('\n  ╔════════════════════════════════════════════════════════════════════╗'));
                  console.log(c.cyan('  ║                ¿Qué deseas hacer a continuación?                   ║'));
                  console.log(c.cyan('  ╠════════════════════════════════════════════════════════════════════╣'));
                  console.log(c.cyan('  ║  1. Cargar más archivos Excel / carpetas                           ║'));
                  console.log(c.cyan('  ║  2. Cambiar de Jardín (UDS)                                        ║'));
                  console.log(c.cyan('  ║  3. Cambiar de Asociación                                          ║'));
                  console.log(c.cyan('  ║  4. Volver al menú de opciones de Peso y Talla                     ║'));
                  console.log(c.cyan('  ║  0. Volver al panel principal (AutoTrabajo / Start)               ║'));
                  console.log(c.cyan('  ╚════════════════════════════════════════════════════════════════════╝'));

                  let opt = '';
                  while (!['0', '1', '2', '3', '4'].includes(opt.trim())) {
                      opt = readline.question(c.negrita('  > Selecciona una opción (0-4): ')).trim();
                  }

                  if (opt === '0') {
                      console.log(c.verde('\n  👋 Volviendo al panel principal (AutoTrabajo)...\n'));
                      salirModulo = true;
                      modoExcel = null;
                      break;
                  } else if (opt === '1') {
                      console.log(c.cyan('\n  📂 MULTI-CARGA DE NUEVOS EXCEL'));
                      const rutas = obtenerRutasExcelMultiples();
                      if (rutas.length > 0) {
                          listaArchivosPendientes = rutas;
                          idxArchivoActual = 0;
                          const fileP = listaArchivosPendientes[0];
                          try {
                              const parseResult = parsearExcel(fileP);
                              ninosExcel = parseResult.ninos;
                              if (!ninosExcel || ninosExcel.length === 0) {
                                  console.log(c.rojo('  ❌ No se encontraron niños válidos en el nuevo Excel.'));
                                  modoExcel = null;
                                  break;
                              }
                              console.log(c.verde(`  ✅ Nuevo Excel cargado exitosamente (${ninosExcel.length} niños).`));
                              console.log(c.verde(`  Detectado -> Asociación: ${parseResult.asociacion} | UDS: ${parseResult.uds}`));

                              modoExcel = 'MASIVO_NUEVO';
                              idxNinoExcelActual = 0;
                              consecutivosDuplicados = 0;
                              ninosProcesados = [];

                              const match = encontrarMejorAsociacionYJardin(asociaciones, parseResult.asociacion, parseResult.uds);
                              ascSeleccionada = match.ascSeleccionada;
                              jardinSeleccionado = match.jardinSeleccionado;
                              break;
                          } catch(e) {
                              console.log(c.rojo(`  ❌ Error leyendo el nuevo Excel: ${e.message}`));
                              modoExcel = null;
                              break;
                          }
                      } else {
                          modoExcel = null;
                          break;
                      }
                  } else if (opt === '2') {
                      jardinSeleccionado = null;
                      modoExcel = null;
                      break;
                  } else if (opt === '3') {
                      ascSeleccionada = null;
                      jardinSeleccionado = null;
                      modoExcel = null;
                      break;
                  } else if (opt === '4') {
                      modoExcel = null;
                      jardinSeleccionado = null;
                      break;
                  }
              }

              if (salirModulo) break;
              if (!modoExcel) continue;

              const ninoTarget = ninosExcel[idxNinoExcelActual];
              console.log(c.cyan(`\n  🚀 PROCESANDO NIÑO ${idxNinoExcelActual + 1} de ${ninosExcel.length}: ${ninoTarget.nombreCompleto}`));
              preFiltroBeneficiario = ninoTarget.documento;
              accionRapida = modoExcel === 'MASIVO_NUEVO' ? '1' : '2';
          }

          let input = '';
          if (preFiltroBeneficiario) {
              console.log(c.verde(`  ✨ Autocompletando busqueda con: "${preFiltroBeneficiario}"`));
              input = preFiltroBeneficiario;
          } else {
              console.log(c.amarillo('\n  ¿Sabes como se llama o identifica el beneficiario?'));
              console.log(c.gris('  (Escribe su nombre/documento, o presiona Enter para ver la lista de todos)'));
              console.log(c.amarillo('  [0] Cambiar Jardin (UDS) | [00] Cambiar Asociacion'));
              input = readline.question(c.negrita('  > Buscar / Seleccionar: '));
          }

          if (input.trim() === '0' || input.trim().toLowerCase() === 'consulta') {
              break;
          }
          
          if (input.trim() === '00') {
              idxJardin = 0;
              break;
          }

          let ninoSeleccionado = null;
          
          if (input.trim() === '') {
              listaNinos.forEach((n, idx) => {
                  console.log(`  ${idx + 1}. ${c.cyan(n.documento)} - ${n.nombreCompleto} (Tomas: ${c.amarillo(n.tomas)})`);
              });
              console.log(c.amarillo('\n  [0 o "consulta"] Salir y volver a seleccionar UDS'));
              input = readline.question(c.negrita('  > Ingresa el numero de la lista (ej. 1): '));
              
              if (input.trim() === '0' || input.trim().toLowerCase() === 'consulta') break;
              if (input.trim() === '') continue;
          }
          
          const isNum = /^\d+$/.test(input.trim()) && input.trim().length <= 3;
          const numParsed = parseInt(input.trim(), 10);
          
          if (isNum && !isNaN(numParsed) && numParsed > 0 && numParsed <= listaNinos.length) {
              ninoSeleccionado = listaNinos[numParsed - 1];
          } else {
              const busquedaNorm = normalizarDoc(input);
              const busquedaTexto = removeAccents(input).toUpperCase();

              // Si venimos de Excel, aplicar validación jerárquica estricta:
              // 1. Documento exacto -> 2. Apellidos -> 3. Nombre
              let coincidenciaModoExcel = null;
              if (modoExcel && modoExcel.startsWith('MASIVO_') && ninosExcel[idxNinoExcelActual]) {
                  coincidenciaModoExcel = buscarCoincidenciaSegura(ninosExcel[idxNinoExcelActual], listaNinos);
              }

              if (coincidenciaModoExcel) {
                  ninoSeleccionado = coincidenciaModoExcel.nino;
                  console.log(c.verde(`  ✅ Niño identificado en Cuéntame (por ${coincidenciaModoExcel.metodo}): ${c.cyan(ninoSeleccionado.documento)} - ${ninoSeleccionado.nombreCompleto}`));
              } else {
                  const resultados = listaNinos.filter(n => 
                      (busquedaNorm.length >= 3 && normalizarDoc(n.documento).includes(busquedaNorm)) || 
                      removeAccents(n.nombreCompleto).toUpperCase().includes(busquedaTexto)
                  );
                  
                  if (resultados.length === 1) {
                      ninoSeleccionado = resultados[0];
                  } else if (resultados.length > 1) {
                      if (preFiltroBeneficiario) {
                          console.log(c.amarillo(`  ⚠️ Hay ${resultados.length} coincidencias para la búsqueda automática "${input}".`));
                          preFiltroBeneficiario = null;
                      } else {
                          console.log(c.amarillo(`  ⚠️ Hay ${resultados.length} coincidencias para "${input}":`));
                      }
                      
                      resultados.forEach(n => {
                          console.log(`  ${n.index + 1}. ${c.cyan(n.documento)} - ${n.nombreCompleto}`);
                      });
                      const res = readline.question(c.negrita('  > Ingresa el numero de la lista para seleccionar uno: '));
                      const nP = parseInt(res.trim(), 10);
                      if (!isNaN(nP) && nP > 0 && nP <= listaNinos.length) {
                          ninoSeleccionado = listaNinos[nP - 1];
                      } else {
                          continue;
                      }
                  }
              }
          }

          if (!ninoSeleccionado) {
              // Intentar buscar en páginas 2, 3... de la grilla de Cuéntame por Documento, Apellidos o Similitud Fuzzy
              const targetParaBusqueda = (modoExcel && ninosExcel[idxNinoExcelActual]) ? ninosExcel[idxNinoExcelActual] : input;
              const ninoEnOtraPagina = await buscarYCambiarPaginaGrilla(content, page, targetParaBusqueda);
              if (ninoEnOtraPagina) {
                  ninoSeleccionado = ninoEnOtraPagina;
              }
          }

          if (!ninoSeleccionado) {
              console.log(c.rojo(`  ❌ No se encontró ningún niño que coincida con "${input}" en ninguna de las páginas de la UDS.`));
              preFiltroBeneficiario = null;
              if (modoExcel && modoExcel.startsWith('MASIVO_')) {
                  console.log(c.amarillo('  ⚠️ Saltando al siguiente niño del Excel...'));
                  const ninoTarget = ninosExcel[idxNinoExcelActual];
                  if (ninoTarget) {
                      ninosProcesados.push({
                          ...ninoTarget,
                          estado: '❌ NO ENCONTRADO EN CUÉNTAME',
                          observacion: 'El beneficiario no aparece en ninguna de las páginas de esta UDS en Cuéntame.'
                      });
                  }
                  idxNinoExcelActual++;
              }
              continue;
          }

          try {
              console.log(c.verde(`\n  ✅ Nino seleccionado: ${ninoSeleccionado.nombreCompleto}`));
              console.log(c.gris(`  Accediendo a su formulario de peso y talla...`));
              
              await Promise.all([
                  content.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
                  ninoSeleccionado.locator.evaluate(node => node.click())
              ]);

              console.log(c.verde(`  ✅ Formulario del niño abierto exitosamente.`));
              
              // =========================================================================
              // FASE 3 (Prueba de Navegación): AGREGAR O EDITAR TOMA
              // =========================================================================
              
              while (true) {
                  console.log(c.amarillo('\n  ⏳ Extrayendo historial de tomas del niño...'));
                  await page.waitForTimeout(2500); // Esperar a que cargue la tabla del niño
                  
                  // Localizar la tabla de tomas (Seguimiento nutrición Unidad de servicio Actual)
                  const tablaTomas = content.locator('table:has(tr:has-text("Fecha Toma"))').last();
                  const filasTomas = tablaTomas.locator('tr').filter({ has: content.locator('td') });
                  const numTomas = await filasTomas.count();
                  
                  let listaTomas = [];
                  for (let i = 0; i < numTomas; i++) {
                      const fila = filasTomas.nth(i);
                      const celdas = fila.locator(':scope > td');
                      if (await celdas.count() > 3) {
                          const fechaToma = await celdas.nth(2).innerText().catch(()=>'');
                          const fechaValoracion = await celdas.nth(3).innerText().catch(()=>'');
                          const peso = await celdas.nth(7).innerText().catch(()=>'');
                          const talla = await celdas.nth(8).innerText().catch(()=>'');
                          if (fechaToma.trim()) {
                              listaTomas.push({
                                  index: i,
                                  fechaToma: fechaToma.trim(),
                                  fechaValoracion: fechaValoracion.trim(),
                                  peso: peso.trim(),
                                  talla: talla.trim(),
                                  chkLocator: fila.locator('input[type="checkbox"]').first(),
                                  btnInfoLocator: fila.locator('input[type="image"][src*="info.jpg"], input[id*="btnInfo"]').first()
                              });
                          }
                      }
                  }

                  // ── VERIFICACIÓN DE TOMA DUPLICADA ─────────────────────────
                  if (modoExcel && modoExcel.startsWith('MASIVO_')) {
                      const ninoInfo = ninosExcel[idxNinoExcelActual];
                      const targetFecha = parsearFecha(String(ninoInfo.fecha)).trim();
                      const targetFechaNorm = normalizarFecha(targetFecha);

                      let esDuplicado = false;
                      let fechaExistente = '';

                      for (const t of listaTomas) {
                          const tFechaValNorm = normalizarFecha(t.fechaValoracion || t.fechaToma);
                          const tFechaTomaNorm = normalizarFecha(t.fechaToma);

                          // Cuéntame NO permite 2 tomas para la misma fecha de valoración antropométrica
                          const matchFecha = (tFechaValNorm === targetFechaNorm || tFechaTomaNorm === targetFechaNorm);

                          if (matchFecha) {
                              esDuplicado = true;
                              fechaExistente = tFechaValNorm || tFechaTomaNorm;
                              break;
                          }
                      }

                      if (esDuplicado) {
                          consecutivosDuplicados++;
                          console.log(c.amarillo(`\n  ⚠️ TOMA DUPLICADA DETECTADA para ${ninoSeleccionado.nombreCompleto}:`));
                          console.log(c.amarillo(`     - Fecha: ${targetFechaNorm} (Ya tiene una toma registrada para esta fecha).`));
                          console.log(c.amarillo(`     ➡️ Omitiendo niño (${consecutivosDuplicados} consecutivo(s)).`));

                          if (consecutivosDuplicados >= 3) {
                              console.log(c.rojo('\n  ========================================================================================'));
                              console.log(c.rojo('  ⛔ SE VALIDÓ EN 3 REGISTROS CONSECUTIVOS FECHA, PESO Y TALLA IGUAL (O TOMA DUPLICADA).'));
                              console.log(c.rojo('  ⚠️  FAVOR VALIDAR LOS SIGUIENTES REGISTROS MANUALMENTE.'));
                              console.log(c.rojo('  ========================================================================================\n'));

                              console.log(c.cyan('  ╔════════════════════════════════════════════════════════════════════╗'));
                              console.log(c.cyan('  ║                ¿Qué deseas hacer a continuación?                   ║'));
                              console.log(c.cyan('  ╠════════════════════════════════════════════════════════════════════╣'));
                              if (ascSeleccionada) {
                                  console.log(c.cyan(`  ║  1. Cargar otro Excel de esta misma asociación (${ascSeleccionada.nombreCorto.padEnd(20)}) ║`));
                              } else {
                                  console.log(c.cyan('  ║  1. Cargar otro Excel de esta misma asociación                     ║'));
                              }
                              console.log(c.cyan('  ║  2. Cambiar de Jardín (UDS)                                        ║'));
                              console.log(c.cyan('  ║  3. Cambiar de Asociación                                          ║'));
                              console.log(c.cyan('  ║  0. Volver al menú principal                                       ║'));
                              console.log(c.cyan('  ╚════════════════════════════════════════════════════════════════════╝'));

                              let opt = '';
                              while (!['0', '1', '2', '3'].includes(opt.trim())) {
                                  opt = readline.question(c.negrita('  > Selecciona una opción (0-3): ')).trim();
                              }

                              if (opt === '1') {
                                  console.log(c.cyan('\n  📂 Carga de nuevo Excel para ' + (ascSeleccionada ? ascSeleccionada.nombreCorto : 'la asociación activa')));
                                  const fileP = obtenerRutaExcel();
                                  try {
                                      const parseResult = parsearExcel(fileP);
                                      ninosExcel = parseResult.ninos;
                                      if (!ninosExcel || ninosExcel.length === 0) {
                                          console.log(c.rojo('  ❌ No se encontraron niños válidos en el nuevo Excel.'));
                                          modoExcel = null;
                                      } else {
                                          console.log(c.verde(`  ✅ Nuevo Excel cargado exitosamente (${ninosExcel.length} niños).`));
                                          console.log(c.verde(`  Detectado -> Asociación: ${parseResult.asociacion} | UDS: ${parseResult.uds}`));

                                          modoExcel = 'MASIVO_NUEVO';
                                          idxNinoExcelActual = 0;
                                          consecutivosDuplicados = 0;

                                          if (parseResult.uds && ascSeleccionada) {
                                              const udsStr = parseResult.uds.trim().toUpperCase();
                                              const nuevoJardin = ascSeleccionada.jardines.find(j => udsStr.includes(j.nombre.toUpperCase()) || j.nombre.toUpperCase().includes(udsStr));
                                              if (nuevoJardin) {
                                                  jardinSeleccionado = nuevoJardin;
                                                  console.log(c.verde(`  ✅ Jardín (UDS) seleccionado: ${jardinSeleccionado.nombre}`));
                                              } else {
                                                  jardinSeleccionado = null;
                                              }
                                          } else {
                                              jardinSeleccionado = null;
                                          }
                                      }
                                  } catch(e) {
                                      console.log(c.rojo(`  ❌ Error leyendo el nuevo Excel: ${e.message}`));
                                      modoExcel = null;
                                  }
                              } else if (opt === '2') {
                                  jardinSeleccionado = null;
                                  modoExcel = null;
                              } else if (opt === '3') {
                                  ascSeleccionada = null;
                                  jardinSeleccionado = null;
                                  modoExcel = null;
                              } else {
                                  modoExcel = null;
                              }

                              preFiltroBeneficiario = null;
                              break;
                          } else {
                              idxNinoExcelActual++;
                              console.log(c.amarillo('  ⏳ Volviendo a la consulta de niños para el siguiente en el Excel...'));
                              await page.waitForTimeout(800);
                              try {
                                  const btnBuscar = content.locator('a[id*="btnBuscar"], input[id*="btnBuscar"], input[src*="lupa"], img[src*="lupa"]').first();
                                  if (await btnBuscar.count() > 0) {
                                      await Promise.all([
                                          content.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
                                          btnBuscar.evaluate(node => node.click())
                                      ]);
                                      await page.waitForTimeout(1500);
                                  }
                              } catch(e) {}
                              break; // Salir de la Fase 3 del niño actual y pasar al siguiente
                          }
                      } else {
                          // Registro nuevo (no duplicado): reiniciar contador de consecutivos
                          consecutivosDuplicados = 0;
                      }
                  }

                  console.log(c.cyan('\n------------------------------------------------------'));
                  console.log(c.cyan(`  📊 TOMAS ACTUALES DE: ${ninoSeleccionado.nombreCompleto}`));
                  console.log(c.cyan('------------------------------------------------------'));
                  
                  const btnNuevo = content.locator('a[id*="btnNuevo"], input[id*="btnNuevo"]').first();

                  if (listaTomas.length === 0) {
                      console.log(c.gris('  (No hay tomas registradas previamente)'));
                      console.log(c.verde('  ✨ Redirigiendo automaticamente a "Nueva Toma"...'));
                      
                      if (await btnNuevo.count() > 0) {
                          await Promise.all([
                              content.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
                              btnNuevo.evaluate(node => node.click())
                          ]);
                          console.log(c.verde('  ✅ Nueva ventana (Nuevo) cargada.'));
                      } else {
                          console.log(c.rojo('  ❌ No se encontro el boton (+) Nuevo.'));
                      }
                  } else {
                      listaTomas.forEach((toma, idx) => {
                          console.log(`  ${idx + 1}. Fecha Toma: ${c.cyan(toma.fechaToma)} | Peso: ${toma.peso}kg | Talla: ${toma.talla}cm`);
                      });

                      let accion = '';
                      if (accionRapida) {
                          console.log(c.verde(`  ✨ Ejecutando accion automatica: ${accionRapida === '1' ? 'NUEVO' : 'EDITAR'}`));
                          accion = accionRapida;
                          accionRapida = null; // Quitar atajo para no hacer bucle si regresamos
                          preFiltroBeneficiario = null;
                      } else {
                          console.log(c.amarillo('\n  ¿Que accion deseas realizar?'));
                          console.log(`  [1] Agregar una NUEVA toma (+)`);
                          console.log(`  [2] EDITAR una toma existente`);
                          console.log(`  [0] Atras (Volver a consulta de ninos)`);
                          accion = readline.question(c.negrita('\n  > Selecciona una accion (1/2/0): '));
                      }

                      if (accion.trim() === '0') {
                          console.log(c.amarillo('  ⏳ Volviendo a la consulta de ninos...'));
                          const btnBuscar = content.locator('a[id*="btnBuscar"], input[id*="btnBuscar"]').first();
                          if (await btnBuscar.count() > 0) {
                              await Promise.all([
                                  content.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
                                  btnBuscar.evaluate(node => node.click())
                              ]);
                          }
                          break; // Rompe el bucle de Fase 3 y vuelve al menú de selección de niños
                      }
                      
                      if (accion.trim() === '1') {
                          console.log(c.amarillo('  ⏳ Haciendo clic en el boton (+) Nuevo...'));
                          if (await btnNuevo.count() > 0) {
                              await Promise.all([
                                  content.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
                                  btnNuevo.evaluate(node => node.click())
                              ]);
                              console.log(c.verde('  ✅ Nueva ventana (Nuevo) cargada.'));
                               const btnAceptarPop = content.locator('button:has-text("Aceptar"), input[value="Aceptar"], a:has-text("Aceptar"), button:has-text("SI"), input[value="SI"]').first();
                               if (await btnAceptarPop.isVisible().catch(() => false)) {
                                   console.log(c.amarillo('  ⚠️  Mensaje Informativo Cuéntame detectado (SGSSS / Alerta) → haciendo clic en Aceptar...'));
                                   await btnAceptarPop.click().catch(() => btnAceptarPop.evaluate(n => n.click()));
                                   await page.waitForTimeout(600);
                               }
                          } else {
                              console.log(c.rojo('  ❌ No se encontro el boton (+) Nuevo en la pantalla.'));
                          }
                      } else if (accion.trim() === '2') {
                          let numAccion = -1;
                          if (listaTomas.length === 1) {
                              numAccion = 1;
                              console.log(c.amarillo(`  ⏳ Editando la unica toma existente (${listaTomas[0].fechaToma})...`));
                          } else {
                              console.log(c.gris(`  [0] Volver a la consulta de niños (lupa)`));
                              const res = readline.question(c.negrita(`  > Selecciona cual toma editar (1 - ${listaTomas.length}) o [0] para volver: `));
                              if (res.trim() === '0') {
                                  console.log(c.amarillo('  ⏳ Volviendo a la consulta de niños...'));
                                  try {
                                      const btnBuscarBack = content.locator('a[id*="btnBuscar"], input[id*="btnBuscar"], input[src*="lupa"]').first();
                                      if (await btnBuscarBack.count() > 0) {
                                          await Promise.all([
                                              content.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
                                              btnBuscarBack.evaluate(node => node.click())
                                          ]);
                                      }
                                  } catch(e) {
                                      console.log(c.rojo(`  ❌ Error: ${e.message}`));
                                  }
                                  break; // Vuelve al bucle de selección de niño
                              }
                              numAccion = parseInt(res.trim(), 10);
                          }


                          if (!isNaN(numAccion) && numAccion > 0 && numAccion <= listaTomas.length) {
                              const tomaSeleccionada = listaTomas[numAccion - 1];
                              console.log(c.amarillo(`  ⏳ Abriendo edicion para la toma del ${tomaSeleccionada.fechaToma}...`));
                              
                              try {
                                  if (await tomaSeleccionada.chkLocator.count() > 0) {
                                      await tomaSeleccionada.chkLocator.check();
                                  }
                                  if (await tomaSeleccionada.btnInfoLocator.count() > 0) {
                                      await Promise.all([
                                          content.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
                                          tomaSeleccionada.btnInfoLocator.evaluate(node => node.click())
                                      ]);
                                      console.log(c.verde('  ✅ Ventana de Edicion cargada.'));
                                  } else {
                                      console.log(c.rojo('  ❌ No se encontro el boton azul (detalle) para esta fila.'));
                                  }
                              } catch (e) {
                                  console.log(c.rojo(`  ❌ Error al editar: ${e.message}`));
                              }
                          } else {
                              console.log(c.rojo('  ❌ Seleccion no valida.'));
                              continue;
                          }
                      } else {
                          console.log(c.rojo('  ❌ Opcion no valida.'));
                          continue;
                      }
                  }

                  let datosLlenado;
                  const hasHistory = (listaTomas.length > 0);

                  if (modoExcel && (modoExcel.startsWith('MASIVO_') || modoExcel === 'INDIVIDUAL_EXCEL')) {
                      const ninoInfo = ninosExcel[modoExcel.startsWith('MASIVO_') ? idxNinoExcelActual : 0];
                      datosLlenado = {
                          documentoPrevio: ninoSeleccionado ? ninoSeleccionado.documento : '',
                          fecha: parsearFecha(String(ninoInfo.fecha)),
                          peso: String(ninoInfo.peso || '').trim().replace(',', '.'),
                          talla: String(ninoInfo.talla || '').trim().replace(',', '.'),
                          perimetro: ninoInfo.perimetro ? String(ninoInfo.perimetro).trim().replace(',', '.') : ''
                      };
                      console.log(c.amarillo(`  📥 Usando datos de Excel: Fecha=${datosLlenado.fecha}, Peso=${datosLlenado.peso}, Talla=${datosLlenado.talla}, PB=${datosLlenado.perimetro}`));
                      await page.waitForTimeout(1500);
                  } else {
                      let regimenInput = null;
                      let epsInput = null;

                      while (true) {
                          console.log(c.cyan('\n  📋 DATOS DE LA TOMA (Ingresa los datos para este niño)'));
                          let fechaEntrada = readline.question(c.negrita('  > Fecha de valoracion (ej. "hoy", "22", "30/07/2026") [Opcional]: '));
                          let pesoInput = readline.question(c.negrita('  > Peso en Kilogramos (ej. 12.5) [Opcional]: '));
                          let tallaInput = readline.question(c.negrita('  > Talla en Centimetros (ej. 85) [Opcional]: '));
                          let perimetroInput = readline.question(c.negrita('  > Perimetro Braquial (cm) [Opcional]: '));
                          
                          if (!hasHistory) {
                              console.log(c.amarillo('\n  ⚠️ Al ser una toma NUEVA, el sistema de Cuéntame exige Régimen y EPS.'));
                              const tieneEps = readline.question(c.negrita('  > ¿Tienes el nombre del regimen y EPS? (1 = Si, 2 = No / Aleatorio): '));
                              if (tieneEps.trim() === '1') {
                                  regimenInput = readline.question(c.negrita('  > Regimen (ej. contributivo, subsidiado): '));
                                  epsInput = readline.question(c.negrita('  > EPS (ej. suramericana, capital salud): '));
                              }
                          }
                          
                          const resumen = `\n  Has ingresado:\n  - Fecha: ${fechaEntrada || '(vacia)'}\n  - Peso: ${pesoInput || '(vacio)'}\n  - Talla: ${tallaInput || '(vacia)'}\n  - Perimetro: ${perimetroInput || '(vacio)'}` + 
                                          (!hasHistory && regimenInput ? `\n  - Regimen: ${regimenInput}\n  - EPS: ${epsInput}` : (!hasHistory ? `\n  - EPS: Aleatoria` : ''));

                          const resp = readline.question(c.amarillo(`${resumen}\n  > ¿Deseas proceder con estos datos o editarlos nuevamente? (p = proceder / e = editar): `));
                          
                          if (resp.trim().toLowerCase() === 'p') {
                              datosLlenado = {
                                  documentoPrevio: ninoSeleccionado ? ninoSeleccionado.documento : '',
                                  fecha: parsearFecha(fechaEntrada),
                                  peso: pesoInput.trim(),
                                  talla: tallaInput.trim(),
                                  perimetro: perimetroInput.trim(),
                                  regimen: regimenInput ? regimenInput.trim() : null,
                                  eps: epsInput ? epsInput.trim() : null
                              };
                              break;
                          } else {
                              console.log(c.rojo('  🔄 Reingresando datos...'));
                          }
                      }
                  }
                  
                  // Ejecutar la magia del llenado automático y consulta ADRES
                  await llenarFormularioNutricion(browser, content, datosLlenado, hasHistory);

                  console.log(c.amarillo('\n  ✨ Llenado automático finalizado.'));
                  // ── GUARDADO AUTOMÁTICO ─────────────────────────────────
                  console.log(c.amarillo('  ⏳ Guardando automáticamente en Cuéntame (clic en disco de guardar)...'));
                  
                  // Escuchar diálogos/alertas nativos del navegador por si Cuéntame lanza un alert() nativo
                  const dialogHandler = async dialog => {
                      console.log(c.amarillo(`  ⚠️  Diálogo nativo de la página: "${dialog.message().slice(0, 80)}" → Aceptando...`));
                      await dialog.accept().catch(() => {});
                  };
                  page.on('dialog', dialogHandler);

                  try {
                      const btnGuardar = content.locator('a#btnGuardar, #cphCont_btnGuardar, a[id*="btnGuardar" i], input[id*="btnGuardar" i], input[src*="grabar" i], img[alt*="Guardar" i], img[src*="save" i], a:has(img[src*="save"])').first();
                      if (await btnGuardar.count() > 0) {
                          await btnGuardar.click({ timeout: 3000 }).catch(() => btnGuardar.evaluate(node => node.click()));
                          console.log(c.verde('  ✅ Clic en botón Guardar enviado.'));
                      } else {
                          console.log(c.rojo('  ❌ No se encontró el botón de Guardar. Por favor guárdalo manualmente.'));
                      }
                  } catch (e) {
                      console.log(c.rojo(`  ❌ Error al presionar Guardar: ${e.message}`));
                  }

                  // Esperar a que aparezca la ventana emergente o el cuadro de diálogo
                  await page.waitForTimeout(800);

                  // ── ESPERAR CONFIRMACIÓN "La Información ha sido guardada." O ERROR DUPLICADO ──
                  console.log(c.amarillo('  ⏳ Esperando respuesta del servidor ("La Información ha sido guardada.")...'));
                  let guardadoConfirmado = false;
                  let errorTomaExistente = false;
                  let clickAceptarRealizado = false;
                  const tInicioSave = Date.now();
                  
                  while (Date.now() - tInicioSave < 15000) { // Esperar hasta 15 segundos la respuesta
                      let currentFrame = page.frame({ name: 'frameContent' }) || page;
                      
                      // 1. Re-verificar solo una vez si aparece alguna ventana emergente de confirmación
                      if (!clickAceptarRealizado) {
                          const btnAceptarPage = page.locator('button:has-text("Aceptar"), input[value="Aceptar"], a:has-text("Aceptar"), button:has-text("SI"), input[value="SI"]').first();
                          const btnAceptarFrame = currentFrame.locator('button:has-text("Aceptar"), input[value="Aceptar"], a:has-text("Aceptar"), button:has-text("SI"), input[value="SI"]').first();

                          if (await btnAceptarPage.isVisible().catch(() => false)) {
                              console.log(c.amarillo('  ⚠️  Ventana emergente de confirmación detectada → haciendo clic en Aceptar...'));
                              clickAceptarRealizado = true;
                              await btnAceptarPage.click().catch(() => btnAceptarPage.evaluate(n => n.click()));
                              await page.waitForTimeout(1500);
                          } else if (await btnAceptarFrame.isVisible().catch(() => false)) {
                              console.log(c.amarillo('  ⚠️  Ventana emergente de confirmación detectada en formulario → haciendo clic en Aceptar...'));
                              clickAceptarRealizado = true;
                              await btnAceptarFrame.click().catch(() => btnAceptarFrame.evaluate(n => n.click()));
                              await page.waitForTimeout(1500);
                          }
                      }

                      // 2. Verificar si apareció la confirmación de guardado
                      currentFrame = page.frame({ name: 'frameContent' }) || page;
                      const txtBody = await currentFrame.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
                      const txtMain = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
                      
                      if (txtBody.includes('La Información ha sido guardada') || txtMain.includes('La Información ha sido guardada') || txtBody.includes('ha sido guardada')) {
                          guardadoConfirmado = true;
                          break;
                      }

                      if (txtBody.includes('ya tiene una toma para la fecha') || txtMain.includes('ya tiene una toma para la fecha') || txtBody.includes('ya tiene una toma') || txtMain.includes('ya tiene una toma')) {
                          errorTomaExistente = true;
                          break;
                      }

                      await page.waitForTimeout(500);
                  }

                  page.off('dialog', dialogHandler);

                  // Re-obtener el frame actualizado tras el guardado
                  let activeContent = page.frame({ name: 'frameContent' });
                  if (!activeContent) {
                      for (const f of page.frames()) {
                          if (f.name() === 'frameContent') {
                              activeContent = f;
                              break;
                          }
                      }
                  }
                  if (!activeContent) activeContent = page;

                  if (errorTomaExistente) {
                      consecutivosDuplicados++;
                      console.log(c.amarillo(`\n  ⚠️ ALERTA DE CUÉNTAME: "El beneficiario ya tiene una toma para la fecha de antropométrica relacionada".`));
                      console.log(c.amarillo(`     ➡️ Registro omitido por duplicidad de fecha (${consecutivosDuplicados} consecutivo(s)).`));

                      if (modoExcel && modoExcel.startsWith('MASIVO_')) {
                          const ninoTarget = ninosExcel[idxNinoExcelActual] || ninoSeleccionado;
                          if (ninoTarget) {
                              ninosProcesados.push({
                                  ...ninoTarget,
                                  estado: '⚠️ OMITIDO (TOMA DUPLICADA)',
                                  observacion: 'Cuéntame indicó que el beneficiario ya tiene una toma para esa fecha.'
                              });
                          }
                      }

                      if (consecutivosDuplicados >= 3) {
                          console.log(c.rojo('\n  ========================================================================================'));
                          console.log(c.rojo('  ⛔ SE VALIDÓ EN 3 REGISTROS CONSECUTIVOS QUE LA TOMA YA EXISTE EN CUÉNTAME.'));
                          console.log(c.rojo('  ⚠️  FAVOR VALIDAR LOS SIGUIENTES REGISTROS MANUALMENTE.'));
                          console.log(c.rojo('  ========================================================================================\n'));

                          preFiltroBeneficiario = null;
                          modoExcel = null;
                      }
                  } else if (guardadoConfirmado) {
                      consecutivosDuplicados = 0;
                      console.log(c.verde('  🎉 ¡Confirmado! Banner "La Información ha sido guardada." recibido de Cuéntame.'));
                      if (modoExcel && modoExcel.startsWith('MASIVO_')) {
                          const ninoTarget = ninosExcel[idxNinoExcelActual] || ninoSeleccionado;
                          if (ninoTarget) {
                              ninosProcesados.push({
                                  ...ninoTarget,
                                  estado: '✅ CARGADO EXITOSAMENTE',
                                  observacion: 'La información de la toma se guardó en Cuéntame.'
                              });
                          }
                          console.log(c.verde(`  🎉 Niño ${idxNinoExcelActual + 1} de ${ninosExcel.length} procesado y guardado.`));
                      }
                  } else {
                      let currentFrameErr = page.frame({ name: 'frameContent' }) || page;
                      const txtError = await currentFrameErr.evaluate(() => {
                          const errorElms = Array.from(document.querySelectorAll('span, div, td')).filter(el => {
                              const style = window.getComputedStyle(el);
                              return (style.color === 'rgb(255, 0, 0)' || el.className.includes('error') || el.className.includes('validator')) && el.innerText.trim().length > 3;
                          });
                          return errorElms.map(e => e.innerText.trim()).join(' | ');
                      }).catch(() => '');

                      let autoHealed = false;
                      const ninoTarget = (modoExcel && modoExcel.startsWith('MASIVO_')) ? (ninosExcel[idxNinoExcelActual] || ninoSeleccionado) : ninoSeleccionado;

                      // Auto-recuperación si Cuéntame reclama por Fecha de medición de perímetro braquial > Fecha de valoración
                      if (txtError && (txtError.toLowerCase().includes('perimetro braquial') || txtError.toLowerCase().includes('menor o igual')) && ninoTarget && ninoTarget.fecha) {
                          console.log(c.amarillo(`\n  ⚠️ Detectado error de fecha de perímetro braquial en Cuéntame.`));
                          console.log(c.amarillo(`  🛠️ Autocorrigiendo: Sincronizando Fecha de medición de perímetro braquial con Fecha de valoración (${ninoTarget.fecha})...`));
                          
                          await currentFrameErr.evaluate((fDate) => {
                              const inpPbFecha = document.querySelector('#cphCont_cuwFechaMedicionPerimetroBraquial_txtFecha, input[id*="cuwFechaMedicionPerimetroBraquial"]');
                              if (inpPbFecha) {
                                  inpPbFecha.value = fDate;
                                  inpPbFecha.dispatchEvent(new Event('input', { bubbles: true }));
                                  inpPbFecha.dispatchEvent(new Event('change', { bubbles: true }));
                                  inpPbFecha.dispatchEvent(new Event('blur', { bubbles: true }));
                              }
                          }, ninoTarget.fecha).catch(() => {});

                          const btnGuardarRetry = currentFrameErr.locator('a#btnGuardar, #cphCont_btnGuardar, a[id*="btnGuardar" i], input[id*="btnGuardar" i], input[src*="grabar" i], img[alt*="Guardar" i], img[src*="save" i], a:has(img[src*="save"])').first();
                          if (await btnGuardarRetry.count() > 0) {
                              console.log(c.amarillo('  ⏳ Reintentando guardado...'));
                              await btnGuardarRetry.click({ timeout: 3000 }).catch(() => btnGuardarRetry.evaluate(node => node.click()));
                              await page.waitForTimeout(2000);

                              const currentFrameRetry = page.frame({ name: 'frameContent' }) || page;
                              const txtBodyRetry = await currentFrameRetry.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
                              const txtMainRetry = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');

                              if (txtBodyRetry.includes('La Información ha sido guardada') || txtMainRetry.includes('La Información ha sido guardada') || txtBodyRetry.includes('ha sido guardada')) {
                                  autoHealed = true;
                                  consecutivosDuplicados = 0;
                                  console.log(c.verde('  🎉 ¡Corregido y guardado exitosamente! Banner "La Información ha sido guardada." recibido.'));
                                  if (modoExcel && modoExcel.startsWith('MASIVO_') && ninoTarget) {
                                      ninosProcesados.push({
                                          ...ninoTarget,
                                          estado: '✅ CARGADO EXITOSAMENTE (AUTOCORREGIDO FECHA PERIMETRO)',
                                          observacion: 'La información de la toma se guardó tras autocorregir fecha de perímetro braquial.'
                                      });
                                      console.log(c.verde(`  🎉 Niño ${idxNinoExcelActual + 1} de ${ninosExcel.length} procesado y guardado.`));
                                  }
                              }
                          }
                      }

                      if (!autoHealed) {
                          if (txtError) {
                              console.log(c.rojo(`  ❌ Error reportado por Cuéntame en la pantalla: "${txtError}"`));
                          } else {
                              console.log(c.rojo('  ❌ NO se confirmó el guardado ("La Información ha sido guardada.") por parte del servidor.'));
                          }

                          if (modoExcel && modoExcel.startsWith('MASIVO_')) {
                              if (ninoTarget) {
                                  ninosProcesados.push({
                                      ...ninoTarget,
                                      estado: '❌ ERROR EN GUARDADO',
                                      observacion: txtError ? `Cuéntame reportó: ${txtError}` : 'El servidor de Cuéntame no retornó la confirmación de guardado.'
                                  });
                              }
                          }
                      }
                  }

                  if (modoExcel && modoExcel.startsWith('MASIVO_')) {
                      idxNinoExcelActual++;
                      console.log(c.amarillo('  ⏳ Volviendo a la consulta de niños de la UDS para el siguiente...'));
                      
                      await page.waitForTimeout(800);
                      
                      try {
                          const btnBuscar = activeContent.locator('a[id*="btnBuscar"], input[id*="btnBuscar"], input[src*="lupa"], img[src*="lupa"]').first();
                          if (await btnBuscar.count() > 0) {
                              await Promise.all([
                                  activeContent.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
                                  btnBuscar.evaluate(node => node.click())
                              ]);
                              await page.waitForTimeout(1500); // Esperar a que cargue la grilla de niños de la UDS
                          } else {
                              const rootMenu = page.frame({ name: 'frameMenu' }) || page;
                              const childMenu = rootMenu.locator('a:has-text("Seguimiento nutricional")').first();
                              if (await childMenu.count() > 0) {
                                  await Promise.all([
                                      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
                                      childMenu.evaluate(node => node.click())
                                  ]);
                                  await page.waitForTimeout(2000);
                              } else {
                                  await rootMenu.locator('a[onclick*="SeguimientoNutricional"]').first().evaluate(node => node.click());
                                  await page.waitForTimeout(4000);
                              }
                          }
                      } catch(e) {
                          console.log(c.rojo(`  ❌ Error volviendo a la consulta (lupa): ${e.message}`));
                      }
                      break; // Salir de la Fase 3 del niño actual y pasar al siguiente en la lista masiva
                  }


                  // ── MENÚ POST-GUARDADO ───────────────────────────────────
                  console.log(c.cyan('\n  ╔════════════════════════════════════════════════════════════════════╗'));
                  console.log(c.cyan('  ║                ¿Qué deseas hacer a continuación?                   ║'));
                  console.log(c.cyan('  ╠════════════════════════════════════════════════════════════════════╣'));
                  console.log(c.cyan('  ║  1. Otro niño del mismo jardín                                     ║'));
                  console.log(c.cyan('  ║  2. Cambiar de Jardín (UDS)                                        ║'));
                  console.log(c.cyan('  ║  3. Cambiar de Asociación                                          ║'));
                  console.log(c.cyan('  ║  4. Volver al menú de opciones de Peso y Talla                     ║'));
                  console.log(c.cyan('  ║  0. Volver al panel principal (AutoTrabajo / Start)               ║'));
                  console.log(c.cyan('  ╚════════════════════════════════════════════════════════════════════╝'));

                  let respNavPost = '';
                  while (!['0', '1', '2', '3', '4'].includes(respNavPost.trim())) {
                      respNavPost = readline.question(c.negrita('  > Tu opcion (0-4): ')).trim();
                  }

                  if (respNavPost === '0') {
                      console.log(c.verde('\n  👋 Volviendo al panel principal (AutoTrabajo)...\n'));
                      salirModulo = true;
                      break;
                  } else if (respNavPost === '4') {
                      jardinSeleccionado = null;
                      break;
                  } else if (respNavPost === '1') {
                      // Mismo jardín → Volver a llenar la lupa de UDS porque a veces Cuéntame la borra tras guardar
                      console.log(c.amarillo('  ⏳ Recargando la UDS para asegurar que la lista de niños esté visible...'));
                      try {
                          let currentContentFrame = page.frame({ name: 'frameContent' });
                          if (!currentContentFrame) {
                              for (const f of page.frames()) {
                                  if (f.name() === 'frameContent') {
                                      currentContentFrame = f;
                                      break;
                                  }
                              }
                          }
                          const currentContent = currentContentFrame || page;
                          
                          let lupaLocator = currentContent.locator('input[id*="cphCont_btnFiltrar"], input[name*="btnFiltrar"], input[src*="lupa"]').first();
                          
                          if (await lupaLocator.count() > 0) {
                              const [popup] = await Promise.all([
                                  page.waitForEvent('popup'),
                                  lupaLocator.evaluate(node => node.click())
                              ]);

                              await popup.waitForLoadState('networkidle');
                              await popup.locator('input[id*="txtCodigoUnidadServicio"], input[name*="CodigoUnidadServicio"]').first().fill(String(jardinSeleccionado.codigo));
                              
                              // Clic en buscar dentro del popup
                              await popup.locator('input[type="image"][id*="btnBuscar"], input[name*="btnBuscar"], a[id*="btnBuscar"]').first().click();
                              
                              const btnInfo = popup.locator('input[type="image"][id*="btnInfo"], input[src*="info.jpg"]').first();
                              await btnInfo.waitFor({ state: 'visible', timeout: 15000 });
                              await btnInfo.click();
                              
                              try {
                                  await popup.waitForEvent('close', { timeout: 10000 });
                              } catch (e) {}
                              
                              console.log(c.verde('  ✅ UDS recargada correctamente. Busca el siguiente.'));
                          } else {
                              console.log(c.rojo('  ❌ No se encontro la lupa de UDS para recargar.'));
                          }
                      } catch(e) {
                          console.log(c.rojo(`  ❌ Error al recargar UDS: ${e.message}`));
                      }
                      
                      await page.waitForTimeout(1500);
                      break; // Sale de Fase 3 y regresa a Fase 2 (selección de niño)
                  } else if (respNavPost === '2') {
                      jardinSeleccionado = null;
                      // Mismo jardín / misma asociación → volver a Seguimiento Nutrición (filtros limpios)
                      console.log(c.amarillo('  ⏳ Volviendo a Seguimiento Nutrición para seleccionar otro jardín...'));
                      try {
                          const rootMenu2 = page.frame({ name: 'frameMenu' }) || page;
                          const childMenu2 = rootMenu2.locator('a:has-text("Seguimiento nutricional")').first();
                          if (await childMenu2.count() > 0) {
                              await childMenu2.evaluate(node => node.click());
                              await page.waitForTimeout(2500);
                          } else {
                              await page.goto('https://rubonline.icbf.gov.co/General/General/Master/MasterPrincipal.aspx', { waitUntil: 'networkidle', timeout: 20000 });
                              await page.waitForTimeout(1500);
                          }
                          console.log(c.verde('  ✅ Listo. Selecciona el nuevo jardín desde los filtros.'));
                      } catch(e) {
                          console.log(c.rojo(`  ❌ Error navegando: ${e.message}`));
                      }
                      break; // Sale de Fase 3 y regresa al while(true) principal
                  } else if (respNavPost === '3') {
                      ascSeleccionada = null;
                      jardinSeleccionado = null;
                      // Cambiar de asociación → ir a selección de roles
                      console.log(c.amarillo('  ⏳ Navegando a la pantalla de selección de asociación...'));
                      try {
                          await page.goto('https://rubonline.icbf.gov.co/DefaultF.aspx', { waitUntil: 'networkidle', timeout: 30000 });
                          if (page.url().includes('DefaultF.aspx')) {
                              console.log(c.amarillo('  ⚠️ Sesión expirada. Reautenticando...'));
                              await loginYLlegarARoles(page, { usuario: USUARIO, password: PASSWORD, gmailUser: GMAIL_USER, gmailAppPassword: GMAIL_APP_PASSWORD });
                          }
                          loggedIn = true;
                          console.log(c.verde('  ✅ Listo. El script seleccionará la nueva asociación.'));
                      } catch(e) {
                          console.log(c.rojo(`  ❌ Error navegando a roles: ${e.message}`));
                      }
                      break; // Sale de Fase 3 y regresa al while(true) principal
                  }
              } // fin while (true)
          } catch (err) {
              console.log(c.rojo(`  ❌ Error al abrir formulario del nino: ${err.message}`));
          }
      }
  } catch (err) {
    console.error(c.rojo(`\n  ❌ Error en el proceso: ${err.message}`));
  } finally {
    if (browser) await browser.disconnect().catch(() => {});
    process.exit(0);
  }
}

main();
