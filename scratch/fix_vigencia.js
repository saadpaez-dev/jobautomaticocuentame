const fs = require('fs');
let code = fs.readFileSync('automatizaciones/llenar-asistencia.js', 'utf8');

code = code.replace(/asc\.vigenciaContrato \|\| '2024'/g, "asc.vigenciaContrato || '2026'");

fs.writeFileSync('automatizaciones/llenar-asistencia.js', code);
