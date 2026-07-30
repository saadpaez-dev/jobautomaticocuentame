const fs = require('fs');
let code = fs.readFileSync('automatizaciones/llenar-asistencia.js', 'utf8');

// Replace the signature of modificarAsistenciaIndividual
code = code.replace(
    /async function modificarAsistenciaIndividual\(mainPage, contentFrame, elegida, mesAtencion, asc\) {/,
    'async function modificarAsistenciaIndividual(workPage, contentFrame, elegida, mesAtencion, asc, selectDropdown) {'
);

// Replace the call to modificarAsistenciaIndividual inside Fase 2
code = code.replace(
    /await modificarAsistenciaIndividual\(mainPage, contentFrame, elegida, mesAtencion, asc\);/g,
    'await modificarAsistenciaIndividual(workPage, contentFrame, elegida, mesAtencion, asc, selectDropdown);'
);

// We need to rewrite the outer part of ejecutarFase2
const fase2Start = `async function ejecutarFase2(asociaciones, mesAtencion) {
    let browser, context, rolesPage;
    let authDone = false;

    while (true) {
        console.log(c.cyan('\\n  📋 [FASE 2] SELECCIONA *UNA SOLA* ASOCIACIÓN:'));
        const opcionesAsc = asociaciones.map(a => \`\${a.nombreCorto} (Contrato: \${a.numeroContrato})\`);
        const ascIdx = readline.keyInSelect(opcionesAsc, c.negrita('  > Escoja la asociación: '), { cancel: 'Salir' });
        
        if (ascIdx === -1) {
            if (browser) {
                console.log(c.verde('\\n  🎉 FASE 2 COMPLETADA CON ÉXITO. Cerrando navegador...'));
                await browser.close();
            }
            process.exit(0);
        }

        const asc = asociaciones[ascIdx];
        console.log(c.verde(\`\\n  ✅ Iniciando Fase 2 en la asociación: \${asc.nombreCorto}\`));

        if (!authDone) {
            const nav = await iniciarNavegador();
            browser = nav.browser;
            context = nav.context;
            rolesPage = nav.mainPage;

            console.log(c.cyan('\\n======================================================'));
            console.log(c.cyan('▶ Iniciando sesión única y 2FA...'));
            console.log(c.cyan('======================================================\\n'));
            await loginYLlegarARoles(rolesPage, { 
                usuario: process.env.CUENTAME_USUARIO, 
                password: process.env.CUENTAME_PASSWORD,
                gmailUser: process.env.GMAIL_USER,
                gmailAppPassword: process.env.GMAIL_APP_PASSWORD
            });
            authDone = true;
        }

        let workPage = rolesPage;
        try {
            console.log('  🏢 Seleccionando entidad (asociación)...');
            workPage = await seleccionarRolYEntrar(rolesPage, asc, true);
            await workPage.bringToFront();
            console.log(c.verde('  ✅ Login exitoso en Cuéntame.'));
            
            console.log('  🚀 Navegando a Unidad -> Registro de asistencia mensual - ram...');
            await workPage.goto('https://rubonline.icbf.gov.co/Page/RUBONLINE/RegistroAsistencia/List.aspx', { waitUntil: 'networkidle', timeout: 60000 });
            await workPage.waitForTimeout(3000);

            let contentFrame = workPage.frame({ name: 'frameContent' }) || workPage.frames().find(f => f.name() === 'frameContent') || workPage;`;

// Replace from 'async function ejecutarFase2...' down to 'let contentFrame = mainPage...'
const regexStart = /async function ejecutarFase2[\s\S]*?let contentFrame = mainPage\.frame[^;]+;/;
code = code.replace(regexStart, fase2Start);

code = code.replace(/async function modificarAsistenciaIndividual\(mainPage,/g, 'async function modificarAsistenciaIndividual(workPage,');
code = code.replace(/await mainPage\.waitForTimeout/g, 'await workPage.waitForTimeout');
code = code.replace(/mainPage\.frame/g, 'workPage.frame');
code = code.replace(/mainPage\.frames/g, 'workPage.frames');

// Replace the end of Fase 2 loop
const replacementEnd = `        } // Fin while true (Menú jardines)
            if (workPage !== rolesPage) {
                await workPage.close();
            }
        } catch (err) {
            console.error(c.rojo(\`  ❌ Ocurrió un error: \${err && err.message ? err.message : err}\`));
            console.error(err); 
            if (workPage !== rolesPage) await workPage.close();
        }
    } // Fin while true (Asociaciones)
}

async function modificar`;

code = code.replace(/        \} \/\/ Fin while true \(Menú jardines\)[\s\S]*?async function modificar/, replacementEnd);

fs.writeFileSync('automatizaciones/llenar-asistencia.js', code);
