/**
 * excel-reader.js
 * Lee el archivo GENERAL.xlsx y retorna los jardines unicos
 * con su codigo Cuentame y asociacion.
 */

const xlsx = require('xlsx');
const path = require('path');

/**
 * Lee los jardines del Excel y los retorna agrupados por asociacion.
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
        nit: String(row['NIT'] || '').trim(),
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
      
      // Asignar al grupo correspondiente si existe la asociacion
      if (porAsociacion[asociacion]) {
        porAsociacion[asociacion].jardines.push(jardinObj);
      }
    }
  }

  return { jardines, porAsociacion };
}

function encontrarMejorAsociacionYJardin(asociaciones, ascStr, udsStr) {
    let ascSeleccionada = null;
    let jardinSeleccionado = null;

    if (ascStr && ascStr.trim().length >= 3) {
        const ascUpper = ascStr.trim().toUpperCase();
        
        let mejorScoreAsc = 0;
        for (const a of asociaciones) {
            const cortoUpper = a.nombreCorto.toUpperCase();
            const largoUpper = a.nombreLargo ? a.nombreLargo.toUpperCase() : '';
            
            let score = 0;
            // Coincidencia exacta
            if (ascUpper === cortoUpper || ascUpper === largoUpper) {
                score = 1000 + cortoUpper.length;
            } 
            // ascUpper contiene el nombre corto o viceversa
            else if (ascUpper.includes(cortoUpper)) {
                score = 500 + cortoUpper.length;
            } else if (cortoUpper.includes(ascUpper)) {
                score = 300 + ascUpper.length;
            } else if (largoUpper && ascUpper.includes(largoUpper)) {
                score = 400 + largoUpper.length;
            } else if (largoUpper && largoUpper.includes(ascUpper)) {
                score = 200 + ascUpper.length;
            }

            // Bono de coincidencia de palabras clave (ej: BRISAS)
            const palabrasAscUpper = ascUpper.split(/\s+/).filter(w => w.length > 3);
            const palabrasCorto = cortoUpper.split(/\s+/).filter(w => w.length > 3);
            const palabrasCoincidentes = palabrasCorto.filter(w => palabrasAscUpper.includes(w));
            score += palabrasCoincidentes.length * 50;

            if (score > mejorScoreAsc) {
                mejorScoreAsc = score;
                ascSeleccionada = a;
            }
        }
    }

    if (ascSeleccionada && udsStr && udsStr.trim().length >= 3) {
        const udsUpper = udsStr.trim().toUpperCase();
        let mejorScoreUds = 0;

        for (const j of ascSeleccionada.jardines) {
            const jNomUpper = j.nombre.toUpperCase();
            let score = 0;
            
            if (udsUpper === jNomUpper) {
                score = 1000 + jNomUpper.length;
            } else if (udsUpper.includes(jNomUpper)) {
                score = 500 + jNomUpper.length;
            } else if (jNomUpper.includes(udsUpper)) {
                score = 300 + udsUpper.length;
            }

            if (score > mejorScoreUds) {
                mejorScoreUds = score;
                jardinSeleccionado = j;
            }
        }
    }

    return { ascSeleccionada, jardinSeleccionado };
}

module.exports = { leerJardines, encontrarMejorAsociacionYJardin };

