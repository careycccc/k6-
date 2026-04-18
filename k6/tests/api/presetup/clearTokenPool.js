#!/usr/bin/env node
/**
 * Redis Token 池清理脚本（Node.js 版本）
 *
 * 优点：不依赖 k6，更轻量，适合 CI/CD 流水线或测试结束后自动调用
 * 依赖：ioredis（npm install ioredis）
 *
 * 使用方法：
 *
 *   # 清空单个租户
 *   node clearTokenPool.js --tenant=3001
 *
 *   # 清空多个租户
 *   node clearTokenPool.js --tenants=3001,3002,3003
 *
 *   # 清空所有已知租户
 *   node clearTokenPool.js --tenants=all
 *
 *   # 指定 Redis 地址（默认 localhost:6379）
 *   node clearTokenPool.js --redis=redis://192.168.1.100:6379 --tenants=all
 *
 *   # 仅预览（不实际删除，dry-run 模式）
 *   node clearTokenPool.js --tenants=all --dry-run
 */

const Redis = require('ioredis');

// ============================================================
// 配置
// ============================================================
const ALL_KNOWN_TENANTS = ['3001', '3002', '3003', '3004', '3005', '3006', '3007'];
const TOKEN_POOL_PREFIX = 'token_pool';

// ============================================================
// 解析命令行参数
// ============================================================
function parseArgs() {
    const args = process.argv.slice(2);
    const result = {
        redisUrl: 'redis://localhost:6379',
        tenants: [],
        dryRun: false
    };

    for (const arg of args) {
        if (arg.startsWith('--redis=')) {
            result.redisUrl = arg.split('=')[1];
        } else if (arg.startsWith('--tenant=')) {
            result.tenants = [arg.split('=')[1].trim()];
        } else if (arg.startsWith('--tenants=')) {
            const val = arg.split('=')[1].trim();
            result.tenants = val === 'all' ? ALL_KNOWN_TENANTS : val.split(',').map(t => t.trim());
        } else if (arg === '--dry-run') {
            result.dryRun = true;
        }
    }

    // 也支持环境变量
    if (result.tenants.length === 0) {
        const envTenants = process.env.TENANTS || process.env.TENANT_ID || '';
        if (envTenants === 'all') {
            result.tenants = ALL_KNOWN_TENANTS;
        } else if (envTenants) {
            result.tenants = envTenants.split(',').map(t => t.trim());
        }
    }
    if (process.env.REDIS_URL) {
        result.redisUrl = process.env.REDIS_URL;
    }

    return result;
}

// ============================================================
// 主逻辑
// ============================================================
async function main() {
    const { redisUrl, tenants, dryRun } = parseArgs();

    if (tenants.length === 0) {
        console.error(
            '\n❌ 未指定租户，请使用以下参数：\n' +
            '   node clearTokenPool.js --tenant=3001\n' +
            '   node clearTokenPool.js --tenants=3001,3002,3003\n' +
            '   node clearTokenPool.js --tenants=all\n'
        );
        process.exit(1);
    }

    const client = new Redis(redisUrl);

    client.on('error', (err) => {
        console.error(`❌ Redis 连接错误: ${err.message}`);
        process.exit(1);
    });

    console.log('\n' + '='.repeat(60));
    console.log(`🗑️  Redis Token 池清理${dryRun ? '（dry-run 预览模式）' : ''}`);
    console.log(`   Redis  : ${redisUrl}`);
    console.log(`   租户   : ${tenants.join(', ')}`);
    console.log('='.repeat(60) + '\n');

    let totalCleared = 0;

    for (const tenantId of tenants) {
        const key = `${TOKEN_POOL_PREFIX}:${tenantId}`;
        const size = await client.llen(key);

        if (size === 0) {
            console.log(`[${tenantId}] 池已为空，跳过`);
            continue;
        }

        if (dryRun) {
            console.log(`[${tenantId}] 预览: 将清空 ${size} 个 token（key: ${key}）`);
            totalCleared += size;
            continue;
        }

        await client.del(key);

        // 确认清空
        const after = await client.llen(key);
        if (after === 0) {
            console.log(`[${tenantId}] ✅ 已清空 ${size} 个 token`);
            totalCleared += size;
        } else {
            console.error(`[${tenantId}] ⚠️  清空后仍剩余 ${after} 个，请检查 Redis`);
        }
    }

    console.log('\n' + '='.repeat(60));
    if (dryRun) {
        console.log(`📋 预览完成，共 ${totalCleared} 个 token 待清空（未实际删除）`);
    } else {
        console.log(`✅ 清理完成，共清空 ${totalCleared} 个 token`);
        console.log(`   下次压测前请重新运行 batchRegister.test.js 注入新 token`);
    }
    console.log('='.repeat(60) + '\n');

    await client.quit();
}

main().catch(err => {
    console.error(`❌ 执行失败: ${err.message}`);
    process.exit(1);
});
