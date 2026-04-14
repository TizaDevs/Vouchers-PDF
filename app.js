require('dotenv').config({ quiet: true });
const amqp = require('amqplib');
const { invoiceCatastro } = require('./src/builder');


const  startWorker = async () => {
       
  const conn = await amqp.connect(process.env.RABBITMQ_QUEUES || 'amqp://127.0.0.1');
  const channel = await conn.createChannel();

  await channel.assertExchange('your.namechannel.dlx', 'direct', { durable: true });

  await channel.assertQueue('your.namechannel', { 
    durable: true,
    deadLetterExchange: 'your.namechannel.dlx',
    deadLetterRoutingKey: 'your.namechannel.dlq' 
  });

  await channel.assertQueue('your.namechannel.dlq', { durable: true });

  await channel.bindQueue(
    'your.namechannel.dlq',
    'your.namechannel.dlx',
    'your.namechannel.dlq'
  );
  channel.prefetch(1);

  // ------- DEBUG -------
  console.log('🤖 Worker Listo...');
  await invoiceCatastro({
    schedule: {
      anName:"Tester 13"
    }
  })
  // ---------------------
  
  channel.consume('your.namechannel', async (msg) => {

    if (!msg) return;
      try {      
        console.log('RSS:',Math.round(process.memoryUsage().rss / 1024 / 1024),'MB');
        const data = JSON.parse(msg.content.toString());
      
      // Validacion del canal correspondiente
      if (data.type !== 'iam_ide') {
        channel.ack(msg);
        return;
      }  
                    
      // Entrada de datos
      // await invoiceCatastro(data.payload);      
      channel.ack(msg);
    } 
    catch (err) {
        console.error('Worker error:', err);
        channel.nack(msg, false, false);
    }
  });  
}

startWorker();
