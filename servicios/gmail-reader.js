/**
 * gmail-reader.js
 * Lee el código 2FA enviado por el sistema Cuéntame al correo Gmail.
 * El email de Cuéntame es HTML puro codificado en Base64.
 */

const { ImapFlow } = require('imapflow');

const TIMEOUT_MS = 180000;
const POLL_INTERVAL_MS = 3000;

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
  const c = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: gmailUser, pass: appPassword },
    logger: false
  });
  
  console.log('  📧 Conectando a Gmail para leer el código 2FA...');
  await c.connect();
  
  const deadline = Date.now() + TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      const lock = await c.getMailboxLock('INBOX');
      try {
        const todos = await c.search({ from: 'mts.notificaciones@icbf.gov.co' }, { uid: true });
        
        // Iterar de más nuevo a más viejo
        for (let i = todos.length - 1; i >= 0; i--) {
          const uid = todos[i];
          const msg = await c.fetchOne(uid, { envelope: true }, { uid: true });
          
          if (msg.envelope && msg.envelope.date && msg.envelope.date >= fechaInicio) {
            // Este correo llegó DESPUÉS de que iniciamos el login
            const m = await c.fetchOne(uid, { bodyParts: ['1'] }, { uid: true });
            if (m.bodyParts && m.bodyParts.get('1')) {
              const html = Buffer.from(m.bodyParts.get('1').toString('ascii'), 'base64').toString('utf8');
              const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
              const match = text.match(/\b(\d{6})\b/);
              if (match && match[1]) {
                console.log(`\n  ✅ Código 2FA recibido: ${match[1]}`);
                lock.release();
                try { c.close(); } catch (_) {}
                return match[1];
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
  } finally {
    try { await c.logout(); } catch (_) {}
  }
  throw new Error('⏰ Tiempo agotado: no llegó el código 2FA en 180 segundos.');
}

module.exports = { obtenerCodigo2FA };
