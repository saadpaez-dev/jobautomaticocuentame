/**
 * admin-manager.js
 * Módulo central de gestión de administración, control de tareas,
 * habilitación/deshabilitación de asociaciones y madres comunitarias,
 * y edición de contraseñas y números de cédula.
 */

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'admin_config.json');
const EXCEL_PATH = path.join(__dirname, '..', 'GENERAL_BOTS.xlsx');

// Ruta secundaria para sincronizar con jobautomatico
const JOB_DATA_DIR = path.join(__dirname, '..', '..', 'jobautomatico', 'data');
const JOB_CONFIG_PATH = path.join(JOB_DATA_DIR, 'admin_config.json');

const DEFAULT_CONFIG = {
    admin: {
        usuario: process.env.ADMIN_USER || 'admin',
        password: process.env.ADMIN_PASSWORD || 'admin2026*',
        nombre: process.env.ADMIN_NOMBRE || 'Administrador Cuéntame',
        correo: process.env.GMAIL_USER || 'digitadorcuentameicbf@gmail.com'
    },
    sistema: {
        mantenimientoGlobal: false,
        mensajeMantenimiento: 'El portal se encuentra en mantenimiento programado. Por favor intenta más tarde.',
        tareasPausadas: {
            asistenciaRam: false,
            descargaReportes: false,
            pantallazos: false,
            consultas: false,
            desvinculaciones: false
        },
        mensajesTareas: {
            asistenciaRam: 'El reporte de asistencia RAM se encuentra temporalmente en pausa por actualización del sistema.',
            descargaReportes: 'La descarga y envío de reportes se encuentra temporalmente en pausa.',
            pantallazos: 'La consulta de pantallazos se encuentra temporalmente en pausa.',
            consultas: 'La consulta de beneficiarios se encuentra temporalmente en pausa.',
            desvinculaciones: 'El módulo de desvinculaciones se encuentra temporalmente en pausa.'
        }
    },
    asociaciones: {
        'DELICIAS DEL CARMEN': { habilitada: true, motivo: '' },
        'BRISAS DE BUENAVISTA': { habilitada: true, motivo: '' },
        'VERBENAL Y REFUGIO': { habilitada: true, motivo: '' },
        'BARRIOS UNIDOS': { habilitada: true, motivo: '' },
        'BUENAVISTA': { habilitada: true, motivo: '' },
        'CANAIMA': { habilitada: true, motivo: '' },
        'PROGRESO INFANTIL': { habilitada: true, motivo: '' }
    },
    madres: {}
};

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        try { fs.mkdirSync(dirPath, { recursive: true }); } catch (e) {}
    }
}

function getAdminConfig() {
    ensureDir(DATA_DIR);
    if (!fs.existsSync(CONFIG_PATH)) {
        saveAdminConfig(DEFAULT_CONFIG);
        return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        // Garantizar propiedades por defecto
        return {
            ...DEFAULT_CONFIG,
            ...parsed,
            admin: { ...DEFAULT_CONFIG.admin, ...(parsed.admin || {}) },
            sistema: {
                ...DEFAULT_CONFIG.sistema,
                ...(parsed.sistema || {}),
                tareasPausadas: {
                    ...DEFAULT_CONFIG.sistema.tareasPausadas,
                    ...((parsed.sistema && parsed.sistema.tareasPausadas) || {})
                },
                mensajesTareas: {
                    ...DEFAULT_CONFIG.sistema.mensajesTareas,
                    ...((parsed.sistema && parsed.sistema.mensajesTareas) || {})
                }
            },
            asociaciones: {
                ...DEFAULT_CONFIG.asociaciones,
                ...(parsed.asociaciones || {})
            },
            madres: parsed.madres || {}
        };
    } catch (e) {
        console.error('Error leyendo admin_config.json:', e);
        return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
}

function saveAdminConfig(config) {
    ensureDir(DATA_DIR);
    const jsonStr = JSON.stringify(config, null, 2);
    fs.writeFileSync(CONFIG_PATH, jsonStr, 'utf8');

    // Sincronizar con jobautomatico
    try {
        ensureDir(JOB_DATA_DIR);
        fs.writeFileSync(JOB_CONFIG_PATH, jsonStr, 'utf8');
    } catch (e) {}
}

/**
 * Lee la lista completa de madres del Excel y aplica los overrides
 */
function getAllMothers() {
    const config = getAdminConfig();
    let rowsExcel = [];

    if (fs.existsSync(EXCEL_PATH)) {
        try {
            const wb = xlsx.readFile(EXCEL_PATH);
            const sheet = wb.Sheets['Jardines'];
            if (sheet) {
                rowsExcel = xlsx.utils.sheet_to_json(sheet);
            }
        } catch (e) {
            console.error('Error leyendo Excel en getAllMothers:', e);
        }
    }

    const mapExcel = new Map();
    rowsExcel.forEach((row, idx) => {
        const cedulaOrig = String(row.Cedula || `TEMP_${idx}`).trim();
        mapExcel.set(cedulaOrig, {
            id: cedulaOrig,
            idOriginal: cedulaOrig,
            cedulaOriginal: cedulaOrig,
            cedula: cedulaOrig,
            nombre: (row['Madre Comunitaria'] || '').trim(),
            jardin: (row['Nombre UDS'] || '').trim(),
            codigo: String(row['Codigo Cuentame'] || '').trim(),
            asociacion: (row['Asociacion'] || '').trim(),
            habilitada: true,
            tienePasswordCustom: false,
            passwordCustom: null,
            cedulaModificada: false,
            motivoBloqueo: ''
        });
    });

    // Aplicar overrides configurados por el administrador
    const overrides = config.madres || {};
    for (const [keyId, override] of Object.entries(overrides)) {
        if (mapExcel.has(keyId)) {
            const current = mapExcel.get(keyId);
            mapExcel.set(keyId, {
                ...current,
                idOriginal: keyId,
                cedula: override.cedula || current.cedula,
                nombre: override.nombre || current.nombre,
                jardin: override.jardin || current.jardin,
                codigo: override.codigo || current.codigo,
                asociacion: override.asociacion || current.asociacion,
                habilitada: override.habilitada !== false,
                tienePasswordCustom: Boolean(override.passwordCustom),
                passwordCustom: override.passwordCustom || null,
                cedulaModificada: Boolean(override.cedula && override.cedula !== current.cedulaOriginal),
                motivoBloqueo: override.motivoBloqueo || ''
            });
        } else {
            // Usuario nuevo creado directamente por el administrador
            mapExcel.set(keyId, {
                id: keyId,
                idOriginal: keyId,
                cedulaOriginal: keyId,
                cedula: override.cedula || keyId,
                nombre: override.nombre || 'Madre Comunitaria',
                jardin: override.jardin || 'UDS Comunitaria',
                codigo: override.codigo || '',
                asociacion: override.asociacion || 'GENERAL',
                habilitada: override.habilitada !== false,
                tienePasswordCustom: Boolean(override.passwordCustom),
                passwordCustom: override.passwordCustom || null,
                cedulaModificada: Boolean(override.cedula && override.cedula !== keyId),
                motivoBloqueo: override.motivoBloqueo || ''
            });
        }
    }

    // Agregar estado de la asociación a cada madre
    const result = Array.from(mapExcel.values()).map(m => {
        const asocData = config.asociaciones[m.asociacion];
        const asocHabilitada = asocData ? (asocData.habilitada !== false) : true;
        return {
            ...m,
            asociacionHabilitada: asocHabilitada
        };
    });

    return result.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/**
 * Valida credenciales de login (Admin vs Madre Comunitaria)
 */
function validateLogin(cedulaInput, passwordInput) {
    const config = getAdminConfig();
    const cedTrim = String(cedulaInput || '').trim();
    const passTrim = String(passwordInput || '').trim();

    // 1. Validar si es Administrador
    const adminUser = String(config.admin.usuario || 'admin').trim().toLowerCase();
    const inputLower = cedTrim.toLowerCase();
    const esAdmin = (inputLower === adminUser || inputLower === 'admin' || cedTrim === '99999999') 
        && passTrim === String(config.admin.password || 'admin2026*');

    if (esAdmin) {
        return {
            success: true,
            role: 'ADMIN',
            user: {
                nombre: config.admin.nombre || 'Administrador Cuéntame',
                usuario: config.admin.usuario || 'admin',
                role: 'ADMIN'
            }
        };
    }

    // 2. Si no es admin, verificar modo de mantenimiento global del sistema
    if (config.sistema.mantenimientoGlobal) {
        return {
            success: false,
            message: config.sistema.mensajeMantenimiento || 'El portal se encuentra en mantenimiento programado. Por favor intenta más tarde.'
        };
    }

    // 3. Buscar a la madre comunitaria (por cédula actual o por cédula original)
    const todasMadres = getAllMothers();
    const madre = todasMadres.find(m => String(m.cedula) === cedTrim || String(m.cedulaOriginal) === cedTrim);

    if (!madre) {
        return {
            success: false,
            message: 'Cédula no encontrada en el sistema. Si eres madre nueva o requieres actualizar tu documento, contacta al administrador.'
        };
    }

    // 4. Verificar si la asociación está inhabilitada
    if (!madre.asociacionHabilitada) {
        const asocInfo = config.asociaciones[madre.asociacion];
        const motivoTxt = asocInfo && asocInfo.motivo ? ` Motivo: ${asocInfo.motivo}` : '';
        return {
            success: false,
            message: `El acceso para la asociación "${madre.asociacion}" está temporalmente inhabilitado en el portal.${motivoTxt}`
        };
    }

    // 5. Verificar si la madre individual está inhabilitada
    if (!madre.habilitada) {
        return {
            success: false,
            message: madre.motivoBloqueo || 'Tu usuario se encuentra inhabilitado por administración. Comunícate con el soporte.'
        };
    }

    // 6. Validar contraseña
    let passwordValida = false;
    if (madre.tienePasswordCustom && madre.passwordCustom) {
        passwordValida = (passTrim === madre.passwordCustom);
    } else {
        // Regla por defecto: últimos 4 dígitos de la cédula activa
        const strCedula = String(madre.cedula);
        const expected = strCedula.substring(strCedula.length - 4);
        passwordValida = (passTrim === expected);
    }

    if (!passwordValida) {
        return {
            success: false,
            message: 'Contraseña incorrecta. Si tienes problemas para ingresar, solicita el restablecimiento al administrador.'
        };
    }

    // 7. Login exitoso de la madre
    return {
        success: true,
        role: 'MADRE',
        user: {
            nombre: madre.nombre,
            jardin: madre.jardin,
            codigo: madre.codigo,
            asociacion: madre.asociacion,
            cedula: madre.cedula,
            cedulaOriginal: madre.cedulaOriginal,
            role: 'MADRE'
        },
        tareasPausadas: config.sistema.tareasPausadas || {},
        mensajesTareas: config.sistema.mensajesTareas || {}
    };
}

/**
 * Actualiza los datos de una madre (cédula, nombre, jardín, contraseña, estado)
 */
function updateMother(idOriginal, data) {
    if (!idOriginal || idOriginal === 'undefined') {
        return { success: false, message: 'ID original requerido.' };
    }
    const config = getAdminConfig();
    const current = config.madres[idOriginal] || {};

    const updated = {
        ...current,
        cedula: (data.cedula !== undefined) ? String(data.cedula).trim() : (current.cedula || idOriginal),
        nombre: (data.nombre !== undefined) ? String(data.nombre).trim() : current.nombre,
        jardin: (data.jardin !== undefined) ? String(data.jardin).trim() : current.jardin,
        codigo: (data.codigo !== undefined) ? String(data.codigo).trim() : current.codigo,
        asociacion: (data.asociacion !== undefined) ? String(data.asociacion).trim() : current.asociacion,
        habilitada: (data.habilitada !== undefined) ? Boolean(data.habilitada) : (current.habilitada !== false),
        motivoBloqueo: (data.motivoBloqueo !== undefined) ? String(data.motivoBloqueo).trim() : (current.motivoBloqueo || '')
    };

    if (data.passwordCustom !== undefined) {
        if (data.passwordCustom === null || data.passwordCustom === '') {
            delete updated.passwordCustom;
        } else {
            updated.passwordCustom = String(data.passwordCustom).trim();
        }
    }

    config.madres[idOriginal] = updated;
    saveAdminConfig(config);

    return { success: true, madre: updated };
}

/**
 * Restablece la contraseña de una madre a los últimos 4 dígitos
 */
function resetMotherPassword(idOriginal) {
    const config = getAdminConfig();
    if (config.madres[idOriginal]) {
        delete config.madres[idOriginal].passwordCustom;
        saveAdminConfig(config);
    }
    return { success: true, message: 'Contraseña restablecida por defecto (últimos 4 dígitos de la cédula).' };
}

/**
 * Alterna el estado de una asociación (habilitar/deshabilitar)
 */
function toggleAssociation(asociacionName, habilitada, motivo = '') {
    const config = getAdminConfig();
    config.asociaciones[asociacionName] = {
        habilitada: Boolean(habilitada),
        motivo: String(motivo || '').trim()
    };
    saveAdminConfig(config);
    return { success: true, asociacion: asociacionName, habilitada, motivo };
}

/**
 * Actualiza el control del sistema (mantenimiento y tareas pausadas)
 */
function updateSystemConfig(sistemaUpdates) {
    const config = getAdminConfig();
    config.sistema = {
        ...config.sistema,
        ...sistemaUpdates,
        tareasPausadas: {
            ...config.sistema.tareasPausadas,
            ...(sistemaUpdates.tareasPausadas || {})
        },
        mensajesTareas: {
            ...config.sistema.mensajesTareas,
            ...(sistemaUpdates.mensajesTareas || {})
        }
    };
    saveAdminConfig(config);
    return { success: true, sistema: config.sistema };
}

/**
 * Cambia la contraseña del administrador
 */
function updateAdminPassword(passwordActual, nuevoPassword) {
    const config = getAdminConfig();
    if (String(passwordActual).trim() !== String(config.admin.password).trim()) {
        return { success: false, message: 'La contraseña actual no es correcta.' };
    }
    if (!nuevoPassword || String(nuevoPassword).trim().length < 4) {
        return { success: false, message: 'La nueva contraseña debe tener al menos 4 caracteres.' };
    }
    config.admin.password = String(nuevoPassword).trim();
    saveAdminConfig(config);
    return { success: true, message: 'Contraseña del administrador actualizada con éxito.' };
}

module.exports = {
    getAdminConfig,
    saveAdminConfig,
    getAllMothers,
    validateLogin,
    updateMother,
    resetMotherPassword,
    toggleAssociation,
    updateSystemConfig,
    updateAdminPassword
};
