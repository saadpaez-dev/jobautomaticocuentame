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
    
    let eps = '';
    let regimen = '';
    
    // 2. Consulta ADRES
    if (numDoc) {
        console.log(c.cyan('\n  🌐 Abriendo ADRES para consultar EPS...'));
        const context = browser.contexts()[0];
        const adresPage = await context.newPage();
        
        try {
            await adresPage.goto('https://www.adres.gov.co/consulte-su-eps', { waitUntil: 'networkidle' });
            
            // ADRES usa un iframe para el formulario
            const iframeLocator = adresPage.frameLocator('iframe');
            
            // Esperamos que el iframe cargue y aparezca el campo de documento
            const selectTipo = iframeLocator.locator('select').first();
            await selectTipo.waitFor({ state: 'attached', timeout: 15000 }).catch(()=>{});
            
            // Intentamos seleccionar el tipo buscando por id o title
            const selectTipoEspecifico = iframeLocator.locator('select[id*="TipoDocumento"], select[title*="Tipo"]');
            if (await selectTipoEspecifico.count() > 0) {
                // RC
                await selectTipoEspecifico.selectOption({ value: 'RC' }).catch(()=>{});
            }
            
            const inputNum = iframeLocator.locator('input[id*="txtNumDocumento"], input[title*="Documento"]');
            if (await inputNum.count() > 0) {
                await inputNum.fill(numDoc);
            }

            console.log(c.amarillo('\n  ⏸️  PAUSA EN ADRES'));
            console.log(c.amarillo('  Se han llenado los datos. Por favor, ve a la pestana de ADRES,'));
            console.log(c.amarillo('  resuelve el CAPTCHA de "No soy un robot" y haz clic en "Consultar".'));
            console.log(c.amarillo('  (Si el Captcha sale en blanco o falla, prueba desactivando los escudos de Brave)'));
            
            readline.question(c.negrita('  > Cuando veas la tabla de resultados en ADRES, presiona Enter aqui para continuar... '));
            
            console.log(c.amarillo('  ⏳ Extrayendo resultados de ADRES...'));
            
            // Extracción cruda de texto de tabla desde el iframe
            const cells = await iframeLocator.locator('td, span').allInnerTexts();
            const regimenIndex = cells.findIndex(c => c.trim().toUpperCase() === 'SUBSIDIADO' || c.trim().toUpperCase() === 'CONTRIBUTIVO');
            if (regimenIndex >= 0) {
                regimen = cells[regimenIndex].trim();
                console.log(c.verde(`  ✅ Regimen detectado: ${regimen}`));
            } else {
                console.log(c.rojo('  ❌ No se detecto Regimen en ADRES.'));
                regimen = await new Promise(resolve => {
                    readline.question(c.negrita('  > Por favor, ingresa el Regimen manualmente (Ej: Subsidiado o Contributivo): '), resolve);
                });
            }

            const epsIndex = cells.findIndex(c => c.trim().toUpperCase() === 'ENTIDAD' || c.trim().toUpperCase() === 'EPS');
            if (epsIndex >= 0 && epsIndex + 1 < cells.length) {
                eps = cells[epsIndex + 1].trim();
                console.log(c.verde(`  ✅ EPS detectada: ${eps}`));
            } else {
                console.log(c.rojo('  ❌ No se detecto EPS en ADRES.'));
                eps = await new Promise(resolve => {
                    readline.question(c.negrita('  > Por favor, ingresa la EPS manualmente (Ej: Capital Salud): '), resolve);
                });
            }
            
        } catch (e) {
            console.log(c.rojo(`  ❌ Error consultando ADRES: ${e.message}`));
        } finally {
            console.log(c.gris('  Cerrando pestana de ADRES...'));
            await adresPage.close();
            // Volver a Cuéntame (la pestaña anterior)
            const pages = browser.contexts()[0].pages();
            if (pages.length > 0) {
                await pages[0].bringToFront().catch(() => {});
            }
        }
    }
    
    // 3. Llenar Cuéntame
    console.log(c.cyan('\n  ✍️  Llenando formulario en Cuentame...'));
    
    try {
        if (regimen) {
            let opcionRegimen = 'Seleccione';
            if (regimen.toUpperCase().includes('CONTRIBUTIVO')) opcionRegimen = 'AFILIADO REGIMEN CONTRIBUTIVO';
            if (regimen.toUpperCase().includes('SUBSIDIADO')) opcionRegimen = 'AFILIADO REGIMEN SUBSIDIADO';
            
            const selects = await content.locator('select').all();
            for (const s of selects) {
                const text = await s.innerText();
                if (text.includes('AFILIADO REGIMEN CONTRIBUTIVO')) {
                    await s.selectOption({ label: opcionRegimen }).catch(()=>{});
                    break;
                }
            }
        }
        
        await content.waitForTimeout(1000); // Esperar a que cargue EPS
        
        if (eps) {
            const selects = await content.locator('select').all();
            for (const s of selects) {
                const text = await s.innerText();
                if (text.includes('CAPITAL SALUD') || text.includes('COMPENSAR')) {
                    const options = await s.locator('option').allInnerTexts();
                    // Buscar coincidencia parcial (ej. CAPITAL SALUD)
                    const searchStr = eps.substring(0, 7).toUpperCase();
                    const epsMatch = options.find(o => o.toUpperCase().includes(searchStr));
                    if (epsMatch) {
                        await s.selectOption({ label: epsMatch }).catch(()=>{});
                        console.log(c.verde(`  ✅ EPS Seleccionada en Cuentame: ${epsMatch}`));
                    }
                    break;
                }
            }
        }
        
        // Radios: Vacunación y Crecimiento
        await content.evaluate(() => {
            const labels = [
                '¿El beneficiario cuenta con el carnet de vacunación? *',
                '¿El carnet de vacunación se encuentra al día en las vacunas y dosis que corresponden a la edad del niño o niña? *',
                '¿El beneficiario presenta carnet de crecimiento y desarrollo? *'
            ];
            
            labels.forEach(l => {
                const allElements = Array.from(document.querySelectorAll('*'));
                const el = allElements.find(e => e.innerText && e.innerText.trim() === l);
                if (el) {
                    let next = el.nextElementSibling;
                    while (next && next.tagName !== 'TR' && next.tagName !== 'DIV') {
                        const radio = next.querySelector('input[type="radio"]');
                        if (radio) { radio.click(); break; }
                        next = next.nextElementSibling;
                    }
                    if (!next) {
                         const parentNext = el.parentElement.nextElementSibling;
                         if (parentNext) {
                             const radio = parentNext.querySelector('input[type="radio"]');
                             if (radio) radio.click();
                         }
                    }
                }
            });
        });

        // Controles de crecimiento = 1
        try {
            const selects = await content.locator('select').all();
            for (const s of selects) {
                const text = await s.innerText();
                if (text.includes('1') && text.includes('2') && text.includes('3') && !text.includes('AFILIADO')) {
                    await s.selectOption({ label: '1' }).catch(()=>{});
                    break;
                }
            }
        } catch(e) {}
        
        // Antecedente prematurez = No (usualmente el segundo radio)
        await content.evaluate(() => {
            const allElements = Array.from(document.querySelectorAll('*'));
            const el = allElements.find(e => e.innerText && e.innerText.trim() === 'Antecedente de prematurez');
            if (el) {
                const parentNext = el.parentElement.nextElementSibling;
                if (parentNext) {
                    const radios = parentNext.querySelectorAll('input[type="radio"]');
                    if (radios.length > 1) radios[1].click(); // Click "No"
                }
            }
        });
        
        // Lactancia Materna Exclusiva (Aleatorio 4 a 6) y Total (Aleatorio 12 a 15)
        try {
            const valExclusiva = Math.floor(Math.random() * (6 - 4 + 1) + 4).toString();
            const valTotal = Math.floor(Math.random() * (15 - 12 + 1) + 12).toString();
            
            const selects = await content.locator('select').all();
            for (let i = 0; i < selects.length; i++) {
                const s = selects[i];
                // Buscamos el label o texto anterior para saber cuál select es cuál
                // O podemos probar directamente si las opciones tienen los números exactos sin otras cosas
                // Una forma más segura: buscar el texto cerca del select.
                const parentText = await s.evaluate(node => {
                    const p = node.parentElement;
                    return p && p.previousElementSibling ? p.previousElementSibling.innerText : '';
                });
                
                if (parentText.includes('exclusiva (meses)')) {
                    await s.selectOption({ label: valExclusiva }).catch(()=>{});
                    console.log(c.verde(`  ✅ Lactancia exclusiva seleccionada: ${valExclusiva} meses`));
                } else if (parentText.includes('total (meses)')) {
                    await s.selectOption({ label: valTotal }).catch(()=>{});
                    console.log(c.verde(`  ✅ Lactancia total seleccionada: ${valTotal} meses`));
                }
            }
        } catch(e) {
            console.log(c.rojo(`  ⚠️ No se pudieron establecer los campos de lactancia: ${e.message}`));
        }
        
        console.log(c.cyan('  ✍️  Llenando campos dinamicos...'));
        
        // Fecha, Peso, Talla, Perimetro
        if (datos.fecha || datos.peso || datos.talla || datos.perimetro) {
            await content.evaluate((d) => {
                const allElements = Array.from(document.querySelectorAll('*'));
                
                function setInputValueByLabelText(labelText, value) {
                    if (!value) return;
                    const el = allElements.find(e => e.innerText && e.innerText.includes(labelText));
                    if (el) {
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
                
                // Llenar inputs de fecha (suelen ser 2)
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
