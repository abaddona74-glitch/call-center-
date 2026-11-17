const { Client } = require('ssh2');
require('dotenv').config();

const SERVER_HOST = process.env.DEPLOY_HOST || '213.230.110.9';
const SERVER_PORT = parseInt(process.env.DEPLOY_PORT || '22', 10);
const SERVER_USER = process.env.DEPLOY_USER || 'root';
const SERVER_PASS = process.env.DEPLOY_PASS || process.env.SSH_PASSWORD || '';

const conn = new Client();
conn.on('ready', () => {
    console.log('SSH connection ready. Promoting Maxmudbek to admin...');
    const cmd = `sqlite3 /opt/call-center/data/callcenter.db "UPDATE auth_users SET role = 'admin' WHERE username = 'Maxmudbek'; SELECT id, username, role, operator_id FROM auth_users WHERE username = 'Maxmudbek';"`;
    conn.exec(cmd, (err, stream) => {
        if (err) console.error('Sqlite err:', err);
        stream.on('data', d => console.log('DB Output:', d.toString()));
        stream.stderr.on('data', d => console.error('DB Stderr:', d.toString()));
        stream.on('close', () => {
            console.log('✅ SQLite update complete.');
            // Update inbox task to completed
            conn.exec('cat /opt/call-center/scratch/ui_inbox.json 2>/dev/null', (err2, stream2) => {
                let data = '';
                stream2.on('data', d => data += d);
                stream2.on('close', () => {
                    try {
                        const items = JSON.parse(data);
                        items.forEach(i => {
                            if (String(i.id) === '1794298302591' || i.status === 'processing') {
                                i.status = 'completed';
                                i.completedAt = new Date().toISOString();
                            }
                        });
                        const updateCmd = `echo '${JSON.stringify(items).replace(/'/g, "'\\''")}' > /opt/call-center/scratch/ui_inbox.json`;
                        conn.exec(updateCmd, () => {
                            console.log('✅ Inbox task marked as completed!');
                            conn.end();
                        });
                    } catch (e) {
                        console.error('Inbox JSON error:', e.message);
                        conn.end();
                    }
                });
            });
        });
    });
}).on('error', err => {
    console.error('SSH Error:', err);
}).connect({
    host: SERVER_HOST,
    port: SERVER_PORT,
    username: SERVER_USER,
    password: SERVER_PASS
});
