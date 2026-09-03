const SftpClient = require('ssh2-sftp-client');

async function test() {
    const sftp = new SftpClient();
    await sftp.connect({
        host: '192.168.0.124',
        port: 22,
        username: 'root',
        password: 'ZAQ!2wsx123'
    });

    const testFiles = [
        'q-2020159-935289878-20260902-143113-1788341465.151794.wav',
        '/var/spool/asterisk/monitor/2026/09/02/q-2020159-900260890-20260902-140007-1788339599.143760.wav'
    ];

    for (const tf of testFiles) {
        let clean = tf.trim().replace(/\\/g, '/');
        let fullPath = '';
        if (clean.startsWith('/var/spool/asterisk/monitor')) {
            fullPath = clean;
        } else if (clean.match(/^[0-9]{4}\/[0-9]{2}\/[0-9]{2}\//)) {
            fullPath = `/var/spool/asterisk/monitor/${clean}`;
        } else {
            // Extract YYYYMMDD with 202X pattern
            const match = clean.match(/(202[0-9])(0[1-9]|1[0-2])([0-3][0-9])/);
            if (match) {
                fullPath = `/var/spool/asterisk/monitor/${match[1]}/${match[2]}/${match[3]}/${clean}`;
            } else {
                fullPath = `/var/spool/asterisk/monitor/${clean}`;
            }
        }
        try {
            const stat = await sftp.stat(fullPath);
            console.log(`FOUND: ${tf} -> ${fullPath} (${stat.size} bytes)`);
        } catch(e) {
            console.log(`NOT FOUND: ${tf} -> ${fullPath}`);
        }
    }
    await sftp.end();
}
test().catch(console.error);
