const fs = require('fs');
const file = 'qwen2/handler/dispatcher.go';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
    /output := stdout\.String\(\)/g,
    `output := stdout.String() + "\\n" + stderr.String()`
);

fs.writeFileSync(file, content);
console.log('Patch applied successfully.');
