#!/bin/bash

echo "正在更新前台充值的成功判定条件..."

cat << 'EOF' > patch_is_success.js
const fs = require('fs');
const frontendFile = './k6/tests/api/recharge/frontendRecharge.test.js';
let source = fs.readFileSync(frontendFile, 'utf-8');

// 将刚刚很长的判断条件，替换成精确的2个条件：code: 0 或者 msg 是特定的限流信息
source = source.replace(
`        // 根据用户的规则判定是否成功，包含特定报错 "Sorry, The system is busy, please try again later! code: 10003"
        const isApiSuccess = (msgCode === 41 || msgCode === 0 || code === -2 || code === 0 || msg === "Sorry, The system is busy, please try again later! code: 10003");`,
`        // 充值成功的条件有两个：
        // 1. code === 0
        // 2. msg === "Sorry, The system is busy, please try again later! code: 10003"
        const isApiSuccess = (code === 0 || msg === "Sorry, The system is busy, please try again later! code: 10003");`
);

fs.writeFileSync(frontendFile, source);
EOF

node patch_is_success.js && rm patch_is_success.js

echo "✨ 成功条件已修正为精确匹配！请再次执行 k6 run frontendRecharge.test.js 测试"