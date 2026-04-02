#!/usr/bin/env node

/**
 * Figma 连接测试工具
 * 
 * 功能：测试 Figma API 连接和配置是否正确
 * 
 * 使用方法：
 *   node test-figma-connection.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'figma-sync-config.json');

// 颜色输出
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * 获取配置
 */
function getConfig() {
    const accessToken = process.env.FIGMA_ACCESS_TOKEN;
    let fileKey = null;

    // 尝试从配置文件读取
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            fileKey = config.figmaFileKey;

            if (!accessToken && config.figmaAccessToken && config.figmaAccessToken !== 'YOUR_FIGMA_ACCESS_TOKEN_HERE') {
                return {
                    accessToken: config.figmaAccessToken,
                    fileKey: fileKey
                };
            }
        }
    } catch (error) {
        // 忽略错误
    }

    return {
        accessToken: accessToken,
        fileKey: fileKey
    };
}

/**
 * 调用 Figma API
 */
function callFigmaAPI(endpoint, accessToken) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.figma.com',
            path: endpoint,
            method: 'GET',
            headers: {
                'X-Figma-Token': accessToken
            }
        };

        https.get(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    body: data
                });
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

/**
 * 测试连接
 */
async function testConnection() {
    log('\n🔍 Figma 连接测试工具', 'cyan');
    log('='.repeat(50), 'blue');

    const config = getConfig();

    // 测试 1: 检查 Access Token
    log('\n📝 测试 1: 检查 Access Token', 'blue');
    if (!config.accessToken) {
        log('❌ 未找到 Access Token', 'red');
        log('请设置环境变量 FIGMA_ACCESS_TOKEN 或在配置文件中填写', 'yellow');
        return false;
    }
    log(`✅ Access Token 已配置 (${config.accessToken.substring(0, 10)}...)`, 'green');

    // 测试 2: 检查 File Key
    log('\n📝 测试 2: 检查 File Key', 'blue');
    if (!config.fileKey || config.fileKey === 'YOUR_FIGMA_FILE_KEY_HERE') {
        log('❌ 未配置 File Key', 'red');
        log('请在 figma-sync-config.json 中填写 figmaFileKey', 'yellow');
        return false;
    }
    log(`✅ File Key 已配置: ${config.fileKey}`, 'green');

    // 测试 3: 测试 API 连接
    log('\n📝 测试 3: 测试 Figma API 连接', 'blue');
    try {
        const response = await callFigmaAPI('/v1/me', config.accessToken);

        if (response.statusCode === 200) {
            const userData = JSON.parse(response.body);
            log('✅ API 连接成功', 'green');
            log(`   用户: ${userData.email || 'N/A'}`, 'cyan');
            log(`   ID: ${userData.id || 'N/A'}`, 'cyan');
        } else if (response.statusCode === 403) {
            log('❌ API 连接失败: 403 Forbidden', 'red');
            log('Token 无效或已过期，请重新生成', 'yellow');
            return false;
        } else {
            log(`❌ API 连接失败: HTTP ${response.statusCode}`, 'red');
            log(`响应: ${response.body}`, 'yellow');
            return false;
        }
    } catch (error) {
        log(`❌ API 连接失败: ${error.message}`, 'red');
        return false;
    }

    // 测试 4: 测试文件访问
    log('\n📝 测试 4: 测试文件访问权限', 'blue');
    try {
        const response = await callFigmaAPI(`/v1/files/${config.fileKey}`, config.accessToken);

        if (response.statusCode === 200) {
            const fileData = JSON.parse(response.body);
            log('✅ 文件访问成功', 'green');
            log(`   文件名: ${fileData.name || 'N/A'}`, 'cyan');
            log(`   最后修改: ${fileData.lastModified || 'N/A'}`, 'cyan');
            log(`   页面数: ${fileData.document?.children?.length || 0}`, 'cyan');
        } else if (response.statusCode === 403) {
            log('❌ 文件访问失败: 403 Forbidden', 'red');
            log('没有访问该文件的权限', 'yellow');
            return false;
        } else if (response.statusCode === 404) {
            log('❌ 文件访问失败: 404 Not Found', 'red');
            log('文件不存在或 File Key 错误', 'yellow');
            return false;
        } else {
            log(`❌ 文件访问失败: HTTP ${response.statusCode}`, 'red');
            log(`响应: ${response.body}`, 'yellow');
            return false;
        }
    } catch (error) {
        log(`❌ 文件访问失败: ${error.message}`, 'red');
        return false;
    }

    // 测试 5: 检查配置文件
    log('\n📝 测试 5: 检查配置文件', 'blue');
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            log('⚠️  配置文件不存在', 'yellow');
            log('请创建 figma-sync-config.json', 'yellow');
            return false;
        }

        const configData = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

        if (!configData.imageMapping || Object.keys(configData.imageMapping).length === 0) {
            log('⚠️  imageMapping 为空', 'yellow');
            log('请配置图片映射关系', 'yellow');
            return false;
        }

        const categories = Object.keys(configData.imageMapping);
        const totalImages = Object.values(configData.imageMapping).reduce((sum, cat) => sum + Object.keys(cat).length, 0);

        log('✅ 配置文件格式正确', 'green');
        log(`   分类数: ${categories.length}`, 'cyan');
        log(`   图片数: ${totalImages}`, 'cyan');
        log(`   分类: ${categories.join(', ')}`, 'cyan');

        // 检查是否有未配置的节点
        let unconfiguredCount = 0;
        for (const [category, files] of Object.entries(configData.imageMapping)) {
            for (const [filename, nodeId] of Object.entries(files)) {
                if (nodeId.startsWith('NODE_ID_')) {
                    unconfiguredCount++;
                }
            }
        }

        if (unconfiguredCount > 0) {
            log(`⚠️  有 ${unconfiguredCount} 个节点未配置（使用占位符 NODE_ID_）`, 'yellow');
            log('请使用 get-figma-nodes.js 获取实际的节点 ID', 'yellow');
        }

    } catch (error) {
        log(`❌ 配置文件解析失败: ${error.message}`, 'red');
        return false;
    }

    // 所有测试通过
    log('\n' + '='.repeat(50), 'blue');
    log('🎉 所有测试通过！配置正确，可以开始同步图片了', 'green');
    log('\n下一步:', 'cyan');
    log('  ./sync-figma.sh                    # 同步所有图片', 'blue');
    log('  ./sync-figma.sh banner             # 同步指定分类', 'blue');
    log('='.repeat(50), 'blue');

    return true;
}

// 运行测试
testConnection().catch((error) => {
    log(`\n❌ 测试失败: ${error.message}`, 'red');
    process.exit(1);
});
