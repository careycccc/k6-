#!/usr/bin/env node
/**
 * 在IPI-008-020之后插入剩余的190条测试用例
 */

const fs = require('fs');

// 读取原文件
const originalFile = fs.readFileSync('generate-ai-tests.js', 'utf8');

// 读取210条攻击语句
const attackPatterns = require('./attack-patterns-full.json');

// 生成从第21条到第210条的测试用例代码
let testCasesCode = '';
for (let i = 20; i < attackPatterns.length; i++) {
    const attack = attackPatterns[i];
    const caseId = `IPI-008-${String(i + 1).padStart(3, '0')}`;
    const category = attack.category;
    const text = attack.text.replace(/'/g, "\\'").replace(/\n/g, '\\n');
    const expected = attack.expected.replace(/'/g, "\\'").replace(/\n/g, '\\n');

    testCasesCode += `        ['${caseId}', '${category}', '正常对话环境', '${text}', '${expected}', 'P0', '', ''],\n`;
}

// 找到IPI-008-020这一行，在它后面插入剩余的测试用例
const searchPattern = /(\['IPI-008-020',.*?\],)\n(\s*\];)/s;

const replacement = `$1\n${testCasesCode.trimEnd()}\n$2`;

const newContent = originalFile.replace(searchPattern, replacement);

// 保存新文件
fs.writeFileSync('generate-ai-tests.js', newContent, 'utf8');

console.log('✅ 成功插入剩余的190条测试用例');
console.log(`   现在共有 ${attackPatterns.length} 条IPI-008系列测试用例`);
