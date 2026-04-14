const genericPool = require('generic-pool');
const { getBrowser } = require('./puppeteerBrowser');

// Definición "Fabrica": gestión del ciclo de vida de cada recurso (página)
const factory = {
  create: async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
        
    return page;        
  },
  destroy: async (page) => {
    try {
    // Cierre seguro del recurso para liberar memoria RAM del servidor
      if (!page.isClosed()) await page.close();
    } catch(e){}
    // Silent catch para evitar que un error al cerrar tumbe el pool
  }
};

// Configuración del Pool: Controla el flujo de trabajo concurrente
const pagePool = genericPool.createPool(factory, {
  max: 3,  
  min: 0,
  idleTimeoutMillis: 30000,
  acquireTimeoutMillis: 30000
});



module.exports = { pagePool };
