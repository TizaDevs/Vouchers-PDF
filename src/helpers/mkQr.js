const QRCode = require('qrcode');

const mkQRCode = async (ide) =>{

    const urlStats = `https://tizapp.io/${ide}`
    const code = await QRCode.toDataURL(urlStats);
    // const dataStr = await QRCode.toString(urlStats,{type:'terminal'})
    // console.log('Debug qr: ',dataStr)
    return code
}

module.exports = {
    mkQRCode
}