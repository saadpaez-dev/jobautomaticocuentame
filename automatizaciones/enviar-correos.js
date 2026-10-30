require('dotenv').config();
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const readline = require('readline-sync');
const ExcelJS = require('exceljs');

const c = {
    verde: (t) => `\x1b[32m${t}\x1b[0m`,
    amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
    cyan: (t) => `\x1b[36m${t}\x1b[0m`,
    rojo: (t) => `\x1b[31m${t}\x1b[0m`,
    gris: (t) => `\x1b[90m${t}\x1b[0m`,
    negrita: (t) => `\x1b[1m${t}\x1b[0m`,
};

function normalizarTexto(txt) {
    if (!txt) return '';
    return txt.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}

async function obtenerCorreos() {
    const correos = {};
    const wb = new ExcelJS.Workbook();
    try {
        console.log(c.gris('   (Leyendo GENERAL.xlsx para obtener correos estandarizados...)'));
        await wb.xlsx.readFile('G:\\Mi unidad\\CUENTAME\\0 GENERAL\\GENERAL.xlsx');
        const ws = wb.getWorksheet('contabilidad');
        const headers = ws.getRow(1).values;
        const colEas = headers.indexOf('EAS');
        const colCorreo = headers.indexOf('CORREO');
        
        for (let i = 2; i <= ws.rowCount; i++) {
            const row = ws.getRow(i);
            const eas = row.getCell(colEas).text;
            const correo = row.getCell(colCorreo).text;
            if (eas && correo) {
                correos[normalizarTexto(eas)] = correo.trim();
            }
        }
    } catch (e) {
        console.log(c.amarillo("   (No se pudo leer GENERAL.xlsx en la ruta de red. Se solicitarán manualmente)"));
    }
    return correos;
}

async function main() {
    console.log(c.cyan('\n======================================================'));
    console.log(c.cyan('   📧 ENVIADOR DE CORREOS DE NUTRICIÓN (CON ADJUNTOS)'));
    console.log(c.cyan('======================================================\n'));

    const GMAIL_USER = process.env.GMAIL_USER;
    const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
        console.log(c.rojo('❌ Faltan credenciales de Gmail (GMAIL_USER y GMAIL_APP_PASSWORD) en tu archivo .env'));
        readline.question('\nPresiona ENTER para volver al menu principal...');
        return;
    }

    const pantallazosDir = path.join(__dirname, '..', 'pantallazos_nutricion');
    if (!fs.existsSync(pantallazosDir)) {
        console.log(c.rojo('❌ No se encontró la carpeta pantallazos_nutricion.'));
        readline.question('\nPresiona ENTER para volver al menu principal...');
        return;
    }

    const asociaciones = fs.readdirSync(pantallazosDir).filter(f => fs.statSync(path.join(pantallazosDir, f)).isDirectory());

    if (asociaciones.length === 0) {
        console.log(c.amarillo('⚠️ No hay carpetas de asociaciones en pantallazos_nutricion.'));
        readline.question('\nPresiona ENTER para volver al menu principal...');
        return;
    }

    console.log(c.cyan('\nSelecciona la asociación a procesar:'));
    console.log(`  0. Procesar TODAS (Una por una)`);
    asociaciones.forEach((asoc, idx) => {
        console.log(`  ${idx + 1}. ${asoc}`);
    });
    
    const seleccion = readline.question(c.negrita('\n> Ingresa el numero de tu opcion: '));
    const seleccionInt = parseInt(seleccion.trim(), 10);
    
    let asociacionesAProcesar = [];
    if (seleccionInt === 0) {
        asociacionesAProcesar = asociaciones;
    } else if (seleccionInt > 0 && seleccionInt <= asociaciones.length) {
        asociacionesAProcesar = [asociaciones[seleccionInt - 1]];
    } else {
        console.log(c.rojo('❌ Opción inválida.'));
        readline.question('\nPresiona ENTER para volver al menu principal...');
        return;
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: GMAIL_USER,
            pass: GMAIL_APP_PASSWORD
        }
    });

    const diccionarioCorreos = await obtenerCorreos();

    for (const asociacion of asociacionesAProcesar) {
        const asocPath = path.join(pantallazosDir, asociacion);
        const archivos = fs.readdirSync(asocPath).filter(f => f.endsWith('.png'));

        if (archivos.length === 0) continue;

        console.log(c.verde(`\n📁 Asociación: ${c.negrita(asociacion)}`));
        console.log(c.gris(`   Se encontraron ${archivos.length} pantallazos.`));

        // Intentar encontrar el correo en el diccionario
        let correoSugerido = '';
        const asocNorm = normalizarTexto(asociacion.replace(/_/g, ' '));
        
        // Ordenar las llaves por longitud para evitar colisiones (ej. BRISAS DE BUENAVISTA vs BUENAVISTA)
        const entriesOrdenadas = Object.entries(diccionarioCorreos).sort((a, b) => b[0].length - a[0].length);

        for (const [easLargo, correo] of entriesOrdenadas) {
            // Reemplazos comunes para mejorar la coincidencia
            let easComparar = easLargo.replace(/BARRIO /g, 'BARRIOS ').replace(/ DE /g, ' ');
            let asocComparar = asocNorm.replace(/BARRIO /g, 'BARRIOS ').replace(/ DE /g, ' ');
            
            if (easComparar.includes(asocComparar) || asocComparar.includes(easComparar)) {
                correoSugerido = correo;
                break;
            }
            
            // Segunda oportunidad: palabras clave
            const palabrasAsoc = asocNorm.split(' ').filter(w => w.length > 4 && w !== 'BARRIOS' && w !== 'BARRIO');
            if (palabrasAsoc.length > 0 && palabrasAsoc.every(w => easLargo.includes(w))) {
                correoSugerido = correo;
                break;
            }
        }

        let destino = '';
        if (correoSugerido) {
            console.log(c.cyan(`   ✉️  Correo sugerido desde Excel: ${c.negrita(correoSugerido)}`));
            const confirmar = readline.question(c.cyan('   > Presiona ENTER para usarlo o escribe otro correo (deja "n" para omitir): '));
            if (confirmar.trim().toLowerCase() === 'n') {
                destino = '';
            } else if (confirmar.trim() !== '') {
                destino = confirmar.trim();
            } else {
                destino = correoSugerido;
            }
        } else {
            destino = readline.question(c.cyan('   > Ingresa el correo electrónico (o deja en blanco para omitir): '));
        }

        if (!destino || destino.trim() === '') {
            console.log(c.amarillo('   ⏭️ Omitiendo envío para esta asociación.'));
            continue;
        }

        const adjuntos = archivos.map(archivo => ({
            filename: archivo,
            path: path.join(asocPath, archivo)
        }));

        const mailOptions = {
            from: GMAIL_USER,
            to: destino.trim(),
            subject: 'Respuesta Nutricion',
            text: 'Cordial saludo,\n\nEn respuesta del correo de nutricion envio pantallazos para su validez quedo pendiente cualquier novedad.',
            attachments: adjuntos
        };

        try {
            console.log(c.amarillo('   ⏳ Enviando correo a ' + destino + '...'));
            await transporter.sendMail(mailOptions);
            console.log(c.verde('   ✅ ¡Correo enviado exitosamente con los adjuntos!'));
        } catch (error) {
            console.log(c.rojo(`   ❌ Error al enviar el correo: ${error.message}`));
        }
    }

    console.log(c.cyan('\n🎉 Proceso de envío finalizado.'));
    readline.question(c.negrita('\nPresiona ENTER para volver al menu principal...'));
}

main().catch(console.error);
