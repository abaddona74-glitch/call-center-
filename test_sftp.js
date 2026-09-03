const SftpClient = require('ssh2-sftp-client');
require('dotenv').config();

async function test() {
    const sftp = new SftpClient();
    await sftp.connect({
        host: '192.168.0.124',
        port: 22,
        username: 'root',
        password: 'ZAQ!2wsx123'
    });
    console.log('Connected to SFTP!');
    const rootList = await sftp.list('/var/spool/asterisk/monitor');
    console.log('ROOT MONITOR:', rootList.map(i => i.name));
    
    // Check 2026/09/02
    try {
        const todayList = await sftp.list('/var/spool/asterisk/monitor/2026/09/02');
        console.log('TODAY FILES (first 5):', todayList.slice(0, 5).map(i => i.name));
    } catch(e) {
        console.log('Error listing 2026/09/02:', e.message);
    }
    await sftp.end();
}
test().catch(console.error);
