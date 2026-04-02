#!/usr/bin/env node

/**
 * 自动下载 Figma 中的 Banner 图片
 * 
 * 功能：
 * 1. 遍历指定页面的所有 FRAME 节点
 * 2. 在每个 FRAME 下查找以 "Banner" 开头的子节点
 * 3. 下载这些图片到本地
 * 4. 自动去重（跳过已存在的同名文件）
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// 配置
const CONFIG_FILE = path.join(__dirname, 'figma-sync-config.json');
const OUTPUT_DIR = path.join(__dirname, 'downloaded-banners');

// 颜色输出
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * 获取 Access Token
 */
function getAccessToken() {
    if (process.env.FIGMA_ACCESS_TOKEN) {
        return process.env.FIGMA_ACCESS_TOKEN;
    }

    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (config.figmaAccessToken && config.figmaAccessToken !== 'YOUR_FIGMA_ACCESS_TOKEN_HERE') {
                return config.figmaAccessToken;
            }
        }
    } catch (error) {
        // 忽略
    }

    return null;
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
            const chunks = [];

            res.on('data', (chunk) => {
                chunks.push(chunk);
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const buffer = Buffer.concat(chunks);
                        const data = JSON.parse(buffer.toString('utf8'));
                        resolve(data);
                    } catch (error) {
                        reject(new Error(`解析响应失败: ${error.message}`));
                    }
                } else {
                    reject(new Error(`API 请求失败: ${res.statusCode}`));
                }
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

/**
 * 获取节点详情
 */
function getNodeDetails(fileKey, nodeIds, accessToken) {
    const idsParam = nodeIds.join(',');
    return callFigmaAPI(`/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(idsParam)}`, accessToken);
}

/**
 * 查找顶层 FRAME 节点（只查找以"活动"开头的）
 */
function findTopLevelActivityFrames(node, frames = [], depth = 0) {
    // 只查找顶层的 FRAME（depth <= 2）
    if (depth > 2) return frames;

    if (node.type === 'FRAME' && node.name.startsWith('活动')) {
        frames.push({
            id: node.id,
            name: node.name
        });
    }

    if (node.children && node.children.length > 0 && depth < 2) {
        for (const child of node.children) {
            findTopLevelActivityFrames(child, frames, depth + 1);
        }
    }

    return frames;
}

/**
 * 从 Banner 名称中提取编号
 * 例如: "Banner 13 - 每日签到" -> 13
 */
function extractBannerNumber(name) {
    const match = name.match(/Banner\s+(\d+)/i);
    return match ? parseInt(match[1]) : null;
}

/**
 * 在节点下查找以 "Banner" 开头的子节点
 */
function findBannerNodes(node, banners = [], depth = 0, maxDepth = 10) {
    if (depth > maxDepth) return banners;

    const nodeName = node.name || '';

    // 检查是否以 "Banner" 开头（不区分大小写）
    if (nodeName.toLowerCase().startsWith('banner')) {
        const bannerNum = extractBannerNumber(nodeName);
        banners.push({
            id: node.id.replace(/:/g, '-'),
            name: nodeName,
            type: node.type,
            number: bannerNum
        });
    }

    // 继续递归查找子节点
    if (node.children && node.children.length > 0) {
        for (const child of node.children) {
            findBannerNodes(child, banners, depth + 1, maxDepth);
        }
    }

    return banners;
}

/**
 * 获取图片下载 URL
 */
function getImageUrls(fileKey, nodeIds, accessToken) {
    const idsParam = nodeIds.join(',');
    return callFigmaAPI(
        `/v1/images/${fileKey}?ids=${encodeURIComponent(idsParam)}&format=png&scale=2`,
        accessToken
    );
}

/**
 * 下载图片
 */
function downloadImage(url, filepath) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode === 200) {
                const fileStream = fs.createWriteStream(filepath);
                res.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve();
                });
                fileStream.on('error', reject);
            } else {
                reject(new Error(`下载失败: ${res.statusCode}`));
            }
        }).on('error', reject);
    });
}

/**
 * 清理文件名
 */
function sanitizeFilename(name) {
    return name
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .substring(0, 200);
}

/**
 * 从 URL 提取 File Key
 */
function extractFileKey(input) {
    if (!input.includes('/') && !input.includes('http')) {
        return input;
    }

    const match = input.match(/figma\.com\/(design|file)\/([a-zA-Z0-9]+)/);
    if (match) {
        return match[2];
    }

    throw new Error('无法从 URL 中提取 File Key');
}

/**
 * 主函数
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.log(`
自动下载 Figma Banner 图片工具

使用方法:
  node download-banners.js <FIGMA_URL_OR_KEY> --page="页面名"

参数:
  FIGMA_URL_OR_KEY  Figma 文件 URL 或 File Key（必需）
  --page=NAME       指定页面名称（必需）
  --output=DIR      输出目录（可选，默认: downloaded-banners）
  --prefix=TEXT     只下载以指定前缀开头的 Banner（可选，默认: Banner）
  --dry-run         预览模式，不实际下载（可选）

示例:
  # 下载"活动"页面的所有 Banner
  node download-banners.js "https://..." --page="活动"

  # 只下载以 "Banner 13" 开头的图片
  node download-banners.js "https://..." --page="活动" --prefix="Banner 13"

  # 预览模式（不实际下载）
  node download-banners.js "https://..." --page="活动" --dry-run
    `);
        process.exit(0);
    }

    const input = args[0];
    let pageFilter = null;
    let outputDir = OUTPUT_DIR;
    let bannerPrefix = 'banner';
    let dryRun = false;
    let targetCount = 13; // 默认找13张

    for (const arg of args.slice(1)) {
        if (arg.startsWith('--page=')) {
            pageFilter = arg.split('=')[1];
        } else if (arg.startsWith('--output=')) {
            outputDir = arg.split('=')[1];
        } else if (arg.startsWith('--prefix=')) {
            bannerPrefix = arg.split('=')[1].toLowerCase();
        } else if (arg === '--dry-run') {
            dryRun = true;
        } else if (arg.startsWith('--count=')) {
            targetCount = parseInt(arg.split('=')[1]);
        }
    }

    if (!pageFilter) {
        log('❌ 错误: 必须指定页面名称 --page="页面名"', 'red');
        process.exit(1);
    }

    let fileKey;
    try {
        fileKey = extractFileKey(input);
    } catch (error) {
        log(`❌ ${error.message}`, 'red');
        process.exit(1);
    }

    const accessToken = getAccessToken();
    if (!accessToken) {
        log('❌ 请配置 Figma Access Token', 'red');
        process.exit(1);
    }

    try {
        log('\n🚀 开始处理...', 'cyan');
        log(`📁 File Key: ${fileKey}`, 'blue');
        log(`📄 页面: ${pageFilter}`, 'blue');
        log(`🔍 Banner 前缀: ${bannerPrefix}`, 'blue');
        log(`🎯 目标数量: ${targetCount} 张`, 'blue');
        log(`📂 输出目录: ${outputDir}`, 'blue');
        if (dryRun) {
            log(`⚠️  预览模式（不会实际下载）`, 'yellow');
        }

        // 创建输出目录
        if (!dryRun && !fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // 获取文件信息（轻量级）
        log('\n📥 获取页面列表...', 'cyan');
        const fileData = await callFigmaAPI(`/v1/files/${fileKey}?depth=1`, accessToken);

        // 找到目标页面
        const targetPage = fileData.document.children.find(page =>
            page.name.includes(pageFilter)
        );

        if (!targetPage) {
            log(`❌ 未找到页面: ${pageFilter}`, 'red');
            log('可用页面:', 'yellow');
            fileData.document.children.forEach(page => {
                log(`  - ${page.name}`, 'yellow');
            });
            process.exit(1);
        }

        log(`✅ 找到页面: ${targetPage.name}`, 'green');

        // 获取页面详细信息
        log('\n📥 获取页面详细信息...', 'cyan');
        const nodeData = await getNodeDetails(fileKey, [targetPage.id], accessToken);
        const pageNode = nodeData.nodes[targetPage.id];

        if (!pageNode || !pageNode.document) {
            log('❌ 无法获取页面详情', 'red');
            process.exit(1);
        }

        // 查找顶层"活动"开头的 FRAME 节点
        log('\n🔍 查找"活动"相关的 FRAME 节点...', 'cyan');
        const frames = findTopLevelActivityFrames(pageNode.document);
        log(`✅ 找到 ${frames.length} 个"活动"FRAME`, 'green');

        // 获取 FRAME 的详细信息并查找 Banner（找到目标数量就停止）
        log(`\n🔍 查找 Banner（目标: ${targetCount} 张）...`, 'cyan');
        const allBanners = [];
        const bannersByFrame = {};
        const foundNumbers = new Set(); // 记录已找到的编号

        for (let i = 0; i < frames.length; i++) {
            // 如果已经找齐了，就停止
            if (foundNumbers.size >= targetCount) {
                log(`\n✅ 已找到 ${targetCount} 张不同编号的 Banner，停止搜索`, 'green');
                break;
            }

            const frame = frames[i];
            process.stdout.write(`\r处理 ${i + 1}/${frames.length}: ${frame.name.substring(0, 50)}... (已找到 ${foundNumbers.size}/${targetCount})`);

            try {
                const frameData = await getNodeDetails(fileKey, [frame.id], accessToken);
                const frameNode = frameData.nodes[frame.id];

                if (frameNode && frameNode.document) {
                    const banners = findBannerNodes(frameNode.document);
                    const filteredBanners = banners.filter(b =>
                        b.name.toLowerCase().startsWith(bannerPrefix)
                    );

                    if (filteredBanners.length > 0) {
                        bannersByFrame[frame.name] = filteredBanners;
                        allBanners.push(...filteredBanners);
                    }
                }
            } catch (error) {
                // 跳过错误的 FRAME
            }
        }

        console.log(''); // 换行

        if (allBanners.length === 0) {
            log(`\n⚠️  未找到以 "${bannerPrefix}" 开头的 Banner`, 'yellow');
            process.exit(0);
        }

        log(`\n✅ 共找到 ${allBanners.length} 个 Banner`, 'green');

        // 统计找到的编号
        const numbersFound = Array.from(foundNumbers).sort((a, b) => a - b);
        log(`📊 找到的编号: ${numbersFound.join(', ')}`, 'cyan');

        const missingNumbers = [];
        for (let i = 1; i <= targetCount; i++) {
            if (!foundNumbers.has(i)) {
                missingNumbers.push(i);
            }
        }
        if (missingNumbers.length > 0) {
            log(`⚠️  缺失的编号: ${missingNumbers.join(', ')}`, 'yellow');
        }

        // 显示找到的 Banner
        log('\n📋 找到的 Banner:', 'cyan');
        for (const [frameName, banners] of Object.entries(bannersByFrame)) {
            log(`\n  📦 ${frameName}`, 'magenta');
            banners.forEach(banner => {
                const numStr = banner.number !== null ? ` [#${banner.number}]` : '';
                log(`     ├─ ${banner.name}${numStr}`, 'blue');
            });
        }

        if (dryRun) {
            log('\n✅ 预览完成（未下载）', 'green');
            process.exit(0);
        }

        // 去重：按编号分组（每个编号只保留一个）
        log('\n🔄 去重处理（按编号）...', 'cyan');
        const uniqueBanners = new Map();
        allBanners.forEach(banner => {
            if (banner.number !== null) {
                // 如果这个编号还没有，或者当前的名字更短（更可能是主要的）
                if (!uniqueBanners.has(banner.number) ||
                    banner.name.length < uniqueBanners.get(banner.number).name.length) {
                    uniqueBanners.set(banner.number, banner);
                }
            } else {
                // 没有编号的，按名称去重
                if (!uniqueBanners.has(banner.name)) {
                    uniqueBanners.set(banner.name, banner);
                }
            }
        });

        log(`✅ 去重后剩余 ${uniqueBanners.size} 个唯一 Banner`, 'green');

        // 获取图片下载 URL
        log('\n📥 获取图片下载链接...', 'cyan');
        const nodeIds = Array.from(uniqueBanners.values()).map(b => b.id.replace(/-/g, ':'));
        const imageData = await getImageUrls(fileKey, nodeIds, accessToken);

        if (!imageData.images) {
            log('❌ 无法获取图片链接', 'red');
            process.exit(1);
        }

        // 下载图片
        log('\n⬇️  开始下载图片...', 'cyan');
        let downloaded = 0;
        let skipped = 0;

        for (const [key, banner] of uniqueBanners) {
            const nodeId = banner.id.replace(/-/g, ':');
            const imageUrl = imageData.images[nodeId];

            if (!imageUrl) {
                log(`  ⚠️  跳过: ${banner.name} (无下载链接)`, 'yellow');
                skipped++;
                continue;
            }

            // 使用编号作为文件名（如果有的话）
            let filename;
            if (banner.number !== null) {
                filename = `Banner_${String(banner.number).padStart(2, '0')}.png`;
            } else {
                filename = sanitizeFilename(banner.name) + '.png';
            }
            const filepath = path.join(outputDir, filename);

            // 检查文件是否已存在
            if (fs.existsSync(filepath)) {
                log(`  ⏭️  跳过: ${banner.name} (已存在)`, 'yellow');
                skipped++;
                continue;
            }

            try {
                await downloadImage(imageUrl, filepath);
                const numStr = banner.number !== null ? ` [#${banner.number}]` : '';
                log(`  ✅ 下载: ${banner.name}${numStr} -> ${filename}`, 'green');
                downloaded++;
            } catch (error) {
                log(`  ❌ 失败: ${banner.name} - ${error.message}`, 'red');
                skipped++;
            }
        }

        log('\n' + '='.repeat(80), 'cyan');
        log('✅ 完成！', 'green');
        log(`📊 统计:`, 'cyan');
        log(`   - 总共找到: ${allBanners.length} 个 Banner`, 'blue');
        log(`   - 去重后: ${uniqueBanners.size} 个`, 'blue');
        log(`   - 已下载: ${downloaded} 个`, 'green');
        log(`   - 已跳过: ${skipped} 个`, 'yellow');
        log(`📂 保存位置: ${outputDir}`, 'cyan');

    } catch (error) {
        log(`\n❌ 错误: ${error.message}`, 'red');
        if (error.stack) {
            log(`堆栈: ${error.stack}`, 'red');
        }
        process.exit(1);
    }
}

main().catch((error) => {
    log(`❌ 发生错误: ${error.message}`, 'red');
    process.exit(1);
});
