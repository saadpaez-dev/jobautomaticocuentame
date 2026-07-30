require('dotenv').config();
const { chromium } = require('playwright');
const { loginYLlegarARoles, seleccionarRolYEntrar } = require('./servicios/autenticacion');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Logging in...');
    await loginYLlegarARoles(page, {
        usuario: process.env.CUENTAME_USUARIO,
        password: process.env.CUENTAME_PASSWORD,
        gmailUser: process.env.GMAIL_USER,
        gmailAppPassword: process.env.GMAIL_APP_PASSWORD
    });

    console.log('Selecting role...');
    await seleccionarRolYEntrar(page, 'BARRIOS UNIDOS');

    console.log('Navigating to MasterPrincipal...');
    await page.goto('https://rubonline.icbf.gov.co/Page/RUBONLINE/Principal/MasterPrincipal.aspx', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    console.log('Dumping HTML...');
    const html = await page.content();
    fs.writeFileSync('scratch/master_dump.html', html);
    
    let frameDump = '';
    for (let i = 0; i < page.frames().length; i++) {
        const f = page.frames()[i];
        frameDump += `\n\n================ FRAME ${i}: ${f.name()} - ${f.url()} ================\n`;
        frameDump += await f.content();
    }
    fs.writeFileSync('scratch/master_frames_dump.html', frameDump);
    
    console.log('Done!');
    await browser.close();
})();
