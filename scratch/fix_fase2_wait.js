const fs = require('fs');
let code = fs.readFileSync('automatizaciones/llenar-asistencia.js', 'utf8');

// The original process.exit inside Fase 2 (starts around line 430 but in Fase 2 it's further down)
// I will just use regex to target the exact block in Fase 2.
// Let's first make selectDropdown have a timeout of 2000 instead of 1000.
code = code.replace(/await sel\.selectOption\(value, \{ timeout: 5000 \}\);\s*await workPage\.waitForTimeout\(1000\);/g, `await sel.selectOption(value, { timeout: 5000 });
                            await workPage.waitForTimeout(2000);`);
code = code.replace(/await sel\.selectOption\(valSrv, \{ timeout: 5000 \}\);\s*await workPage\.waitForTimeout\(1000\);/g, `await sel.selectOption(valSrv, { timeout: 5000 });
                            await workPage.waitForTimeout(2000);`);

// In Fase 2, right after the 'Estado' select, there is a wait. 
// We want to add a wait and debug statement.
const targetBlock = `        await selectDropdown('Mes', mesAtencion);
        await selectDropdown('Estado', 'Todos');

        const servicioLocator = contentFrame.locator(\`select[id*="Servicio"]\`).first();
        let serviciosOptions = [];
        if (await servicioLocator.count() > 0) {
            serviciosOptions = await servicioLocator.evaluate(s => {
                return Array.from(s.options)
                    .filter(o => o.value && o.value !== "0" && o.value !== "-1" && o.value !== "" && !o.text.toUpperCase().includes("SELECCIONE"))
                    .map(o => ({ value: o.value, text: o.text }));
            });
        }`;

const replacementBlock = `        await selectDropdown('Mes', mesAtencion);
        await selectDropdown('Estado', 'Todos');
        await workPage.waitForTimeout(3000); // Wait for ASP.NET to load Servicios

        const servicioLocator = contentFrame.locator(\`select[id*="Servicio"]\`).first();
        let serviciosOptions = [];
        if (await servicioLocator.count() > 0) {
            serviciosOptions = await servicioLocator.evaluate(s => {
                return Array.from(s.options)
                    .filter(o => o.value && o.value !== "0" && o.value !== "-1" && o.value !== "" && !o.text.toUpperCase().includes("SELECCIONE"))
                    .map(o => ({ value: o.value, text: o.text }));
            });
        }
        console.log(c.gris(\`    [DEBUG] Servicios encontrados sin filtrar: \${serviciosOptions.map(s => s.text).join(' | ')}\`));`;

code = code.replace(targetBlock, replacementBlock); // Replace it (this might replace Fase 1 if they are identical, which is fine)

// Also change process.exit(1) to continue inside Fase 2 (and Fase 1 if we want).
const targetExit = `        if (todasLasUdsMap.length === 0) {
            console.log(c.rojo('  ❌ No se encontró ningún jardín en los servicios de 2026.'));
            process.exit(1);
        }`;

const replacementExit = `        if (todasLasUdsMap.length === 0) {
            console.log(c.rojo('  ❌ No se encontró ningún jardín en los servicios de 2026.'));
            if (workPage !== rolesPage) await workPage.close();
            continue;
        }`;

code = code.replace(targetExit, replacementExit);
// Do it globally in case Fase 1 and Fase 2 both have it
code = code.split(targetExit).join(replacementExit);

fs.writeFileSync('automatizaciones/llenar-asistencia.js', code);
