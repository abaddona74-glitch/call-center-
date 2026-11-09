const { Client } = require('ssh2');
require('dotenv').config();

console.log('👀 Visual AI Inbox Watcher ishga tushdi...');
console.log('📡 Serverdagi ui_inbox.json tekshirilmoqda...');

const SERVER_HOST = process.env.DEPLOY_HOST || '213.230.110.9';
const SERVER_PORT = parseInt(process.env.DEPLOY_PORT || '22', 10);
const SERVER_USER = process.env.DEPLOY_USER || 'root';
const SERVER_PASS = process.env.DEPLOY_PASS || 'ZAQ!2wsx123';

function checkInbox() {
    const conn = new Client();
    conn.on('ready', () => {
        conn.exec('cat /opt/call-center/scratch/ui_inbox.json 2>/dev/null', (err, stream) => {
            if (err) {
                conn.end();
                setTimeout(checkInbox, 3000);
                return;
            }
            let data = '';
            stream.on('data', d => data += d);
            stream.on('close', () => {
                conn.end();
                if (data && data.trim()) {
                    try {
                        const items = JSON.parse(data);
                        const pending = items.find(i => i.status === 'pending');
                        if (pending) {
                            console.log('\n=============================================');
                            console.log('🎯 YANGI VISUAL AI VAZIFA KELDI!');
                            console.log('ID:', pending.id);
                            const elDesc = (pending.elements && pending.elements.length > 1)
                                ? `${pending.elements.length} ta element (${pending.elements.map(e => `<${e.tag || 'el'}${e.id ? '#' + e.id : ''}>`).join(', ')})`
                                : `${pending.element?.tag || 'element'}${pending.element?.id ? '#' + pending.element.id : ''}`;
                            console.log('Element(lar):', elDesc);
                            console.log('Vazifa:', pending.task || 'Ko\'rinishini yaxshilash');
                            console.log('Full Prompt:');
                            console.log(pending.prompt);
                            console.log('=============================================\n');

                            // Mark as processing on server
                            pending.status = 'processing';
                            const updateCmd = `echo '${JSON.stringify(items).replace(/'/g, "'\\''")}' > /opt/call-center/scratch/ui_inbox.json`;
                            const conn2 = new Client();
                            conn2.on('ready', () => {
                                conn2.exec(updateCmd, () => {
                                    conn2.end();
                                    // Chiqamiz, bu esa Antigravity'ni avtomatik uyg'otadi!
                                    process.exit(0);
                                });
                            }).connect({
                                host: SERVER_HOST,
                                port: SERVER_PORT,
                                username: SERVER_USER,
                                password: SERVER_PASS
                            });
                            return;
                        }
                    } catch (e) {}
                }
                setTimeout(checkInbox, 3000);
            });
        });
    }).on('error', () => {
        setTimeout(checkInbox, 5000);
    }).connect({
        host: SERVER_HOST,
        port: SERVER_PORT,
        username: SERVER_USER,
        password: SERVER_PASS
    });
}

checkInbox();

