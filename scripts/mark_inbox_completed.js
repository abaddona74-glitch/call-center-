const { Client } = require('ssh2');

const targetId = process.argv[2] ? parseInt(process.argv[2], 10) : 1794304803287;

const conn = new Client();
conn.on('ready', () => {
    conn.exec('cat /opt/call-center/scratch/ui_inbox.json', (err, stream) => {
        if (err) {
            console.error(err);
            conn.end();
            return;
        }
        let d = '';
        stream.on('data', c => d += c);
        stream.on('close', () => {
            try {
                const items = JSON.parse(d);
                items.forEach(i => {
                    if (i.id === targetId || String(i.id) === String(targetId)) {
                        i.status = 'completed';
                        i.completedAt = new Date().toISOString();
                    }
                });
                const s = JSON.stringify(items, null, 2);
                conn.sftp((errSftp, sftp) => {
                    if (errSftp) {
                        console.error(errSftp);
                        conn.end();
                        return;
                    }
                    const writeStream = sftp.createWriteStream('/opt/call-center/scratch/ui_inbox.json');
                    writeStream.write(s);
                    writeStream.end(() => {
                        console.log(`Successfully updated inbox item ${targetId} to completed`);
                        setTimeout(() => conn.end(), 500);
                    });
                });
            } catch (e) {
                console.error(e);
                conn.end();
            }
        });
    });
}).connect({ host: '213.230.110.9', port: 22, username: 'root', password: 'ZAQ!2wsx123' });
