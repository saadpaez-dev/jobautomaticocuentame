const fs = require('fs');
let code = fs.readFileSync('automatizaciones/llenar-asistencia.js', 'utf8');

const regex = /if \(valueToSelect\) \{\s*console\.log\(c\.gris\(\`    \[DEBUG\] Seleccionando en \$\{keyword\}: \$\{valueToSelect\}\`\)\);\s*await sel\.selectOption\(valueToSelect, \{ timeout: 5000 \}\);\s*await workPage\.waitForTimeout\(2000\);\s*\} else \{\s*console\.log\(c\.rojo\(\`    ⚠️ No se encontró la opción para \$\{keyword\} \(\$\{textOrIndex\}\)\.\`\)\);\s*\}/g;

const replacement = `if (valueToSelect) {
                    console.log(c.gris(\`    [DEBUG] Seleccionando en \${keyword}: \${valueToSelect}\`));
                    await sel.selectOption(valueToSelect, { timeout: 5000 });
                    await workPage.waitForTimeout(2000);
                } else {
                    console.log(c.rojo(\`    ⚠️ No se encontró la opción para \${keyword} (\${textOrIndex}). Intentando fallback a la primera opción válida...\`));
                    const fallbackVal = await sel.evaluate(s => {
                        const opt = Array.from(s.options).find(o => o.value && o.value !== "0" && o.value !== "-1" && o.value !== "");
                        return opt ? opt.value : null;
                    });
                    if (fallbackVal) {
                        console.log(c.amarillo(\`    ⚠️ Fallback exitoso: Seleccionando valor: \${fallbackVal} en \${keyword}\`));
                        await sel.selectOption(fallbackVal, { timeout: 5000 });
                        await workPage.waitForTimeout(2000);
                    } else {
                        console.log(c.rojo(\`    ❌ Fallback falló: No hay opciones válidas en \${keyword}.\`));
                    }
                }`;

code = code.replace(regex, replacement);
fs.writeFileSync('automatizaciones/llenar-asistencia.js', code);
