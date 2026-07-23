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

  // 1. Extraer contratos de las filas 1 a 7 (índice 1 a 7)
  const asociacionesMetadata = [];
  for (let i = 1; i <= 7; i++) {
    const row = data[i];
    if (row && row[0] && row[5]) {
      const nombreLargo = String(row[0]).trim().toUpperCase();
      const numeroContrato = String(row[5]).trim();
      const vigenciaContrato = numeroContrato.slice(-4); // últimos 4 dígitos
      asociacionesMetadata.push({ nombreLargo, numeroContrato, vigenciaContrato });
    }
  }

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

  // Agrupar por asociación y asignar el contrato correspondiente
  const porAsociacion = {};
  for (const j of jardines) {
    if (!porAsociacion[j.asociacion]) {
      // Buscar la metadata (el nombre corto 'j.asociacion' está contenido en el 'nombreLargo')
      let metadata = asociacionesMetadata.find(m => m.nombreLargo.includes(j.asociacion));
      
      porAsociacion[j.asociacion] = {
        nombreCorto: j.asociacion,
        nombreLargo: metadata ? metadata.nombreLargo : '',
        numeroContrato: metadata ? metadata.numeroContrato : '',
        vigenciaContrato: metadata ? metadata.vigenciaContrato : '',
        jardines: []
      };
    }
    porAsociacion[j.asociacion].jardines.push(j);
  }

  return { jardines, porAsociacion };
}

module.exports = { leerJardines };
