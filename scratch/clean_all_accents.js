const fs = require('fs');
const path = require('path');

function removeAccents(str) {
    return str
        .replace(/á/g, 'a').replace(/Á/g, 'A')
        .replace(/é/g, 'e').replace(/É/g, 'E')
        .replace(/í/g, 'i').replace(/Í/g, 'I')
        .replace(/ó/g, 'o').replace(/Ó/g, 'O')
        .replace(/ú/g, 'u').replace(/Ú/g, 'U')
        .replace(/ñ/g, 'n').replace(/Ñ/g, 'N')
        .replace(/¿/g, '')
        .replace(/¡/g, '');
}

const filesToClean = [
    'autotrabajo.js',
    'automatizaciones/peso-talla.js',
    'automatizaciones/prellenar-formatos.js',
    'automatizaciones/estimar-peso-talla.js',
    'automatizaciones/comparar-nutricion.js',
    'automatizaciones/convertir-peso-talla.js',
    'automatizaciones/consulta-activos.js',
    'automatizaciones/descargar-reportes.js',
    'automatizaciones/llenar-asistencia.js',
    'automatizaciones/formacion-familias.js',
    'automatizaciones/generar-cuentas-cobro.js',
    'automatizaciones/vinculacion-beneficiarios.js',
    'automatizaciones/desvinculacion-beneficiarios.js',
    'automatizaciones/generar-ticket-errores.js',
    'servicios/autenticacion.js',
    'servicios/excel-reader.js',
    'servicios/excel-parser.js',
    'servicios/nutricion.js',
    'servicios/conversor-peso-talla.js',
    'servicios/estimador-crecimiento.js',
    'servicios/lupa-unidad.js',
    'servicios/verificador-docs.js'
];

filesToClean.forEach(filePath => {
    const fullPath = path.join(__dirname, '..', filePath);
    if (fs.existsSync(fullPath)) {
        let content = fs.readFileSync(fullPath, 'utf8');
        // Replace accented characters inside string literals and console outputs
        const cleaned = content.replace(/(console\.log|readline\.question|c\.\w+)\s*\(([\s\S]*?)\)/g, (match, fn, args) => {
            return `${fn}(${removeAccents(args)})`;
        });
        
        // Also clean comments and template strings
        let finalContent = removeAccents(cleaned);
        
        if (content !== finalContent) {
            fs.writeFileSync(fullPath, finalContent, 'utf8');
            console.log(`Cleaned: ${filePath}`);
        }
    }
});
