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

async function llenarFormularioNutricion(browser, content, datos, hasHistory = false) {
    console.log(c.cyan('\n  ⚙️ Iniciando llenado automatico de formulario...'));
    if (hasHistory) {
        console.log(c.amarillo('  ℹ️ Niño con historial: Omitiendo campos precargados (EPS, vacunas, etc.)'));
    }
    
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
        // --- SELECCION DE EPS Y REGIMEN SOLO SI NO HAY HISTORIAL ---
        if (!hasHistory) {
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
                let regimenElegido = null;
                
                // Si el usuario proveyó un regimen, intentar buscarlo
                if (datos.regimen) {
                    const idx = validOptions.findIndex(o => o.toUpperCase().includes(datos.regimen.toUpperCase()));
                    if (idx !== -1) regimenElegido = validOptions[idx].trim();
                }
                
                // Fallback: Seleccionar Contributivo automáticamente para niños nuevos
                if (!regimenElegido) {
                    const idx = validOptions.findIndex(o => o.toUpperCase().includes('CONTRIBUTIVO'));
                    if (idx !== -1) regimenElegido = validOptions[idx].trim();
                }

                if (regimenElegido) {
                    await Promise.all([
                        content.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
                        selectRegimen.selectOption({ label: regimenElegido }).catch(()=>{})
                    ]);
                    console.log(c.verde(`  ✅ Regimen seleccionado automáticamente: ${regimenElegido}`));
                } else {
                    console.log(c.amarillo('  ⚠️ No se encontró la opción de Contributivo, omitiendo.'));
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
                const epsOptions = await selectEps.locator('option').allInnerTexts();
                let randomEps = null;
                
                if (datos.eps) {
                    const idx = epsOptions.findIndex(o => o.toUpperCase().includes(datos.eps.toUpperCase()));
                    if (idx !== -1) {
                        randomEps = epsOptions[idx].trim();
                    } else {
                        console.log(c.amarillo(`  ⚠️ No se encontró EPS que coincida con "${datos.eps}". Procediendo aleatoriamente...`));
                    }
                }

                if (!randomEps) {
                    const epsComunes = [
                        'CAPITAL SALUD', 'NUEVA EPS', 'COMPENSAR', 'FAMISANAR', 'SANITAS', 'MUTUAL SER', 'SURAMERICANA'
                    ];
                    // Elegir una aleatoriamente que exista en el select
                    const matchingOptions = epsOptions.filter(o => epsComunes.some(eps => o.toUpperCase().includes(eps.toUpperCase())));
                    if (matchingOptions.length > 0) {
                        randomEps = matchingOptions[Math.floor(Math.random() * matchingOptions.length)];
                    }
                }
                
                if (randomEps) {
                    await Promise.all([
                        content.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
                        selectEps.selectOption({ label: randomEps }).catch(()=>{})
                    ]);
                    console.log(c.verde(`  ✅ EPS seleccionada en Cuentame: ${randomEps}`));
                } else {
                    console.log(c.rojo(`  ❌ No se encontró ninguna EPS común en el listado.`));
                }
            } else {
                console.log(c.rojo('  ❌ No se encontro el campo de EPS en el formulario.'));
            }
            
            await content.waitForTimeout(3000); // Dar un respiro a la página post-EPS
        }
        // -------------------------------------------------------------

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
                const targetText = normalize(labelText);
                
                for (let el of allElements) {
                    if (el.innerText && normalize(el.innerText.replace(/\\s+/g, ' ')).includes(targetText) && el.innerText.length < 300) {
                        
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
                    }
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
                    const fields = getFields(args.labelText, 'input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"])');
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
        
        // --- DIAGNÓSTICO ---
        try {
            console.log(c.amarillo('\n  🔍 DIAGNÓSTICO DE CAMPOS (Solo para el desarrollador):'));
            const frm = await getFrame();
            const dump = await frm.evaluate(() => {
                const res = [];
                document.querySelectorAll('input:not([type="hidden"]), select').forEach(el => {
                    let text = '';
                    let p = el.parentElement;
                    for(let i=0; i<4; i++) {
                        if (!p) break;
                        if (p.innerText) { text = p.innerText.trim(); break; }
                        p = p.parentElement;
                    }
                    if (el.type === 'radio' && el.parentElement && el.parentElement.innerText) {
                        text = el.parentElement.innerText;
                    }
                    // Buscamos si hay un label cercano en un tr/td anterior
                    let p2 = el.closest('tr') || el.closest('td') || el.parentElement;
                    let prevText = '';
                    if (p2 && p2.previousElementSibling) {
                        prevText = p2.previousElementSibling.innerText || '';
                    }
                    res.push({
                        tag: el.tagName,
                        type: el.type || '',
                        id: el.id,
                        context: (text + ' | PrevSibling: ' + prevText).substring(0, 80).replace(/\\s+/g, ' ')
                    });
                });
                return res;
            });
            dump.forEach(d => console.log(c.gris(`    [${d.tag} ${d.type}] id=${d.id} | Ctx: ${d.context}`)));
            console.log(c.amarillo('  --------------------------------------------------\n'));
        } catch(e) {}

        // 2. Antropometría principales (SIEMPRE SE LLENAN)
        await safeFillText('Peso (En Kilogramos)', datos.peso);
        await safeFillText('Talla (En Cent', datos.talla);
        
        // Fecha de valoración antropométrica (SIEMPRE SE ACTUALIZA CON LA FECHA DEL EXCEL)
        await safeFillText('Fecha de valoración', datos.fecha);
        try {
            const frm = await getFrame();
            await frm.evaluate((fDate) => {
                const inpVal = document.querySelector('input[id*="cuwFechaValoracionNuricional_txtFecha"]');
                if (inpVal) {
                    inpVal.value = fDate;
                    inpVal.dispatchEvent(new Event('input', { bubbles: true }));
                    inpVal.dispatchEvent(new Event('change', { bubbles: true }));
                    inpVal.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            }, datos.fecha);
        } catch(e) {}

        if (!hasHistory) {
            // 1. Vacunación y Desarrollo (SOLO PARA REGISTROS NUEVOS)
            await safeFillRadio('beneficiario cuenta con el carnet de vacunación', 'Si', 0);
            await page.waitForTimeout(500); 
            
            await safeFillText('esquema de vacunación', datos.fecha);
            await safeFillRadio('dosis que corresponden a la edad', 'Si', 0);
            
            await safeFillRadio('carnet de crecimiento y desarrollo', 'No', 1);
            await page.waitForTimeout(500);
            
            await safeFillRadio('Antecedente de prematurez', 'No', 1);
        } else {
            console.log(c.gris('    ℹ️ Niño con historial: Omitiendo modificación de "Fecha de verificación del esquema de vacunación".'));
        }

        // 3. Situaciones adicionales
        await safeFillSelect('desnutrición aguda moderada o severa', 'NO TIENE DESNUTRICI');

        if (!hasHistory) {
            // 4. Lactancia
            await safeFillSelect('¿Recibe leche materna?', 'Si');
            
            const valExclusiva = Math.floor(Math.random() * (7 - 4 + 1) + 4).toString();
            const valTotal = Math.floor(Math.random() * (18 - 11 + 1) + 11).toString();
            
            // Campos originales de lactancia
            await safeFillText('exclusiva (meses)', valExclusiva);
            await safeFillText('total (meses)', valTotal);
            
            // Nuevos campos habilitados que deben tener el mismo valor
            await safeFillText('¿Hasta qué edad fue alimentado exclusivamente', valExclusiva);
            await safeFillText('¿A qué edad introdujo alimentos diferentes', valTotal);
        }
        
        // ==========================================
        // 5. CAMPOS CONFLICTIVOS (LLENADOS AL FINAL Y MODO NATIVO)
        // ==========================================
        console.log(c.amarillo('\n  ⏳ Esperando 1 segundo para asegurar que el formulario esté estable...'));
        await page.waitForTimeout(1000);
        
        console.log(c.amarillo('  🎯 Llenando campos finales con simulación nativa...'));
        
        const f = await getFrame(); // Obtener frame directamente para llamadas de Playwright

        if (!hasHistory) {
            // A. Controles de crecimiento
            try {
                await f.selectOption('#cphCont_ddlControlesCrecimDesarrollo', { label: '1' });
                console.log(c.verde('    ✅ [Lista] Lleno (modo seguro): controles de crecimiento'));
            } catch(e) { console.log(c.rojo('    ❌ [Lista] Error controles: ' + e.message.substring(0, 50))); }
            await page.waitForTimeout(1000);

            // A2. Lactancia (Mayor / Menor 6 meses) - Nombres con errores tipográficos del ICBF
            try {
                const ddlMayor = f.locator('select[id*="ddlRecibeLechaMeternaMayorSeisMesesPI"]').first();
                if (await ddlMayor.count() > 0 && await ddlMayor.isVisible() && !await ddlMayor.isDisabled()) {
                    await ddlMayor.selectOption({ label: 'Si' }).catch(()=>{});
                    console.log(c.verde('    ✅ [Lista] Lleno (modo seguro): recibe leche materna (Mayor 6 meses)'));
                }
                const ddlMenor = f.locator('select[id*="ddlRecibeLecheMaternaMenorSeisMesesPI"], select[id*="ddlRecibeLechaMaternaMenor"]').first();
                if (await ddlMenor.count() > 0 && await ddlMenor.isVisible() && !await ddlMenor.isDisabled()) {
                    await ddlMenor.selectOption({ label: 'Si' }).catch(()=>{});
                    console.log(c.verde('    ✅ [Lista] Lleno (modo seguro): recibe leche materna (Menor 6 meses)'));
                }
            } catch(e) {}
            await page.waitForTimeout(500);
        }

        // B. Perimetro Braquial (SI YA TIENE VALOR REGISTRADO, SE IGNORA / CONSERVA)
        try {
            const pbEstado = await f.evaluate(() => {
                const inpPbVal = document.querySelector('#cphCont_txtMedicionPerimetroBraquial, input[id*="txtMedicionPerimetroBraquial"]');
                const inpPbFecha = document.querySelector('#cphCont_cuwFechaMedicionPerimetroBraquial_txtFecha, input[id*="cuwFechaMedicionPerimetroBraquial"]');
                
                const tieneVal = inpPbVal && inpPbVal.value && inpPbVal.value.trim() !== '' && inpPbVal.value.trim() !== '0';
                const tieneFecha = inpPbFecha && inpPbFecha.value && inpPbFecha.value.trim() !== '';
                
                return { tieneVal, tieneFecha };
            });

            if (pbEstado.tieneVal || pbEstado.tieneFecha) {
                console.log(c.gris('    ℹ️ Perímetro Braquial ya registrado previamente → se ignora y se conserva el valor existente.'));
            } else {
                if (datos.fecha) await safeFillText('Fecha de medición', datos.fecha);
                if (datos.perimetro) {
                    await f.fill('#cphCont_txtMedicionPerimetroBraquial', datos.perimetro.toString());
                    console.log(c.verde('    ✅ [Texto] Lleno (modo seguro): Perimetro Braquial'));
                }
            }
        } catch(e) { 
            console.log(c.rojo('    ❌ [Texto] Error perimetro: ' + e.message.substring(0, 50))); 
        }
        await page.waitForTimeout(1000);

        if (!hasHistory) {
            // C. Mujer gestante atendida
            try {
                await f.selectOption('#cphCont_ddlHijoMujerGestanteAtendidaServiciosICBF', { label: 'No' });
                console.log(c.verde('    ✅ [Lista] Lleno (modo seguro): mujer gestante atendida'));
            } catch(e) { console.log(c.rojo('    ❌ [Lista] Error gestante: ' + e.message.substring(0, 50))); }
            await page.waitForTimeout(1000);
        }
        
        console.log(c.verde('\n  ✅ Llenado automatico completado!'));
        console.log(c.amarillo('  ⚠️ Revisa los datos en la pantalla y selecciona la opción de guardado en la consola.'));
        
    } catch(e) {
        console.log(c.rojo(`  ❌ Error llenando Cuéntame: ${e.message}`));
    }
}

module.exports = {
    parsearFecha,
    llenarFormularioNutricion
};
