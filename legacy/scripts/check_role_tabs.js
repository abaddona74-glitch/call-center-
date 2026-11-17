const fs = require('fs');
const content = fs.readFileSync('D:/call center/public/js/dashboard.js', 'utf8');
const lines = content.split('\n');
lines.forEach((l, i) => {
    if (l.includes('currentAuthUser') || l.includes('role ===') || l.includes('data-tab="statistics"')) {
        console.log((i+1) + ': ' + l.trim().slice(0, 120));
    }
});

