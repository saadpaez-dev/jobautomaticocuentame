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
  if (!gmailUser || !cleanPass) return;

  const c = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: gmailUser, pass: cleanPass },
    logger: false
  });
  
  try {
    await c.connect();
    const lock = await c.getMailboxLock('INBOX');
    try {
      const status = await c.status('INBOX', { messages: true });
      const total = status.messages || 0;
      if (total > 0) {
        const startSeq = Math.max(1, total - 25);
        const toDeleteUids = [];
        for await (let msg of c.fetch(`${startSeq}:${total}`, { envelope: true, uid: true })) {
          const fromAddr = msg.envelope && msg.envelope.from && msg.envelope.from[0] ? msg.envelope.from[0].address.toLowerCase() : '';
          const subj = msg.envelope ? (msg.envelope.subject || '').toLowerCase() : '';
          if (fromAddr.includes('icbf.gov.co') || subj.includes('cuentame') || subj.includes('codigo') || subj.includes('código')) {
            toDeleteUids.push(msg.uid);
          }
        }
        if (toDeleteUids.length > 0) {
          await c.messageFlagsAdd(toDeleteUids, ['\\Deleted'], { uid: true });
          console.log(`  🧹 Limpieza previa: se eliminaron ${toDeleteUids.length} correos de 2FA antiguos.`);
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    // Si falla la limpieza previa, ignorar silenciosamente
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
        const status = await c.status('INBOX', { messages: true });
        const total = status.messages || 0;
        
        if (total > 0) {
          const startSeq = Math.max(1, total - 15);
          const uidsParaBorrar = [];

          for await (let msg of c.fetch(`${startSeq}:${total}`, { envelope: true, internalDate: true, source: true, uid: true })) {
            const fromAddr = msg.envelope && msg.envelope.from && msg.envelope.from[0] ? msg.envelope.from[0].address.toLowerCase() : '';
            const subj = msg.envelope ? (msg.envelope.subject || '').toLowerCase() : '';
            
            if (fromAddr.includes('icbf.gov.co') || subj.includes('cuentame') || subj.includes('codigo') || subj.includes('código')) {
              uidsParaBorrar.push(msg.uid);
              const fechaBuffer = new Date(fechaInicio.getTime() - 180000);
              
              if (msg.internalDate && msg.internalDate >= fechaBuffer) {
                const fullRawText = msg.source ? msg.source.toString('utf-8') : '';
                
                let decodedContent = fullRawText;
                const base64Blocks = fullRawText.match(/([A-Za-z0-9+/=]{30,})/g);
                if (base64Blocks) {
                  for (const block of base64Blocks) {
                    try {
                      const dec = Buffer.from(block, 'base64').toString('utf-8');
                      if (/\d{6}/.test(dec)) {
                        decodedContent += '\n' + dec;
                      }
                    } catch(e) {}
                  }
                }

                const textClean = decodedContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
                const match = textClean.match(/\b(\d{6})\b/);
                
                if (match && match[1]) {
                  console.log(`\n  ✅ Código 2FA recibido automáticamente: ${match[1]}`);
                  
                  if (uidsParaBorrar.length > 0) {
                    try {
                      await c.messageFlagsAdd(uidsParaBorrar, ['\\Deleted'], { uid: true });
                      console.log(`  🧹 Limpiados ${uidsParaBorrar.length} correos de 2FA del buzón.`);
                    } catch (errDel) {}
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
