#!/usr/bin/env node

/**
 * 对比新旧两种下载方式的 API 调用次数
 * 
 * 这个脚本只模拟 API 调用，不实际下载图片
 */

const axios = require('axios');

// 模拟配置
const MOCK_CONFIG = {
    fileKey: 'DEMO_FILE_KEY',
    token: 'DEMO_TOKEN',
    imageCount: 13  // 假设有 13 张图片
};

/**
 * 旧方式：每张图片单独请求
 */
async function oldMethod(imageCount) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('❌ 旧方式：逐个请求');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    let apiCalls = 0;

    // 第 1 次：获取文件结构
    console.log(`[${++apiCalls}] GET /files/${MOCK_CONFIG.fileKey}`);
    console.log('    → 获取文件结构，找到所有需要导出的图层\n');

    // 模拟找到的图层 ID
    const nodeIds = Array.from({ length: imageCount }, (_, i) => `node_${i + 1}`);

    // 每张图片单独请求
    for (let i = 0; i < nodeIds.length; i++) {
        console.log(`[${++apiCalls}] GET /images/${MOCK_CONFIG.fileKey}?ids=${nodeIds[i]}`);
        console.log(`    → 获取图片 ${i + 1} 的下载链接\n`);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 总计 API 调用: ${apiCalls} 次`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return apiCalls;
}

/**
 * 新方式：批量请求
 */
async function newMethod(imageCount) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ 新方式：批量请求');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    let apiCalls = 0;

    // 第 1 次：获取文件结构
    console.log(`[${++apiCalls}] GET /files/${MOCK_CONFIG.fileKey}`);
    console.log('    → 获取文件结构，找到所有需要导出的图层\n');

    // 模拟找到的图层 ID
    const nodeIds = Array.from({ length: imageCount }, (_, i) => `node_${i + 1}`);

    // 第 2 次：批量获取所有图片链接
    const allIds = nodeIds.join(',');
    console.log(`[${++apiCalls}] GET /images/${MOCK_CONFIG.fileKey}?ids=${allIds}`);
    console.log(`    → 批量获取 ${imageCount} 张图片的下载链接`);
    console.log(`    → 参数: ids=${nodeIds[0]},${nodeIds[1]},...,${nodeIds[nodeIds.length - 1]}\n`);

    console.log('💡 下载图片（不消耗 Figma API 配额）:');
    for (let i = 0; i < imageCount; i++) {
        console.log(`    [CDN] 下载图片 ${i + 1} from https://figma-cdn.com/...`);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 总计 API 调用: ${apiCalls} 次`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return apiCalls;
}

/**
 * 显示对比结果
 */
function showComparison(oldCalls, newCalls, imageCount) {
    const saved = oldCalls - newCalls;
    const percentage = ((saved / oldCalls) * 100).toFixed(1);

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                        对比结果                                 ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    console.log(`📊 图片数量: ${imageCount} 张\n`);

    console.log('┌────────────────────────────────────────────────────────────────┐');
    console.log('│  方式      │  API 调用次数  │  说明                           │');
    console.log('├────────────────────────────────────────────────────────────────┤');
    console.log(`│  旧方式    │  ${oldCalls.toString().padEnd(12)} │  每张图片单独请求           │`);
    console.log(`│  新方式    │  ${newCalls.toString().padEnd(12)} │  批量获取所有链接           │`);
    console.log('└────────────────────────────────────────────────────────────────┘\n');

    console.log(`🎯 节省: ${saved} 次 API 调用 (${percentage}%)\n`);

    // 计算不同图片数量下的对比
    console.log('📈 不同图片数量下的对比:\n');
    console.log('┌────────────────────────────────────────────────────────────────┐');
    console.log('│  图片数  │  旧方式  │  新方式  │  节省次数  │  节省比例    │');
    console.log('├────────────────────────────────────────────────────────────────┤');

    const testCases = [10, 13, 20, 50, 100, 200, 500];
    testCases.forEach(count => {
        const old = count + 1;
        const newVal = 2;
        const savedCount = old - newVal;
        const percent = ((savedCount / old) * 100).toFixed(1);

        console.log(
            `│  ${count.toString().padEnd(6)} │  ` +
            `${old.toString().padEnd(6)} │  ` +
            `${newVal.toString().padEnd(6)} │  ` +
            `${savedCount.toString().padEnd(8)} │  ` +
            `${percent.padEnd(10)}% │`
        );
    });
    console.log('└────────────────────────────────────────────────────────────────┘\n');

    // Figma API 限制说明
    console.log('⚠️  Figma API 限制:\n');
    console.log('   免费版: 1000 次/小时');
    console.log('   专业版: 5000 次/小时\n');

    console.log('💡 使用新方式的好处:\n');
    console.log(`   • 旧方式最多下载: ${Math.floor(1000 / (imageCount + 1))} 轮 × ${imageCount} 张 = ${Math.floor(1000 / (imageCount + 1)) * imageCount} 张/小时`);
    console.log(`   • 新方式最多下载: ${Math.floor(1000 / 2)} 轮 × ${imageCount} 张 = ${Math.floor(1000 / 2) * imageCount} 张/小时`);
    console.log(`   • 提升: ${(Math.floor(1000 / 2) * imageCount / (Math.floor(1000 / (imageCount + 1)) * imageCount)).toFixed(1)}x\n`);
}

/**
 * 主函数
 */
async function main() {
    const args = process.argv.slice(2);
    let imageCount = MOCK_CONFIG.imageCount;

    // 解析参数
    for (const arg of args) {
        if (arg.startsWith('--count=')) {
            imageCount = parseInt(arg.split('=')[1]);
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
对比新旧两种下载方式的 API 调用次数

使用方法:
  node compare-methods.js [选项]

选项:
  --count=N       指定图片数量 (默认: 13)
  --help, -h      显示帮助

示例:
  # 对比 13 张图片的情况
  node compare-methods.js

  # 对比 100 张图片的情况
  node compare-methods.js --count=100
            `);
            process.exit(0);
        }
    }

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║           Figma 下载方式对比                                    ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');

    // 执行旧方式
    const oldCalls = await oldMethod(imageCount);

    // 执行新方式
    const newCalls = await newMethod(imageCount);

    // 显示对比
    showComparison(oldCalls, newCalls, imageCount);
}

// 运行
if (require.main === module) {
    main().catch(error => {
        console.error('❌ 发生错误:', error.message);
        process.exit(1);
    });
}

module.exports = { oldMethod, newMethod, showComparison };
