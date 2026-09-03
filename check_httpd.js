const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    conn.exec('ps aux | grep httpd && echo "===LSOF 18413===" && ls -l /proc/18413/fd && echo "===LSOF 32462===" && ls -l /proc/32462/fd', (err, stream) => {
        if (err) { console.error(err); conn.end(); return; }
        let out = '';
        stream.on('data', d => out += d.toString());
        stream.stderr.on('data', d => out += d.toString());
        stream.on('close', () => {
            console.log(out);
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
