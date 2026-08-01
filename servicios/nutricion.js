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
        
        await content.waitForTimeout(3000); // Dar un respiro a la página post-EPS
        console.log(c.cyan('  ✍️  Llenando campos dinamicos...'));

        const page = content.page ? content.page() : content; // Obtener la página principal

        // Helper para reobtener el frame, porque los UpdatePanels de ASP.NET lo destruyen
        const getFrame = async () => {
            return page.frame({ name: 'frameContent' }) || page.frames().find(f => f.name() === 'frameContent') || page;
        };

        const getFieldsClientCode = `
            function getFields(labelText, selector) {
                const allElements = Array.from(document.querySelectorAll('label, span, td, div, p, th')).reverse();
                const normalize = str => str.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
                
                const el = allElements.find(e => 
                    e.innerText && 
                    normalize(e.innerText.replace(/\\s+/g, ' ')).includes(normalize(labelText)) && 
                    e.innerText.length < 300 
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

                // Check NEXT row (handles questions spanning a whole row)
                let tr = el.closest('tr');
                if (tr && tr.nextElementSibling) {
                    let fields = tr.nextElementSibling.querySelectorAll(selector);
                    if (fields.length > 0) return Array.from(fields);
                }
                
                return [];
            }
        `;

        const safeFillText = async (labelText, value) => {
            if (!value) return;
            const frm = await getFrame();
            let found = false;
            try {
                found = await frm.evaluate((args) => {
                    eval(args.code);
                    const fields = getFields(args.labelText, 'input[type="text"], input[type="number"]');
                    if (fields.length > 0 && !fields[0].disabled) {
                        fields[0].value = args.value;
                        fields[0].dispatchEvent(new Event('input', { bubbles: true }));
                        fields[0].dispatchEvent(new Event('change', { bubbles: true }));
                        fields[0].dispatchEvent(new Event('blur', { bubbles: true }));
                        return true;
                    }
                    return false;
                }, { code: getFieldsClientCode, labelText, value });
            } catch(e) { }
            
            if (found) console.log(c.verde(`    ✅ [Texto] Lleno: ${labelText}`));
            else console.log(c.rojo(`    ❌ [Texto] NO encontrado/deshabilitado: ${labelText}`));
            
            await page.waitForTimeout(500);
        };

        const safeFillSelect = async (labelText, optionText) => {
            if (!optionText) return;
            const frm = await getFrame();
            let found = false;
            try {
                found = await frm.evaluate((args) => {
                    eval(args.code);
                    const fields = getFields(args.labelText, 'select');
                    if (fields.length > 0 && !fields[0].disabled) {
                        const select = fields[0];
                        const options = Array.from(select.options);
                        const normalize = str => str.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
                        const match = options.find(o => normalize(o.text).includes(normalize(args.optionText)));
                        if (match) {
                            select.value = match.value;
                            select.dispatchEvent(new Event('change', { bubbles: true }));
                            return true;
                        }
                    }
                    return false;
                }, { code: getFieldsClientCode, labelText, optionText });
            } catch(e) { }
            
            if (found) console.log(c.verde(`    ✅ [Lista] Lleno: ${labelText}`));
            else console.log(c.rojo(`    ❌ [Lista] NO encontrado/deshabilitado: ${labelText}`));
            
            await page.waitForTimeout(1500); // Esperar si hay postback
        };

        const safeFillRadio = async (labelText, choice, fallbackIndex) => {
            const frm = await getFrame();
            let found = false;
            try {
                found = await frm.evaluate((args) => {
                    eval(args.code);
                    const radios = getFields(args.labelText, 'input[type="radio"]');
                    if (radios.length > 0) {
                        let clicked = false;
                        const normalize = str => str.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
                        const normChoice = normalize(args.choice);
                        
                        for (let i = 0; i < radios.length; i++) {
                            const r = radios[i];
                            if (r.disabled) continue;
                            const nextText = r.nextSibling ? (r.nextSibling.textContent || '') : '';
                            const parentText = r.parentElement ? r.parentElement.innerText : '';
                            if (normalize(nextText).includes(normChoice) || normalize(parentText).includes(normChoice) || (r.value && normalize(r.value).includes(normChoice))) {
                                r.click();
                                clicked = true;
                                break;
                            }
                        }
                        if (!clicked && radios[args.fallbackIndex] && !radios[args.fallbackIndex].disabled) {
                            radios[args.fallbackIndex].click();
                            clicked = true;
                        }
                        return clicked;
                    }
                    return false;
                }, { code: getFieldsClientCode, labelText, choice, fallbackIndex });
            } catch(e) { 
                // Si el contexto se destruye por UpdatePanel, significa que se hizo click exitosamente!
                if (e.message.includes('Execution context was destroyed') || e.message.includes('Session closed')) {
                    found = true;
                }
            }
            
            if (found) console.log(c.verde(`    ✅ [Opcion] Lleno: ${labelText}`));
            else console.log(c.rojo(`    ❌ [Opcion] NO encontrado/deshabilitado: ${labelText}`));
            
            await page.waitForTimeout(2000); // Darle tiempo al UpdatePanel
        };

        // LLENADO TOP-TO-BOTTOM (De arriba hacia abajo)
        // Esto evita que un UpdatePanel superior borre los campos inferiores
        
        // Inputs de fecha por fuerza bruta al inicio
        if (datos.fecha) {
            console.log(c.gris(`    - Llenando fechas faltantes...`));
            const frm = await getFrame();
            try {
                await frm.evaluate((fDate) => {
                    const dateInputs = document.querySelectorAll('input[type="text"]');
                    dateInputs.forEach(inp => {
                        if (inp.outerHTML.includes('Date') || inp.outerHTML.includes('fecha') || inp.id.toLowerCase().includes('fecha')) {
                            inp.value = fDate;
                            inp.dispatchEvent(new Event('input', { bubbles: true }));
                            inp.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    });
                }, datos.fecha);
            } catch(e) {}
        }
        await page.waitForTimeout(500);

        // 1. Vacunación y Desarrollo
        await safeFillRadio('beneficiario cuenta con el carnet de vacunación', 'Si', 0);
        await safeFillText('esquema de vacunación', datos.fecha);
        await safeFillRadio('dosis que corresponden a la edad', 'Si', 0);
        await safeFillRadio('carnet de crecimiento y desarrollo', 'Si', 0);
        await safeFillSelect('controles de crecimiento y desarrollo ha recibido', '1');
        await safeFillRadio('Antecedente de prematurez', 'No', 1);

        // 2. Antropometría
        await safeFillText('Peso (En Kilogramos)', datos.peso);
        await safeFillText('Talla (En Cent', datos.talla);
        await safeFillText('Perimetro Braquial (cm)', datos.perimetro);
        await safeFillText('Fecha de medición', datos.fecha);

        // 3. Situaciones adicionales
        await safeFillSelect('mujer gestante atendida', 'No');
        await safeFillSelect('desnutrición aguda moderada o severa', 'NO TIENE DESNUTRICI');

        // 4. Lactancia
        const valExclusiva = Math.floor(Math.random() * (7 - 4 + 1) + 4).toString();
        const valTotal = Math.floor(Math.random() * (18 - 11 + 1) + 11).toString();
        await safeFillText('exclusiva (meses)', valExclusiva);
        await safeFillText('total (meses)', valTotal);
        
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
