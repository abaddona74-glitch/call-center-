const net = require('net');

const client = new net.Socket();
client.connect(5038, '192.168.0.124', () => {
    console.log('Connected to 5038. Waiting for banner...');
});

client.on('data', (data) => {
    console.log('--- RECEIVED FROM 5038 ---');
    console.log(data.toString());
    console.log('--------------------------');

    if (data.toString().includes('Asterisk Call Manager')) {
        console.log('Sending Login Action...');
        client.write('Action: Login\r\nUsername: admin\r\nSecret: ZAQ!2wsx123\r\nEvents: off\r\n\r\n');
    }
});

client.on('close', (hadError) => {
    console.log('Connection closed. Had error:', hadError);
    process.exit(0);
});

client.on('error', (err) => {
    console.error('Socket error:', err);
});
