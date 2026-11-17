const { Client } = require('ssh2');

const taskId = process.argv[2] || '1794463832542';
const conn = new Client();

conn.on('ready', () => {
    conn.sftp((err, sftp) => {
        if (err) {
            console.error('SFTP error:', err);
            conn.end();
            return;
        }
        const remoteFile = '/opt/call-center/scratch/ui_inbox.json';
        sftp.readFile(remoteFile, 'utf8', (err2, data) => {
            if (err2) {
                console.error('Read error:', err2);
                conn.end();
                return;
            }
            try {
                const items = JSON.parse(data);
                const item = items.find(i => String(i.id) === String(taskId));
                if (item) {
                    item.status = 'completed';
                    item.completedAt = new Date().toISOString();
                    console.log(`Marked item ${taskId} as completed!`);
                } else {
                    console.log(`Item ${taskId} not found in inbox.`);
                }
                const updated = Buffer.from(JSON.stringify(items, null, 2), 'utf8');
                sftp.writeFile(remoteFile, updated, (err3) => {
                    if (err3) console.error('Write error:', err3);
                    else console.log('Successfully saved to server via SFTP.');
                    conn.end();
                });
            } catch (parseErr) {
                console.error('JSON parse error:', parseErr);
                conn.end();
            }
        });
    });
}).connect({
    host: '213.230.110.9',
    port: 22,
    username: 'root',
    password: process.env.SSH_PASSWORD || ''
});

