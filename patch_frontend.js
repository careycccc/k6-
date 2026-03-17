const fs = require('fs');
const file = 'k6/tests/api/recharge/frontendRecharge.test.js';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
    /const userName = __ENV\.TARGET_USER \|\| ".*?";/,
    `let userName = __ENV.TARGET_USER;
    if (!userName || userName === "undefined") {
        userName = "91" + Math.floor(Math.random() * 10000000000).toString().padStart(10, '0');
    }`
);

fs.writeFileSync(file, content);
console.log('Patch applied successfully.');
