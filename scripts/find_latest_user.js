const fs = require('fs');
const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity/brain/1453cc36-290f-4bd3-b5ce-1a3d3380eb17/.system_generated/logs/transcript.jsonl', 'utf8').trim().split('\n');
for (let i = lines.length - 1; i >= 0; i--) {
    const obj = JSON.parse(lines[i]);
    if (obj.source === 'USER_EXPLICIT' || obj.type === 'USER_INPUT') {
        console.log(JSON.stringify(obj, null, 2));
        break;
    }
}

