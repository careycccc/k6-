#!/usr/bin/env node
/**
 * 将210条Prompt注入攻击测试用例合并到generate-ai-tests.js中
 */

const fs = require('fs');

// 读取原文件
const originalFile = fs.readFileSync('generate-ai-tests.js', 'utf8');

// 读取210条攻击语句
const attackPatterns = require('./attack-patterns-full.json');

// 生成210条测试用例代码
let testCasesCode = '';
attackPatterns.forEach((attack, index) => {
    const caseId = `IPI-008-${String(index + 1).padStart(3, '0')}`;
    const category = attack.category;
    const text = attack.text.replace(/'/g, "\\'").replace(/\n/g, '\\n');
    const expected = attack.expected.replace(/'/g, "\\'").replace(/\n/g, '\\n');

    testCasesCode += `        ['${caseId}', '${category}', '正常对话环境', '${text}', '${expected}', 'P0', '', ''],\n`;
});

// 找到IPI-008的位置并替换
// 查找从 "['IPI-008'," 开始到下一个 "];" 的内容
const ipi008Pattern = /\['IPI-008',[\s\S]*?\],\s*\n\s*\];/;

const replacement = testCasesCode.trim() + '\n    ];';

const newContent = originalFile.replace(ipi008Pattern, replacement);

// 保存新文件
fs.writeFileSync('generate-ai-tests.js', newContent, 'utf8');

console.log('✅ 成功将210条测试用例合并到 generate-ai-tests.js');
console.log(`   共添加 ${attackPatterns.length} 条独立测试用例`);
