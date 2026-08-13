const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const ExcelJS = require('exceljs');
const readline = require('readline-sync');
const { resolverRutaConEspeciales } = require('../servicios/excel-parser');

const c = {
    verde: (t) => `\x1b[32m${t}\x1b[0m`,
    amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
    cyan: (t) => `\x1b[36m${t}\x1b[0m`,
    rojo: (t) => `\x1b[31m${t}\x1b[0m`,
    gris: (t) => `\x1b[90m${t}\x1b[0m`,
    negrita: (t) => `\x1b[1m${t}\x1b[0m`,
    bold: (t) => `\x1b[1m${t}\x1b[0m`,
};

function normalizarDoc(val) {
    if (val === undefined || val === null) return '';
    return String(val).replace(/[^a-zA-Z0-9]/g, '').trim().toUpperCase();
}

function detectarColumnas(data) {
    let bestRowIdx = -1;
    let maxScore = -1;

    let colDoc = -1;
    let colNombre = -1;
    let colApellido = -1;
    let colNombreCompleto = -1;
    let colUds = -1;
    let colCodUds = -1;
    let colTipoDoc = -1;
    let colEstado = -1;

    for (let r = 0; r < Math.min(30, data.length); r++) {
        const row = data[r];
        if (!row || !Array.isArray(row)) continue;

        let score = 0;
        let cDoc = -1, cNom = -1, cApe = -1, cComp = -1, cUds = -1, cCodUds = -1, cTipo = -1, cEst = -1;

        for (let c = 0; c < row.length; c++) {
            const cell = String(row[c] || '').trim().toUpperCase();
            if (!cell) continue;

            if (cell.includes('NUMERO DOCUMENTO') || cell.includes('NÚMERO DOCUMENTO') || cell.includes('NO. DOCUMENTO') || cell.includes('DOCUMENTO') || cell.includes('IDENTIFICACION') || cell.includes('NUM_DOC') || cell === 'DOC') {
                if (cDoc === -1) { cDoc = c; score += 5; }
            }
            if (cell.includes('TIPO DOCUMENTO') || cell.includes('TIPO DOC') || cell.includes('TIPO_DOC')) {
                if (cTipo === -1) { cTipo = c; score += 2; }
            }
            if (cell.includes('PRIMER NOMBRE') || cell === 'NOMBRES' || cell.includes('NOMBRE(S)')) {
                if (cNom === -1) { cNom = c; score += 3; }
            }
            if (cell.includes('PRIMER APELLIDO') || cell === 'APELLIDOS' || cell.includes('APELLIDO(S)')) {
                if (cApe === -1) { cApe = c; score += 3; }
            }
            if (cell.includes('BENEFICIARIO') || cell.includes('NOMBRE COMPLETO') || cell === 'NOMBRE' || cell === 'NOMBRES Y APELLIDOS') {
                if (cComp === -1) { cComp = c; score += 4; }
            }
            if (cell.includes('CODIGO') && (cell.includes('UDS') || cell.includes('UNIDAD') || cell.includes('SERVICIO'))) {
                if (cCodUds === -1) { cCodUds = c; score += 4; }
            }
            if ((cell.includes('UNIDAD DE SERVICIO') || cell.includes('NOMBRE UDS') || cell.includes('UNIDAD_SERVICIO') || cell === 'UDS' || cell === 'JARDIN') && !cell.includes('CODIGO')) {
                if (cUds === -1) { cUds = c; score += 3; }
            }
            if (cell.includes('ESTADO')) {
                if (cEst === -1) { cEst = c; score += 2; }
            }
        }

        if (score > maxScore && cDoc !== -1) {
            maxScore = score;
            bestRowIdx = r;
            colDoc = cDoc;
            colNombre = cNom;
            colApellido = cApe;
            colNombreCompleto = cComp;
            colUds = cUds;
            colCodUds = cCodUds;
            colTipoDoc = cTipo;
            colEstado = cEst;
        }
    }

    return {
        headerRowIdx: bestRowIdx,
        colDoc,
        colNombre,
        colApellido,
        colNombreCompleto,
        colUds,
        colCodUds,
        colTipoDoc,
        colEstado
    };
}

function extraerNinosActivos(filePath) {
    const rutaReal = resolverRutaConEspeciales(filePath);
    if (!fs.existsSync(rutaReal)) throw new Error(`El archivo no existe: ${filePath}`);

    const wb = xlsx.readFile(rutaReal);
    const ninosActivos = [];
    const docsVistos = new Set();

    for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;

        const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        if (!data || data.length < 2) continue;

        const cols = detectarColumnas(data);

        if (cols.headerRowIdx !== -1 && cols.colDoc !== -1) {
            for (let r = cols.headerRowIdx + 1; r < data.length; r++) {
                const row = data[r];
                if (!row || !row[cols.colDoc]) continue;

                const docRaw = String(row[cols.colDoc]).trim();
                const docNorm = normalizarDoc(docRaw);
                if (!docNorm || docNorm.length < 3) continue;

                const estado = cols.colEstado !== -1 ? String(row[cols.colEstado] || '').trim() : 'VINCULADO';
                if (estado.toUpperCase().includes('RETIRAD')) continue;

                let nombreCompleto = '';
                if (cols.colNombreCompleto !== -1 && row[cols.colNombreCompleto]) {
                    nombreCompleto = String(row[cols.colNombreCompleto]).trim();
                } else {
                    const nom = cols.colNombre !== -1 ? String(row[cols.colNombre] || '').trim() : '';
                    const ape = cols.colApellido !== -1 ? String(row[cols.colApellido] || '').trim() : '';
                    nombreCompleto = `${nom} ${ape}`.trim();
                }

                const uds = cols.colUds !== -1 ? String(row[cols.colUds] || '').trim() : sheetName;
                const codUds = cols.colCodUds !== -1 ? String(row[cols.colCodUds] || '').trim() : 'N/A';
                const tipoDoc = cols.colTipoDoc !== -1 ? String(row[cols.colTipoDoc] || '').trim() : 'RC';

                if (!docsVistos.has(docNorm)) {
                    docsVistos.add(docNorm);
                    ninosActivos.push({
                        documentoRaw: docRaw,
                        documento: docNorm,
                        nombreCompleto: nombreCompleto || 'SIN NOMBRE',
                        jardin: uds,
                        codigoUds: codUds,
                        tipoDoc: tipoDoc,
                        estado: estado
                    });
                }
            }
        } else {
            let uds = sheetName;
            let codUds = 'N/A';
            for (let i = 3; i < Math.min(15, data.length); i++) {
                const rowStr = (data[i] || []).join(' ').toUpperCase();
                if (rowStr.includes('UNIDAD') || rowStr.includes('UDS')) {
                    const found = (data[i] || []).find(v => String(v).trim().length > 3);
                    if (found) uds = String(found).trim();
                }
            }

            for (let i = 15; i < data.length; i++) {
                const row = data[i];
                if (!row || !row[1] || !row[2]) continue;

                const docRaw = String(row[1]).trim();
                const docNorm = normalizarDoc(docRaw);
                if (!docNorm) continue;

                const nombres = String(row[2] || '').trim();
                const apellidos = String(row[3] || '').trim();
                const esRetirado = String(row[7] || '').toLowerCase().includes('retirad') || String(row[19] || '').toLowerCase().includes('retirad');

                if (esRetirado) continue;

                if (!docsVistos.has(docNorm)) {
                    docsVistos.add(docNorm);
                    ninosActivos.push({
                        documentoRaw: docRaw,
                        documento: docNorm,
                        nombreCompleto: `${nombres} ${apellidos}`.trim(),
                        jardin: uds,
                        codigoUds: codUds,
                        tipoDoc: 'RC',
                        estado: 'VINCULADO'
                    });
                }
            }
        }
    }

    return ninosActivos;
}

function extraerDocumentosNutricion(filePath) {
    const rutaReal = resolverRutaConEspeciales(filePath);
    if (!fs.existsSync(rutaReal)) throw new Error(`El archivo no existe: ${filePath}`);

    const wb = xlsx.readFile(rutaReal);
    const docsNutricion = new Set();

    for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;

        const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        if (!data || data.length < 2) continue;

        const cols = detectarColumnas(data);

        if (cols.headerRowIdx !== -1 && cols.colDoc !== -1) {
            for (let r = cols.headerRowIdx + 1; r < data.length; r++) {
                const row = data[r];
                if (!row || !row[cols.colDoc]) continue;

                const docNorm = normalizarDoc(row[cols.colDoc]);
                if (docNorm) {
                    docsNutricion.add(docNorm);
                }
            }
        } else {
            for (let i = 15; i < data.length; i++) {
                const row = data[i];
                if (!row || !row[1]) continue;

                const docNorm = normalizarDoc(row[1]);
                const tieneToma = row[7] || row[19] || row[31] || row[43];
                if (docNorm && tieneToma && !String(tieneToma).toLowerCase().includes('retirad')) {
                    docsNutricion.add(docNorm);
                }
            }
        }
    }

    return docsNutricion;
}

async function generarReporteExcelFaltantes(faltantes, totalActivos, totalNutricion) {
    const now = new Date();
    const fechaStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    
    const dirReportes = path.join(__dirname, '..', 'reportes');
    const dirDocsReportes = path.join(__dirname, '..', 'docs', 'reportes');
    
    if (!fs.existsSync(dirReportes)) fs.mkdirSync(dirReportes, { recursive: true });
    if (!fs.existsSync(dirDocsReportes)) fs.mkdirSync(dirDocsReportes, { recursive: true });

    const filename = `Reporte_Faltantes_Nutricion_${fechaStr}.xlsx`;
    const pathReportes = path.join(dirReportes, filename);
    const pathDocs = path.join(dirDocsReportes, filename);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Faltantes Nutrición');

    // Título y Resumen
    worksheet.mergeCells('A1:H1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'REPORTE DE NIÑOS FALTANTES POR VALORACIÓN NUTRICIONAL';
    titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F4E78' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(1).height = 30;

    worksheet.getCell('A3').value = 'Total Beneficiarios Activos:';
    worksheet.getCell('B3').value = totalActivos;
    worksheet.getCell('A4').value = 'Total con Registro Nutricional:';
    worksheet.getCell('B4').value = totalNutricion;
    worksheet.getCell('A5').value = 'Total Niños Faltantes por Nutrición:';
    worksheet.getCell('B5').value = faltantes.length;
    worksheet.getCell('B5').font = { bold: true, color: { argb: 'C00000' } };

    // Encabezados de Tabla (Fila 7)
    const headers = [
        '#',
        'Código UDS',
        'Unidad de Servicio (Jardín)',
        'Tipo Doc.',
        'Número de Documento',
        'Nombre Completo del Beneficiario',
        'Estado',
        'Observación'
    ];

    const headerRow = worksheet.getRow(7);
    headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2F5597' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    headerRow.height = 24;

    // Llenar datos
    faltantes.forEach((nino, index) => {
        const row = worksheet.getRow(8 + index);
        row.getCell(1).value = index + 1;
        row.getCell(2).value = nino.codigoUds;
        row.getCell(3).value = nino.jardin;
        row.getCell(4).value = nino.tipoDoc;
        row.getCell(5).value = nino.documentoRaw;
        row.getCell(6).value = nino.nombreCompleto;
        row.getCell(7).value = nino.estado;
        row.getCell(8).value = 'Falta registro de valoración nutricional en Cuéntame';

        row.getCell(1).alignment = { horizontal: 'center' };
        row.getCell(2).alignment = { horizontal: 'center' };
        row.getCell(4).alignment = { horizontal: 'center' };
        row.getCell(5).alignment = { horizontal: 'center' };
        row.getCell(7).alignment = { horizontal: 'center' };

        if (index % 2 === 1) {
            row.eachCell({ includeEmpty: true }, cell => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F2F2F2' } };
            });
        }
    });

    worksheet.columns.forEach((col, idx) => {
        let maxLen = headers[idx] ? headers[idx].length : 12;
        worksheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
            if (rowNum >= 7) {
                const val = row.getCell(idx + 1).value;
                if (val) {
                    const len = String(val).length;
                    if (len > maxLen) maxLen = len;
                }
            }
        });
        col.width = Math.min(maxLen + 4, 45);
    });

    await workbook.xlsx.writeFile(pathReportes);
    await workbook.xlsx.writeFile(pathDocs);

    return pathReportes;
}

function pedirRutaReporte(mensaje) {
    const docsDir = path.join(__dirname, '..', 'Docs');
    let archivos = [];
    if (fs.existsSync(docsDir)) {
        archivos = fs.readdirSync(docsDir).filter(f => !f.startsWith('~') && (f.endsWith('.xlsx') || f.endsWith('.xls') || f.endsWith('.csv')));
    }

    if (archivos.length > 0) {
        console.log(c.cyan(`\n  Archivos disponibles en "Docs":`));
        archivos.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
    }

    console.log(c.cyan(`\n  📥 ${mensaje}`));
    console.log(c.gris('     • Puedes arrastrar el archivo Excel descargado de Cuéntame aquí.'));
    console.log(c.gris('     • O escribe un número (1-N) para elegir de "Docs".'));

    const inputRaw = readline.question(c.negrita('\n  > Ruta del archivo Excel: ')).trim();
    if (!inputRaw) return null;

    if (/^\d+$/.test(inputRaw) && archivos.length > 0) {
        const idx = parseInt(inputRaw, 10);
        if (idx > 0 && idx <= archivos.length) {
            return path.join(docsDir, archivos[idx - 1]);
        }
    }

    return resolverRutaConEspeciales(inputRaw);
}

async function main() {
    console.clear();
    console.log(c.cyan(`
  ╔════════════════════════════════════════════════════════════════════╗
  ║     📊 COMPARADOR: BENEFICIARIOS ACTIVOS VS SEGUIMIENTO NUTRICIONAL║
  ╚════════════════════════════════════════════════════════════════════╝
    `));
    console.log(c.gris('  Este script compara los reportes originales de Cuéntame para identificar qué niños faltan por Nutrición.\n'));

    try {
        while (true) {
            console.log(c.amarillo('  Pasos para la comparación:'));
            console.log(c.gris('  1. Arrastra el Reporte de BENEFICIARIOS ACTIVOS descargado de Cuéntame.'));
            console.log(c.gris('  2. Arrastra el Reporte de SEGUIMIENTO NUTRICIONAL descargado de Cuéntame.\n'));

            // 1. Reporte de Beneficiarios Activos
            const rutaActivos = pedirRutaReporte('Paso 1: Arrastra el Reporte de BENEFICIARIOS ACTIVOS');
            if (!rutaActivos) {
                console.log(c.amarillo('\n  👋 Volviendo al panel principal...'));
                break;
            }

            if (!fs.existsSync(rutaActivos)) {
                console.log(c.rojo(`  ❌ No se encontró el archivo: ${rutaActivos}\n`));
                continue;
            }

            // 2. Reporte de Nutrición
            const rutaNutricion = pedirRutaReporte('Paso 2: Arrastra el Reporte de SEGUIMIENTO NUTRICIONAL');
            if (!rutaNutricion) {
                console.log(c.amarillo('\n  👋 Volviendo al panel principal...'));
                break;
            }

            if (!fs.existsSync(rutaNutricion)) {
                console.log(c.rojo(`  ❌ No se encontró el archivo: ${rutaNutricion}\n`));
                continue;
            }

            console.log(c.amarillo('\n  ⏳ Analizando y cruzando datos de ambos reportes...'));

            const ninosActivos = extraerNinosActivos(rutaActivos);
            const docsNutricion = extraerDocumentosNutricion(rutaNutricion);

            if (ninosActivos.length === 0) {
                console.log(c.rojo('  ❌ No se encontraron beneficiarios activos válidos en el primer reporte. Revisa el archivo.'));
                continue;
            }

            // Cruzar datos
            const faltantes = [];
            const faltantesMap = new Set();

            for (const nino of ninosActivos) {
                if (!docsNutricion.has(nino.documento)) {
                    if (!faltantesMap.has(nino.documento)) {
                        faltantesMap.add(nino.documento);
                        faltantes.push(nino);
                    }
                }
            }

            // Generar Reporte Excel
            const rutaExcelGenerado = await generarReporteExcelFaltantes(faltantes, ninosActivos.length, docsNutricion.size);

            // Mostrar resumen en consola
            console.log(c.verde('\n========================================================================================'));
            console.log(c.verde('  🎉 ¡COMPARACIÓN COMPLETADA CON ÉXITO!'));
            console.log(c.verde('========================================================================================'));
            console.log(`  • Total Beneficiarios Activos en Reporte: ${c.bold(ninosActivos.length)}`);
            console.log(`  • Total Con Registro Nutricional:         ${c.bold(docsNutricion.size)}`);
            console.log(`  • Total Niños Faltantes por Nutrición:     ${c.rojo(c.bold(faltantes.length))}\n`);

            // Agrupar faltantes por Jardín (UDS)
            const porJardin = new Map();
            faltantes.forEach(f => {
                const key = `${f.codigoUds} - ${f.jardin}`;
                if (!porJardin.has(key)) porJardin.set(key, []);
                porJardin.get(key).push(f);
            });

            console.log(c.cyan('  📋 DETALLE DE NIÑOS FALTANTES POR JARDÍN (UDS):\n'));
            let numJardin = 1;
            porJardin.forEach((ninos, udsNombre) => {
                console.log(c.amarillo(`  🏡 [UDS ${numJardin++}]: ${udsNombre} (${ninos.length} niños faltantes)`));
                ninos.forEach(n => {
                    console.log(`     • Doc: ${c.bold(n.documentoRaw.padEnd(12))} | Nombre: ${c.verde(n.nombreCompleto)}`);
                });
                console.log('');
            });

            console.log(c.verde(`  📊 Reporte Excel oficial generado en:\n     📁 ${rutaExcelGenerado}\n`));

            console.log(c.cyan('  ╔════════════════════════════════════════════════════════════════════╗'));
            console.log(c.cyan('  ║  1. Abrir carpeta de reportes en Explorador                        ║'));
            console.log(c.cyan('  ║  2. Comparar otros reportes                                        ║'));
            console.log(c.cyan('  ║  0. Volver al panel principal (AutoTrabajo / Start)               ║'));
            console.log(c.cyan('  ╚════════════════════════════════════════════════════════════════════╝'));

            const optFinal = readline.question(c.negrita('  > Selecciona una opcion (0-2): ')).trim();
            if (optFinal === '1') {
                try {
                    const { exec } = require('child_process');
                    exec(`explorer "${path.dirname(rutaExcelGenerado)}"`);
                } catch(e) {}
                break;
            } else if (optFinal === '2') {
                continue;
            } else {
                break;
            }
        }
    } catch(err) {
        console.error(c.rojo(`\n  ❌ Error en el proceso: ${err.message}`));
    } finally {
        process.exit(0);
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };
