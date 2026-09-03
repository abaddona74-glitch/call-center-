const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    conn.exec('tail -n 80 /var/log/asterisk/messages && echo "===AMI STATUS===" && asterisk -rx "manager show connected" && echo "===NETSTAT 5038===" && netstat -tnp | grep 5038', (err, stream) => {
        if (err) { console.error(err); conn.end(); return; }
        let out = '';
        stream.on('data', d => out += d.toString());
        stream.stderr.on('data', d => out += d.toString());
        stream.on('close', () => {
            console.log(out);
            conn.end();
            process.exit(0);
        });
    });
}).on('error', e => {
    console.error('SSH ERR:', e);
    process.exit(1);
}).connect({
    host: '192.168.0.124',
    port: 22,
    username: 'root',
    password: 'ZAQ!2wsx123'
});
