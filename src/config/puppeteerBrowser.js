const puppeteer = require('puppeteer');

let browser;

// Configuración base Puppeteer
const getBrowser = async() => {

    if (browser) return browser;

    // configuracion para app de terminal
    browser = await puppeteer.launch({      
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--allow-file-access-from-files',
        '--no-zygote',        
      ]
    });

  return browser;

}
module.exports = {
  getBrowser
}
