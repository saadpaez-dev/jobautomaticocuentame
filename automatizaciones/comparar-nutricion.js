const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
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

            if (cell.includes('NUMERO DOCUMENTO') || cell.includes('NUMERO DOCUMENTO') || cell.includes('NO. DOCUMENTO') || cell.includes('DOCUMENTO') || cell.includes('IDENTIFICACION') || cell.includes('NUM_DOC') || cell === 'DOC') {
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

        // Regla directa para formato original de Cuentame: Col O (index 14) es Documento
        let idxDoc = cols.colDoc;
        let esFormatoOriginalActivos = false;

        if (data[0] && String(data[0][14] || '').toUpperCase().includes('DOCUMENTO DEL BENEFICIARIO')) {
            idxDoc = 14;
            esFormatoOriginalActivos = true;
        }

        const startRow = esFormatoOriginalActivos ? 1 : (cols.headerRowIdx !== -1 ? cols.headerRowIdx + 1 : 15);

        for (let r = startRow; r < data.length; r++) {
            const row = data[r];
            if (!row) continue;

            let docRaw = '';
            let nombreCompleto = '';
            let uds = sheetName;
            let codUds = 'N/A';
            let tipoDoc = 'RC';
            let estado = 'VINCULADO';

            if (esFormatoOriginalActivos) {
                docRaw = String(row[14] || '').trim();
                const nom1 = String(row[15] || '').trim();
                const nom2 = String(row[16] || '').trim();
                const ape1 = String(row[17] || '').trim();
                const ape2 = String(row[18] || '').trim();
                nombreCompleto = [nom1, nom2, ape1, ape2].filter(Boolean).join(' ');
                uds = String(row[10] || '').trim() || sheetName;
                codUds = String(row[9] || '').trim();
                tipoDoc = String(row[13] || '').trim();
            } else if (idxDoc !== -1 && row[idxDoc]) {
                docRaw = String(row[idxDoc]).trim();
                if (cols.colNombreCompleto !== -1 && row[cols.colNombreCompleto]) {
                    nombreCompleto = String(row[cols.colNombreCompleto]).trim();
                } else {
                    const nom = cols.colNombre !== -1 ? String(row[cols.colNombre] || '').trim() : '';
                    const ape = cols.colApellido !== -1 ? String(row[cols.colApellido] || '').trim() : '';
                    nombreCompleto = `${nom} ${ape}`.trim();
                }
                uds = cols.colUds !== -1 ? String(row[cols.colUds] || '').trim() : sheetName;
                codUds = cols.colCodUds !== -1 ? String(row[cols.colCodUds] || '').trim() : 'N/A';
                tipoDoc = cols.colTipoDoc !== -1 ? String(row[cols.colTipoDoc] || '').trim() : 'RC';
                estado = cols.colEstado !== -1 ? String(row[cols.colEstado] || '').trim() : 'VINCULADO';
            } else if (row[1] && row[2]) {
                docRaw = String(row[1]).trim();
                nombreCompleto = `${row[2] || ''} ${row[3] || ''}`.trim();
            }

            const docNorm = normalizarDoc(docRaw);
            if (!docNorm || docNorm.length < 3) continue;

            if (estado.toUpperCase().includes('RETIRAD')) continue;

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
    }

    return ninosActivos;
}

function extraerNinosNutricion(filePath) {
    const rutaReal = resolverRutaConEspeciales(filePath);
    if (!fs.existsSync(rutaReal)) throw new Error(`El archivo no existe: ${filePath}`);

    const wb = xlsx.readFile(rutaReal);
    const docsNutricion = new Set();
    const conteoDocsMap = new Map();
    let totalRegistros = 0;

    for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;

        const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        if (!data || data.length < 2) continue;

        const cols = detectarColumnas(data);

        let idxDoc = cols.colDoc;
        let esFormatoOriginalNutricion = false;

        if (data[0] && String(data[0][10] || '').toUpperCase().includes('NUMERO DOCUMENTO BENEFICIARIO')) {
            idxDoc = 10;
            esFormatoOriginalNutricion = true;
        }

        const startRow = esFormatoOriginalNutricion ? 1 : (cols.headerRowIdx !== -1 ? cols.headerRowIdx + 1 : 15);

        for (let r = startRow; r < data.length; r++) {
            const row = data[r];
            if (!row) continue;

            let docRaw = '';
            let nombreCompleto = '';
            let uds = sheetName;

            if (esFormatoOriginalNutricion) {
                docRaw = String(row[10] || '').trim();
                const nom1 = String(row[11] || row[12] || '').trim();
                const nom2 = String(row[13] || '').trim();
                const ape1 = String(row[14] || '').trim();
                const ape2 = String(row[15] || '').trim();
                nombreCompleto = [nom1, nom2, ape1, ape2].filter(Boolean).join(' ');
                if (!nombreCompleto && row[11]) nombreCompleto = String(row[11]).trim();
                uds = String(row[8] || row[9] || '').trim() || sheetName;
            } else if (idxDoc !== -1 && row[idxDoc]) {
                docRaw = String(row[idxDoc]).trim();
                if (cols.colNombreCompleto !== -1 && row[cols.colNombreCompleto]) {
                    nombreCompleto = String(row[cols.colNombreCompleto]).trim();
                } else {
                    const nom = cols.colNombre !== -1 ? String(row[cols.colNombre] || '').trim() : '';
                    const ape = cols.colApellido !== -1 ? String(row[cols.colApellido] || '').trim() : '';
                    nombreCompleto = `${nom} ${ape}`.trim();
                }
                uds = cols.colUds !== -1 ? String(row[cols.colUds] || '').trim() : sheetName;
            } else if (row[1]) {
                docRaw = String(row[1]).trim();
                nombreCompleto = `${row[2] || ''} ${row[3] || ''}`.trim();
            }

            const docNorm = normalizarDoc(docRaw);
            if (docNorm && docNorm.length >= 3) {
                totalRegistros++;
                docsNutricion.add(docNorm);

                if (!conteoDocsMap.has(docNorm)) {
                    conteoDocsMap.set(docNorm, {
                        documentoRaw: docRaw,
                        documento: docNorm,
                        nombreCompleto: nombreCompleto || 'SIN NOMBRE',
                        jardin: uds,
                        count: 1
                    });
                } else {
                    const info = conteoDocsMap.get(docNorm);
                    info.count++;
                    if ((!info.nombreCompleto || info.nombreCompleto === 'SIN NOMBRE') && nombreCompleto) {
                        info.nombreCompleto = nombreCompleto;
                    }
                }
            }
        }
    }

    const duplicados = Array.from(conteoDocsMap.values()).filter(item => item.count > 1);

    return {
        docsNutricion,
        totalRegistros,
        duplicados
    };
}

async function generarReporteExcelFaltantes(faltantes, duplicados, totalActivos, totalUnicosNutricion, totalRegistrosNutricion) {
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
    const worksheet = workbook.addWorksheet('Faltantes Nutricion');

    // Titulo y Resumen
    worksheet.mergeCells('A1:H1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'REPORTE DE NINOS FALTANTES POR VALORACION NUTRICIONAL';
    titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F4E78' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(1).height = 30;

    worksheet.getCell('A3').value = 'Total Beneficiarios Activos:';
    worksheet.getCell('B3').value = totalActivos;
    worksheet.getCell('A4').value = 'Total Beneficiarios Unicos en Nutricion:';
    worksheet.getCell('B4').value = totalUnicosNutricion;
    worksheet.getCell('A5').value = 'Total Registros Totales en Nutricion:';
    worksheet.getCell('B5').value = totalRegistrosNutricion;
    worksheet.getCell('A6').value = 'Total Ninos Faltantes por Nutricion:';
    worksheet.getCell('B6').value = faltantes.length;
    worksheet.getCell('B6').font = { bold: true, color: { argb: 'C00000' } };

    // Encabezados de Tabla (Fila 8)
    const headers = [
        '#',
        'Codigo UDS',
        'Unidad de Servicio (Jardin)',
        'Tipo Doc.',
        'Numero de Documento',
        'Nombre Completo del Beneficiario',
        'Estado',
        'Observacion'
    ];

    const headerRow = worksheet.getRow(8);
    headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2F5597' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    headerRow.height = 24;

    // Llenar datos de faltantes
    faltantes.forEach((nino, index) => {
        const row = worksheet.getRow(9 + index);
        row.getCell(1).value = index + 1;
        row.getCell(2).value = nino.codigoUds;
        row.getCell(3).value = nino.jardin;
        row.getCell(4).value = nino.tipoDoc;
        row.getCell(5).value = nino.documentoRaw;
        row.getCell(6).value = nino.nombreCompleto;
        row.getCell(7).value = nino.estado;
        row.getCell(8).value = 'Falta registro de valoracion nutricional en Cuentame';

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

    // Hoja 2: Beneficiarios con Doble Toma (Duplicados)
    if (duplicados.length > 0) {
        const wsDup = workbook.addWorksheet('Doble Toma (Duplicados)');
        wsDup.mergeCells('A1:F1');
        const tCellDup = wsDup.getCell('A1');
        tCellDup.value = 'BENEFICIARIOS CON DOBLE TOMA EN EL REPORTE DE NUTRICION';
        tCellDup.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFF' } };
        tCellDup.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'C65911' } };
        tCellDup.alignment = { horizontal: 'center', vertical: 'middle' };
        wsDup.getRow(1).height = 30;

        const headersDup = ['#', 'Numero de Documento', 'Nombre Completo del Beneficiario', 'Unidad de Servicio (Jardin)', 'Tomas Registradas en el Mes', 'Observacion'];
        const hRowDup = wsDup.getRow(3);
        headersDup.forEach((h, i) => {
            const cell = hRowDup.getCell(i + 1);
            cell.value = h;
            cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'ED7D31' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });

        duplicados.forEach((item, index) => {
            const row = wsDup.getRow(4 + index);
            row.getCell(1).value = index + 1;
            row.getCell(2).value = item.documentoRaw;
            row.getCell(3).value = item.nombreCompleto;
            row.getCell(4).value = item.jardin;
            row.getCell(5).value = item.count;
            row.getCell(6).value = `El beneficiario tiene ${item.count} tomas registradas en el mes (Doble toma)`;
            
            row.getCell(1).alignment = { horizontal: 'center' };
            row.getCell(2).alignment = { horizontal: 'center' };
            row.getCell(5).alignment = { horizontal: 'center' };
        });

        wsDup.columns.forEach((col, idx) => {
            let maxLen = headersDup[idx] ? headersDup[idx].length : 12;
            wsDup.eachRow({ includeEmpty: false }, (row, rowNum) => {
                if (rowNum >= 3) {
                    const val = row.getCell(idx + 1).value;
                    if (val) {
                        const len = String(val).length;
                        if (len > maxLen) maxLen = len;
                    }
                }
            });
            col.width = Math.min(maxLen + 4, 45);
        });
    }

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

function pedirParejaReportes() {
    const reportesDir = path.join(__dirname, '..', 'reportes');
    let archivos = [];
    if (fs.existsSync(reportesDir)) {
        archivos = fs.readdirSync(reportesDir).filter(f => !f.startsWith('~') && !f.startsWith('Reporte_Faltantes_') && (f.endsWith('.xlsx') || f.endsWith('.xls') || f.endsWith('.csv')));
    }

    if (archivos.length === 0) {
        console.log(c.rojo('\n  ❌ No se encontraron archivos de reportes en la carpeta "reportes".'));
        console.log(c.amarillo('     Primero descarga los reportes desde la Opcion 2 de AutoTrabajo.\n'));
        return null;
    }

    let idxActivosDef = archivos.findIndex(f => f.toLowerCase().includes('beneficiario') || f.toLowerCase().includes('activo'));
    let idxNutricionDef = archivos.findIndex(f => f.toLowerCase().includes('nutricion') || f.toLowerCase().includes('peso'));

    if (idxActivosDef === -1) idxActivosDef = 0;
    if (idxNutricionDef === -1) idxNutricionDef = archivos.length > 1 ? 1 : 0;

    const sugerenciaStr = `${idxActivosDef + 1},${idxNutricionDef + 1}`;

    console.log(c.cyan(`\n  📂 Archivos de reportes disponibles en "reportes":`));
    archivos.forEach((nombre, i) => {
        let tag = '';
        if (i === idxActivosDef) tag += c.verde(' [Activos]');
        if (i === idxNutricionDef) tag += c.cyan(' [Nutricion]');
        console.log(`  ${i + 1}. ${nombre}${tag}`);
    });

    console.log(c.cyan(`\n  💡 Seleccion por comas:`));
    console.log(c.gris('     • Ingresa los 2 numeros separados por coma (ejemplo: 1,2)'));
    console.log(c.gris('       - 1er numero = Reporte de BENEFICIARIOS ACTIVOS'));
    console.log(c.gris('       - 2do numero = Reporte de SEGUIMIENTO NUTRICIONAL'));
    console.log(c.verde(`     • O presiona ENTER para usar la pareja recomendada [${sugerenciaStr}]`));
    console.log(c.amarillo(`     • O ingresa 0 para Volver al menu principal`));

    const inputRaw = readline.question(c.negrita(`\n  > Ingresa seleccion (ej: 1,2 , 0 para Atras) [Default ${sugerenciaStr}]: `)).trim();
    const rawUpper = inputRaw.toUpperCase();
    if (rawUpper === '0' || rawUpper === 'ATRAS' || rawUpper === 'SALIR' || rawUpper === 'CANCELAR') {
        return null;
    }

    let numActivos = idxActivosDef + 1;
    let numNutricion = idxNutricionDef + 1;

    if (inputRaw !== '') {
        const partes = inputRaw.split(/[,;\s]+/).map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n));
        if (partes.length >= 2) {
            numActivos = partes[0];
            numNutricion = partes[1];
        } else if (partes.length === 1) {
            numActivos = partes[0];
        } else {
            const ruta = resolverRutaConEspeciales(inputRaw);
            return { rutaActivos: ruta, rutaNutricion: null };
        }
    }

    if (numActivos < 1 || numActivos > archivos.length || numNutricion < 1 || numNutricion > archivos.length) {
        console.log(c.rojo('\n  ❌ Numeros de seleccion fuera de rango.'));
        return null;
    }

    const archivoActivos = archivos[numActivos - 1];
    const archivoNutricion = archivos[numNutricion - 1];

    console.log(c.verde(`\n  ✅ Beneficiarios Activos: ${archivoActivos}`));
    console.log(c.verde(`  ✅ Seguimiento Nutricional: ${archivoNutricion}`));

    return {
        rutaActivos: path.join(reportesDir, archivoActivos),
        rutaNutricion: path.join(reportesDir, archivoNutricion)
    };
}

async function main() {
    console.clear();
    console.log(c.cyan(`
  ╔════════════════════════════════════════════════════════════════════╗
  ║     📊 COMPARADOR: BENEFICIARIOS ACTIVOS VS SEGUIMIENTO NUTRICIONAL║
  ╚════════════════════════════════════════════════════════════════════╝
    `));
    console.log(c.gris('  Este script compara los reportes originales de Cuentame para identificar que ninos faltan por Nutricion.\n'));

    try {
        const respDescargar = readline.question(c.negrita('  > Deseas actualizar y descargar los reportes desde Cuentame ahora? (s/n) [por defecto s]: ')).trim().toLowerCase();

        if (respDescargar === '' || respDescargar === 's' || respDescargar === 'si' || respDescargar === 'y') {
            console.log(c.cyan('\n  📥 Iniciando modulo de Descarga de Reportes en Cuentame...\n'));
            try {
                const { spawnSync } = require('child_process');
                const scriptReportes = path.join(__dirname, 'descargar-reportes.js');
                spawnSync(process.execPath, [scriptReportes], { stdio: 'inherit' });
            } catch(e) {
                console.log(c.rojo(`  ⚠️ Error ejecutando descarga de reportes: ${e.message}`));
            }
        }

        while (true) {
            const pareja = pedirParejaReportes();
            if (!pareja || !pareja.rutaActivos) {
                console.log(c.amarillo('\n  👋 Volviendo al panel principal...'));
                break;
            }

            let rutaActivos = pareja.rutaActivos;
            let rutaNutricion = pareja.rutaNutricion;

            if (!rutaNutricion) {
                const seg = pedirParejaReportes();
                if (!seg) break;
                rutaNutricion = seg.rutaActivos;
            }

            if (!fs.existsSync(rutaActivos) || !fs.existsSync(rutaNutricion)) {
                console.log(c.rojo(`  ❌ Uno de los archivos no existe en disco. Intenta nuevamente.\n`));
                continue;
            }

            console.log(c.amarillo('\n  ⏳ Analizando y cruzando datos de ambos reportes...'));

            const ninosActivos = extraerNinosActivos(rutaActivos);
            const { docsNutricion, totalRegistros, duplicados } = extraerNinosNutricion(rutaNutricion);

            if (ninosActivos.length === 0) {
                console.log(c.rojo('  ❌ No se encontraron beneficiarios activos validos en el primer reporte. Revisa el archivo.'));
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
            const rutaExcelGenerado = await generarReporteExcelFaltantes(faltantes, duplicados, ninosActivos.length, docsNutricion.size, totalRegistros);

            // Mostrar resumen en consola
            console.log(c.verde('\n========================================================================================'));
            console.log(c.verde('  🎉 RESULTADO DE LA COMPARACION DE BENEFICIARIOS'));
            console.log(c.verde('========================================================================================'));
            console.log(`  • Beneficiarios activos en Cuentame:    ${c.bold(ninosActivos.length)}`);
            console.log(`  • Beneficiarios unicos en Nutricion:    ${c.bold(docsNutricion.size)} (Total registros en Excel: ${totalRegistros})`);
            console.log(`  • Desfase / Faltantes por Nutricion:   ${c.rojo(c.bold(faltantes.length + ' beneficiario(s)'))}`);
            console.log(`  • Beneficiarios con DOBLE TOMA:         ${c.amarillo(c.bold(duplicados.length + ' beneficiario(s)'))}\n`);

            if (faltantes.length > 0) {
                console.log(c.cyan('  📋 NOMBRES DE LOS BENEFICIARIOS FALTANTES EN NUTRICION:\n'));
                faltantes.forEach((f, idx) => {
                    console.log(`  ${idx + 1}. Documento: ${c.bold(f.documentoRaw.padEnd(12))} | Nombre: ${c.verde(f.nombreCompleto)} | UDS: ${c.amarillo(f.jardin)}`);
                });
                console.log('');
            } else {
                console.log(c.verde('  ✅ ¡Perfecto! Todos los beneficiarios activos cuentan con registro de Nutricion.\n'));
            }

            if (duplicados.length > 0) {
                console.log(c.amarillo('  ⚠️ NOMBRES DE LOS BENEFICIARIOS CON DOBLE TOMA (DUPLICADOS EN NUTRICION):\n'));
                duplicados.forEach((d, idx) => {
                    console.log(`  ${idx + 1}. Documento: ${c.bold(d.documentoRaw.padEnd(12))} | Nombre: ${c.amarillo(d.nombreCompleto)} | UDS: ${c.cyan(d.jardin)} | Tomas: ${c.bold(d.count + ' registros en el mes')}`);
                });
                console.log('');
            }

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
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };
