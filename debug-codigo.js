/**
 * debug-codigo.js
 * Muestra el contenido del último correo de Cuéntame para verificar
 * que el código se puede extraer correctamente.
 */

require('dotenv').config();
const { ImapFlow } = require('imapflow');

async function verUltimoCodigo() {
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
  await client.mailboxOpen('INBOX');

  const todos = await client.search({ from: 'mts.notificaciones@icbf.gov.co' });
  console.log(`\nEmails de Cuéntame encontrados: ${todos.length}`);
  console.log('UIDs:', todos.join(', '));

  if (todos.length > 0) {
    const uid = todos[todos.length - 1]; // el más reciente
    console.log(`\nLeyendo UID ${uid}...`);

    const msg = await client.fetchOne(uid, { source: true }, { uid: true });
    const cuerpo = msg.source.toString('utf8');

    // Intentar varias expresiones regulares
    const patrones = [
      /es el siguiente:\s*(\d{6})/i,
      /siguiente:\s*(\d{6})/i,
      /código[^:]*:\s*(\d{6})/i,
      /codigo[^:]*:\s*(\d{6})/i,
      /(\d{6})/,
    ];

    console.log('\nBuscando código con distintos patrones:');
    for (const regex of patrones) {
      const match = cuerpo.match(regex);
      console.log(`  ${regex}: ${match ? '✅ ' + match[1] : '❌ no encontrado'}`);
    }

    // Mostrar fragmento relevante del cuerpo
    const idx = cuerpo.toLowerCase().indexOf('siguiente');
    if (idx >= 0) {
      console.log('\nFragmento alrededor de "siguiente":');
      console.log('  "' + cuerpo.slice(Math.max(0, idx - 20), idx + 100).replace(/\s+/g, ' ') + '"');
    }

    // También mostrar el texto plano del cuerpo (primeros 800 chars)
    console.log('\nPrimeros 800 chars del cuerpo (texto plano):');
    const textoPlano = cuerpo
      .replace(/<[^>]+>/g, ' ')  // quitar HTML
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 800);
    console.log(textoPlano);
  }

  await client.logout();
  console.log('\n✅ Listo.\n');
}

verUltimoCodigo().catch(console.error);
