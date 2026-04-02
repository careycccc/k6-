#!/usr/bin/env node

/**
 * 系统活动任务测试脚本
 * 
 * 用于测试和预览系统活动任务的执行情况
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// 配置文件路径
const CONFIG_FILE = path.join(__dirname, '../config/global-config.json');

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
 * 获取配置
 */
function getConfig() {
    let config = {
        figmaFileKey: null,
        figmaAccessToken: null
    };

    // 尝试从配置文件读取
    if (fs.existsSync(CONFIG_FILE)) {
        const content = fs.readFileSync(CONFIG_FILE, 'utf8');
        config = JSON.parse(content);
    }

    // 环境变量优先
    if (process.env.FIGMA_FILE_KEY) {
        config.figmaFileKey = process.env.FIGMA_FILE_KEY;
    }
    if (process.env.FIGMA_ACCESS_TOKEN) {
        config.figmaAccessToken = process.env.FIGMA_ACCESS_TOKEN;
    }

    // 验证配置
    if (!config.figmaFileKey || config.figmaFileKey === 'YOUR_FIGMA_FILE_KEY') {
        throw new Error('请配置 Figma File Key\n  方式1: 编辑 figma-sync/config/global-config.json\n  方式2: 设置环境变量 FIGMA_FILE_KEY');
    }
    if (!config.figmaAccessToken || config.figmaAccessToken === 'YOUR_FIGMA_ACCESS_TOKEN_HERE') {
        throw new Error('请配置 Figma Access Token\n  方式1: 编辑 figma-sync/config/global-config.json\n  方式2: 设置环境变量 FIGMA_ACCESS_TOKEN');
    }

    return config;
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
                } else if (res.statusCode === 429) {
                    const retryAfter = res.headers['retry-after'] || '未知';
                    const resetTime = res.headers['x-ratelimit-reset'];
                    let message = 'API 请求频率限制';

                    if (retryAfter !== '未知') {
                        message += `，请等待 ${retryAfter} 秒后重试`;
                    } else if (resetTime) {
                        const resetDate = new Date(parseInt(resetTime) * 1000);
                        message += `，限制将在 ${resetDate.toLocaleTimeString()} 解除`;
                    } else {
                        message += `，请等待 10-15 分钟后重试`;
                    }

                    reject(new Error(message));
                } else {
                    const buffer = Buffer.concat(chunks);
                    reject(new Error(`API 请求失败: ${res.statusCode} - ${buffer.toString('utf8')}`));
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
 * 查找顶层"活动"开头的 FRAME
 */
function findActivityFrames(node, frames = [], depth = 0) {
    if (depth > 2) return frames;

    if (node.type === 'FRAME' && node.name.startsWith('活动')) {
        frames.push({
            id: node.id,
            name: node.name
        });
    }

    if (node.children && node.children.length > 0 && depth < 2) {
        for (const child of node.children) {
            findActivityFrames(child, frames, depth + 1);
        }
    }

    return frames;
}

/**
 * 提取 Banner 编号
 */
function extractBannerNumber(name) {
    const match = name.match(/Banner\s+(\d+)/i);
    return match ? parseInt(match[1]) : null;
}

/**
 * 查找 English 节点
 */
function findEnglishNode(node, depth = 0, maxDepth = 5) {
    if (depth > maxDepth) return null;

    // 检查当前节点是否是 English
    if (node.name && node.name.toLowerCase() === 'english') {
        return node;
    }

    // 递归查找子节点
    if (node.children && node.children.length > 0) {
        for (const child of node.children) {
            const found = findEnglishNode(child, depth + 1, maxDepth);
            if (found) return found;
        }
    }

    return null;
}

/**
 * 查找 Banner 节点
 */
function findBannerNodes(node, banners = [], depth = 0, maxDepth = 10) {
    if (depth > maxDepth) return banners;

    const nodeName = node.name || '';

    if (nodeName.toLowerCase().startsWith('banner')) {
        const bannerNum = extractBannerNumber(nodeName);
        banners.push({
            id: node.id.replace(/:/g, '-'),
            name: nodeName,
            type: node.type,
            number: bannerNum
        });
    }

    if (node.children && node.children.length > 0) {
        for (const child of node.children) {
            findBannerNodes(child, banners, depth + 1, maxDepth);
        }
    }

    return banners;
}

/**
 * 主测试函数
 */
async function main() {
    try {
        log('\n╔════════════════════════════════════════════════════════════════╗', 'cyan');
        log('║           系统活动任务测试 - 预览模式                          ║', 'cyan');
        log('╚════════════════════════════════════════════════════════════════╝', 'cyan');

        // 加载配置
        log('\n⚙️  步骤 1: 加载配置...', 'cyan');
        const config = getConfig();
        log(`✅ Figma File Key: ${config.figmaFileKey}`, 'green');
        log(`✅ Access Token: ${config.figmaAccessToken.substring(0, 10)}...`, 'green');

        // 获取文件信息
        log('\n📥 步骤 2: 获取 Figma 文件信息...', 'cyan');
        const fileData = await callFigmaAPI(`/v1/files/${config.figmaFileKey}?depth=1`, config.figmaAccessToken);
        log(`✅ 文件名称: ${fileData.name}`, 'green');
        log(`📑 页面总数: ${fileData.document.children.length}`, 'blue');

        // 显示所有页面
        log('\n📄 可用页面:', 'cyan');
        fileData.document.children.forEach((page, index) => {
            log(`   ${index + 1}. ${page.name}`, 'blue');
        });

        // 查找"活动"页面
        log('\n🔍 步骤 3: 查找"活动"页面...', 'cyan');
        const activityPage = fileData.document.children.find(page =>
            page.name.includes('活动')
        );

        if (!activityPage) {
            log('❌ 未找到"活动"页面', 'red');
            process.exit(1);
        }

        log(`✅ 找到页面: ${activityPage.name}`, 'green');

        // 获取页面详情
        log('\n📥 步骤 4: 获取页面详细信息...', 'cyan');
        const nodeData = await getNodeDetails(config.figmaFileKey, [activityPage.id], config.figmaAccessToken);
        const pageNode = nodeData.nodes[activityPage.id];

        if (!pageNode || !pageNode.document) {
            log('❌ 无法获取页面详情', 'red');
            process.exit(1);
        }

        // 查找"活动_"开头的 FRAME
        log('\n🔍 步骤 5: 查找"活动_"开头的 FRAME...', 'cyan');
        const frames = findActivityFrames(pageNode.document);
        log(`✅ 找到 ${frames.length} 个"活动_"FRAME`, 'green');

        if (frames.length > 0) {
            log('\n📋 FRAME 列表（前 10 个）:', 'blue');
            frames.slice(0, 10).forEach((frame, index) => {
                log(`   ${index + 1}. ${frame.name}`, 'gray');
            });
            if (frames.length > 10) {
                log(`   ... 还有 ${frames.length - 10} 个`, 'gray');
            }
        }

        // 查找 Banner
        log('\n🔍 步骤 6: 在 FRAME 中查找 Banner（目标: 13 张）...', 'cyan');
        const allBanners = [];
        const bannersByFrame = {};
        const foundNumbers = new Set();
        const targetCount = 13;

        for (let i = 0; i < frames.length; i++) {
            if (foundNumbers.size >= targetCount) {
                log(`\n✅ 已找到 ${targetCount} 张不同编号的 Banner，停止搜索`, 'green');
                break;
            }

            const frame = frames[i];
            process.stdout.write(`\r   处理 ${i + 1}/${frames.length}: ${frame.name.substring(0, 50).padEnd(50)} (已找到 ${foundNumbers.size}/${targetCount})`);

            try {
                const frameData = await getNodeDetails(config.figmaFileKey, [frame.id], config.figmaAccessToken);
                const frameNode = frameData.nodes[frame.id];

                if (frameNode && frameNode.document) {
                    const banners = findBannerNodes(frameNode.document);
                    const filteredBanners = banners.filter(b =>
                        b.name.toLowerCase().startsWith('banner')
                    );

                    if (filteredBanners.length > 0) {
                        filteredBanners.forEach(b => {
                            if (b.number !== null && b.number >= 1 && b.number <= targetCount) {
                                foundNumbers.add(b.number);
                            }
                        });

                        bannersByFrame[frame.name] = filteredBanners;
                        allBanners.push(...filteredBanners);
                    }
                }

                // 添加延迟避免 API 限流
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                // 跳过错误的 FRAME
            }
        }

        console.log(''); // 换行

        // 如果没找到足够的 Banner，尝试从首页的 English 层级查找
        if (foundNumbers.size < targetCount) {
            log(`\n⚠️  在"活动"页面只找到 ${foundNumbers.size} 个 Banner，尝试从"首页_home/English"查找...`, 'yellow');

            // 查找首页
            const homePage = fileData.document.children.find(page =>
                page.name.includes('首页') || page.name.toLowerCase().includes('home')
            );

            if (homePage) {
                log(`✅ 找到页面: ${homePage.name}`, 'green');

                // 获取首页详情
                const homeNodeData = await getNodeDetails(config.figmaFileKey, [homePage.id], config.figmaAccessToken);
                const homePageNode = homeNodeData.nodes[homePage.id];

                if (homePageNode && homePageNode.document) {
                    // 查找 English 层级
                    const englishNode = findEnglishNode(homePageNode.document);

                    if (englishNode) {
                        log(`✅ 找到 English 层级`, 'green');

                        // 在 English 下查找 Banner
                        const englishBanners = findBannerNodes(englishNode);
                        const filteredEnglishBanners = englishBanners.filter(b =>
                            b.name.toLowerCase().startsWith('banner')
                        );

                        log(`   找到 ${filteredEnglishBanners.length} 个 Banner`, 'blue');

                        if (filteredEnglishBanners.length > 0) {
                            filteredEnglishBanners.forEach(b => {
                                if (b.number !== null && b.number >= 1 && b.number <= targetCount) {
                                    if (!foundNumbers.has(b.number)) {
                                        foundNumbers.add(b.number);
                                    }
                                }
                            });

                            bannersByFrame['首页_home/English'] = filteredEnglishBanners;
                            allBanners.push(...filteredEnglishBanners);
                        }
                    } else {
                        log(`⚠️  未找到 English 层级`, 'yellow');
                    }
                }
            } else {
                log(`⚠️  未找到首页`, 'yellow');
            }
        }

        // 显示结果
        log('\n' + '='.repeat(80), 'cyan');
        log('📊 查找结果:', 'cyan');
        log('='.repeat(80), 'cyan');

        if (allBanners.length === 0) {
            log('\n⚠️  未找到任何 Banner', 'yellow');
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

        // 按 FRAME 显示
        log('\n📋 按 FRAME 分类:', 'cyan');
        for (const [frameName, banners] of Object.entries(bannersByFrame)) {
            log(`\n  📦 ${frameName}`, 'magenta');
            banners.forEach(banner => {
                const numStr = banner.number !== null ? ` [#${banner.number}]` : '';
                log(`     ├─ ${banner.name}${numStr}`, 'blue');
                log(`     │  ID: ${banner.id}`, 'gray');
            });
        }

        // 去重后的结果
        log('\n📋 去重后的 Banner（每个编号只保留一个）:', 'cyan');
        const uniqueBanners = new Map();
        allBanners.forEach(banner => {
            if (banner.number !== null) {
                if (!uniqueBanners.has(banner.number) ||
                    banner.name.length < uniqueBanners.get(banner.number).name.length) {
                    uniqueBanners.set(banner.number, banner);
                }
            }
        });

        const sortedBanners = Array.from(uniqueBanners.entries()).sort((a, b) => a[0] - b[0]);
        sortedBanners.forEach(([num, banner]) => {
            log(`   ${num}. ${banner.name}`, 'blue');
            log(`      ID: ${banner.id}`, 'gray');
            log(`      将保存为: ${num}.png`, 'green');
        });

        // 文件映射预览
        log('\n📋 文件名映射预览:', 'cyan');
        log('   下载后的文件名 → 最终文件名', 'gray');
        sortedBanners.forEach(([num, banner]) => {
            const downloadName = `Banner_${String(num).padStart(2, '0')}.png`;
            const finalName = `${num}.png`;
            log(`   ${downloadName} → ${finalName}`, 'blue');
        });

        // 总结
        log('\n' + '='.repeat(80), 'cyan');
        log('✅ 测试完成！', 'green');
        log('\n📊 统计:', 'cyan');
        log(`   - 扫描的 FRAME: ${frames.length} 个`, 'blue');
        log(`   - 找到的 Banner: ${allBanners.length} 个`, 'blue');
        log(`   - 去重后: ${uniqueBanners.size} 个`, 'blue');
        log(`   - 目标数量: ${targetCount} 个`, 'blue');
        log(`   - 完成度: ${Math.round(uniqueBanners.size / targetCount * 100)}%`, uniqueBanners.size >= targetCount ? 'green' : 'yellow');

        if (uniqueBanners.size >= targetCount) {
            log('\n✅ 所有 Banner 都已找到，可以开始下载！', 'green');
        } else {
            log(`\n⚠️  还缺少 ${targetCount - uniqueBanners.size} 个 Banner`, 'yellow');
        }

        log('\n💡 下一步:', 'cyan');
        log('   1. 确认上述 Banner 列表正确', 'yellow');
        log('   2. 运行实际下载: ./sync-all.sh --task=systemActive', 'yellow');
        log('='.repeat(80), 'cyan');

    } catch (error) {
        log(`\n❌ 错误: ${error.message}`, 'red');
        if (error.stack) {
            log(`\n堆栈: ${error.stack}`, 'gray');
        }
        process.exit(1);
    }
}

// 运行
main().catch(error => {
    log(`❌ 发生错误: ${error.message}`, 'red');
    process.exit(1);
});
