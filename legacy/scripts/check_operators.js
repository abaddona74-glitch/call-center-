require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const issabelDbService = require('../services/issabelDbService');

async function main() {
    try {
        const sql = "USE asterisk; SELECT extension, name FROM users WHERE extension LIKE '2%' ORDER BY CAST(extension AS UNSIGNED) ASC;";
        const raw = await issabelDbService.execQuery(sql);
        console.log('Asterisk 2xx Users:\n', raw);
        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
}
main();




