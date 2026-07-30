const fs = require('fs');
let code = fs.readFileSync('automatizaciones/llenar-asistencia.js', 'utf8');

code = code.replace(
    /await selectDropdown\('Estado', 'Todos'\);\s*const servicioLocator = contentFrame/g,
    `await selectDropdown('Estado', 'Todos');\n        await workPage.waitForTimeout(3000);\n\n        const servicioLocator = contentFrame`
);

code = code.replace(
    /let serviciosFiltrados = filtrarServiciosPorAsociacion/g,
    `console.log(c.gris(\`    [DEBUG] Servicios encontrados sin filtrar: \${serviciosOptions.map(s => s.text).join(' | ')}\`));\n        let serviciosFiltrados = filtrarServiciosPorAsociacion`
);

code = code.replace(
    /if \(todasLasUdsMap\.length === 0\) \{\s*console\.log\(c\.rojo\('  ❌ No se encontró ningún jardín en los servicios de 2026\.'\)\);\s*process\.exit\(1\);\s*\}/g,
    `if (todasLasUdsMap.length === 0) {
            console.log(c.rojo('  ❌ No se encontró ningún jardín en los servicios de 2026.'));
            if (workPage !== rolesPage) await workPage.close();
            continue;
        }`
);

fs.writeFileSync('automatizaciones/llenar-asistencia.js', code);
