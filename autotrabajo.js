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
    console.log(c.verde(c.negrita('                      🚀 SUITE DE AUTOMATIZACIÓN CENTRALIZADA 🚀')));
    console.log(c.gris('   =====================================================================================\n'));
}

function runScript(scriptName) {
    const scriptPath = path.join(__dirname, 'automatizaciones', scriptName);
    console.log(c.amarillo(`\n>>> Iniciando módulo: ${scriptName} ...\n`));
    
    // stdio: 'inherit' permite que los logs y prompts se conecten a esta misma terminal
    const result = spawnSync(process.execPath, [scriptPath], { stdio: 'inherit' });
    
    if (result.error) {
        console.error(c.rojo(`\n❌ Error al intentar ejecutar el script: ${result.error.message}`));
        readline.question(c.negrita('\nPresiona ENTER para volver al menú principal...'));
    } else if (result.status !== 0 && result.status !== null) {
        console.error(c.rojo(`\n⚠️ El módulo finalizó con código de salida: ${result.status}`));
        readline.question(c.negrita('\nPresiona ENTER para volver al menú principal...'));
    }
}

async function iniciarBraveAutomatico() {
    return new Promise((resolve) => {
        const http = require('http');
        const req = http.get('http://localhost:9222/json/version', (res) => {
            if (res.statusCode === 200) {
                resolve(true); // Ya está corriendo
            } else {
                resolve(false);
            }
        }).on('error', () => {
            resolve(false); // No está corriendo
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

    console.log(c.amarillo('\n  🔍 Verificando si el navegador está abierto...'));
    const navegadorAbierto = await iniciarBraveAutomatico();

    if (!navegadorAbierto) {
        console.log(c.cyan('  🚀 Abriendo Brave automáticamente en Modo Humano...'));
        // Añadimos banderas para evitar que restaure pestañas viejas o muestre el globo de "restaurar sesión"
        const comandoBrave = `start brave.exe --remote-debugging-port=9222 --no-first-run --no-default-browser-check --disable-session-crashed-bubble --disable-infobars --user-data-dir="%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\User Data Bot" https://rubonline.icbf.gov.co`;
        exec(comandoBrave);
        // Esperar a que el navegador abra completamente
        console.log(c.gris('  ⏳ Esperando a que Brave inicie (5 segundos)...'));
        await new Promise(r => setTimeout(r, 5000));
    }

    // Conectar al navegador vía CDP y hacer login automático
    try {
        console.log(c.cyan('  🔗 Conectando al navegador y verificando sesión en Cuéntame...'));
        const browser = await chromium.connectOverCDP('http://localhost:9222');
        const context = browser.contexts()[0];
        
        // Buscar pestaña de Cuéntame o crear una nueva
        let page = context.pages().find(p => p.url().includes('rubonline.icbf.gov.co'));
        if (!page) {
            page = context.pages()[0] || await context.newPage();
            await page.goto('https://rubonline.icbf.gov.co/DefaultF.aspx', { waitUntil: 'networkidle', timeout: 30000 });
        }
        
        // Cerrar cualquier otra pestaña que se haya quedado guardada en caché (para no estorbar)
        const allPages = context.pages();
        for (const p of allPages) {
            if (p !== page) {
                await p.close().catch(()=>{});
            }
        }

        // Verificar si ya hay sesión activa
        const urlActual = page.url();
        const textoActual = await page.evaluate(() => document.body.innerText).catch(() => '');
        
        const esLoginO2FA = textoActual.includes('Iniciar Sesión') || 
                            textoActual.includes('Ingrese su código') || 
                            textoActual.includes('Se ha enviado un código') || 
                            textoActual.includes('¿Olvidaste tu Contraseña?');

        const sesionActiva = !esLoginO2FA && (
            urlActual.includes('MasterPrincipal') || 
            urlActual.includes('Roles.aspx') || 
            textoActual.includes('Seleccione la entidad')
        );

        if (sesionActiva) {
            console.log(c.verde('  ✅ Sesión activa detectada en Cuéntame. ¡Listo para trabajar!\n'));
        } else {
            console.log(c.amarillo('  🔐 Autenticando en Cuéntame (procesando 2FA)...'));
            await loginYLlegarARoles(page, {
                usuario: USUARIO,
                password: PASSWORD,
                gmailUser: GMAIL_USER,
                gmailAppPassword: GMAIL_APP_PASSWORD
            });
            console.log(c.verde('  ✅ Autenticación completada. ¡Cuéntame listo para operar!\n'));
        }
        
        await browser.disconnect().catch(() => {});
    } catch (err) {
        console.log(c.amarillo(`  ⚠️ No se pudo verificar sesión automáticamente: ${err.message.slice(0, 60)}`));
        console.log(c.gris('  (Continúa de todas formas, cada módulo manejará su propia sesión)\n'));
    }

    while (true) {
        banner();
        
        console.log(c.amarillo('  Selecciona la herramienta que deseas ejecutar:\n'));
        
        const opciones = [
            { nombre: 'Consulta de Activos', archivo: 'consulta-activos.js' },
            { nombre: 'Descargar Reportes', archivo: 'descargar-reportes.js' },
            { nombre: 'Llenar Asistencia Mensual', archivo: 'llenar-asistencia.js' },
            { nombre: 'Seguimiento Nutricional (Peso y Talla)', archivo: 'peso-talla.js' },
            { nombre: 'Comparar Activos vs Nutrición (Faltantes)', archivo: 'comparar-nutricion.js' },
            { nombre: 'Pre-llenar Formatos para Madres (Peso y Talla)', archivo: 'prellenar-formatos.js' },
            { nombre: 'Estimar Peso y Talla Ideal a Fecha de Hoy (Cols U, V, W)', archivo: 'estimar-peso-talla.js' },
            { nombre: 'Formación a Familias', archivo: 'formacion-familias.js' },
            { nombre: 'Generar Cuentas de Cobro', archivo: 'generar-cuentas-cobro.js' },
            { nombre: 'Vinculación Beneficiarios', archivo: 'vinculacion-beneficiarios.js' },
            { nombre: 'Desvinculación Beneficiarios', archivo: 'desvinculacion-beneficiarios.js' },
            { nombre: 'Generar Ticket de Errores de Digitación', archivo: 'generar-ticket-errores.js' }
        ];
        
        opciones.forEach((opc, index) => {
            console.log(`  ${c.cyan(index + 1)}. ${opc.nombre}`);
        });
        console.log(`\n  ${c.rojo('0')}. Salir de AutoTrabajo`);
        console.log(`  ${c.rojo('X')}. 🔴 Cerrar Trabajo (cierra Brave + terminal)`);
        
        const respuestaRaw = readline.question(c.negrita('\n  > Ingresa tu opcion: '));
        const respuesta = respuestaRaw ? respuestaRaw.trim() : '';

        if (respuesta === '0') {
            console.log(c.verde('\n  👋 ¡Hasta luego! Cerrando AutoTrabajo.\n'));
            break;
        } else if (respuesta.toUpperCase() === 'X') {
            console.log(c.rojo('\n  🔴 Cerrando Brave y finalizando sesión de trabajo...'));
            try {
                const { exec } = require('child_process');
                // Cerrar Brave
                exec('taskkill /IM brave.exe /F', (err) => {
                    if (err) console.log(c.amarillo('  ⚠️ No se pudo cerrar Brave (puede que ya esté cerrado).'));
                    else console.log(c.verde('  ✅ Brave cerrado.'));
                });
                await new Promise(r => setTimeout(r, 1500));
            } catch(e) {
                console.log(c.amarillo(`  ⚠️ Error cerrando navegador: ${e.message}`));
            }
            console.log(c.verde('  👋 ¡Trabajo finalizado! Cerrando terminal...\n'));
            setTimeout(() => process.exit(0), 1000);
            break;
        } else if (/^\d+$/.test(respuesta)) {
            const opcionInt = parseInt(respuesta, 10);
            if (opcionInt >= 1 && opcionInt <= opciones.length) {
                const opcSeleccionada = opciones[opcionInt - 1];
                runScript(opcSeleccionada.archivo);
            } else {
                console.log(c.rojo(`\n  ❌ Opción "${respuesta}" fuera de rango (1-${opciones.length}). Inténtalo de nuevo.`));
                readline.question(c.gris('  Presiona ENTER para continuar...'));
            }
        } else {
            console.log(c.rojo('\n  ❌ Opción inválida. Inténtalo de nuevo.'));
            readline.question(c.gris('  Presiona ENTER para continuar...'));
        }
    }
}

main();
