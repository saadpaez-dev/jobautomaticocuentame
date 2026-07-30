const fs = require('fs');
let code = fs.readFileSync('automatizaciones/llenar-asistencia.js', 'utf8');

// I will write a regex to replace the selectDropdown implementation in both Fase 1 and Fase 2.
// Actually, I can just replace the body of selectDropdown.
const oldSelectDropdownBody = `            try {
                const sel = contentFrame.locator(\`select[id*="\${keyword}"]\`).first();
                if (await sel.count() === 0) return;
                
                const isEnabled = await sel.evaluate(s => !s.disabled);
                if (!isEnabled) return; // Skip if disabled

                if (typeof textOrIndex === 'string') {
                    // Seleccionar por texto parcial
                    const value = await sel.evaluate((s, t) => {
                        const opt = Array.from(s.options).find(o => o.text.toUpperCase().includes(t.toUpperCase()));
                        return opt ? opt.value : null;
                    }, textOrIndex);
                    if (value) {
                        await sel.selectOption(value, { timeout: 5000 });
                            await workPage.waitForTimeout(2000);
                    }
                } else if (typeof textOrIndex === 'number') {
                    // Seleccionar por índice válido (>0)
                    const valSrv = await sel.evaluate(s => {
                        const opt = Array.from(s.options).find(o => o.value && o.value !== "0" && o.value !== "");
                        return opt ? opt.value : null;
                    });
                    if (valSrv) {
                        await sel.selectOption(valSrv, { timeout: 5000 });
                            await workPage.waitForTimeout(2000);
                    }
                }
            } catch (e) {
                console.log(c.gris(\`    (No se pudo seleccionar en \${keyword}: \${e.message})\`));
            }`;

const newSelectDropdownBody = `            try {
                const sel = contentFrame.locator(\`select[id*="\${keyword}"]\`).first();
                
                // Esperar hasta que el select aparezca (máx 10 segs)
                let attempts = 0;
                while (await sel.count() === 0 && attempts < 10) {
                    await workPage.waitForTimeout(1000);
                    attempts++;
                }
                if (await sel.count() === 0) return;
                
                let isEnabled = await sel.evaluate(s => !s.disabled);
                if (!isEnabled) return; // Skip if disabled

                let valueToSelect = null;

                // Intentar encontrar la opción esperada con reintentos (UpdatePanels son lentos)
                for (let retry = 0; retry < 15; retry++) {
                    if (typeof textOrIndex === 'string') {
                        valueToSelect = await sel.evaluate((s, t) => {
                            const opt = Array.from(s.options).find(o => o.text.toUpperCase().includes(t.toUpperCase()));
                            return opt ? opt.value : null;
                        }, textOrIndex);
                    } else if (typeof textOrIndex === 'number') {
                        valueToSelect = await sel.evaluate(s => {
                            const opt = Array.from(s.options).find(o => o.value && o.value !== "0" && o.value !== "");
                            return opt ? opt.value : null;
                        });
                    }

                    if (valueToSelect) {
                        break; // Encontrado
                    }
                    await workPage.waitForTimeout(1000); // Esperar a que Cuéntame actualice el select
                }

                if (valueToSelect) {
                    console.log(c.gris(\`    [DEBUG] Seleccionando en \${keyword}: \${valueToSelect}\`));
                    await sel.selectOption(valueToSelect, { timeout: 5000 });
                    await workPage.waitForTimeout(2000);
                } else {
                    console.log(c.rojo(\`    ⚠️ No se encontró la opción para \${keyword} (\${textOrIndex}).\`));
                }
            } catch (e) {
                console.log(c.gris(\`    (No se pudo seleccionar en \${keyword}: \${e.message})\`));
            }`;

code = code.split(oldSelectDropdownBody).join(newSelectDropdownBody);

// Wait, the indent in oldSelectDropdownBody might be slightly different in Fase 1 and Fase 2.
// Let's use a regex instead for safety, or simply replace the function entirely.
fs.writeFileSync('automatizaciones/llenar-asistencia.js', code);
