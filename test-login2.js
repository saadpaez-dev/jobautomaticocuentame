require('dotenv').config();
const { chromium } = require('playwright');
const { ImapFlow } = require('imapflow');

const TIMEOUT_MS = 90000;
const POLL_INTERVAL_MS = 3000;

async function run() {
  console.log('\n🧪 Iniciando test-login v2...');
  
  const fechaInicio = new Date();
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const page = await browser.newPage();
  
  await page.goto('https://rubonline.icbf.gov.co/DefaultF.aspx', { waitUntil: 'networkidle' });
  console.log('✅ Página cargada.');
  
  await page.locator('input[type="text"]').first().fill(process.env.CUENTAME_USUARIO);
  await page.locator('input[type="password"]').first().fill(process.env.CUENTAME_PASSWORD);
  
  console.log('⏳ Haciendo click en Iniciar Sesión...');
  await page.locator('input[value="Iniciar Sesión"], input[type="submit"]').first().click();
  
  await page.waitForTimeout(3000);
  
  const content = await page.content();
  if (content.includes('bloqueado')) {
    console.log('❌ CUENTA BLOQUEADA');
    await browser.close();
    return;
  }
  
  if (content.includes('Ingrese su código')) {
    console.log('✅ Pantalla 2FA detectada. Esperando correo...');
    const codigo = await pollForCode(fechaInicio);
    
    if (codigo) {
      console.log(`Escribiendo código: ${codigo}`);
      await page.locator('input[type="text"]').first().fill(codigo);
      await page.waitForTimeout(1000);
      
      console.log('Click en Verificar Código...');
      await page.locator('input[value="Verificar Código"], button:has-text("Verificar")').first().click();
      
      await page.waitForTimeout(4000);
      
      const contentFinal = await page.content();
      if (contentFinal.includes('Seleccione la entidad')) {
        console.log('✅ Pantalla de Entidad detectada! LOGIN 2FA EXITOSO.');
        await page.screenshot({ path: 'logs/login2-entidad.png' });
        
        // Seleccionar entidad
        const selectores = await page.locator('select').all();
        if (selectores.length > 0) {
            await selectores[0].selectOption({ index: 1 });
            await page.waitForTimeout(1000);
            await page.locator('input[value="Continuar"]').first().click();
            await page.waitForTimeout(5000);
            await page.screenshot({ path: 'logs/login2-adentro.png' });
            console.log('URL final:', page.url());
        }
      } else if (contentFinal.includes('inválido')) {
        console.log('❌ Código inválido según la página.');
        await page.screenshot({ path: 'logs/login2-invalido.png' });
      } else {
        console.log('⚠️ Resultado desconocido.');
        await page.screenshot({ path: 'logs/login2-desconocido.png' });
      }
    }
  }
  
  console.log('Cerrando navegador en 10s...');
  await page.waitForTimeout(10000);
  await browser.close();
}

async function pollForCode(minDate) {
  const c = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    logger: false
  });
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
          
          if (msg.envelope && msg.envelope.date && msg.envelope.date >= minDate) {
            // Este correo llegó DESPUÉS de que iniciamos el script
            const m = await c.fetchOne(uid, { bodyParts: ['1'] }, { uid: true });
            if (m.bodyParts && m.bodyParts.get('1')) {
              const html = Buffer.from(m.bodyParts.get('1').toString('ascii'), 'base64').toString('utf8');
              const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
              const match = text.match(/\b(\d{6})\b/);
              if (match && match[1]) {
                return match[1];
              }
            }
          }
        }
      } finally {
        lock.release();
      }
      
      process.stdout.write('.');
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  } finally {
    await c.logout();
  }
  return null;
}

run().catch(console.error);
