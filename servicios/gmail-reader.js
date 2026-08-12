/**
 * gmail-reader.js
 * Lee el código 2FA enviado por el sistema Cuéntame al correo Gmail.
 * El email de Cuéntame es HTML puro codificado en Base64.
 */

const { ImapFlow } = require('imapflow');

const TIMEOUT_MS = 180000;
const POLL_INTERVAL_MS = 3000;

/**
 * Limpia todos los correos de notificaciones de Cuéntame antes de iniciar sesión,
 * para asegurar que no leamos un código viejo por error.
 */
async function limpiarBuzon2FA(gmailUser, appPassword) {
  const cleanPass = (appPassword || '').replace(/\s+/g, '').replace(/["']/g, '');
  const c = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: gmailUser, pass: cleanPass },
    logger: false
  });
  
  try {
    await c.connect();
    const lock = await c.getMailboxLock('INBOX');
    try {
      const todos = await c.search({ from: 'mts.notificaciones@icbf.gov.co' }, { uid: true });
      if (todos && todos.length > 0) {
        await c.messageFlagsAdd(todos, ['\\Deleted'], { uid: true });
        console.log(`  🧹 Limpieza previa: se eliminaron ${todos.length} correos de 2FA antiguos.`);
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.log(`  ⚠️ No se pudo realizar la limpieza previa: ${err.message}`);
  } finally {
    try { await c.logout(); } catch (_) {}
  }
}

/**
 * Espera y obtiene el código 2FA enviado por Cuéntame al Gmail.
 * Asegurándose de leer únicamente correos que llegaron DESPUÉS del login.
 * 
 * @param {string} gmailUser - Correo Gmail (ej: saad.paez@gmail.com)
 * @param {string} appPassword - App Password de 16 caracteres
 * @param {Date} fechaInicio - Momento exacto en que se inició el login
 * @returns {Promise<string>} El código de 6 dígitos
 */
async function obtenerCodigo2FA(gmailUser, appPassword, fechaInicio) {
  const cleanPass = (appPassword || '').replace(/\s+/g, '').replace(/["']/g, '');
  const readline = require('readline-sync');

  if (!gmailUser || !cleanPass) {
    console.log('  ⚠️ Credenciales de Gmail no configuradas en .env. Por favor ingresa el código manualmente.');
    return readline.question('  > Ingresa el código 2FA (6 dígitos): ').trim();
  }

  const c = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: gmailUser, pass: cleanPass },
    logger: false
  });
  
  console.log('  📧 Conectando a Gmail para leer el código 2FA...');
  
  try {
    await c.connect();
    const deadline = Date.now() + TIMEOUT_MS;
    
    while (Date.now() < deadline) {
      const lock = await c.getMailboxLock('INBOX');
      try {
        // IMAP NOOP es necesario para refrescar la bandeja y detectar correos nuevos
        await c.noop();
        const todos = await c.search({ from: 'mts.notificaciones@icbf.gov.co' }, { uid: true });
        
        // Iterar de más nuevo a más viejo
        for (let i = todos.length - 1; i >= 0; i--) {
          const uid = todos[i];
          const msg = await c.fetchOne(uid, { internalDate: true }, { uid: true });
          
          if (msg && msg.internalDate) {
            const fechaBuffer = new Date(fechaInicio.getTime() - 180000);
            if (msg.internalDate >= fechaBuffer) {
              const m = await c.fetchOne(uid, { bodyParts: ['1'] }, { uid: true });
              if (m && m.bodyParts && m.bodyParts.get('1')) {
                const html = Buffer.from(m.bodyParts.get('1').toString('ascii'), 'base64').toString('utf8');
                const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
                const match = text.match(/\b(\d{6})\b/);
                if (match && match[1]) {
                  console.log(`\n  ✅ Código 2FA recibido automáticamente: ${match[1]}`);
                  
                  // Limpiar todos los correos de ICBF en la bandeja de entrada
                  if (todos && todos.length > 0) {
                    try {
                      await c.messageFlagsAdd(todos, ['\\Deleted'], { uid: true });
                      console.log(`  🧹 Limpiados ${todos.length} correos de 2FA del buzón.`);
                    } catch (errDel) {
                      console.log(`  ⚠️ No se pudieron limpiar los correos: ${errDel.message}`);
                    }
                  }
                  
                  lock.release();
                  try { await c.logout(); } catch (_) {}
                  return match[1];
                }
              }
            }
          }
        }
      } finally {
        lock.release();
      }
      
      const seg = Math.round((deadline - Date.now()) / 1000);
      process.stdout.write(`\r  ⏳ Esperando código de Cuéntame... (${seg}s)  `);
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  } catch (err) {
    console.log(`\n  ⚠️ No se pudo leer el correo automáticamente de Gmail: ${err.message}`);
  } finally {
    try { await c.logout(); } catch (_) {}
  }

  // Fallback si falla la conexión IMAP o si expira el tiempo
  console.log('\n  👉 Ingresa manualmente el código 2FA recibido en tu correo.');
  let codManual = '';
  while (!/^\d{6}$/.test(codManual)) {
    codManual = readline.question('  > Ingresa el código 2FA (6 dígitos): ').trim();
    if (!/^\d{6}$/.test(codManual)) {
      console.log('  ⚠️ El código debe tener 6 dígitos numéricos. Inténtalo de nuevo.');
    }
  }
  return codManual;
}

module.exports = { obtenerCodigo2FA, limpiarBuzon2FA };
