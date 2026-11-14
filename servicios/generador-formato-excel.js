/**
 * servicios/generador-formato-excel.js
 * Genera el archivo Excel oficial 'Formato Captura de Datos Antropometricos'
 * diligenciando la plantilla oficial con los datos de los ninos de la UDS.
 */

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

async function generarExcelPesoYTalla({ asociacion, nombreUds, codigoUds, ninos = [], tomaNumero = 2, fechaTomaDefecto = '' }) {
    const plantillaPath = path.join(__dirname, '..', 'docs', 'formato peso y talla.xlsx');
    if (!fs.existsSync(plantillaPath)) {
        throw new Error('No se encontró la plantilla oficial en docs/formato peso y talla.xlsx');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(plantillaPath);
    const worksheet = workbook.getWorksheet('Formato captura') || workbook.getWorksheet(1);

    // Encabezado
    // Fila 9: Col E (5) = EAS / Asociacion, Col X (24) = UDS / Jardin
    if (asociacion) {
        worksheet.getRow(9).getCell(5).value = String(asociacion).toUpperCase();
    }
    if (nombreUds) {
        worksheet.getRow(9).getCell(24).value = String(nombreUds).toUpperCase();
    }

    const templateRow = worksheet.getRow(16);

    for (let i = 0; i < ninos.length; i++) {
        const nino = ninos[i];
        const rowNum = 16 + i;
        const row = worksheet.getRow(rowNum);

        // Copiar estilos de celda desde la fila 16
        for (let c = 1; c <= 31; c++) {
            const cell = row.getCell(c);
            const tmpl = templateRow.getCell(c);
            if (tmpl.style) {
                cell.style = JSON.parse(JSON.stringify(tmpl.style));
            }
        }

        row.getCell(1).value = i + 1; // A: No. DE ORDEN
        row.getCell(2).value = String(nino.documento || '').trim(); // B: NUIP
        row.getCell(3).value = String(nino.nombres || [nino.pNombre, nino.sNombre].filter(Boolean).join(' ') || '').toUpperCase(); // C: Nombres
        row.getCell(4).value = String(nino.apellidos || [nino.pApell, nino.sApell].filter(Boolean).join(' ') || '').toUpperCase(); // D: Apellidos
        
        const s = String(nino.sexo || '').toUpperCase();
        row.getCell(5).value = (s.includes('MUJ') || s === 'M' || s === 'F') ? 'M' : 'H'; // E: Sexo
        
        row.getCell(6).value = nino.fechaNacimiento || ''; // F: Fecha Nac
        row.getCell(7).value = nino.fechaIngreso || nino.fechaVinculacion || '01/02/2026'; // G: Fecha Ingreso

        const fToma = nino.fechaToma || fechaTomaDefecto || '';
        const peso = nino.peso ? parseFloat(nino.peso) : null;
        const talla = nino.talla ? parseFloat(nino.talla) : null;
        const pb = nino.perimetroBraquial ? parseFloat(nino.perimetroBraquial) : null;

        // Ubicación de columnas por toma
        // Si es Toma 1: Cols H (8), I (9), J (10), K (11)
        // Si es Toma 2 o superior: Cols T (20), U (21), V (22), W (23)
        if (tomaNumero === 1) {
            row.getCell(8).value = fToma;
            row.getCell(9).value = peso;
            row.getCell(10).value = talla;
            row.getCell(11).value = pb;
        } else {
            // Si tiene datos anteriores (Toma 1 previa)
            if (nino.pesoPrevio) {
                row.getCell(8).value = nino.fechaTomaPrevia || '';
                row.getCell(9).value = parseFloat(nino.pesoPrevio) || null;
                row.getCell(10).value = parseFloat(nino.tallaPrevia) || null;
            }
            // Toma actual en Cols T, U, V, W
            row.getCell(20).value = fToma;
            row.getCell(21).value = peso;
            row.getCell(22).value = talla;
            row.getCell(23).value = pb;
        }

        row.commit();
    }

    return workbook;
}

module.exports = { generarExcelPesoYTalla };
