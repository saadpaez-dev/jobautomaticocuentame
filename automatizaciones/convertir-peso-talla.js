/**
 * convertir-peso-talla.js
 *
 * Convierte un Excel de peso/talla con formato variable (el que te envían las
 * asociaciones) al formato posicional que ya sabe leer `servicios/excel-parser.js`,
 * para poder cargarlo directo en `automatizaciones/peso-talla.js` (opción 1 o 2
 * del menú) sin que el script original falle por formato distinto.
 *
 * Solo se conservan: documento, nombres, apellidos, fecha de la toma, peso,
 * talla y perímetro braquial. El resto del formato oficial (sexo, fecha de
 * nacimiento, lactancia, etc.) se deja en blanco a propósito.
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline-sync');
const { analizarExcel, convertirArchivo } = require('../servicios/conversor-peso-talla');

const c = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
  rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
  gris:     (t) => `\x1b[90m${t}\x1b[0m`,
  negrita:  (t) => `\x1b[1m${t}\x1b[0m`,
};

function obtenerRutaExcel() {
    const docsDir = path.join(__dirname, '..', 'Docs', 'peso y talla');
    let archivos = [];
    if (fs.existsSync(docsDir)) {
        archivos = fs.readdirSync(docsDir).filter(f => !f.startsWith('~') && !f.includes('_CONVERTIDO') && (f.endsWith('.xlsx') || f.endsWith('.xls')));
    }
    if (archivos.length > 0) {
        console.log(c.cyan('\n  Archivos Excel encontrados en "Docs/peso y talla":'));
        archivos.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
        console.log('  0. Escribir/Pegar ruta manualmente');
        let idx = -1;
        while (idx < 0 || idx > archivos.length) {
            const res = readline.question(c.negrita('\n  > Selecciona el archivo a convertir (0-N): '));
            idx = parseInt(res, 10);
            if (isNaN(idx)) idx = -1;
        }
        if (idx > 0) return path.join(docsDir, archivos[idx - 1]);
    }
    return readline.question(c.negrita('\n  > Arrastra el archivo Excel aquí o pega la ruta: ')).replace(/['"]/g, '').trim();
}

function main() {
    console.log(c.cyan('\n======================================================'));
    console.log(c.cyan('   🔄  CONVERSOR DE EXCEL DE PESO Y TALLA'));
    console.log(c.cyan('======================================================'));

    const rutaEntrada = obtenerRutaExcel();
    if (!rutaEntrada || !fs.existsSync(rutaEntrada)) {
        console.log(c.rojo('\n  ❌ No se encontró el archivo indicado.\n'));
        return;
    }

    let resultado;
    try {
        resultado = analizarExcel(rutaEntrada);
    } catch (e) {
        console.log(c.rojo(`\n  ❌ Error leyendo el Excel: ${e.message}\n`));
        return;
    }

    console.log(c.cyan('\n  📋 Resumen por hoja:'));
    resultado.resumenHojas.forEach(h => {
        const etiqueta = h.tipo === 'no-reconocida'
            ? c.rojo(`no reconocida (0 beneficiarios)`)
            : h.tipo === 'vacia'
                ? c.gris('vacia')
                : c.verde(`${h.tipo} → ${h.encontrados} beneficiario(s)`);
        console.log(`    - "${h.hoja}": ${etiqueta}`);
    });

    if (resultado.beneficiarios.length === 0) {
        console.log(c.rojo('\n  ❌ No se detectó ningún beneficiario en este Excel. Revísalo manualmente.\n'));
        return;
    }

    const sinDocumento = resultado.beneficiarios.filter(b => b.documento === 'SIN DOCUMENTO');
    console.log(c.verde(`\n  ✅ Total beneficiarios detectados: ${resultado.beneficiarios.length}`));
    if (sinDocumento.length > 0) {
        console.log(c.amarillo(`  ⚠️ ${sinDocumento.length} sin número de documento (se buscarán por nombre en Cuéntame):`));
        sinDocumento.forEach(b => console.log(c.gris(`     - ${b.nombres} ${b.apellidos}`.trim())));
    }

    console.log(c.cyan('\n  Vista previa (primeros 5):'));
    resultado.beneficiarios.slice(0, 5).forEach(b => {
        console.log(c.gris(`   - ${b.documento} | ${b.nombres} ${b.apellidos} | ${b.fecha} | ${b.peso}kg | ${b.talla}cm | PB ${b.perimetro}cm`));
    });

    const confirmar = readline.keyInYNStrict(c.negrita('\n  ¿Generar el Excel convertido?'));
    if (!confirmar) {
        console.log(c.amarillo('\n  Cancelado.\n'));
        return;
    }

    const dir = path.dirname(rutaEntrada);
    const base = path.basename(rutaEntrada, path.extname(rutaEntrada));
    const rutaSalida = path.join(dir, `${base}_CONVERTIDO.xlsx`);

    convertirArchivo(rutaEntrada, rutaSalida);

    console.log(c.verde(`\n  ✅ Archivo convertido guardado en:`));
    console.log(c.negrita(`     ${rutaSalida}`));
    console.log(c.cyan('\n  Ya puedes cargarlo desde "peso-talla.js" (opción 1 o 2 del menú).\n'));
}

main();
