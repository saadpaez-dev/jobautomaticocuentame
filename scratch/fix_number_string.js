const fs = require('fs');
let code = fs.readFileSync('automatizaciones/llenar-asistencia.js', 'utf8');

code = code.replace(/await selectDropdown\('Contrato', asc\.numeroContrato\);/g, "await selectDropdown('Contrato', asc.numeroContrato ? asc.numeroContrato.toString() : 1);");
code = code.replace(/await selectDropdown\('Vigencia', asc\.vigenciaContrato \|\| '2024'\);/g, "await selectDropdown('Vigencia', (asc.vigenciaContrato || '2024').toString());");

fs.writeFileSync('automatizaciones/llenar-asistencia.js', code);
