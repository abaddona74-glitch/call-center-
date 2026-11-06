require('dotenv').config();

module.exports = {
    PORT: process.env.PORT || 3005,
    
    // Issabel Asterisk AMI sozlamalari
    AMI: {
        port: parseInt(process.env.AMI_PORT || '5038', 10),
        host: process.env.AMI_HOST || '192.168.0.124',
        user: process.env.AMI_USER || 'nodeuser',
        password: process.env.AMI_PASSWORD || 'SuperParol123',
        events: true
    }
};
