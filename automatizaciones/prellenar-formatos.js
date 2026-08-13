/**
 * automatizaciones/prellenar-formatos.js
 * 
 * Lee el Reporte de Nutrición / Activos descargado de Cuéntame
 * y genera un Formato de Peso y Talla independiente pre-llenado (basado en docs/formato peso y talla.xlsx)
 * para cada Jardín / UDS.
 * 
 * Mapeo exacto de columnas del Reporte Nutricional:
 *  - Col E (index 4 / E3): Nombre Entidad Contratista (EAS) -> Celda E9 del formato.
 *  - Col G (index 6): Nombre de la UDS / Jardín -> Celda X9 del formato (agrupa los niños por Jardín).
 *  - Col K (index 10): Numero Documento Beneficiario -> Col B del formato (B16 en adelante).
 *  - Col N + O (index 13 + 14): Primer y Segundo Nombre -> Col C del formato (C16 en adelante).
 *  - Col L + M (index 11 + 12): Primer y Segundo Apellido -> Col D del formato (D16 en adelante).
 *  - Sexo: H (Hombre) / M (Mujer) -> Col E del formato (E16 en adelante).
 *  - Col R (index 17): Fecha Nacimiento -> Col F del formato (F16 en adelante).
 *  - Col S (index 18): Fecha Ingreso al programa -> Col G del formato (G16 en adelante).
 * 
 * Quedan totalmente en blanco las casillas nutricionales (Cols H a AE) para el llenado de las Madres Comunitarias.
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
    return String(val).replace(/[^0-9Kk]/g, '').trim().toUpperCase();
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

function detectarMapaColumnas(headers) {
    const mapa = {
        eas: 4,              // Col E
        uds: 6,              // Col G
        documento: 10,       // Col K
        pApellido: 11,       // Col L
        sApellido: 12,       // Col M
        pNombre: 13,         // Col N
        sNombre: 14,         // Col O
        sexo: -1,
        fechaNacimiento: 17, // Col R
        fechaIngreso: 18     // Col S
    };

    headers.forEach((h, idx) => {
        const clean = removeAccents(h);

        if (clean.includes('ENTIDAD') || clean.includes('CONTRATISTA') || clean.includes('EAS')) {
            mapa.eas = idx;
        } else if (clean.includes('UNIDAD DE SERVICIO') || clean.includes('NOMBRE UDS') || clean.includes('JARDIN')) {
            mapa.uds = idx;
        } else if (clean.includes('NUMERO DOCUMENTO') || clean.includes('DOCUMENTO BENEFICIARIO') || clean.includes('NUIP')) {
            mapa.documento = idx;
        } else if (clean.includes('PRIMER APELLIDO')) {
            mapa.pApellido = idx;
        } else if (clean.includes('SEGUNDO APELLIDO')) {
            mapa.sApellido = idx;
        } else if (clean.includes('PRIMER NOMBRE')) {
            mapa.pNombre = idx;
        } else if (clean.includes('SEGUNDO NOMBRE')) {
            mapa.sNombre = idx;
        } else if (clean.includes('NACIMIENTO') || clean.includes('FEC_NAC')) {
            mapa.fechaNacimiento = idx;
        } else if (clean.includes('INGRESO AL PROGRAMA') || clean.includes('FECHA INGRESO') || clean.includes('VINCULACION')) {
            mapa.fechaIngreso = idx;
        } else if (clean.includes('SEXO') || clean.includes('GENERO')) {
            mapa.sexo = idx;
        }
    });

    return mapa;
}

function parsearReporteNutricional(rutaArchivo) {
    const workbook = xlsx.readFile(rutaArchivo, { cellDates: true, cellText: false });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (!rows || rows.length === 0) {
        throw new Error('El archivo Excel está vacío.');
    }

    // EAS global de E3 si existe
    let easGlobal = '';
    for (let i = 0; i < Math.min(10, rows.length); i++) {
        if (rows[i] && rows[i][4]) { // Col E
            const val = String(rows[i][4]).trim();
            if (val.toUpperCase().includes('ASOCIACION') || val.toUpperCase().includes('ENTIDAD') || val.toUpperCase().includes('HOGARES')) {
                easGlobal = val;
                break;
            }
        }
    }

    // Buscar fila de encabezados
    let headerRowIdx = -1;
    let mapa = null;

    for (let i = 0; i < Math.min(25, rows.length); i++) {
        const row = rows[i].map(c => String(c).trim());
        const tempMapa = detectarMapaColumnas(row);
        const hasDoc = tempMapa.documento !== -1 && row[tempMapa.documento] && removeAccents(row[tempMapa.documento]).includes('DOCUMENTO');
        const hasUds = tempMapa.uds !== -1 && row[tempMapa.uds] && (removeAccents(row[tempMapa.uds]).includes('UDS') || removeAccents(row[tempMapa.uds]).includes('UNIDAD'));
        
        if (hasDoc || hasUds) {
            headerRowIdx = i;
            mapa = tempMapa;
            break;
        }
    }

    if (headerRowIdx === -1 || !mapa) {
        headerRowIdx = 0;
        mapa = detectarMapaColumnas(rows[0] ? rows[0].map(c => String(c).trim()) : []);
    }

    const agrupadoPorUds = {};

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const docRaw = row[mapa.documento];
        const docNorm = normalizarDoc(docRaw);
        if (!docNorm || docNorm.length < 3) continue;

        const pNom = String(row[mapa.pNombre] || '').trim();
        const sNom = String(row[mapa.sNombre] || '').trim();
        const nombres = (pNom + (sNom ? ' ' + sNom : '')).toUpperCase().trim();

        const pApe = String(row[mapa.pApellido] || '').trim();
        const sApe = String(row[mapa.sApellido] || '').trim();
        const apellidos = (pApe + (sApe ? ' ' + sApe : '')).toUpperCase().trim();

        // Sexo
        let sexoCod = 'H';
        if (mapa.sexo !== -1 && row[mapa.sexo]) {
            const sUpper = removeAccents(String(row[mapa.sexo])).toUpperCase();
            if (sUpper.startsWith('M') || sUpper.includes('FEMEN') || sUpper.includes('MUJER')) sexoCod = 'M';
            else if (sUpper.startsWith('H') || sUpper.includes('MASC') || sUpper.includes('HOMB')) sexoCod = 'H';
        } else {
            // Intentar buscar en otras celdas de la fila si alguna dice MASCULINO/FEMENINO
            const rowStr = row.map(c => removeAccents(String(c))).join(' ').toUpperCase();
            if (rowStr.includes('FEMENINO') || rowStr.includes('MUJER')) sexoCod = 'M';
            else if (rowStr.includes('MASCULINO') || rowStr.includes('HOMBRE')) sexoCod = 'H';
        }

        const fechaNacimiento = mapa.fechaNacimiento !== -1 ? normalizarFecha(row[mapa.fechaNacimiento]) : '';
        const fechaIngreso = mapa.fechaIngreso !== -1 ? normalizarFecha(row[mapa.fechaIngreso]) : '';
        
        const nombreUds = mapa.uds !== -1 && row[mapa.uds] ? String(row[mapa.uds]).trim().toUpperCase() : 'MI JARDIN';
        const nombreEas = mapa.eas !== -1 && row[mapa.eas] ? String(row[mapa.eas]).trim().toUpperCase() : (easGlobal || 'ASOCIACION PADRES USUARIOS DE LOS HOGARES DEL BIENESTAR BARRIOS UNIDOS DEL NORTE DE SAN CRISTOBAL');

        if (!agrupadoPorUds[nombreUds]) {
            agrupadoPorUds[nombreUds] = {
                nombreUds: nombreUds,
                nombreEas: nombreEas,
                ninos: []
            };
        }

        if (!agrupadoPorUds[nombreUds].ninos.some(n => n.documento === docNorm)) {
            agrupadoPorUds[nombreUds].ninos.push({
                documento: docNorm,
                nombres: nombres || 'N/A',
                apellidos: apellidos || 'N/A',
                sexo: sexoCod,
                fechaNacimiento,
                fechaIngreso
            });
        }
    }

    return agrupadoPorUds;
}

async function generarFormatoPesoYTallaUds(datosUds, plantillaPath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(plantillaPath);
    const worksheet = workbook.getWorksheet(1);

    // 1. Encabezado de la planilla
    // E9 (Col 5): Nombre de la Entidad Administradora de Servicio (EAS / Asociación)
    // X9 (Col 24): Nombre de la Unidad de Servicio (UDS / Jardín)
    worksheet.getRow(9).getCell(5).value = datosUds.nombreEas;
    worksheet.getRow(9).getCell(24).value = datosUds.nombreUds;

    // 2. Filas de Beneficiarios (desde la fila 16)
    const ninos = datosUds.ninos;
    const templateRow = worksheet.getRow(16);

    for (let i = 0; i < ninos.length; i++) {
        const nino = ninos[i];
        const rowNum = 16 + i;
        const row = worksheet.getRow(rowNum);

        // Copiar formato y bordes desde la fila 16 original
        for (let cCol = 1; cCol <= 31; cCol++) {
            const cell = row.getCell(cCol);
            const templateCell = templateRow.getCell(cCol);
            if (templateCell.style) {
                cell.style = JSON.parse(JSON.stringify(templateCell.style));
            }
        }

        row.getCell(1).value = i + 1;                  // A: No. DE ORDEN
        row.getCell(2).value = String(nino.documento); // B: NUIP (Sólo número de documento)
        row.getCell(3).value = String(nino.nombres);   // C: NOMBRES (Primer + Segundo Nombre)
        row.getCell(4).value = String(nino.apellidos); // D: APELLIDOS (Primer + Segundo Apellido)
        row.getCell(5).value = nino.sexo;              // E: Sexo (H / M)
        row.getCell(6).value = nino.fechaNacimiento;   // F: FECHA DE NACIMIENTO (dd/mm/aaaa)
        row.getCell(7).value = nino.fechaIngreso;      // G: FECHA DE INGRESO AL SERVICIO (dd/mm/aaaa)

        // Cols H a AE (8 a 31) se dejan en blanco para el diligenciamiento de la Madre Comunitaria
        for (let cCol = 8; cCol <= 31; cCol++) {
            row.getCell(cCol).value = null;
        }

        row.commit();
    }

    return workbook;
}

async function main() {
    console.log(c.cyan('\n========================================================================'));
    console.log(c.negrita(' 📝 PRE-LLENAR FORMATOS INDEPENDIENTES DE PESO Y TALLA (POR JARDÍN)'));
    console.log(c.cyan('========================================================================\n'));

    const plantillaPath = path.join(__dirname, '..', 'docs', 'formato peso y talla.xlsx');
    if (!fs.existsSync(plantillaPath)) {
        console.log(c.rojo(`❌ No se encontró la plantilla virgen en: ${plantillaPath}`));
        return;
    }

    console.log(c.gris('Arrastra y suelta el Reporte Nutricional o de Activos descargado de Cuéntame.\n'));

    const inputPathRaw = readline.question(c.negrita('  > Arrastra el archivo Excel del Reporte Nutricional aquí: '));
    const inputPath = inputPathRaw.trim().replace(/^["']|["']$/g, '');

    if (!inputPath || !fs.existsSync(inputPath)) {
        console.log(c.rojo('\n  ❌ El archivo especificado no existe.'));
        return;
    }

    console.log(c.cyan('\n  ⏳ Analizando reporte y organizando beneficiarios por Jardín (UDS)...'));

    try {
        const agrupado = parsearReporteNutricional(inputPath);
        const listaUds = Object.keys(agrupado).sort();

        if (listaUds.length === 0) {
            console.log(c.rojo('  ❌ No se encontraron beneficiarios válidos en el archivo.'));
            return;
        }

        console.log(c.verde(`\n  ✅ Se identificaron ${listaUds.length} Jardines/UDS independientes:\n`));

        const dirDocs = path.join(__dirname, '..', 'docs', 'peso y talla');
        const dirReportes = path.join(__dirname, '..', 'reportes');

        if (!fs.existsSync(dirDocs)) fs.mkdirSync(dirDocs, { recursive: true });
        if (!fs.existsSync(dirReportes)) fs.mkdirSync(dirReportes, { recursive: true });

        const fechaHoy = new Date().toISOString().split('T')[0];

        for (let i = 0; i < listaUds.length; i++) {
            const nombreUds = listaUds[i];
            const datosUds = agrupado[nombreUds];

            console.log(`  ${i + 1}. ${c.cyan(nombreUds)}: ${c.verde(datosUds.ninos.length + ' niños')}`);

            const wbPrellenado = await generarFormatoPesoYTallaUds(datosUds, plantillaPath);
            const nombreClean = nombreUds.replace(/[^a-z0-9]/gi, '_');
            const fileBaseName = `Formato_Peso_Talla_${nombreClean}_${fechaHoy}.xlsx`;

            const pathDocs = path.join(dirDocs, fileBaseName);
            const pathReportes = path.join(dirReportes, fileBaseName);

            await wbPrellenado.xlsx.writeFile(pathDocs);
            await wbPrellenado.xlsx.writeFile(pathReportes);

            console.log(c.gris(`     -> Generado: docs/peso y talla/${fileBaseName}`));
        }

        console.log(c.verde('\n  🎉 ¡Todos los formatos de Peso y Talla por Jardín han sido generados exitosamente!\n'));

    } catch (err) {
        console.log(c.rojo(`\n  ❌ Error procesando el archivo: ${err.message}`));
    }
}

if (require.main === module) {
    main().finally(() => process.exit(0));
}

module.exports = { parsearReporteNutricional, generarFormatoPesoYTallaUds };
