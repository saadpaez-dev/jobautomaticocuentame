const { spawnSync } = require('child_process');
const path = require('path');
const readline = require('readline-sync');

const c = {
    verde: (t) => `\x1b[32m${t}\x1b[0m`,
    amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
    cyan: (t) => `\x1b[36m${t}\x1b[0m`,
    rojo: (t) => `\x1b[31m${t}\x1b[0m`,
    gris: (t) => `\x1b[90m${t}\x1b[0m`,
    negrita: (t) => `\x1b[1m${t}\x1b[0m`,
};

function banner() {
    console.clear();
    console.log(c.cyan(`
   █████╗ ██╗   ██╗████████╗███████╗████████╗██████╗  █████╗ ██████╗  █████╗      ██╗ ██████╗ 
  ██╔══██╗██║   ██║╚══██╔══╝██╔════╝╚══██╔══╝██╔══██╗██╔══██╗██╔══██╗██╔══██╗     ██║██╔═══██╗
  ███████║██║   ██║   ██║   █████╗     ██║   ██████╔╝███████║██████╔╝███████║     ██║██║   ██║
  ██╔══██║██║   ██║   ██║   ██╔══╝     ██║   ██╔══██╗██╔══██║██╔══██╗██╔══██║██   ██║██║   ██║
  ██║  ██║╚██████╔╝   ██║   ███████╗   ██║   ██║  ██║██║  ██║██████╔╝██║  ██║╚█████╔╝╚██████╔╝
  ╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝ ╚════╝  ╚═════╝ 
    `));
    console.log(c.verde(c.negrita('                      🚀 SUITE DE AUTOMATIZACION CENTRALIZADA 🚀')));
    console.log(c.gris('   =====================================================================================\n'));
}

function runScript(scriptName) {
    const scriptPath = path.join(__dirname, 'automatizaciones', scriptName);
    console.log(c.amarillo(`\n>>> Iniciando modulo: ${scriptName} ...\n`));
    
    // stdio: 'inherit' permite que los logs y prompts se conecten a esta misma terminal
    const result = spawnSync(process.execPath, [scriptPath], { stdio: 'inherit' });
    
    if (result.error) {
        console.error(c.rojo(`\n❌ Error al intentar ejecutar el script: ${result.error.message}`));
        readline.question(c.negrita('\nPresiona ENTER para volver al menu principal...'));
    } else if (result.status !== 0 && result.status !== null) {
        console.error(c.rojo(`\n⚠️ El modulo finalizo con codigo de salida: ${result.status}`));
        readline.question(c.negrita('\nPresiona ENTER para volver al menu principal...'));
    }
}

async function iniciarEdgeAutomatico() {
    return new Promise((resolve) => {
        const http = require('http');
        const req = http.get('http://localhost:9333/json/version', (res) => {
            if (res.statusCode === 200) {
                resolve(true); // Ya esta corriendo
            } else {
                resolve(false);
            }
        }).on('error', () => {
            resolve(false); // No esta corriendo
        });
        req.setTimeout(1000, () => {
            req.abort();
            resolve(false);
        });
    });
}

async function main() {
    require('dotenv').config();
    const { exec } = require('child_process');
    const { chromium } = require('playwright');
    const { loginYLlegarARoles } = require('./servicios/autenticacion');

    const USUARIO = process.env.CUENTAME_USUARIO;
    const PASSWORD = process.env.CUENTAME_PASSWORD;
    const GMAIL_USER = process.env.GMAIL_USER;
    const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

    console.log(c.amarillo('\n  🔍 Verificando si el navegador esta abierto...'));
    const navegadorAbierto = await iniciarEdgeAutomatico();

    if (!navegadorAbierto) {
        console.log(c.cyan('  🚀 Abriendo Microsoft Edge automaticamente en Modo Humano...'));
        // Anadimos banderas para evitar que restaure pestanas viejas o muestre el globo de "restaurar sesion"
        const comandoEdge = `start msedge.exe --remote-debugging-port=9333 --no-first-run --no-default-browser-check --disable-session-crashed-bubble --disable-infobars --user-data-dir="%LOCALAPPDATA%\\Microsoft\\Edge\\User Data Bot" https://rubonline.icbf.gov.co`;
        exec(comandoEdge);
        // Esperar a que el navegador abra completamente
        console.log(c.gris('  ⏳ Esperando a que Edge inicie (5 segundos)...'));
        await new Promise(r => setTimeout(r, 5000));
    }

    // Conectar al navegador via CDP y hacer login automatico
    try {
        console.log(c.cyan('  🔌 Conectando al navegador y verificando sesion en Cuentame...'));
        const browser = await chromium.connectOverCDP('http://localhost:9333');
        const context = browser.contexts()[0];
        
        // Buscar pestana de Cuentame o crear una nueva
        let page = context.pages().find(p => p.url().includes('rubonline.icbf.gov.co'));
        if (!page) {
            page = context.pages()[0] || await context.newPage();
            await page.goto('https://rubonline.icbf.gov.co/DefaultF.aspx', { waitUntil: 'networkidle', timeout: 30000 });
        }
        
        // Cerrar cualquier otra pestana que se haya quedado guardada en cache (para no estorbar)
        const allPages = context.pages();
        for (const p of allPages) {
            if (p !== page) {
                await p.close().catch(()=>{});
            }
        }

        // Verificar si ya hay sesion activa
        const urlActual = page.url();
        const textoActual = await page.evaluate(() => document.body.innerText).catch(() => '');
        
        const esLoginO2FA = textoActual.includes('Iniciar Sesion') || 
                            textoActual.includes('Ingrese su codigo') || 
                            textoActual.includes('Se ha enviado un codigo') || 
                            textoActual.includes('Olvidaste tu Contrasena?');

        const sesionActiva = !esLoginO2FA && (
            urlActual.includes('MasterPrincipal') || 
            urlActual.includes('Roles.aspx') || 
            textoActual.includes('Seleccione la entidad')
        );

        if (sesionActiva) {
            console.log(c.verde('  ✅ Sesion activa detectada en Cuentame. Listo para trabajar!\n'));
        } else {
            console.log(c.amarillo('  🔐 Autenticando en Cuentame (procesando 2FA)...'));
            await loginYLlegarARoles(page, {
                usuario: USUARIO,
                password: PASSWORD,
                gmailUser: GMAIL_USER,
                gmailAppPassword: GMAIL_APP_PASSWORD
            });
            console.log(c.verde('  ✅ Autenticacion completada. Cuentame listo para operar!\n'));
        }
        
        await browser.close().catch(() => {});
    } catch (err) {
        console.log(c.amarillo(`  ⚠️ No se pudo verificar sesion automaticamente: ${err.message.slice(0, 60)}`));
        console.log(c.gris('  (Continua de todas formas, cada modulo manejara su propia sesion)\n'));
    }

    const { leerJardines } = require('./servicios/excel-reader');
    const RUTA_EXCEL = process.env.RUTA_EXCEL || 'C:\\GENERAL_BOTS.xlsx';
    let porAsociacion;
    try {
        const datos = leerJardines(RUTA_EXCEL);
        porAsociacion = datos.porAsociacion;
    } catch (e) {
        console.log(c.rojo(`  ❌ Error leyendo Excel de asociaciones: ${e.message}`));
        porAsociacion = {};
    }
    
    let asociaciones = Object.values(porAsociacion);

    while (true) {
        banner();
        
        console.log(c.amarillo('  Selecciona la asociacion con la que vas a trabajar:\n'));
        asociaciones.forEach((asc, idx) => {
            console.log(`  ${c.cyan(idx + 1)}. ${asc.nombreCorto} (Contrato: ${asc.numeroContrato || 'N/A'})`);
        });
        console.log(`\n  ${c.rojo('0')}. Salir de AutoTrabajo`);
        console.log(`  ${c.rojo('X')}. 🔴 Cerrar Trabajo (cierra Edge + terminal)`);
        
        const ascResRaw = readline.question(c.negrita('\n  > Ingresa el numero de la asociacion: '));
        const ascRes = ascResRaw ? ascResRaw.trim() : '';

        if (ascRes === '0') {
            console.log(c.verde('\n  👋 Hasta luego! Cerrando AutoTrabajo.\n'));
            break;
        } else if (ascRes.toUpperCase() === 'X') {
            console.log(c.rojo('\n  🔴 Cerrando Edge y finalizando sesion de trabajo...'));
            try {
                const { exec } = require('child_process');
                exec('taskkill /IM msedge.exe /F', (err) => {
                    if (err) console.log(c.amarillo('  ⚠️ No se pudo cerrar Edge (puede que ya este cerrado).'));
                    else console.log(c.verde('  ✅ Edge cerrado.'));
                });
                await new Promise(r => setTimeout(r, 1500));
            } catch(e) {}
            console.log(c.verde('  👋 Trabajo finalizado! Cerrando terminal...\n'));
            setTimeout(() => process.exit(0), 1000);
            break;
        }

        const ascInt = parseInt(ascRes, 10);
        if (isNaN(ascInt) || ascInt < 1 || ascInt > asociaciones.length) {
            console.log(c.rojo(`\n  ❌ Opcion "${ascRes}" invalida. Intentalo de nuevo.`));
            readline.question(c.gris('  Presiona ENTER para continuar...'));
            continue;
        }

        const asociacionElegida = asociaciones[ascInt - 1];
        // Guardar globalmente la asociacion (en string)
        process.env.ASOCIACION_ACTIVA = JSON.stringify(asociacionElegida);
        
        // --- LOOP DEL MENU DE HERRAMIENTAS ---
        while (true) {
            banner();
            console.log(c.verde(`  ✅ Asociacion Activa: ${asociacionElegida.nombreCorto}`));
            console.log(c.amarillo('\n  Selecciona la herramienta que deseas ejecutar:\n'));
            
            const opciones = [
                { nombre: 'Consulta de Activos', archivo: 'consulta-activos.js' },
                { nombre: 'Descargar Reportes', archivo: 'descargar-reportes.js' },
                { nombre: 'Llenar Asistencia Mensual', archivo: 'llenar-asistencia.js' },
                { nombre: 'Seguimiento Nutricional (Peso y Talla)', archivo: 'peso-talla.js' },
                { nombre: 'Comparar Activos vs Nutricion (Faltantes)', archivo: 'comparar-nutricion.js' },
                { nombre: 'Pre-llenar Formatos para Madres (Peso y Talla)', archivo: 'prellenar-formatos.js' },
                { nombre: 'Estimar Peso y Talla Ideal a Fecha de Hoy (Cols U, V, W)', archivo: 'estimar-peso-talla.js' },
                { nombre: 'Formacion a Familias', archivo: 'formacion-familias.js' },
                { nombre: 'Generar Cuentas de Cobro', archivo: 'generar-cuentas-cobro.js' },
                { nombre: 'Vinculacion Beneficiarios', archivo: 'vinculacion-beneficiarios.js' },
                { nombre: 'Desvinculacion Beneficiarios', archivo: 'desvinculacion-beneficiarios.js' },
                { nombre: 'Generar Ticket de Errores de Digitacion', archivo: 'generar-ticket-errores.js' }
            ];
            
            opciones.forEach((opc, index) => {
                console.log(`  ${c.cyan(index + 1)}. ${opc.nombre}`);
            });
            console.log(`\n  ${c.rojo('0')}. Cambiar de Asociacion`);
            
            const respuestaRaw = readline.question(c.negrita('\n  > Ingresa tu opcion: '));
            const respuesta = respuestaRaw ? respuestaRaw.trim() : '';

            if (respuesta === '0') {
                break; // rompe el loop de herramientas y vuelve a preguntar la asociacion
            } else if (/^\d+$/.test(respuesta)) {
                const opcionInt = parseInt(respuesta, 10);
                if (opcionInt >= 1 && opcionInt <= opciones.length) {
                    const opcSeleccionada = opciones[opcionInt - 1];
                    runScript(opcSeleccionada.archivo);
                } else {
                    console.log(c.rojo(`\n  ❌ Opcion "${respuesta}" fuera de rango (1-${opciones.length}). Intentalo de nuevo.`));
                    readline.question(c.gris('  Presiona ENTER para continuar...'));
                }
            } else {
                console.log(c.rojo('\n  ❌ Opcion invalida. Intentalo de nuevo.'));
                readline.question(c.gris('  Presiona ENTER para continuar...'));
            }
        }
    }
}

main();
