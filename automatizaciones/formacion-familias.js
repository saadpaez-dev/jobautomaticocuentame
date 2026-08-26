/**
 * formacion-familias.js
 * Bot principal para automatizar el registro de Formacion a Familias
 * en el sistema Cuentame - ICBF.
 *
 * Uso: npm run formacion
 */

require('dotenv').config();
const readline = require('readline-sync');
const fs = require('fs');
const path = require('path');

const { leerJardines } = require('../servicios/excel-reader');
const { loginYLlegarARoles, obtenerNavegador, validarYCambiarAsociacion, verificarConexionOCaida, expandirMenu } = require('../servicios/autenticacion');
const { seleccionarUnidad } = require('../servicios/lupa-unidad');

// ─────────────────────────────────────────────────────────────
// Colores en terminal
// ─────────────────────────────────────────────────────────────
const c = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
  rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
  gris:     (t) => `\x1b[90m${t}\x1b[0m`,
  negrita:  (t) => `\x1b[1m${t}\x1b[0m`,
};

const removeAccentsStr = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();

// ─────────────────────────────────────────────────────────────
// Constantes del formulario
// ─────────────────────────────────────────────────────────────
const TEMAS_FORMACION = [
  'SENTIDO DE LA EDUCACION INICIAL.',
  'CONCEPCION DE FAMILIA, DESARROLLO, NINA Y NINO',
  'CUIDADO SENSIBLE Y HUMANIZADO DESDE LA GESTACION, PARTO Y EL POSPARTO',
  'CRIANZAS CORRESPONSABLES.',
  'PREVENCION DE VIOLENCIAS',
  'PREVENCION DE VIOLENCIAS BASADAS EN GENERO DESDE LA GESTACION',
  'GESTION DE RIESGO DE ACCIDENTES Y DESASTRES',
  'PREVENCION DE ENFERMEDADES PREVALENTES EN PRIMERA INFANCIA.',
  'PRACTICAS DE CUIDADO Y CONSUMO DE ALIMENTACION SALUDABLE, NATURAL, MINIMAMENTE PROCESADA, VARIADA Y CULTURALMENTE ADECUADA',
  'PROMOCION DE LACTANCIA HUMANA COMO PRIMER ACTO DE SOBERANIA ALIMENTARIA.',
  'IDENTIFICACION DE SIGNOS ALARMA EN LA SALUD DE MUJERES Y PERSONAS EN GESTACION NINAS Y NINOS',
];

const TIPO_ENCUENTRO  = 'Encuentro educativo en el hogar';
const HORAS_FORMACION = '1';
const OBSERVACIONES_DEFAULT =
  'SIENDO LAS 17 HORAS SE DA INICIO A FORMACION A FAMILIAS EN LA UNIDAD DE SERVICIO, QUE FINALIZA SIN NOVEDAD ALGUNA';

const URL_FORMACION =
  'https://rubonline.icbf.gov.co/General/General/Master/MasterPrincipal.aspx';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function fechaHoy() {
  const hoy = new Date();
  const d = String(hoy.getDate()).padStart(2, '0');
  const m = String(hoy.getMonth() + 1).padStart(2, '0');
  const y = hoy.getFullYear();
  return `${d}/${m}/${y}`;
}

function guardarLog(resultado) {
  const dir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `formacion-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(archivo, JSON.stringify(resultado, null, 2), 'utf8');
  return archivo;
}

// ─────────────────────────────────────────────────────────────
// Configuracion inicial de Observaciones
// ─────────────────────────────────────────────────────────────
function configurarObservaciones() {
  console.clear();
  console.log(c.negrita(c.verde(`
╔══════════════════════════════════════════════════════════╗
║     🤖 BOT FORMACION A FAMILIAS - Sistema Cuentame       ║
║                    ICBF Colombia                         ║
╚══════════════════════════════════════════════════════════╝
`)));

  const hoy = fechaHoy();
  console.log(c.cyan(`  📅 Fecha de formacion: ${c.negrita(hoy)} (fecha de hoy)\n`));

  console.log(c.amarillo('  📝 OBSERVACIONES (texto que se repite en los registros):'));
  console.log(c.gris(`     Por defecto: "${OBSERVACIONES_DEFAULT}"`));
  const cambiarObs = readline.keyInYN('  Quieres cambiar el texto de observaciones?');
  const observaciones = cambiarObs
    ? readline.question('  Escribe el nuevo texto de observaciones: ').trim() || OBSERVACIONES_DEFAULT
    : OBSERVACIONES_DEFAULT;

  return { hoy, observaciones };
}

// ─────────────────────────────────────────────────────────────
// Registro de UN jardin
// ─────────────────────────────────────────────────────────────
async function registrarFormacion(page, jardin, config, opcionesProcesamiento) {
  const { hoy, observaciones } = config;
  const { tema, procesarTodosNinos } = opcionesProcesamiento;

  await verificarConexionOCaida(page);

  // Ir al MasterPrincipal si no lo estamos
  if (!page.url().includes('MasterPrincipal')) {
      await page.goto(URL_FORMACION, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
  }

  // Identificar el frame del menu
  let rootMenu = page.frame({ name: 'frameMenu' }) || page.frame({ name: 'Opciones' }) || page;
  
  console.log('  \x1b[33m% Desplegando menus "Rub online" y "Beneficiario"...\x1b[0m');
  await expandirMenu(page, ['Rub online', 'Beneficiario']);
  
  console.log('  \x1b[33m% Clic en "Seguimiento formacion a padres/cuidadores"...\x1b[0m');
  await rootMenu.evaluate(() => {
      const normalize = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const links = Array.from(document.querySelectorAll('a'));
      const target = links.find(l => normalize(l.innerText).includes('seguimiento formacion a padres'));
      if (target) target.click();
  }).catch(()=>{});
  await page.waitForTimeout(800);
  await page.waitForTimeout(800);

  const frame = page.frameLocator('iframe').last();

  console.log('  👉 Clic en el boton Nuevo (+)...');
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    frame.locator('#btnNuevo, input[type="image"][src*="nuevo"], input[type="image"][title*="Nuevo"]').first().click()
  ]);
  await page.waitForTimeout(800);

  console.log(`  👉 Buscando UDS: ${jardin.nombre}...`);
  await seleccionarUnidad(page, frame, jardin.codigo);
  await page.waitForTimeout(800);

  console.log('  👉 Esperando a que cargue el resto de campos (Observaciones, Beneficiarios)...');
  const campoObsParaVerificar = frame.locator('textarea[id*="Observaciones"], textarea[name*="Observaciones"]').first();
  await campoObsParaVerificar.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
    throw new Error('No se cargaron los campos finales despues de seleccionar la Unidad de Servicio.');
  });

  const campoFechaFormacion = frame.locator('input[id*="FechaFormacion"], input[name*="FechaFormacion"]').first();
  await campoFechaFormacion.click({ position: { x: 5, y: 5 } });
  await campoFechaFormacion.clear().catch(() => {});
  const numerosFecha = hoy.replace(/\//g, '');
  await campoFechaFormacion.pressSequentially(numerosFecha, { delay: 100 });
  await campoFechaFormacion.press('Tab');
  await page.waitForTimeout(800);

  const campoHoras = frame.locator('input[id*="Horas"], input[name*="Horas"]').first();
  await campoHoras.clear().catch(() => {});
  await campoHoras.fill(HORAS_FORMACION);
  await page.waitForTimeout(800);

  const dropdownEncuentro = frame.locator('select[id*="TipoEncuentro"], select[id*="Encuentro"], select[name*="Encuentro"]').first();
  const valEncuentro = await dropdownEncuentro.evaluate((select, lbl) => {
      const normalize = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const targetOpt = Array.from(select.options).find(o => normalize(o.text).includes(normalize(lbl).trim()));
      return targetOpt ? targetOpt.value : null;
  }, TIPO_ENCUENTRO).catch(() => null);
  
  if (valEncuentro) {
      await dropdownEncuentro.selectOption({ value: valEncuentro }, { timeout: 10000 }).catch(e => console.log('    [Info] Tipo de Encuentro select timeout/detach (PostBack)'));
  } else {
      await dropdownEncuentro.selectOption({ label: TIPO_ENCUENTRO }, { timeout: 10000 }).catch(e => {});
  }
  await page.waitForTimeout(800);

  const campoObs = frame.locator('textarea[id*="Observaciones"], textarea[name*="Observaciones"]').first();
  await campoObs.fill(observaciones);
  await page.waitForTimeout(800);

  const dropdownTema = frame.locator('select[id*="Tema"], select[name*="Tema"]').first();
  const valTema = await dropdownTema.evaluate((select, lbl) => {
      const normalize = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const targetTxt = normalize(lbl).substring(0, 20).trim();
      const targetOpt = Array.from(select.options).find(o => normalize(o.text).includes(targetTxt));
      return targetOpt ? targetOpt.value : null;
  }, tema).catch(() => null);

  if (valTema) {
      await dropdownTema.selectOption({ value: valTema }, { timeout: 10000 }).catch(e => console.log('    [Info] Tema select timeout/detach (PostBack)'));
  } else {
      await dropdownTema.selectOption({ label: tema }, { timeout: 10000 }).catch(e => {});
  }
  await page.waitForTimeout(800); // Reducido a peticion del usuario

  let cantidadBenef = 0;

  if (procesarTodosNinos) {
    const checkboxTodos = frame.locator('input[type="checkbox"]').first();
    const estaChecked = await checkboxTodos.isChecked().catch(() => false);
    if (!estaChecked) {
      await checkboxTodos.click();
      await page.waitForTimeout(800);
    }
    cantidadBenef = 'TODOS';
  } else {
    console.log(c.cyan('\n    Leyendo lista de beneficiarios en la tabla...'));
    const filasNinos = await frame.locator('tr:has(input[type="checkbox"])').all();
    
    const listaNinos = [];
    for (let j = 0; j < filasNinos.length; j++) {
        const rowText = await filasNinos[j].innerText();
        const textoLimpio = rowText.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim(); 
        
        if (textoLimpio && textoLimpio.length > 5 && !textoLimpio.toLowerCase().includes('tipo documento')) {
            const cells = await filasNinos[j].locator(':scope > td').all();
            let docNum = '';
            let nombreLimpio = '';
            
            if (cells.length >= 4) {
                docNum = (await cells[2].innerText().catch(() => '')).trim();
                nombreLimpio = (await cells[3].innerText().catch(() => '')).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
            }
            if (!nombreLimpio) {
                nombreLimpio = textoLimpio;
            }

            listaNinos.push({ 
                numIndex: listaNinos.length + 1,
                documento: docNum,
                nombre: nombreLimpio, 
                textoFila: textoLimpio,
                row: filasNinos[j] 
            });
        }
    }

    if (listaNinos.length === 0) {
        throw new Error('No se encontraron ninos activos en la tabla.');
    }

    let cantidadSeleccionada = 0;
    const seleccionadosSet = new Set();

    while(true) {
        console.log(c.cyan(`\n    --- Lista de Beneficiarios (${listaNinos.length} ninos) ---`));
        listaNinos.forEach(n => {
            const estado = seleccionadosSet.has(n.numIndex) ? c.verde(' [✓ SELECCIONADO]') : '';
            const docInfo = n.documento ? ` (Doc: ${n.documento})` : '';
            console.log(`      ${String(n.numIndex).padStart(2, ' ')}. ${n.nombre}${docInfo}${estado}`);
        });

        console.log(c.gris('    (Puedes ingresar numero: 1, 3, 5 | nombre/doc | "T" para todos | "LISTO" para terminar)'));
        const respuesta = readline.question(c.negrita('\n    > Ingrese seleccion (numero, nombre, T=Todos, LISTO=Guardar, 0=Cancelar): ')).trim();
        
        const respUpper = respuesta.toUpperCase();
        if (respUpper === 'CANCELAR' || respUpper === '0') {
            throw new Error('Usuario cancelo la seleccion en este jardin.');
        }
        if (respUpper === 'LISTO' || respuesta === '') {
            if (cantidadSeleccionada === 0) {
                const conf = readline.keyInYN('  No has seleccionado ningun nino. Estas seguro que deseas guardar vacio?');
                if (!conf) continue;
            }
            break;
        }

        if (respUpper === 'T' || respUpper === 'TODOS') {
            for (const n of listaNinos) {
                const chk = n.row.locator('input[type="checkbox"]').first();
                if (await chk.count() > 0) {
                    const isChecked = await chk.isChecked();
                    if (!isChecked) {
                        await chk.check();
                        seleccionadosSet.add(n.numIndex);
                        cantidadSeleccionada++;
                    }
                }
            }
            console.log(c.verde(`\n    ✅ Se seleccionaron TODOS los ${listaNinos.length} ninos del jardin.`));
            break;
        }

        // Verificar si se ingresaron numeros de lista (ej: 1, 3, 5 o 2)
        const partesNums = respuesta.split(',').map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n));
        let matchPorNumero = false;

        if (partesNums.length > 0 && partesNums.every(num => num >= 1 && num <= listaNinos.length)) {
            matchPorNumero = true;
            for (const num of partesNums) {
                const ninoObj = listaNinos.find(n => n.numIndex === num);
                if (ninoObj) {
                    const chk = ninoObj.row.locator('input[type="checkbox"]').first();
                    if (await chk.count() > 0) {
                        const isChecked = await chk.isChecked();
                        if (!isChecked) {
                            await chk.check();
                            seleccionadosSet.add(ninoObj.numIndex);
                            cantidadSeleccionada++;
                            console.log(c.verde(`    ✅ [${ninoObj.numIndex}] ${ninoObj.nombre} marcado.`));
                        } else {
                            console.log(c.amarillo(`    ⚠️ [${ninoObj.numIndex}] ${ninoObj.nombre} ya estaba seleccionado.`));
                        }
                    }
                }
            }
        }

        if (!matchPorNumero) {
            const nombreBuscado = removeAccentsStr(respuesta);
            const ninosAfectados = listaNinos.filter(n => removeAccentsStr(n.nombre).includes(nombreBuscado) || (n.documento && n.documento.includes(nombreBuscado)));
            
            if (ninosAfectados.length === 0) {
                console.log(c.rojo(`    ⚠️ No se encontro ningun nino con "${respuesta}"`));
                continue;
            }
            if (ninosAfectados.length > 1) {
                console.log(c.amarillo(`    ⚠️ Se encontraron varios ninos que coinciden:`));
                ninosAfectados.forEach(n => console.log(`      ${n.numIndex}. ${n.nombre} (${n.documento})`));
                console.log(c.amarillo(`    Por favor ingrese el NUMERO especifico del nino (ej: ${ninosAfectados[0].numIndex}).`));
                continue;
            }

            const ninoSeleccionado = ninosAfectados[0];
            const chk = ninoSeleccionado.row.locator('input[type="checkbox"]').first();
            if (await chk.count() > 0) {
                const isChecked = await chk.isChecked();
                if (!isChecked) {
                    await chk.check();
                    seleccionadosSet.add(ninoSeleccionado.numIndex);
                    cantidadSeleccionada++;
                    console.log(c.verde(`\n    ✅ [${ninoSeleccionado.numIndex}] ${ninoSeleccionado.nombre} marcado.`));
                } else {
                    console.log(c.amarillo(`    ⚠️ Este nino ya estaba seleccionado.`));
                }
            }
        }
    }
    cantidadBenef = cantidadSeleccionada;
  }

  console.log('  \x1b[33m% Haciendo clic en Guardar...\x1b[0m');
  await frame.locator('#btnGuardar, img[src*="grabar"], img[src*="save"], img[title*="Guardar"], img[alt*="Guardar"]').first().click();
  await page.waitForTimeout(800);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  
  const contenidoFrame = await frame.locator('body').innerHTML().catch(() => '');
  const exitoso = contenidoFrame.includes('beneficiarios han sido ingresados') ||
                  contenidoFrame.includes('registrado') ||
                  contenidoFrame.includes('guardado');

  if (procesarTodosNinos) {
      const matchBenef = contenidoFrame.match(/(\d+)\s+beneficiarios\s+han\s+sido\s+ingresados/i);
      cantidadBenef = matchBenef ? matchBenef[1] : '?';
  }

  return { exitoso, cantidadBenef };
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
async function main() {
  const USUARIO = process.env.CUENTAME_USUARIO;
  const PASSWORD = process.env.CUENTAME_PASSWORD;
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
  const RUTA_EXCEL = process.env.RUTA_EXCEL;

  if (!USUARIO || !PASSWORD) {
    console.error(c.rojo('\n❌ Faltan CUENTAME_USUARIO o CUENTAME_PASSWORD en el archivo .env\n'));
    process.exit(1);
  }

  const { jardines, porAsociacion } = leerJardines(RUTA_EXCEL);
  console.log(c.verde(`\n📋 Excel leido: ${jardines.length} jardines en ${Object.keys(porAsociacion).length} asociaciones`));

  const config = configurarObservaciones();

  let browser = null;
  let page = null;
  
  const exitososTotales = [];
  const fallidosTotales = [];

  while (true) {
    console.log(c.negrita(c.cyan('\n  ======================================================')));
    console.log(c.negrita(c.cyan('  NUEVA TAREA DE FORMACION A FAMILIAS')));
    console.log(c.negrita(c.cyan('  ======================================================\n')));

    let jardinesAProcesar = [];

    const opcionesAlcance = ['Procesar TODAS las asociaciones', 'Seleccionar UNA asociacion especifica'];
    const alcanceIdx = readline.keyInSelect(opcionesAlcance, c.negrita('  > Escoja el alcance de esta ejecucion: '), { cancel: 'Salir' });

    if (alcanceIdx === -1) {
        break;
    }

    let asociacionSeleccionada = null;

    if (alcanceIdx === 0) {
        jardinesAProcesar = jardines;
    } else {
        const asociacionesNames = Object.keys(porAsociacion);
        const ascIdx = readline.keyInSelect(asociacionesNames, c.negrita('  > Escoja la asociacion: '), { cancel: 'Cancelar' });
        if (ascIdx === -1) continue;

        asociacionSeleccionada = asociacionesNames[ascIdx];
        const jardinesAsoc = porAsociacion[asociacionSeleccionada];

        const opcionesJardin = ['TODOS los jardines de esta asociacion', 'Seleccionar UN jardin especifico'];
        const jardIdx = readline.keyInSelect(opcionesJardin, c.negrita(`  > Alcance para ${asociacionSeleccionada}: `), { cancel: 'Atras' });
        if (jardIdx === -1) continue;

        if (jardIdx === 0) {
            jardinesAProcesar = jardinesAsoc.jardines;
        } else {
            const jardinesNames = jardinesAsoc.jardines.map(j => `${j.nombre} (${j.codigo})`);
            const jIdx = readline.keyInSelect(jardinesNames, c.negrita('  > Escoja el jardin: '), { cancel: 'Atras' });
            if (jIdx === -1) continue;
            jardinesAProcesar = [jardinesAsoc.jardines[jIdx]];
        }
    }

    const temasPorAsociacion = {};
    if (alcanceIdx === 0) {
        console.log(c.cyan('\n  📋 Ha elegido Procesar TODAS las asociaciones.'));
        console.log(c.gris('  A continuacion, escoja el TEMA DE FORMACION para CADA una:'));
        const asociacionesNames = Object.keys(porAsociacion);
        for (const asc of asociacionesNames) {
            console.log(c.amarillo(`\n  Asociacion: ${asc}`));
            const tIdx = readline.keyInSelect(TEMAS_FORMACION, c.negrita(`  > TEMA para ${asc}: `), { cancel: false });
            temasPorAsociacion[asc] = TEMAS_FORMACION[tIdx];
        }
        console.log(c.verde('\n  ✅ Temas seleccionados correctamente.'));
    } else {
        console.log();
        const temaIdx = readline.keyInSelect(TEMAS_FORMACION, c.negrita('  > Escoja el TEMA DE FORMACION para esta tarea: '), { cancel: 'Cancelar tarea' });
        if (temaIdx === -1) continue;
        temasPorAsociacion[asociacionSeleccionada] = TEMAS_FORMACION[temaIdx];
    }

    console.log();
    const opcionesNinos = ['Aplicar a TODOS los ninos del jardin', 'Seleccionar ninos ESPECIFICOS (manual)'];
    const ninosIdx = readline.keyInSelect(opcionesNinos, c.negrita('  > Alcance de beneficiarios: '), { cancel: 'Cancelar tarea' });
    if (ninosIdx === -1) continue;
    
    const procesarTodosNinos = (ninosIdx === 0);

    const opcionesProcesamiento = {
        procesarTodosNinos: procesarTodosNinos
    };

    if (!browser) {
      console.log(c.cyan('\n  🌐 Inicializando entorno de navegador...\n'));
      const navData = await obtenerNavegador();
      browser = navData.browser;
      const context = navData.context;
      page = navData.page;

      // Verificar si ya hay sesion activa; si no, hacer login
      const pageText = await page.evaluate(() => document.body.innerText);
      const urlActual = page.url();
      const sessionActiva = urlActual.includes('MasterPrincipal') || urlActual.includes('Roles.aspx') || pageText.includes('Seleccione la entidad') || pageText.includes('Rub online');

      if (!sessionActiva) {
        console.log(c.amarillo('  🔐 Sin sesion activa. Iniciando login automatico...'));
        await loginYLlegarARoles(page, {
          usuario: USUARIO,
          password: PASSWORD,
          gmailUser: GMAIL_USER,
          gmailAppPassword: GMAIL_APP_PASSWORD
        });
      } else {
        console.log(c.verde('  ✅ Sesion activa detectada. Reutilizando sesion existente.'));
      }

      // Si estamos en seleccion de entidad (Roles.aspx), elegir cualquier asociacion al azar
      const urlDespues = page.url();
      const textoDespues = await page.evaluate(() => document.body.innerText);
      if (urlDespues.includes('Roles.aspx') || textoDespues.includes('Seleccione la entidad')) {
        console.log(c.amarillo('  🎲 Seleccionando una entidad automaticamente para acceder al modulo...'));
        const opciones = await page.locator('select option').all();
        const validas = [];
        for (const op of opciones) {
          const val = await op.getAttribute('value');
          if (val && val !== '') validas.push(val);
        }
        if (validas.length > 0) {
          const elegida = validas[Math.floor(Math.random() * validas.length)];
          await page.locator('select').selectOption(elegida);
          await Promise.all([
            page.waitForLoadState('domcontentloaded'),
            page.locator('input[value="Continuar"], button:has-text("Continuar")').first().click()
          ]);
          await page.waitForTimeout(800);
        }
      }
    }

    console.log(c.negrita(c.cyan(`\n  🚀 Iniciando procesamiento de ${jardinesAProcesar.length} jardines...\n`)));

    let exitososActual = [];
    let fallidosActual = [];

    for (let i = 0; i < jardinesAProcesar.length; i++) {
        const jardin = jardinesAProcesar[i];
        
        // Asignar el tema especifico de la asociacion
        opcionesProcesamiento.tema = temasPorAsociacion[jardin.asociacion] || TEMAS_FORMACION[0];

        const progreso = `[${String(i + 1).padStart(2, '0')}/${jardinesAProcesar.length}]`;
        process.stdout.write(`${c.gris(progreso)} ${c.negrita(jardin.nombre)} ${c.gris(`(${jardin.asociacion})`)} -> `);

        try {
            const { exitoso, cantidadBenef } = await registrarFormacion(page, jardin, config, opcionesProcesamiento);

            if (exitoso) {
                console.log(c.verde(`✅ ${cantidadBenef} beneficiarios registrados (${c.cyan(opcionesProcesamiento.tema.substring(0, 30))}...)`));
                exitososActual.push({ ...jardin, beneficiarios: cantidadBenef });
                exitososTotales.push({ ...jardin, beneficiarios: cantidadBenef });
            } else {
                console.log(c.amarillo('⚠️ Guardado (sin confirmar cantidad)'));
                exitososActual.push({ ...jardin, beneficiarios: '?' });
                exitososTotales.push({ ...jardin, beneficiarios: '?' });
            }
        } catch (err) {
            const mensaje = err.message || String(err);
            console.log(c.rojo(`❌ Error: ${mensaje.slice(0, 80)}`));
            fallidosActual.push({ ...jardin, error: mensaje });
            fallidosTotales.push({ ...jardin, error: mensaje });

            await page.goto(URL_FORMACION, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
            await page.waitForTimeout(800);
        }
        await page.waitForTimeout(800);
    }

    if (fallidosActual.length > 0) {
        console.log(c.rojo(`\n  ⚠️ ${fallidosActual.length} jardines fallaron en esta tarea.`));
    }

    console.log(c.verde(`\n  ✅ Tarea finalizada. Exitosos: ${exitososActual.length} | Fallidos: ${fallidosActual.length}\n`));
    
    const continuar = readline.keyInYN(c.negrita('  Desea iniciar OTRA tarea de Formacion a Familias?'));
    if (!continuar) {
        break;
    }
  }

  console.log(c.verde(`\n  ╔══════════════════════════════════════════╗`));
  console.log(c.verde(`  ║         🎉 PROCESAMIENTO COMPLETO        ║`));
  console.log(c.verde(`  ╚══════════════════════════════════════════╝\n`));
  console.log(`  ✅ Exitosos Totales: ${c.verde(c.negrita(exitososTotales.length))}`);
  console.log(`  ❌ Fallidos Totales: ${c.rojo(c.negrita(fallidosTotales.length))}\n`);

  const log = {
    fecha: new Date().toISOString(),
    fechaFormacion: config.hoy,
    exitosos: exitososTotales.length,
    fallidos: fallidosTotales.length,
    detalle: { exitosos: exitososTotales, fallidos: fallidosTotales },
  };
  const archivoLog = guardarLog(log);
  console.log(c.gris(`  📄 Log guardado en: ${archivoLog}\n`));

  console.log(c.verde('  👋 Modulo finalizado. Navegador mantenido activo.\n'));
}

main().catch((err) => {
  console.error(c.rojo('\n❌ Error inesperado:'), err.message);
  process.exit(1);
});
