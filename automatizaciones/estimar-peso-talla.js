/**
 * estimar-peso-talla.js
 *
 * ⚠️ Genera un ESTIMADO INTERNO de peso/talla a la fecha de hoy, proyectando
 * la tendencia de crecimiento de cada niño. NO es una toma real y no debe
 * cargarse como medición oficial al ICBF.
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline-sync');
const { generarArchivo } = require('../servicios/estimador-crecimiento');

const c = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
  rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
  negrita:  (t) => `\x1b[1m${t}\x1b[0m`,
};

function main() {
    console.log(c.cyan('\n======================================================'));
    console.log(c.cyan('   📈  ESTIMADOR DE PESO/TALLA A LA FECHA DE HOY'));
    console.log(c.amarillo('   (estimado interno — NO es una toma real)'));
    console.log(c.cyan('======================================================'));

    const rutaEntrada = readline.question(c.negrita('\n  > Arrastra el Excel (Formato captura) o pega la ruta: ')).replace(/['"]/g, '').trim();
    if (!rutaEntrada || !fs.existsSync(rutaEntrada)) {
        console.log(c.rojo('\n  ❌ No se encontró el archivo indicado.\n'));
        return;
    }

    const dir = path.dirname(rutaEntrada);
    const base = path.basename(rutaEntrada, path.extname(rutaEntrada));
    const rutaSalida = path.join(dir, `${base}_ESTIMADO_HOY.xlsx`);

    let calculo;
    try {
        calculo = generarArchivo(rutaEntrada, rutaSalida, new Date());
    } catch (e) {
        console.log(c.rojo(`\n  ❌ Error: ${e.message}\n`));
        return;
    }

    console.log(c.verde(`\n  ✅ ${calculo.resultados.length} niños procesados.`));
    console.log(`     - Con tendencia propia (2+ tomas): ${calculo.totalConTendenciaPropia}`);
    console.log(`     - Con promedio del grupo (1 sola toma): ${calculo.totalConPromedioGrupo}`);
    console.log(c.verde(`\n  📄 Reporte guardado en:`));
    console.log(c.negrita(`     ${rutaSalida}`));
    console.log(c.amarillo('\n  Recuerda: estos valores son proyectados, no medidos. No los cargues como toma real.\n'));
}

main();
