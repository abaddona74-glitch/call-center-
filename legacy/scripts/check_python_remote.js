const { Client } = require('ssh2');
require('dotenv').config();

const conn = new Client();
conn.on('ready', () => {
    const cmd = `python3 --version && python3 -c "import PIL; print('Pillow:', PIL.__version__)" && python3 -c "import fitz; print('PyMuPDF:', fitz.__version__)" 2>/dev/null || echo "fitz not installed"; python3 -c "import pillow_heif; print('pillow_heif:', pillow_heif.__version__)" 2>/dev/null || echo "pillow_heif not installed"`;
    conn.exec(cmd, (err, stream) => {
        stream.on('data', d => console.log(d.toString().trim()));
        stream.stderr.on('data', d => console.error(d.toString().trim()));
        stream.on('close', () => conn.end());
    });
}).connect({
    host: process.env.DEPLOY_HOST || '213.230.110.9',
    port: parseInt(process.env.DEPLOY_PORT || '22', 10),
    username: process.env.DEPLOY_USER || 'root',
    password: process.env.DEPLOY_PASS || process.env.SSH_PASSWORD || ''
});

