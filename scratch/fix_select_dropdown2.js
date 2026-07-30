const fs = require('fs');
let code = fs.readFileSync('automatizaciones/llenar-asistencia.js', 'utf8');

const regex = /const selectDropdown = async \(keyword, textOrIndex\) => \{[\s\S]*?\} catch \(e\) \{[\s\S]*?console\.log\(c\.gris\(\`    \(No se pudo seleccionar en \$\{keyword\}: \$\{e\.message\}\)\`\)\);\s*\}\s*\};/g;

const newSelectDropdown = `const selectDropdown = async (keyword, textOrIndex) => {
            try {
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
            }
        };`;

code = code.replace(regex, newSelectDropdown);
fs.writeFileSync('automatizaciones/llenar-asistencia.js', code);
