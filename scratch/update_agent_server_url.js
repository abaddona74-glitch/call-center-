const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SERVER_URL = 'http://192.168.0.2:3000';

// Root config
const rootCfg = path.join(__dirname, '..', '3cx-desktop-agent', 'config.json');
if (fs.existsSync(rootCfg)) {
    const data = JSON.parse(fs.readFileSync(rootCfg, 'utf8'));
    data.serverUrl = SERVER_URL;
    fs.writeFileSync(rootCfg, JSON.stringify(data, null, 2), 'utf8');
}

// Dist folders
const dist = path.join(__dirname, '..', '3cx-desktop-agent', 'dist');
const folders = fs.readdirSync(dist, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(dist, d.name));

for (const dir of folders) {
    const cfg = path.join(dir, 'config.json');
    if (fs.existsSync(cfg)) {
        const data = JSON.parse(fs.readFileSync(cfg, 'utf8'));
        data.serverUrl = SERVER_URL;
        fs.writeFileSync(cfg, JSON.stringify(data, null, 2), 'utf8');
    }
    const zip = dir + '.zip';
    if (fs.existsSync(zip)) {
        try { fs.unlinkSync(zip); } catch (e) {}
    }
    try {
        execSync(`powershell -Command "Compress-Archive -Path '${dir}\\*' -DestinationPath '${zip}' -Force"`);
        console.log(`Re-zipped ${path.basename(dir)}`);
    } catch (e) {
        console.warn(`Skip locked zip for ${path.basename(dir)}: ${e.message}`);
    }
}

console.log('All configs updated successfully to', SERVER_URL);
