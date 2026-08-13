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
        eas: -1,             // La EAS se extrae del encabezado global E2/E3, no de las filas de datos
        uds: 6,              // Col G
        documento: 10,       // Col K
        pApellido: 11,       // Col L
        sApellido: 12,       // Col M
        pNombre: 13,         // Col N
        sNombre: 14,         // Col O
        sexo: -1,
        fechaNacimiento: 17, // Col R
        fechaIngreso: 18,    // Col S
        estado: 65           // Col BN (Index 65)
    };

    headers.forEach((h, idx) => {
        const clean = removeAccents(h);

        if (clean.includes('UNIDAD DE SERVICIO') || clean.includes('NOMBRE UDS') || clean.includes('JARDIN')) {
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
        } else if (clean.includes('ESTADO BENEFICIARIO') || clean.includes('ESTADO')) {
            mapa.estado = idx;
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

    // Extraer el Nombre de la Asociación (EAS) dinámicamente de las celdas superiores del reporte (filas 1 a 15)
    let easGlobal = '';

    // 1. Probar celdas habituales de cabecera (E2, E3, C2, C3, D2, D3, B2, B3, A2, A3)
    const candidatosCeldasHeader = [
        rows[1]?.[4], // E2 (Row index 1, Col index 4)
        rows[2]?.[4], // E3 (Row index 2, Col index 4)
        rows[1]?.[2], // C2
        rows[2]?.[2], // C3
        rows[1]?.[3], // D2
        rows[2]?.[3], // D3
        rows[1]?.[1], // B2
        rows[2]?.[1], // B3
        rows[1]?.[0], // A2
        rows[2]?.[0]  // A3
    ];

    for (const valRaw of candidatosCeldasHeader) {
        if (!valRaw) continue;
        const val = String(valRaw).trim();
        const uVal = removeAccents(val).toUpperCase();

        if (val.length > 5 && 
            !uVal.includes('DESNUTRICION') && 
            !uVal.includes('DIAGNOSTICO') && 
            !uVal.includes('PESO') && 
            !uVal.includes('REPORTE') && 
            !uVal.includes('FECHA') && 
            !uVal.includes('DOCUMENTO') &&
            !uVal.includes('ENTIDAD CONTRATISTA')) {
            easGlobal = val.toUpperCase();
            break;
        }
    }

    // 2. Si no se encontró en las celdas directas, escanear todas las celdas de las primeras 15 filas
    if (!easGlobal) {
        for (let r = 0; r < Math.min(15, rows.length); r++) {
            if (!rows[r]) continue;
            for (let cCol = 0; cCol < Math.min(20, rows[r].length); cCol++) {
                const val = String(rows[r][cCol] || '').trim();
                const uVal = removeAccents(val).toUpperCase();

                if (uVal.includes('ASOCIACION') || 
                    uVal.includes('FUNDACION') || 
                    uVal.includes('CORPORACION') || 
                    uVal.includes('HOGARES') || 
                    uVal.includes('ENTIDAD') || 
                    uVal.includes('CONTRATISTA') || 
                    uVal.includes('AGRUPACION') || 
                    uVal.startsWith('ASO')) {

                    if (uVal.endsWith(':') || uVal.includes('NOMBRE ENTIDAD')) {
                        const valDerecha = String(rows[r][cCol + 1] || rows[r + 1]?.[cCol] || '').trim();
                        if (valDerecha && valDerecha.length > 4) {
                            easGlobal = valDerecha.toUpperCase();
                            break;
                        }
                    } else if (val.length > 5) {
                        easGlobal = val.toUpperCase();
                        break;
                    }
                }
            }
            if (easGlobal) break;
        }
    }

    if (!easGlobal) {
        easGlobal = 'ASOCIACION DE PADRES DE FAMILIA';
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

        // FILTRO DE ESTADO: Omitir niños con estado DESVINCULADO / INACTIVO
        let estadoVal = '';
        if (mapa.estado !== -1 && row[mapa.estado] !== undefined && row[mapa.estado] !== null) {
            estadoVal = removeAccents(String(row[mapa.estado])).toUpperCase().trim();
        }

        if (estadoVal) {
            if (estadoVal.includes('DESVINCULAD') || estadoVal.includes('RETIRO') || estadoVal.includes('INACTIV')) {
                continue;
            }
        } else {
            const rowStr = row.map(c => removeAccents(String(c))).join(' ').toUpperCase();
            if (rowStr.includes('DESVINCULAD')) {
                continue;
            }
        }

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
            const rowStr = row.map(c => removeAccents(String(c))).join(' ').toUpperCase();
            if (rowStr.includes('FEMENINO') || rowStr.includes('MUJER')) sexoCod = 'M';
            else if (rowStr.includes('MASCULINO') || rowStr.includes('HOMBRE')) sexoCod = 'H';
        }

        const fechaNacimiento = mapa.fechaNacimiento !== -1 ? normalizarFecha(row[mapa.fechaNacimiento]) : '';
        const fechaIngreso = mapa.fechaIngreso !== -1 ? normalizarFecha(row[mapa.fechaIngreso]) : '';
        
        const nombreUds = mapa.uds !== -1 && row[mapa.uds] ? String(row[mapa.uds]).trim().toUpperCase() : 'MI JARDIN';
        const nombreEas = easGlobal;

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

    while (true) {
        console.log(c.gris('Arrastra y suelta el Reporte Nutricional o de Activos descargado de Cuéntame.\n'));

        const inputPathRaw = readline.question(c.negrita('  > Arrastra el archivo Excel del Reporte Nutricional aquí (o 0 para salir): '));
        const inputPath = inputPathRaw.trim().replace(/^["']|["']$/g, '');

        if (inputPath === '0') {
            console.log(c.verde('\n  👋 Volviendo al panel principal (AutoTrabajo)...\n'));
            break;
        }

        if (!inputPath || !fs.existsSync(inputPath)) {
            console.log(c.rojo('\n  ❌ El archivo especificado no existe. Inténtalo de nuevo.\n'));
            continue;
        }

        console.log(c.cyan('\n  ⏳ Analizando reporte y organizando beneficiarios por Jardín (UDS)...'));

        try {
            const agrupado = parsearReporteNutricional(inputPath);
            const listaUds = Object.keys(agrupado).sort();

            if (listaUds.length === 0) {
                console.log(c.rojo('  ❌ No se encontraron beneficiarios válidos en el archivo.'));
            } else {
                const easDetectada = agrupado[listaUds[0]]?.nombreEas || 'DESCONOCIDA';
                console.log(c.amarillo(`\n  📌 Asociación en el archivo: ${c.negrita(easDetectada)}`));
                console.log(c.verde(`  ✅ Se identificaron ${listaUds.length} Jardines/UDS en el reporte:\n`));

                listaUds.forEach((nombreUds, idx) => {
                    const count = agrupado[nombreUds].ninos.length;
                    console.log(`  ${c.cyan(idx + 1)}. ${nombreUds} (${c.verde(count + ' niños activos')})`);
                });

                console.log(c.cyan('\n  📋 Selecciona qué jardines deseas procesar:'));
                console.log('    1. Procesar TODOS los jardines (por defecto)');
                console.log('    2. Seleccionar UN SOLO jardín');
                console.log('    3. Seleccionar VARIOS jardines (ej. 1, 3, 5)\n');

                const modoOptRaw = readline.question(c.negrita('  > Elige una opción (1, 2 o 3) [1]: ')).trim();
                const modoOpt = modoOptRaw || '1';

                let udsAProcesar = [];

                if (modoOpt === '2') {
                    const selOne = readline.question(c.negrita(`  > Ingresa el número del jardín a procesar (1-${listaUds.length}): `)).trim();
                    const numOne = parseInt(selOne, 10);
                    if (!isNaN(numOne) && numOne >= 1 && numOne <= listaUds.length) {
                        udsAProcesar.push(listaUds[numOne - 1]);
                    } else {
                        console.log(c.amarillo('  ⚠️ Selección inválida. Se procesarán todos los jardines.'));
                        udsAProcesar = listaUds;
                    }
                } else if (modoOpt === '3') {
                    const selMulti = readline.question(c.negrita('  > Ingresa los números separados por coma (ej: 1, 3, 5): ')).trim();
                    const indices = selMulti.split(/[,;\s]+/).map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n) && n >= 1 && n <= listaUds.length);
                    if (indices.length > 0) {
                        const setIndices = Array.from(new Set(indices));
                        udsAProcesar = setIndices.map(idx => listaUds[idx - 1]);
                    } else {
                        console.log(c.amarillo('  ⚠️ No ingresaste números válidos. Se procesarán todos los jardines.'));
                        udsAProcesar = listaUds;
                    }
                } else {
                    udsAProcesar = listaUds;
                }

                console.log(c.verde(`\n  🚀 Generando formatos pre-llenados (máximo 13 niños por archivo)...\n`));

                const dirDocs = path.join(__dirname, '..', 'docs', 'peso y talla');
                const dirReportes = path.join(__dirname, '..', 'reportes');

                if (!fs.existsSync(dirDocs)) fs.mkdirSync(dirDocs, { recursive: true });
                if (!fs.existsSync(dirReportes)) fs.mkdirSync(dirReportes, { recursive: true });

                const fechaHoy = new Date().toISOString().split('T')[0];
                const TAMANO_PARTE = 13;

                for (let i = 0; i < udsAProcesar.length; i++) {
                    const nombreUds = udsAProcesar[i];
                    const datosUds = agrupado[nombreUds];
                    const todosNinos = datosUds.ninos;

                    // Dividir en bloques de máximo 13 niños para evitar que el Excel se meche o me trunque las planillas
                    const partesNinos = [];
                    for (let k = 0; k < todosNinos.length; k += TAMANO_PARTE) {
                        partesNinos.push(todosNinos.slice(k, k + TAMANO_PARTE));
                    }

                    const totalPartes = partesNinos.length;
                    const descPartes = totalPartes > 1 ? ` -> ${totalPartes} archivos de máx 13 niños` : '';
                    console.log(`  ${i + 1}/${udsAProcesar.length}. ${c.cyan(nombreUds)} (${c.verde(todosNinos.length + ' niños')}${descPartes})`);

                    for (let p = 0; p < totalPartes; p++) {
                        const ninosChunk = partesNinos[p];
                        const numParte = p + 1;

                        const nombreUdsHeader = nombreUds;

                        const datosSubUds = {
                            nombreEas: datosUds.nombreEas,
                            nombreUds: nombreUdsHeader,
                            ninos: ninosChunk
                        };

                        const wbPrellenado = await generarFormatoPesoYTallaUds(datosSubUds, plantillaPath);
                        const nombreClean = nombreUds.replace(/[^a-z0-9]/gi, '_');
                        const sufijoParte = totalPartes > 1 ? `_Parte${numParte}` : '';
                        const fileBaseName = `Formato_Peso_Talla_${nombreClean}${sufijoParte}_${fechaHoy}.xlsx`;

                        const pathDocs = path.join(dirDocs, fileBaseName);
                        const pathReportes = path.join(dirReportes, fileBaseName);

                        await wbPrellenado.xlsx.writeFile(pathDocs);
                        await wbPrellenado.xlsx.writeFile(pathReportes);

                        console.log(c.gris(`     -> Guardado (${ninosChunk.length} niños): docs/peso y talla/${fileBaseName}`));
                    }
                }

                console.log(c.verde('\n  🎉 ¡Formatos de Peso y Talla generados exitosamente!'));
            }

        } catch (err) {
            console.log(c.rojo(`\n  ❌ Error procesando el archivo: ${err.message}`));
        }

        console.log(c.cyan('\n======================================================'));
        const respFinal = readline.question(c.negrita('  > ¿Deseas procesar otro archivo Excel? (s = Si, n = Volver al panel principal) [por defecto n]: '));
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

module.exports = { parsearReporteNutricional, generarFormatoPesoYTallaUds };
