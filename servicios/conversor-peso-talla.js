/**
 * conversor-peso-talla.js
 *
 * Convierte Excels de peso/talla con formato variable (los que envían las
 * asociaciones) a la estructura fija que ya sabe leer `servicios/excel-parser.js`
 * (mismo layout posicional del "Formato captura" oficial ICBF).
 *
 * Solo importan 6 datos por beneficiario: documento, nombres, apellidos,
 * fecha de la toma, peso, talla y perímetro braquial. Todo lo demás del
 * formato oficial (sexo, fecha nacimiento, lactancia, etc.) se deja en blanco
 * a propósito: no se necesita para el llenado en Cuéntame.
 */

const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

// ────────────────────────────────────────────────────────────────
// Utilidades de texto
// ────────────────────────────────────────────────────────────────

function normalizar(txt) {
    return String(txt || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // quita tildes
        .toUpperCase()
        .trim();
}

function celdaTexto(row, idx) {
    if (!row || row[idx] === undefined || row[idx] === null) return '';
    return String(row[idx]).trim();
}

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO',
    'AGOSTO', 'SEPTIEMBRE', 'SETIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

function formatearFecha(dia, mes, anio) {
    return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`;
}

/** Intenta extraer una fecha (dd/mm/aaaa) de un texto libre (título de hoja, nombre de archivo, etc.) */
function extraerFechaDeTexto(txt) {
    if (!txt) return null;
    const norm = normalizar(txt).replace(/_/g, ' ');

    // dd/mm/aaaa o dd-mm-aaaa
    let m = norm.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) return formatearFecha(m[1], m[2], m[3]);

    // "04 agosto 2026" o "04 de agosto de 2026" o "04 DE AGOSTO 2026"
    m = norm.match(/(\d{1,2})\s*(?:DE\s*)?(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\.?\s*(?:DE\s*)?(\d{4})/);
    if (m) {
        let idxMes = MESES.indexOf(m[2]);
        if (idxMes === 9) idxMes = 7; // SETIEMBRE -> mismo mes que SEPTIEMBRE
        return formatearFecha(m[1], idxMes + 1, m[3]);
    }

    // Solo "MES AAAA" (sin día) -> usa el día 1
    m = norm.match(/(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\.?\s*(\d{4})/);
    if (m) {
        let idxMes = MESES.indexOf(m[1]);
        if (idxMes === 9) idxMes = 7;
        return formatearFecha(1, idxMes + 1, m[2]);
    }

    return null;
}

/** Convierte un serial de fecha de Excel (o texto ya formateado) a dd/mm/aaaa */
function formatearFechaCelda(valor) {
    if (valor === undefined || valor === null || valor === '') return null;
    if (valor instanceof Date) {
        return formatearFecha(valor.getUTCDate(), valor.getUTCMonth() + 1, valor.getUTCFullYear());
    }
    if (typeof valor === 'number') {
        const d = new Date(Math.round((valor - 25569) * 86400 * 1000));
        return formatearFecha(d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear());
    }
    // Texto: intenta extraer fecha reconocible; si no, se devuelve tal cual
    const extraida = extraerFechaDeTexto(String(valor));
    return extraida || String(valor).trim();
}

/** true si la fila (concatenada con y sin espacios) delata a un beneficiario retirado */
function filaEsRetirado(row) {
    if (!row) return false;
    const celdas = row.map(v => (v === undefined || v === null ? '' : String(v)));
    const conEspacios = normalizar(celdas.join(' '));
    if (conEspacios.includes('RETIRAD')) return true;
    // Caso "R E T I R A D A" escrito letra por letra en celdas separadas
    const soloLetras = celdas
        .filter(v => v.trim().length === 1 && /[a-zA-Z]/.test(v.trim()))
        .map(v => v.trim().toUpperCase())
        .join('');
    return soloLetras.includes('RETIRAD');
}

function parseFechaComparable(fechaDDMMAAAA) {
    if (!fechaDDMMAAAA) return null;
    const m = String(fechaDDMMAAAA).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

// ────────────────────────────────────────────────────────────────
// Detección y extracción: layout OFICIAL (posicional, igual a excel-parser.js)
// ────────────────────────────────────────────────────────────────

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

function extraerAsociacionUds(data) {
    let asociacion = '';
    let uds = '';
    for (let i = 5; i < Math.min(data.length, 14); i++) {
        const row = data[i];
        if (!row) continue;
        const rowString = normalizar(row.join(' | '));
        if (rowString.includes('ASOCIACION')) {
            const asocIdx = row.findIndex(v => typeof v === 'string' && normalizar(v).includes('ASOCIACION'));
            if (asocIdx !== -1) asociacion = celdaTexto(row, asocIdx);
            const posibleUds = row.slice(asocIdx + 1).find(v => typeof v === 'string' && v.trim() !== '' && !normalizar(v).includes('NOMBRE DE LA UNIDAD'));
            if (posibleUds) uds = String(posibleUds).trim();
            else if (row[23]) uds = celdaTexto(row, 23);
            break;
        }
    }
    return { asociacion, uds };
}

/** Igual a `obtenerUltimaToma` de excel-parser.js, pero devolviendo también el índice de toma usado */
function obtenerUltimaTomaOficial(row) {
    const iniciosToma = [43, 31, 19, 7];
    for (const inicio of iniciosToma) {
        const fecha = row[inicio];
        const peso = row[inicio + 1];
        const talla = row[inicio + 2];
        const perimetro = row[inicio + 3];
        if (fecha && peso && normalizar(fecha) !== 'RETIRADO' && normalizar(fecha) !== 'RETIRADA') {
            return {
                fecha: formatearFechaCelda(fecha),
                peso: String(peso).trim(),
                talla: talla ? String(talla).trim() : '',
                perimetro: perimetro ? String(perimetro).trim() : '',
            };
        }
    }
    return null;
}

function extraerHojaOficial(data, nombreHoja) {
    const beneficiarios = [];
    const headerIdx = encontrarFilaEncabezadoOficial(data);
    if (headerIdx === -1) return null; // no es formato oficial

    const inicioDatos = headerIdx + 2; // fila de sub-encabezados (TOMA) + 1
    for (let i = inicioDatos; i < data.length; i++) {
        const row = data[i];
        if (!row || !row[1] || !row[2]) continue; // sin documento o sin nombres -> no es fila de datos

        if (filaEsRetirado(row)) continue;

        const toma = obtenerUltimaTomaOficial(row);
        if (!toma) continue;

        beneficiarios.push({
            documento: celdaTexto(row, 1) || 'SIN DOCUMENTO',
            nombres: celdaTexto(row, 2),
            apellidos: celdaTexto(row, 3),
            ...toma,
            hojaOrigen: nombreHoja,
        });
    }
    return beneficiarios;
}

// ────────────────────────────────────────────────────────────────
// Detección y extracción: layout GENÉRICO (por encabezados, cualquier posición)
// ────────────────────────────────────────────────────────────────

const PATRONES_COLUMNA = {
    documento: (n) => n.includes('DOCUMENTO') || n.includes('NUIP') || n.includes('CEDULA') || n.includes('C.C') || n.includes('REGISTRO CIVIL') || n === 'RC',
    nombres: (n) => (n === 'NOMBRES' || n === 'NOMBRE' || n.includes('NOMBRE COMPLETO') || n.includes('NOMBRE DEL BENEFICIARIO') || n.includes('NOMBRE DE LA') === false && n.includes('BENEFICIARIO'))
        && !n.includes('ENTIDAD') && !n.includes('UNIDAD') && !n.includes('RESPONSABLE') && !n.includes('REGIONAL'),
    apellidos: (n) => n.includes('APELLIDO'),
    fecha: (n) => n.includes('FECHA') && (n.includes('TOMA') || n.includes('MEDICION') || n.includes('PESAJE') || n === 'FECHA'),
    peso: (n) => n.includes('PESO'),
    talla: (n) => n.includes('TALLA'),
    perimetro: (n) => n.includes('PERIMETRO') || n.includes('BRAQUIAL'),
};

function encontrarEncabezadoGenerico(data) {
    const limite = Math.min(data.length, 30);
    for (let i = 0; i < limite; i++) {
        const row = data[i];
        if (!row) continue;
        const columnas = {};
        row.forEach((val, idx) => {
            if (typeof val !== 'string') return;
            const n = normalizar(val);
            if (!n) return;
            for (const campo of Object.keys(PATRONES_COLUMNA)) {
                if (columnas[campo] === undefined && PATRONES_COLUMNA[campo](n)) {
                    columnas[campo] = idx;
                }
            }
        });
        // Header válido si trae al menos peso y talla, y (nombres o documento)
        if (columnas.peso !== undefined && columnas.talla !== undefined &&
            (columnas.nombres !== undefined || columnas.documento !== undefined)) {
            return { headerIdx: i, columnas };
        }
    }
    return null;
}

function extraerHojaGenerica(data, nombreHoja) {
    const encontrado = encontrarEncabezadoGenerico(data);
    if (!encontrado) return null;
    const { headerIdx, columnas } = encontrado;

    // Fecha de respaldo: busca en las filas de título (arriba del encabezado) o en el nombre de la hoja
    let fechaRespaldo = null;
    for (let i = 0; i < headerIdx; i++) {
        const row = data[i];
        if (!row) continue;
        for (const val of row) {
            if (typeof val === 'string') {
                const f = extraerFechaDeTexto(val);
                if (f) { fechaRespaldo = f; break; }
            }
        }
        if (fechaRespaldo) break;
    }
    if (!fechaRespaldo) fechaRespaldo = extraerFechaDeTexto(nombreHoja);

    const beneficiarios = [];
    for (let i = headerIdx + 1; i < data.length; i++) {
        const row = data[i];
        if (!row) continue;

        const nombreCrudo = columnas.nombres !== undefined ? celdaTexto(row, columnas.nombres) : '';
        const docCrudo = columnas.documento !== undefined ? celdaTexto(row, columnas.documento) : '';
        const pesoCrudo = columnas.peso !== undefined ? celdaTexto(row, columnas.peso) : '';
        const tallaCrudo = columnas.talla !== undefined ? celdaTexto(row, columnas.talla) : '';

        // Fila vacía o de cierre de tabla
        if (!nombreCrudo && !docCrudo) continue;
        if (!pesoCrudo && !tallaCrudo) continue;
        if (filaEsRetirado(row)) continue;

        const apellidosCrudo = columnas.apellidos !== undefined ? celdaTexto(row, columnas.apellidos) : '';
        const fechaCelda = columnas.fecha !== undefined ? formatearFechaCelda(row[columnas.fecha]) : null;

        beneficiarios.push({
            documento: docCrudo || 'SIN DOCUMENTO',
            nombres: nombreCrudo,
            apellidos: apellidosCrudo,
            fecha: fechaCelda || fechaRespaldo || '',
            peso: pesoCrudo,
            talla: tallaCrudo,
            perimetro: columnas.perimetro !== undefined ? celdaTexto(row, columnas.perimetro) : '',
            hojaOrigen: nombreHoja,
        });
    }
    return beneficiarios;
}

// ────────────────────────────────────────────────────────────────
// Orquestador
// ────────────────────────────────────────────────────────────────

/**
 * Lee un Excel de formato variable y devuelve los beneficiarios detectados,
 * recorriendo TODAS las hojas (no solo la primera).
 */
function analizarExcel(rutaEntrada) {
    if (!fs.existsSync(rutaEntrada)) {
        throw new Error(`El archivo no existe: ${rutaEntrada}`);
    }

    const wb = xlsx.readFile(rutaEntrada, { cellDates: true });
    let asociacion = '';
    let uds = '';
    const todos = [];
    const resumenHojas = [];

    for (const nombreHoja of wb.SheetNames) {
        const sheet = wb.Sheets[nombreHoja];
        const data = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });
        if (!data || data.length === 0) {
            resumenHojas.push({ hoja: nombreHoja, tipo: 'vacia', encontrados: 0 });
            continue;
        }

        let extraidos = extraerHojaOficial(data, nombreHoja);
        let tipo = 'oficial';
        if (extraidos) {
            const au = extraerAsociacionUds(data);
            if (au.asociacion && !asociacion) asociacion = au.asociacion;
            if (au.uds && !uds) uds = au.uds;
        } else {
            extraidos = extraerHojaGenerica(data, nombreHoja);
            tipo = 'generico';
        }

        if (!extraidos) {
            resumenHojas.push({ hoja: nombreHoja, tipo: 'no-reconocida', encontrados: 0 });
            continue;
        }

        resumenHojas.push({ hoja: nombreHoja, tipo, encontrados: extraidos.length });
        todos.push(...extraidos);
    }

    // Deduplicar: si el mismo documento (o el mismo nombre cuando no hay documento)
    // aparece varias veces, se conserva la toma con la fecha más reciente.
    const porClave = new Map();
    for (const b of todos) {
        const clave = (b.documento && b.documento !== 'SIN DOCUMENTO')
            ? `DOC:${normalizar(b.documento)}`
            : `NOM:${normalizar(b.nombres + ' ' + b.apellidos)}`;

        const previo = porClave.get(clave);
        if (!previo) {
            porClave.set(clave, b);
            continue;
        }
        const fechaNueva = parseFechaComparable(b.fecha);
        const fechaPrevia = parseFechaComparable(previo.fecha);
        if (fechaNueva && fechaPrevia) {
            if (fechaNueva >= fechaPrevia) porClave.set(clave, b);
        } else {
            // Sin fechas comparables: se conserva la última encontrada (asumida más reciente)
            porClave.set(clave, b);
        }
    }

    return {
        asociacion,
        uds,
        beneficiarios: Array.from(porClave.values()),
        resumenHojas,
    };
}

/**
 * Genera un workbook con la estructura posicional que `excel-parser.js` espera
 * (documento en B, nombres en C, apellidos en D, Toma 1 = fecha/peso/talla/perímetro
 * en H:K, empezando en la fila 16). El resto de columnas del formato oficial
 * (sexo, fecha nacimiento, lactancia, etc.) se dejan en blanco a propósito.
 */
function generarWorkbookOficial({ asociacion, uds, beneficiarios }) {
    const filas = [];
    filas[0] = [];
    filas[7] = ['REGIONAL:', null, null, null, null];
    filas[8] = ['NOMBRE DE LA ENTIDAD ADMINISTRADORA DE SERVICIO O DEL PRESTADOR DIRECTO DE ATENCIÓN:', null, null, null, asociacion || ''];
    filas[8][13] = 'NOMBRE DE LA UNIDAD DE SERVICIO / UNIDAD DE ATENCIÓN / UNIDAD COMUNITARIA DE ATENCIÓN:';
    filas[8][23] = uds || '';
    filas[13] = [];
    filas[13][0] = 'No. DE ORDEN';
    filas[13][1] = 'No. DE DOCUMENTO DE IDENTIDAD\n(NUIP)';
    filas[13][2] = 'NOMBRES';
    filas[13][3] = 'APELLIDOS';
    filas[13][4] = 'Sexo\n(H: Hombre / M:  Mujer)';
    filas[13][5] = 'FECHA DE NACIMIENTO\n\n(dd/mm/aaaa)';
    filas[13][6] = 'FECHA DE INGRESO AL SERVICIO O MODALIDAD\n\n(dd/mm/aaaa)';
    filas[13][7] = 'TOMA Nº 1';
    filas[14] = [];
    filas[14][7] = 'FECHA DE LA TOMA\n\n(dd/mm/aaaa)';
    filas[14][8] = 'PESO (kg)';
    filas[14][9] = 'TALLA (cm)';
    filas[14][10] = 'PERÍMETRO BRAQUIAL (cm)';

    beneficiarios.forEach((b, idx) => {
        const fila = [];
        fila[0] = idx + 1;
        fila[1] = b.documento;
        fila[2] = b.nombres;
        fila[3] = b.apellidos || '';
        fila[7] = b.fecha || '';
        fila[8] = b.peso || '';
        fila[9] = b.talla || '';
        fila[10] = b.perimetro || '';
        filas[15 + idx] = fila;
    });

    const ws = xlsx.utils.aoa_to_sheet(filas);

    // aoa_to_sheet calcula el rango (!ref) solo a partir de las celdas con
    // contenido. Como las primeras filas del encabezado institucional suelen
    // quedar vacías, el rango podía "empezar" más abajo de la fila 1 y eso
    // desfasaba la lectura posicional de excel-parser.js. Se fuerza A1 como
    // esquina superior para que las filas de datos siempre caigan donde
    // excel-parser.js las espera (fila 16 en adelante).
    const rangoActual = xlsx.utils.decode_range(ws['!ref']);
    rangoActual.s.r = 0;
    rangoActual.s.c = 0;
    ws['!ref'] = xlsx.utils.encode_range(rangoActual);

    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Formato captura');
    return wb;
}

function convertirArchivo(rutaEntrada, rutaSalida) {
    const resultado = analizarExcel(rutaEntrada);
    const wb = generarWorkbookOficial(resultado);
    xlsx.writeFile(wb, rutaSalida);
    return resultado;
}

module.exports = {
    analizarExcel,
    generarWorkbookOficial,
    convertirArchivo,
    // exportados para pruebas
    extraerFechaDeTexto,
    filaEsRetirado,
};
