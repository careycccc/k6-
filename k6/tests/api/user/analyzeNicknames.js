#!/usr/bin/env node
/**
 * analyzeNicknames.js
 *
 * 解析 k6 输出日志，检测昵称是否重复，并打印所有重复昵称及对应的 userId/account。
 *
 * 用法：
 *   node analyzeNicknames.js output.log
 *   node analyzeNicknames.js output.log --verbose   # 打印全量昵称列表
 *
 * 日志格式（由 nickNameDuplicateCheck.test.js 输出）：
 *   [NICKNAME_CHECK]  <userId>  <account>  <nickName>
 *   字段之间以 \t 分隔
 */

const fs   = require('fs');
const path = require('path');

// ── 参数解析 ──────────────────────────────────────────────────
const args    = process.argv.slice(2);
const logFile = args.find(a => !a.startsWith('--'));
const verbose = args.includes('--verbose');

if (!logFile) {
    console.error('用法: node analyzeNicknames.js <output.log> [--verbose]');
    process.exit(1);
}

if (!fs.existsSync(logFile)) {
    console.error(`❌ 找不到日志文件: ${logFile}`);
    process.exit(1);
}

// ── 读取并解析日志 ────────────────────────────────────────────
const lines   = fs.readFileSync(logFile, 'utf8').split('\n');
const records = []; // { userId, account, nickName }

for (const line of lines) {
    // k6 日志行可能带时间戳前缀，只要包含 [NICKNAME_CHECK] 就处理
    const idx = line.indexOf('[NICKNAME_CHECK]');
    if (idx === -1) continue;

    // 取 [NICKNAME_CHECK] 之后的部分，按 \t 分割
    const rest   = line.slice(idx + '[NICKNAME_CHECK]'.length).trim();
    const parts  = rest.split('\t');

    if (parts.length < 3) {
        // 兼容旧格式（空格分隔，nickName= 前缀）
        const oldMatch = rest.match(/userId=(\S+).*?nickName=(\S+).*?account=(\S+)/);
        if (oldMatch) {
            records.push({ userId: oldMatch[1], nickName: oldMatch[2], account: oldMatch[3] });
        }
        continue;
    }

    const [userId, account, ...nickParts] = parts;
    // nickName 可能含空格（虽然目前不太可能），用剩余 parts 拼回
    const nickName = nickParts.join('\t').trim();

    if (userId && account && nickName) {
        records.push({ userId: userId.trim(), account: account.trim(), nickName: nickName.trim() });
    }
}

console.log(`\n${'═'.repeat(65)}`);
console.log('🔍 昵称重复检测分析报告');
console.log(`   日志文件: ${path.resolve(logFile)}`);
console.log(`   解析记录数: ${records.length}`);
console.log('═'.repeat(65));

if (records.length === 0) {
    console.log('\n⚠️  未找到任何 [NICKNAME_CHECK] 记录，请确认：');
    console.log('   1. 压测时已将输出重定向到文件（2>&1 | tee output.log）');
    console.log('   2. 压测脚本版本正确（包含 [NICKNAME_CHECK] 日志行）');
    process.exit(0);
}

// ── 聚合：nickName → [{userId, account}] ─────────────────────
const nickMap = new Map(); // nickName → Array<{userId, account}>

for (const rec of records) {
    if (!nickMap.has(rec.nickName)) {
        nickMap.set(rec.nickName, []);
    }
    nickMap.get(rec.nickName).push({ userId: rec.userId, account: rec.account });
}

// ── 找出重复 ──────────────────────────────────────────────────
const duplicates = [];
for (const [nickName, entries] of nickMap) {
    if (entries.length > 1) {
        duplicates.push({ nickName, entries });
    }
}

// ── 输出结果 ──────────────────────────────────────────────────
const totalNicknames  = nickMap.size;
const duplicateCount  = duplicates.length;
const duplicateUsers  = duplicates.reduce((sum, d) => sum + d.entries.length, 0);

console.log(`\n📊 统计摘要`);
console.log(`   注册成功总量:   ${records.length}`);
console.log(`   唯一昵称数量:   ${totalNicknames}`);
console.log(`   重复昵称数量:   ${duplicateCount}`);
console.log(`   涉及用户总数:   ${duplicateUsers}`);

if (duplicateCount === 0) {
    console.log('\n✅ 无昵称重复！后端昵称分配在此次压测下表现正常。');
} else {
    console.log(`\n❌ 发现 ${duplicateCount} 个重复昵称！详情如下：`);
    console.log('─'.repeat(65));

    // 按重复次数降序排列，最严重的排前面
    duplicates.sort((a, b) => b.entries.length - a.entries.length);

    for (let i = 0; i < duplicates.length; i++) {
        const { nickName, entries } = duplicates[i];
        console.log(`\n[${i + 1}] 昵称: "${nickName}"  （共 ${entries.length} 个用户使用此昵称）`);
        for (const { userId, account } of entries) {
            console.log(`    userId=${userId}  account=${account}`);
        }
    }

    console.log('\n' + '─'.repeat(65));
    console.log('📋 重复昵称汇总（复制友好格式）：');
    console.log('');
    for (const { nickName, entries } of duplicates) {
        const userIds = entries.map(e => e.userId).join(', ');
        console.log(`昵称="${nickName}" → userIds: [${userIds}]`);
    }
}

// ── verbose 模式：打印全量昵称表 ─────────────────────────────
if (verbose) {
    console.log(`\n${'─'.repeat(65)}`);
    console.log('📋 全量昵称列表（--verbose）');
    console.log('─'.repeat(65));

    // 按昵称字母排序，重复的加 ❌ 标记
    const dupSet = new Set(duplicates.map(d => d.nickName));
    const sorted = [...nickMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    for (const [nickName, entries] of sorted) {
        const flag = dupSet.has(nickName) ? '❌ 重复' : '✅';
        const userIds = entries.map(e => e.userId).join(', ');
        console.log(`${flag}  "${nickName}"  userIds: [${userIds}]`);
    }
}

console.log(`\n${'═'.repeat(65)}\n`);

// 有重复时以非 0 退出码退出，方便 CI 捕获
process.exit(duplicateCount > 0 ? 1 : 0);
