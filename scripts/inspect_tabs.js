const fs = require('fs');
const content = fs.readFileSync('D:/call center/public/index.html', 'utf8');
const lines = content.split('\n');
lines.forEach((l, i) => {
    if (l.includes('tab_statistics') || l.includes('tab-statistics') || l.includes('id="statistics') || l.includes('id="tab-')) {
        console.log((i+1) + ': ' + l.trim().slice(0, 120));
    }
});

