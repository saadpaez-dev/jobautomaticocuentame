/**
 * debug-gmail.js
 * Diagnóstico: muestra los últimos 15 emails de Gmail
 * para encontrar dónde está cayendo el correo de Cuéntame.
 *
 * Uso: node debug-gmail.js
 */

require('dotenv').config();
const { ImapFlow } = require('imapflow');

async function diagnostico() {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
    logger: false,
  });

  await client.connect();
  console.log('\n✅ Conectado a Gmail\n');

  // Revisar varias carpetas
  const carpetas = ['INBOX', '[Gmail]/Spam', '[Gmail]/All Mail', '[Gmail]/Promotions'];

  for (const carpeta of carpetas) {
    try {
      const mb = await client.mailboxOpen(carpeta).catch(() => null);
      if (!mb) { console.log(`  ⚠️  Carpeta no accesible: ${carpeta}\n`); continue; }

      console.log(`\n📁 CARPETA: ${carpeta} (${mb.exists} mensajes total)`);
      console.log('─'.repeat(60));

      if (mb.exists === 0) { console.log('  (vacía)\n'); continue; }

      // Últimos 10 mensajes de la carpeta
      const desde = Math.max(1, mb.exists - 9);
      const mensajes = [];

      for await (const msg of client.fetch(`${desde}:*`, {
        envelope: true,
        uid: true,
      })) {
        mensajes.push(msg);
      }

      // Mostrar de más reciente a más antiguo
      mensajes.reverse().forEach((msg) => {
        const de  = msg.envelope?.from?.[0]?.address || '?';
        const asunto = msg.envelope?.subject || '(sin asunto)';
        const fecha  = msg.envelope?.date?.toLocaleString('es-CO') || '?';
        const uid = msg.uid;
        const esCuentame = de.includes('icbf') ? ' ← 🎯 CUÉNTAME' : '';
        console.log(`  UID ${uid} | ${fecha}`);
        console.log(`    De:     ${de}${esCuentame}`);
        console.log(`    Asunto: ${asunto}\n`);
      });

    } catch (err) {
      console.log(`  ❌ Error en ${carpeta}: ${err.message}\n`);
    }
  }

  // Búsqueda específica por remitente en All Mail
  console.log('\n🔍 Buscando específicamente correos de mts.notificaciones@icbf.gov.co...\n');
  try {
    await client.mailboxOpen('[Gmail]/All Mail');
    const encontrados = await client.search({ from: 'mts.notificaciones@icbf.gov.co' });
    console.log(`  Encontrados en "All Mail": ${encontrados.length}`);

    if (encontrados.length > 0) {
      const ultimos = encontrados.slice(-3);
      for (const uid of ultimos) {
        const msg = await client.fetchOne(uid, { envelope: true, source: true }, { uid: true });
        const fecha = msg.envelope?.date?.toLocaleString('es-CO') || '?';
        const asunto = msg.envelope?.subject || '?';
        const cuerpo = msg.source?.toString('utf8') || '';
        const match = cuerpo.match(/es el siguiente:\s*(\d{6})/i);
        console.log(`\n  UID ${uid} | ${fecha}`);
        console.log(`  Asunto: ${asunto}`);
        console.log(`  Código encontrado: ${match ? match[1] : '❌ No encontrado'}`);
        if (!match) {
          // Mostrar fragmento del cuerpo para depurar
          const fragmento = cuerpo.slice(0, 500).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ');
          console.log(`  Fragmento del cuerpo: ${fragmento}`);
        }
      }
    } else {
      console.log('  ❌ No se encontraron correos de Cuéntame en ninguna carpeta.');
      console.log('  Puede que el correo esté siendo bloqueado o no haya llegado aún.');
    }
  } catch (err) {
    console.log(`  Error buscando en All Mail: ${err.message}`);
  }

  await client.logout();
  console.log('\n✅ Diagnóstico completo.\n');
}

diagnostico().catch(console.error);
