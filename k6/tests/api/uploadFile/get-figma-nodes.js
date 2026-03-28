#!/usr/bin/env node

/**
 * Figma 节点 ID 获取工具
 * 
 * 功能：列出 Figma 文件中所有节点的 ID 和名称，方便配置映射关系
 * 
 * 使用方法：
 *   node get-figma-nodes.js <FILE_KEY>
 *   node get-figma-nodes.js <FILE_KEY> --filter="关键词"
 * 
 * 环境变量：
 *   FIGMA_ACCESS_TOKEN  Figma 访问令牌
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
    // 优先使用环境变量
    if (process.env.FIGMA_ACCESS_TOKEN) {
        return process.env.FIGMA_ACCESS_TOKEN;
    }

    // 尝试从配置文件读取
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
 * 递归遍历节点树
 */
function traverseNodes(node, depth = 0, filter = null, results = []) {
    const indent = '  '.repeat(depth);
    const nodeId = node.id.replace(/:/g, '-'); // 转换为配置文件格式
    const nodeName = node.name || 'Unnamed';
    const nodeType = node.type;

    // 过滤条件
    if (!filter || nodeName.toLowerCase().includes(filter.toLowerCase())) {
        // 只显示可能包含图片的节点类型
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

    // 递归遍历子节点
    if (node.children && node.children.length > 0) {
        for (const child of node.children) {
            traverseNodes(child, depth + 1, filter, results);
        }
    }

    return results;
}

/**
 * 格式化输出节点列表
 */
function formatNodeList(nodes, groupByType = false) {
    if (groupByType) {
        // 按类型分组
        const grouped = {};
        for (const node of nodes) {
            if (!grouped[node.type]) {
                grouped[node.type] = [];
            }
            grouped[node.type].push(node);
        }

        for (const [type, typeNodes] of Object.entries(grouped)) {
            log(`\n📦 ${type} (${typeNodes.length})`, 'cyan');
            for (const node of typeNodes) {
                const indent = '  '.repeat(node.depth);
                log(`${indent}├─ ${node.name}`, 'blue');
                log(`${indent}│  ID: ${node.id}`, 'yellow');
            }
        }
    } else {
        // 树形结构
        for (const node of nodes) {
            const indent = '  '.repeat(node.depth);
            log(`${indent}├─ [${node.type}] ${node.name}`, 'blue');
            log(`${indent}│  ID: ${node.id}`, 'yellow');
        }
    }
}

/**
 * 生成配置文件模板
 */
function generateConfigTemplate(nodes, category = 'newCategory') {
    const template = {};

    nodes.forEach((node, index) => {
        const filename = `${index + 1}.png`;
        template[filename] = node.id;
    });

    const output = {
        [category]: template
    };

    log('\n📝 配置文件模板（可直接复制到 figma-sync-config.json）:', 'green');
    console.log(JSON.stringify(output, null, 2));
}

/**
 * 主函数
 */
async function main() {
    const args = process.argv.slice(2);

    // 显示帮助
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.log(`
Figma 节点 ID 获取工具

使用方法:
  node get-figma-nodes.js <FILE_KEY>                    # 列出所有节点
  node get-figma-nodes.js <FILE_KEY> --filter="banner"  # 过滤节点名称
  node get-figma-nodes.js <FILE_KEY> --group            # 按类型分组
  node get-figma-nodes.js <FILE_KEY> --template         # 生成配置模板

参数:
  FILE_KEY        Figma 文件的 Key（必需）
  --filter=TEXT   过滤节点名称（可选）
  --group         按节点类型分组显示（可选）
  --template      生成配置文件模板（可选）

环境变量:
  FIGMA_ACCESS_TOKEN  Figma 访问令牌

示例:
  # 列出所有节点
  node get-figma-nodes.js abc123xyz

  # 只显示名称包含 "banner" 的节点
  node get-figma-nodes.js abc123xyz --filter="banner"

  # 按类型分组显示
  node get-figma-nodes.js abc123xyz --group

  # 生成配置模板
  node get-figma-nodes.js abc123xyz --filter="signin" --template
    `);
        process.exit(0);
    }

    // 解析参数
    const fileKey = args[0];
    let filter = null;
    let groupByType = false;
    let generateTemplate = false;

    for (const arg of args.slice(1)) {
        if (arg.startsWith('--filter=')) {
            filter = arg.split('=')[1];
        } else if (arg === '--group') {
            groupByType = true;
        } else if (arg === '--template') {
            generateTemplate = true;
        }
    }

    // 获取 Access Token
    const accessToken = getAccessToken();
    if (!accessToken) {
        log('❌ 请配置 Figma Access Token', 'red');
        log('方法1: 设置环境变量 FIGMA_ACCESS_TOKEN', 'yellow');
        log('方法2: 在 figma-sync-config.json 中设置 figmaAccessToken', 'yellow');
        process.exit(1);
    }

    try {
        log(`\n🔍 正在获取 Figma 文件信息...`, 'cyan');
        log(`📁 File Key: ${fileKey}`, 'blue');
        if (filter) {
            log(`🔎 过滤条件: ${filter}`, 'blue');
        }

        // 获取文件信息
        const fileData = await callFigmaAPI(`/v1/files/${fileKey}`, accessToken);

        log(`✅ 文件名称: ${fileData.name}`, 'green');
        log(`📅 最后修改: ${fileData.lastModified}`, 'green');

        // 遍历所有页面
        const allNodes = [];
        for (const page of fileData.document.children) {
            log(`\n📄 页面: ${page.name}`, 'magenta');
            const pageNodes = traverseNodes(page, 0, filter);
            allNodes.push(...pageNodes);
        }

        if (allNodes.length === 0) {
            log('\n⚠️  没有找到匹配的节点', 'yellow');
            process.exit(0);
        }

        log(`\n📊 共找到 ${allNodes.length} 个节点`, 'green');

        // 格式化输出
        formatNodeList(allNodes, groupByType);

        // 生成配置模板
        if (generateTemplate) {
            const category = filter ? filter.toLowerCase().replace(/\s+/g, '') : 'newCategory';
            generateConfigTemplate(allNodes, category);
        }

        log('\n✅ 完成！', 'green');

    } catch (error) {
        log(`\n❌ 错误: ${error.message}`, 'red');
        process.exit(1);
    }
}

// 运行
main().catch((error) => {
    log(`❌ 发生错误: ${error.message}`, 'red');
    process.exit(1);
});
