#!/usr/bin/env node

/**
 * Figma 图片同步工具
 * 
 * 功能：
 * 1. 从 Figma 文件中导出指定节点的图片
 * 2. 自动下载并保存到对应的本地文件夹
 * 3. 支持批量更新所有图片
 * 
 * 使用方法：
 * 1. 配置 figma-sync-config.json 文件
 * 2. 运行: node sync-figma-images.js
 * 3. 或运行: node sync-figma-images.js --category=banner (只更新指定分类)
 * 
 * 环境变量：
 * - FIGMA_ACCESS_TOKEN: Figma 访问令牌（可选，优先级高于配置文件）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// 配置文件路径
const CONFIG_FILE = path.join(__dirname, 'figma-sync-config.json');
const IMG_BASE_DIR = path.join(__dirname, 'img');

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
 * 加载配置文件
 */
function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            log(`❌ 配置文件不存在: ${CONFIG_FILE}`, 'red');
            log('请先创建配置文件并填写 Figma 信息', 'yellow');
            process.exit(1);
        }

        const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

        // 环境变量优先
        const accessToken = process.env.FIGMA_ACCESS_TOKEN || config.figmaAccessToken;

        if (!accessToken || accessToken === 'YOUR_FIGMA_ACCESS_TOKEN_HERE') {
            log('❌ 请配置 Figma Access Token', 'red');
            log('方法1: 在 figma-sync-config.json 中设置 figmaAccessToken', 'yellow');
            log('方法2: 设置环境变量 FIGMA_ACCESS_TOKEN', 'yellow');
            process.exit(1);
        }

        if (!config.figmaFileKey || config.figmaFileKey === 'YOUR_FIGMA_FILE_KEY_HERE') {
            log('❌ 请配置 Figma File Key', 'red');
            log('在 figma-sync-config.json 中设置 figmaFileKey', 'yellow');
            process.exit(1);
        }

        return {
            accessToken,
            fileKey: config.figmaFileKey,
            imageMapping: config.imageMapping
        };
    } catch (error) {
        log(`❌ 加载配置文件失败: ${error.message}`, 'red');
        process.exit(1);
    }
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
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error(`解析响应失败: ${error.message}`));
                    }
                } else {
                    reject(new Error(`API 请求失败: ${res.statusCode} - ${data}`));
                }
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

/**
 * 获取图片导出 URL
 */
async function getImageUrls(fileKey, nodeIds, accessToken) {
    const nodeIdsParam = nodeIds.join(',');
    const endpoint = `/v1/images/${fileKey}?ids=${encodeURIComponent(nodeIdsParam)}&format=png&scale=2`;

    log(`📡 正在获取图片导出链接...`, 'cyan');
    const response = await callFigmaAPI(endpoint, accessToken);

    if (response.err) {
        throw new Error(`获取图片 URL 失败: ${response.err}`);
    }

    return response.images;
}

/**
 * 下载图片
 */
function downloadImage(url, outputPath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;

        protocol.get(url, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                // 处理重定向
                downloadImage(res.headers.location, outputPath)
                    .then(resolve)
                    .catch(reject);
                return;
            }

            if (res.statusCode !== 200) {
                reject(new Error(`下载失败: HTTP ${res.statusCode}`));
                return;
            }

            const fileStream = fs.createWriteStream(outputPath);
            res.pipe(fileStream);

            fileStream.on('finish', () => {
                fileStream.close();
                resolve();
            });

            fileStream.on('error', (error) => {
                fs.unlink(outputPath, () => { }); // 删除不完整的文件
                reject(error);
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

/**
 * 同步图片
 */
async function syncImages(config, targetCategory = null) {
    const { accessToken, fileKey, imageMapping } = config;

    log('\n🚀 开始同步 Figma 图片...', 'green');
    log(`📁 Figma File Key: ${fileKey}`, 'blue');

    // 过滤目标分类
    const categories = targetCategory
        ? { [targetCategory]: imageMapping[targetCategory] }
        : imageMapping;

    if (targetCategory && !categories[targetCategory]) {
        log(`❌ 分类不存在: ${targetCategory}`, 'red');
        process.exit(1);
    }

    // 收集所有需要下载的节点
    const allNodeIds = [];
    const nodeToFileMap = {}; // nodeId -> { category, filename }

    for (const [category, files] of Object.entries(categories)) {
        for (const [filename, nodeId] of Object.entries(files)) {
            if (nodeId.startsWith('NODE_ID_')) {
                log(`⚠️  跳过未配置的节点: ${category}/${filename}`, 'yellow');
                continue;
            }
            allNodeIds.push(nodeId);
            nodeToFileMap[nodeId] = { category, filename };
        }
    }

    if (allNodeIds.length === 0) {
        log('❌ 没有找到需要同步的图片（请检查配置文件中的 NODE_ID）', 'red');
        return;
    }

    log(`📊 共找到 ${allNodeIds.length} 个图片需要同步`, 'blue');

    try {
        // 获取所有图片的导出 URL
        const imageUrls = await getImageUrls(fileKey, allNodeIds, accessToken);

        // 下载图片
        let successCount = 0;
        let failCount = 0;

        for (const [nodeId, url] of Object.entries(imageUrls)) {
            if (!url) {
                log(`❌ 节点 ${nodeId} 没有返回图片 URL`, 'red');
                failCount++;
                continue;
            }

            const { category, filename } = nodeToFileMap[nodeId];
            const categoryDir = path.join(IMG_BASE_DIR, category);
            const outputPath = path.join(categoryDir, filename);

            // 确保目录存在
            if (!fs.existsSync(categoryDir)) {
                fs.mkdirSync(categoryDir, { recursive: true });
            }

            try {
                log(`⬇️  下载: ${category}/${filename}`, 'cyan');
                await downloadImage(url, outputPath);
                log(`✅ 成功: ${category}/${filename}`, 'green');
                successCount++;
            } catch (error) {
                log(`❌ 失败: ${category}/${filename} - ${error.message}`, 'red');
                failCount++;
            }
        }

        // 统计结果
        log('\n' + '='.repeat(50), 'blue');
        log(`📊 同步完成！`, 'green');
        log(`✅ 成功: ${successCount}`, 'green');
        if (failCount > 0) {
            log(`❌ 失败: ${failCount}`, 'red');
        }
        log('='.repeat(50), 'blue');

    } catch (error) {
        log(`❌ 同步失败: ${error.message}`, 'red');
        process.exit(1);
    }
}

/**
 * 主函数
 */
async function main() {
    // 解析命令行参数
    const args = process.argv.slice(2);
    let targetCategory = null;

    for (const arg of args) {
        if (arg.startsWith('--category=')) {
            targetCategory = arg.split('=')[1];
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
Figma 图片同步工具

使用方法:
  node sync-figma-images.js                    # 同步所有图片
  node sync-figma-images.js --category=banner  # 只同步指定分类

环境变量:
  FIGMA_ACCESS_TOKEN  Figma 访问令牌（可选）

配置文件:
  figma-sync-config.json  配置 Figma 文件和图片映射关系
      `);
            process.exit(0);
        }
    }

    const config = loadConfig();
    await syncImages(config, targetCategory);
}

// 运行
main().catch((error) => {
    log(`❌ 发生错误: ${error.message}`, 'red');
    process.exit(1);
});
