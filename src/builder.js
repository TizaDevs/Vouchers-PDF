const fs = require('fs');
const path = require('path');
const os = require('os');
const { writeFile, unlink } = require('fs/promises');

const { pagePool } = require('./config/poolBrowser');
const { saveLocal, toCloudStorage } = require('./helpers/storageFiles');
const { mkQRCode } = require('./helpers/mkQr');

const htmlPath = path.join(__dirname,'./templates/certificado.html');
const assetsPath = path.join(
  __dirname,
  './templates/assets'
).replace(/\\/g, '/');


const logoLeft = imgToBase64(
  path.join(assetsPath, 'logo_lgr.png')
);
let template = fs.readFileSync(htmlPath, 'utf8');

function imgToBase64(imgPath) {
  const img = fs.readFileSync(imgPath);
  const ext = path.extname(imgPath).replace('.', '');
  return `data:image/${ext};base64,${img.toString('base64')}`;
}

// Contenido en template
function renderTemplate(payload) {
  return template
    .replace('{{assets}}', payload.assets)
    .replace('{{owner_name}}', payload.name)
    .replace('{{qr_code}}', payload.qr_url)
}

const invoiceCatastro = async (data) => {
  
    // Estructura datos 
    const qr = await mkQRCode('DataString') 
    const payload = {

      name:data.schedule.anName,
      qr_url:qr,
      assets: `file://${assetsPath}`,
      logoLeft,

    };

    const html = renderTemplate(payload);

    const tempHtmlPath = path.join(
        os.tmpdir(),
        `recibo-${Date.now()}-${process.pid}-${Math.random()}.html`
    );
    let page;
    try {
    
        // DEBUG EN GENERIC POOL
        // console.log('POOL STATUS', {
        //   size: pagePool.size,
        //   available: pagePool.available,
        //   pending: pagePool.pending
        // });
        page = await pagePool.acquire();
    
        await writeFile(tempHtmlPath, html, 'utf8');

        await page.goto(`file://${tempHtmlPath}`, {
        waitUntil: 'load',
        timeout: 20000
        });
    

        const pdf = await page.pdf({
        format: 'Letter',
        printBackground: true,      
        margin: {
            top: '0mm',
            bottom: '0mm',
            left: '0mm',
            right: '0mm'
        },
        timeout: 30000
        });

        const fileVoucher = Buffer.from(pdf);
        await saveLocal(fileVoucher,data.schedule.anName); 
  }
  catch(err){
   console.error("PDF ERROR:", err);
   throw new Error(`Generation of PDF: ${err}`);
  }
  finally {        
    if (page) {
      try {
        await pagePool.release(page);
      } 
      catch (e) {
        console.error('Release failed');
      }
    }

    if (fs.existsSync(tempHtmlPath)) await unlink(tempHtmlPath);    
  }

}

module.exports = {

 invoiceCatastro
}
