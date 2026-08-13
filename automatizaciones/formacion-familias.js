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
const { loginYLlegarARoles, obtenerNavegador } = require('../servicios/autenticacion');
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

  const menuDestino = page.locator('text="Seguimiento formacion a padres/cuidadores"').first();
  const submenuVisible = await menuDestino.isVisible();
  
  if (!submenuVisible) {
    console.log('  👉 Desplegando menu "Rub online"...');
    await page.locator('text="Rub online"').first().click();
    await menuDestino.waitFor({ state: 'visible', timeout: 5000 });
  }

  console.log('  👉 Clic en "Seguimiento formacion a padres/cuidadores"...');
  await Promise.all([
    page.waitForLoadState('networkidle'),
    menuDestino.click()
  ]);
  await page.waitForTimeout(1500);

  const frame = page.frameLocator('iframe').last();

  console.log('  👉 Clic en el boton Nuevo (+)...');
  await Promise.all([
    page.waitForLoadState('networkidle'),
    frame.locator('#btnNuevo, input[type="image"][src*="nuevo"], input[type="image"][title*="Nuevo"]').first().click()
  ]);
  await page.waitForTimeout(1500);

  console.log(`  👉 Buscando UDS: ${jardin.nombre}...`);
  await seleccionarUnidad(page, frame, jardin.codigo);

  console.log('  👉 Esperando a que cargue el resto de campos (Observaciones, Beneficiarios)...');
  const campoObsParaVerificar = frame.locator('textarea[id*="Observaciones"], textarea[name*="Observaciones"]').first();
  await campoObsParaVerificar.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
    throw new Error('No se cargaron los campos finales despues de seleccionar la Unidad de Servicio.');
  });

  const campoFechaFormacion = frame.locator('input[id*="FechaFormacion"], input[name*="FechaFormacion"]').first();
  await campoFechaFormacion.click({ position: { x: 5, y: 5 } });
  const numerosFecha = hoy.replace(/\//g, '');
  await campoFechaFormacion.pressSequentially(numerosFecha, { delay: 10 });
  await campoFechaFormacion.press('Tab');

  const campoHoras = frame.locator('input[id*="Horas"], input[name*="Horas"]').first();
  await campoHoras.fill(HORAS_FORMACION);

  const dropdownTema = frame.locator('select[id*="Tema"], select[name*="Tema"]').first();
  await dropdownTema.selectOption({ label: tema });

  const dropdownEncuentro = frame.locator('select[id*="TipoEncuentro"], select[id*="Encuentro"], select[name*="Encuentro"]').first();
  await dropdownEncuentro.selectOption({ label: TIPO_ENCUENTRO });

  const campoObs = frame.locator('textarea[id*="Observaciones"], textarea[name*="Observaciones"]').first();
  await campoObs.fill(observaciones);

  let cantidadBenef = 0;

  if (procesarTodosNinos) {
    const checkboxTodos = frame.locator('input[type="checkbox"]').first();
    const estaChecked = await checkboxTodos.isChecked().catch(() => false);
    if (!estaChecked) {
      await checkboxTodos.click();
      await page.waitForTimeout(1500);
    }
    cantidadBenef = 'TODOS';
  } else {
    console.log(c.cyan('\n    Leyendo lista de beneficiarios en la tabla...'));
    // Buscar cualquier fila que tenga un checkbox (ignorando la cabecera general si es posible, pero las leeremos todas)
    const filasNinos = await frame.locator('tr:has(input[type="checkbox"])').all();
    
    const listaNinos = [];
    for (let j = 0; j < filasNinos.length; j++) {
        const rowText = await filasNinos[j].innerText();
        const textoFila = rowText.replace(/\t/g, ' ').trim(); 
        
        // Evitar la fila de cabecera que suele decir "Tipo Documento" o similar
        if (textoFila && textoFila.length > 5 && !textoFila.toLowerCase().includes('tipo documento')) {
            listaNinos.push({ idxOriginal: j, nombre: textoFila, row: filasNinos[j] });
        }
    }

    if (listaNinos.length === 0) {
        throw new Error('No se encontraron ninos activos en la tabla.');
    }

    let cantidadSeleccionada = 0;
    while(true) {
        console.log(c.cyan('\n    --- Lista de Beneficiarios ---'));
        listaNinos.forEach(n => console.log(`      - ${n.nombre}`));

        const seleccionNina = readline.question(c.negrita('\n    > Ingrese nombre o apellido del nino (o "LISTO" para terminar, "CANCELAR" para saltar este jardin): ')).trim();
        
        if (seleccionNina.toUpperCase() === 'CANCELAR') {
            throw new Error('Usuario cancelo la seleccion en este jardin.');
        }
        if (seleccionNina.toUpperCase() === 'LISTO' || seleccionNina === '') {
            if (cantidadSeleccionada === 0) {
                const conf = readline.keyInYN('  No has seleccionado ningun nino. Estas seguro que deseas guardar vacio?');
                if (!conf) continue;
            }
            break;
        }

        const nombreBuscado = seleccionNina.toUpperCase();
        const ninosAfectados = listaNinos.filter(n => n.nombre.toUpperCase().includes(nombreBuscado));
        
        if (ninosAfectados.length === 0) {
            console.log(c.rojo(`    ⚠️ No se encontro ningun nino con "${seleccionNina}"`));
            continue;
        }
        if (ninosAfectados.length > 1) {
            console.log(c.amarillo(`    ⚠️ Se encontraron varios ninos que coinciden:`));
            ninosAfectados.forEach(n => console.log(`      - ${n.nombre}`));
            console.log(c.amarillo(`    Por favor sea mas especifico.`));
            continue;
        }

        const ninoSeleccionado = ninosAfectados[0];
        console.log(c.verde(`\n    ✅ Nino seleccionado: ${ninoSeleccionado.nombre}`));
        
        const chk = ninoSeleccionado.row.locator('input[type="checkbox"]').first();
        if (await chk.count() > 0) {
            const isChecked = await chk.isChecked();
            if (!isChecked) {
                await chk.check();
                cantidadSeleccionada++;
            } else {
                console.log(c.amarillo(`    ⚠️ Este nino ya estaba seleccionado.`));
            }
        }
    }
    cantidadBenef = cantidadSeleccionada;
  }

  console.log('  👉 Haciendo clic en Guardar...');
  await Promise.all([
    page.waitForLoadState('networkidle'),
    frame.locator('#btnGuardar, img[src*="grabar"], img[src*="save"], img[title*="Guardar"], img[alt*="Guardar"]').first().click()
  ]);
  await page.waitForTimeout(1500);

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

    if (alcanceIdx === 0) {
        jardinesAProcesar = jardines;
    } else {
        const asociacionesNames = Object.keys(porAsociacion);
        const ascIdx = readline.keyInSelect(asociacionesNames, c.negrita('  > Escoja la asociacion: '), { cancel: 'Cancelar' });
        if (ascIdx === -1) continue;

        const asociacionSeleccionada = asociacionesNames[ascIdx];
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

    console.log();
    const temaIdx = readline.keyInSelect(TEMAS_FORMACION, c.negrita('  > Escoja el TEMA DE FORMACION para esta tarea: '), { cancel: 'Cancelar tarea' });
    if (temaIdx === -1) continue;
    const temaSeleccionado = TEMAS_FORMACION[temaIdx];

    console.log();
    const opcionesNinos = ['Aplicar a TODOS los ninos del jardin', 'Seleccionar ninos ESPECIFICOS (manual)'];
    const ninosIdx = readline.keyInSelect(opcionesNinos, c.negrita('  > Alcance de beneficiarios: '), { cancel: 'Cancelar tarea' });
    if (ninosIdx === -1) continue;
    
    const procesarTodosNinos = (ninosIdx === 0);

    const opcionesProcesamiento = {
        tema: temaSeleccionado,
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
            page.waitForLoadState('networkidle'),
            page.locator('input[value="Continuar"], button:has-text("Continuar")').first().click()
          ]);
          await page.waitForTimeout(1500);
        }
      }
    }

    console.log(c.negrita(c.cyan(`\n  🚀 Iniciando procesamiento de ${jardinesAProcesar.length} jardines...\n`)));

    let exitososActual = [];
    let fallidosActual = [];

    for (let i = 0; i < jardinesAProcesar.length; i++) {
        const jardin = jardinesAProcesar[i];
        const progreso = `[${String(i + 1).padStart(2, '0')}/${jardinesAProcesar.length}]`;
        process.stdout.write(`${c.gris(progreso)} ${c.negrita(jardin.nombre)} ${c.gris(`(${jardin.asociacion})`)} -> `);

        try {
            const { exitoso, cantidadBenef } = await registrarFormacion(page, jardin, config, opcionesProcesamiento);

            if (exitoso) {
                console.log(c.verde(`✅ ${cantidadBenef} beneficiarios registrados`));
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

            await page.goto(URL_FORMACION, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
            await page.waitForTimeout(1500);
        }
        await page.waitForTimeout(1500);
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
