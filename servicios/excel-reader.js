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

function removeAccents(str) {
    return (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[,.]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}

function encontrarMejorAsociacionYJardin(asociaciones, ascStr, udsStr, nombreArchivo = '') {
    let ascSeleccionada = null;
    let jardinSeleccionado = null;

    const esInstruccionUds = (str) => {
        const s = removeAccents(str);
        return s.includes('REGISTRAR') || s.includes('NOMBRE DE LA UNIDAD') || s.includes('UNIDAD COMUNITARIA') || s.includes('SELECCIONE') || s.includes('UNIDAD DE SERVICIO');
    };

    if (udsStr && esInstruccionUds(udsStr)) {
        udsStr = ''; // Limpiar si es texto instructivo de plantilla Excel
    }

    const candidatosSearchAsc = [ascStr, nombreArchivo].filter(s => s && String(s).trim().length >= 3);

    for (const searchStr of candidatosSearchAsc) {
        if (ascSeleccionada) break;
        const ascUpper = removeAccents(searchStr);
        
        let mejorScoreAsc = 0;
        for (const a of asociaciones) {
            const cortoUpper = removeAccents(a.nombreCorto);
            const largoUpper = removeAccents(a.nombreLargo);
            
            let score = 0;
            // Coincidencia exacta
            if (ascUpper === cortoUpper || ascUpper === largoUpper) {
                score = 1000 + cortoUpper.length;
            } else if (ascUpper.includes(cortoUpper)) {
                score = 500 + cortoUpper.length;
            } else if (cortoUpper.includes(ascUpper)) {
                score = 300 + ascUpper.length;
            } else if (largoUpper && ascUpper.includes(largoUpper)) {
                score = 400 + largoUpper.length;
            } else if (largoUpper && largoUpper.includes(ascUpper)) {
                score = 200 + ascUpper.length;
            }

            const palabrasAscUpper = ascUpper.split(/\s+/).filter(w => w.length > 3);
            const palabrasCorto = cortoUpper.split(/\s+/).filter(w => w.length > 3);
            const palabrasCoincidentes = palabrasCorto.filter(w => palabrasAscUpper.includes(w));
            score += palabrasCoincidentes.length * 50;

            if (score > mejorScoreAsc && score >= 200) {
                mejorScoreAsc = score;
                ascSeleccionada = a;
            }
        }
    }

    if (ascSeleccionada) {
        const candidatosSearchUds = [udsStr, nombreArchivo].filter(s => s && String(s).trim().length >= 3);

        for (const searchStr of candidatosSearchUds) {
            if (jardinSeleccionado) break;
            const udsUpper = removeAccents(searchStr);
            let mejorScoreUds = 0;

            for (const j of ascSeleccionada.jardines) {
                const jNomUpper = removeAccents(j.nombre);
                let score = 0;
                
                if (udsUpper === jNomUpper) {
                    score = 1000 + jNomUpper.length;
                } else if (udsUpper.includes(jNomUpper)) {
                    score = 500 + jNomUpper.length;
                } else if (jNomUpper.includes(udsUpper)) {
                    score = 300 + udsUpper.length;
                } else {
                    const palUds = udsUpper.split(/\s+/).filter(w => w.length >= 4);
                    const palJardin = jNomUpper.split(/\s+/).filter(w => w.length >= 4);
                    const coincidentes = palJardin.filter(w => palUds.includes(w));
                    if (coincidentes.length > 0) {
                        score = 200 + (coincidentes.length * 50);
                    }
                }

                if (score > mejorScoreUds && score >= 200) {
                    mejorScoreUds = score;
                    jardinSeleccionado = j;
                }
            }
        }
    }

    return { ascSeleccionada, jardinSeleccionado };
}

module.exports = { leerJardines, encontrarMejorAsociacionYJardin };

