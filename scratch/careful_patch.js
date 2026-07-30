const fs = require('fs');

let code = fs.readFileSync('automatizaciones/llenar-asistencia.js', 'utf8');

// 1. Update filter function
code = code.replace(/function filtrarServiciosPorAsociacion[\s\S]*?return options;\r?\n}/, `function filtrarServiciosPorAsociacion(servOptions, ascNombre, tipoServicio) {
    // Primero, siempre descartamos lo que NO sea 2026
    let options = servOptions.filter(o => o.text.includes("2026"));
    
    ascNombre = ascNombre.toUpperCase();

    if (ascNombre.includes("DELICIAS DEL CARMEN")) {
        options = options.filter(o => o.text.includes("420269") || o.text.includes("JARDÍN COMUNITARIO"));
    } else if (ascNombre.includes("BARRIOS UNIDOS") || 
               ascNombre.includes("PROGRESO INFANTIL") || 
               ascNombre.includes("BRISAS DE BUENAVISTA")) {
        options = options.filter(o => o.text.includes("420267") || o.text.includes("HCB"));
    } else {
        // Asociaciones mixtas (BUENAVISTA, VERBENAL Y REFUGIO, CANAIMA)
        if (tipoServicio === 'Individual') {
            options = options.filter(o => (o.text.includes("420267") || o.text.includes("HCB")) && !o.text.includes("420269"));
        } else if (tipoServicio === 'Agrupado') {
            options = options.filter(o => o.text.includes("420269") || o.text.includes("JARDÍN COMUNITARIO"));
        }
    }
    return options;
}`);

// 2. Add prompt in Fase 1
code = code.replace(
    /const diasIgnorar = diasIgnorarStr\.split\(\',\'\)\.map\(d => parseInt\(d\.trim\(\)\)\)\.filter\(d => !isNaN\(d\)\);/,
    `const diasIgnorar = diasIgnorarStr.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));\n\n    for (let asc of ascAProcesar) {\n        if (['BUENAVISTA', 'VERBENAL Y REFUGIO', 'CANAIMA'].some(x => asc.nombreCorto.toUpperCase().includes(x))) {\n            const opciones = ['Individuales (HCB - 420267)', 'Agrupados (JARDÍN COMUNITARIO - 420269)'];\n            const res = readline.keyInSelect(opciones, c.negrita(\`\\n  > La asociacion \${asc.nombreCorto} es MIXTA. Que jardines desea procesar?\`), { cancel: false });\n            asc.tipoServicio = res === 0 ? 'Individual' : 'Agrupado';\n        }\n    }`
);

// 3. Update Fase 1 calls to pass asc.tipoServicio
code = code.replace(/let serviciosFiltrados = filtrarServiciosPorAsociacion\(serviciosOptions, asc\.nombreCorto\);/g, `let serviciosFiltrados = filtrarServiciosPorAsociacion(serviciosOptions, asc.nombreCorto, asc.tipoServicio);`);

// 4. Add prompt in Fase 2 (before printing "Iniciando Fase 2")
code = code.replace(
    /console\.log\(c\.verde\(\`\\n  ✅ Iniciando Fase 2 en la asociación: \${asc\.nombreCorto}\`\)\);/,
    `if (['BUENAVISTA', 'VERBENAL Y REFUGIO', 'CANAIMA'].some(x => asc.nombreCorto.toUpperCase().includes(x))) {\n            const opciones = ['Individuales (HCB - 420267)', 'Agrupados (JARDÍN COMUNITARIO - 420269)'];\n            const res = readline.keyInSelect(opciones, c.negrita(\`\\n  > La asociacion \${asc.nombreCorto} es MIXTA. Que jardines desea procesar?\`), { cancel: false });\n            asc.tipoServicio = res === 0 ? 'Individual' : 'Agrupado';\n        }\n\n        console.log(c.verde(\`\\n  ✅ Iniciando Fase 2 en la asociación: \${asc.nombreCorto}\`));`
);


fs.writeFileSync('automatizaciones/llenar-asistencia.js', code);
console.log("Patched successfully");
