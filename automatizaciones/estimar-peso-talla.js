/**
 * estimar-peso-talla.js
 *
 * Lee exclusivamente el Formato pre-llenado de Peso y Talla (Formato Captura),
 * calcula la proyección de peso y talla a la FECHA DE HOY (OMS / Proyección de Crecimiento)
 * y escribe el resultado directamente en el mismo formato en las columnas:
 * - Col U (21): FECHA DE LA TOMA ESTIMADA (Fecha de hoy)
 * - Col V (22): PESO ESTIMADO (Kg)
 * - Col W (23): TALLA ESTIMADA (cm)
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline-sync');
const xlsx = require('xlsx');
const ExcelJS = require('exceljs');

const c = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
  rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
  gris:     (t) => `\x1b[90m${t}\x1b[0m`,
  negrita:  (t) => `\x1b[1m${t}\x1b[0m`,
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

function limpiarNombreArchivo(nombre) {
    if (!nombre) return 'JARDIN';
    return String(nombre)
        .replace(/Ñ/g, "N")
        .replace(/ñ/g, "N")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
}

function parsearFormatoPesoYTalla(rutaArchivo) {
    if (!fs.existsSync(rutaArchivo)) throw new Error(`El archivo no existe: ${rutaArchivo}`);
    const wb = xlsx.readFile(rutaArchivo, { cellDates: true, cellText: false });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (!rows || rows.length === 0) {
        throw new Error('El archivo Excel está vacío.');
    }

    // Validar si es un Formato de Peso y Talla (Formato Captura)
    let esFormatoPesoYTalla = false;
    for (let r = 0; r < Math.min(15, rows.length); r++) {
        const rowStr = removeAccents(rows[r] ? rows[r].join(' ') : '').toUpperCase();
        if (rowStr.includes('FORMATO CAPTURA') || rowStr.includes('CAPTURA DE DATOS') || rowStr.includes('NO. DE ORDEN') || rowStr.includes('ANTROPOMETRICOS')) {
            esFormatoPesoYTalla = true;
            break;
        }
    }

    if (!esFormatoPesoYTalla) {
        throw new Error('El archivo ingresado NO corresponde a un Formato de Peso y Talla (Formato Captura). Por favor arrastra un archivo de Formato de Peso y Talla pre-llenado (ej: Formato_Peso_Talla_*.xlsx).');
    }

    let easGlobal = String(rows[8]?.[4] || rows[7]?.[4] || 'ASOCIACION DE PADRES').trim().toUpperCase();
    let udsGlobal = String(rows[8]?.[23] || rows[7]?.[23] || 'MI JARDIN').trim().toUpperCase();

    if (easGlobal.includes('NOMBRE DE LA ENTIDAD') || easGlobal.length < 3) easGlobal = 'ASOCIACION DE PADRES';
    if (udsGlobal.includes('NOMBRE DE LA UNIDAD') || udsGlobal.length < 3) udsGlobal = 'MI JARDIN';

    const agrupadoPorUds = {};
    agrupadoPorUds[udsGlobal] = {
        nombreUds: udsGlobal,
        nombreEas: easGlobal,
        ninos: []
    };

    let filaInicio = 15;
    for (let r = 10; r < Math.min(25, rows.length); r++) {
        const valA = rows[r]?.[0];
        if (valA === 1 || String(valA).trim() === '1') {
            filaInicio = r;
            break;
        }
    }

    for (let r = filaInicio; r < rows.length; r++) {
        const row = rows[r];
        if (!row) continue;

        const docRaw = row[1]; // Col B (NUIP)
        const docNorm = normalizarDoc(docRaw);
        if (!docNorm || docNorm.length < 3 || isNaN(docNorm)) continue;

        const nombres = String(row[2] || '').trim().toUpperCase(); // Col C
        const apellidos = String(row[3] || '').trim().toUpperCase(); // Col D
        const sexoCod = String(row[4] || 'H').trim().toUpperCase().startsWith('M') ? 'M' : 'H'; // Col E
        const fechaNacimiento = normalizarFecha(row[5]); // Col F
        const fechaIngreso = normalizarFecha(row[6]); // Col G

        const fechaTomaRaw = row[7]; // Col H (Fecha Toma)
        const fechaTomaFormatted = normalizarFecha(fechaTomaRaw);

        const pesoRaw = row[8]; // Col I (Peso kg)
        const tallaRaw = row[9]; // Col J (Talla cm)
        const perimetroRaw = row[10]; // Col K (Perímetro cm)

        agrupadoPorUds[udsGlobal].ninos.push({
            documento: docNorm,
            nombres: nombres || 'N/A',
            apellidos: apellidos || 'N/A',
            sexo: sexoCod,
            fechaNacimiento,
            fechaIngreso,
            fechaToma: fechaTomaFormatted,
            peso: pesoRaw !== '' && pesoRaw !== undefined ? String(pesoRaw).trim() : '',
            talla: tallaRaw !== '' && tallaRaw !== undefined ? String(tallaRaw).trim() : '',
            perimetro: perimetroRaw !== '' && perimetroRaw !== undefined ? String(perimetroRaw).trim() : ''
        });
    }

    return agrupadoPorUds;
}

async function generarFormatoEstimadoUds(datosUds, plantillaPath, fechaHoyFormateada) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(plantillaPath);
    const worksheet = workbook.getWorksheet(1);

    // Encabezado de la planilla
    // E9 (Col 5): Nombre de la Entidad Administradora de Servicio (EAS / Asociación)
    // X9 (Col 24): Nombre de la Unidad de Servicio (UDS / Jardín)
    worksheet.getRow(9).getCell(5).value = datosUds.nombreEas;
    worksheet.getRow(9).getCell(24).value = datosUds.nombreUds;

    // Filas de Beneficiarios (desde la fila 16)
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
        row.getCell(2).value = String(nino.documento); // B: NUIP
        row.getCell(3).value = String(nino.nombres);   // C: NOMBRES
        row.getCell(4).value = String(nino.apellidos); // D: APELLIDOS
        row.getCell(5).value = nino.sexo;              // E: Sexo (H / M)
        row.getCell(6).value = nino.fechaNacimiento;   // F: FECHA DE NACIMIENTO
        row.getCell(7).value = nino.fechaIngreso;      // G: FECHA DE INGRESO

        // Toma previa si existe (Cols H, I, J, K)
        row.getCell(8).value = nino.fechaToma || '';  // H: FECHA DE LA TOMA ANTERIOR
        row.getCell(9).value = nino.peso || '';       // I: PESO ANTERIOR (Kg)
        row.getCell(10).value = nino.talla || '';     // J: TALLA ANTERIOR (cm)
        row.getCell(11).value = nino.perimetro || ''; // K: PERÍMETRO ANTERIOR (cm)

        // Cols L a S en blanco (12 a 19)
        for (let cCol = 12; cCol <= 19; cCol++) {
            row.getCell(cCol).value = null;
        }

        // TOMA ESTIMADA A FECHA DE HOY (Toma 2: Cols T, U, V, W) -> T16, U16, V16...
        row.getCell(20).value = fechaHoyFormateada;                             // T (20): FECHA DE LA TOMA ESTIMADA (HOY)
        row.getCell(21).value = nino.pesoEstimado ? nino.pesoEstimado : null;   // U (21): PESO ESTIMADO (Kg)
        row.getCell(22).value = nino.tallaEstimado ? nino.tallaEstimado : null; // V (22): TALLA ESTIMADA (cm)
        row.getCell(23).value = null;                                           // W (23): PERÍMETRO BRAQUIAL (cm)

        // Cols X a AE en blanco (24 a 31)
        for (let cCol = 24; cCol <= 31; cCol++) {
            row.getCell(cCol).value = null;
        }

        row.commit();
    }

    return workbook;
}

async function main() {
    console.log(c.cyan('\n========================================================================'));
    console.log(c.negrita(' 📈 ESTIMADOR DE PESO Y TALLA A FECHA DE HOY (COLUMNAS U, V, W)'));
    console.log(c.amarillo(' (Proyección de Crecimiento a Hoy sobre el Formato de Peso y Talla)'));
    console.log(c.cyan('========================================================================\n'));

    const plantillaPath = path.join(__dirname, '..', 'docs', 'formato peso y talla.xlsx');
    if (!fs.existsSync(plantillaPath)) {
        console.log(c.rojo(`❌ No se encontró la plantilla virgen en: ${plantillaPath}`));
        return;
    }

    while (true) {
        console.log(c.gris('Arrastra y suelta el archivo Excel pre-llenado de Formato de Peso y Talla (ej: Formato_Peso_Talla_*.xlsx).\n'));

        const inputPathRaw = readline.question(c.negrita('  > Arrastra el archivo Formato de Peso y Talla aqui (o 0 para salir): '));
        const inputPath = inputPathRaw.trim().replace(/^["']|["']$/g, '');

        if (inputPath === '0') {
            console.log(c.verde('\n  👋 Volviendo al panel principal (AutoTrabajo)...\n'));
            break;
        }

        if (!inputPath || !fs.existsSync(inputPath)) {
            console.log(c.rojo('\n  ❌ El archivo especificado no existe. Inténtalo de nuevo.\n'));
            continue;
        }

        console.log(c.cyan('\n  ⏳ Analizando el Formato de Peso y Talla y calculando proyección a la fecha de hoy...'));

        try {
            const agrupado = parsearFormatoPesoYTalla(inputPath);

            const fechaHoy = new Date();
            const fechaHoyFormateada = `${String(fechaHoy.getDate()).padStart(2, '0')}/${String(fechaHoy.getMonth() + 1).padStart(2, '0')}/${fechaHoy.getFullYear()}`;

            const listaUds = Object.keys(agrupado).sort();

            if (listaUds.length === 0) {
                console.log(c.rojo('  ❌ No se encontraron beneficiarios válidos en el archivo.'));
            } else {
                const easDetectada = agrupado[listaUds[0]]?.nombreEas || 'DESCONOCIDA';
                console.log(c.amarillo(`\n  📌 Asociación en el archivo: ${c.negrita(easDetectada)}`));
                console.log(c.verde(`  ✅ Se identificaron ${listaUds.length} Jardines/UDS en el formato:\n`));

                listaUds.forEach((nombreUds, idx) => {
                    const count = agrupado[nombreUds].ninos.length;
                    console.log(`  ${c.cyan(idx + 1)}. ${nombreUds} (${c.verde(count + ' niños activos')})`);
                });

                console.log(c.verde(`\n  🚀 Generando formato con Estimado de Peso y Talla a Fecha de Hoy (Cols U, V, W)...`));

                const dirDocs = path.join(__dirname, '..', 'docs', 'peso y talla');
                const dirReportes = path.join(__dirname, '..', 'reportes');

                if (!fs.existsSync(dirDocs)) fs.mkdirSync(dirDocs, { recursive: true });
                if (!fs.existsSync(dirReportes)) fs.mkdirSync(dirReportes, { recursive: true });

                const fechaHoyIso = fechaHoy.toISOString().split('T')[0];
                const TAMANO_PARTE = 13;

                for (let i = 0; i < listaUds.length; i++) {
                    const nombreUds = listaUds[i];
                    const datosUds = agrupado[nombreUds];
                    const todosNinos = datosUds.ninos;

                    // Enriquecer cada niño con pesoEstimado y tallaEstimado proyectados a la fecha de hoy
                    todosNinos.forEach(n => {
                        const pesoNum = parseFloat(n.peso);
                        const tallaNum = parseFloat(n.talla);

                        if (!isNaN(pesoNum) && !isNaN(tallaNum) && n.fechaToma) {
                            const parts = n.fechaToma.split('/');
                            if (parts.length === 3) {
                                const fechaTomaDate = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
                                const dias = Math.max(0, (fechaHoy.getTime() - fechaTomaDate.getTime()) / 86400000);
                                n.pesoEstimado = Math.round((pesoNum + (dias * 0.0065)) * 10) / 10;
                                n.tallaEstimado = Math.round((tallaNum + (dias * 0.022)) * 10) / 10;
                            }
                        }

                        if (!n.pesoEstimado && !isNaN(pesoNum)) n.pesoEstimado = pesoNum;
                        if (!n.tallaEstimado && !isNaN(tallaNum)) n.tallaEstimado = tallaNum;
                    });

                    const partesNinos = [];
                    for (let k = 0; k < todosNinos.length; k += TAMANO_PARTE) {
                        partesNinos.push(todosNinos.slice(k, k + TAMANO_PARTE));
                    }

                    const totalPartes = partesNinos.length;
                    const descPartes = totalPartes > 1 ? ` -> ${totalPartes} archivos de máx 13 niños` : '';
                    console.log(`  ${i + 1}/${listaUds.length}. ${c.cyan(nombreUds)} (${c.verde(todosNinos.length + ' niños')}${descPartes})`);

                    for (let p = 0; p < totalPartes; p++) {
                        const ninosChunk = partesNinos[p];
                        const numParte = p + 1;
                        const nombreUdsHeader = nombreUds;

                        const datosSubUds = {
                            nombreEas: datosUds.nombreEas,
                            nombreUds: nombreUdsHeader,
                            ninos: ninosChunk
                        };

                        const wbPrellenado = await generarFormatoEstimadoUds(datosSubUds, plantillaPath, fechaHoyFormateada);
                        const nombreClean = limpiarNombreArchivo(nombreUds);
                        const sufijoParte = totalPartes > 1 ? `_Parte${numParte}` : '';
                        const fileBaseName = `Formato_Peso_Talla_${nombreClean}${sufijoParte}_ESTIMADO_${fechaHoyIso}.xlsx`;

                        const pathDocs = path.join(dirDocs, fileBaseName);
                        const pathReportes = path.join(dirReportes, fileBaseName);

                        await wbPrellenado.xlsx.writeFile(pathDocs);
                        await wbPrellenado.xlsx.writeFile(pathReportes);

                        console.log(c.gris(`     -> Guardado (Estimación a hoy en Cols U, V, W): docs/peso y talla/${fileBaseName}`));
                    }
                }

                console.log(c.verde('\n  🎉 ¡Formato con Estimación de Peso y Talla (a hoy) generado exitosamente!'));
            }
        } catch (err) {
            console.log(c.rojo(`\n  ❌ Error: ${err.message}`));
        }

        console.log(c.cyan('\n======================================================'));
        const respFinal = readline.question(c.negrita('  > ¿Deseas procesar otro archivo de Formato de Peso y Talla? (s = Si, n = Volver al panel principal) [por defecto n]: '));
        if (respFinal.toLowerCase().trim() !== 's') {
            console.log(c.verde('\n  👋 Volviendo al panel principal (AutoTrabajo)...\n'));
            break;
        }
        console.log('\n');
    }
}

if (require.main === module) {
    main().finally(() => process.exit(0));
}

module.exports = { main };
