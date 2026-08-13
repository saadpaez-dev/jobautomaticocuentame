/**
 * automatizaciones/prellenar-formatos.js
 * 
 * Lee el archivo de Beneficiarios Activos o Seguimiento Nutricional descargado de Cuéntame
 * y genera un Formato de Peso y Talla pre-llenado (basado en docs/formato peso y talla.xlsx)
 * para cada UDS / Jardín.
 * 
 * Llena únicamente:
 *  - Encabezado: Nombre EAS / Asociación y Nombre UDS / Jardín.
 *  - Filas de Niños: # Orden, Documento, Nombres, Apellidos, Sexo (H/M), Fecha Nacimiento, Fecha Ingreso.
 * Dejando en blanco los campos de mediciones nutricionales para el diligenciamiento de las Madres Comunitarias.
 */

const ExcelJS = require('exceljs');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const readline = require('readline-sync');
const picocolors = require('picocolors');

const c = {
    verde: str => picocolors.green(str),
    cyan: str => picocolors.cyan(str),
    amarillo: str => picocolors.yellow(str),
    rojo: str => picocolors.red(str),
    gris: str => picocolors.gray(str),
    negrita: str => picocolors.bold(str)
};

function removeAccents(str) {
    if (!str) return '';
    return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}

function normalizarDoc(val) {
    if (val === undefined || val === null) return '';
    return String(val).replace(/[^a-zA-Z0-9]/g, '').trim().toUpperCase();
}

function normalizarFecha(val) {
    if (!val) return '';
    if (typeof val === 'number') {
        const dateObj = xlsx.SSF.parse_date_code(val);
        if (dateObj) {
            const d = String(dateObj.d).padStart(2, '0');
            const m = String(dateObj.m).padStart(2, '0');
            const y = dateObj.y;
            return `${d}/${m}/${y}`;
        }
    }
    const str = String(val).trim();
    const parts = str.split(/[\/-]/);
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
    return str;
}

function detectarColumnas(headers) {
    const mapa = {
        documento: -1,
        nombres: -1,
        apellidos: -1,
        nombreCompleto: -1,
        sexo: -1,
        fechaNacimiento: -1,
        fechaIngreso: -1,
        uds: -1,
        eas: -1
    };

    headers.forEach((h, idx) => {
        const clean = removeAccents(h);
        
        // Documento
        if (mapa.documento === -1 && (clean.includes('DOCUMENTO') || clean.includes('IDENTIFICACION') || clean.includes('NUIP') || clean.includes('NUM_DOC'))) {
            mapa.documento = idx;
        }
        // Nombres
        if (clean.includes('PRIMER NOMBRE') || clean.includes('NOMBRES')) {
            mapa.nombres = idx;
        }
        // Apellidos
        if (clean.includes('PRIMER APELLIDO') || clean.includes('APELLIDOS')) {
            mapa.apellidos = idx;
        }
        // Nombre Completo si no hay nombres/apellidos separados
        if (clean.includes('BENEFICIARIO') || clean.includes('NOMBRE COMPLETO') || clean.includes('NOMBRE DEL BENEFICIARIO')) {
            mapa.nombreCompleto = idx;
        }
        // Sexo
        if (mapa.sexo === -1 && (clean.includes('SEXO') || clean.includes('GENERO'))) {
            mapa.sexo = idx;
        }
        // Fecha Nacimiento
        if (mapa.fechaNacimiento === -1 && (clean.includes('NACIMIENTO') || clean.includes('FEC_NAC'))) {
            mapa.fechaNacimiento = idx;
        }
        // Fecha Ingreso
        if (mapa.fechaIngreso === -1 && (clean.includes('INGRESO') || clean.includes('VINCULACION') || clean.includes('ATENCION') || clean.includes('APERTURA'))) {
            mapa.fechaIngreso = idx;
        }
        // UDS
        if (mapa.uds === -1 && (clean.includes('UNIDAD DE SERVICIO') || clean.includes('NOMBRE UDS') || clean.includes('UDS') || clean.includes('JARDIN'))) {
            mapa.uds = idx;
        }
        // EAS
        if (mapa.eas === -1 && (clean.includes('ENTIDAD ADMINISTRADORA') || clean.includes('EAS') || clean.includes('ASOCIACION'))) {
            mapa.eas = idx;
        }
    });

    return mapa;
}

function parsearExcelReporte(rutaArchivo) {
    const workbook = xlsx.readFile(rutaArchivo, { cellDates: true, cellText: false });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (!rows || rows.length === 0) {
        throw new Error('El archivo Excel está vacío.');
    }

    // Buscar la fila de encabezados en las primeras 25 filas
    let headerRowIdx = -1;
    let mapaCols = null;

    for (let i = 0; i < Math.min(25, rows.length); i++) {
        const row = rows[i].map(c => String(c).trim());
        const mapa = detectarColumnas(row);
        if (mapa.documento !== -1 && (mapa.nombres !== -1 || mapa.apellidos !== -1 || mapa.nombreCompleto !== -1)) {
            headerRowIdx = i;
            mapaCols = mapa;
            break;
        }
    }

    if (headerRowIdx === -1 || !mapaCols) {
        throw new Error('No se detectó una estructura válida de reporte de Cuéntame (faltan columnas de Documento / Nombre / UDS).');
    }

    const agrupadoPorUds = {};

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const docRaw = row[mapaCols.documento];
        const docNorm = normalizarDoc(docRaw);
        if (!docNorm || docNorm.length < 3) continue;

        let nombres = mapaCols.nombres !== -1 ? String(row[mapaCols.nombres]).trim() : '';
        let apellidos = mapaCols.apellidos !== -1 ? String(row[mapaCols.apellidos]).trim() : '';

        if (!nombres && !apellidos && mapaCols.nombreCompleto !== -1) {
            const completo = String(row[mapaCols.nombreCompleto]).trim();
            const parts = completo.split(/\s+/);
            if (parts.length <= 2) {
                nombres = parts[0] || '';
                apellidos = parts[1] || '';
            } else {
                const mitad = Math.floor(parts.length / 2);
                nombres = parts.slice(0, mitad).join(' ');
                apellidos = parts.slice(mitad).join(' ');
            }
        }

        const sexoRaw = mapaCols.sexo !== -1 ? removeAccents(row[mapaCols.sexo]) : 'H';
        let sexoCod = 'H';
        if (sexoRaw.startsWith('M') || sexoRaw.includes('FEMEN') || sexoRaw.includes('MUJER')) {
            sexoCod = 'M';
        } else if (sexoRaw.startsWith('H') || sexoRaw.includes('MASC') || sexoRaw.includes('HOMB')) {
            sexoCod = 'H';
        }

        const fechaNacimiento = mapaCols.fechaNacimiento !== -1 ? normalizarFecha(row[mapaCols.fechaNacimiento]) : '';
        const fechaIngreso = mapaCols.fechaIngreso !== -1 ? normalizarFecha(row[mapaCols.fechaIngreso]) : '';
        const nombreUds = mapaCols.uds !== -1 && row[mapaCols.uds] ? String(row[mapaCols.uds]).trim().toUpperCase() : 'MI JARDIN';
        const nombreEas = mapaCols.eas !== -1 && row[mapaCols.eas] ? String(row[mapaCols.eas]).trim().toUpperCase() : 'ASOCIACION DE PADRES DE FAMILIA HCB MAFALDA';

        if (!agrupadoPorUds[nombreUds]) {
            agrupadoPorUds[nombreUds] = {
                nombreUds: nombreUds,
                nombreEas: nombreEas,
                ninos: []
            };
        }

        // Evitar duplicados por documento dentro de la misma UDS
        if (!agrupadoPorUds[nombreUds].ninos.some(n => n.documento === docNorm)) {
            agrupadoPorUds[nombreUds].ninos.push({
                documento: docNorm,
                nombres: nombres.toUpperCase(),
                apellidos: apellidos.toUpperCase(),
                sexo: sexoCod,
                fechaNacimiento,
                fechaIngreso
            });
        }
    }

    return agrupadoPorUds;
}

async function prellenarFormatoUds(datosUds, plantillaPath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(plantillaPath);
    const worksheet = workbook.getWorksheet(1);

    // 1. Encabezados (Fila 9)
    // E9 (Col 5): Nombre EAS / Asociación
    // X9 (Col 24): Nombre UDS / Jardín
    worksheet.getRow(9).getCell(5).value = datosUds.nombreEas;
    worksheet.getRow(9).getCell(24).value = datosUds.nombreUds;

    // 2. Llenar filas de beneficiarios desde la Fila 16
    const ninos = datosUds.ninos;
    const templateRow = worksheet.getRow(16);

    for (let i = 0; i < ninos.length; i++) {
        const nino = ninos[i];
        const rowNum = 16 + i;
        const row = worksheet.getRow(rowNum);

        // Copiar estilos de la fila plantilla para preservar bordes y tipografía
        for (let cCol = 1; cCol <= 31; cCol++) {
            const cell = row.getCell(cCol);
            const templateCell = templateRow.getCell(cCol);
            if (templateCell.style) {
                cell.style = JSON.parse(JSON.stringify(templateCell.style));
            }
        }

        row.getCell(1).value = i + 1;                  // No. DE ORDEN
        row.getCell(2).value = String(nino.documento); // NUIP
        row.getCell(3).value = String(nino.nombres);   // NOMBRES
        row.getCell(4).value = String(nino.apellidos); // APELLIDOS
        row.getCell(5).value = nino.sexo;              // Sexo (H/M)
        row.getCell(6).value = nino.fechaNacimiento;   // FECHA DE NACIMIENTO
        row.getCell(7).value = nino.fechaIngreso;      // FECHA DE INGRESO

        // Cols 8 a 31 se dejan en BLANCO para las Madres Comunitarias
        for (let cCol = 8; cCol <= 31; cCol++) {
            row.getCell(cCol).value = null;
        }

        row.commit();
    }

    return workbook;
}

async function main() {
    console.log(c.cyan('\n======================================================'));
    console.log(c.negrita(' 📝 PRE-LLENAR FORMATOS DE PESO Y TALLA (PARA MADRES COMUNITARIAS)'));
    console.log(c.cyan('======================================================\n'));

    const plantillaPath = path.join(__dirname, '..', 'docs', 'formato peso y talla.xlsx');
    if (!fs.existsSync(plantillaPath)) {
        console.log(c.rojo(`❌ No se encontró la plantilla virgen en: ${plantillaPath}`));
        return;
    }

    console.log(c.gris('Arrastra y suelta el reporte descargado de Cuéntame'));
    console.log(c.gris('(Beneficiarios Activos o Seguimiento Nutricional).\n'));

    const inputPathRaw = readline.question(c.negrita('  > Arrastra el archivo Excel aquí: '));
    const inputPath = inputPathRaw.trim().replace(/^["']|["']$/g, '');

    if (!inputPath || !fs.existsSync(inputPath)) {
        console.log(c.rojo('\n  ❌ El archivo especificado no existe.'));
        return;
    }

    console.log(c.cyan('\n  ⏳ Analizando reporte y procesando niños activos por UDS...'));

    try {
        const agrupado = parsearExcelReporte(inputPath);
        const listaUds = Object.keys(agrupado);

        if (listaUds.length === 0) {
            console.log(c.rojo('  ❌ No se encontraron niños activos en el archivo reportado.'));
            return;
        }

        console.log(c.verde(`\n  ✅ Se detectaron ${listaUds.length} Jardines/UDS en el reporte:\n`));

        const dirDocs = path.join(__dirname, '..', 'docs', 'peso y talla');
        const dirReportes = path.join(__dirname, '..', 'reportes');

        if (!fs.existsSync(dirDocs)) fs.mkdirSync(dirDocs, { recursive: true });
        if (!fs.existsSync(dirReportes)) fs.mkdirSync(dirReportes, { recursive: true });

        const fechaHoy = new Date().toISOString().split('T')[0];

        for (let i = 0; i < listaUds.length; i++) {
            const nombreUds = listaUds[i];
            const datosUds = agrupado[nombreUds];

            console.log(`  ${i + 1}. ${c.cyan(nombreUds)}: ${c.verde(datosUds.ninos.length + ' niños activos')}`);

            const wbPrellenado = await prellenarFormatoUds(datosUds, plantillaPath);
            const nombreClean = nombreUds.replace(/[^a-z0-9]/gi, '_');
            const fileBaseName = `Formato_Prellenado_${nombreClean}_${fechaHoy}.xlsx`;

            const pathDocs = path.join(dirDocs, fileBaseName);
            const pathReportes = path.join(dirReportes, fileBaseName);

            await wbPrellenado.xlsx.writeFile(pathDocs);
            await wbPrellenado.xlsx.writeFile(pathReportes);

            console.log(c.gris(`     -> Guardado en: docs/peso y talla/${fileBaseName}`));
        }

        console.log(c.verde('\n  🎉 ¡Todos los formatos han sido pre-llenados exitosamente para las Madres Comunitarias!\n'));

    } catch (err) {
        console.log(c.rojo(`\n  ❌ Error procesando el archivo: ${err.message}`));
    }
}

if (require.main === module) {
    main().finally(() => process.exit(0));
}

module.exports = { parsearExcelReporte, prellenarFormatoUds };
