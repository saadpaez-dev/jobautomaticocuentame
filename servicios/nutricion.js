const { seleccionarDropdownReactivo, esperarPostBackReactivo } = require('./filtro-monitor');
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
    if (input === null || input === undefined || input === '') return '';
    
    // Si viene como número de serie de Excel (ej: 45240)
    if (typeof input === 'number' && !isNaN(input) && input > 30000 && input < 60000) {
        try {
            const xlsx = require('xlsx');
            if (xlsx && xlsx.SSF && xlsx.SSF.parse_date_code) {
                const dateObj = xlsx.SSF.parse_date_code(input);
                if (dateObj && dateObj.y && dateObj.m && dateObj.d) {
                    const d = String(dateObj.d).padStart(2, '0');
                    const m = String(dateObj.m).padStart(2, '0');
                    return `${d}/${m}/${dateObj.y}`;
                }
            }
        } catch(e) {}
    }

    const txt = String(input).trim().toLowerCase();
    if (txt === '') return '';
    
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

async function descartarAlertasInformativas(target) {
    try {
        if (!target) return;
        const btnSelector = 'button:has-text("Aceptar"), input[value="Aceptar"], a:has-text("Aceptar"), button:has-text("SI"), input[value="SI"], button:has-text("Ok"), input[value="Ok"]';
        const btn = target.locator(btnSelector).first();
        if (await btn.isVisible().catch(() => false)) {
            console.log(c.amarillo('  ⚠️  Mensaje informativo Cuentame detectado (SGSSS / Alerta) → haciendo clic en Aceptar...'));
            await btn.click().catch(() => btn.evaluate(n => n.click()));
            await (target.waitForTimeout ? target.waitForTimeout(600) : new Promise(r => setTimeout(r, 600)));
        }
    } catch(e) {}
}

async function asegurarRadioOpcion(page, frame, idPattern, valorDeseado) {
    const isSi = (String(valorDeseado).toLowerCase() === 'si' || valorDeseado === '1');
    const suffix = isSi ? '_0' : '_1';
    const targetVal = isSi ? '1' : '0';

    try {
        const locators = [
            frame.locator(`input[type="radio"][id*="${idPattern}"][id$="${suffix}"]`).first(),
            frame.locator(`input[type="radio"][id*="${idPattern}"][value="${targetVal}"]`).first(),
            frame.locator(`input[type="radio"][id*="${idPattern}"][value="${valorDeseado}"]`).first()
        ];

        let clicked = false;
        for (const loc of locators) {
            if (await loc.count() > 0 && !await loc.isDisabled().catch(() => false)) {
                const isChecked = await loc.isChecked().catch(() => false);
                if (!isChecked) {
                    await loc.check({ force: true }).catch(async () => {
                        await loc.click({ force: true });
                    });
                }
                clicked = true;
                break;
            }
        }

        if (!clicked) {
            await frame.evaluate(({ idPattern, isSi, targetVal }) => {
                const radios = Array.from(document.querySelectorAll(`input[type="radio"][id*="${idPattern}"]`));
                if (radios.length > 0) {
                    const target = radios.find(r => isSi ? (r.value === '1' || r.id.endsWith('_0')) : (r.value === '0' || r.id.endsWith('_1'))) || radios[isSi ? 0 : 1];
                    if (target && !target.disabled && !target.checked) {
                        target.checked = true;
                        target.click();
                        target.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            }, { idPattern, isSi, targetVal }).catch(() => {});
        }
    } catch(e) {}
}

async function asegurarDesnutricionAguda(page, frame, etapa = 'General') {
    const framesToCheck = [];
    if (frame) framesToCheck.push(frame);
    if (page && page.frames) {
        for (const f of page.frames()) {
            if (!framesToCheck.includes(f)) framesToCheck.push(f);
        }
    }
    if (framesToCheck.length === 0 && page) framesToCheck.push(page);

    for (const frm of framesToCheck) {
        try {
            // Selección DOM directa e instantánea (< 5ms) buscando la opción "NO TIENE DESNUTRICI"
            const domResult = await frm.evaluate(() => {
                const normalize = str => (str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u00a0\s]+/g, " ").toUpperCase().trim();
                const allSelects = Array.from(document.querySelectorAll('select'));
                for (const sel of allSelects) {
                    const opts = Array.from(sel.options);
                    const idx = opts.findIndex(o => normalize(o.text).includes('NO TIENE DESNUTRICI'));
                    if (idx !== -1) {
                        opts.forEach((o, i) => { o.selected = (i === idx); });
                        sel.selectedIndex = idx;
                        sel.value = opts[idx].value;
                        if (typeof sel.onchange === 'function') {
                            try { sel.onchange(); } catch(e) {}
                        }
                        sel.dispatchEvent(new Event('input', { bubbles: true }));
                        sel.dispatchEvent(new Event('change', { bubbles: true }));
                        sel.dispatchEvent(new Event('blur', { bubbles: true }));
                        return { ok: true, id: sel.id, text: opts[idx].text.trim() };
                    }
                }
                return { ok: false };
            }).catch(() => ({ ok: false }));

            if (domResult && domResult.ok) {
                console.log(c.verde(`    ✅ [Lista - ${etapa}] Desnutrición aguda = "${domResult.text}" (ID: ${domResult.id || 'N/A'})`));
                return true;
            }
        } catch(e) {}
    }

    console.log(c.rojo(`    ❌ [Lista - ${etapa}] No se pudo localizar el campo Desnutrición aguda en ningún frame.`));
    return false;
}

async function llenarFormularioNutricion(browser, content, datos, hasHistory = false) {
    const page = content.page ? content.page() : (content.context ? content : null);
    console.log(c.cyan('\n  ⚙️ Iniciando llenado automatico de formulario...'));

    // Helper para reobtener el frame, porque los UpdatePanels de ASP.NET lo destruyen
    const getFrame = async () => {
        return (page && page.frame ? (page.frame({ name: 'frameContent' }) || page.frames().find(f => f.name() === 'frameContent')) : null) || content;
    };

    let f = await getFrame();
    await descartarAlertasInformativas(f);
    if (page && page !== f) {
        await descartarAlertasInformativas(page);
    }

    if (hasHistory) {
        console.log(c.amarillo('  ℹ️ Nino con historial en Cuentame: Validando y completando campos obligatorios de la nueva toma...'));
    } else {
        console.log(c.verde('  ✨ Nino nuevo en Cuentame: Estableciendo parametros obligatorios completos (Régimen, EPS, Vacunación, Crecimiento, Controles)...'));
    }

    // Normalizar comas por puntos en peso, talla y perimetro
    if (datos.peso) datos.peso = String(datos.peso).trim().replace(',', '.');
    if (datos.talla) datos.talla = String(datos.talla).trim().replace(',', '.');
    if (datos.perimetro) datos.perimetro = String(datos.perimetro).trim().replace(',', '.');

    // 1. Extraer Documento de Cuentame
    console.log(c.amarillo('  ⏳ Extrayendo datos del nino del formulario...'));
    
    let tipoDoc = '';
    let numDoc = '';
    try {
        const numLabel = f.locator('label:has-text("Numero de Documento"), span:has-text("Numero de Documento")').first();
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
    
    // 3. Llenar Cuentame
    console.log(c.cyan('\n  ✍️  Llenando formulario en Cuentame...'));
    
    try {
        f = await getFrame();

        // --- DETECCION AUTOMATICA DE HISTORIAL EN CUENTAME ---
        // Si el formulario ya tiene datos precargados (carnets seleccionados, fecha de vacunacion previa o controles),
        // significa inequívocamente que el beneficiario ya tiene un historial registrado en Cuéntame.
        if (!hasHistory) {
            const tieneDatosPrevios = await f.evaluate(() => {
                const radVac = document.querySelector('input[id*="rbTieneCarnetVacunacion"]:checked, input[name*="TieneCarnetVacunacion"]:checked');
                const radCrec = document.querySelector('input[id*="rbTieneCarnetCrecimiento"]:checked, input[name*="TieneCarnetCrecimiento"]:checked');
                const fecVac = document.querySelector('input[id*="FechaVerificacionVacunacion"], input[id*="txtFechaEsquema"], input[id*="txtFechaVerificacion"]');
                const hasFecVac = fecVac && fecVac.value && fecVac.value.trim() !== '' && !fecVac.value.includes('1900');
                const ddlControles = document.querySelector('select[id*="ddlControlesCrecimiento"], select[id*="Controles"]');
                const hasControles = ddlControles && ddlControles.value && ddlControles.value !== '0' && ddlControles.value !== '';
                return !!(radVac || radCrec || hasFecVac || hasControles);
            }).catch(() => false);

            if (tieneDatosPrevios) {
                console.log(c.amarillo('  ℹ️ Datos previos detectados en el formulario de Cuentame: Tratando como beneficiario con historial previo.'));
                hasHistory = true;
            }
        }

        // --- SELECCION DE EPS Y REGIMEN (Asegurar que esten seleccionados siempre) ---
        await f.waitForSelector('select', { state: 'attached', timeout: 5000 }).catch(()=>{});
        
        // 1. Localizar y seleccionar Régimen
        let selectRegimen = f.locator('select[id*="Regimen"], select[id*="ddlRegimen"], select[name*="Regimen"]').first();
        let hasRegimen = (await selectRegimen.count() > 0);
        
        if (!hasRegimen) {
            const allSelects = await f.locator('select').all();
            for (const s of allSelects) {
                const text = await s.innerText().catch(() => '');
                if (text.includes('SUBSIDIADO') && text.includes('CONTRIBUTIVO')) {
                    selectRegimen = s;
                    hasRegimen = true;
                    break;
                }
            }
        }

        if (hasRegimen) {
            const currentRegVal = await selectRegimen.evaluate(el => el.selectedOptions[0] ? el.selectedOptions[0].text : '').catch(() => '');
            const necesitaRegimen = !currentRegVal || currentRegVal.includes('Seleccione') || currentRegVal.trim() === '';
            
            if (necesitaRegimen) {
                const regimenElegido = datos.regimen || 'CONTRIBUTIVO';
                console.log(c.amarillo(`  ⏳ Seleccionando Régimen (${regimenElegido})...`));
                await seleccionarDropdownReactivo(page, f, selectRegimen, regimenElegido, { 
                    nombreEtiqueta: 'Regimen',
                    dependienteSelector: 'select[id*="Eps"], select[id*="ddlEps"], select[id*="EPS"]'
                });
                console.log(c.verde(`  ✅ Régimen seleccionado: ${regimenElegido}`));
                await page.waitForTimeout(600);
                f = await getFrame();
            }
        }
        
        // 2. Localizar y seleccionar EPS
        let selectEps = f.locator('select[id*="Eps"], select[id*="ddlEps"], select[id*="EPS"], select[name*="Eps"]').first();
        let hasEps = (await selectEps.count() > 0);
        
        if (!hasEps) {
            const allSelects = await f.locator('select').all();
            for (const s of allSelects) {
                const text = await s.innerText().catch(() => '');
                if (text.includes('CAPITAL SALUD') || text.includes('COMPENSAR') || text.includes('NUEVA EPS') || text.includes('FAMISANAR')) {
                    selectEps = s;
                    hasEps = true;
                    break;
                }
            }
        }

        if (hasEps) {
            // Esperar que las opciones de EPS carguen
            await f.waitForFunction((el) => {
                return el && el.options && (el.options.length > 1 || (el.options.length === 1 && el.options[0].value !== ''));
            }, await selectEps.elementHandle().catch(() => null), { timeout: 4000 }).catch(() => {});

            const currentEpsVal = await selectEps.evaluate(el => el.selectedOptions[0] ? el.selectedOptions[0].text : '').catch(() => '');
            const necesitaEps = !currentEpsVal || currentEpsVal.includes('Seleccione') || currentEpsVal.trim() === '';
            
            if (necesitaEps) {
                const epsOptions = await selectEps.locator('option').allInnerTexts().catch(() => []);
                let randomEps = null;
                
                if (datos.eps) {
                    const idx = epsOptions.findIndex(o => o.toUpperCase().includes(datos.eps.toUpperCase()));
                    if (idx !== -1) randomEps = epsOptions[idx].trim();
                }

                if (!randomEps) {
                    const epsComunes = [
                        'CAPITAL SALUD', 'NUEVA EPS', 'COMPENSAR', 'FAMISANAR', 'SANITAS', 'MUTUAL SER', 'SURAMERICANA', 'SALUD TOTAL', 'COOSALUD'
                    ];
                    const matchingOptions = epsOptions.filter(o => epsComunes.some(eps => o.toUpperCase().includes(eps.toUpperCase())));
                    if (matchingOptions.length > 0) {
                        randomEps = matchingOptions[0].trim();
                    } else {
                        const validEps = epsOptions.filter(o => o.trim() !== 'Seleccione' && o.trim() !== '' && !o.trim().startsWith('-'));
                        if (validEps.length > 0) randomEps = validEps[0].trim();
                    }
                }
                
                if (randomEps) {
                    console.log(c.amarillo(`  ⏳ Seleccionando EPS (${randomEps})...`));
                    await seleccionarDropdownReactivo(page, f, selectEps, randomEps, { nombreEtiqueta: 'EPS' });
                    console.log(c.verde(`  ✅ EPS seleccionada: ${randomEps}`));
                    await page.waitForTimeout(400);
                    f = await getFrame();
                }
            }
        }
        // -------------------------------------------------------------

        console.log(c.cyan('  ✍️  Llenando campos dinamicos...'));

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
            
            await page.waitForTimeout(200); // Esperar si hay postback
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
                            let lblText = r.nextSibling ? (r.nextSibling.textContent || '') : '';
                            if (r.parentElement && r.parentElement.tagName === 'LABEL') {
                                lblText += ' ' + r.parentElement.innerText;
                            }
                            if (r.id) {
                                const extLabel = document.querySelector('label[for="' + r.id + '"]');
                                if (extLabel) lblText += ' ' + extLabel.innerText;
                            }
                            if (normalize(lblText).includes(normChoice) || (r.value && normalize(r.value).includes(normChoice))) {
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
            
            await page.waitForTimeout(200); // Darle tiempo al UpdatePanel
        };

        // LLENADO TOP-TO-BOTTOM (De arriba hacia abajo)
        // Esto evita que un UpdatePanel superior borre los campos inferiores
        
        // --- DIAGNOSTICO (Solo si DEBUG_CAMPOS está activo) ---
        if (process.env.DEBUG_CAMPOS === 'true') {
            try {
                console.log(c.amarillo('\n  🔍 DIAGNOSTICO DE CAMPOS (Solo para el desarrollador):'));
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
        }

        // Helper robusto para asegurar que Peso, Talla y Fecha queden diligenciados sin importar postbacks de ASP.NET
        const asegurarAntropometria = async (etapa = 'Inicial') => {
            const frm = await getFrame();
            const pesoVal = String(datos.peso || '').trim().replace(',', '.');
            const tallaVal = String(datos.talla || '').trim().replace(',', '.');
            const fechaVal = String(datos.fecha || '').trim();

            if (!pesoVal && !tallaVal) {
                console.log(c.amarillo(`    ⚠️ [Antropometría - ${etapa}]: Sin valores de peso/talla en el registro.`));
                return;
            }

            // 1. Playwright locators directos
            try {
                if (pesoVal) {
                    const locPeso = frm.locator('#cphCont_txtPeso, input[id*="txtPeso"], input[name*="txtPeso"], input[id*="Peso" i], input[name*="Peso" i]').first();
                    if (await locPeso.count() > 0) {
                        await locPeso.scrollIntoViewIfNeeded().catch(() => {});
                        await locPeso.fill(pesoVal).catch(() => {});
                        await locPeso.dispatchEvent('change').catch(() => {});
                        await locPeso.dispatchEvent('blur').catch(() => {});
                    }
                }
                if (tallaVal) {
                    const locTalla = frm.locator('#cphCont_txtTalla, input[id*="txtTalla"], input[name*="txtTalla"], input[id*="Talla" i], input[name*="Talla" i]').first();
                    if (await locTalla.count() > 0) {
                        await locTalla.scrollIntoViewIfNeeded().catch(() => {});
                        await locTalla.fill(tallaVal).catch(() => {});
                        await locTalla.dispatchEvent('change').catch(() => {});
                        await locTalla.dispatchEvent('blur').catch(() => {});
                    }
                }
            } catch(e) {}

            // 2. DOM evaluate exhaustivo (ID, Name, y búsqueda contextual bajo la etiqueta)
            try {
                const resEval = await frm.evaluate(({ p, t, f }) => {
                    function setVal(el, v) {
                        if (!el || !v) return false;
                        el.value = v;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        el.dispatchEvent(new Event('blur', { bubbles: true }));
                        return true;
                    }

                    // Buscar input Peso
                    let inpPeso = document.querySelector('#cphCont_txtPeso, input[id*="txtPeso"], input[name*="txtPeso"], input[id*="Peso" i], input[name*="Peso" i]');
                    if (!inpPeso) {
                        const allLabels = Array.from(document.querySelectorAll('label, span, td, div, p')).reverse();
                        for (const lbl of allLabels) {
                            const txt = (lbl.innerText || '').toLowerCase();
                            if (txt.includes('peso (en kilogramos)') || txt.includes('peso(en kilogramos)') || (txt.includes('peso') && txt.includes('kg'))) {
                                inpPeso = lbl.querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])')
                                    || (lbl.parentElement && lbl.parentElement.querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])'))
                                    || (lbl.closest('tr') && lbl.closest('tr').querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])'))
                                    || (lbl.closest('tr') && lbl.closest('tr').nextElementSibling && lbl.closest('tr').nextElementSibling.querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])'));
                                if (inpPeso) break;
                            }
                        }
                    }
                    if (inpPeso && p) {
                        setVal(inpPeso, p);
                    }

                    // Buscar input Talla
                    let inpTalla = document.querySelector('#cphCont_txtTalla, input[id*="txtTalla"], input[name*="txtTalla"], input[id*="Talla" i], input[name*="Talla" i]');
                    if (!inpTalla) {
                        const allLabels = Array.from(document.querySelectorAll('label, span, td, div, p')).reverse();
                        for (const lbl of allLabels) {
                            const txt = (lbl.innerText || '').toLowerCase();
                            if (txt.includes('talla (en cent') || txt.includes('talla(en cent') || (txt.includes('talla') && txt.includes('cm'))) {
                                inpTalla = lbl.querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])')
                                    || (lbl.parentElement && lbl.parentElement.querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])'))
                                    || (lbl.closest('tr') && lbl.closest('tr').querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])'))
                                    || (lbl.closest('tr') && lbl.closest('tr').nextElementSibling && lbl.closest('tr').nextElementSibling.querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])'));
                                if (inpTalla) break;
                            }
                        }
                    }
                    if (inpTalla && t) {
                        setVal(inpTalla, t);
                    }

                    // Buscar Fecha de valoración antropométrica
                    let inpFecha = document.querySelector('#cphCont_cuwFechaValoracionNuricional_txtFecha, #cphCont_cuwFechaValoracionNutricional_txtFecha, input[id*="cuwFechaValoracion"][id*="txtFecha"], input[id*="txtFechaValoracion"]');
                    if (inpFecha && f) {
                        setVal(inpFecha, f);
                    }

                    return { 
                        pesoFinal: inpPeso ? inpPeso.value : '', 
                        tallaFinal: inpTalla ? inpTalla.value : '',
                        fechaFinal: inpFecha ? inpFecha.value : ''
                    };
                }, { p: pesoVal, t: tallaVal, f: fechaVal });

                console.log(c.verde(`    ✅ [Antropometría - ${etapa}]: Peso = ${resEval?.pesoFinal || pesoVal} kg | Talla = ${resEval?.tallaFinal || tallaVal} cm | Fecha = ${resEval?.fechaFinal || fechaVal}`));
            } catch(e) {
                console.log(c.rojo(`    ❌ [Antropometría - ${etapa}] Error: ${e.message}`));
            }
        };

        const asegurarDesnutricion = async (etapa = 'Inicial') => {
            const frm = await getFrame();
            return await asegurarDesnutricionAguda(page, frm, etapa);
        };

        // 2. Antropometria principales (SIEMPRE SE LLENAN)
        await safeFillText('Peso (En Kilogramos)', datos.peso);
        await safeFillText('Talla (En Cent', datos.talla);
        await safeFillText('Fecha de valoracion', datos.fecha);
        await asegurarAntropometria('Inicial');
        
        // Cuéntame determina la toma automáticamente a partir de la Fecha de Valoración.
        // Solo si la pantalla tuviera un control explícito de Toma o Periodo se evalúa.
        const tieneSelectToma = await f.evaluate(() => {
            return Array.from(document.querySelectorAll('select')).some(s => {
                const id = (s.id || '').toLowerCase();
                const name = (s.name || '').toLowerCase();
                return (id.includes('toma') || id.includes('periodo')) && !s.disabled;
            });
        }).catch(() => false);

        if (tieneSelectToma && datos.fecha) {
            const partesFecha = String(datos.fecha).trim().split(/[\/-]/);
            if (partesFecha.length === 3) {
                let mesIndex = parseInt(partesFecha[1], 10) - 1;
                if (partesFecha[0].length === 4) mesIndex = parseInt(partesFecha[1], 10) - 1;
                const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
                if (mesIndex >= 0 && mesIndex < 12) {
                    const nombreMes = mesesNombres[mesIndex];
                    const numToma = Math.floor(mesIndex / 3) + 1;
                    const r1 = await safeFillSelect('Toma', `Toma ${numToma}`);
                    if (!r1) await safeFillSelect('Periodo', nombreMes);
                }
            }
        }

        // 1. Vacunacion y Desarrollo (SIEMPRE ASEGURAR QUE ESTEN ACTIVADOS)
        await safeFillRadio('beneficiario cuenta con el carnet de vacunacion', 'Si', 0);
        await page.waitForTimeout(100); 
        
        await safeFillText('esquema de vacunacion', datos.fecha);
        await safeFillRadio('dosis que corresponden a la edad', 'Si', 0);
        
        // 1.2 Carnet de crecimiento y desarrollo:
        // Si el beneficiario ya tiene tomas registradas (hasHistory = true), NO intervenir colocando "Si",
        // para no forzar la pregunta de controles ni alterar el estado previo en Cuéntame.
        if (!hasHistory) {
            await safeFillRadio('carnet de crecimiento y desarrollo', 'Si', 0);
            await page.waitForTimeout(100);
        } else {
            console.log(c.cyan('    ℹ️ Beneficiario con tomas previas: No se interviene en carnet de crecimiento y desarrollo.'));
        }

        // 1.1 Antecedente de prematurez: Cuentame a veces lo habilita de la nada, siempre debe ser "No".
        await safeFillRadio('Antecedente de prematurez', 'No', 1);

        // 3. Situaciones adicionales
        await safeFillSelect('desnutricion aguda moderada o severa', 'NO TIENE DESNUTRICI');
        await safeFillSelect('canalizado a la Entidad Territorial', 'NO TIENE DESNUTRICI');
        await asegurarDesnutricion('Intermedio');

        // Determinar fecha de nacimiento y edad en meses para reglas de validacion ICBF/Cuentame
        let fechaNac = datos.fechaNacimiento || '';
        if (!fechaNac) {
            const fTemp = await getFrame();
            fechaNac = await fTemp.evaluate(() => {
                const el = document.querySelector('span[id*="lblFechaNacimiento"], span[id*="lblNacimiento"], span[id*="lblFecNac"]');
                if (el && /\d{2}\/\d{2}\/\d{4}/.test(el.innerText)) {
                    const m = el.innerText.match(/\d{2}\/\d{2}\/\d{4}/);
                    if (m) return m[0];
                }
                const elements = Array.from(document.querySelectorAll('td, span, label, b, strong'));
                for (const elem of elements) {
                    const txt = elem.innerText || '';
                    if (txt.toLowerCase().includes('nacimiento') || txt.toLowerCase().includes('fecha nac')) {
                        const mSelf = txt.match(/\d{2}\/\d{2}\/\d{4}/);
                        if (mSelf) return mSelf[0];
                        const next = elem.nextElementSibling;
                        if (next && next.innerText) {
                            const mNext = next.innerText.match(/\d{2}\/\d{2}\/\d{4}/);
                            if (mNext) return mNext[0];
                        }
                    }
                }
                return '';
            }).catch(() => '');
        }

        let edadMeses = null;
        if (fechaNac && datos.fecha) {
            const parseF = (str) => {
                const parts = str.split(/[\/-]/).map(Number);
                if (parts[0] > 1000) return new Date(parts[0], parts[1] - 1, parts[2]);
                return new Date(parts[2], parts[1] - 1, parts[0]);
            };
            const fNac = parseF(fechaNac);
            const fToma = parseF(datos.fecha);
            if (!isNaN(fNac.getTime()) && !isNaN(fToma.getTime())) {
                edadMeses = (fToma.getFullYear() - fNac.getFullYear()) * 12 + (fToma.getMonth() - fNac.getMonth());
                if (fToma.getDate() < fNac.getDate()) edadMeses--;
            }
        }
        if (edadMeses !== null) {
            console.log(c.cyan(`    ℹ️ Edad calculada al momento de la toma: ${edadMeses} meses (${(edadMeses / 12).toFixed(1)} años) [Nac: ${fechaNac || 'N/D'}]`));
        }

        // 4. Lactancia (Verificar y asegurar respuestas completas)
        const esMayor2Anos = (edadMeses !== null && edadMeses >= 24);
        const recibeLeche = esMayor2Anos ? 'No' : 'Si';
        await safeFillSelect('Recibe leche materna?', recibeLeche);
        
        const valExclusiva = esMayor2Anos ? '6' : Math.floor(Math.random() * (7 - 4 + 1) + 4).toString();
        const valTotal = esMayor2Anos ? '12' : Math.floor(Math.random() * (18 - 11 + 1) + 11).toString();
        
        await safeFillText('exclusiva (meses)', valExclusiva);
        await safeFillText('total (meses)', valTotal);
        await safeFillText('Hasta que edad fue alimentado exclusivamente', valExclusiva);
        await safeFillText('A que edad introdujo alimentos diferentes', valTotal);
        
        // ==========================================
        // 5. CAMPOS CONFLICTIVOS (LLENADOS AL FINAL Y MODO NATIVO)
        // ==========================================
        console.log(c.amarillo('\n  ⏳ Esperando 200ms para asegurar que el formulario este estable...'));
        await page.waitForTimeout(200);
        
        console.log(c.amarillo('  🎯 Llenando campos finales con simulacion nativa...'));
        
        f = await getFrame(); // Obtener frame directamente para llamadas de Playwright

        // A0. Vacunación (Asegurar SIEMPRE marcado en Si)
        await asegurarRadioOpcion(page, f, 'rbTieneCarnetVacunacion', 'Si');
        await asegurarRadioOpcion(page, f, 'rbTieneDosisEdad', 'Si');

        // A. Carnet y Controles de crecimiento: Solo si NO tiene historial previo
        if (!hasHistory) {
            console.log(c.cyan('    ℹ️ Nino sin historial previo: asegurando Carnet Crecimiento = Si y Controles = 1...'));
            await asegurarRadioOpcion(page, f, 'rbTieneCarnetCrecimiento', 'Si');
            await page.waitForTimeout(400);
            f = await getFrame();

            try {
                const ddlControles = f.locator('#cphCont_ddlControlesCrecimDesarrollo, select[id*="ddlControlesCrecimDesarrollo"]').first();
                if (await ddlControles.count() > 0) {
                    await ddlControles.waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
                    await ddlControles.selectOption({ label: '1' }).catch(async () => {
                        await ddlControles.selectOption({ value: '1' }).catch(() => {});
                    });
                    console.log(c.verde('    ✅ [Lista] Lleno (modo seguro): controles de crecimiento = 1'));
                }
            } catch(e) {}
            await page.waitForTimeout(100);
        } else {
            console.log(c.cyan('    ℹ️ Beneficiario con tomas previas: No se interviene en carnet de crecimiento ni controles.'));
        }

        // A1. Desnutrición aguda / Canalizado (NO TIENE DESNUTRICION AGUDA) - APLICA SIEMPRE (con o sin historial)
        await asegurarDesnutricion('Nativo');
        await page.waitForTimeout(100);

        // A2. Lactancia (Mayor / Menor 6 meses)
        try {
            const esMenor6Meses = (edadMeses !== null && edadMeses < 6);
            const esMayor2Anos = (edadMeses !== null && edadMeses >= 24);

            const ddlMayor = f.locator('select[id*="ddlRecibeLechaMeternaMayorSeisMesesPI"]').first();
            if (await ddlMayor.count() > 0 && await ddlMayor.isVisible() && !await ddlMayor.isDisabled()) {
                const optMayor = esMayor2Anos ? 'No' : (esMenor6Meses ? 'No' : 'Si');
                await ddlMayor.selectOption({ label: optMayor }, { timeout: 1500 }).catch(()=>{});
                console.log(c.verde(`    ✅ [Lista] Lleno (modo seguro): recibe leche materna (Mayor 6 meses) = ${optMayor}`));
            }
            const ddlMenor = f.locator('select[id*="ddlRecibeLecheMaternaMenorSeisMesesPI"], select[id*="ddlRecibeLechaMaternaMenor"]').first();
            if (await ddlMenor.count() > 0 && await ddlMenor.isVisible() && !await ddlMenor.isDisabled()) {
                const optMenor = esMenor6Meses ? 'Si' : 'No';
                await ddlMenor.selectOption({ label: optMenor }, { timeout: 1500 }).catch(()=>{});
                console.log(c.verde(`    ✅ [Lista] Lleno (modo seguro): recibe leche materna (Menor 6 meses) = ${optMenor}`));
            }
        } catch(e) {}
        await page.waitForTimeout(100);

        // A3. Antecedente de Prematurez (Siempre No)
        await asegurarRadioOpcion(page, f, 'AntecedentePrematurez', 'No');
        await page.waitForTimeout(100);

        // B. Perimetro Braquial (Sincronizar fecha siempre con Fecha de valoracion antropometrica para evitar errores de validacion)
        try {
            const numPb = parseFloat(String(datos.perimetro || '').replace(',', '.'));
            const pbEsValido = !isNaN(numPb) && numPb >= 5.0 && numPb <= 30.0;
            // Normativa ICBF: Perimetro Braquial solo aplica entre 6 y 59 meses de edad (menores de 5 anos)
            const aplicaPerimetro = (edadMeses === null || (edadMeses >= 6 && edadMeses < 60));

            let fechaUso = datos.fecha;

            // Detectar Fecha de Inicio de Atencion en el formulario de Cuentame usando DOM estandar
            const fechaInicioAtencion = await f.evaluate(() => {
                const idEl = document.querySelector('span[id*="lblFechaAtencion"], span[id*="lblFechaIngreso"], span[id*="lblFechaInicio"], span[id*="lblRelacion"]');
                if (idEl && idEl.innerText && /\d{2}\/\d{2}\/\d{4}/.test(idEl.innerText)) {
                    const m = idEl.innerText.match(/\d{2}\/\d{2}\/\d{4}/);
                    if (m) return m[0];
                }
                const elements = Array.from(document.querySelectorAll('td, span, label, b, strong'));
                for (const el of elements) {
                    const txt = el.innerText || '';
                    if (txt.toLowerCase().includes('inicio de atenci') || txt.toLowerCase().includes('inicio atenci') || txt.toLowerCase().includes('relaci')) {
                        const mSelf = txt.match(/\d{2}\/\d{2}\/\d{4}/);
                        if (mSelf) return mSelf[0];
                        const next = el.nextElementSibling;
                        if (next && next.innerText) {
                            const mNext = next.innerText.match(/\d{2}\/\d{2}\/\d{4}/);
                            if (mNext) return mNext[0];
                        }
                    }
                }
                return '';
            }).catch(() => '');

            if (fechaInicioAtencion && /^\d{2}\/\d{2}\/\d{4}$/.test(fechaInicioAtencion) && datos.fecha && /^\d{2}\/\d{2}\/\d{4}$/.test(datos.fecha)) {
                const parseF = (str) => {
                    const [d, m, y] = str.split('/').map(Number);
                    return new Date(y, m - 1, d);
                };
                const fAtencion = parseF(fechaInicioAtencion);
                const fDatos = parseF(datos.fecha);
                if (fDatos < fAtencion) {
                    console.log(c.amarillo(`    ⚠️ Fecha de excel (${datos.fecha}) es anterior a Fecha de inicio de atencion (${fechaInicioAtencion}) → Ajustando fecha a ${fechaInicioAtencion}`));
                    fechaUso = fechaInicioAtencion;
                }
            }

            if (fechaUso && !fechaUso.includes('1900')) {
                await f.evaluate(({ fDate, syncPbDate, childHasHistory }) => {
                    const dateInputSelectors = [
                        '#cphCont_cuwFechaValoracionNuricional_txtFecha',
                        '#cphCont_cuwFechaValoracionNutricional_txtFecha',
                        'input[id*="cuwFechaValoracionNuricional_txtFecha"]',
                        'input[id*="cuwFechaValoracionNutricional_txtFecha"]',
                        'input[id*="cuwFechaValoracion"][id*="txtFecha"]',
                        '#cphCont_cuwFechaVerificaVacunas_txtFecha',
                        'input[id*="cuwFechaVerificaVacunas_txtFecha"]',
                        'input[id*="cuwFechaVerifica"][id*="txtFecha"]'
                    ];
                    if (syncPbDate) {
                        dateInputSelectors.push(
                            '#cphCont_cuwFechaMedicionPerimetroBraquial_txtFecha',
                            'input[id*="cuwFechaMedicionPerimetroBraquial_txtFecha"]',
                            'input[id*="cuwFechaMedicionPerimetro"][id*="txtFecha"]'
                        );
                    }
                    dateInputSelectors.forEach(sel => {
                        const inps = document.querySelectorAll(sel);
                        inps.forEach(inp => {
                            if (inp) {
                                if (!inp.value || inp.value.includes('1900') || inp.value !== fDate) {
                                    inp.value = fDate;
                                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                                    inp.dispatchEvent(new Event('change', { bubbles: true }));
                                    inp.dispatchEvent(new Event('blur', { bubbles: true }));
                                }
                            }
                        });
                    });

                    // Verificacion de seguridad: radios de vacunacion
                    // rbTieneCarnetCrecimiento solo se asegura en "Si" si el niño NO tiene historial previo
                    const listRadios = childHasHistory
                        ? ['rbTieneCarnetVacunacion', 'rbTieneDosisEdad']
                        : ['rbTieneCarnetVacunacion', 'rbTieneDosisEdad', 'rbTieneCarnetCrecimiento'];

                    listRadios.forEach(namePart => {
                        const radios = Array.from(document.querySelectorAll(`input[type="radio"][id*="${namePart}"]`));
                        if (radios.length > 0 && !radios.some(r => r.checked)) {
                            const radioSi = radios.find(r => r.value === '1' || r.id.endsWith('_0')) || radios[0];
                            if (radioSi && !radioSi.disabled) {
                                radioSi.checked = true;
                                radioSi.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        }
                    });

                    // Antecedente de prematurez = No
                    const rbPrem = Array.from(document.querySelectorAll('input[type="radio"][id*="AntecedentePrematurez"]'));
                    if (rbPrem.length > 1 && !rbPrem.some(r => r.checked)) {
                        const radioNo = rbPrem.find(r => r.value === '0' || r.id.endsWith('_1')) || rbPrem[1];
                        if (radioNo && !radioNo.disabled) {
                            radioNo.checked = true;
                            radioNo.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                }, { fDate: fechaUso, syncPbDate: aplicaPerimetro, childHasHistory: hasHistory }).catch(() => {});
                console.log(c.verde(`    ✅ [Texto] Sincronizadas Fechas con Fecha de la Toma Nutricional (${fechaUso})`));
                await page.waitForTimeout(300);
            }

            if (!aplicaPerimetro) {
                console.log(c.gris(`    ℹ️ Perimetro Braquial NO aplica por normativa ICBF (Edad: ${edadMeses !== null ? edadMeses + ' meses' : 'fuera de rango 6-59 meses'}). Se deja vacio.`));
                await f.evaluate(() => {
                    const el = document.querySelector('#cphCont_txtMedicionPerimetroBraquial, input[id*="txtMedicionPerimetroBraquial"]');
                    if (el) el.value = '';
                    const dt = document.querySelector('#cphCont_cuwFechaMedicionPerimetroBraquial_txtFecha, input[id*="cuwFechaMedicionPerimetroBraquial_txtFecha"]');
                    if (dt) dt.value = '';
                }).catch(() => {});
            } else if (datos.perimetro && !pbEsValido) {
                console.log(c.amarillo(`    ⚠️ Perimetro Braquial en Excel ("${datos.perimetro}") esta fuera de rango valido (5-30 cm) → Se omite.`));
            } else if (datos.perimetro && pbEsValido) {
                const pbStr = numPb.toString();
                const inpPb = f.locator('#cphCont_txtMedicionPerimetroBraquial, input[id*="txtMedicionPerimetroBraquial"]').first();
                if (await inpPb.count() > 0 && !await inpPb.isDisabled()) {
                    await inpPb.fill(pbStr).catch(() => {});
                    console.log(c.verde(`    ✅ [Texto] Lleno (modo seguro): Perimetro Braquial = ${pbStr} cm`));
                }
            }
        } catch(e) { 
            console.log(c.rojo('    ❌ [Texto] Error perimetro: ' + e.message.substring(0, 50))); 
        }
        await page.waitForTimeout(200);

        // C. Mujer gestante atendida (Siempre marcar No)
        try {
            await f.selectOption('#cphCont_ddlHijoMujerGestanteAtendidaServiciosICBF', { label: 'No' }, { timeout: 1500 });
            console.log(c.verde('    ✅ [Lista] Lleno (modo seguro): mujer gestante atendida = No'));
        } catch(e) {}
        await page.waitForTimeout(100);

        // 4. Salvaguarda final: Re-asegurar que Peso, Talla, Fecha y Desnutrición queden firmes antes de guardar
        await asegurarAntropometria('Final');
        await asegurarDesnutricion('Final');
        await page.waitForTimeout(200);
        
        console.log(c.verde('\n  ✅ Llenado automatico completado!'));
        console.log(c.amarillo('  ⚠️ Revisa los datos en la pantalla y selecciona la opcion de guardado en la consola.'));
        
    } catch(e) {
        console.log(c.rojo(`  ❌ Error llenando Cuentame: ${e.message}`));
    }
}

module.exports = {
    parsearFecha,
    llenarFormularioNutricion,
    asegurarDesnutricionAguda
};
