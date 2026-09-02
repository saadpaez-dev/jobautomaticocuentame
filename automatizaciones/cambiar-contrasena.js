/**
 * cambiar-contrasena.js
 * -------------------------------------------------------------------------
 * Automatiza el Cambio y Restablecimiento de Contraseña en el sistema Cuéntame ICBF:
 *   1. Cambio de contraseña mensual (conociendo la clave actual).
 *   2. Restablecimiento de contraseña olvidada/expirada (vía correo Gmail).
 *      - Solicita restablecimiento en la plataforma (mts2.icbf.gov.co).
 *      - Lee automáticamente el correo de mts.notificaciones en Gmail.
 *      - Extrae la clave temporal ("Su nueva contraseña temporal es: ...").
 *      - Ingresa a la pantalla de Cambio de Contraseña y aplica la nueva clave.
 *      - Actualiza automáticamente la variable CUENTAME_PASSWORD en el .env.
 * -------------------------------------------------------------------------
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');
const readline = require('readline-sync');
const { obtenerNavegador } = require('../servicios/autenticacion');
const { obtenerContrasenaTemporal } = require('../servicios/gmail-reader');

const c = {
    verde: (t) => `\x1b[32m${t}\x1b[0m`,
    amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
    cyan: (t) => `\x1b[36m${t}\x1b[0m`,
    rojo: (t) => `\x1b[31m${t}\x1b[0m`,
    gris: (t) => `\x1b[90m${t}\x1b[0m`,
    negrita: (t) => `\x1b[1m${t}\x1b[0m`,
};

function actualizarPasswordEnEnv(nuevaClave) {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return false;
    try {
        let content = fs.readFileSync(envPath, 'utf8');
        content = content.replace(/^CUENTAME_PASSWORD=.*$/m, `CUENTAME_PASSWORD=${nuevaClave}`);
        fs.writeFileSync(envPath, content, 'utf8');
        console.log(c.verde(`\n  ✅ Variable CUENTAME_PASSWORD actualizada automáticamente en el archivo .env`));
        return true;
    } catch (e) {
        console.log(c.rojo(`  ⚠️ No se pudo actualizar automáticamente el archivo .env: ${e.message}`));
        return false;
    }
}

async function cambiarClaveEnFormulario(page, { usuario, claveActual, claveNueva }) {
    console.log(c.cyan('\n  🔒 Abriendo formulario "Cambiar contraseña"...'));
    const urlCambiar = 'https://mts2.icbf.gov.co/SeguridadICBF/login.aspx?returnUrl=https%3A%2F%2Frubonline.icbf.gov.co#/cambiarContrasenia';
    await page.goto(urlCambiar, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    console.log(c.amarillo('  ✍️ Llenando datos para cambio de contraseña...'));

    const fillInput = async (selector, value) => {
        const input = page.locator(selector).first();
        await input.click().catch(() => {});
        await input.fill('');
        await input.pressSequentially(value, { delay: 25 }).catch(() => input.fill(value));
        await input.dispatchEvent('change').catch(() => {});
        await input.dispatchEvent('blur').catch(() => {});
    };

    await fillInput('#usuario, input[name="usuario"]', usuario);
    await fillInput('#claveActual, input[name="claveActual"]', claveActual);
    await fillInput('#claveNueva, input[name="claveNueva"]', claveNueva);
    await fillInput('#claveConfirmacion, input[name="claveConfirmacion"]', claveNueva);

    await page.waitForTimeout(500);

    console.log(c.cyan('  🚀 Haciendo clic en "Cambiar contraseña"...'));
    const btnCambiar = page.locator('button:has-text("Cambiar contraseña"), input[type="submit"][value*="Cambiar"]').first();
    
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
        btnCambiar.click()
    ]);

    await page.waitForTimeout(2000);

    const bodyText = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    const exito = bodyText.includes('exitosamente') || bodyText.includes('actualizada') || bodyText.includes('modificada') || !bodyText.includes('error');

    return { exito, bodyText };
}

async function solicitarRestablecimientoClave(page, { usuario, correo }) {
    console.log(c.cyan('\n  📩 Abriendo formulario "Restablecer contraseña"...'));
    const urlRestablecer = 'https://mts2.icbf.gov.co/SeguridadICBF/login.aspx?returnUrl=https%3A%2F%2Frubonline.icbf.gov.co#/restablecerContrasenia';
    await page.goto(urlRestablecer, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    console.log(c.amarillo('  ✍️ Llenando usuario y correo electrónico...'));

    const fillInput = async (selector, value) => {
        const input = page.locator(selector).first();
        await input.click().catch(() => {});
        await input.fill('');
        await input.pressSequentially(value, { delay: 25 }).catch(() => input.fill(value));
    };

    await fillInput('#usuario, input[name="usuario"]', usuario);
    await fillInput('#mail, input[name="mail"]', correo);

    console.log(c.cyan('  🚀 Haciendo clic en "Siguiente"...'));
    const btnSiguiente = page.locator('button:has-text("Siguiente"), input[type="submit"]').first();

    await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
        btnSiguiente.click()
    ]);

    await page.waitForTimeout(2000);
    console.log(c.verde('  ✅ Solicitud enviada a la plataforma Cuéntame.'));
}

async function main() {
    const USUARIO = process.env.CUENTAME_USUARIO;
    const PASSWORD_ACTUAL = process.env.CUENTAME_PASSWORD;
    const GMAIL_USER = process.env.GMAIL_USER;
    const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

    if (!USUARIO || !GMAIL_USER) {
        console.error(c.rojo('\n❌ Faltan CUENTAME_USUARIO o GMAIL_USER en el archivo .env\n'));
        process.exit(1);
    }

    console.log(c.cyan('\n======================================================'));
    console.log(c.cyan('  🔑 GESTION Y CAMBIO DE CONTRASEÑA EN CUÉNTAME'));
    console.log(c.cyan('======================================================\n'));

    console.log(c.amarillo('  Selecciona la acción a realizar:\n'));
    console.log(`  ${c.cyan('1')}. Cambiar Contraseña Mensual (Conozco la contraseña actual)`);
    console.log(`  ${c.cyan('2')}. Restablecer Contraseña Olvidada (Vía Correo Gmail + Clave Temporal)`);
    console.log(`  ${c.cyan('3')}. Proceso Completo Automático (Solicitar + Leer Correo + Cambiar)`);
    console.log(`\n  ${c.rojo('0')}. Volver al menú principal`);

    const opcion = readline.question(c.negrita('\n  > Selecciona una opción (1-3): ')).trim();

    if (opcion === '0') {
        console.log(c.verde('\n  👋 Volviendo al menú principal...'));
        return;
    }

    let claveNueva = '';
    while (claveNueva.length < 8 || claveNueva.length > 15) {
        console.log(c.gris('\n  💡 Requisitos de contraseña en Cuéntame:'));
        console.log(c.gris('     • Entre 8 y 15 caracteres (máximo 15).'));
        console.log(c.gris('     • Debe tener Mayúscula, Minúscula, Número y Carácter especial (ej: Septiembre2026*).'));
        
        const res = readline.question(c.negrita('\n  > Ingresa la NUEVA contraseña deseada (ej: Octubre2026*): ')).trim();
        if (res.length >= 8 && res.length <= 15) {
            claveNueva = res;
        } else {
            console.log(c.rojo('  ❌ La contraseña debe tener entre 8 y 15 caracteres. Inténtalo de nuevo.'));
        }
    }

    const { browser, page } = await obtenerNavegador();

    try {
        if (opcion === '1') {
            // Cambiar contraseña conocida
            const res = await cambiarClaveEnFormulario(page, {
                usuario: USUARIO,
                claveActual: PASSWORD_ACTUAL,
                claveNueva: claveNueva
            });

            if (res.exito) {
                console.log(c.verde('\n  🎉 ¡Contraseña cambiada exitosamente en Cuéntame!'));
                actualizarPasswordEnEnv(claveNueva);
            } else {
                console.log(c.rojo('\n  ❌ Ocurrió un error al cambiar la contraseña.'));
            }

        } else if (opcion === '2' || opcion === '3') {
            // Restablecer por correo
            const fechaInicio = new Date();
            await solicitarRestablecimientoClave(page, { usuario: USUARIO, correo: GMAIL_USER });

            console.log(c.amarillo('\n  📧 Esperando recepción de la contraseña temporal en Gmail...'));
            const claveTemporal = await obtenerContrasenaTemporal(GMAIL_USER, GMAIL_APP_PASSWORD, fechaInicio);

            if (!claveTemporal) {
                console.log(c.rojo('  ❌ No se pudo obtener la contraseña temporal.'));
                return;
            }

            console.log(c.cyan('\n  🔒 Aplicando nueva contraseña en la plataforma con la clave temporal...'));
            const res = await cambiarClaveEnFormulario(page, {
                usuario: USUARIO,
                claveActual: claveTemporal,
                claveNueva: claveNueva
            });

            if (res.exito) {
                console.log(c.verde('\n  🎉 ¡Contraseña restablecida y cambiada exitosamente en Cuéntame!'));
                actualizarPasswordEnEnv(claveNueva);
            } else {
                console.log(c.rojo('\n  ❌ Ocurrió un error al aplicar la nueva contraseña.'));
            }
        }
    } catch (err) {
        console.error(c.rojo(`\n  ❌ Error en el proceso: ${err.message}`));
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

if (require.main === module) {
    main().then(() => process.exit(0)).catch(err => {
        console.error(c.rojo(`\n❌ Error no controlado:`), err.message);
        process.exit(1);
    });
}

module.exports = { main };
