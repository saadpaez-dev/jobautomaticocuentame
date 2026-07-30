const fs = require('fs');

let code = fs.readFileSync('automatizaciones/llenar-asistencia.js', 'utf8');

// Replace specific console string prompts that fail with special characters
code = code.replace(/¿Qué desea hacer con los niños seleccionados\?/g, "Que desea hacer con los ninos seleccionados?");
code = code.replace(/poner checks ✅/g, "poner checks [X]");
code = code.replace(/quitar checks ❌/g, "quitar checks [ ]");
code = code.replace(/> Ingrese los días\./g, "> Ingrese los dias.");
code = code.replace(/Dias a ignorar/g, "Dias a ignorar");
code = code.replace(/Escoja la asociación/g, "Escoja la asociacion");
code = code.replace(/ESCOJA EL JARDÍN A TRABAJAR/g, "ESCOJA EL JARDIN A TRABAJAR");
code = code.replace(/CAMBIAR DE JARDÍN/g, "CAMBIAR DE JARDIN");
code = code.replace(/Deje vacío para/g, "Deje vacio para");

fs.writeFileSync('automatizaciones/llenar-asistencia.js', code);
console.log("Patched encoding issues successfully");
