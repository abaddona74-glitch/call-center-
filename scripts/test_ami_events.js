const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
    const cmd = `node -e '
const net = require("net");
const client = net.createConnection({ host: "192.168.0.124", port: 5038 }, () => {
    client.write("Action: Login\\r\\nUsername: nodeuser\\r\\nSecret: SuperParol123\\r\\n\\r\\n");
    setTimeout(() => {
        client.write("Action: CoreShowChannels\\r\\n\\r\\n");
    }, 500);
});
let buf = "";
client.on("data", d => {
    buf += d.toString();
    if (buf.includes("CoreShowChannelsComplete")) {
        console.log(buf);
        client.end();
        process.exit(0);
    }
});
setTimeout(() => {
    console.log("TIMEOUT BUFFER:\\n", buf.slice(0, 1500));
    process.exit(0);
}, 3000);
'`;
    conn.exec(cmd, (err, stream) => {
        if (err) throw err;
        let out = '';
        stream.on('data', d => out += d);
        stream.on('close', () => {
            console.log(out);
            conn.end();
        });
    });
}).connect({
    host: '213.230.110.9',
    port: 22,
    username: 'root',
    password: process.env.SSH_PASSWORD || ''
});

