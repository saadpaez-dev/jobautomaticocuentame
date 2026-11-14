/**
 * servicios/evaluador-nutricion.js
 * 
 * Motor de evaluación y clasificación nutricional para Colombia / ICBF
 * basado en la Resolución 2465 de 2016 (MinSalud) y Patrones OMS 2006 (0-5 años).
 */

const who = require('who-growth-standards');

function parsearFecha(fechaStr) {
    if (!fechaStr) return null;
    const parts = String(fechaStr).trim().split(/[\/-]/);
    if (parts.length === 3) {
        let d = parseInt(parts[0], 10);
        let m = parseInt(parts[1], 10) - 1;
        let y = parseInt(parts[2], 10);
        if (String(parts[0]).length === 4) { // YYYY-MM-DD
            y = parseInt(parts[0], 10);
            m = parseInt(parts[1], 10) - 1;
            d = parseInt(parts[2], 10);
        }
        return new Date(y, m, d);
    }
    const d = new Date(fechaStr);
    return isNaN(d.getTime()) ? null : d;
}

function calcularEdadEnMeses(fechaNac, fechaRef = new Date()) {
    if (!fechaNac) return 0;
    let meses = (fechaRef.getFullYear() - fechaNac.getFullYear()) * 12 + (fechaRef.getMonth() - fechaNac.getMonth());
    if (fechaRef.getDate() < fechaNac.getDate()) {
        meses--;
    }
    return Math.max(0, meses);
}

function calcularEdadEnDias(fechaNac, fechaRef = new Date()) {
    if (!fechaNac) return 0;
    const diff = fechaRef.getTime() - fechaNac.getTime();
    return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)));
}

function normalizarSexo(sexoRaw) {
    if (!sexoRaw) return 'male';
    const s = String(sexoRaw).trim().toLowerCase();
    if (s.startsWith('m') && !s.startsWith('masc') && s !== 'male') {
        // En español 'Mujer' empieza con M. Pero 'M' también a veces se usa para Masculino.
        // Si dice 'mujer' o 'femenino' o 'f':
        if (s.includes('muj') || s.includes('fem') || s === 'f') return 'female';
    }
    if (s.includes('muj') || s.includes('fem') || s === 'f' || s === 'female' || s === 'mujer') {
        return 'female';
    }
    return 'male';
}

/**
 * Evalúa los indicadores nutricionales según la Resolución 2465 de 2016
 */
function evaluarNutricion({ peso, talla, fechaNacimiento, sexo, fechaToma, perimetroBraquial }) {
    const p = parseFloat(peso);
    const t = parseFloat(talla);
    const pb = perimetroBraquial ? parseFloat(perimetroBraquial) : null;

    if (isNaN(p) || isNaN(t) || p <= 0 || t <= 0) {
        throw new Error('Peso y talla deben ser números mayores a cero.');
    }

    const fNac = parsearFecha(fechaNacimiento);
    const fToma = parsearFecha(fechaToma) || new Date();

    if (!fNac) {
        throw new Error('Fecha de nacimiento no válida.');
    }

    const ageDays = calcularEdadEnDias(fNac, fToma);
    const ageMonths = calcularEdadEnMeses(fNac, fToma);
    const whoSex = normalizarSexo(sexo);

    // 1. Talla para la Edad (T/E)
    let zTE = null;
    let estadoTE = 'Talla adecuada para la edad';
    let semaforoTE = 'verde';
    try {
        const resTE = who.heightForAge(t, { sex: whoSex, ageDays, clamp: true });
        zTE = parseFloat(resTE.zScore.toFixed(2));
        if (zTE < -2.00) {
            estadoTE = 'Retraso en talla';
            semaforoTE = 'rojo';
        } else if (zTE < -1.00) {
            estadoTE = 'Riesgo de baja talla';
            semaforoTE = 'amarillo';
        } else {
            estadoTE = 'Talla adecuada para la edad';
            semaforoTE = 'verde';
        }
    } catch(e) {}

    // 2. Peso para la Talla (P/T)
    let zPT = null;
    let estadoPT = 'Peso adecuado para la talla';
    let semaforoPT = 'verde';
    try {
        let resPT = null;
        if (t >= 65 && t <= 120) {
            resPT = who.weightForHeight(p, t, whoSex, { clamp: true });
        } else if (t >= 45 && t < 65) {
            resPT = who.weightForLength(p, t, whoSex, { clamp: true });
        } else {
            resPT = who.weightForHeight(p, Math.min(Math.max(t, 65), 120), whoSex, { clamp: true });
        }

        if (resPT && resPT.zScore !== undefined) {
            zPT = parseFloat(resPT.zScore.toFixed(2));
            if (zPT < -3.00) {
                estadoPT = 'Desnutrición aguda severa';
                semaforoPT = 'rojo-critico';
            } else if (zPT < -2.00) {
                estadoPT = 'Desnutrición aguda moderada';
                semaforoPT = 'rojo';
            } else if (zPT < -1.00) {
                estadoPT = 'Riesgo de desnutrición aguda';
                semaforoPT = 'amarillo';
            } else if (zPT <= 1.00) {
                estadoPT = 'Peso adecuado para la talla';
                semaforoPT = 'verde';
            } else if (zPT <= 2.00) {
                estadoPT = 'Riesgo de Sobrepeso';
                semaforoPT = 'amarillo';
            } else if (zPT <= 3.00) {
                estadoPT = 'Sobrepeso';
                semaforoPT = 'naranja';
            } else {
                estadoPT = 'Obesidad';
                semaforoPT = 'morado';
            }
        }
    } catch(e) {}

    // 3. Peso para la Edad (P/E)
    let zPE = null;
    let estadoPE = 'Peso adecuado para la edad';
    let semaforoPE = 'verde';
    try {
        const resPE = who.weightForAge(p, { sex: whoSex, ageDays, clamp: true });
        zPE = parseFloat(resPE.zScore.toFixed(2));
        if (zPE > 1.00) {
            estadoPE = 'No Aplica'; // Por resolución 2465/2016
            semaforoPE = 'gris';
        } else if (zPE < -2.00) {
            estadoPE = 'DESNUTRICIÓN GLOBAL';
            semaforoPE = 'rojo';
        } else if (zPE < -1.00) {
            estadoPE = 'Riesgo de peso bajo para la edad';
            semaforoPE = 'amarillo';
        } else {
            estadoPE = 'Peso adecuado para la edad';
            semaforoPE = 'verde';
        }
    } catch(e) {}

    // 4. IMC para la Edad (IMC/E)
    let imc = parseFloat((p / ((t / 100) * (t / 100))).toFixed(2));
    let zIMC = null;
    let estadoIMC = 'Adecuado para la edad';
    let semaforoIMC = 'verde';
    try {
        const resIMC = who.bmiForAge(imc, { sex: whoSex, ageDays, clamp: true });
        zIMC = parseFloat(resIMC.zScore.toFixed(2));
        if (zIMC > 3.00) {
            estadoIMC = 'Obesidad';
            semaforoIMC = 'morado';
        } else if (zIMC > 2.00) {
            estadoIMC = 'Sobrepeso';
            semaforoIMC = 'naranja';
        } else if (zIMC > 1.00) {
            estadoIMC = 'Riesgo de Sobrepeso';
            semaforoIMC = 'amarillo';
        } else if (zIMC < -2.00) {
            estadoIMC = 'Delgadez';
            semaforoIMC = 'rojo';
        } else if (zIMC < -1.00) {
            estadoIMC = 'Riesgo para la delgadez';
            semaforoIMC = 'amarillo';
        } else {
            estadoIMC = 'Adecuado para la edad';
            semaforoIMC = 'verde';
        }
    } catch(e) {}

    // 5. Perímetro Braquial (Tamizaje complementario 6 a 59 meses)
    let alertaPB = null;
    if (pb && ageMonths >= 6 && ageMonths <= 59) {
        if (pb < 11.5) {
            alertaPB = 'Desnutrición Aguda Severa por Perímetro Braquial (< 11.5 cm)';
        } else if (pb < 12.5) {
            alertaPB = 'Riesgo / Desnutrición Moderada por Perímetro Braquial (11.5 - 12.5 cm)';
        }
    }

    // Semáforo Global Consolidado
    let semaforoGlobal = 'verde';
    let badgeClass = 'bg-success';
    let tituloDiagnostico = 'Peso y Talla Adecuados';
    let descripcionDiagnostico = 'El niño se encuentra en rango normal y armónico de crecimiento y peso.';

    if (semaforoPT === 'rojo-critico' || semaforoPT === 'rojo' || semaforoTE === 'rojo' || semaforoPE === 'rojo' || (alertaPB && alertaPB.includes('Severa'))) {
        semaforoGlobal = 'rojo';
        badgeClass = 'bg-danger text-white';
        if (estadoPT.includes('Desnutrición')) {
            tituloDiagnostico = estadoPT;
            descripcionDiagnostico = 'Alerta prioritaria de desnutrición aguda. Requiere reporte y seguimiento.';
        } else if (estadoTE === 'Retraso en talla') {
            tituloDiagnostico = 'Retraso en Talla (Desnutrición Crónica)';
            descripcionDiagnostico = 'La estatura está por debajo del rango esperado para su edad (-2 DE).';
        } else {
            tituloDiagnostico = 'Desnutrición Global';
            descripcionDiagnostico = 'Déficit de peso global en relación con la edad cumplida.';
        }
    } else if (semaforoPT === 'morado' || semaforoPT === 'naranja') {
        semaforoGlobal = semaforoPT === 'morado' ? 'morado' : 'naranja';
        badgeClass = semaforoPT === 'morado' ? 'bg-purple text-white' : 'bg-warning text-dark';
        tituloDiagnostico = estadoPT;
        descripcionDiagnostico = 'Exceso de peso corporal para la estatura actual.';
    } else if (semaforoPT === 'amarillo' || semaforoTE === 'amarillo' || semaforoPE === 'amarillo') {
        semaforoGlobal = 'amarillo';
        badgeClass = 'bg-warning text-dark';
        tituloDiagnostico = estadoPT.includes('Riesgo') ? estadoPT : (estadoTE.includes('Riesgo') ? estadoTE : estadoPE);
        descripcionDiagnostico = 'En zona de riesgo preventivo (-1 a -2 DE o +1 a +2 DE). Mantener vigilancia.';
    }

    // Calcular rangos recomendados para orientación pedagógica a la madre
    let pesoMinSaludable = null;
    let pesoMaxSaludable = null;
    try {
        const tbl = who.getTable('wfh', whoSex);
        const lms = who.lookupLms(tbl, Math.min(Math.max(t, 65), 120), { clamp: true });
        pesoMinSaludable = parseFloat(who.zScoreToValue(-1.0, lms.l, lms.m, lms.s).toFixed(1));
        pesoMaxSaludable = parseFloat(who.zScoreToValue(+1.0, lms.l, lms.m, lms.s).toFixed(1));
    } catch(e) {}

    return {
        peso: p,
        talla: t,
        perimetroBraquial: pb,
        edadMeses: ageMonths,
        edadDias: ageDays,
        sexo: whoSex === 'female' ? 'Mujer' : 'Hombre',
        imc,
        // Z-Scores oficiales
        zTE, estadoTE, semaforoTE,
        zPT, estadoPT, semaforoPT,
        zPE, estadoPE, semaforoPE,
        zIMC, estadoIMC, semaforoIMC,
        alertaPB,
        // Semáforo y diagnóstico
        semaforoGlobal,
        badgeClass,
        tituloDiagnostico,
        descripcionDiagnostico,
        rangoPesoSaludable: {
            minKg: pesoMinSaludable,
            maxKg: pesoMaxSaludable,
            mensaje: pesoMinSaludable && pesoMaxSaludable 
                ? `Para su estatura de ${t} cm, el peso ideal en Cuéntame está entre ${pesoMinSaludable} kg y ${pesoMaxSaludable} kg.` 
                : ''
        }
    };
}

module.exports = {
    evaluarNutricion,
    calcularEdadEnMeses,
    calcularEdadEnDias,
    parsearFecha,
    normalizarSexo
};
