const ExcelJS = require('exceljs');
const path = require('path');

async function analizar() {
    const filePath = path.join(__dirname, 'docs', 'f3.m3.pp_formato_solicitud_desvinculacion_de_beneficiarios_v4.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    workbook.eachSheet((worksheet, sheetId) => {
        if (worksheet.name.toUpperCase() !== 'FORMATO') return;
        console.log(`\nHoja: ${worksheet.name}`);
        console.log(`Filas con datos: ${worksheet.rowCount}`);
        
        for (let i = 1; i <= 30; i++) {
            const row = worksheet.getRow(i);
            const values = [];
            for (let c = 1; c <= 15; c++) {
                let cell = row.getCell(c);
                let text = '';
                if (cell && cell.value !== null) {
                    text = cell.value.toString();
                    if (typeof cell.value === 'object' && cell.value.richText) {
                        text = cell.value.richText.map(rt => rt.text).join('');
                    }
                }
                text = text.replace(/\n/g, ' '); // quitar saltos de linea
                values.push(text);
            }
            console.log(`Fila ${i}: ` + values.map(v => v || '""').join(' | '));
        }
    });
}
analizar().catch(console.error);
