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
  const wsAsoc = wb.Sheets['Asociaciones'] || wb.Sheets[wb.SheetNames[0]];
  const wsJardines = wb.Sheets['Jardines'] || wb.Sheets[wb.SheetNames[1]];
  
  const dataAsoc = xlsx.utils.sheet_to_json(wsAsoc);
  const dataJardines = xlsx.utils.sheet_to_json(wsJardines);

  const porAsociacion = {};
  
  // 1. Cargar las asociaciones (metadata y contrato)
  for (const row of dataAsoc) {
    const nombreCorto = String(row['Nombre Corto'] || '').trim().toUpperCase();
    if (nombreCorto) {
      porAsociacion[nombreCorto] = {
        nombreCorto: nombreCorto,
        nombreLargo: String(row['Nombre Largo'] || '').trim(),
        numeroContrato: String(row['Numero Contrato'] || '').trim(),
        vigenciaContrato: String(row['Vigencia'] || '').trim(),
        jardines: []
      };
    }
  }

  const jardines = [];
  const codigosVistos = new Set();

  // 2. Cargar los jardines
  for (const row of dataJardines) {
    const codigo = String(row['Codigo Cuentame'] || '').trim();
    const nombre = String(row['Nombre UDS'] || '').trim();
    const asociacion = String(row['Asociacion'] || '').trim().toUpperCase();

    if (codigo && nombre && asociacion) {
      const jardinObj = { codigo, nombre, asociacion };
      
      if (!codigosVistos.has(codigo)) {
        codigosVistos.add(codigo);
        jardines.push(jardinObj);
      }
      
      // Asignar al grupo correspondiente si existe la asociación
      if (porAsociacion[asociacion]) {
        porAsociacion[asociacion].jardines.push(jardinObj);
      }
    }
  }

  return { jardines, porAsociacion };
}

module.exports = { leerJardines };
