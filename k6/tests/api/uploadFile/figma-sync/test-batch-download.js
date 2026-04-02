#!/usr/bin/env node

/**
 * 测试批量下载功能
 * 
 * 使用方法：
 * 1. 设置环境变量：
 *    export FIGMA_TOKEN="你的Token"
 *    export FIGMA_FILE_KEY="你的文件Key"
 * 
 * 2. 运行测试：
 *    node test-batch-download.js
 * 
 * 3. 或者直接传参：
 *    node test-batch-download.js --token=xxx --fileKey=xxx
 */

const path = require('path');
const { downloadFromFigma, getFigmaFileInfo } = require('./core/figma-api');

// 解析命令行参数
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        token: process.env.FIGMA_TOKEN,
        fileKey: process.env.FIGMA_FILE_KEY,
        outputFolder: path.join(__dirname, 'img/test-output'),
        showInfo: false
    };

    for (const arg of args) {
        if (arg.startsWith('--token=')) {
            config.token = arg.split('=')[1];
        } else if (arg.startsWith('--fileKey=')) {
            config.fileKey = arg.split('=')[1];
        } else if (arg.startsWith('--output=')) {
            config.outputFolder = arg.split('=')[1];
        } else if (arg === '--info') {
            config.showInfo = true;
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
测试批量下载功能

使用方法:
  node test-batch-download.js [选项]

选项:
  --token=TOKEN       Figma Access Token
  --fileKey=KEY       Figma File Key
  --output=PATH       输出目录 (默认: img/test-output)
  --info              只显示文件信息，不下载
  --help, -h          显示帮助

环境变量:
  FIGMA_TOKEN         Figma Access Token
  FIGMA_FILE_KEY      Figma File Key

示例:
  # 使用环境变量
  export FIGMA_TOKEN="figd_xxx"
  export FIGMA_FILE_KEY="7LqisrlVeOwdEpNyPPxKDZ"
  node test-batch-download.js

  # 使用命令行参数
  node test-batch-download.js --token=figd_xxx --fileKey=7LqisrlVeOwdEpNyPPxKDZ

  # 只查看文件信息
  node test-batch-download.js --info
            `);
            process.exit(0);
        }
    }

    return config;
}

async function main() {
    const config = parseArgs();

    // 验证配置
    if (!config.token) {
        console.error('❌ 错误: 未设置 Figma Token');
        console.error('   请设置环境变量 FIGMA_TOKEN 或使用 --token 参数');
        process.exit(1);
    }

    if (!config.fileKey) {
        console.error('❌ 错误: 未设置 Figma File Key');
        console.error('   请设置环境变量 FIGMA_FILE_KEY 或使用 --fileKey 参数');
        process.exit(1);
    }

    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║           Figma 批量下载测试                                    ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    try {
        // 如果只是查看信息
        if (config.showInfo) {
            console.log('📋 获取文件信息...\n');
            const info = await getFigmaFileInfo(config.fileKey, config.token);

            console.log('文件信息:');
            console.log(`  名称: ${info.name}`);
            console.log(`  版本: ${info.version}`);
            console.log(`  最后修改: ${info.lastModified}`);
            console.log(`\n页面列表 (${info.pages.length} 个):`);
            info.pages.forEach((page, index) => {
                console.log(`  ${index + 1}. ${page.name} (${page.type})`);
            });

            return;
        }

        // 执行批量下载
        console.log('配置信息:');
        console.log(`  Token: ${config.token.substring(0, 10)}...`);
        console.log(`  File Key: ${config.fileKey}`);
        console.log(`  输出目录: ${config.outputFolder}`);
        console.log('');

        const result = await downloadFromFigma({
            fileKey: config.fileKey,
            accessToken: config.token,
            outputFolder: config.outputFolder,
            options: {
                skipHidden: true,        // 跳过隐藏图层
                // pageFilter: '活动',   // 可选：只处理特定页面
                // nameFilter: 'Banner'  // 可选：只处理特定名称的图层
            },
            fileMapping: {},             // 可选：文件名映射
            format: 'png',
            scale: 2
        });

        console.log('\n✅ 测试完成！');
        console.log(`\n💡 提示: 图片已保存到 ${config.outputFolder}`);

        if (result.errors.length > 0) {
            console.log('\n⚠️  部分图片下载失败:');
            result.errors.forEach(err => {
                console.log(`   - ${err.node}: ${err.error}`);
            });
        }

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        if (error.response) {
            console.error('   详细信息:', JSON.stringify(error.response.data, null, 2));
        }
        process.exit(1);
    }
}

// 运行
if (require.main === module) {
    main().catch(error => {
        console.error('❌ 发生错误:', error.message);
        process.exit(1);
    });
}
