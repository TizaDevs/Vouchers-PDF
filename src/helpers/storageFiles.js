// <-- PRINCIPAL
const boxStorage  = process.env.GCLOUD_STORAGE_LAB;

const { Storage } = require('@google-cloud/storage');
const { Readable } = require('stream');

const fs = require('fs');

const projectID = "your-ideName";
const keyFilename = "./storage.json";
const storage = new Storage( { 
    projectID,
    keyFilename,
    retryOptions: {
        autoRetry:true,
        maxRetries:10
    }
});
const bucketEv = storage.bucket(boxStorage);

const toCloudStorage = async (docStream,ide) => {
    try{                    
             
        const readableStream = Readable.from(docStream);        
        const fileName = `cert_${ide}.pdf`;                      
            
        await bucketEv.file(fileName).save(readableStream);
                                
    }
    catch(err) {
        console.log("Cloud storage >", err)        
    }
        
}

const saveLocal = async (docStream,ide) =>{
 try{                    

    const fileName = `cert_${ide}.pdf`;
    fs.writeFileSync(fileName,docStream);
    
    console.log(`File |  > `,fileName);        
    }
    catch(err) {
        console.log("Local storage >", err)        
    }       
}

module.exports = {

    toCloudStorage,
    saveLocal
}