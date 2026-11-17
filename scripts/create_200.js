const authService = require('../services/authService');
const dbService = require('../services/dbService');
authService.init();

const extensions = ['200', '201', '202', '203', '204', '205', '206', '207', '208', '209'];
const defaultPass = 'Zangiota2026!';

const results = [];
for (const ext of extensions) {
    const username = 'operator' + ext;
    const existing = dbService.db.prepare('SELECT id, username FROM auth_users WHERE username = ? OR operator_id = ?').get(username, ext);
    if (existing) {
        authService.updateUserPassword(existing.username, defaultPass);
        dbService.db.prepare("UPDATE auth_users SET operator_id = ?, role = 'operator' WHERE username = ?").run(ext, existing.username);
        results.push({ ext, username: existing.username, status: 'updated_password' });
    } else {
        const res = authService.createUser(username, defaultPass, 'operator', ext, null);
        results.push({ ext, username, status: res.success ? 'created' : 'error', error: res.error });
    }
}

console.log(JSON.stringify(results, null, 2));

const all200Users = dbService.db.prepare("SELECT id, username, role, operator_id FROM auth_users WHERE operator_id >= '200' AND operator_id < '300'").all();
console.log('Current 200 users in DB:');
console.table(all200Users);

setTimeout(() => {
    process.exit(0);
}, 500);

