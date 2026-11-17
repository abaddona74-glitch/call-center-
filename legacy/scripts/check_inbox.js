const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    conn.exec('cat /opt/call-center/scratch/ui_inbox.json', (err, stream) => {
        let data = '';
        stream.on('data', d => data += d);
        stream.on('close', () => {
            conn.end();
            try {
                const items = JSON.parse(data);
                console.log('Total items:', items.length);
                items.forEach((it, idx) => {
                    console.log('--- Item ' + idx + ' ---');
                    console.log('ID:', it.id, 'Status:', it.status);
                    console.log('Task:', it.task);
                    console.log('Prompt:', it.prompt);
                    if (it.element) console.log('Element:', it.element.tag, it.element.id, it.element.className);
                });
            } catch(e) {
                console.log(data);
            }
        });
    });
}).connect({
    host: '213.230.110.9',
    port: 22,
    username: 'root',
    password: process.env.SSH_PASSWORD || ''
});

