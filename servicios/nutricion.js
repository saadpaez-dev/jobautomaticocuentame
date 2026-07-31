const readline = require('readline-sync');

const c = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
  rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
  gris:     (t) => `\x1b[90m${t}\x1b[0m`,
  negrita:  (t) => `\x1b[1m${t}\x1b[0m`,
};

function parsearFecha(input) {
    if (!input || input.trim() === '') return '';
    const txt = input.trim().toLowerCase();
    
    const hoy = new Date();
    
    if (txt === 'hoy' || txt === 'de hoy') {
        return formatearFecha(hoy);
    }
    
    // Si es solo un numero, asume que es el dia del mes actual
    if (/^\d{1,2}$/.test(txt)) {
        const dia = parseInt(txt, 10);
        const fecha = new Date(hoy.getFullYear(), hoy.getMonth(), dia);
        return formatearFecha(fecha);
    }
    
    // Si es "22 de marzo"
    const regexDiaMes = /^(\d{1,2})\s+de\s+([a-z]+)$/;
    const match = txt.match(regexDiaMes);
    if (match) {
        const dia = parseInt(match[1], 10);
        const mesStr = match[2];
        const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        const mesIdx = meses.indexOf(mesStr);
        if (mesIdx !== -1) {
            const fecha = new Date(hoy.getFullYear(), mesIdx, dia);
            return formatearFecha(fecha);
        }
    }
    
    // Si ya viene en formato DD/MM/YYYY o YYYY-MM-DD
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(txt) || /^\d{4}-\d{2}-\d{2}$/.test(txt)) {
        return txt; // Devolver tal cual
    }
    
    return txt; // Fallback
}

function formatearFecha(date) {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}/${m}/${y}`;
}

async function llenarFormularioNutricion(browser, content, datos) {
    console.log(c.cyan('\n  ⚙️ Iniciando llenado automatico de formulario...'));
    
    // 1. Extraer Documento de Cuéntame
    console.log(c.amarillo('  ⏳ Extrayendo datos del nino del formulario...'));
    
    let tipoDoc = '';
    let numDoc = '';
    try {
        const numLabel = content.locator('label:has-text("Número de Documento"), span:has-text("Número de Documento")').first();
        if (await numLabel.count() > 0) {
            numDoc = await numLabel.evaluate(node => {
                let next = node.nextElementSibling;
                while (next) {
                    const input = next.querySelector('input');
                    if (input && input.value) return input.value;
                    next = next.nextElementSibling;
                }
                const parent = node.parentElement;
                const parentInput = parent.querySelector('input');
                if (parentInput && parentInput.value) return parentInput.value;
                if (parent.nextElementSibling) {
                     const sibInput = parent.nextElementSibling.querySelector('input');
                     if (sibInput && sibInput.value) return sibInput.value;
                }
                return '';
            });
        }
        
        if (!numDoc && datos.documentoPrevio) {
            numDoc = datos.documentoPrevio;
        }
        
        console.log(c.verde(`  ✅ Documento detectado: ${numDoc || 'Desconocido'}`));
    } catch (e) {
        console.log(c.rojo(`  ❌ Error extrayendo documento: ${e.message}`));
        if (datos.documentoPrevio) numDoc = datos.documentoPrevio;
    }
    
    // 3. Llenar Cuéntame
    console.log(c.cyan('\n  ✍️  Llenando formulario en Cuentame...'));
    
    try {
        await content.waitForSelector('select', { state: 'attached', timeout: 10000 }).catch(()=>{});
        const selectsIniciales = await content.locator('select').all();
        
        let selectRegimen;
        let regimenOptions = [];
        for (const s of selectsIniciales) {
            const text = await s.innerText();
            if (text.includes('SUBSIDIADO') && text.includes('CONTRIBUTIVO')) {
                selectRegimen = s;
                regimenOptions = await s.locator('option').allInnerTexts();
                break;
            }
        }

        if (selectRegimen && regimenOptions.length > 0) {
            const validOptions = regimenOptions.filter(o => o.trim() !== 'Seleccione' && o.trim() !== '');
            console.log(c.amarillo('\n  📋 Selecciona el Regimen de Salud en Cuentame:'));
            validOptions.forEach((opt, idx) => console.log(`  ${idx + 1}. ${opt.trim()}`));
            const idxStr = readline.question(c.negrita('  > Ingresa el numero de la opcion: '));
            const idx = parseInt(idxStr) - 1;
            if (idx >= 0 && idx < validOptions.length) {
                const regimenElegido = validOptions[idx].trim();
                await Promise.all([
                    content.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
                    selectRegimen.selectOption({ label: regimenElegido }).catch(()=>{})
                ]);
                console.log(c.verde(`  ✅ Regimen seleccionado: ${regimenElegido}`));
            }
        } else {
            console.log(c.rojo('  ❌ No se encontro el campo de Regimen en el formulario.'));
        }
        
        await content.waitForTimeout(2000); // Esperar a que carguen las EPS o re-renderice
        
        const selectsEps = await content.locator('select').all();
        let selectEps;
        for (const s of selectsEps) {
            const text = await s.innerText();
            if (text.includes('CAPITAL SALUD') || text.includes('COMPENSAR')) {
                selectEps = s;
                break;
            }
        }

        if (selectEps) {
            console.log(c.amarillo('\n  🏥 Busqueda de EPS:'));
            const epsSearch = readline.question(c.negrita('  > Escribe el nombre o parte del nombre de la EPS (ej. "Compensar"): '));
            const epsOptions = await selectEps.locator('option').allInnerTexts();
            const epsMatch = epsOptions.find(o => o.toUpperCase().includes(epsSearch.toUpperCase().trim()));
            
            if (epsMatch) {
                await Promise.all([
                    content.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
                    selectEps.selectOption({ label: epsMatch }).catch(()=>{})
                ]);
                console.log(c.verde(`  ✅ EPS seleccionada en Cuentame: ${epsMatch}`));
            } else {
                console.log(c.rojo(`  ❌ No se encontro ninguna EPS que coincida con "${epsSearch}"`));
            }
        } else {
            console.log(c.rojo('  ❌ No se encontro el campo de EPS en el formulario.'));
        }
        
        await content.waitForTimeout(2000); // Dar un respiro a la página post-EPS
        console.log(c.cyan('  ✍️  Llenando campos dinamicos...'));

        // Llenar TODOS los campos dinámicos (Inputs, Radios, Selects) de manera unificada y ultra robusta
        await content.evaluate(async (d) => {
            const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            
            function getFields(labelText, selector) {
                // Buscamos el elemento fresco en cada llamada, porque algunos aparecen dinámicamente
                const allElements = Array.from(document.querySelectorAll('label, span, td, div, p, th')).reverse();
                
                // Buscamos el elemento más profundo que contiene el texto
                // Limpiamos los saltos de línea para facilitar el includes
                const el = allElements.find(e => 
                    e.innerText && 
                    e.innerText.replace(/\s+/g, ' ').includes(labelText) && 
                    e.innerText.length < 300 // Para evitar agarrar contenedores gigantes como body o form
                );
                if (!el) return [];
                
                const containers = [
                    el.closest('td'), 
                    el.closest('.form-group'), 
                    el.closest('[class*="col-"]'), 
                    el.closest('tr')
                ].filter(Boolean);

                for (let c of containers) {
                    let fields = c.querySelectorAll(selector);
                    if (fields.length > 0) return Array.from(fields);
                    
                    if (c.nextElementSibling) {
                        fields = c.nextElementSibling.querySelectorAll(selector);
                        if (fields.length > 0) return Array.from(fields);
                    }
                }
                
                if (el.parentElement) {
                    let fields = el.parentElement.querySelectorAll(selector);
                    if (fields.length > 0) return Array.from(fields);
                    if (el.parentElement.nextElementSibling) {
                        fields = el.parentElement.nextElementSibling.querySelectorAll(selector);
                        if (fields.length > 0) return Array.from(fields);
                    }
                }
                return [];
            }

            function fillText(labelText, value) {
                if (!value) return;
                const fields = getFields(labelText, 'input[type="text"], input[type="number"]');
                if (fields.length > 0) {
                    const input = fields[0];
                    if (!input.disabled) {
                        input.value = value;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        input.dispatchEvent(new Event('blur', { bubbles: true }));
                    }
                }
            }

            function fillSelect(labelText, optionText) {
                const fields = getFields(labelText, 'select');
                if (fields.length > 0) {
                    const select = fields[0];
                    if (!select.disabled) {
                        const options = Array.from(select.options);
                        const match = options.find(o => o.text.toUpperCase().includes(optionText.toUpperCase()));
                        if (match) {
                            select.value = match.value;
                            select.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                }
            }

            function fillRadio(labelText, choice, fallbackIndex) {
                const radios = getFields(labelText, 'input[type="radio"]');
                if (radios.length > 0) {
                    let clicked = false;
                    for (let i = 0; i < radios.length; i++) {
                        const r = radios[i];
                        if (r.disabled) continue;
                        const nextText = r.nextSibling ? (r.nextSibling.textContent || '') : '';
                        const parentText = r.parentElement ? r.parentElement.innerText : '';
                        if (nextText.includes(choice) || parentText.includes(choice) || (r.value && r.value.includes(choice.replace('í', 'i')))) {
                            r.click();
                            clicked = true;
                            break;
                        }
                    }
                    if (!clicked && radios[fallbackIndex] && !radios[fallbackIndex].disabled) {
                        radios[fallbackIndex].click();
                    }
                }
            }

            // --- EJECUCIÓN ---

            // Inputs de fecha por fuerza bruta (por si están en otro formato)
            if (d.fecha) {
                const dateInputs = document.querySelectorAll('input[type="text"]');
                dateInputs.forEach(inp => {
                    if (inp.outerHTML.includes('Date') || inp.outerHTML.includes('fecha') || inp.id.toLowerCase().includes('fecha')) {
                        inp.value = d.fecha;
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
            }

            // 1. Inputs de texto (pueden ser llenados en cualquier momento, pero mejor con retardo)
            fillText('Peso (En Kilogramos)', d.peso);
            await delay(100);
            fillText('Talla (En Cent', d.talla);
            await delay(100);
            fillText('Perimetro Braquial', d.perimetro);
            await delay(100);
            fillText('esquema de vacunación', d.fecha);
            await delay(100);

            // 2. Radios en cadena (es fundamental esperar para que se muestre o habilite el siguiente)
            fillRadio('beneficiario cuenta con el carnet de vacunación', 'Sí', 0);
            await delay(500); // 0.5s para que se habilite el siguiente

            fillRadio('dosis que corresponden a la edad', 'Sí', 0);
            await delay(500);

            fillRadio('carnet de crecimiento y desarrollo', 'Sí', 0);
            await delay(500);

            // 3. Selects y Radios independientes
            fillSelect('controles de crecimiento y desarrollo', '1');
            await delay(200);

            fillRadio('Antecedente de prematurez', 'No', 1);
            fillRadio('mujer gestante atendida en alguno de los servicios', 'No', 1);
            fillSelect('desnutrición aguda moderada o severa', 'NO TIENE DESNUTRICI');

            const valExclusiva = Math.floor(Math.random() * (7 - 4 + 1) + 4).toString();
            const valTotal = Math.floor(Math.random() * (17 - 12 + 1) + 12).toString();
            fillSelect('exclusiva (meses)', valExclusiva);
            fillSelect('total (meses)', valTotal);

        }, datos);
        
        console.log(c.verde('\n  ✅ Llenado automatico completado!'));
        console.log(c.amarillo('  ⚠️ Revisa los datos en la pantalla. Cuando estes seguro, haz clic en GUARDAR manualmente.'));
        
    } catch(e) {
        console.log(c.rojo(`  ❌ Error llenando Cuéntame: ${e.message}`));
    }
}

module.exports = {
    parsearFecha,
    llenarFormularioNutricion
};
