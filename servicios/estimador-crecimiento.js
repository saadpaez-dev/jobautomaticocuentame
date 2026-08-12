/**
 * estimador-crecimiento.js
 *
 * Proyecta el peso y la talla de cada niño A LA FECHA DE HOY, a partir de sus
 * tomas reales registradas en el "Formato captura" oficial.
 *
 * ⚠️ Esto NO es una toma real. Es un estimado interno de seguimiento:
 * - Si el niño tiene 2 o más tomas: se calcula su propia velocidad de
 *   crecimiento (kg/día y cm/día) entre la primera y la última toma, y se
 *   proyecta esa tendencia hasta hoy.
 * - Si el niño solo tiene 1 toma: no hay tendencia propia que calcular, así
 *   que se le aplica el promedio de velocidad de crecimiento (kg/día, cm/día)
 *   de todos los niños que sí tienen 2+ tomas en el mismo archivo.
 *
 * El resultado se marca explícitamente como "ESTIMADO" y nunca debe cargarse
 * como si fuera una toma real en el reporte oficial al ICBF.
 */

const xlsx = require('xlsx');
const fs = require('fs');

function normalizar(txt) {
    return String(txt || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

function esTextoRetirado(valor) {
    const n = normalizar(valor);
    return n === 'RETIRADO' || n === 'RETIRADA';
}

/** Convierte una celda de fecha (serial de Excel, Date o texto dd/mm/aaaa) a un objeto Date */
function fechaCeldaADate(valor) {
    if (!valor) return null;
    if (valor instanceof Date) return valor;
    if (typeof valor === 'number') {
        return new Date(Math.round((valor - 25569) * 86400 * 1000));
    }
    if (typeof valor === 'string') {
        const m = valor.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    }
    return null;
}

function formatearFecha(d) {
    if (!d) return '';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function diasEntre(a, b) {
    return (b.getTime() - a.getTime()) / 86400000;
}

function encontrarFilaEncabezadoOficial(data) {
    const limite = Math.min(data.length, 25);
    for (let i = 0; i < limite; i++) {
        const row = data[i];
        if (!row) continue;
        const texto = normalizar(row.join(' | '));
        if (texto.includes('NO. DE ORDEN') || (texto.includes('DOCUMENTO') && texto.includes('NUIP'))) {
            return i;
        }
    }
    return -1;
}

/** Extrae TODAS las tomas válidas de una fila (no solo la última), en orden cronológico */
function extraerTomas(row) {
    const iniciosToma = [7, 19, 31, 43];
    const tomas = [];
    for (const inicio of iniciosToma) {
        const fechaCruda = row[inicio];
        const peso = row[inicio + 1];
        const talla = row[inicio + 2];
        const perimetro = row[inicio + 3];
        if (!fechaCruda || esTextoRetirado(fechaCruda)) continue;
        if (peso === undefined || peso === null || peso === '' || talla === undefined || talla === null || talla === '') continue;

        const fecha = fechaCeldaADate(fechaCruda);
        const pesoNum = parseFloat(peso);
        const tallaNum = parseFloat(talla);
        if (!fecha || isNaN(pesoNum) || isNaN(tallaNum)) continue;

        tomas.push({ fecha, peso: pesoNum, talla: tallaNum, perimetro: perimetro ? parseFloat(perimetro) : null });
    }
    tomas.sort((a, b) => a.fecha - b.fecha);
    return tomas;
}

/**
 * Lee el "Formato captura" y devuelve, por niño, todas sus tomas reales.
 */
function leerTomasPorNino(rutaEntrada) {
    if (!fs.existsSync(rutaEntrada)) throw new Error(`El archivo no existe: ${rutaEntrada}`);
    const wb = xlsx.readFile(rutaEntrada, { cellDates: true });

    const ninos = [];
    for (const nombreHoja of wb.SheetNames) {
        const data = xlsx.utils.sheet_to_json(wb.Sheets[nombreHoja], { header: 1, defval: null });
        const headerIdx = encontrarFilaEncabezadoOficial(data);
        if (headerIdx === -1) continue; // hoja sin formato oficial (ej. "Instrucciones") -> se ignora

        const inicioDatos = headerIdx + 2;
        for (let i = inicioDatos; i < data.length; i++) {
            const row = data[i];
            if (!row || !row[1] || !row[2]) continue;

            const tomas = extraerTomas(row);
            if (tomas.length === 0) continue; // retirado o sin ninguna toma válida

            ninos.push({
                documento: String(row[1]).trim(),
                nombres: String(row[2]).trim(),
                apellidos: String(row[3] || '').trim(),
                tomas,
                hojaOrigen: nombreHoja,
            });
        }
    }
    return ninos;
}

/**
 * Calcula, para cada niño, el peso/talla estimado a la fecha indicada (por defecto hoy).
 */
function estimarCrecimiento(rutaEntrada, fechaReferencia = new Date()) {
    const ninos = leerTomasPorNino(rutaEntrada);

    // 1. Tasa de crecimiento propia para los niños con 2+ tomas (primera vs última)
    const tasasIndividuales = [];
    for (const n of ninos) {
        if (n.tomas.length < 2) continue;
        const primera = n.tomas[0];
        const ultima = n.tomas[n.tomas.length - 1];
        const dias = diasEntre(primera.fecha, ultima.fecha);
        if (dias <= 0) continue;
        n.tasaPropia = {
            pesoPorDia: (ultima.peso - primera.peso) / dias,
            tallaPorDia: (ultima.talla - primera.talla) / dias,
        };
        tasasIndividuales.push(n.tasaPropia);
    }

    // 2. Promedio general del grupo (para niños con una sola toma)
    const promedio = { pesoPorDia: 0, tallaPorDia: 0 };
    if (tasasIndividuales.length > 0) {
        promedio.pesoPorDia = tasasIndividuales.reduce((s, t) => s + t.pesoPorDia, 0) / tasasIndividuales.length;
        promedio.tallaPorDia = tasasIndividuales.reduce((s, t) => s + t.tallaPorDia, 0) / tasasIndividuales.length;
    }

    // 3. Proyección por niño
    const resultados = ninos.map(n => {
        const ultima = n.tomas[n.tomas.length - 1];
        const dias = diasEntre(ultima.fecha, fechaReferencia);
        const usaPropia = n.tomas.length >= 2;
        const tasa = usaPropia ? n.tasaPropia : promedio;

        const pesoEstimado = ultima.peso + tasa.pesoPorDia * dias;
        const tallaEstimado = ultima.talla + tasa.tallaPorDia * dias;

        return {
            documento: n.documento,
            nombres: n.nombres,
            apellidos: n.apellidos,
            nombreCompleto: `${n.nombres} ${n.apellidos}`.trim(),
            numeroTomas: n.tomas.length,
            fechaUltimaToma: formatearFecha(ultima.fecha),
            pesoReal: ultima.peso,
            tallaReal: ultima.talla,
            metodo: usaPropia ? 'Tendencia propia' : 'Promedio del grupo',
            fechaEstimacion: formatearFecha(fechaReferencia),
            pesoEstimado: Math.round(pesoEstimado * 10) / 10,
            tallaEstimado: Math.round(tallaEstimado * 10) / 10,
            hojaOrigen: n.hojaOrigen,
        };
    });

    return {
        resultados,
        promedioGrupo: promedio,
        totalConTendenciaPropia: tasasIndividuales.length,
        totalConPromedioGrupo: resultados.length - tasasIndividuales.length,
    };
}

/** Genera el Excel de salida, dejando muy claro que es un estimado y no una toma real */
function generarReporte({ resultados, fechaReferencia = new Date() }) {
    const encabezados = [
        'No.', 'Documento', 'Nombre completo', '# Tomas reales', 'Fecha última toma real',
        'Peso real (kg)', 'Talla real (cm)', 'Método de estimación',
        `Peso ESTIMADO a ${formatearFecha(fechaReferencia)} (kg)`,
        `Talla ESTIMADA a ${formatearFecha(fechaReferencia)} (cm)`,
    ];

    const filas = [
        ['⚠️ ESTIMADO INTERNO DE SEGUIMIENTO — NO ES UNA TOMA REAL, NO CARGAR EN ICBF COMO MEDICIÓN'],
        [`Generado el ${formatearFecha(new Date())}. Peso/talla proyectados según tendencia de crecimiento de cada niño (o promedio del grupo si solo hay 1 toma).`],
        [],
        encabezados,
    ];

    resultados.forEach((r, i) => {
        filas.push([
            i + 1, r.documento, r.nombreCompleto, r.numeroTomas, r.fechaUltimaToma,
            r.pesoReal, r.tallaReal, r.metodo, r.pesoEstimado, r.tallaEstimado,
        ]);
    });

    const ws = xlsx.utils.aoa_to_sheet(filas);
    ws['!cols'] = [{ wch: 5 }, { wch: 14 }, { wch: 28 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 18 }];
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } }];

    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Estimado (NO oficial)');
    return wb;
}

function generarArchivo(rutaEntrada, rutaSalida, fechaReferencia = new Date()) {
    const calculo = estimarCrecimiento(rutaEntrada, fechaReferencia);
    const wb = generarReporte({ resultados: calculo.resultados, fechaReferencia });
    xlsx.writeFile(wb, rutaSalida);
    return calculo;
}

module.exports = {
    leerTomasPorNino,
    estimarCrecimiento,
    generarReporte,
    generarArchivo,
};
