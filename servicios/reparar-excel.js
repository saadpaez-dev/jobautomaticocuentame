const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const xlsx = require('xlsx');

async function reparar(inputPath, outputPath) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(inputPath);
    await wb.xlsx.writeFile(outputPath);
}

function repararArchivoSync(inputPath) {
    const tempFixed = path.join(os.tmpdir(), `repaired_${Date.now()}_${path.basename(inputPath)}`);
    const reparadorScript = path.join(__dirname, 'reparar-excel.js');
    execSync(`"${process.execPath}" "${reparadorScript}" "${inputPath}" "${tempFixed}"`, { stdio: 'pipe' });
    return tempFixed;
}

function leerLibroExcelSeguro(rutaReal, opciones = {}) {
    try {
        return xlsx.readFile(rutaReal, opciones);
    } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        if (
            msg.includes('Bad compressed size') ||
            msg.includes('end of central directory') ||
            msg.includes('Corrupted zip') ||
            msg.includes('bad signature') ||
            msg.includes('invalid signature')
        ) {
            console.log(`\n  ⚠️ Archivo con compresión ZIP defectuosa/no estándar (común en WhatsApp o móviles).`);
            console.log(`  🛠️ Reparando estructura del Excel automáticamente...`);
            let tempFile = null;
            try {
                tempFile = repararArchivoSync(rutaReal);
                const wb = xlsx.readFile(tempFile, opciones);
                try {
                    fs.copyFileSync(tempFile, rutaReal);
                    console.log(`  💾 Archivo original reparado y actualizado en disco.`);
                } catch (_) {
                    // Si el archivo original está en uso o protegido, continúa con el temporal cargado
                }
                return wb;
            } catch (errRepara) {
                console.log(`  ❌ No se pudo reparar automáticamente el Excel: ${errRepara.message}`);
                throw e;
            } finally {
                if (tempFile && fs.existsSync(tempFile)) {
                    try { fs.unlinkSync(tempFile); } catch (_) {}
                }
            }
        }
        throw e;
    }
}

if (require.main === module) {
    const [, , inputPath, outputPath] = process.argv;
    if (inputPath && outputPath) {
        reparar(inputPath, outputPath)
            .then(() => process.exit(0))
            .catch((err) => {
                console.error(err);
                process.exit(1);
            });
    }
} else {
    module.exports = { reparar, repararArchivoSync, leerLibroExcelSeguro };
}
