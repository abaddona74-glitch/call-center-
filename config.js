require('dotenv').config();

module.exports = {
    PORT: process.env.PORT || 3000,
    
    // Issabel Asterisk AMI sozlamalari
    AMI: {
        port: parseInt(process.env.AMI_PORT || '5038', 10),
        host: process.env.AMI_HOST || '192.168.0.124',
        user: process.env.AMI_USER || 'nodeuser',
        password: process.env.AMI_PASSWORD || 'SuperParol123',
        events: true
    },
    
    // Issabel SSH/SFTP sozlamalari (/var/spool/asterisk/monitor/ ga kirish uchun)
    SFTP: {
        host: process.env.SFTP_HOST || '192.168.0.124',
        port: parseInt(process.env.SFTP_PORT || '22', 10),
        username: process.env.SFTP_USER || 'root',
        password: process.env.SFTP_PASSWORD || '', // Foydalanuvchi o'z parolini qo'yishi mumkin
        monitorPath: process.env.SFTP_MONITOR_PATH || '/var/spool/asterisk/monitor'
    }
};
