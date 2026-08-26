const fs = require('fs');
const path = require('path');
const { ImapFlow } = require('imapflow');

const c = {
  verde:    (t) => `\x1b[32m${t}\x1b[0m`,
  amarillo: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan:     (t) => `\x1b[36m${t}\x1b[0m`,
  rojo:     (t) => `\x1b[31m${t}\x1b[0m`,
  gris:     (t) => `\x1b[90m${t}\x1b[0m`,
  negrita:  (t) => `\x1b[1m${t}\x1b[0m`
};

/**
 * Genera un buffer RFC 822 MIME (.eml) con cuerpo HTML y archivos adjuntos
 */
function buildRawEML({ from, to, subject, html, attachments = [] }) {
    const boundary = '----=_Part_' + Date.now() + '_' + Math.random().toString(36).substring(2);
    
    let eml = [];
    eml.push(`From: ${from || 'SAAD PAEZ <saad.paez@gmail.com>'}`);
    if (to) eml.push(`To: ${to}`);
    eml.push(`Subject: ${subject}`);
    eml.push('MIME-Version: 1.0');
    eml.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    eml.push('');
    
    // HTML Body Part
    eml.push(`--${boundary}`);
    eml.push('Content-Type: text/html; charset=UTF-8');
    eml.push('Content-Transfer-Encoding: 8bit');
    eml.push('');
    eml.push(html);
    eml.push('');
    
    // Attachments
    for (const att of attachments) {
        if (att.path && fs.existsSync(att.path)) {
            const fileData = fs.readFileSync(att.path);
            const base64Data = fileData.toString('base64');
            const ext = path.extname(att.filename || att.path).toLowerCase();
            const mimeType = ext === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf';
            
            eml.push(`--${boundary}`);
            eml.push(`Content-Type: ${mimeType}; name="${att.filename}"`);
            eml.push(`Content-Disposition: attachment; filename="${att.filename}"`);
            eml.push('Content-Transfer-Encoding: base64');
            eml.push('');
            
            for (let i = 0; i < base64Data.length; i += 76) {
                eml.push(base64Data.substring(i, i + 76));
            }
            eml.push('');
        }
    }
    
    eml.push(`--${boundary}--`);
    return Buffer.from(eml.join('\r\n'), 'utf8');
}

/**
 * Guarda el borrador directamente en Gmail via IMAP
 */
async function guardarBorradorGmail(gmailUser, appPassword, emlBuffer) {
    if (!gmailUser || !appPassword) return false;
    const cleanPass = appPassword.replace(/\s+/g, '').replace(/["']/g, '');
    
    const client = new ImapFlow({
        host: 'imap.gmail.com', port: 993, secure: true,
        auth: { user: gmailUser, pass: cleanPass },
        logger: false
    });

    try {
        console.log(c.cyan('  📧 Subiendo borrador directamente a Gmail (Borradores)...'));
        await client.connect();
        
        let draftsMailbox = '[Gmail]/Drafts';
        const mailboxes = await client.list();
        for (const m of mailboxes) {
            if (m.specialUse === '\\Drafts' || m.path.includes('Drafts') || m.path.includes('Borradores')) {
                draftsMailbox = m.path;
                break;
            }
        }

        await client.append(draftsMailbox, emlBuffer, ['\\Draft']);
        console.log(c.verde(`  ✅ Borrador de correo creado exitosamente en Gmail ("${draftsMailbox}").`));
        return true;
    } catch (e) {
        console.log(c.amarillo(`  ⚠️ No se pudo subir directo a Gmail por IMAP: ${e.message}`));
        return false;
    } finally {
        try { await client.logout(); } catch(_) {}
    }
}

module.exports = { buildRawEML, guardarBorradorGmail };
