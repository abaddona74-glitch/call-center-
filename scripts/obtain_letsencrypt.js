const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const acme = require('acme-client');

const DOMAIN = 'uniconsoft.ddns.net';
const EMAIL = 'admin@uniconsoft.uz';
const PFX_PASSWORD = 'password123';

const SSL_DIR = path.join(__dirname, '..', 'ssl');
const VIEWER_SSL_DIR = path.join(__dirname, '..', 'viewer', 'ssl');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const CHALLENGE_DIR = path.join(PUBLIC_DIR, '.well-known', 'acme-challenge');

async function main() {
    console.log('========================================================');
    console.log(`🔐 Let\'s Encrypt SSL Generator for ${DOMAIN}`);
    console.log('========================================================\n');

    // 1. Folders setup
    [SSL_DIR, VIEWER_SSL_DIR, CHALLENGE_DIR].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });

    // 2. Account Key (Re-use or create new)
    const accountKeyFile = path.join(SSL_DIR, 'letsencrypt_account.key');
    let accountKey;
    if (fs.existsSync(accountKeyFile)) {
        console.log('🔑 Existing Let\'s Encrypt account key found.');
        accountKey = fs.readFileSync(accountKeyFile);
    } else {
        console.log('🆕 Generating new Let\'s Encrypt account key...');
        accountKey = await acme.crypto.createPrivateKey();
        fs.writeFileSync(accountKeyFile, accountKey, { mode: 0o600 });
        console.log('✅ Account key saved to:', accountKeyFile);
    }

    // 3. Initialize ACME Client
    console.log('🌐 Connecting to Let\'s Encrypt ACME v2 Production Directory...');
    const client = new acme.Client({
        directoryUrl: acme.directory.letsencrypt.production,
        accountKey: accountKey
    });

    // 4. Generate Private Key and CSR for Domain
    console.log(`📝 Generating CSR & private key for ${DOMAIN}...`);
    const [certificateKey, csr] = await acme.crypto.createCsr({
        commonName: DOMAIN,
        altNames: [DOMAIN]
    });

    // 5. Order and satisfy HTTP-01 challenge
    console.log('🚀 Requesting certificate from Let\'s Encrypt...');
    const certificate = await client.auto({
        csr,
        email: EMAIL,
        termsOfServiceAgreed: true,
        challengePriority: ['http-01'],
        challengeCreateFn: async (authz, challenge, keyAuthorization) => {
            if (challenge.type === 'http-01') {
                const filePath = path.join(CHALLENGE_DIR, challenge.token);
                console.log(`📁 Writing challenge token: ${challenge.token}`);
                fs.writeFileSync(filePath, keyAuthorization);
                console.log(`✅ Challenge ready at: http://${DOMAIN}/.well-known/acme-challenge/${challenge.token}`);
            }
        },
        challengeRemoveFn: async (authz, challenge, keyAuthorization) => {
            if (challenge.type === 'http-01') {
                const filePath = path.join(CHALLENGE_DIR, challenge.token);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`🧹 Challenge token cleaned up: ${challenge.token}`);
                }
            }
        }
    });

    console.log('🎉 Let\'s Encrypt Certificate successfully issued!');

    // 6. Save certificates to ssl/ and viewer/ssl/
    const certPath = path.join(SSL_DIR, 'server.crt');
    const keyPath = path.join(SSL_DIR, 'server.key');
    fs.writeFileSync(certPath, certificate);
    fs.writeFileSync(keyPath, certificateKey);
    console.log(`💾 Saved to ${certPath} and ${keyPath}`);

    const viewerCertPath = path.join(VIEWER_SSL_DIR, 'server.crt');
    const viewerKeyPath = path.join(VIEWER_SSL_DIR, 'server.key');
    fs.writeFileSync(viewerCertPath, certificate);
    fs.writeFileSync(viewerKeyPath, certificateKey);
    console.log(`💾 Saved to ${viewerCertPath} and ${viewerKeyPath}`);

    // If separate standalone call-center-viewer folder exists on server
    const optViewerSslDir = '/opt/call-center-viewer/ssl';
    if (fs.existsSync('/opt/call-center-viewer')) {
        if (!fs.existsSync(optViewerSslDir)) fs.mkdirSync(optViewerSslDir, { recursive: true });
        fs.writeFileSync(path.join(optViewerSslDir, 'server.crt'), certificate);
        fs.writeFileSync(path.join(optViewerSslDir, 'server.key'), certificateKey);
        console.log(`💾 Also saved to ${optViewerSslDir}`);
    }

    // 7. Generate PKCS#12 (.pfx) bundle for Kerio Control
    const pfxFile = path.join(SSL_DIR, 'uniconsoft_letsencrypt.pfx');
    const publicPfxFile = path.join(PUBLIC_DIR, 'uniconsoft_letsencrypt.pfx');
    console.log(`📦 Exporting PKCS#12 (.pfx) for Kerio Control with password '${PFX_PASSWORD}'...`);

    try {
        execSync(`openssl pkcs12 -export -out "${pfxFile}" -inkey "${keyPath}" -in "${certPath}" -passout pass:${PFX_PASSWORD}`);
        fs.copyFileSync(pfxFile, publicPfxFile);
        console.log(`✅ PKCS#12 file created successfully:`);
        console.log(`   Internal path: ${pfxFile}`);
        console.log(`   Downloadable URL: http://${DOMAIN}/uniconsoft_letsencrypt.pfx (Parol: ${PFX_PASSWORD})`);
    } catch (pfxErr) {
        console.warn('⚠️ OpenSSL pkcs12 export failed:', pfxErr.message);
    }

    // 8. PM2 Reload if running on server
    try {
        console.log('🔄 Reloading PM2 services...');
        execSync('pm2 reload call-center && pm2 reload call-center-viewer', { stdio: 'inherit' });
        console.log('✅ PM2 services reloaded with new certificate!');
    } catch (e) {
        console.log('ℹ️ PM2 reload skipped (or not running).');
    }

    console.log('\n========================================================');
    console.log('🎉 SSL TAYYOR BO\'LDI!');
    console.log(`1. Server (3535 va 3005 portlar) yangi Let's Encrypt sertifikati bilan ta'minlandi.`);
    console.log(`2. Kerio Control uchun .pfx fayl: ${publicPfxFile}`);
    console.log(`   PFX paroli: ${PFX_PASSWORD}`);
    console.log('========================================================\n');
}

main().catch((err) => {
    console.error('❌ SSL olishda xatolik:', err);
    process.exit(1);
});
