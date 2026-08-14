/**
 * gmail-sender.js
 * Envia correos (con o sin adjuntos) usando la misma cuenta de Gmail que ya
 * usas para leer el 2FA en gmail-reader.js (mismo App Password, protocolo
 * distinto: SMTP para enviar en vez de IMAP para leer).
 */

const nodemailer = require('nodemailer');

/**
 * Crea el transportador SMTP de Gmail.
 * @param {string} gmailUser - Correo Gmail (el mismo que usas para leer 2FA)
 * @param {string} appPassword - El mismo App Password de 16 caracteres
 */
function crearTransportador(gmailUser, appPassword) {
  const cleanPass = (appPassword || '').replace(/\s+/g, '');
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: cleanPass },
  });
}

/**
 * Envia un correo, opcionalmente con adjuntos (ej: el PDF de la cuenta de cobro).
 *
 * @param {string} gmailUser
 * @param {string} appPassword
 * @param {Object} opciones
 * @param {string} opciones.to - Destinatario (o "correo1@x.com, correo2@x.com")
 * @param {string} opciones.subject - Asunto
 * @param {string} opciones.text - Cuerpo en texto plano (opcional si hay html)
 * @param {string} [opciones.html] - Cuerpo en HTML (opcional)
 * @param {Array}  [opciones.attachments] - [{ filename, path }]
 * @returns {Promise<Object>} info de nodemailer (incluye messageId)
 */
async function enviarCorreo(gmailUser, appPassword, { to, subject, text, html, attachments }) {
  const transportador = crearTransportador(gmailUser, appPassword);

  const info = await transportador.sendMail({
    from: gmailUser,
    to,
    subject,
    text,
    html,
    attachments,
  });

  return info;
}

module.exports = { enviarCorreo };
