/**
 * estimar-peso-talla.js
 *
 * Lee el Reporte Nutricional (o Formato de Peso y Talla), calcula la proyección
 * de peso y talla a la FECHA DE HOY (OMS/Tendencia) y genera los archivos en el
 * formato oficial de Peso y Talla, ubicando la estimación en las columnas:
 * - Col U (21): FECHA DE LA TOMA ESTIMADA (Fecha de hoy)
 * - Col V (22): PESO ESTIMADO (Kg)
 * - Col W (23): TALLA ESTIMADA (cm)
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline-sync');
const ExcelJS = require('exceljs');
const { parsearReporteNutricional } = require('./prellenar-formatos');
const { estimarCrecimiento } = require('../servicios/estimador-crecimiento');

const c = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
  rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
  gris:     (t) => `\x1b[90m${t}\x1b[0m`,
  negrita:  (t) => `\x1b[1m${t}\x1b[0m`,
};

function limpiarNombreArchivo(nombre) {
    if (!nombre) return 'JARDIN';
    return String(nombre)
        .replace(/Ñ/g, "N")
        .replace(/ñ/g, "N")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
}

async function generarFormatoEstimadoUds(datosUds, plantillaPath, fechaHoyFormateada) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(plantillaPath);
    const worksheet = workbook.getWorksheet(1);

    // Encabezado de la planilla
    // E9 (Col 5): Nombre de la Entidad Administradora de Servicio (EAS / Asociación)
    // X9 (Col 24): Nombre de la Unidad de Servicio (UDS / Jardín)
    worksheet.getRow(9).getCell(5).value = datosUds.nombreEas;
    worksheet.getRow(9).getCell(24).value = datosUds.nombreUds;

    // Filas de Beneficiarios (desde la fila 16)
    const ninos = datosUds.ninos;
    const templateRow = worksheet.getRow(16);

    for (let i = 0; i < ninos.length; i++) {
        const nino = ninos[i];
        const rowNum = 16 + i;
        const row = worksheet.getRow(rowNum);

        // Copiar formato y bordes desde la fila 16 original
        for (let cCol = 1; cCol <= 31; cCol++) {
            const cell = row.getCell(cCol);
            const templateCell = templateRow.getCell(cCol);
            if (templateCell.style) {
                cell.style = JSON.parse(JSON.stringify(templateCell.style));
            }
        }

        row.getCell(1).value = i + 1;                  // A: No. DE ORDEN
        row.getCell(2).value = String(nino.documento); // B: NUIP
        row.getCell(3).value = String(nino.nombres);   // C: NOMBRES
        row.getCell(4).value = String(nino.apellidos); // D: APELLIDOS
        row.getCell(5).value = nino.sexo;              // E: Sexo (H / M)
        row.getCell(6).value = nino.fechaNacimiento;   // F: FECHA DE NACIMIENTO
        row.getCell(7).value = nino.fechaIngreso;      // G: FECHA DE INGRESO

        // Toma previa si existe (Cols H, I, J, K)
        row.getCell(8).value = nino.fechaToma || '';  // H: FECHA DE LA TOMA ANTERIOR
        row.getCell(9).value = nino.peso || '';       // I: PESO ANTERIOR (Kg)
        row.getCell(10).value = nino.talla || '';     // J: TALLA ANTERIOR (cm)
        row.getCell(11).value = nino.perimetro || ''; // K: PERÍMETRO ANTERIOR (cm)

        // Cols L a T en blanco (12 a 20)
        for (let cCol = 12; cCol <= 20; cCol++) {
            row.getCell(cCol).value = null;
        }

        // TOMA ESTIMADA A FECHA DE HOY (Cols U, V, W) -> Celdas U16, V16, W16...
        row.getCell(21).value = fechaHoyFormateada;                       // U: FECHA ESTIMADA (HOY)
        row.getCell(22).value = nino.pesoEstimado ? nino.pesoEstimado : null;  // V: PESO ESTIMADO (Kg)
        row.getCell(23).value = nino.tallaEstimado ? nino.tallaEstimado : null; // W: TALLA ESTIMADA (cm)

        // Cols X a AE en blanco (24 a 31)
        for (let cCol = 24; cCol <= 31; cCol++) {
            row.getCell(cCol).value = null;
        }

        row.commit();
    }

    return workbook;
}

async function main() {
    console.log(c.cyan('\n========================================================================'));
    console.log(c.negrita(' 📈 ESTIMADOR DE PESO Y TALLA A FECHA DE HOY (COLUMNAS U, V, W)'));
    console.log(c.amarillo(' (Guía de referencia para Madres Comunitarias - Proyección a Fecha Actual)'));
    console.log(c.cyan('========================================================================\n'));

    const plantillaPath = path.join(__dirname, '..', 'docs', 'formato peso y talla.xlsx');
    if (!fs.existsSync(plantillaPath)) {
        console.log(c.rojo(`❌ No se encontró la plantilla virgen en: ${plantillaPath}`));
        return;
    }

    while (true) {
        console.log(c.gris('Arrastra y suelta el Reporte Nutricional descargado de Cuéntame.\n'));

        const inputPathRaw = readline.question(c.negrita('  > Arrastra el archivo Excel aquí (o 0 para salir): '));
        const inputPath = inputPathRaw.trim().replace(/^["']|["']$/g, '');

        if (inputPath === '0') {
            console.log(c.verde('\n  👋 Volviendo al panel principal (AutoTrabajo)...\n'));
            break;
        }

        if (!inputPath || !fs.existsSync(inputPath)) {
            console.log(c.rojo('\n  ❌ El archivo especificado no existe. Inténtalo de nuevo.\n'));
            continue;
        }

        console.log(c.cyan('\n  ⏳ Analizando reporte y calculando proyección de crecimiento a la fecha de hoy...'));

        try {
            const agrupado = parsearReporteNutricional(inputPath);
            let estimacionGeneral = null;
            try {
                estimacionGeneral = estimarCrecimiento(inputPath, new Date());
            } catch (e) {}

            const mapaEstimacion = {};
            if (estimacionGeneral && estimacionGeneral.resultados) {
                estimacionGeneral.resultados.forEach(r => {
                    if (r.documento) mapaEstimacion[r.documento] = r;
                });
            }

            const fechaHoy = new Date();
            const fechaHoyFormateada = `${String(fechaHoy.getDate()).padStart(2, '0')}/${String(fechaHoy.getMonth() + 1).padStart(2, '0')}/${fechaHoy.getFullYear()}`;

            const listaUds = Object.keys(agrupado).sort();

            if (listaUds.length === 0) {
                console.log(c.rojo('  ❌ No se encontraron beneficiarios válidos en el archivo.'));
            } else {
                const easDetectada = agrupado[listaUds[0]]?.nombreEas || 'DESCONOCIDA';
                console.log(c.amarillo(`\n  📌 Asociación en el archivo: ${c.negrita(easDetectada)}`));
                console.log(c.verde(`  ✅ Se identificaron ${listaUds.length} Jardines/UDS en el reporte:\n`));

                listaUds.forEach((nombreUds, idx) => {
                    const count = agrupado[nombreUds].ninos.length;
                    console.log(`  ${c.cyan(idx + 1)}. ${nombreUds} (${c.verde(count + ' niños activos')})`);
                });

                console.log(c.cyan('\n  📋 Selecciona qué jardines deseas procesar:'));
                console.log(c.gris('  - Presiona ENTER (o 0) para procesar TODOS los jardines.'));
                console.log(c.gris('  - O escribe el número o lista de números (ej: 4,7,6 o solo 2).\n'));

                const respuestaRaw = readline.question(c.negrita('  > Ingresa tu selección [0 = Todos]: ')).trim();

                let udsAProcesar = [];
                if (!respuestaRaw || respuestaRaw === '0') {
                    udsAProcesar = listaUds;
                } else {
                    const numerosIngresados = respuestaRaw.split(/[,;\s]+/).map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
                    const indicesValidos = numerosIngresados.filter(n => n >= 1 && n <= listaUds.length);

                    if (indicesValidos.length > 0) {
                        const setIndices = Array.from(new Set(indicesValidos));
                        udsAProcesar = setIndices.map(idx => listaUds[idx - 1]);
                    } else {
                        console.log(c.amarillo('  ⚠️ No se ingresaron números válidos. Se procesarán todos los jardines.'));
                        udsAProcesar = listaUds;
                    }
                }

                console.log(c.verde(`\n  🚀 Generando formatos con Estimado de Peso y Talla (Cols U, V, W)...`));

                const dirDocs = path.join(__dirname, '..', 'docs', 'peso y talla');
                const dirReportes = path.join(__dirname, '..', 'reportes');

                if (!fs.existsSync(dirDocs)) fs.mkdirSync(dirDocs, { recursive: true });
                if (!fs.existsSync(dirReportes)) fs.mkdirSync(dirReportes, { recursive: true });

                const fechaHoyIso = fechaHoy.toISOString().split('T')[0];
                const TAMANO_PARTE = 13;

                for (let i = 0; i < udsAProcesar.length; i++) {
                    const nombreUds = udsAProcesar[i];
                    const datosUds = agrupado[nombreUds];
                    const todosNinos = datosUds.ninos;

                    // Enriquecer cada niño con pesoEstimado y tallaEstimado a la fecha de hoy
                    todosNinos.forEach(n => {
                        const est = mapaEstimacion[n.documento];
                        if (est && est.pesoEstimado && est.tallaEstimado) {
                            n.pesoEstimado = est.pesoEstimado;
                            n.tallaEstimado = est.tallaEstimado;
                        } else {
                            const pesoNum = parseFloat(n.peso);
                            const tallaNum = parseFloat(n.talla);

                            if (!isNaN(pesoNum) && !isNaN(tallaNum) && n.fechaToma) {
                                const parts = n.fechaToma.split('/');
                                if (parts.length === 3) {
                                    const fechaTomaDate = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
                                    const dias = Math.max(0, (fechaHoy.getTime() - fechaTomaDate.getTime()) / 86400000);
                                    n.pesoEstimado = Math.round((pesoNum + (dias * 0.0065)) * 10) / 10;
                                    n.tallaEstimado = Math.round((tallaNum + (dias * 0.022)) * 10) / 10;
                                }
                            }

                            if (!n.pesoEstimado && !isNaN(pesoNum)) n.pesoEstimado = pesoNum;
                            if (!n.tallaEstimado && !isNaN(tallaNum)) n.tallaEstimado = tallaNum;
                        }
                    });

                    const partesNinos = [];
                    for (let k = 0; k < todosNinos.length; k += TAMANO_PARTE) {
                        partesNinos.push(todosNinos.slice(k, k + TAMANO_PARTE));
                    }

                    const totalPartes = partesNinos.length;
                    const descPartes = totalPartes > 1 ? ` -> ${totalPartes} archivos de máx 13 niños` : '';
                    console.log(`  ${i + 1}/${udsAProcesar.length}. ${c.cyan(nombreUds)} (${c.verde(todosNinos.length + ' niños')}${descPartes})`);

                    for (let p = 0; p < totalPartes; p++) {
                        const ninosChunk = partesNinos[p];
                        const numParte = p + 1;
                        const nombreUdsHeader = nombreUds;

                        const datosSubUds = {
                            nombreEas: datosUds.nombreEas,
                            nombreUds: nombreUdsHeader,
                            ninos: ninosChunk
                        };

                        const wbPrellenado = await generarFormatoEstimadoUds(datosSubUds, plantillaPath, fechaHoyFormateada);
                        const nombreClean = limpiarNombreArchivo(nombreUds);
                        const sufijoParte = totalPartes > 1 ? `_Parte${numParte}` : '';
                        const fileBaseName = `Formato_Peso_Talla_${nombreClean}${sufijoParte}_ESTIMADO_${fechaHoyIso}.xlsx`;

                        const pathDocs = path.join(dirDocs, fileBaseName);
                        const pathReportes = path.join(dirReportes, fileBaseName);

                        await wbPrellenado.xlsx.writeFile(pathDocs);
                        await wbPrellenado.xlsx.writeFile(pathReportes);

                        console.log(c.gris(`     -> Guardado (Estimación en Cols U, V, W): docs/peso y talla/${fileBaseName}`));
                    }
                }

                console.log(c.verde('\n  🎉 ¡Formatos con Estimación de Peso y Talla (a hoy) generados exitosamente!'));
            }
        } catch (err) {
            console.log(c.rojo(`\n  ❌ Error procesando el archivo: ${err.message}`));
        }

        console.log(c.cyan('\n======================================================'));
        const respFinal = readline.question(c.negrita('  > ¿Deseas procesar otro archivo Excel? (s = Si, n = Volver al panel principal) [por defecto n]: '));
        if (respFinal.toLowerCase().trim() !== 's') {
            console.log(c.verde('\n  👋 Volviendo al panel principal (AutoTrabajo)...\n'));
            break;
        }
        console.log('\n');
    }
}

if (require.main === module) {
    main().finally(() => process.exit(0));
}

module.exports = { main };
