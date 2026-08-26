/**
 * servicios/bd-beneficiarios.js
 * Servicio para consolidar reportes de beneficiarios descargados de Cuentame 
 * en una Base de Datos Master (Excel + JSON) y ofrecer pre-consultas ultrarrapidas.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const RUTA_REPORTES = path.join(__dirname, '..', 'reportes');
const RUTA_BASE_DATOS_DIR = path.join(__dirname, '..', 'docs', 'database');
const RUTA_MASTER_EXCEL = path.join(RUTA_BASE_DATOS_DIR, 'BD_MASTER_BENEFICIARIOS.xlsx');
const RUTA_MASTER_JSON = path.join(RUTA_BASE_DATOS_DIR, 'BD_MASTER_BENEFICIARIOS.json');

const removeAccents = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const cleanAscii = removeAccents;

/**
 * Mapea el nombre del archivo o el nombre largo al nombre corto de la asociacion
 */
function normalizarNombreAsociacion(nombreOriginal, nombreArchivo) {
    const txt = (nombreOriginal || nombreArchivo || '').toUpperCase();
    if (txt.includes('BARRIOS') || txt.includes('BARRIOS_UNIDOS')) return 'BARRIOS UNIDOS';
    if (txt.includes('BRISAS')) return 'BRISAS DE BUENAVISTA';
    if (txt.includes('BUENAVISTA')) return 'BUENAVISTA';
    if (txt.includes('CANAIMA')) return 'CANAIMA';
    if (txt.includes('DELICIAS') || txt.includes('DELICIAS_DEL_CARMEN')) return 'DELICIAS DEL CARMEN';
    if (txt.includes('PROGRESO') || txt.includes('PROGRESO_INFANTIL')) return 'PROGRESO INFANTIL';
    if (txt.includes('VERBENAL')) return 'VERBENAL Y REFUGIO';
    return nombreOriginal || nombreArchivo;
}

/**
 * Escanea la carpeta reportes/ y consolida todos los Beneficiarios_*.xlsx en docs/database/
 */
function consolidarBaseDatos() {
    console.log('\n  📊 Consolidando Base de Datos Master de Beneficiarios...');

    if (!fs.existsSync(RUTA_BASE_DATOS_DIR)) {
        fs.mkdirSync(RUTA_BASE_DATOS_DIR, { recursive: true });
    }

    // Limpiar archivos legacy de la carpeta reportes si existen
    const legacyExcel = path.join(RUTA_REPORTES, 'BD_MASTER_BENEFICIARIOS.xlsx');
    const legacyJson = path.join(RUTA_REPORTES, 'BD_MASTER_BENEFICIARIOS.json');
    if (fs.existsSync(legacyExcel)) fs.unlinkSync(legacyExcel);
    if (fs.existsSync(legacyJson)) fs.unlinkSync(legacyJson);

    const archivos = fs.readdirSync(RUTA_REPORTES).filter(f => 
        f.startsWith('Beneficiarios_') && f.endsWith('.xlsx') && !f.includes('BD_MASTER')
    );

    if (archivos.length === 0) {
        console.log('  ⚠️ No se encontraron archivos Beneficiarios_*.xlsx en la carpeta reportes.');
        return [];
    }

    let todosLosBeneficiarios = [];

    for (const archivo of archivos) {
        const filePath = path.join(RUTA_REPORTES, archivo);
        try {
            const wb = XLSX.readFile(filePath);
            const sheetName = wb.SheetNames[0];
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });

            for (const r of rows) {
                const entidadContratista = r['Nombre de la Entidad Contratista'] || '';
                const asociacionNorm = normalizarNombreAsociacion(entidadContratista, archivo);

                const pNombre = cleanAscii(String(r['Primer Nombre del beneficiario'] || ''));
                const sNombre = cleanAscii(String(r['Segundo Nombre del beneficiario'] || ''));
                const pApell = cleanAscii(String(r['Primer apellido del beneficiario'] || ''));
                const sApell = cleanAscii(String(r['Segundo apellido del beneficiario'] || ''));
                const nombreCompleto = [pNombre, sNombre, pApell, sApell].filter(Boolean).join(' ');

                const pNombreResp = cleanAscii(String(r['Primer nombre del acudiente o responsable'] || ''));
                const sNombreResp = cleanAscii(String(r['Segundo nombre del acudiente o responsable'] || ''));
                const pApellResp = cleanAscii(String(r['Primer apellido del acudiente o responsable'] || ''));
                const sApellResp = cleanAscii(String(r['Segundo apellido del acudiente o responsable'] || ''));
                const nombreCompletoResp = [pNombreResp, sNombreResp, pApellResp, sApellResp].filter(Boolean).join(' ');

                const reg = {
                    asociacion: asociacionNorm,
                    entidadContratista: cleanAscii(String(entidadContratista || '')),
                    numeroContrato: String(r['Número del Contrato'] || '').trim(),
                    codigoUds: String(r['Código de la unidad de servicio'] || '').trim(),
                    nombreUds: cleanAscii(String(r['Nombre de la unidad de servicio'] || '')),
                    modalidad: cleanAscii(String(r['Modalidad'] || '')),
                    tipoBeneficiario: cleanAscii(String(r['Nombre Tipo de beneficiario'] || '')),
                    tipoDoc: String(r['Tipo de documento del beneficiario'] || '').trim(),
                    documento: String(r['Documento del beneficiario'] || '').trim(),
                    pNombre: pNombre,
                    sNombre: sNombre,
                    pApell: pApell,
                    sApell: sApell,
                    nombreCompleto: nombreCompleto,
                    fechaNacimiento: String(r['Fecha de nacimiento del beneficiario'] || '').trim(),
                    edad: r['Edad del beneficiario'] || '',
                    sexo: String(r['Sexo del beneficiario'] || '').trim(),
                    direccion: cleanAscii(String(r['Direccion de residencia del beneficiario'] || '')),
                    telefono: String(r['Teléfono del beneficiario'] || '').trim(),
                    tipoResponsable: cleanAscii(String(r['Tipo de responsable'] || '')),
                    tipoDocResp: String(r['Tipo de documento del acudiente o responsable'] || '').trim(),
                    documentoResp: String(r['Número de documento del acudiente o responsable'] || '').trim(),
                    nombreResp: nombreCompletoResp,
                    fechaAtencionUds: String(r['Fecha de atención del beneficiario a la UDS'] || '').trim(),
                    fechaVinculacion: String(r['Fecha de vinculación del beneficiario'] || '').trim()
                };

                if (reg.documento && reg.nombreUds) {
                    todosLosBeneficiarios.push(reg);
                }
            }
            console.log(`    ✅ Procesado "${archivo}": ${rows.length} registros.`);
        } catch (e) {
            console.log(`    ❌ Error al leer "${archivo}": ${e.message}`);
        }
    }

    // 1. Guardar archivo JSON para pre-consultas super rapidas
    fs.writeFileSync(RUTA_MASTER_JSON, JSON.stringify(todosLosBeneficiarios, null, 2), 'utf-8');
    console.log(`  💾 Guardado archivo JSON master: ${RUTA_MASTER_JSON} (${todosLosBeneficiarios.length} beneficiarios).`);

    // 2. Guardar Excel Master estructurado
    try {
        const ws = XLSX.utils.json_to_sheet(todosLosBeneficiarios);
        const wbMaster = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wbMaster, ws, 'BD_MASTER_BENEFICIARIOS');
        XLSX.writeFile(wbMaster, RUTA_MASTER_EXCEL);
        console.log(`  📗 Guardado Excel Master: ${RUTA_MASTER_EXCEL}`);
    } catch(errExcel) {
        console.log(`  ⚠️ No se pudo guardar Excel Master: ${errExcel.message}`);
    }

    return todosLosBeneficiarios;
}

/**
 * Carga la base de datos master en memoria
 */
function cargarBaseDatos() {
    if (fs.existsSync(RUTA_MASTER_JSON)) {
        try {
            const data = fs.readFileSync(RUTA_MASTER_JSON, 'utf-8');
            return JSON.parse(data);
        } catch (e) {}
    }
    return consolidarBaseDatos();
}

/**
 * Retorna las UDS / Jardines de una asociacion dada
 */
function obtenerJardinesDeAsociacion(nombreAsoc) {
    const bd = cargarBaseDatos();
    const asocNorm = removeAccents(nombreAsoc).toUpperCase();
    const jardinesMap = new Map();

    for (const b of bd) {
        const bAsocNorm = removeAccents(b.asociacion).toUpperCase();
        if (bAsocNorm.includes(asocNorm) || asocNorm.includes(bAsocNorm)) {
            if (!jardinesMap.has(b.nombreUds)) {
                jardinesMap.set(b.nombreUds, {
                    nombreUds: b.nombreUds,
                    codigoUds: b.codigoUds,
                    modalidad: b.modalidad,
                    totalNinos: 0
                });
            }
            jardinesMap.get(b.nombreUds).totalNinos++;
        }
    }

    return Array.from(jardinesMap.values()).sort((a, b) => a.nombreUds.localeCompare(b.nombreUds));
}

/**
 * Retorna todos los ninos de un jardin especifico
 */
function obtenerNinosDeJardin(nombreAsoc, nombreUds) {
    const bd = cargarBaseDatos();
    const asocNorm = removeAccents(nombreAsoc || '').toUpperCase();
    const udsNorm = removeAccents(nombreUds || '').toUpperCase();

    return bd.filter(b => {
        const bAsocNorm = removeAccents(b.asociacion).toUpperCase();
        const bUdsNorm = removeAccents(b.nombreUds).toUpperCase();
        const coincideAsoc = !asocNorm || bAsocNorm.includes(asocNorm) || asocNorm.includes(bAsocNorm);
        const coincideUds = bUdsNorm.includes(udsNorm) || udsNorm.includes(bUdsNorm);
        return coincideAsoc && coincideUds;
    }).sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto));
}

/**
 * Busca beneficiario por numero de documento
 */
function buscarPorDocumento(documento) {
    const bd = cargarBaseDatos();
    const docClean = String(documento).trim();
    return bd.find(b => String(b.documento).trim() === docClean) || null;
}

/**
 * Busca beneficiarios por nombre o apellido
 */
function buscarPorNombre(query) {
    const bd = cargarBaseDatos();
    const qClean = removeAccents(String(query)).toUpperCase();
    return bd.filter(b => removeAccents(b.nombreCompleto).toUpperCase().includes(qClean));
}

module.exports = {
    consolidarBaseDatos,
    cargarBaseDatos,
    obtenerJardinesDeAsociacion,
    obtenerNinosDeJardin,
    buscarPorDocumento,
    buscarPorNombre
};
