const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    console.log('SSH Ready!');
    conn.exec('netstat -tnp | grep 5038', (err, stream) => {
        if (err) { console.error(err); conn.end(); return; }
        let out = '';
        stream.on('data', d => out += d.toString());
        stream.stderr.on('data', d => out += d.toString());
        stream.on('close', () => {
            console.log('NETSTAT 5038:\n' + out);
            conn.end();
        });
    });
}).on('error', e => {
    console.error('SSH ERR:', e);
}).connect({
    host: '192.168.0.124',
    port: 22,
    username: 'root',
    password: 'ZAQ!2wsx123',
    readyTimeout: 30000
});
