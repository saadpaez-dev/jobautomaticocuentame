/**
 * test-login.js
 * Prueba SOLO el proceso de login + 2FA.
 * No hace ningún registro — solo verifica que podemos entrar al sistema.
 *
 * Uso: node test-login.js
 */

require('dotenv').config();
const { chromium } = require('playwright');

const URL_LOGIN = 'https://rubonline.icbf.gov.co/DefaultF.aspx';

async function testLogin() {
  console.log('\n🧪 Prueba de Login en Cuéntame\n');
  console.log('   Usuario:', process.env.CUENTAME_USUARIO);
  console.log('   Gmail:  ', process.env.GMAIL_USER);

  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const page = await browser.newPage();

  try {
    console.log('\n1. Abriendo página de login...');
    await page.goto(URL_LOGIN, { waitUntil: 'networkidle', timeout: 30000 });
    await page.screenshot({ path: 'logs/login-01-pagina-inicial.png' });
    console.log('   ✅ Página cargada');

    console.log('2. Ingresando usuario y contraseña...');
    await page.locator('input[type="text"]').first().fill(process.env.CUENTAME_USUARIO);
    await page.locator('input[type="password"]').first().fill(process.env.CUENTAME_PASSWORD);
    await page.screenshot({ path: 'logs/login-02-credenciales.png' });

    await page.locator('input[value="Iniciar Sesión"], input[type="submit"]').first().click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'logs/login-03-despues-click.png' });

    const urlTras = page.url();
    const contenido = await page.content();

    // Verificar si la cuenta fue bloqueada
    if (contenido.includes('bloqueado') || contenido.includes('número de intentos')) {
      console.error('\n❌ CUENTA BLOQUEADA: Demasiados intentos fallidos.');
      console.error('   Ve a rubonline.icbf.gov.co y usa "¿Olvidaste tu Contraseña?" para desbloquear.\n');
      await page.screenshot({ path: 'logs/login-BLOQUEADO.png' });
      await browser.close();
      return;
    }

    // Detectar si hay campo de asociación primero (paso intermedio)
    if (contenido.includes('Entidad') || contenido.includes('Seleccione')) {
      console.log('3. Detectada selección de entidad/asociación...');
      // Tomar screenshot para ver qué pide
      await page.screenshot({ path: 'logs/login-04-seleccion-entidad.png' });
      console.log('   📸 Screenshot guardado: logs/login-04-seleccion-entidad.png');
    }

    // Detectar si hay campo de 2FA
    const tiene2FA =
      urlTras.includes('DefaultF') &&
      (contenido.toLowerCase().includes('código') ||
       contenido.toLowerCase().includes('codigo') ||
       contenido.toLowerCase().includes('verificaci'));

    if (tiene2FA) {
      console.log('3. 📨 Sistema solicita código 2FA...');
      await page.screenshot({ path: 'logs/login-04-pantalla-2fa.png' });
      console.log('   📸 Screenshot guardado: logs/login-04-pantalla-2fa.png');

      // Leer el código del Gmail
      const { obtenerCodigo2FA } = require('./servicios/gmail-reader');
      console.log('4. Leyendo código del Gmail...');
      const codigo = await obtenerCodigo2FA(
        process.env.GMAIL_USER,
        process.env.GMAIL_APP_PASSWORD
      );
      console.log(`\n   ✅ Código obtenido: ${codigo}`);

      // Mostrar todos los inputs disponibles para entender la estructura
      const inputs = await page.locator('input').all();
      console.log(`\n   Inputs en la página: ${inputs.length}`);
      for (let i = 0; i < inputs.length; i++) {
        const tipo = await inputs[i].getAttribute('type').catch(() => '?');
        const id   = await inputs[i].getAttribute('id').catch(() => '?');
        const name = await inputs[i].getAttribute('name').catch(() => '?');
        console.log(`     [${i}] type=${tipo} id=${id} name=${name}`);
      }

      // Ingresar código
      await page.locator('input[type="text"]').first().fill(codigo);
      await page.screenshot({ path: 'logs/login-05-codigo-ingresado.png' });

      const botones = await page.locator('input[type="submit"], input[type="button"], button').all();
      console.log(`\n   Botones en la página: ${botones.length}`);
      await botones[0].click();
      await page.waitForTimeout(4000);
    }

    // Comprobar si hay selección de entidad después del 2FA
    const contenidoFinal = await page.content();
    if (contenidoFinal.includes('Seleccione la entidad')) {
      console.log('\n5. 🏢 Pantalla de selección de entidad detectada.');
      const selectores = await page.locator('select').all();
      if (selectores.length > 0) {
        const opciones = await selectores[0].locator('option').allTextContents();
        console.log('   Opciones de entidad disponibles:');
        opciones.forEach((op, i) => console.log(`     [${i}] ${op.trim()}`));

        if (opciones.length > 1) {
          console.log(`   Seleccionando la opción [1]: ${opciones[1].trim()}`);
          await selectores[0].selectOption({ index: 1 });
          await page.waitForTimeout(1000);
          await page.locator('input[value="Continuar"], button:has-text("Continuar")').first().click();
          await page.waitForTimeout(4000);
          await page.screenshot({ path: 'logs/login-07-despues-entidad.png' });
        }
      }
    }

    await page.screenshot({ path: 'logs/login-08-resultado-final.png' });
    const urlFinal = page.url();
    console.log('\n   URL final:', urlFinal);

    if (urlFinal.includes('MasterPrincipal') || urlFinal.includes('General')) {
      console.log('\n✅ LOGIN EXITOSO — El bot puede entrar al sistema.\n');
    } else {
      console.log('\n⚠️  Login completado pero verificar el resultado en las capturas de logs/\n');
    }

  } catch (err) {
    console.error('\n❌ Error durante el login:', err.message);
    await page.screenshot({ path: 'logs/login-error.png' }).catch(() => {});
  }

  console.log('Cierra el navegador manualmente cuando termines de revisar.');
  // Mantener abierto 30 segundos para que puedas ver el resultado
  await page.waitForTimeout(30000);
  await browser.close();
}

// Crear carpeta logs si no existe
const fs = require('fs');
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

testLogin().catch(console.error);
