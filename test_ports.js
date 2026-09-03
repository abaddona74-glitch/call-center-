const net = require('net');

function testPort(port) {
    return new Promise((resolve) => {
        const s = new net.Socket();
        s.setTimeout(3000);
        s.on('connect', () => {
            console.log(`Port ${port}: CONNECTED!`);
            s.destroy();
            resolve(true);
        });
        s.on('timeout', () => {
            console.log(`Port ${port}: TIMEOUT`);
            s.destroy();
            resolve(false);
        });
        s.on('error', (e) => {
            console.log(`Port ${port}: ERROR - ${e.message}`);
            resolve(false);
        });
        s.connect(port, '192.168.0.124');
    });
}

async function run() {
    await testPort(22);
    await testPort(5038);
    await testPort(80);
    await testPort(443);
    process.exit(0);
}
run();
