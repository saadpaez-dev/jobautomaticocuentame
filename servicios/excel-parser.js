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
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    // Leer como matriz bidimensional
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    if (data.length < 16) {
        throw new Error("El archivo no tiene el formato esperado (muy pocas filas).");
    }

    // Extraer Asociación y UDS (usualmente en la fila 9, índice 8)
    let asociacion = '';
    let uds = '';
    for (let i = 5; i < 12; i++) {
        if (!data[i]) continue;
        const rowString = JSON.stringify(data[i]).toUpperCase();
        if (rowString.includes('ASOCIACION')) {
            const rowData = data[i];
            const asocIndex = rowData.findIndex(val => typeof val === 'string' && val.toUpperCase().includes('ASOCIACION'));
            if (asocIndex !== -1) {
                asociacion = rowData[asocIndex].trim();
            }
            // UDS suele estar más a la derecha
            const possibleUds = rowData.slice(asocIndex + 1).find(val => typeof val === 'string' && val.trim() !== '' && !val.toUpperCase().includes('NOMBRE DE LA UNIDAD'));
            if (possibleUds) {
                uds = possibleUds.trim();
            } else if (rowData.length > 23 && rowData[23]) {
                uds = rowData[23].toString().trim();
            }
            break;
        }
    }

    const ninos = [];
    
    // Procesar niños desde la fila 16 (índice 15) en adelante
    for (let i = 15; i < data.length; i++) {
        const row = data[i];
        if (!row || !row[1] || !row[2]) continue; // Fila vacía o sin documento/nombre
        
        const documento = String(row[1]).trim();
        const nombres = String(row[2]).trim();
        const apellidos = String(row[3] || '').trim();
        
        if (String(row[7]).toLowerCase().includes('retirad') || String(row[19]).toLowerCase().includes('retirad')) {
            console.log(`\x1b[33m  ⚠️ Se omite a ${nombres} ${apellidos} porque está RETIRADO(A).\x1b[0m`);
            continue;
        }

        const ultimaToma = obtenerUltimaToma(row);
        
        if (ultimaToma) {
            ninos.push({
                documento: documento,
                nombres: nombres,
                apellidos: apellidos,
                nombreCompleto: `${nombres} ${apellidos}`,
                ...ultimaToma
            });
        }
    }

    return {
        asociacion,
        uds,
        ninos
    };
}

module.exports = {
    parsearExcel
};
