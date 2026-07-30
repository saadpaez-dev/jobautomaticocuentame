const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const c = require('picocolors');

/**
 * Normaliza y clasifica documentos de una carpeta de entrada y genera los 3 PDFs requeridos
 * @param {string} documento - El número de documento del niño (para buscar en docs/entradas/)
 * @returns {Promise<boolean>} true si se generaron los 3 PDFs correctamente, false en caso contrario
 */
async function procesarDocumentos(documento) {
    const inputDir = path.join(__dirname, '..', 'docs', 'entradas', documento);
    const outputDir = path.join(__dirname, '..', 'docs', 'adjuntos', documento);

    if (!fs.existsSync(inputDir)) {
        console.log(c.amarillo(`  ⚠️ No se encontró la carpeta de entrada de documentos para ${documento}`));
        console.log(c.amarillo(`     (Esperaba: ${inputDir})`));
        return false;
    }

    // Crear carpeta de salida si no existe
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const files = fs.readdirSync(inputDir).filter(f => !f.startsWith('.'));
    if (files.length === 0) {
        console.log(c.amarillo(`  ⚠️ La carpeta de entrada está vacía para ${documento}`));
        return false;
    }

    console.log(c.cyan(`  📂 Analizando ${files.length} archivo(s) en entradas/${documento}...`));

    // Estructura para agrupar páginas clasificadas (almacenaremos el buffer o pdfDoc de cada página y su texto)
    let paginasExtraidas = [];

    // Fase 1 y 2: Normalización y Fragmentación (Extraer todas las páginas/imágenes como entes individuales)
    for (const file of files) {
        const filePath = path.join(inputDir, file);
        const ext = path.extname(file).toLowerCase();
        
        console.log(`     Procesando archivo: ${file}`);
        
        if (ext === '.pdf') {
            const dataBuffer = fs.readFileSync(filePath);
            const pdfDoc = await PDFDocument.load(dataBuffer);
            const numPages = pdfDoc.getPageCount();
            
            // Para OCR y texto
            let pdfTextoGlobal = '';
            try {
                const pdfData = await pdfParse(dataBuffer);
                pdfTextoGlobal = pdfData.text || '';
            } catch (e) {
                console.log(c.gray(`       (No se pudo extraer texto nativo del PDF)`));
            }

            for (let i = 0; i < numPages; i++) {
                const subDoc = await PDFDocument.create();
                const [copiedPage] = await subDoc.copyPages(pdfDoc, [i]);
                subDoc.addPage(copiedPage);
                const subPdfBytes = await subDoc.save();
                
                // Asumimos que si hay texto en el PDF, cada página hereda algo del contexto global (pdfParse no separa muy bien por páginas a menos que se le inyecte lógica)
                // Para no complicarlo, usaremos el texto global, aunque idealmente se evaluaría solo la página
                paginasExtraidas.push({
                    tipoOriginal: 'pdf',
                    bytes: subPdfBytes,
                    texto: pdfTextoGlobal.toLowerCase(),
                    origen: `${file} (Pág ${i + 1})`
                });
            }
        } else if (['.jpg', '.jpeg', '.png'].includes(ext)) {
            // Es una imagen, usar Tesseract para OCR
            console.log(c.gray(`       Ejecutando OCR en imagen (esto puede tardar unos segundos)...`));
            try {
                const { data: { text } } = await Tesseract.recognize(filePath, 'spa');
                
                // Convertir la imagen a una página de PDF
                const imageBytes = fs.readFileSync(filePath);
                const subDoc = await PDFDocument.create();
                
                let image;
                if (ext === '.png') {
                    image = await subDoc.embedPng(imageBytes);
                } else {
                    image = await subDoc.embedJpg(imageBytes);
                }
                
                const page = subDoc.addPage([image.width, image.height]);
                page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
                const subPdfBytes = await subDoc.save();

                paginasExtraidas.push({
                    tipoOriginal: 'image',
                    bytes: subPdfBytes,
                    texto: text.toLowerCase(),
                    origen: file
                });
            } catch (error) {
                console.log(c.rojo(`       ❌ Error en OCR para ${file}: ${error.message}`));
            }
        } else {
            console.log(c.amarillo(`       ⚠️ Formato no soportado: ${ext}`));
        }
    }

    // Fase 3: Clasificación Inteligente
    let clasificacion = {
        RC: [],
        RAM: [],
        CARTA: []
    };

    let noClasificados = [];

    for (const pag of paginasExtraidas) {
        const txt = pag.texto;
        let esRC = txt.includes('nuip') || txt.includes('registro civil') || txt.includes('nacimiento') || txt.includes('identificacion') || txt.includes('república de colombia') || txt.includes('republica de colombia') || txt.includes('registraduria') || txt.includes('tarjeta de identidad');
        let esRAM = txt.includes('asistencia') || txt.includes('ram') || txt.includes('días') || txt.includes('dias') || txt.includes('lunes') || txt.includes('martes') || txt.includes('novedades');
        let esCarta = txt.includes('certifico') || txt.includes('constancia') || txt.includes('por medio de') || txt.includes('asiste') || txt.includes('cordial saludo') || txt.includes('señores icbf');

        // Ponderación básica si coinciden varios
        if (esRC) clasificacion.RC.push(pag);
        else if (esRAM) clasificacion.RAM.push(pag);
        else if (esCarta) clasificacion.CARTA.push(pag);
        else noClasificados.push(pag);
    }

    // Fase 3.5: Lógica de descarte (si falta 1 categoría y sobra 1 documento no clasificado)
    const categoriasFaltantes = [];
    if (clasificacion.RC.length === 0) categoriasFaltantes.push('RC');
    if (clasificacion.RAM.length === 0) categoriasFaltantes.push('RAM');
    if (clasificacion.CARTA.length === 0) categoriasFaltantes.push('CARTA');

    if (categoriasFaltantes.length === 1 && noClasificados.length === 1) {
        console.log(c.cyan(`     🧠 Aplicando descarte: El documento no clasificado '${noClasificados[0].origen}' será asignado a ${categoriasFaltantes[0]}`));
        clasificacion[categoriasFaltantes[0]].push(noClasificados[0]);
        noClasificados = [];
        categoriasFaltantes.pop(); // Ya no falta
    }

    // Si aún hay no clasificados, los metemos a la carta por defecto, que es la más informal y difícil de leer
    if (noClasificados.length > 0 && clasificacion.CARTA.length === 0) {
        console.log(c.cyan(`     🧠 Aplicando descarte: Asignando hojas no reconocidas a CARTA por ser el documento más informal.`));
        clasificacion.CARTA = [...noClasificados];
    } else if (noClasificados.length > 0) {
        // Si ya hay carta, metemos lo extra a la carta
        clasificacion.CARTA.push(...noClasificados);
    }

    // Fase 4: Ensamblaje y Validación
    let todoExitoso = true;
    const archivosGenerar = [
        { key: 'RAM', name: 'RAM.pdf' },
        { key: 'RC', name: 'RC.pdf' },
        { key: 'CARTA', name: 'CARTA.pdf' }
    ];

    for (const doc of archivosGenerar) {
        const paginas = clasificacion[doc.key];
        if (paginas.length === 0) {
            console.log(c.rojo(`  ❌ Faltan documentos: No se pudo detectar o armar el archivo ${doc.name}`));
            todoExitoso = false;
            continue;
        }

        const mergedPdf = await PDFDocument.create();
        for (const pag of paginas) {
            const tempDoc = await PDFDocument.load(pag.bytes);
            const [copiedPage] = await mergedPdf.copyPages(tempDoc, [0]);
            mergedPdf.addPage(copiedPage);
        }

        const pdfBytes = await mergedPdf.save();
        const outputPath = path.join(outputDir, doc.name);
        fs.writeFileSync(outputPath, pdfBytes);
        console.log(c.verde(`     ✔️ Generado ${doc.name} (compuesto por ${paginas.length} página(s))`));
    }

    if (todoExitoso) {
        console.log(c.verde(`  ✅ Documentos clasificados y listos en: docs/adjuntos/${documento}/`));
    }

    return todoExitoso;
}

module.exports = { procesarDocumentos };
