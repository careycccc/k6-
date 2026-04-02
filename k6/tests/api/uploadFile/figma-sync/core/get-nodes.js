#!/usr/bin/env node

/**
 * Figma 节点 ID 获取工具（优化版 - 使用节点 API）
 * 
 * 功能：使用 Figma 节点 API 获取特定页面的节点，避免加载整个文件
 * 
 * 使用方法：
 *   node get-figma-nodes-optimized.js <FIGMA_URL>
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// 配置文件路径
const CONFIG_FILE = path.join(__dirname, 'figma-sync-config.json');

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
        // 忽略错误
    }

    return null;
}

/**
 * 调用 Figma API（轻量级 - 只获取文件元数据）
 */
function callFigmaAPI(endpoint, accessToken, lightweight = false) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.figma.com',
            path: endpoint + (lightweight ? '?depth=1' : ''),
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
 * 获取特定节点的详细信息
 */
function getNodeDetails(fileKey, nodeIds, accessToken) {
    return new Promise((resolve, reject) => {
        const idsParam = nodeIds.join(',');
        const options = {
            hostname: 'api.figma.com',
            path: `/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(idsParam)}`,
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
 * 检查节点名称是否匹配过滤条件
 */
function matchesFilter(nodeName, filter, filterMode) {
    if (!filter) return true;

    const name = nodeName.toLowerCase();
    const filterLower = filter.toLowerCase();

    switch (filterMode) {
        case 'startswith':
            return name.startsWith(filterLower);
        case 'endswith':
            return name.endsWith(filterLower);
        case 'exact':
            return name === filterLower;
        case 'contains':
        default:
            return name.includes(filterLower);
    }
}

/**
 * 递归遍历节点树
 */
function traverseNodes(node, depth = 0, filter = null, filterMode = 'contains', results = [], maxDepth = 5, maxResults = 1000) {
    if (depth > maxDepth || results.length >= maxResults) {
        return results;
    }

    const nodeId = node.id.replace(/:/g, '-');
    const nodeName = node.name || 'Unnamed';
    const nodeType = node.type;

    if (matchesFilter(nodeName, filter, filterMode)) {
        const imageTypes = ['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'RECTANGLE', 'VECTOR', 'IMAGE'];

        if (imageTypes.includes(nodeType)) {
            results.push({
                id: nodeId,
                name: nodeName,
                type: nodeType,
                depth: depth
            });
        }
    }

    if (node.children && node.children.length > 0 && results.length < maxResults) {
        for (const child of node.children) {
            traverseNodes(child, depth + 1, filter, filterMode, results, maxDepth, maxResults);
            if (results.length >= maxResults) break;
        }
    }

    return results;
}

/**
 * 从 Figma URL 提取 File Key
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
Figma 节点 ID 获取工具（优化版）

使用方法:
  node get-figma-nodes-optimized.js <FIGMA_URL_OR_KEY>
  node get-figma-nodes-optimized.js <FIGMA_URL_OR_KEY> --page="页面名"
  node get-figma-nodes-optimized.js <FIGMA_URL_OR_KEY> --filter="关键词"

参数:
  FIGMA_URL_OR_KEY    Figma 文件 URL 或 File Key（必需）
  --page=NAME         只显示指定页面的节点（可选）
  --filter=TEXT       过滤节点名称（可选）
  --filter-mode=MODE  过滤模式（可选）:
                      - contains: 包含关键词（默认）
                      - startswith: 以关键词开头
                      - endswith: 以关键词结尾
                      - exact: 完全匹配
  --limit=N           最多显示N个节点（默认1000）
  --template          生成配置文件模板（可选）
  --depth=N           最大遍历深度（默认5）

说明:
  此版本使用轻量级 API，先获取页面列表，再按需获取节点详情，
  适合处理大型 Figma 文件。

示例:
  # 查看所有页面
  node get-figma-nodes-optimized.js "https://www.figma.com/design/abc123/..."
  
  # 只看"活动"页面
  node get-figma-nodes-optimized.js "https://..." --page="活动"
  
  # 只获取以"活动"开头的节点
  node get-figma-nodes-optimized.js "https://..." --page="活动" --filter="活动" --filter-mode=startswith
  
  # 限制结果数量
  node get-figma-nodes-optimized.js "https://..." --page="活动" --filter="活动" --filter-mode=startswith --limit=20
    `);
        process.exit(0);
    }

    const input = args[0];
    let filter = null;
    let filterMode = 'contains';
    let pageFilter = null;
    let generateTemplate = false;
    let maxDepth = 5;
    let maxResults = 1000;

    for (const arg of args.slice(1)) {
        if (arg.startsWith('--filter=')) {
            filter = arg.split('=')[1];
        } else if (arg.startsWith('--filter-mode=')) {
            filterMode = arg.split('=')[1];
        } else if (arg.startsWith('--page=')) {
            pageFilter = arg.split('=')[1];
        } else if (arg === '--template') {
            generateTemplate = true;
        } else if (arg.startsWith('--depth=')) {
            maxDepth = parseInt(arg.split('=')[1]);
        } else if (arg.startsWith('--limit=')) {
            maxResults = parseInt(arg.split('=')[1]);
        }
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
        log('方法1: 设置环境变量 FIGMA_ACCESS_TOKEN', 'yellow');
        log('方法2: 在 figma-sync-config.json 中设置 figmaAccessToken', 'yellow');
        process.exit(1);
    }

    try {
        log(`\n🔍 正在获取 Figma 文件信息（轻量级模式）...`, 'cyan');
        log(`📁 File Key: ${fileKey}`, 'blue');
        if (filter) {
            log(`🔎 过滤条件: "${filter}" (模式: ${filterMode})`, 'blue');
        }
        if (pageFilter) {
            log(`📄 页面过滤: ${pageFilter}`, 'blue');
        }
        if (maxResults < 1000) {
            log(`📊 结果限制: 最多 ${maxResults} 个节点`, 'blue');
        }

        // 第一步：只获取文件元数据和页面列表（depth=1）
        const fileData = await callFigmaAPI(`/v1/files/${fileKey}`, accessToken, true);

        log(`✅ 文件名称: ${fileData.name}`, 'green');
        log(`📑 页面总数: ${fileData.document.children.length}`, 'green');

        // 显示所有页面
        log('\n📄 可用页面:', 'cyan');
        fileData.document.children.forEach((page, index) => {
            log(`   ${index + 1}. ${page.name} (ID: ${page.id.replace(/:/g, '-')})`, 'blue');
        });

        // 第二步：获取指定页面的详细节点
        const pageResults = [];
        const allNodes = [];

        for (const page of fileData.document.children) {
            if (pageFilter && !page.name.includes(pageFilter)) {
                continue;
            }

            log(`\n🔄 正在获取页面 "${page.name}" 的节点...`, 'cyan');

            // 使用节点 API 获取该页面的详细信息
            const nodeData = await getNodeDetails(fileKey, [page.id], accessToken);
            const pageNode = nodeData.nodes[page.id];

            if (pageNode && pageNode.document) {
                const pageNodes = traverseNodes(pageNode.document, 0, filter, filterMode, [], maxDepth, maxResults);

                if (pageNodes.length > 0) {
                    pageResults.push({
                        pageName: page.name,
                        pageId: page.id.replace(/:/g, '-'),
                        nodes: pageNodes
                    });
                    allNodes.push(...pageNodes);
                }

                log(`   ✅ 找到 ${pageNodes.length} 个节点`, 'green');
            }
        }

        if (allNodes.length === 0) {
            log('\n⚠️  没有找到匹配的节点', 'yellow');
            process.exit(0);
        }

        log(`\n📊 共找到 ${allNodes.length} 个节点，分布在 ${pageResults.length} 个页面`, 'green');

        // 显示结果
        log('\n' + '='.repeat(80), 'cyan');
        for (const pageResult of pageResults) {
            log(`\n📄 页面: ${pageResult.pageName}`, 'magenta');
            log(`   Page ID: ${pageResult.pageId}`, 'yellow');
            log(`   节点数: ${pageResult.nodes.length}`, 'cyan');
            log('   ' + '-'.repeat(76), 'cyan');

            for (const node of pageResult.nodes) {
                const indent = '   ' + '  '.repeat(node.depth);
                log(`${indent}├─ [${node.type}] ${node.name}`, 'blue');
                log(`${indent}│  ID: ${node.id}`, 'yellow');
            }
        }

        // 生成配置模板
        if (generateTemplate) {
            log('\n' + '='.repeat(80), 'cyan');
            log('\n📝 配置文件模板:', 'green');

            const configTemplate = {
                figmaFileKey: fileKey,
                figmaAccessToken: "YOUR_FIGMA_ACCESS_TOKEN_HERE",
                categories: {}
            };

            for (const pageResult of pageResults) {
                const categoryName = pageResult.pageName
                    .toLowerCase()
                    .replace(/[_\s]+/g, '')
                    .replace(/[^a-z0-9]/g, '');

                const nodeMapping = {};
                pageResult.nodes.forEach((node, index) => {
                    const filename = `${index + 1}.png`;
                    nodeMapping[filename] = node.id;
                });

                configTemplate.categories[categoryName] = nodeMapping;
            }

            console.log(JSON.stringify(configTemplate, null, 2));
        }

        log('\n' + '='.repeat(80), 'cyan');
        log('✅ 完成！', 'green');

    } catch (error) {
        log(`\n❌ 错误: ${error.message}`, 'red');
        if (error.stack) {
            log(`\n堆栈: ${error.stack}`, 'red');
        }
        process.exit(1);
    }
}

main().catch((error) => {
    log(`❌ 发生错误: ${error.message}`, 'red');
    process.exit(1);
});
