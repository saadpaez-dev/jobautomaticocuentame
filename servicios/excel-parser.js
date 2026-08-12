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
                peso: pesoToma.toString(),
                talla: tallaToma ? tallaToma.toString() : '',
                perimetro: perimetroToma ? perimetroToma.toString() : ''
            };
        }
    }
    return null;
}

function parsearExcel(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`El archivo no existe: ${filePath}`);
    }

    const wb = xlsx.readFile(filePath);
    
    let asociacion = '';
    let uds = '';
    const ninosMap = new Map(); // Mapa para evitar duplicados por número de documento entre hojas

    console.log(`\n  📄 Leyendo libro de Excel (${wb.SheetNames.length} hoja(s) detectada(s)): [ ${wb.SheetNames.join(', ')} ]`);

    for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;

        // Leer como matriz bidimensional
        const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

        if (!data || data.length < 15) {
            continue; // Hoja vacía o sin estructura de toma, omitir
        }

        // Extraer Asociación y UDS (usualmente en las filas 4 a 15)
        if (!asociacion || !uds) {
            for (let i = 3; i < Math.min(15, data.length); i++) {
                if (!data[i] || !Array.isArray(data[i])) continue;
                const rowData = data[i];

                for (let colIdx = 0; colIdx < rowData.length; colIdx++) {
                    const cellVal = String(rowData[colIdx] || '').trim().toUpperCase();

                    // Buscar etiqueta de Asociación / Entidad Administradora
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

        // Procesar niños desde la fila 16 (índice 15) en adelante
        let ninosEnHoja = 0;
        for (let i = 15; i < data.length; i++) {
            const row = data[i];
            if (!row || !row[1] || !row[2]) continue; // Fila vacía o sin documento/nombre
            
            const documento = String(row[1]).trim();
            const nombres = String(row[2]).trim();
            const apellidos = String(row[3] || '').trim();
            
            if (String(row[7]).toLowerCase().includes('retirad') || String(row[19]).toLowerCase().includes('retirad')) {
                console.log(`\x1b[33m  ⚠️ [Hoja: "${sheetName}"] Se omite a ${nombres} ${apellidos} porque está RETIRADO(A).\x1b[0m`);
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
                }
            }
        }

        if (ninosEnHoja > 0) {
            console.log(`  ✅ Hoja "${sheetName}": ${ninosEnHoja} niños encontrados.`);
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
    parsearExcel
};
