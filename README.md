# 🤖 PDF Worker — Generador de archivos con Puppeteer y RabbitMQ

Bot de generación masiva de PDFs a partir de plantillas HTML, desacoplado mediante colas de mensajes con RabbitMQ y almacenamiento en Google Cloud Storage.

---

## ¿Qué hace este proyecto?

Este worker escucha una cola de RabbitMQ, procesa cada mensaje entrante, genera un PDF a partir de una plantilla HTML usando Puppeteer, y guarda el resultado localmente o en un bucket de Google Cloud Storage.

Está diseñado para operar de forma desacoplada: el servicio que produce los datos no necesita esperar a que el PDF se genere. Solo publica un mensaje en la cola y el worker lo procesa a su propio ritmo.

---

## Instalación y uso 🛠️

```bash
# Instalar dependencias
npm install

# Correr el worker
node app.js
```

Para publicar un mensaje desde otro servicio o script:

```js

const channel = await connectRabbit();
  const job = {
    type:'iam_ide',
    payload:{
      schedule: {
        anName: 'Juan Pérez García'  
    }
  }

channel.sendToQueue(
  'your.namechannel',
  Buffer.from(JSON.stringify(job)),
  { persistent: true }
);
```

---


## Arquitectura general 🏗️

```
Servicio externo
      │
      │  publica mensaje JSON
      ▼
┌─────────────────┐
│   RabbitMQ      │
│  old.invoice    │◄──── Dead Letter ────► your.namechannel.dlq
└────────┬────────┘
         │ consume (prefetch: 1)
         ▼
┌─────────────────┐
│   app.js        │  Worker principal
│   (consumer)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   builder.js    │  Orquestador del PDF
└────────┬────────┘
         │
    ┌────┴─────────────────┐
    ▼                      ▼
pagePool (Puppeteer)    mkQRCode
renderTemplate()        genera QR en base64
    │
    ▼
page.pdf() → Buffer
    │
    ▼
saveLocal() / toCloudStorage()
```

---

## Estructura del proyecto 📂

```
pdf-worker/
├── app.js                   # Entry point — conexión RabbitMQ y consumer
├── src/
│   ├── builder.js           # Orquestador: renderiza HTML y genera el PDF
│   ├── config/
│   │   └── poolBrowser.js   # Pool de páginas de Puppeteer (reutilización)
│   ├── helpers/
│   │   ├── storageFiles.js  # Guardar PDF local o en GCP
│   │   └── mkQr.js          # Generador de código QR en base64
│   └── templates/
│       ├── certificado.html # Plantilla HTML con placeholders {{variable}}
│       └── assets/
│           └── logo_lgr.png # Recursos estáticos embebidos como base64
├── storage.json             # Credenciales de Google Cloud (no subir al repo)
├── .env                     # Variables de entorno
└── package.json
```

---

## Flujo detallado

### 1. `app.js` — Arranque del worker 🚀

El punto de entrada hace tres cosas al iniciar:

**Conecta a RabbitMQ** usando la URL del entorno o `amqp://127.0.0.1` como fallback:

```js
const conn = await amqp.connect(process.env.RABBITMQ_QUEUES || 'amqp://127.0.0.1');
```

**Declara la cola principal y su Dead Letter Queue (DLQ).** Si un mensaje falla y se hace `nack`, en lugar de perderse va a `your.namechannel.dlq` para revisión posterior:

```js
await channel.assertQueue('your.namechannel', {
  durable: true,
  deadLetterExchange: 'your.namechannel.dlx',
  deadLetterRoutingKey: 'your.namechannel.dlq'
});
```

**Establece `prefetch(1)`**, lo que significa que el worker solo toma un mensaje a la vez. Esto evita que se acumulen mensajes en memoria y que Puppeteer intente generar múltiples PDFs en paralelo dentro del mismo proceso:

```js
channel.prefetch(1);
```

**Valida el tipo de mensaje** antes de procesar. Si el mensaje no es del tipo esperado se hace `ack` inmediatamente para liberarlo sin procesarlo:

```js
if (data.type !== 'iam_ide') {
  channel.ack(msg);
  return;
}
```

Si ocurre cualquier error durante el procesamiento, se hace `nack` sin reencolar (`requeue: false`) para que el mensaje vaya a la DLQ:

```js
channel.nack(msg, false, false);
```

---

### 2. `builder.js` — Orquestador de generación ⚙️

Este módulo recibe el payload ya validado y coordina todos los pasos para producir el PDF.

**Genera el código QR** a partir de una cadena de datos (puede ser un folio, URL de verificación, etc.):

```js
const qr = await mkQRCode('DataString');
```

**Convierte imágenes a base64** para embeber los assets directamente en el HTML. Esto evita problemas de rutas relativas cuando Puppeteer renderiza el archivo desde un path temporal:

```js
function imgToBase64(imgPath) {
  const img = fs.readFileSync(imgPath);
  const ext = path.extname(imgPath).replace('.', '');
  return `data:image/${ext};base64,${img.toString('base64')}`;
}
```

**Renderiza el template HTML** reemplazando los placeholders `{{variable}}` con los datos reales:

```js
function renderTemplate(payload) {
  return template
    .replace('{{assets}}',     payload.assets)
    .replace('{{owner_name}}', payload.name)
    .replace('{{qr_code}}',    payload.qr_url)
    .replace('{{logoLeft}}',   payload.logoLeft);
}
```

**Escribe el HTML renderizado en un archivo temporal** en el directorio del sistema operativo. Esto es necesario porque `page.goto('file://...')` requiere un archivo físico en disco:

```js
const tempHtmlPath = path.join(
  os.tmpdir(),
  `recibo-${Date.now()}-${process.pid}-${Math.random()}.html`
);
await writeFile(tempHtmlPath, html, 'utf8');
```

El nombre incluye timestamp, PID y número aleatorio para evitar colisiones si hay múltiples instancias del worker corriendo en paralelo.

**Adquiere una página del pool de Puppeteer**, navega al archivo temporal y genera el PDF:

```js
page = await pagePool.acquire();
await page.goto(`file://${tempHtmlPath}`, { waitUntil: 'load', timeout: 20000 });
const pdf = await page.pdf({
  format: 'Letter',
  printBackground: true,
  margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
});
```

`printBackground: true` es obligatorio para que los colores, bordes y fondos del HTML aparezcan en el PDF.

**Limpia los recursos** en el bloque `finally`, siempre, haya o no error. Libera la página al pool y elimina el archivo temporal:

```js
finally {
  if (page) await pagePool.release(page);
  if (fs.existsSync(tempHtmlPath)) await unlink(tempHtmlPath);
}
```

---

### 3. `storageFiles.js` — Persistencia del PDF 💾

Expone dos funciones según el destino:

**Guardar localmente** (útil para desarrollo y pruebas):

```js
const saveLocal = async (docStream, ide) => {
  const fileName = `cert_${ide}.pdf`;
  fs.writeFileSync(fileName, docStream);
};
```

**Subir a Google Cloud Storage** para producción:

```js
const toCloudStorage = async (docStream, ide) => {
  const readableStream = Readable.from(docStream);
  const fileName = `cert_${ide}.pdf`;
  await bucketEv.file(fileName).save(readableStream);
};
```

> **Importante:** el nombre del archivo no debe contener `/` ni caracteres especiales. GCP interpreta los `/` como separadores de carpeta y creará directorios no deseados en el bucket.

---

## Pool de páginas de Puppeteer ♨️

En lugar de abrir y cerrar el navegador en cada PDF, el worker reutiliza un pool de páginas ya abiertas. Esto reduce drásticamente el tiempo de generación en batch.

La idea conceptual es la siguiente:

```js
// Se abre el navegador UNA sola vez al iniciar
const browser = await puppeteer.launch();

// El pool mantiene N páginas listas para usar
// acquire() toma una página disponible
// release() la devuelve al pool para el siguiente mensaje
```

Con `prefetch(1)` en RabbitMQ + pool de páginas, cada instancia del worker procesa un PDF a la vez de forma ordenada y sin fugas de memoria.

---

## Dead Letter Queue (DLQ)

Cuando un mensaje falla (por error en Puppeteer, datos malformados, timeout, etc.) y se hace `nack` con `requeue: false`, RabbitMQ lo reencamina automáticamente a `your.namechannel.dlq`.

```
your.namechannel  →  falla  →  your.namechannel.dlx (exchange)  →  your.namechannel.dlq
```

Esto permite revisar los mensajes fallidos sin perderlos, reintentar manualmente o analizarlos para detectar patrones de error.

---

## Variables de entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
RABBITMQ_QUEUES=amqp://usuario:password@host:5672
GCLOUD_STORAGE_LAB=nombre-de-tu-bucket
```

---

## Credenciales de Google Cloud ☁️

El archivo `storage.json` contiene las credenciales de una cuenta de servicio de GCP con permisos sobre el bucket. **Nunca subas este archivo al repositorio.**

Agrégalo a tu `.gitignore`:

```
storage.json
.env
```

---


## Consideraciones para producción ‼️

- Corre múltiples instancias del worker en lugar de subir el `prefetch` para mayor paralelismo sin afectar la estabilidad.
- Monitorea la DLQ regularmente para detectar mensajes fallidos.
- El nombre del archivo PDF en GCP no debe contener `/`. Usa `-` como separador si necesitas incluir fechas.
- Reutiliza la instancia del navegador entre mensajes, no la abras y cierres por cada PDF.
- Vigila el uso de memoria con el log de RSS que ya está implementado en el worker.

---

## Licencia

MIT — libre para usar, modificar y distribuir.
