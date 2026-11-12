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

                            // Agar biriktirilgan rasm/skrinshotlar bo'lsa, ularni mahalliy brain papkasiga saqlaymiz
                            if (pending.images && pending.images.length > 0) {
                                const fs = require('fs');
                                const path = require('path');
                                const localBrainUploads = 'C:\\Users\\User\\.gemini\\antigravity\\brain\\89a074ad-d105-434d-b0af-9b0b51290025\\.user_uploaded';
                                try {
                                    if (!fs.existsSync(localBrainUploads)) {
                                        fs.mkdirSync(localBrainUploads, { recursive: true });
                                    }
                                } catch (_) {}

                                console.log(`\n📸 [${pending.images.length} ta skrinshot/rasm biriktirilgan]:`);
                                pending.images.forEach((img, idx) => {
                                    try {
                                        const b64 = img.base64 || '';
                                        if (b64) {
                                            const matches = b64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                                            const ext = (matches && matches[1] && matches[1].includes('jpeg')) ? 'jpg' : 'png';
                                            const buf = matches ? Buffer.from(matches[2], 'base64') : Buffer.from(b64, 'base64');
                                            const localFileName = `visual_${pending.id}_${idx}.${ext}`;
                                            const localPath = path.join(localBrainUploads, localFileName);
                                            fs.writeFileSync(localPath, buf);
                                            console.log(`🖼️ Rasm #${idx + 1}: file:///${localPath.replace(/\\/g, '/')}`);
                                        }
                                    } catch (e) {
                                        console.error('Local image save error:', e.message);
                                    }
                                });
                            }

                            console.log('=============================================\n');

                            // Mark as processing on server va base64 larni tozalab hajmini ixcham saqlash
                            pending.status = 'processing';
                            items.forEach(item => {
                                if (item.images && Array.isArray(item.images)) {
                                    item.images.forEach(img => {
                                        delete img.base64;
                                    });
                                }
                            });
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

