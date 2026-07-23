/**
 * Script de Captura de Pantalla Guiada
 * Documenta procesos del sistema Cuéntame - ICBF
 *
 * Uso: node captura.js
 */

const screenshot = require('screenshot-desktop');
const readline = require('readline-sync');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────
// Configuración de procesos y carpetas
// ─────────────────────────────────────────────
const PROCESOS = [
  {
    id: 1,
    nombre: 'Vinculación de Beneficiarios',
    carpeta: 'docs/pantallazos/vinculacion de beneficiarios',
    descripcion: 'Registrar un nuevo beneficiario en el sistema',
  },
  {
    id: 2,
    nombre: 'Peso y Talla',
    carpeta: 'docs/pantallazos/peso y talla',
    descripcion: 'Registrar seguimiento nutricional (peso y talla)',
  },
  {
    id: 3,
    nombre: 'RAM',
    carpeta: 'docs/pantallazos/ram',
    descripcion: 'Registro de Atención Mensual',
  },
  {
    id: 4,
    nombre: 'Formación a Familias',
    carpeta: 'docs/pantallazos/formacion a familias',
    descripcion: 'Registrar sesión de formación a padres/cuidadores',
  },
  {
    id: 5,
    nombre: 'Informes de Beneficiarios',
    carpeta: 'docs/pantallazos/informes de beneficiarios',
    descripcion: 'Generar y descargar informe de beneficiarios',
  },
  {
    id: 6,
    nombre: 'Informe de Peso y Talla',
    carpeta: 'docs/pantallazos/informe de peso y talla',
    descripcion: 'Generar informe de seguimiento nutricional',
  },
  {
    id: 7,
    nombre: 'Informe de RAM',
    carpeta: 'docs/pantallazos/informe de ram',
    descripcion: 'Generar informe de atención mensual',
  },
  {
    id: 8,
    nombre: 'Informe de Talento Humano',
    carpeta: 'docs/pantallazos/informe de talento humano',
    descripcion: 'Generar informe del personal / talento humano',
  },
];

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Limpia un texto para usarlo como nombre de archivo
 * Ej: "Paso 1: Inicio de sesión" → "paso-1-inicio-de-sesion"
 */
function sanitizarNombre(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .replace(/[^a-z0-9\s-]/g, '')   // quitar caracteres especiales
    .trim()
    .replace(/\s+/g, '-')            // espacios → guiones
    .slice(0, 60)                    // máximo 60 caracteres (límite Windows)
    .replace(/-+$/, '');             // quitar guiones al final si quedaron
}

/**
 * Retorna la hora actual formateada
 */
function horaActual() {
  return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Imprime texto con color ANSI simple (sin dependencias extra)
 */
const c = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
  rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
  gris:     (t) => `\x1b[90m${t}\x1b[0m`,
  negrita:  (t) => `\x1b[1m${t}\x1b[0m`,
};

// ─────────────────────────────────────────────
// Flujo principal
// ─────────────────────────────────────────────

async function main() {
  console.clear();
  console.log(c.negrita(c.verde(`
╔══════════════════════════════════════════════════════╗
║     🎯 CAPTURADOR DE PROCESOS - Sistema Cuéntame     ║
║                    ICBF Colombia                     ║
╚══════════════════════════════════════════════════════╝
`)));

  // ── 1. Selección de proceso ──────────────────
  console.log(c.cyan('  Selecciona el proceso que vas a documentar:\n'));

  PROCESOS.forEach((p) => {
    console.log(`  ${c.amarillo(`[${p.id}]`)} ${p.nombre}`);
    console.log(c.gris(`       → ${p.descripcion}`));
  });

  console.log();
  const seleccion = readline.questionInt(c.negrita('  Ingresa el número del proceso: '));
  const proceso = PROCESOS.find((p) => p.id === seleccion);

  if (!proceso) {
    console.log(c.rojo('\n  ❌ Proceso no válido. Reinicia el script.\n'));
    process.exit(1);
  }

  // ── 2. Crear carpeta si no existe ────────────
  const carpetaAbsoluta = path.resolve(proceso.carpeta);
  if (!fs.existsSync(carpetaAbsoluta)) {
    fs.mkdirSync(carpetaAbsoluta, { recursive: true });
  }

  // ── 3. Contar capturas existentes ────────────
  const capturasExistentes = fs.readdirSync(carpetaAbsoluta).filter((f) =>
    f.endsWith('.png')
  ).length;

  console.log(c.verde(`\n  ✅ Proceso seleccionado: ${c.negrita(proceso.nombre)}`));
  console.log(c.gris(`  📁 Carpeta: ${carpetaAbsoluta}`));
  console.log(c.gris(`  📸 Capturas existentes: ${capturasExistentes}\n`));

  console.log(c.amarillo('  ─────────────────────────────────────────────'));
  console.log(c.amarillo('  INSTRUCCIONES:'));
  console.log('  1. Pasa a tu navegador y realiza el siguiente paso del proceso.');
  console.log('  2. Vuelve a esta ventana y presiona ' + c.negrita('ENTER') + ' para capturar.');
  console.log('  3. Escribe una descripción breve del paso que acabas de capturar.');
  console.log('  4. Repite hasta completar todo el proceso.');
  console.log('  5. Escribe ' + c.negrita('"fin"') + ' cuando termines.');
  console.log(c.amarillo('  ─────────────────────────────────────────────\n'));

  readline.question(c.gris('  Presiona ENTER cuando estés listo para empezar...'));
  console.log();

  // ── 4. Bucle de captura ──────────────────────
  let numeroPaso = capturasExistentes + 1;
  const capturasEstaSesion = [];

  while (true) {
    console.log(c.cyan(`\n  📍 Paso ${numeroPaso} — ${c.negrita('Navega a la pantalla que quieres capturar')}`));
    const comando = readline.question(
      `  Presiona ${c.negrita('ENTER')} para capturar o escribe ${c.negrita('"fin"')} para terminar: `
    ).trim().toLowerCase();

    if (comando === 'fin' || comando === 'f') {
      break;
    }

    // Pequeña pausa para que el usuario pueda cambiar al navegador
    // (el ENTER ya los llevará de vuelta, pero damos 1 segundo de margen)
    console.log(c.gris('  ⏳ Capturando en 2 segundos... (cambia al navegador si es necesario)'));
    await new Promise((r) => setTimeout(r, 2000));

    // Capturar pantalla
    let imagenBuffer;
    try {
      imagenBuffer = await screenshot({ format: 'png' });
    } catch (err) {
      console.log(c.rojo(`  ❌ Error al capturar: ${err.message}`));
      continue;
    }

    // Pedir descripción
    const descripcion = readline.question(
      `  📝 Describe este paso (ej: "formulario de datos del beneficiario"): `
    ).trim();

    const nombreArchivo = `paso-${String(numeroPaso).padStart(2, '0')}-${sanitizarNombre(descripcion) || 'sin-descripcion'}.png`;
    const rutaCompleta = path.join(carpetaAbsoluta, nombreArchivo);

    // Guardar captura
    fs.writeFileSync(rutaCompleta, imagenBuffer);

    console.log(c.verde(`  ✅ Guardado: ${c.negrita(nombreArchivo)}`));
    console.log(c.gris(`     ${horaActual()} — ${rutaCompleta}`));

    capturasEstaSesion.push({ paso: numeroPaso, archivo: nombreArchivo, descripcion });
    numeroPaso++;
  }

  // ── 5. Resumen final ─────────────────────────
  console.log(c.verde(`\n  ╔══════════════════════════════════════════╗`));
  console.log(c.verde(`  ║           🎉 SESIÓN COMPLETADA            ║`));
  console.log(c.verde(`  ╚══════════════════════════════════════════╝\n`));

  if (capturasEstaSesion.length === 0) {
    console.log(c.amarillo('  No se tomaron capturas en esta sesión.\n'));
    return;
  }

  console.log(c.negrita(`  Proceso: ${proceso.nombre}`));
  console.log(c.negrita(`  Capturas tomadas: ${capturasEstaSesion.length}\n`));

  capturasEstaSesion.forEach(({ paso, archivo, descripcion }) => {
    console.log(`  ${c.amarillo(`Paso ${paso}:`)} ${descripcion}`);
    console.log(c.gris(`           → ${archivo}`));
  });

  // Guardar un resumen en texto para referencia
  const resumenPath = path.join(carpetaAbsoluta, 'RESUMEN.md');
  const resumenContenido = generarResumen(proceso, capturasEstaSesion, capturasExistentes);

  // Agregar al resumen existente o crear uno nuevo
  if (fs.existsSync(resumenPath)) {
    fs.appendFileSync(resumenPath, `\n---\n\n${resumenContenido}`);
  } else {
    fs.writeFileSync(resumenPath, resumenContenido);
  }

  console.log(c.gris(`\n  📄 Resumen guardado en: ${resumenPath}`));
  console.log(c.verde('\n  ✅ Listo. Puedes cerrar esta ventana.\n'));
}

// ─────────────────────────────────────────────
// Generador de resumen Markdown
// ─────────────────────────────────────────────
function generarResumen(proceso, capturas, previas) {
  const fecha = new Date().toLocaleString('es-CO', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  let md = `## Sesión del ${fecha}\n\n`;
  md += `**Proceso:** ${proceso.nombre}  \n`;
  md += `**Capturas en esta sesión:** ${capturas.length}  \n\n`;
  md += `### Pasos documentados\n\n`;

  capturas.forEach(({ paso, archivo, descripcion }) => {
    md += `**Paso ${paso}:** ${descripcion}  \n`;
    md += `![${descripcion}](./${archivo})\n\n`;
  });

  return md;
}

// ─────────────────────────────────────────────
// Arrancar
// ─────────────────────────────────────────────
main().catch((err) => {
  console.error('\n❌ Error inesperado:', err.message);
  process.exit(1);
});
