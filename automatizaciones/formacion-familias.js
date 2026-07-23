/**
 * formacion-familias.js
 * Bot principal para automatizar el registro de Formación a Familias
 * en el sistema Cuéntame - ICBF.
 *
 * Uso: npm run formacion
 */

require('dotenv').config();
const { chromium } = require('playwright');
const readline = require('readline-sync');
const fs = require('fs');
const path = require('path');

const { leerJardines } = require('../servicios/excel-reader');
const { login } = require('../servicios/autenticacion');
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
  'SENTIDO DE LA EDUCACIÓN INICIAL.',
  'CONCEPCIÓN DE FAMILIA, DESARROLLO, NIÑA Y NIÑO',
  'CUIDADO SENSIBLE Y HUMANIZADO DESDE LA GESTACIÓN, PARTO Y EL POSPARTO',
  'CRIANZAS CORRESPONSABLES.',
  'PREVENCIÓN DE VIOLENCIAS',
  'PREVENCIÓN DE VIOLENCIAS BASADAS EN GÉNERO DESDE LA GESTACIÓN',
  'GESTIÓN DE RIESGO DE ACCIDENTES Y DESASTRES',
  'PREVENCIÓN DE ENFERMEDADES PREVALENTES EN PRIMERA INFANCIA.',
  'PRÁCTICAS DE CUIDADO Y CONSUMO DE ALIMENTACIÓN SALUDABLE, NATURAL, MÍNIMAMENTE PROCESADA, VARIADA Y CULTURALMENTE ADECUADA',
  'PROMOCIÓN DE LACTANCIA HUMANA COMO PRIMER ACTO DE SOBERANÍA ALIMENTARIA.',
  'IDENTIFICACIÓN DE SIGNOS ALARMA EN LA SALUD DE MUJERES Y PERSONAS EN GESTACIÓN NIÑAS Y NIÑOS',
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
// Menú de configuración (antes de arrancar el bot)
// ─────────────────────────────────────────────────────────────
function configurar(porAsociacion) {
  console.clear();
  console.log(c.negrita(c.verde(`
╔══════════════════════════════════════════════════════════╗
║     🤖 BOT FORMACIÓN A FAMILIAS - Sistema Cuéntame      ║
║                    ICBF Colombia                         ║
╚══════════════════════════════════════════════════════════╝
`)));

  const hoy = fechaHoy();
  console.log(c.cyan(`  📅 Fecha de formación: ${c.negrita(hoy)} (fecha de hoy)\n`));

  // Observaciones
  console.log(c.amarillo('  📝 OBSERVACIONES (texto que se repite en todos los jardines):'));
  console.log(c.gris(`     Por defecto: "${OBSERVACIONES_DEFAULT}"`));
  const cambiarObs = readline.keyInYN('  ¿Quieres cambiar el texto de observaciones?');
  const observaciones = cambiarObs
    ? readline.question('  Escribe el nuevo texto de observaciones: ').trim() || OBSERVACIONES_DEFAULT
    : OBSERVACIONES_DEFAULT;

  console.log();

  // Temas por asociación
  console.log(c.negrita(c.cyan('  🎯 TEMAS DE FORMACIÓN POR ASOCIACIÓN:\n')));
  console.log(c.gris('  Temas disponibles:'));
  TEMAS_FORMACION.forEach((t, i) => {
    console.log(c.gris(`    [${i + 1}] ${t}`));
  });
  console.log();

  const temasAsociacion = {};
  const asociaciones = Object.keys(porAsociacion);

  for (const asoc of asociaciones) {
    const jardines = porAsociacion[asoc];
    console.log(c.negrita(`  📌 ${asoc}`) + c.gris(` (${jardines.length} jardines)`));

    const opciones = TEMAS_FORMACION.map((t, i) => `${i + 1}. ${t.slice(0, 60)}...`);
    const idx = readline.keyInSelect(TEMAS_FORMACION, `  Tema para ${asoc}:`, { cancel: false });
    temasAsociacion[asoc] = TEMAS_FORMACION[idx];
    console.log(c.verde(`     ✅ Tema seleccionado: ${TEMAS_FORMACION[idx].slice(0, 70)}\n`));
  }

  // Resumen
  console.log(c.amarillo('\n  ══════════════════════════════════════════'));
  console.log(c.negrita('  RESUMEN DE CONFIGURACIÓN:'));
  console.log(c.amarillo('  ══════════════════════════════════════════'));
  console.log(`  Fecha formación: ${c.negrita(hoy)}`);
  console.log(`  Observaciones:   ${observaciones.slice(0, 60)}...`);
  console.log(`  Jardines totales: ${c.negrita(Object.values(porAsociacion).flat().length)}`);

  for (const [asoc, tema] of Object.entries(temasAsociacion)) {
    console.log(`  ${asoc}: ${c.cyan(tema.slice(0, 50))}...`);
  }

  console.log();
  const confirmar = readline.keyInYN(c.negrita('  ¿Iniciar el bot ahora?'));
  if (!confirmar) {
    console.log(c.amarillo('\n  Operación cancelada.\n'));
    process.exit(0);
  }

  return { hoy, observaciones, temasAsociacion };
}

// ─────────────────────────────────────────────────────────────
// Registro de UN jardín
// ─────────────────────────────────────────────────────────────
async function registrarFormacion(page, jardin, config) {
  const { hoy, observaciones, temasAsociacion } = config;
  const tema = temasAsociacion[jardin.asociacion];

  // Expandir el menú "Rub online" si es necesario
  const menuDestino = page.locator('text="Seguimiento formación a padres/cuidadores"').first();
  const submenuVisible = await menuDestino.isVisible();
  
  if (!submenuVisible) {
    console.log('  👉 Desplegando menú "Rub online"...');
    await page.locator('text="Rub online"').first().click();
    await page.waitForTimeout(1000); // Esperar que la animación del menú termine
  }

  // Navegar al menú: Seguimiento formación a padres/cuidadores
  console.log('  👉 Clic en "Seguimiento formación a padres/cuidadores"...');
  await menuDestino.click();
  await page.waitForTimeout(2000); // Darle tiempo a que cargue la vista de lista

  // Click en botón Nuevo (+)
  console.log('  👉 Clic en el botón Nuevo (+)...');
  const selectorNuevo = 'input[type="image"][src*="nuevo" i], input[type="image"][src*="add" i], input[type="image"][src*="agregar" i], img[src*="nuevo" i], img[src*="add" i], img[src*="agregar" i], img[title*="Nuevo" i], img[title*="Agregar" i]';
  await page.locator(selectorNuevo).first().click();
  
  // Esperar a que la interfaz cambie (debe aparecer el campo Observaciones o Apellido del Beneficiario)
  console.log('  👉 Esperando a que cargue el formulario de registro...');
  await page.waitForTimeout(2000); // Darle tiempo a la animación/carga
  const campoObsParaVerificar = page.locator('textarea[id*="Observaciones"], textarea[name*="Observaciones"]').first();
  await campoObsParaVerificar.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
    throw new Error('No se pudo abrir el formulario de registro (no se encontró el campo Observaciones tras dar clic en Nuevo).');
  });

  // Seleccionar la unidad de servicio usando la lupa
  console.log('  👉 Haciendo clic en la lupa para buscar la Unidad de Servicio...');
  await seleccionarUnidad(page, jardin.codigo);

  // Esperar que el formulario se autocomplete con los datos del jardín
  await page.waitForTimeout(2000);

  // Llenar Fecha Formación
  const campoFechaFormacion = page.locator('input[id*="FechaFormacion"], input[name*="FechaFormacion"]').first();
  await campoFechaFormacion.fill(hoy);
  await campoFechaFormacion.press('Tab');
  await page.waitForTimeout(500);

  // Llenar Número de Horas
  const campoHoras = page.locator('input[id*="Horas"], input[name*="Horas"]').first();
  await campoHoras.fill(HORAS_FORMACION);

  // Seleccionar Tema Formación (dropdown)
  const dropdownTema = page.locator('select[id*="Tema"], select[name*="Tema"]').first();
  await dropdownTema.selectOption({ label: tema });
  await page.waitForTimeout(500);

  // Seleccionar Tipo de Encuentro
  const dropdownEncuentro = page.locator('select[id*="TipoEncuentro"], select[id*="Encuentro"], select[name*="Encuentro"]').first();
  await dropdownEncuentro.selectOption({ label: TIPO_ENCUENTRO });

  // Llenar Observaciones
  const campoObs = page.locator('textarea[id*="Observaciones"], textarea[name*="Observaciones"]').first();
  await campoObs.fill(observaciones);

  // Seleccionar TODOS los niños (checkbox del encabezado de la tabla)
  const checkboxTodos = page.locator('input[type="checkbox"]').first();
  const estaChecked = await checkboxTodos.isChecked().catch(() => false);
  if (!estaChecked) {
    await checkboxTodos.click();
    await page.waitForTimeout(1000);
  }

  // Guardar (ícono disquete 💾)
  await page.locator('img[src*="grabar"], img[src*="save"], img[title*="Guardar"], img[alt*="Guardar"]').first().click();
  await page.waitForTimeout(3000);

  // Verificar mensaje de éxito
  const contenido = await page.content();
  const exitoso = contenido.includes('beneficiarios han sido ingresados') ||
                  contenido.includes('registrado') ||
                  contenido.includes('guardado');

  // Extraer cuántos beneficiarios se cargaron
  const matchBenef = contenido.match(/(\d+)\s+beneficiarios\s+han\s+sido\s+ingresados/i);
  const cantidadBenef = matchBenef ? matchBenef[1] : '?';

  return { exitoso, cantidadBenef };
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
async function main() {
  // Validar credenciales
  const USUARIO = process.env.CUENTAME_USUARIO;
  const PASSWORD = process.env.CUENTAME_PASSWORD;
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
  const RUTA_EXCEL = process.env.RUTA_EXCEL;

  if (!USUARIO || !PASSWORD) {
    console.error(c.rojo('\n❌ Faltan CUENTAME_USUARIO o CUENTAME_PASSWORD en el archivo .env\n'));
    process.exit(1);
  }

  // Leer jardines del Excel
  const { jardines, porAsociacion } = leerJardines(RUTA_EXCEL);
  console.log(c.verde(`\n📋 Excel leído: ${jardines.length} jardines en ${Object.keys(porAsociacion).length} asociaciones`));

  // Configuración interactiva
  const config = configurar(porAsociacion);

  // Abrir el navegador
  console.log(c.cyan('\n  🌐 Abriendo navegador...\n'));
  const browser = await chromium.launch({
    headless: false, // visible para que puedas ver qué hace el bot
    slowMo: 100,     // pequeña pausa entre acciones para mayor estabilidad
    args: ['--start-maximized']
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  // Login con 2FA
  await login(page, {
    usuario: USUARIO,
    password: PASSWORD,
    gmailUser: GMAIL_USER,
    gmailAppPassword: GMAIL_APP_PASSWORD,
  });

  // Resultados
  const exitosos = [];
  const fallidos = [];
  const total = jardines.length;

  console.log(c.negrita(c.cyan(`\n  🚀 Iniciando procesamiento de ${total} jardines...\n`)));

  for (let i = 0; i < jardines.length; i++) {
    const jardin = jardines[i];
    const progreso = `[${String(i + 1).padStart(2, '0')}/${total}]`;

    process.stdout.write(
      `${c.gris(progreso)} ${c.negrita(jardin.nombre)} ${c.gris(`(${jardin.asociacion})`)} → `
    );

    try {
      const { exitoso, cantidadBenef } = await registrarFormacion(page, jardin, config);

      if (exitoso) {
        console.log(c.verde(`✅ ${cantidadBenef} beneficiarios registrados`));
        exitosos.push({ ...jardin, beneficiarios: cantidadBenef });
      } else {
        console.log(c.amarillo('⚠️  Guardado (sin confirmar cantidad)'));
        exitosos.push({ ...jardin, beneficiarios: '?' });
      }
    } catch (err) {
      const mensaje = err.message || String(err);
      console.log(c.rojo(`❌ Error: ${mensaje.slice(0, 80)}`));
      fallidos.push({ ...jardin, error: mensaje });

      // Intentar volver al inicio para continuar con el siguiente jardín
      await page.goto(URL_FORMACION, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }

    // Pausa entre jardines para no saturar el sistema
    await page.waitForTimeout(1500);
  }

  // ── Resumen final ────────────────────────────────────────
  console.log(c.verde(`\n  ╔══════════════════════════════════════════╗`));
  console.log(c.verde(`  ║         🎉 PROCESAMIENTO COMPLETO         ║`));
  console.log(c.verde(`  ╚══════════════════════════════════════════╝\n`));
  console.log(`  ✅ Exitosos: ${c.verde(c.negrita(exitosos.length))} / ${total}`);
  console.log(`  ❌ Fallidos: ${c.rojo(c.negrita(fallidos.length))} / ${total}\n`);

  if (fallidos.length > 0) {
    console.log(c.rojo('  Jardines con error:'));
    fallidos.forEach((f) => {
      console.log(c.rojo(`    • ${f.nombre} (${f.codigo}): ${f.error.slice(0, 80)}`));
    });
    console.log();
  }

  // Guardar log
  const log = {
    fecha: new Date().toISOString(),
    fechaFormacion: config.hoy,
    total,
    exitosos: exitosos.length,
    fallidos: fallidos.length,
    detalle: { exitosos, fallidos },
  };
  const archivoLog = guardarLog(log);
  console.log(c.gris(`  📄 Log guardado en: ${archivoLog}\n`));

  await browser.close();
}

main().catch((err) => {
  console.error(c.rojo('\n❌ Error inesperado:'), err.message);
  process.exit(1);
});
