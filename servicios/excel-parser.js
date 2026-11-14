const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const { leerLibroExcelSeguro } = require('./reparar-excel');

function formatDate(excelDate) {
    if (!excelDate) return null;
    if (excelDate instanceof Date) {
        const day = String(excelDate.getDate()).padStart(2, '0');
        const month = String(excelDate.getMonth() + 1).padStart(2, '0');
        const year = excelDate.getFullYear();
        return `${day}/${month}/${year}`;
    }
    if (typeof excelDate === 'number') {
        const d = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
        const day = String(d.getUTCDate()).padStart(2, '0');
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const year = d.getUTCFullYear();
        return `${day}/${month}/${year}`;
    }
    if (typeof excelDate === 'string') {
        const s = excelDate.trim();
        if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(s)) {
            const parts = s.split(/[-\/]/);
            return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
        }
        if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}/.test(s)) {
            const parts = s.split(/[-\/]/);
            return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2]}`;
        }
        return s;
    }
    return String(excelDate);
}

function normalizarDecimal(val) {
    if (val === undefined || val === null) return '';
    let s = String(val).trim().replace(',', '.').replace(/\s+/g, '');
    if (s.toUpperCase() === 'N/A' || s === '-' || s === 'NA') return '';
    return s;
}

function normalizarDoc(doc) {
    if (doc === undefined || doc === null) return '';
    let s = String(doc).trim();
    if (s.includes('e+') || s.includes('E+')) {
        const num = Number(s);
        if (!isNaN(num)) s = BigInt(Math.round(num)).toString();
    }
    s = s.replace(/\.0+$/, '');
    return s.replace(/[\.\,\s\-]/g, '');
}

function parsearFechaAObjeto(fechaStr) {
    if (!fechaStr) return null;
    const parts = String(fechaStr).trim().split(/[\/-]/);
    if (parts.length === 3) {
        let d = parseInt(parts[0], 10);
        let m = parseInt(parts[1], 10) - 1;
        let y = parseInt(parts[2], 10);
        if (parts[0].length === 4) { // YYYY-MM-DD
            y = parseInt(parts[0], 10);
            m = parseInt(parts[1], 10) - 1;
            d = parseInt(parts[2], 10);
        }
        return new Date(y, m, d);
    }
    return null;
}

function esFechaMasReciente(fechaNueva, fechaExistente) {
    if (!fechaExistente) return true;
    if (!fechaNueva) return false;

    const dNueva = parsearFechaAObjeto(fechaNueva);
    const dExistente = parsearFechaAObjeto(fechaExistente);

    if (dNueva && dExistente) {
        return dNueva.getTime() >= dExistente.getTime();
    }
    return false;
}

function detectarIniciosToma(data, headerRowIdx = 13) {
    const inicios = new Set();
    const maxRow = Math.min(22, data.length);

    // 1. Escanear filas de cabecera buscando textos de toma o fecha de valoracion
    for (let r = 0; r < maxRow; r++) {
        if (!data[r] || !Array.isArray(data[r])) continue;
        for (let c = 0; c < data[r].length; c++) {
            const val = String(data[r][c] || '').toUpperCase().trim();
            if (val.includes('FECHA DE LA TOMA') || val === 'FECHA TOMA' || val.includes('FECHA VALORAC') || val.includes('FECHA DE VALORAC')) {
                inicios.add(c);
            }
        }
    }

    // 2. Si se encuentra "TOMA Nº", "TOMA N°" o "TOMA [1-9]" en fila superior
    for (let r = 0; r < maxRow; r++) {
        if (!data[r] || !Array.isArray(data[r])) continue;
        for (let c = 0; c < data[r].length; c++) {
            const val = String(data[r][c] || '').toUpperCase().trim();
            if (val.includes('TOMA Nº') || val.includes('TOMA N°') || /^TOMA\s*\d+/i.test(val)) {
                inicios.add(c);
            }
        }
    }

    // 3. Buscar cualquier columna con "PESO" precedida por "FECHA"
    for (let r = 0; r < maxRow; r++) {
        if (!data[r] || !Array.isArray(data[r])) continue;
        for (let c = 1; c < data[r].length; c++) {
            const val = String(data[r][c] || '').toUpperCase().trim();
            if (val.includes('PESO')) {
                const prev = String(data[r][c - 1] || '').toUpperCase().trim();
                if (prev.includes('FECHA')) {
                    inicios.add(c - 1);
                }
            }
        }
    }

    const resultado = Array.from(inicios).sort((a, b) => a - b);
    return resultado.length > 0 ? resultado : [7, 19, 31, 43];
}

function obtenerUltimaToma(fila, iniciosToma = [7, 19, 31, 43]) {
    let ultimaTomaValida = null;

    for (const inicio of iniciosToma) {
        const fechaToma = fila[inicio];
        const pesoToma = fila[inicio + 1];
        const tallaToma = fila[inicio + 2];
        const perimetroToma = fila[inicio + 3];

        if (fechaToma && pesoToma && String(fechaToma).trim().toLowerCase() !== 'retirado' && String(fechaToma).trim().toLowerCase() !== 'retirada') {
            const fechaStr = formatDate(fechaToma);
            const tomaCandidate = {
                fecha: fechaStr,
                peso: normalizarDecimal(pesoToma),
                talla: normalizarDecimal(tallaToma),
                perimetro: normalizarDecimal(perimetroToma)
            };

            if (!ultimaTomaValida || esFechaMasReciente(tomaCandidate.fecha, ultimaTomaValida.fecha)) {
                ultimaTomaValida = tomaCandidate;
            }
        }
    }
    return ultimaTomaValida;
}

function resolverRutaConEspeciales(inputPath) {
    if (!inputPath) return inputPath;
    let limpia = inputPath.replace(/['"]/g, '').trim();
    if (fs.existsSync(limpia)) return limpia;

    const baseName = path.basename(limpia);
    const carpetasBusqueda = [
        path.dirname(limpia),
        path.join(__dirname, '..', 'docs', 'database'),
        path.join(__dirname, '..', 'docs', 'respaldos'),
        path.join(__dirname, '..', 'docs', 'entradas'),
        path.join(__dirname, '..', 'docs', 'peso y talla')
    ];

    for (const dir of carpetasBusqueda) {
        if (!fs.existsSync(dir)) continue;
        const candidate = path.join(dir, baseName);
        if (fs.existsSync(candidate)) {
            console.log(`\n  🛡️ Archivo recuperado desde respaldo seguro:`);
            console.log(`     ${candidate}\n`);
            return candidate;
        }

        try {
            const archivos = fs.readdirSync(dir);
            const prefix = baseName.split(/[\uFFFD\?\s_]/)[0];
            const ext = path.extname(baseName);
            
            let match = null;
            if (prefix && prefix.length >= 4) {
                match = archivos.find(f => f.startsWith(prefix) && f.toLowerCase().endsWith(ext.toLowerCase()));
            }
            
            if (!match) {
                const palabras = baseName.toUpperCase().replace(/[\uFFFD\?]/g, ' ').split(/[^A-Z0-9]/).filter(p => p.length >= 3);
                if (palabras.length > 0) {
                    match = archivos.find(f => {
                        const fUpper = f.toUpperCase();
                        return palabras.every(p => fUpper.includes(p));
                    });
                }
            }
            
            if (match) {
                const rutaReal = path.join(dir, match);
                console.log(`\n  ✅ Ruta recuperada automaticamente desde:`);
                console.log(`     ${rutaReal}\n`);
                return rutaReal;
            }
        } catch (e) {}
    }

    return limpia;
}

function parsearExcel(filePath) {
    const rutaReal = resolverRutaConEspeciales(filePath);
    if (!fs.existsSync(rutaReal)) {
        throw new Error(`El archivo no existe: ${filePath}`);
    }

    const wb = leerLibroExcelSeguro(rutaReal);
    
    let asociacion = '';
    let uds = '';
    const ninosMap = new Map(); // Mapa para consolidar ninos unicos por documento entre hojas
    const hojasProcesadas = [];

    console.log(`\n  📄 Leyendo libro de Excel (${wb.SheetNames.length} hoja(s) detectada(s)): [ ${wb.SheetNames.join(', ')} ]`);

    for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;

        // Omitir hojas de instrucciones, ayuda o guias
        const nombreLimpio = sheetName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const esHojaNoValida = /^(instrucc|ayuda|guia|manual|resumen|grafic|parametro|instructivo|catalogo)/i.test(nombreLimpio);
        if (esHojaNoValida) {
            console.log(`  ℹ️ Omitiendo hoja "${sheetName}" (hoja de instrucciones o parametros).`);
            continue;
        }

        // Leer como matriz bidimensional
        const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

        if (!data || data.length < 5) {
            console.log(`  ℹ️ Omitiendo hoja "${sheetName}" (hoja vacia o sin datos suficientes).`);
            continue;
        }

        // Verificar si el contenido de las primeras filas es una hoja de instrucciones
        const textoPrimerasFilas = data.slice(0, 8).map(r => (r || []).join(' ')).join(' ').toUpperCase();
        if (textoPrimerasFilas.includes('ÍTEM') && (textoPrimerasFilas.includes('DESCRIPCIÓN') || textoPrimerasFilas.includes('DESCRIPCION'))) {
            console.log(`  ℹ️ Omitiendo hoja "${sheetName}" (detectada estructura de instrucciones/descripcion).`);
            continue;
        }

        // Extraer Asociacion y UDS de la hoja (usualmente en las primeras 15 filas)
        let asocHoja = '';
        let udsHoja = '';

        const esTextoInstruccion = (str) => {
            const s = String(str || '').toUpperCase();
            return s.includes('REGISTRAR') || s.includes('NOMBRE DE LA UNIDAD') || s.includes('UNIDAD COMUNITARIA DE ATENCION') || s.includes('MODALIDAD') || s.includes('SELECCIONE') || s.includes('UNIDAD DE SERVICIO O UNIDAD');
        };

        for (let i = 0; i < Math.min(18, data.length); i++) {
            if (!data[i] || !Array.isArray(data[i])) continue;
            const rowData = data[i];

            for (let colIdx = 0; colIdx < rowData.length; colIdx++) {
                const cellVal = String(rowData[colIdx] || '').trim().toUpperCase();

                // Buscar etiqueta de Asociacion
                if (!asocHoja && (cellVal.includes('ASOCIACION') || cellVal.includes('ENTIDAD ADMINISTRADORA') || cellVal.includes('PRESTADOR') || cellVal.includes('EAS'))) {
                    const nextVal = rowData.slice(colIdx + 1).find(v => v !== undefined && v !== null && String(v).trim().length > 2 && !esTextoInstruccion(v));
                    if (nextVal) {
                        asocHoja = String(nextVal).trim();
                    }
                }

                // Buscar etiqueta de UDS / Unidad de Servicio
                if (!udsHoja && (cellVal.includes('UNIDAD DE SERVICIO') || cellVal.includes('UNIDAD DE ATENCION') || cellVal.includes('UNIDAD COMUNITARIA') || cellVal.includes('NOMBRE UDS') || cellVal.includes('GRUPO DE ATENCI'))) {
                    const nextVal = rowData.slice(colIdx + 1).find(v => v !== undefined && v !== null && String(v).trim().length > 2 && !esTextoInstruccion(v));
                    if (nextVal) {
                        udsHoja = String(nextVal).trim();
                    } else if (rowData[23] && !esTextoInstruccion(rowData[23])) {
                        udsHoja = String(rowData[23]).trim();
                    }
                }
            }
        }

        // Si la hoja no tiene UDS explicita en la cabecera, intentar deducirla del nombre de la hoja
        // Ej: "Formato captura ROSA TOMA 3" -> "ROSA"
        if (!udsHoja) {
            const nombreDeducido = sheetName
                .replace(/formato\s*captura/i, '')
                .replace(/toma\s*\d+/i, '')
                .replace(/[-_]/g, ' ')
                .trim();
            if (nombreDeducido.length >= 3) {
                udsHoja = nombreDeducido;
            }
        }

        if (!asociacion && asocHoja) asociacion = asocHoja;
        if (!uds && udsHoja) uds = udsHoja;

        // Deteccion dinamica de columnas de datos (NUIP / Documento, Nombres, Apellidos)
        let headerRowIdx = -1;
        let colDoc = 1;
        let colNom = 2;
        let colApe = 3;
        let colNacimiento = -1;
        let dataStartRow = 15;

        for (let r = 0; r < Math.min(22, data.length); r++) {
            const row = data[r];
            if (!row || !Array.isArray(row)) continue;

            let tempDoc = -1;
            let tempNom = -1;
            let tempApe = -1;
            let tempNac = -1;

            for (let c = 0; c < row.length; c++) {
                const val = String(row[c] || '').toUpperCase().trim();
                if (tempDoc === -1 && (val.includes('DOCUMENTO') || val.includes('NUIP') || val.includes('IDENTIFIC'))) {
                    tempDoc = c;
                }
                if (tempNom === -1 && (val.includes('NOMBRE') || val.includes('NOMBRES')) && !val.includes('DOCUMENTO') && !val.includes('ENTIDAD') && !val.includes('SERVICIO')) {
                    tempNom = c;
                }
                if (tempApe === -1 && (val.includes('APELLIDO') || val.includes('APELLIDOS'))) {
                    tempApe = c;
                }
                if (tempNac === -1 && (val.includes('NACIMIENTO') || val.includes('FECHA NAC'))) {
                    tempNac = c;
                }
            }

            if (tempDoc !== -1 && tempNom !== -1) {
                headerRowIdx = r;
                colDoc = tempDoc;
                colNom = tempNom;
                colApe = tempApe !== -1 ? tempApe : colNom + 1;
                colNacimiento = tempNac;
                break;
            }
        }

        if (headerRowIdx !== -1) {
            const nextRowStr = (data[headerRowIdx + 1] || []).join(' ').toUpperCase();
            if (nextRowStr.includes('FECHA') || nextRowStr.includes('PESO') || nextRowStr.includes('TALLA') || nextRowStr.includes('PERIMETRO') || nextRowStr.includes('PERÍMETRO')) {
                dataStartRow = headerRowIdx + 2;
            } else {
                dataStartRow = headerRowIdx + 1;
            }
        }

        // Detectar columnas donde inician las tomas
        const iniciosToma = detectarIniciosToma(data, headerRowIdx);
        console.log(`  🔍 [Hoja: "${sheetName}"] Tomas detectadas en indices de columna: [${iniciosToma.join(', ')}] (Fila inicio: ${dataStartRow + 1})`);

        // Procesar beneficiarios fila por fila
        let ninosEnHoja = 0;
        for (let i = dataStartRow; i < data.length; i++) {
            const row = data[i];
            if (!row || !Array.isArray(row)) continue;

            const rawDoc = row[colDoc];
            const rawNom = row[colNom];
            const rawApe = colApe !== -1 ? row[colApe] : '';

            if (!rawDoc || !rawNom) continue;

            const documento = normalizarDoc(rawDoc);
            const nombres = String(rawNom).trim();
            const apellidos = String(rawApe || '').trim();

            if (documento.length < 3 || /^(total|firma|observac|fecha|nombre|documento|nuip)/i.test(nombres) || /^(total|firma|observac)/i.test(documento)) {
                continue;
            }

            // Verificar si el nino esta retirado comprobando la primera columna de CADA toma
            let estaRetirado = false;
            for (const inicio of iniciosToma) {
                const val = String(row[inicio] || '').toLowerCase();
                if (val.includes('retirad')) {
                    estaRetirado = true;
                    break;
                }
            }

            if (estaRetirado) {
                console.log(`\x1b[33m  ⚠️ [Hoja: "${sheetName}"] Se omite a ${nombres} ${apellidos} porque esta RETIRADO(A).\x1b[0m`);
                continue;
            }

            const ultimaToma = obtenerUltimaToma(row, iniciosToma);

            if (ultimaToma) {
                const infoNino = {
                    documento: documento,
                    documentoOriginal: String(rawDoc).trim(),
                    nombres: nombres,
                    apellidos: apellidos,
                    nombreCompleto: `${nombres} ${apellidos}`.trim(),
                    fechaNacimiento: colNacimiento !== -1 ? formatDate(row[colNacimiento]) : null,
                    hoja: sheetName,
                    uds: udsHoja || uds,
                    ...ultimaToma
                };

                if (!ninosMap.has(documento)) {
                    ninosMap.set(documento, infoNino);
                    ninosEnHoja++;
                } else {
                    const ninoExistente = ninosMap.get(documento);
                    if (esFechaMasReciente(ultimaToma.fecha, ninoExistente.fecha)) {
                        console.log(`\x1b[36m  ℹ️ [Hoja: "${sheetName}"] Actualizando registro para ${nombres} ${apellidos} (${documento}) con la toma mas reciente: ${ultimaToma.fecha} (hoja: ${sheetName}).\x1b[0m`);
                        ninosMap.set(documento, infoNino);
                    }
                }
            }
        }

        if (ninosEnHoja > 0) {
            console.log(`  ✅ Hoja "${sheetName}": ${ninosEnHoja} niño(s) valido(s) cargado(s).`);
            hojasProcesadas.push({ hoja: sheetName, ninos: ninosEnHoja, uds: udsHoja || uds });
        } else {
            console.log(`  ℹ️ Hoja "${sheetName}": Sin registros validos de toma antropometrica.`);
        }
    }

    const ninos = Array.from(ninosMap.values());

    console.log(`\n  📊 RESUMEN LECTURA LIBRO EXCEL:`);
    console.log(`     Hojas con formato procesadas: ${hojasProcesadas.length}`);
    hojasProcesadas.forEach(h => console.log(`      - "${h.hoja}": ${h.ninos} niño(s) ${h.uds ? `[UDS: ${h.uds}]` : ''}`));
    console.log(`     Total beneficiarios unicos listos para procesar: ${ninos.length}\n`);

    return {
        asociacion,
        uds,
        ninos,
        hojasProcesadas
    };
}

module.exports = {
    parsearExcel,
    resolverRutaConEspeciales
};
