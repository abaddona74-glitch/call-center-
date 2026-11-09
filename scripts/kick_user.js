const { Client } = require('ssh2');

const username = process.argv[2] || 'oybek';

const conn = new Client();
conn.on('ready', () => {
    console.log('SSH connection ready');
    const cmd = `sqlite3 /opt/call-center/data/callcenter.db "SELECT count(*) FROM auth_sessions WHERE username = '${username}'; DELETE FROM auth_sessions WHERE username = '${username}';"`;
    conn.exec(cmd, (err, stream) => {
        if (err) {
            console.error('Exec error:', err);
            conn.end();
            return;
        }
        let out = '';
        stream.on('data', d => out += d);
        stream.on('close', () => {
            console.log(`Server response for '${username}':`, out.trim());
            // Also notify viewer 3005 on the server
            conn.exec(`curl -s -X POST http://127.0.0.1:3005/api/internal/invalidate-sessions -H "Content-Type: application/json" -d '{"username":"${username}"}'`, (err2, stream2) => {
                let out2 = '';
                if (stream2) {
                    stream2.on('data', d => out2 += d);
                    stream2.on('close', () => {
                        console.log('Viewer invalidate response:', out2.trim());
                        conn.end();
                    });
                } else {
                    conn.end();
                }
            });
        });
    });
}).connect({
    host: '192.168.0.2',
    port: 22,
    username: 'root',
    password: 'ZAQ!2wsx123'
});
