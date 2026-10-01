/**
 * calendario-colombia.js
 * 
 * Módulo oficial para el cálculo de días hábiles de atención en jardines ICBF:
 * 1. Festivos oficiales de Colombia (Ley 51 de 1983 - Ley Emiliani y Festivos Fijos/Pascua).
 * 2. Regla institucional ICBF: El ÚLTIMO VIERNES de cada mes no hay servicio de jardín (jornada pedagógica/cualificación).
 * 3. Fines de semana (Sábados y Domingos).
 * 4. Días de atención efectiva (asistencia por defecto para todos los niños).
 */

const NOMBRES_MESES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

/**
 * Cálculo del Domingo de Pascua (Algoritmo de Butcher / Meeus)
 */
function calcularPascua(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=Marzo, 4=Abril
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
}

/**
 * Traslada una fecha al siguiente lunes si no cae en lunes (Ley Emiliani)
 */
function siguienteLunes(fecha) {
    const f = new Date(fecha.getTime());
    const day = f.getDay(); // 0=Dom, 1=Lun, ..., 6=Sáb
    if (day === 1) return f;
    const diff = (day === 0) ? 1 : (8 - day);
    f.setDate(f.getDate() + diff);
    return f;
}

function sumarDias(fecha, dias) {
    const f = new Date(fecha.getTime());
    f.setDate(f.getDate() + dias);
    return f;
}

/**
 * Retorna todos los festivos oficiales de Colombia para un año específico
 */
function obtenerFestivosColombia(year) {
    const pascua = calcularPascua(year);
    const festivos = [];

    // 1. Fijos inamovibles
    festivos.push({ nombre: 'Año Nuevo', fecha: new Date(year, 0, 1) });
    festivos.push({ nombre: 'Día del Trabajo', fecha: new Date(year, 4, 1) });
    festivos.push({ nombre: 'Día de la Independencia', fecha: new Date(year, 6, 20) });
    festivos.push({ nombre: 'Batalla de Boyacá', fecha: new Date(year, 7, 7) });
    festivos.push({ nombre: 'Inmaculada Concepción', fecha: new Date(year, 11, 8) });
    festivos.push({ nombre: 'Navidad', fecha: new Date(year, 11, 25) });

    // 2. Fijos trasladables al siguiente lunes (Ley Emiliani)
    festivos.push({ nombre: 'Reyes Magos', fecha: siguienteLunes(new Date(year, 0, 6)) });
    festivos.push({ nombre: 'Día de San José', fecha: siguienteLunes(new Date(year, 2, 19)) });
    festivos.push({ nombre: 'San Pedro y San Pablo', fecha: siguienteLunes(new Date(year, 5, 29)) });
    festivos.push({ nombre: 'Asunción de la Virgen', fecha: siguienteLunes(new Date(year, 7, 15)) });
    festivos.push({ nombre: 'Día de la Raza', fecha: siguienteLunes(new Date(year, 9, 12)) });
    festivos.push({ nombre: 'Todos los Santos', fecha: siguienteLunes(new Date(year, 10, 1)) });
    festivos.push({ nombre: 'Independencia de Cartagena', fecha: siguienteLunes(new Date(year, 10, 11)) });

    // 3. Relativos a Pascua
    festivos.push({ nombre: 'Jueves Santo', fecha: sumarDias(pascua, -3) });
    festivos.push({ nombre: 'Viernes Santo', fecha: sumarDias(pascua, -2) });
    festivos.push({ nombre: 'Ascensión del Señor', fecha: siguienteLunes(sumarDias(pascua, 39)) });
    festivos.push({ nombre: 'Corpus Christi', fecha: siguienteLunes(sumarDias(pascua, 60)) });
    festivos.push({ nombre: 'Sagrado Corazón de Jesús', fecha: siguienteLunes(sumarDias(pascua, 68)) });

    return festivos
        .map(f => {
            const y = f.fecha.getFullYear();
            const m = f.fecha.getMonth();
            const d = f.fecha.getDate();
            const fechaStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            return {
                nombre: f.nombre,
                fecha: f.fecha,
                fechaStr,
                anio: y,
                mesIndex: m,
                dia: d
            };
        })
        .sort((a, b) => a.fecha - b.fecha);
}

/**
 * Retorna el día del mes correspondiente al ÚLTIMO VIERNES
 */
function obtenerUltimoViernes(year, monthIndex) {
    const ultimoDia = new Date(year, monthIndex + 1, 0);
    const dow = ultimoDia.getDay(); // 0=Dom, 1=Lun, ..., 5=Vie, 6=Sáb
    const diff = (dow >= 5) ? (dow - 5) : (dow + 2);
    return ultimoDia.getDate() - diff;
}

/**
 * Determina si un día particular es hábil de jardín o describe por qué no lo es
 */
function verificarDiaJardin(year, monthIndex, day) {
    const fecha = new Date(year, monthIndex, day);
    const dayOfWeek = fecha.getDay(); // 0=Dom, 6=Sáb

    // Fines de semana
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return {
            esHabil: false,
            motivo: 'Fin de semana',
            tipo: 'FIN_DE_SEMANA',
            diaSemana: dayOfWeek
        };
    }

    // Festivos
    const festivos = obtenerFestivosColombia(year);
    const festivo = festivos.find(f => f.mesIndex === monthIndex && f.dia === day);
    if (festivo) {
        return {
            esHabil: false,
            motivo: `Festivo Nacional: ${festivo.nombre}`,
            tipo: 'FESTIVO',
            nombreFestivo: festivo.nombre
        };
    }

    // Último viernes del mes (Jornada pedagógica)
    const ultimoViernes = obtenerUltimoViernes(year, monthIndex);
    if (day === ultimoViernes) {
        return {
            esHabil: false,
            motivo: 'Último Viernes de Mes: Jornada Pedagógica / Planeación ICBF (Sin Jardín)',
            tipo: 'ULTIMO_VIERNES',
            esUltimoViernes: true
        };
    }

    return {
        esHabil: true,
        motivo: 'Día Hábil de Jardín (Asistencia requerida)',
        tipo: 'HABIL'
    };
}

/**
 * Retorna el calendario completo de un mes dado para jardín ICBF
 */
function obtenerCalendarioMesJardin(year, mesNombreOIndex) {
    let monthIndex = -1;
    if (typeof mesNombreOIndex === 'number') {
        monthIndex = mesNombreOIndex;
    } else if (mesNombreOIndex !== undefined && mesNombreOIndex !== null && !isNaN(parseInt(mesNombreOIndex, 10)) && String(mesNombreOIndex).trim().length <= 2) {
        monthIndex = parseInt(mesNombreOIndex, 10);
    } else if (mesNombreOIndex) {
        monthIndex = NOMBRES_MESES.findIndex(m => m.toLowerCase() === String(mesNombreOIndex).toLowerCase());
    }
    
    if (monthIndex < 0 || monthIndex > 11) monthIndex = new Date().getMonth();

    const nombreMes = NOMBRES_MESES[monthIndex];
    const totalDias = new Date(year, monthIndex + 1, 0).getDate();
    const ultimoViernes = obtenerUltimoViernes(year, monthIndex);
    const festivosDelMes = obtenerFestivosColombia(year).filter(f => f.mesIndex === monthIndex);

    const dias = [];
    const diasHabiles = [];
    const diasInhabiles = [];

    for (let d = 1; d <= totalDias; d++) {
        const info = verificarDiaJardin(year, monthIndex, d);
        const item = {
            dia: d,
            mesIndex: monthIndex,
            anio: year,
            ...info
        };
        dias.push(item);
        if (info.esHabil) {
            diasHabiles.push(d);
        } else {
            diasInhabiles.push(item);
        }
    }

    return {
        year,
        monthIndex,
        nombreMes,
        totalDias,
        ultimoViernes,
        festivosDelMes,
        dias,
        diasHabiles,
        totalDiasHabiles: diasHabiles.length,
        diasInhabiles
    };
}

/**
 * Agrupa los días hábiles del mes en 4 o 5 semanas
 */
function calcularSemanasDelMesConFestivos(year, mesNombreOIndex) {
    const cal = obtenerCalendarioMesJardin(year, mesNombreOIndex);
    const semanas = {};
    let semanaActual = 1;
    let diasEnSemana = 0;

    for (const d of cal.dias) {
        const fecha = new Date(year, cal.monthIndex, d.dia);
        const dow = fecha.getDay(); // 0=Dom, 1=Lun, ..., 5=Vie, 6=Sáb

        if (dow >= 1 && dow <= 5) {
            if (!semanas[semanaActual]) {
                semanas[semanaActual] = {
                    numero: semanaActual,
                    dias: []
                };
            }
            semanas[semanaActual].dias.push({
                diaNumero: d.dia,
                diaSemana: dow,
                nombreDia: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][dow],
                esHabil: d.esHabil,
                motivo: d.motivo,
                tipo: d.tipo
            });
            diasEnSemana++;
        } else if (dow === 0 && diasEnSemana > 0) {
            semanaActual++;
            diasEnSemana = 0;
        }
    }

    return {
        ...cal,
        semanas
    };
}

module.exports = {
    NOMBRES_MESES,
    calcularPascua,
    siguienteLunes,
    obtenerFestivosColombia,
    obtenerUltimoViernes,
    verificarDiaJardin,
    obtenerCalendarioMesJardin,
    calcularSemanasDelMesConFestivos
};
