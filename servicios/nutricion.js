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
                await selectRegimen.selectOption({ label: regimenElegido }).catch(()=>{});
                console.log(c.verde(`  ✅ Regimen seleccionado: ${regimenElegido}`));
            }
        } else {
            console.log(c.rojo('  ❌ No se encontro el campo de Regimen en el formulario.'));
        }
        
        await content.waitForTimeout(1000); // Esperar a que carguen las EPS
        
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
                await selectEps.selectOption({ label: epsMatch }).catch(()=>{});
                console.log(c.verde(`  ✅ EPS seleccionada en Cuentame: ${epsMatch}`));
            } else {
                console.log(c.rojo(`  ❌ No se encontro ninguna EPS que coincida con "${epsSearch}"`));
            }
        } else {
            console.log(c.rojo('  ❌ No se encontro el campo de EPS en el formulario.'));
        }
        
        // Llenar Radios y Selects adicionales
        await content.evaluate(() => {
            const allElements = Array.from(document.querySelectorAll('*')).reverse();
            
            // Función auxiliar para Radios
            function fillRadio(labelText, choice, fallbackIndex) {
                const el = allElements.find(e => e.innerText && e.innerText.trim().includes(labelText));
                if (el) {
                    let container = el.closest('tr') || el.parentElement.parentElement;
                    if (container) {
                        let radios = container.querySelectorAll('input[type="radio"]');
                        if (radios.length === 0 && container.nextElementSibling) {
                            radios = container.nextElementSibling.querySelectorAll('input[type="radio"]');
                        }
                        if (radios.length === 0 && el.parentElement.nextElementSibling) {
                            radios = el.parentElement.nextElementSibling.querySelectorAll('input[type="radio"]');
                        }
                        
                        if (radios.length > 0) {
                            let clicked = false;
                            for(let i=0; i<radios.length; i++) {
                                const nextText = radios[i].nextSibling ? radios[i].nextSibling.textContent : '';
                                const parentText = radios[i].parentElement.innerText;
                                if ((nextText && nextText.includes(choice)) || 
                                    (parentText && parentText.includes(choice)) ||
                                    (radios[i].value && radios[i].value.includes(choice.replace('í', 'i')))) {
                                    radios[i].click();
                                    clicked = true;
                                    break;
                                }
                            }
                            if (!clicked && radios[fallbackIndex]) {
                                radios[fallbackIndex].click();
                            }
                        }
                    }
                }
            }

            // Llenar radios por defecto
            fillRadio('¿El beneficiario cuenta con el carnet de vacunación?', 'Sí', 0);
            fillRadio('dosis que corresponden a la edad', 'Sí', 0);
            fillRadio('¿El beneficiario presenta carnet de crecimiento y desarrollo?', 'Sí', 0);
            fillRadio('Antecedente de prematurez', 'No', 1);
            fillRadio('mujer gestante atendida en alguno de los servicios', 'No', 1);

            // Función auxiliar para Selects
            function fillSelect(labelText, optionText) {
                const el = allElements.find(e => e.innerText && e.innerText.trim().includes(labelText));
                if (el) {
                    let container = el.closest('tr') || el.parentElement.parentElement;
                    let select = null;
                    if (container) {
                        select = container.querySelector('select');
                        if (!select && container.nextElementSibling) {
                            select = container.nextElementSibling.querySelector('select');
                        }
                    }
                    if (!select && el.parentElement.nextElementSibling) {
                        select = el.parentElement.nextElementSibling.querySelector('select');
                    }

                    if (select) {
                        const options = Array.from(select.options);
                        const match = options.find(o => o.text.toUpperCase().includes(optionText.toUpperCase()));
                        if (match) {
                            select.value = match.value;
                            select.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                }
            }

            // Llenar selects por defecto
            fillSelect('cuántos controles de crecimiento y desarrollo', '1');
            fillSelect('desnutrición aguda moderada o severa', 'NO TIENE DESNUTRICI');

            // Llenar lactancia materna con valores aleatorios
            const valExclusiva = Math.floor(Math.random() * (7 - 4 + 1) + 4).toString();
            const valTotal = Math.floor(Math.random() * (17 - 12 + 1) + 12).toString();
            fillSelect('exclusiva (meses)', valExclusiva);
            fillSelect('total (meses)', valTotal);

        });
        
        console.log(c.cyan('  ✍️  Llenando campos dinamicos...'));
        
        // Fecha, Peso, Talla, Perimetro
        if (datos.fecha || datos.peso || datos.talla || datos.perimetro) {
            await content.evaluate((d) => {
                // Buscamos de abajo hacia arriba (nodos más profundos primero)
                const allElements = Array.from(document.querySelectorAll('*')).reverse();
                
                function setInputValueByLabelText(labelText, value) {
                    if (!value) return;
                    const el = allElements.find(e => e.innerText && e.innerText.includes(labelText));
                    if (el && el.parentElement) {
                        let parentNext = el.parentElement.nextElementSibling;
                        if (parentNext) {
                            const input = parentNext.querySelector('input[type="text"]');
                            if (input && !input.disabled) {
                                input.value = value;
                                // Disparar eventos para que se guarde el valor (React/Angular/Vanilla)
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                input.dispatchEvent(new Event('change', { bubbles: true }));
                                input.dispatchEvent(new Event('blur', { bubbles: true }));
                            }
                        }
                    }
                }

                setInputValueByLabelText('Peso (En Kilogramos)', d.peso);
                setInputValueByLabelText('Talla (En Cent', d.talla);
                setInputValueByLabelText('Perimetro Braquial', d.perimetro);
                setInputValueByLabelText('esquema de vacunación', d.fecha); // Llenar explícitamente la fecha de vacunación
                
                // Llenar otros inputs de fecha (como Fecha de registro datos salud)
                if (d.fecha) {
                    const dateInputs = document.querySelectorAll('input[type="text"]');
                    dateInputs.forEach(inp => {
                        if (inp.outerHTML.includes('Date') || inp.outerHTML.includes('fecha') || inp.id.toLowerCase().includes('fecha')) {
                            // Para no sobreescribir si ya lo llenó otra lógica, o asegurarnos
                            inp.value = d.fecha;
                            inp.dispatchEvent(new Event('input', { bubbles: true }));
                            inp.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    });
                }
            }, datos);
        }
        
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
