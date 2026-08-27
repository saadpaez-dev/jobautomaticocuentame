/**
 * convertir-pdf-nutricion.js
 * Script interactivo para ejecutar la conversión automatizada de PDFs escaneados a Excel.
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline-sync');
const { spawnSync } = require('child_process');

const c = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
  rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
  gris:     (t) => `\x1b[90m${t}\x1b[0m`,
  negrita:  (t) => `\x1b[1m${t}\x1b[0m`,
};

function main() {
    console.clear();
    console.log(c.cyan(`
  ╔════════════════════════════════════════════════════════════════════╗
  ║     📄 CONVERTIDOR AUTOMATICO: PDF ➔ EXCEL (PESO Y TALLA)        ║
  ╚════════════════════════════════════════════════════════════════════╝
    `));
    console.log(c.gris('  Este modulo escanea la carpeta "docs/peso y talla" buscando archivos PDF enviadas por las Madres Comunitarias.\n'));

    const pesoytallaDir = path.join(__dirname, '..', 'docs', 'peso y talla');
    if (!fs.existsSync(pesoytallaDir)) {
        fs.mkdirSync(pesoytallaDir, { recursive: true });
    }

    const archivosPdf = fs.readdirSync(pesoytallaDir).filter(f => f.toLowerCase().endsWith('.pdf'));

    if (archivosPdf.length === 0) {
        console.log(c.rojo(`  ❌ No se encontraron archivos .pdf en la carpeta:\n     ${pesoytallaDir}\n`));
        console.log(c.amarillo('  Coloque los archivos PDF en dicha carpeta y vuelva a intentarlo.\n'));
        readline.question(c.negrita('  Presione ENTER para salir...'));
        return;
    }

    console.log(c.cyan(`  📂 Archivos PDF detectados (${archivosPdf.length}):`));
    archivosPdf.forEach((f, idx) => {
        console.log(`     ${idx + 1}. ${f}`);
    });

    const confirm = readline.question(c.negrita('\n  > Deseas iniciar la conversion automatica a Excel? (s/n) [por defecto s]: ')).trim().toLowerCase();
    if (confirm !== '' && confirm !== 's' && confirm !== 'si' && confirm !== 'y') {
        console.log(c.amarillo('\n  Operacion cancelada. Volviendo al menu...\n'));
        return;
    }

    console.log(c.cyan('\n  ⚡ Ejecutando motor de extraccion OCR y cruce con BD Master...\n'));
    const scriptPython = path.join(__dirname, '..', 'servicios', 'convertir_pdf_nutricion.py');

    try {
        const res = spawnSync('python', [scriptPython], { stdio: 'inherit' });
        if (res.status === 0) {
            console.log(c.verde('\n  🎉 Proceso de conversion completado con exito.'));
        } else {
            console.log(c.rojo(`\n  ⚠️ El proceso de conversion finalizo con codigo: ${res.status}`));
        }
    } catch (e) {
        console.log(c.rojo(`\n  ❌ Error ejecutando el convertidor: ${e.message}`));
    }

    readline.question(c.negrita('\n  Presione ENTER para continuar...'));
}

main();
