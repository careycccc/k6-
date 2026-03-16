#!/bin/bash

echo "正在修复后台查询订单的校验逻辑..."

cat << 'EOF' > fix_backend_api.js
const fs = require('fs');

let apiFile = './k6/tests/api/recharge/backendRechargeApi.js';
let content = fs.readFileSync(apiFile, 'utf-8');

// 修复本地充值的报错判断
content = content.replace(
`    if (!response || response.msgCode !== 0) {
        console.error(\`[\${tag}] 查询订单列表失败, 响应内容: \${JSON.stringify(response)}\`);
        return null;
    }
    
    if (response.data && response.data.list) {
        return response.data.list;
    }
    return response.list || [];`,
`    // testCommonRequest 成功时会直接返回 parsedBody.data，此时没有 msgCode
    if (!response) {
        console.error(\`[\${tag}] 查询订单列表失败, 响应内容: \${JSON.stringify(response)}\`);
        return null;
    }
    
    if (response.data && response.data.list) {
        return response.data.list;
    }
    return response.list || [];`
);

// 修复三方充值的报错判断
content = content.replace(
`    if (!response || response.msgCode !== 0) {
        console.error(\`[\${tag}] 查询三方订单列表失败, 响应内容: \${JSON.stringify(response)}\`);
        return null;
    }
    
    if (response.data && response.data.list) {
        return response.data.list;
    }
    return response.list || [];`,
`    // testCommonRequest 成功时会直接返回 parsedBody.data，此时没有 msgCode
    if (!response) {
        console.error(\`[\${tag}] 查询三方订单列表失败, 响应内容: \${JSON.stringify(response)}\`);
        return null;
    }
    
    if (response.data && response.data.list) {
        return response.data.list;
    }
    return response.list || [];`
);

fs.writeFileSync(apiFile, content);
EOF

node fix_backend_api.js && rm fix_backend_api.js

echo "✨ 修复完成！现在可以正确匹配后台订单了！"