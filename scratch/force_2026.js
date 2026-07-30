const fs = require('fs');
let code = fs.readFileSync('automatizaciones/llenar-asistencia.js', 'utf8');

code = code.replace(/await selectDropdown\('Vigencia', \(asc\.vigenciaContrato \|\| '2026'\)\.toString\(\)\);/g, "await selectDropdown('Vigencia', '2026');");

fs.writeFileSync('automatizaciones/llenar-asistencia.js', code);
