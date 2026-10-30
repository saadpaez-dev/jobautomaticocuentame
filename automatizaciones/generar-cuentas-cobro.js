/**
 * generar-cuentas-cobro.js
 * -------------------------------------------------------------------------
 * Genera automaticamente la Cuenta de Cobro + Paz y Salvo mensual para las
 * asociaciones, a partir de:
 *   - GENERAL.xlsx  -> hoja "contabilidad" (EAS, NIT, PAGOS, LETRAS, UDS,
 *     DIALOGO, CUENTA, CORREO)
 *   - plantilla_cuenta_cobro.docx -> plantilla Word con marcadores {CAMPO}
 *
 * El MES y la FECHA del encabezado se calculan solos con la fecha real del
 * dia en que corres el script (no hay que tocar el Excel mes a mes para
 * eso). El CONSECUTIVO tambien sube solo cada mes (ver consecutivos.json).
 *
 * Salida:
 *   reportes/cuentas-cobro/<MES>-<ANIO>/<CONSECUTIVO>_<ASOCIACION>.docx
 *   reportes/cuentas-cobro/<MES>-<ANIO>/<CONSECUTIVO>_<ASOCIACION>.pdf  (si hay LibreOffice)
 *
 * Uso:
 *   node automatizaciones/generar-cuentas-cobro.js
 *
 * Requiere (una sola vez):
 *   npm install docxtemplater pizzip exceljs nodemailer dotenv
 * -------------------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const ExcelJS = require("exceljs");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const readlineSync = require("readline-sync");
const c = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
  rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
  gris:     (t) => `\x1b[90m${t}\x1b[0m`,
};
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { enviarCorreo } = require("../servicios/gmail-sender.js");

// Debe apuntar a las MISMAS variables de entorno que ya usas en gmail-reader.js
// Revisa tu .env y ajusta estos nombres si son distintos.
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

// ---------------------------------------------------------------------------
// CONFIGURACION - ajusta estas rutas a como esten organizadas tus carpetas
// ---------------------------------------------------------------------------
const RUTA_EXCEL_CANDIDATAS = [
  process.env.RUTA_EXCEL_GENERAL,
  "G:\\Mi unidad\\CUENTAME\\0 GENERAL\\GENERAL.xlsx",
  path.join(__dirname, "..", "GENERAL.xlsx"),
  process.env.RUTA_EXCEL,
].filter(Boolean);

const RUTA_EXCEL = RUTA_EXCEL_CANDIDATAS.find((r) => fs.existsSync(r)) || "G:\\Mi unidad\\CUENTAME\\0 GENERAL\\GENERAL.xlsx";
const HOJA_DATOS = "contabilidad";
const RUTA_PLANTILLA = path.join(__dirname, "plantilla_cuenta_cobro.docx");
const CARPETA_SALIDA_BASE = path.join(__dirname, "..", "reportes", "cuentas-cobro");
const CARPETA_LOGS = path.join(__dirname, "..", "logs");
const RUTA_CONSECUTIVOS = path.join(__dirname, "consecutivos.json");

// Numero desde el cual arrancar la primera vez que se genere una cuenta de
// cobro para una asociacion que todavia no tiene historial guardado.
const CONSECUTIVO_INICIAL = 2282;

// Nombre del mes en espanol para el encabezado ("Bogota, {DIA} de {MesTexto} de {ANIO}")
const MESES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function sanitizarNombre(texto) {
  return String(texto)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita tildes
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function formatearPesos(valor) {
  if (!valor && valor !== 0) return "0";
  if (typeof valor === "object") {
    valor = valor.result !== undefined && valor.result !== null ? valor.result : (valor.text || 0);
  }
  let str = String(valor).trim().replace(/[$'\s]/g, "");
  // Si viene con formato colombiano (ej: 130.325 o 130.325,00)
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(str)) {
    str = str.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+(,\d+)?$/.test(str)) {
    str = str.replace(",", ".");
  }
  const num = Number(str);
  return Number.isFinite(num) ? Math.round(num).toLocaleString("es-CO") : String(valor);
}

function obtenerValorCelda(celda) {
  if (!celda) return "";
  const val = celda.value;
  if (val === null || val === undefined) return "";
  if (typeof val === "object") {
    if (val.result !== undefined && val.result !== null) return String(val.result).trim();
    if (val.text !== undefined && val.text !== null) return String(val.text).trim();
    if (val.richText) return val.richText.map((t) => t.text).join("").trim();
  }
  return String(celda.text || val).trim();
}

function log(mensaje) {
  const linea = `[${new Date().toISOString()}] ${mensaje}`;
  console.log(linea);
  fs.mkdirSync(CARPETA_LOGS, { recursive: true });
  fs.appendFileSync(
    path.join(CARPETA_LOGS, "generar-cuentas-cobro.log"),
    linea + "\n"
  );
}

/**
 * Calcula los datos del periodo (DIA, MesTexto, ANIO, Mes, MESMAYUS)
 * para la fecha dada. El DIA siempre es el ULTIMO dia de ese mes (cierre/envio).
 */
function obtenerDatosPeriodo(fechaReferencia) {
  const d = fechaReferencia || new Date();
  const mesIndex = d.getMonth();
  const anio = d.getFullYear();
  const mesTexto = MESES_ES[mesIndex];
  const ultimoDiaDelMes = new Date(anio, mesIndex + 1, 0).getDate();
  return {
    DIA: String(ultimoDiaDelMes),
    MesTexto: mesTexto,
    ANIO: String(anio),
    Mes: mesTexto,
    MESMAYUS: mesTexto.toUpperCase(),
  };
}

function obtenerMesActual() {
  return obtenerDatosPeriodo(new Date());
}

function obtenerMesAnterior() {
  const hoy = new Date();
  return obtenerDatosPeriodo(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1));
}

// ---------------------------------------------------------------------------
// Consecutivo automatico por asociacion (guardado entre corridas)
// ---------------------------------------------------------------------------
function leerConsecutivos() {
  try {
    return JSON.parse(fs.readFileSync(RUTA_CONSECUTIVOS, "utf8"));
  } catch (error) {
    return {}; // primera vez que se corre, no existe el archivo todavia
  }
}

function guardarConsecutivos(consecutivos) {
  fs.writeFileSync(RUTA_CONSECUTIVOS, JSON.stringify(consecutivos, null, 2));
}

/**
 * Calcula el consecutivo que le toca a una asociacion este mes:
 *  - Si nunca se le ha generado nada: arranca en CONSECUTIVO_INICIAL (o en
 *    el valor que traiga de Excel, si es mayor).
 *  - Si ya se le genero este mismo mes antes: repite el mismo numero (no
 *    duplica el consecutivo por volver a correr el script).
 *  - Si es un mes nuevo: sube el numero en 1 respecto al ultimo guardado.
 */
function calcularConsecutivo(consecutivos, datos, mesActual) {
  const clave = datos.NIT;
  const anterior = consecutivos[clave];

  let nuevo;
  if (!anterior) {
    const valorExcel = parseInt(datos.CONSECUTIVO, 10);
    nuevo = Number.isFinite(valorExcel) && valorExcel > CONSECUTIVO_INICIAL
      ? valorExcel
      : CONSECUTIVO_INICIAL;
  } else if (anterior.mes === mesActual) {
    nuevo = anterior.consecutivo; // mismo mes, no incrementa de nuevo
  } else {
    nuevo = anterior.consecutivo + 1; // mes nuevo, sube uno
  }

  consecutivos[clave] = { consecutivo: nuevo, mes: mesActual, asociacion: datos.EAS };
  return nuevo;
}


async function leerAsociaciones() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(RUTA_EXCEL);

  const hoja = workbook.getWorksheet(HOJA_DATOS);
  if (!hoja) {
    throw new Error(`No se encontro la hoja "${HOJA_DATOS}" en ${RUTA_EXCEL}`);
  }

  const encabezados = {};
  hoja.getRow(1).eachCell((celda, colNumero) => {
    encabezados[celda.text.trim()] = colNumero;
  });

  const columnasRequeridas = [
    "EAS", "NIT", "UDS", "PAGOS", "LETRAS", "CONSECUTIVO", "DIALOGO", "CUENTA",
  ];
  for (const col of columnasRequeridas) {
    if (!encabezados[col]) {
      throw new Error(`Falta la columna "${col}" en la hoja "${HOJA_DATOS}"`);
    }
  }

  const asociaciones = [];
  hoja.eachRow((fila, numeroFila) => {
    if (numeroFila === 1) return; // encabezado
    const eas = obtenerValorCelda(fila.getCell(encabezados["EAS"]));
    if (!eas) return; // fila vacia = fin de datos

    const celdaPagos = fila.getCell(encabezados["PAGOS"]);
    const valPagos = celdaPagos.value !== undefined && celdaPagos.value !== null ? celdaPagos.value : celdaPagos.text;

    asociaciones.push({
      EAS: eas,
      NIT: String(obtenerValorCelda(fila.getCell(encabezados["NIT"]))).trim(),
      CORREO: encabezados["CORREO"] ? String(obtenerValorCelda(fila.getCell(encabezados["CORREO"]))).trim() : "",
      UDS: String(obtenerValorCelda(fila.getCell(encabezados["UDS"]))).trim(),
      PAGOS: formatearPesos(valPagos),
      LETRAS: String(obtenerValorCelda(fila.getCell(encabezados["LETRAS"]))).trim(),
      CONSECUTIVO: String(obtenerValorCelda(fila.getCell(encabezados["CONSECUTIVO"]))).trim(),
      DIALOGO: String(obtenerValorCelda(fila.getCell(encabezados["DIALOGO"]))).trim(),
      CUENTA: String(obtenerValorCelda(fila.getCell(encabezados["CUENTA"]))).trim(),
      // Mes, MESMAYUS, DIA, MesTexto, ANIO ya NO se leen de Excel:
      // se calculan automaticamente con la fecha real del dia en que se corre el script.
    });
  });

  return asociaciones;
}

// ---------------------------------------------------------------------------
// 2. Generar un docx a partir de la plantilla + los datos de una asociacion
// ---------------------------------------------------------------------------
function generarDocx(datos, rutaSalidaDocx) {
  const contenido = fs.readFileSync(RUTA_PLANTILLA, "binary");
  const zip = new PizZip(contenido);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

  doc.render(datos);

  const buffer = doc.getZip().generate({ type: "nodebuffer" });
  fs.writeFileSync(rutaSalidaDocx, buffer);
}

// ---------------------------------------------------------------------------
// 3. Convertir a PDF (opcional, requiere LibreOffice instalado)
// ---------------------------------------------------------------------------
// Si "soffice" no esta en el PATH de Windows, probamos las rutas tipicas
// donde LibreOffice se instala por defecto.
const RUTAS_SOFFICE_CANDIDATAS = [
  "soffice", // si esta en el PATH, esto es lo mas simple
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
];

let rutaSofficeEncontrada = null;

function encontrarSoffice() {
  if (rutaSofficeEncontrada) return rutaSofficeEncontrada;
  for (const candidata of RUTAS_SOFFICE_CANDIDATAS) {
    try {
      execSync(`"${candidata}" --version`, { stdio: "pipe" });
      rutaSofficeEncontrada = candidata;
      return candidata;
    } catch (error) {
      // esta ruta no funciono, seguimos probando la siguiente
    }
  }
  return null;
}

function convertirAPdf(rutaDocx, carpetaSalida) {
  const soffice = encontrarSoffice();
  if (!soffice) return false; // LibreOffice no esta instalado en ninguna ruta conocida

  try {
    execSync(
      `"${soffice}" --headless --convert-to pdf --outdir "${carpetaSalida}" "${rutaDocx}"`,
      { stdio: "pipe" }
    );
    return true;
  } catch (error) {
    return false; // fallo la conversion
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  log("Iniciando generacion de cuentas de cobro y paz y salvo...");

  let asociaciones = await leerAsociaciones();
  log(`Se encontraron ${asociaciones.length} asociaciones en "${HOJA_DATOS}".`);

  if (asociaciones.length === 0) {
    log("No hay datos para procesar. Verifica GENERAL.xlsx.");
    return;
  }

  // ---------------------------------------------------------------------------
  // Seleccion del periodo / mes a cobrar
  // ---------------------------------------------------------------------------
  const mesAntInfo = obtenerMesAnterior();
  const mesActInfo = obtenerMesActual();

  console.log(c.amarillo("\n📅 Selecciona el periodo / mes de cobro:"));
  console.log(c.cyan(`[1] Mes anterior: ${mesAntInfo.MesTexto} ${mesAntInfo.ANIO} (Recomendado - Cierre de mes)`));
  console.log(c.cyan(`[2] Mes actual: ${mesActInfo.MesTexto} ${mesActInfo.ANIO}`));
  console.log(c.cyan(`[3] Seleccionar otro mes personalizado...`));
  console.log(c.cyan("[0] Salir"));

  const opcionMesRaw = readlineSync.question("\n  > Escoja una opcion [Enter = 1]: ");
  const opcionMes = (opcionMesRaw ? opcionMesRaw.trim() : "") || "1";

  let fechaActual;
  if (opcionMes === "0") {
    console.log("Saliendo...");
    return;
  } else if (opcionMes === "2") {
    fechaActual = mesActInfo;
  } else if (opcionMes === "3") {
    console.log("\nMeses disponibles:");
    MESES_ES.forEach((m, idx) => console.log(`  ${idx + 1}. ${m}`));
    const mIdx = parseInt(readlineSync.question("\n  > Ingrese el numero del mes (1-12): "), 10);
    const anioDefault = new Date().getFullYear();
    const anioInput = parseInt(readlineSync.question(`  > Ingrese el año [${anioDefault}]: `) || String(anioDefault), 10);
    if (isNaN(mIdx) || mIdx < 1 || mIdx > 12) {
      console.log(c.rojo("Mes invalido. Usando mes anterior por defecto."));
      fechaActual = mesAntInfo;
    } else {
      fechaActual = obtenerDatosPeriodo(new Date(anioInput, mIdx - 1, 1));
    }
  } else {
    fechaActual = mesAntInfo;
  }

  console.log(c.verde(`\n  ✅ Periodo configurado: ${fechaActual.MesTexto} de ${fechaActual.ANIO} (Fecha de corte: ${fechaActual.DIA} de ${fechaActual.MesTexto} de ${fechaActual.ANIO})`));

  const asocActivaRaw = process.env.ASOCIACION_ACTIVA;
  let asocActiva = null;
  if (asocActivaRaw) {
    try {
      asocActiva = JSON.parse(asocActivaRaw);
    } catch (e) {}
  }

  console.log("");
  if (asocActiva) {
    console.log(c.verde(`  ⭐ Asociacion activa en sesión: ${asocActiva.nombreCorto}`));
    console.log(c.cyan(`[1] Generar SOLO para ${asocActiva.nombreCorto}`));
    console.log(c.cyan("[2] Generar para TODAS las asociaciones"));
    console.log(c.cyan("[3] Seleccionar otra asociacion de la lista"));
    console.log(c.cyan("[0] Salir"));
  } else {
    console.log(c.cyan("[1] Generar para TODAS las asociaciones"));
    console.log(c.cyan("[2] Seleccionar UNA asociacion especifica"));
    console.log(c.cyan("[0] Salir"));
  }
  
  const alcance = readlineSync.question("\n  > Escoja una opcion: ");
  
  if (alcance === "0") {
    console.log("Saliendo...");
    return;
  }
  
  if (asocActiva && alcance === "1") {
    const encontrada = asociaciones.find(
      (a) =>
        (asocActiva.nit && a.NIT === String(asocActiva.nit).trim()) ||
        a.EAS.toUpperCase().includes(asocActiva.nombreCorto.toUpperCase())
    );
    if (encontrada) {
      asociaciones = [encontrada];
    } else {
      console.log(c.amarillo(`  ⚠️ No se encontró "${asocActiva.nombreCorto}" en contabilidad. Mostrando lista...`));
    }
  } else if ((!asocActiva && alcance === "2") || (asocActiva && alcance === "3")) {
    console.log("");
    asociaciones.forEach((a, i) => {
      console.log(c.cyan(`[${i + 1}] ${a.EAS}`));
    });
    console.log(c.cyan("[0] Cancelar"));
    
    const asocIdxStr = readlineSync.question(`\n  > Escoja la asociacion [1...${asociaciones.length} / 0]: `);
    const asocIdx = parseInt(asocIdxStr, 10);
    
    if (asocIdx === 0 || isNaN(asocIdx) || asocIdx < 1 || asocIdx > asociaciones.length) {
      console.log("Cancelado.");
      return;
    }
    
    asociaciones = [asociaciones[asocIdx - 1]];
  }

  const { Mes, ANIO } = fechaActual;
  const carpetaSalida = path.join(CARPETA_SALIDA_BASE, `${Mes}-${ANIO}`);
  fs.mkdirSync(carpetaSalida, { recursive: true });

  if (encontrarSoffice()) {
    log(`LibreOffice encontrado en: ${rutaSofficeEncontrada}`);
  } else {
    log(
      "AVISO: no se encontro LibreOffice (ni en el PATH ni en las rutas " +
      "tipicas de instalacion). Se generaran los .docx pero NO los .pdf."
    );
  }

  let generados = 0;
  let convertidosPdf = 0;
  const consecutivos = leerConsecutivos();
  const mesActual = `${Mes}-${ANIO}`;
  const resultados = []; // { EAS, CORREO, Mes, ANIO, CONSECUTIVO, rutaPdf }

  for (const datos of asociaciones) {
    Object.assign(datos, fechaActual); // DIA, MesTexto, ANIO, Mes, MESMAYUS de hoy
    datos.CONSECUTIVO = String(calcularConsecutivo(consecutivos, datos, mesActual));
    const nombreArchivo = `${datos.CONSECUTIVO}_${sanitizarNombre(datos.EAS)}.docx`;
    const rutaDocx = path.join(carpetaSalida, nombreArchivo);

    try {
      generarDocx(datos, rutaDocx);
      generados++;
      log(`OK  -> ${nombreArchivo}`);

      const rutaPdf = rutaDocx.replace(/\.docx$/, ".pdf");
      let tienePdf = false;
      if (convertirAPdf(rutaDocx, carpetaSalida)) {
        convertidosPdf++;
        tienePdf = true;
      }

      resultados.push({ ...datos, rutaPdf, tienePdf });
    } catch (error) {
      log(`ERROR generando ${datos.EAS}: ${error.message}`);
    }
  }

  guardarConsecutivos(consecutivos);

  log(
    `Listo. ${generados}/${asociaciones.length} documentos generados en: ${carpetaSalida}` +
    (convertidosPdf > 0 ? ` (${convertidosPdf} tambien en PDF)` : "")
  );

  await preguntarYEnviar(resultados);
}

// ---------------------------------------------------------------------------
// Al final: pregunta en la terminal si se quiere enviar, y a quien
// ---------------------------------------------------------------------------
async function preguntarYEnviar(resultados) {
  const enviables = resultados.filter((r) => r.tienePdf);

  if (enviables.length === 0) {
    console.log("\nNo hay PDFs generados para enviar (revisa que tengas LibreOffice instalado).");
    return;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const respuesta = (await rl.question(
      "\nDeseas enviar las cuentas de cobro por correo? (s/n): "
    )).trim().toLowerCase();

    if (respuesta !== "s" && respuesta !== "si" && respuesta !== "si") {
      console.log("No se enviaron correos.");
      return;
    }

    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
      console.log("Faltan GMAIL_USER / GMAIL_APP_PASSWORD en tu .env, no se puede enviar.");
      return;
    }

    console.log("\nAsociaciones generadas:");
    enviables.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.EAS}${r.CORREO ? "" : "   (sin CORREO en el Excel)"}`);
    });

    const modo = (await rl.question(
      "\nEnviar a TODAS o SELECCIONAR algunas? (todas/seleccionar): "
    )).trim().toLowerCase();

    let seleccionados;
    if (modo.startsWith("t")) {
      seleccionados = enviables;
    } else {
      const respuestaNumeros = await rl.question(
        "Escribe los numeros separados por coma (ej: 1,3,5): "
      );
      const indices = respuestaNumeros
        .split(",")
        .map((n) => parseInt(n.trim(), 10) - 1)
        .filter((i) => Number.isInteger(i));
      seleccionados = indices.map((i) => enviables[i]).filter(Boolean);
    }

    if (seleccionados.length === 0) {
      console.log("No se selecciono ninguna asociacion valida. No se envio nada.");
      return;
    }

    let enviados = 0;
    for (const r of seleccionados) {
      if (!r.CORREO) {
        log(`AVISO: ${r.EAS} no tiene CORREO en el Excel, no se envio.`);
        continue;
      }
      try {
        await enviarCorreo(GMAIL_USER, GMAIL_APP_PASSWORD, {
          to: r.CORREO,
          subject: `Cuenta de cobro y paz y salvo - ${r.Mes} ${r.ANIO}`,
          text:
            `Buenos dias,\n\nAdjunto la cuenta de cobro N ${r.CONSECUTIVO} ` +
            `y el paz y salvo correspondientes al mes de ${r.Mes}.\n\nCordialmente.`,
          attachments: [{ filename: path.basename(r.rutaPdf), path: r.rutaPdf }],
        });
        enviados++;
        log(`ENVIADO -> ${r.CORREO}`);
      } catch (errorEnvio) {
        log(`ERROR enviando a ${r.CORREO}: ${errorEnvio.message}`);
      }
    }

    log(`Correos enviados: ${enviados}/${seleccionados.length}`);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error("Fallo la automatizacion:", error);
  process.exit(1);
});