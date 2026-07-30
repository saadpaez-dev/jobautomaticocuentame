const { ImapFlow } = require('imapflow');

/**
 * Sube un archivo .eml (buffer) a la carpeta de Borradores de Gmail.
 */
async function guardarEnBorradores(gmailUser, appPassword, messageBuffer) {
  const c = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: gmailUser, pass: appPassword },
    logger: false
  });

  try {
    await c.connect();
    
    // Buscar la carpeta de borradores (Drafts)
    let draftsPath = null;
    const mailboxes = await c.list();
    for (const mb of mailboxes) {
      if (mb.specialUse && mb.specialUse.includes('\\Drafts')) {
        draftsPath = mb.path;
        break;
      }
    }
    
    // Fallbacks comunes si no tiene el flag especial
    if (!draftsPath) {
      const paths = mailboxes.map(m => m.path.toUpperCase());
      if (paths.includes('[GMAIL]/DRAFTS')) draftsPath = '[Gmail]/Drafts';
      else if (paths.includes('[GMAIL]/BORRADORES')) draftsPath = '[Gmail]/Borradores';
      else draftsPath = 'INBOX'; // Último recurso
    }

    console.log(`  📧 Subiendo borrador a la carpeta: ${draftsPath}`);
    
    await c.append(draftsPath, messageBuffer, ['\\Draft']);
    
  } finally {
    try { await c.logout(); } catch (_) {}
  }
}

module.exports = { guardarEnBorradores };
