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
    const result = spawnSync('node', [scriptPath], { stdio: 'inherit' });
    
    if (result.error) {
        console.error(c.rojo(`\n❌ Error al intentar ejecutar el script: ${result.error.message}`));
    }
    
    console.log(c.gris(`\n<<< Módulo ${scriptName} finalizado.`));
    readline.question(c.negrita('\nPresiona ENTER para volver al menú principal...'));
}

function main() {
    while (true) {
        banner();
        
        console.log(c.amarillo('  Selecciona la herramienta que deseas ejecutar:\n'));
        
        const opciones = [
            { nombre: 'Consulta de Activos / Desvinculación', archivo: 'consulta-activos.js' },
            { nombre: 'Descargar Reportes', archivo: 'descargar-reportes.js' },
            { nombre: 'Llenar Asistencia Mensual', archivo: 'llenar-asistencia.js' },
            { nombre: 'Seguimiento Nutricional (Peso y Talla)', archivo: 'peso-talla.js' },
            { nombre: 'Formación a Familias', archivo: 'formacion-familias.js' },
            { nombre: 'Generar Cuentas de Cobro', archivo: 'generar-cuentas-cobro.js' }
        ];
        
        opciones.forEach((opc, index) => {
            console.log(`  ${c.cyan(index + 1)}. ${opc.nombre}`);
        });
        console.log(`\n  ${c.rojo('0')}. Salir de AutoTrabajo`);
        
        const respuesta = readline.question(c.negrita('\n  > Ingresa tu opcion: '));
        const opcionInt = parseInt(respuesta, 10);
        
        if (opcionInt === 0) {
            console.log(c.verde('\n  👋 ¡Hasta luego! Cerrando AutoTrabajo.\n'));
            break;
        } else if (opcionInt >= 1 && opcionInt <= opciones.length) {
            const opcSeleccionada = opciones[opcionInt - 1];
            runScript(opcSeleccionada.archivo);
        } else {
            console.log(c.rojo('\n  ❌ Opción inválida. Inténtalo de nuevo.'));
            readline.question(c.gris('  Presiona ENTER para continuar...'));
        }
    }
}

main();
