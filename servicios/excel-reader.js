/**
 * excel-reader.js
 * Lee el archivo GENERAL.xlsx y retorna los jardines únicos
 * con su código Cuéntame y asociación.
 */

const xlsx = require('xlsx');
const path = require('path');

/**
 * Lee los jardines del Excel y los retorna agrupados por asociación.
 * @param {string} rutaExcel - Ruta absoluta al archivo GENERAL.xlsx
 * @returns {{ jardines: Array, porAsociacion: Object }}
 */
function leerJardines(rutaExcel) {
  const wb = xlsx.readFile(rutaExcel);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(ws, { header: 1 });

  const jardines = [];
  const codigosVistos = new Set();

  // Los datos empiezan en fila 10 (índice 9 después del header en fila 9)
  // Columnas: [0]=número, [1]=ASOCIACION, [2]=CODIGO CUENTAME, [3]=UDS (nombre jardín)
  for (const row of data.slice(9)) {
    if (row[0] === 1 && row[1] && row[2] && row[3]) {
      const codigo = String(row[2]).trim();
      const nombre = String(row[3]).trim();
      const asociacion = String(row[1]).trim().toUpperCase();

      if (!codigosVistos.has(codigo)) {
        codigosVistos.add(codigo);
        jardines.push({ codigo, nombre, asociacion });
      }
    }
  }

  // Agrupar por asociación manteniendo el orden
  const porAsociacion = {};
  for (const j of jardines) {
    if (!porAsociacion[j.asociacion]) {
      porAsociacion[j.asociacion] = [];
    }
    porAsociacion[j.asociacion].push(j);
  }

  return { jardines, porAsociacion };
}

module.exports = { leerJardines };
