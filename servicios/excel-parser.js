const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

function formatDate(excelDate) {
    if (!excelDate) return null;
    if (typeof excelDate === 'string') return excelDate;
    // Convert Excel date to JS Date
    const d = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
    // Formatear como DD/MM/AAAA
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const year = d.getUTCFullYear();
    return `${day}/${month}/${year}`;
}

function normalizarDecimal(val) {
    if (val === undefined || val === null) return '';
    return String(val).trim().replace(',', '.');
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

function obtenerUltimaToma(fila) {
    // Las tomas inician en el índice 7 (Toma 1) y avanzan cada 12 columnas.
    // Toma 1: 7, Toma 2: 19, Toma 3: 31, Toma 4: 43
    const iniciosToma = [43, 31, 19, 7];
    for (const inicio of iniciosToma) {
        const fechaToma = fila[inicio];
        const pesoToma = fila[inicio + 1];
        const tallaToma = fila[inicio + 2];
        const perimetroToma = fila[inicio + 3];

        if (fechaToma && pesoToma && String(fechaToma).trim().toLowerCase() !== 'retirado' && String(fechaToma).trim().toLowerCase() !== 'retirada') {
            return {
                fecha: formatDate(fechaToma),
                peso: normalizarDecimal(pesoToma),
                talla: normalizarDecimal(tallaToma),
                perimetro: normalizarDecimal(perimetroToma)
            };
        }
    }
    return null;
}

function resolverRutaConEspeciales(inputPath) {
    if (!inputPath) return inputPath;
    let limpia = inputPath.replace(/['"]/g, '').trim();
    if (fs.existsSync(limpia)) return limpia;

    try {
        const dir = path.dirname(limpia);
        const baseCorrupto = path.basename(limpia);
        if (fs.existsSync(dir)) {
            const archivos = fs.readdirSync(dir);
            const prefix = baseCorrupto.split(/[\uFFFD\?\s_]/)[0];
            const ext = path.extname(baseCorrupto);
            
            let match = null;
            if (prefix && prefix.length >= 4) {
                match = archivos.find(f => f.startsWith(prefix) && f.toLowerCase().endsWith(ext.toLowerCase()));
            }
            
            if (!match) {
                const palabras = baseCorrupto.toUpperCase().replace(/[\uFFFD\?]/g, ' ').split(/[^A-Z0-9]/).filter(p => p.length >= 3);
                if (palabras.length > 0) {
                    match = archivos.find(f => {
                        const fUpper = f.toUpperCase();
                        return palabras.every(p => fUpper.includes(p));
                    });
                }
            }
            
            if (match) {
                const rutaReal = path.join(dir, match);
                console.log(`\n  ✅ Ruta corregida automaticamente (carácter Ñ/tilde detectado):`);
                console.log(`     Archivo encontrado: ${match}\n`);
                return rutaReal;
            }
        }
    } catch (e) {}

    return limpia;
}

function parsearExcel(filePath) {
    const rutaReal = resolverRutaConEspeciales(filePath);
    if (!fs.existsSync(rutaReal)) {
        throw new Error(`El archivo no existe: ${filePath}`);
    }

    const wb = xlsx.readFile(rutaReal);
    
    let asociacion = '';
    let uds = '';
    const ninosMap = new Map(); // Mapa para evitar duplicados por numero de documento entre hojas

    console.log(`\n  📄 Leyendo libro de Excel (${wb.SheetNames.length} hoja(s) detectada(s)): [ ${wb.SheetNames.join(', ')} ]`);

    for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;

        // Leer como matriz bidimensional
        const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

        if (!data || data.length < 15) {
            continue; // Hoja vacía o sin estructura de toma, omitir
        }

        // Extraer Asociacion y UDS (usualmente en las filas 4 a 15)
        if (!asociacion || !uds) {
            for (let i = 3; i < Math.min(15, data.length); i++) {
                if (!data[i] || !Array.isArray(data[i])) continue;
                const rowData = data[i];

                for (let colIdx = 0; colIdx < rowData.length; colIdx++) {
                    const cellVal = String(rowData[colIdx] || '').trim().toUpperCase();

                    // Buscar etiqueta de Asociacion / Entidad Administradora
                    if (!asociacion && (cellVal.includes('ASOCIACION') || cellVal.includes('ENTIDAD ADMINISTRADORA') || cellVal.includes('PRESTADOR') || cellVal.includes('EAS'))) {
                        const nextVal = rowData.slice(colIdx + 1).find(v => v !== undefined && v !== null && String(v).trim().length > 2 && !String(v).toUpperCase().includes('NOMBRE DE LA UNIDAD') && !String(v).toUpperCase().includes('MODALIDAD'));
                        if (nextVal) {
                            asociacion = String(nextVal).trim();
                        }
                    }

                    // Buscar etiqueta de UDS / Unidad de Servicio
                    if (!uds && (cellVal.includes('UNIDAD DE SERVICIO') || cellVal.includes('UNIDAD DE ATENCION') || cellVal.includes('UNIDAD COMUNITARIA') || cellVal.includes('NOMBRE UDS'))) {
                        const nextVal = rowData.slice(colIdx + 1).find(v => v !== undefined && v !== null && String(v).trim().length > 2 && !String(v).toUpperCase().includes('MODALIDAD'));
                        if (nextVal) {
                            uds = String(nextVal).trim();
                        } else if (rowData[23]) {
                            uds = String(rowData[23]).trim();
                        }
                    }
                }
            }
        }

        // Procesar ninos desde la fila 16 (índice 15) en adelante
        let ninosEnHoja = 0;
        for (let i = 15; i < data.length; i++) {
            const row = data[i];
            if (!row || !row[1] || !row[2]) continue; // Fila vacía o sin documento/nombre
            
            const documento = String(row[1]).trim();
            const nombres = String(row[2]).trim();
            const apellidos = String(row[3] || '').trim();
            
            if (String(row[7]).toLowerCase().includes('retirad') || String(row[19]).toLowerCase().includes('retirad')) {
                console.log(`\x1b[33m  ⚠️ [Hoja: "${sheetName}"] Se omite a ${nombres} ${apellidos} porque esta RETIRADO(A).\x1b[0m`);
                continue;
            }

            const ultimaToma = obtenerUltimaToma(row);
            
            if (ultimaToma) {
                if (!ninosMap.has(documento)) {
                    ninosMap.set(documento, {
                        documento: documento,
                        nombres: nombres,
                        apellidos: apellidos,
                        nombreCompleto: `${nombres} ${apellidos}`,
                        hoja: sheetName,
                        ...ultimaToma
                    });
                    ninosEnHoja++;
                } else {
                    const ninoExistente = ninosMap.get(documento);
                    if (esFechaMasReciente(ultimaToma.fecha, ninoExistente.fecha)) {
                        console.log(`\x1b[36m  ℹ️ [Hoja: "${sheetName}"] Registro duplicado detectado para ${nombres} ${apellidos} (${documento}). Se toma la toma más reciente: ${ultimaToma.fecha} (reemplaza a ${ninoExistente.fecha}).\x1b[0m`);
                        ninosMap.set(documento, {
                            documento: documento,
                            nombres: nombres,
                            apellidos: apellidos,
                            nombreCompleto: `${nombres} ${apellidos}`,
                            hoja: sheetName,
                            ...ultimaToma
                        });
                    }
                }
            }
        }

        if (ninosEnHoja > 0) {
            console.log(`  ✅ Hoja "${sheetName}": ${ninosEnHoja} ninos encontrados.`);
        }
    }

    const ninos = Array.from(ninosMap.values());

    return {
        asociacion,
        uds,
        ninos
    };
}

module.exports = {
    parsearExcel,
    resolverRutaConEspeciales
};
