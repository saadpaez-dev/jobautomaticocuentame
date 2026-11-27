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
    
    // Si viene en formato DD/MM/YYYY o D/M/YYYY
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(txt)) {
        const p = txt.split(/[\/\-]/);
        return `${p[0].padStart(2, '0')}/${p[1].padStart(2, '0')}/${p[2]}`;
    }
    
    // Si viene en formato YYYY-MM-DD o YYYY/MM/DD
    if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(txt)) {
        const p = txt.split(/[\/\-]/);
        return `${p[2].padStart(2, '0')}/${p[1].padStart(2, '0')}/${p[0]}`;
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

// Caché global de valores de lactancia para que todas las etapas usen exactamente los mismos números
let globalLactanciaValores = null;

async function asegurarRadiosSaludYDesarrollo(page, frame) {
    const framesToCheck = [];
    if (frame) framesToCheck.push(frame);
    if (page && page.frames) {
        for (const f of page.frames()) {
            if (!framesToCheck.includes(f)) framesToCheck.push(f);
        }
    }
    if (framesToCheck.length === 0 && page) framesToCheck.push(page);

    // 1. Clics con Playwright para disparar eventos nativos de ASP.NET
    if (frame) {
        try {
            // Carnet de vacunacion -> Si (dispara updatepanel si aplica)
            const locVac = frame.locator('input[type="radio"][id*="CarnetVacun" i][id$="_0"], input[type="radio"][name*="CarnetVacun" i][value="1"], input[type="radio"][id*="Vacun" i][id$="_0"]').first();
            if (await locVac.count() > 0 && !await locVac.isChecked().catch(() => false)) {
                await locVac.check({ force: true }).catch(async () => { await locVac.click({ force: true }); });
                await page.waitForTimeout(250);
            }
            // Dosis al dia -> Si
            const locDosis = frame.locator('input[type="radio"][id*="Dosis" i][id$="_0"], input[type="radio"][name*="Dosis" i][value="1"]').first();
            if (await locDosis.count() > 0 && !await locDosis.isChecked().catch(() => false)) {
                await locDosis.check({ force: true }).catch(async () => { await locDosis.click({ force: true }); });
            }
            // Crecimiento y desarrollo -> Si
            const locCrec = frame.locator('input[type="radio"][id*="CarnetCrecim" i][id$="_0"], input[type="radio"][name*="CarnetCrecim" i][value="1"], input[type="radio"][id*="Crecim" i][id$="_0"]').first();
            if (await locCrec.count() > 0 && !await locCrec.isChecked().catch(() => false)) {
                await locCrec.check({ force: true }).catch(async () => { await locCrec.click({ force: true }); });
            }
            // Prematurez -> No siempre
            const locPrem = frame.locator('input[type="radio"][id*="Prematur" i][id$="_1"], input[type="radio"][name*="Prematur" i][value="0"]').first();
            if (await locPrem.count() > 0 && !await locPrem.isChecked().catch(() => false)) {
                await locPrem.check({ force: true }).catch(async () => { await locPrem.click({ force: true }); });
            }
        } catch(e) {}
    }

    // 2. Verificación y asignación exhaustiva en DOM (por Name, ID y Texto de fila)
    for (const frm of framesToCheck) {
        try {
            await frm.evaluate(() => {
                const normalize = str => (str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, ' ');

                function marcar(radios, esSi) {
                    if (!radios || radios.length < 2) return false;
                    const rTarget = radios.find(r => esSi 
                        ? (r.value === '1' || r.value.toLowerCase() === 'si' || r.id.endsWith('_0'))
                        : (r.value === '0' || r.value.toLowerCase() === 'no' || r.id.endsWith('_1'))
                    ) || radios[esSi ? 0 : 1];
                    if (rTarget && !rTarget.disabled) {
                        rTarget.checked = true;
                        rTarget.click();
                        rTarget.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                    return false;
                }

                // A. Agrupados por nombre / ID
                const todos = Array.from(document.querySelectorAll('input[type="radio"]'));
                const grupos = {};
                todos.forEach(r => {
                    const key = r.name || r.id.replace(/_\d+$/, '');
                    if (!grupos[key]) grupos[key] = [];
                    grupos[key].push(r);
                });

                Object.keys(grupos).forEach(k => {
                    const kl = k.toLowerCase();
                    if (kl.includes('vacun')) marcar(grupos[k], true);
                    if (kl.includes('dosis')) marcar(grupos[k], true);
                    if (kl.includes('crecim')) marcar(grupos[k], true);
                    if (kl.includes('prematur')) marcar(grupos[k], false);
                });

                // B. Búsqueda por texto visible de la fila
                const filas = Array.from(document.querySelectorAll('tr, .form-group, table'));
                for (const fila of filas) {
                    const txt = normalize(fila.innerText);
                    if (!txt || txt.length > 350) continue;
                    const rds = Array.from(fila.querySelectorAll('input[type="radio"]'));
                    if (rds.length < 2) continue;

                    if (txt.includes('cuenta con el carnet de vacunacion') || txt.includes('carnet de vacunacion?')) {
                        marcar(rds, true);
                    } else if (txt.includes('dosis que corresponden') || txt.includes('se encuentra al dia')) {
                        marcar(rds, true);
                    } else if (txt.includes('carnet de crecimiento y desarrollo')) {
                        marcar(rds, true);
                    } else if (txt.includes('antecedente de prematurez') || txt.includes('prematurez')) {
                        marcar(rds, false);
                    }
                }

                // C. Controles de crecimiento = 1
                const ddlControles = document.querySelector('select[id*="ControlesCrecim" i], select[id*="Controles" i]');
                if (ddlControles && (!ddlControles.value || ddlControles.value === '0' || ddlControles.value === '')) {
                    const opt1 = Array.from(ddlControles.options).find(o => o.text.trim() === '1' || o.value === '1');
                    if (opt1) {
                        ddlControles.value = opt1.value;
                        ddlControles.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            });
        } catch(e) {}
    }
}

async function asegurarRadioOpcion(page, frame, idPattern, valorDeseado) {
    const isSi = (String(valorDeseado).toLowerCase() === 'si' || valorDeseado === '1');
    const suffix = isSi ? '_0' : '_1';
    const targetVal = isSi ? '1' : '0';

    try {
        const locators = [
            frame.locator(`input[type="radio"][id*="${idPattern}"][id$="${suffix}"]`).first(),
            frame.locator(`input[type="radio"][id*="${idPattern}"][value="${targetVal}"]`).first(),
            frame.locator(`input[type="radio"][id*="${idPattern}"][value="${valorDeseado}"]`).first(),
            frame.locator(`input[type="radio"][id*="${idPattern}" i][id$="${suffix}"]`).first(),
            frame.locator(`input[type="radio"][id*="${idPattern}" i][value="${targetVal}"]`).first()
        ];

        for (const loc of locators) {
            if (await loc.count() > 0 && !await loc.isDisabled().catch(() => false)) {
                const isChecked = await loc.isChecked().catch(() => false);
                if (!isChecked) {
                    await loc.check({ force: true }).catch(async () => {
                        await loc.click({ force: true });
                    });
                }
                break;
            }
        }

        await frame.evaluate(({ idPattern, isSi, targetVal }) => {
            const patternNorm = idPattern.toLowerCase();
            const radios = Array.from(document.querySelectorAll('input[type="radio"]')).filter(r => {
                const id = (r.id || '').toLowerCase();
                const name = (r.name || '').toLowerCase();
                return id.includes(patternNorm) || name.includes(patternNorm);
            });
            if (radios.length > 0) {
                const target = radios.find(r => isSi ? (r.value === '1' || r.id.endsWith('_0')) : (r.value === '0' || r.id.endsWith('_1'))) || radios[isSi ? 0 : 1];
                if (target && !target.disabled && !target.checked) {
                    target.checked = true;
                    target.click();
                    target.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        }, { idPattern, isSi, targetVal }).catch(() => {});
    } catch(e) {}
}

async function asegurarLactanciaCampos(page, frame, etapa = 'General', valores = null) {
    const framesToCheck = [];
    if (frame) framesToCheck.push(frame);
    if (page && page.frames) {
        for (const f of page.frames()) {
            if (!framesToCheck.includes(f)) framesToCheck.push(f);
        }
    }
    if (framesToCheck.length === 0 && page) framesToCheck.push(page);

    if (valores && valores.valExclusiva && valores.valTotal) {
        globalLactanciaValores = valores;
    } else if (!globalLactanciaValores) {
        globalLactanciaValores = {
            valExclusiva: String(Math.floor(Math.random() * (6 - 4 + 1)) + 4), // 4 a 6 (mismo número)
            valTotal: String(Math.floor(Math.random() * (15 - 11 + 1)) + 11)   // 11 a 15 (mismo número)
        };
    }

    const { valExclusiva, valTotal } = globalLactanciaValores;

    for (const frm of framesToCheck) {
        try {
            const res = await frm.evaluate(({ vExc, vTot }) => {
                function setInp(inp, val) {
                    if (!inp || inp.disabled) return false;
                    inp.value = val;
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                    inp.dispatchEvent(new Event('change', { bubbles: true }));
                    inp.dispatchEvent(new Event('blur', { bubbles: true }));
                    return true;
                }

                let count = 0;

                // 1. Inputs por ID
                document.querySelectorAll('input[id*="Exclusiva" i], input[id*="exclusiv" i]').forEach(i => { if (setInp(i, vExc)) count++; });
                document.querySelectorAll('input[id*="Alimentado" i], input[id*="HastaQueEdad" i]').forEach(i => { if (setInp(i, vExc)) count++; });
                document.querySelectorAll('input[id*="Introdujo" i], input[id*="Alimentos" i]').forEach(i => { if (setInp(i, vTot)) count++; });
                document.querySelectorAll('input[id*="LactanciaMaternaTotal" i]').forEach(i => { if (setInp(i, vTot)) count++; });
                document.querySelectorAll('input[id*="Total" i]').forEach(i => {
                    const idLow = i.id.toLowerCase();
                    if (idLow.includes('total') && !idLow.includes('perimetro') && !idLow.includes('peso') && !idLow.includes('talla')) {
                        if (setInp(i, vTot)) count++;
                    }
                });

                // 2. Inputs por proximidad textual (buscar en td/div/tr)
                const normalize = str => (str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, ' ');
                const allTextContainers = Array.from(document.querySelectorAll('tr, .form-group, td'));
                
                for (const el of allTextContainers) {
                    const txt = normalize(el.innerText);
                    if (!txt || txt.length > 300) continue;

                    // Campo 1: Duracion lactancia materna exclusiva (4-6)
                    if (txt.includes('duracion lactancia materna exclusiva')) {
                        const inp = el.querySelector('input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"])');
                        if (inp) { if (setInp(inp, vExc)) count++; }
                    }

                    // Campo 2: Hasta que edad fue alimentado exclusivamente (debe ser el MISMO 4-6)
                    if (txt.includes('hasta que edad fue alimentado') || (txt.includes('alimentado exclusivamente') && !txt.includes('duracion lactancia'))) {
                        const inp = el.querySelector('input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"])');
                        if (inp) { if (setInp(inp, vExc)) count++; }
                    }

                    // Campo 3: A que edad introdujo alimentos diferentes (11-15)
                    if (txt.includes('introdujo alimentos diferentes') || txt.includes('alimentos diferentes a la leche')) {
                        const inp = el.querySelector('input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"])');
                        if (inp) { if (setInp(inp, vTot)) count++; }
                    }

                    // Campo 4: Duracion lactancia materna total (debe ser el MISMO 11-15)
                    if (txt.includes('duracion lactancia materna total') || txt.includes('lactancia materna total') || txt.includes('lactancia total')) {
                        const inp = el.querySelector('input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"])');
                        if (inp) { if (setInp(inp, vTot)) count++; }
                    }
                }

                // 3. Dropdown "¿Recibe leche materna?" (Mantener "Si" o seleccionar "Si")
                const allSelects = Array.from(document.querySelectorAll('select'));
                for (const sel of allSelects) {
                    const idLow = sel.id.toLowerCase();
                    const txtParent = normalize(sel.closest('tr') ? sel.closest('tr').innerText : (sel.parentElement ? sel.parentElement.innerText : ''));
                    if (idLow.includes('recibeleche') || idLow.includes('lechamaterna') || txtParent.includes('recibe leche materna')) {
                        const opts = Array.from(sel.options);
                        const optSi = opts.find(o => normalize(o.text) === 'si' || o.value === '1');
                        if (optSi && sel.value !== optSi.value) {
                            sel.value = optSi.value;
                            if (typeof sel.onchange === 'function') { try { sel.onchange(); } catch(e) {} }
                            sel.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                }

                return { count, vExc, vTot };
            }, { vExc: valExclusiva, vTot: valTotal }).catch(() => null);

            if (res && res.count > 0) {
                console.log(c.verde(`    ✅ [Lactancia - ${etapa}] Exclusiva/Alimentado = ${res.vExc} meses | Alimentos/Total = ${res.vTot} meses (${res.count} campos asignados)`));
                return true;
            }
        } catch(e) {}
    }
    return false;
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
            const currentEpsVal = await selectEps.evaluate(el => el.selectedOptions[0] ? el.selectedOptions[0].text : '').catch(() => '');
            const necesitaEps = !currentEpsVal || currentEpsVal.includes('Seleccione') || currentEpsVal.trim() === '';
            
            if (necesitaEps) {
                // Solo si necesita seleccionar EPS, esperar brevemente a que las opciones carguen
                await f.waitForFunction((el) => {
                    return el && el.options && (el.options.length > 1 || (el.options.length === 1 && el.options[0].value !== ''));
                }, await selectEps.elementHandle().catch(() => null), { timeout: 2000 }).catch(() => {});
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
            
            if (found) {
                console.log(c.verde(`    ✅ [Texto] Lleno: ${labelText}`));
                await page.waitForTimeout(50); // Breve espera solo si se diligenció el campo
            } else {
                console.log(c.rojo(`    ❌ [Texto] NO encontrado/deshabilitado: ${labelText}`));
            }
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
            
            if (found) {
                console.log(c.verde(`    ✅ [Lista] Lleno: ${labelText}`));
                await page.waitForTimeout(80); // Esperar si hay postback ligero
            } else {
                console.log(c.rojo(`    ❌ [Lista] NO encontrado/deshabilitado: ${labelText}`));
            }
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
                if (e.message.includes('Execution context was destroyed') || e.message.includes('Session closed')) {
                    found = true;
                }
            }
            
            if (found) {
                console.log(c.verde(`    ✅ [Opcion] Lleno: ${labelText}`));
                await page.waitForTimeout(80); // Darle tiempo ligero al UpdatePanel solo si hizo click
            } else {
                console.log(c.rojo(`    ❌ [Opcion] NO encontrado/deshabilitado: ${labelText}`));
            }
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

        // Helper robusto e instantáneo para asegurar que Peso, Talla, Fecha y Desnutrición Aguda queden diligenciados inmediatamente en el DOM
        const asegurarAntropometria = async (etapa = 'Inicial') => {
            const frm = await getFrame();
            const pesoVal = String(datos.peso || '').trim().replace(',', '.');
            const tallaVal = String(datos.talla || '').trim().replace(',', '.');
            const fechaVal = String(datos.fecha || '').trim();

            if (!pesoVal && !tallaVal) {
                console.log(c.amarillo(`    ⚠️ [Antropometría - ${etapa}]: Sin valores de peso/talla en el registro.`));
                return;
            }

            // Asignación DOM directa e instantánea (< 5ms) para Peso, Talla, Fecha y Desnutrición Aguda
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

                    // 1. Input Peso
                    let inpPeso = document.querySelector('#cphCont_txtPeso, input[id*="txtPeso"], input[name*="txtPeso"], input[id*="Peso" i], input[name*="Peso" i]');
                    if (inpPeso && p) setVal(inpPeso, p);

                    // 2. Input Talla
                    let inpTalla = document.querySelector('#cphCont_txtTalla, input[id*="txtTalla"], input[name*="txtTalla"], input[id*="Talla" i], input[name*="Talla" i]');
                    if (inpTalla && t) setVal(inpTalla, t);

                    // 3. Input Fecha
                    let inpFecha = document.querySelector('#cphCont_cuwFechaValoracionNuricional_txtFecha, #cphCont_cuwFechaValoracionNutricional_txtFecha, input[id*="cuwFechaValoracion"][id*="txtFecha"], input[id*="txtFechaValoracion"]');
                    if (inpFecha && f) setVal(inpFecha, f);

                    // 4. Seleccionar de inmediato "NO TIENE DESNUTRICIÓN AGUDA" en el dropdown
                    let desnutricionText = '';
                    const allSelects = Array.from(document.querySelectorAll('select'));
                    for (const sel of allSelects) {
                        const opts = Array.from(sel.options);
                        const idx = opts.findIndex(o => (o.text || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().includes('NO TIENE DESNUTRICI'));
                        if (idx !== -1) {
                            opts.forEach((o, i) => { o.selected = (i === idx); });
                            sel.selectedIndex = idx;
                            sel.value = opts[idx].value;
                            if (typeof sel.onchange === 'function') { try { sel.onchange(); } catch(e) {} }
                            sel.dispatchEvent(new Event('input', { bubbles: true }));
                            sel.dispatchEvent(new Event('change', { bubbles: true }));
                            sel.dispatchEvent(new Event('blur', { bubbles: true }));
                            desnutricionText = opts[idx].text.trim();
                            break;
                        }
                    }

                    return { 
                        pesoFinal: inpPeso ? inpPeso.value : p, 
                        tallaFinal: inpTalla ? inpTalla.value : t,
                        fechaFinal: inpFecha ? inpFecha.value : f,
                        desnutricion: desnutricionText
                    };
                }, { p: pesoVal, t: tallaVal, f: fechaVal });

                console.log(c.verde(`    ✅ [Antropometría - ${etapa}]: Peso = ${resEval?.pesoFinal || pesoVal} kg | Talla = ${resEval?.tallaFinal || tallaVal} cm | Fecha = ${resEval?.fechaFinal || fechaVal}${resEval?.desnutricion ? ` | Desnutrición = "${resEval.desnutricion}"` : ''}`));
            } catch(e) {
                console.log(c.rojo(`    ❌ [Antropometría - ${etapa}] Error: ${e.message}`));
            }
        };

        const asegurarDesnutricion = async (etapa = 'Inicial') => {
            const frm = await getFrame();
            return await asegurarDesnutricionAguda(page, frm, etapa);
        };

        // 2. Antropometria principales + Desnutrición Aguda (INMEDIATO)
        await safeFillText('Peso (En Kilogramos)', datos.peso);
        await safeFillText('Talla (En Cent', datos.talla);
        await safeFillText('Fecha de valoracion', datos.fecha);
        await asegurarAntropometria('Inicial');
        await asegurarDesnutricion('Inicial');
        
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
        await asegurarRadiosSaludYDesarrollo(page, f);
        await page.waitForTimeout(200);
        
        await safeFillText('esquema de vacunacion', datos.fecha);
        await safeFillRadio('dosis que corresponden a la edad', 'Si', 0);
        
        // 1.2 Carnet de crecimiento y desarrollo: SIEMPRE SI PARA TODOS
        await safeFillRadio('carnet de crecimiento y desarrollo', 'Si', 0);
        await page.waitForTimeout(100);
        await safeFillSelect('controles de crecimiento y desarrollo', '1');

        // 1.1 Antecedente de prematurez: Cuentame a veces lo habilita, siempre debe ser "No".
        await safeFillRadio('Antecedente de prematurez', 'No', 1);

        // 3. Situaciones adicionales (Desnutrición Aguda / Canalizado directo)
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

        // 4. Lactancia: 4 a 6 (exclusiva / alimentado) y 11 a 15 (alimentos diferentes / total) - PARES IDÉNTICOS
        const valExclusiva = (datos._lactanciaValores && datos._lactanciaValores.valExclusiva) 
            || String(Math.floor(Math.random() * (6 - 4 + 1)) + 4);
        const valTotal = (datos._lactanciaValores && datos._lactanciaValores.valTotal) 
            || String(Math.floor(Math.random() * (15 - 11 + 1)) + 11);
        datos._lactanciaValores = { valExclusiva, valTotal };
        
        await safeFillText('exclusiva (meses)', valExclusiva);
        await safeFillText('Hasta que edad fue alimentado', valExclusiva);
        await safeFillText('introdujo alimentos diferentes', valTotal);
        await safeFillText('total (meses)', valTotal);
        await asegurarLactanciaCampos(page, f, 'Intermedio', datos._lactanciaValores);
        
        // ==========================================
        // 5. CAMPOS CONFLICTIVOS (LLENADOS AL FINAL Y MODO NATIVO)
        // ==========================================
        console.log(c.amarillo('\n  ⏳ Esperando 200ms para asegurar que el formulario este estable...'));
        await page.waitForTimeout(200);
        
        console.log(c.amarillo('  🎯 Llenando campos finales con simulacion nativa...'));
        
        f = await getFrame(); // Obtener frame directamente para llamadas de Playwright

        // A0. Vacunación y Crecimiento (Asegurar SIEMPRE marcados en Si para TODOS, Prematurez en No)
        await asegurarRadiosSaludYDesarrollo(page, f);
        await page.waitForTimeout(200);
        f = await getFrame();

        try {
            const ddlControles = f.locator('#cphCont_ddlControlesCrecimDesarrollo, select[id*="ddlControlesCrecimDesarrollo"], select[id*="Controles"]').first();
            if (await ddlControles.count() > 0 && !await ddlControles.isDisabled().catch(() => false)) {
                await ddlControles.selectOption({ label: '1' }).catch(async () => {
                    await ddlControles.selectOption({ value: '1' }).catch(() => {});
                });
                console.log(c.verde('    ✅ [Lista] Lleno (modo seguro): controles de crecimiento = 1'));
            }
        } catch(e) {}
        await page.waitForTimeout(100);

        // A1. Desnutrición aguda / Canalizado (NO TIENE DESNUTRICION AGUDA) - APLICA SIEMPRE
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
        await asegurarRadioOpcion(page, f, 'Prematur', 'No');
        await page.waitForTimeout(100);

        // B. Perimetro Braquial (Sincronizar fecha siempre con Fecha de valoracion antropometrica para evitar errores de validacion)
        try {
            const numPb = parseFloat(String(datos.perimetro || '').replace(',', '.'));
            const pbEsValido = !isNaN(numPb) && numPb >= 5.0 && numPb <= 30.0;
            const aplicaPerimetro = (edadMeses === null || (edadMeses >= 6 && edadMeses < 60));

            let fechaUso = parsearFecha(datos.fecha) || datos.fecha;

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

            if (fechaInicioAtencion && datos.fecha) {
                const parseF = (str) => {
                    const m = String(str).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
                    if (!m) return null;
                    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
                };
                const fAtencion = parseF(fechaInicioAtencion);
                const fDatos = parseF(fechaUso);
                if (fAtencion && fDatos && fDatos < fAtencion) {
                    console.log(c.amarillo(`    ⚠️ Fecha de excel (${fechaUso}) es anterior a Fecha de inicio de atencion (${fechaInicioAtencion}) → Ajustando fecha a ${fechaInicioAtencion}`));
                    fechaUso = fechaInicioAtencion;
                }
            }

            if (fechaUso && !fechaUso.includes('1900')) {
                await f.evaluate(({ fDate }) => {
                    // TODOS los campos de fecha deben tener exactamente la misma fecha
                    const dateInputSelectors = [
                        '#cphCont_cuwFechaValoracionNuricional_txtFecha',
                        '#cphCont_cuwFechaValoracionNutricional_txtFecha',
                        'input[id*="cuwFechaValoracionNuricional_txtFecha"]',
                        'input[id*="cuwFechaValoracionNutricional_txtFecha"]',
                        'input[id*="cuwFechaValoracion"][id*="txtFecha"]',
                        'input[id*="txtFechaValoracion"]',
                        '#cphCont_cuwFechaVerificaVacunas_txtFecha',
                        'input[id*="cuwFechaVerificaVacunas_txtFecha"]',
                        'input[id*="cuwFechaVerifica"][id*="txtFecha"]',
                        '#cphCont_cuwFechaMedicionPerimetroBraquial_txtFecha',
                        'input[id*="cuwFechaMedicionPerimetroBraquial_txtFecha"]',
                        'input[id*="cuwFechaMedicionPerimetro"][id*="txtFecha"]'
                    ];

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

                    // Búsqueda complementaria de cualquier input de fecha
                    const allDateInputs = Array.from(document.querySelectorAll('input[id*="txtFecha"], input[name*="txtFecha"], input[id*="cuwFecha"]'));
                    allDateInputs.forEach(inp => {
                        if (!inp.value || inp.value.includes('1900') || inp.value !== fDate) {
                            inp.value = fDate;
                            inp.dispatchEvent(new Event('input', { bubbles: true }));
                            inp.dispatchEvent(new Event('change', { bubbles: true }));
                            inp.dispatchEvent(new Event('blur', { bubbles: true }));
                        }
                    });

                }, { fDate: fechaUso }).catch(() => {});
                console.log(c.verde(`    ✅ [Texto] Sincronizadas Fechas con Fecha de la Toma Nutricional (${fechaUso})`));
                await asegurarRadiosSaludYDesarrollo(page, f);
                await page.waitForTimeout(300);
            }

            if (!aplicaPerimetro) {
                console.log(c.gris(`    ℹ️ Perimetro Braquial NO aplica por normativa ICBF (Edad: ${edadMeses !== null ? edadMeses + ' meses' : 'fuera de rango 6-59 meses'}). Se deja valor vacio, pero manteniendo fecha sincronizada.`));
                await f.evaluate(() => {
                    const el = document.querySelector('#cphCont_txtMedicionPerimetroBraquial, input[id*="txtMedicionPerimetroBraquial"]');
                    if (el) el.value = '';
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

        // 4. Salvaguarda final: Re-asegurar que Peso, Talla, Fecha, Radios, Desnutrición y Lactancia queden firmes antes de guardar
        await asegurarAntropometria('Final');
        await asegurarDesnutricion('Final');
        await asegurarRadiosSaludYDesarrollo(page, f);
        await asegurarLactanciaCampos(page, f, 'Final', datos._lactanciaValores);
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
    asegurarDesnutricionAguda,
    asegurarLactanciaCampos,
    asegurarRadiosSaludYDesarrollo
};
