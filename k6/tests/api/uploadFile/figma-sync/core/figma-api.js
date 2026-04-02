/**
 * Figma API 核心模块
 * 
 * 核心优化：批量获取图片链接，只消耗 1 次 API 请求
 * 
 * API 请求次数统计：
 * - 获取文件结构: 1 次
 * - 批量获取所有图片链接: 1 次
 * - 下载图片: 不计入 Figma API 限制（直接从 CDN 下载）
 * 
 * 总计：2 次 Figma API 请求（无论多少张图片）
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

/**
 * 创建 Figma API 客户端
 */
function createFigmaClient(accessToken) {
    return axios.create({
        baseURL: 'https://api.figma.com/v1',
        headers: {
            'X-Figma-Token': accessToken
        },
        timeout: 30000
    });
}

/**
 * 递归查找所有设置了导出的节点
 * 
 * @param {Object} node - Figma 节点
 * @param {String} pageName - 页面名称
 * @param {Array} result - 结果数组
 * @param {Object} options - 过滤选项
 */
function findExportableNodes(node, pageName, result = [], options = {}) {
    const {
        skipHidden = true,           // 跳过隐藏图层
        pageFilter = null,           // 页面名称过滤（正则或字符串）
        nameFilter = null,           // 图层名称过滤（正则或字符串）
        typeFilter = null            // 节点类型过滤（数组）
    } = options;

    // 跳过隐藏图层
    if (skipHidden && node.visible === false) {
        return result;
    }

    // 页面过滤
    if (pageFilter) {
        const regex = typeof pageFilter === 'string'
            ? new RegExp(pageFilter)
            : pageFilter;
        if (!regex.test(pageName)) {
            return result;
        }
    }

    // 检查是否设置了导出
    if (node.exportSettings && node.exportSettings.length > 0) {
        // 名称过滤
        if (nameFilter) {
            const regex = typeof nameFilter === 'string'
                ? new RegExp(nameFilter)
                : nameFilter;
            if (!regex.test(node.name)) {
                // 继续递归子节点
                if (node.children) {
                    node.children.forEach(child =>
                        findExportableNodes(child, pageName, result, options)
                    );
                }
                return result;
            }
        }

        // 类型过滤
        if (typeFilter && !typeFilter.includes(node.type)) {
            // 继续递归子节点
            if (node.children) {
                node.children.forEach(child =>
                    findExportableNodes(child, pageName, result, options)
                );
            }
            return result;
        }

        // 收集节点信息
        result.push({
            id: node.id,
            name: node.name,
            page: pageName,
            type: node.type,
            visible: node.visible !== false
        });
    }

    // 递归处理子节点
    if (node.children) {
        node.children.forEach(child =>
            findExportableNodes(child, pageName, result, options)
        );
    }

    return result;
}

/**
 * 批量下载 Figma 图片（核心优化方法）
 * 
 * @param {Object} params
 * @param {String} params.fileKey - Figma 文件 Key
 * @param {String} params.accessToken - Figma Access Token
 * @param {String} params.outputFolder - 输出文件夹路径
 * @param {Object} params.options - 查找选项
 * @param {Object} params.fileMapping - 文件名映射 { 'Figma名称.png': '目标名称.png' }
 * @param {String} params.format - 图片格式 (png, jpg, svg, pdf)
 * @param {Number} params.scale - 缩放比例 (1, 2, 3, 4)
 */
async function downloadFromFigma({
    fileKey,
    accessToken,
    outputFolder,
    options = {},
    fileMapping = {},
    format = 'png',
    scale = 2
}) {
    const client = createFigmaClient(accessToken);
    const stats = {
        apiCalls: 0,
        downloaded: 0,
        skipped: 0,
        errors: []
    };

    try {
        // ========== 第 1 次 API 请求：获取文件结构 ==========
        console.log('🔍 [1/3] 正在获取 Figma 文件结构...');
        const { data: fileData } = await client.get(`/files/${fileKey}`);
        stats.apiCalls++;
        console.log(`✅ 文件结构获取成功 (API 调用: ${stats.apiCalls})`);

        // 递归查找所有需要导出的节点
        const nodesToExport = [];
        fileData.document.children.forEach(page => {
            console.log(`   📄 扫描页面: ${page.name}`);
            findExportableNodes(page, page.name, nodesToExport, options);
        });

        if (nodesToExport.length === 0) {
            console.log('⚠️  未找到任何设置了导出的图层');
            return stats;
        }

        console.log(`✅ 找到 ${nodesToExport.length} 个需要导出的图层`);

        // ========== 第 2 次 API 请求：批量获取所有图片链接 ==========
        console.log('\n🔗 [2/3] 批量获取图片下载链接...');

        // 【核心优化】：把所有 ID 拼成一串，只发送 1 次请求
        const allIds = nodesToExport.map(n => n.id).join(',');

        const { data: imagesData } = await client.get(`/images/${fileKey}`, {
            params: {
                ids: allIds,
                format: format,
                scale: scale
            }
        });
        stats.apiCalls++;

        console.log(`✅ 批量获取成功 (API 调用: ${stats.apiCalls})`);
        console.log(`   📊 获取了 ${Object.keys(imagesData.images).length} 个图片链接`);

        // ========== 第 3 步：从 CDN 下载图片（不消耗 Figma API 配额）==========
        console.log('\n📥 [3/3] 开始下载图片...');

        // 确保输出目录存在
        await fs.ensureDir(outputFolder);

        for (const node of nodesToExport) {
            const downloadUrl = imagesData.images[node.id];

            if (!downloadUrl) {
                console.log(`   ⚠️  ${node.name}: 未获取到下载链接`);
                stats.skipped++;
                continue;
            }

            try {
                // 确定目标文件名
                const figmaFileName = `${node.name}.${format}`;
                const targetFileName = fileMapping[figmaFileName] || figmaFileName;
                const targetPath = path.join(outputFolder, targetFileName);

                // 下载图片（直接从 Figma CDN 下载，不消耗 API 配额）
                const response = await axios({
                    url: downloadUrl,
                    method: 'GET',
                    responseType: 'stream',
                    timeout: 60000
                });

                // 写入文件
                const writer = fs.createWriteStream(targetPath);
                response.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });

                console.log(`   ✅ ${node.name} → ${targetFileName}`);
                stats.downloaded++;

            } catch (error) {
                console.log(`   ❌ ${node.name}: ${error.message}`);
                stats.errors.push({
                    node: node.name,
                    error: error.message
                });
            }
        }

        // 显示统计信息
        console.log('\n' + '='.repeat(60));
        console.log('📊 下载统计:');
        console.log(`   🎯 Figma API 调用次数: ${stats.apiCalls} 次`);
        console.log(`   ✅ 成功下载: ${stats.downloaded} 张`);
        console.log(`   ⏭️  跳过: ${stats.skipped} 张`);
        console.log(`   ❌ 失败: ${stats.errors.length} 张`);
        console.log('='.repeat(60));

        return stats;

    } catch (error) {
        console.error('❌ 下载失败:', error.message);
        if (error.response) {
            console.error('   API 响应:', error.response.data);
        }
        throw error;
    }
}

/**
 * 获取 Figma 文件信息（用于调试）
 */
async function getFigmaFileInfo(fileKey, accessToken) {
    const client = createFigmaClient(accessToken);

    try {
        const { data } = await client.get(`/files/${fileKey}`);

        const info = {
            name: data.name,
            lastModified: data.lastModified,
            version: data.version,
            pages: data.document.children.map(page => ({
                name: page.name,
                id: page.id,
                type: page.type
            }))
        };

        return info;
    } catch (error) {
        throw new Error(`获取文件信息失败: ${error.message}`);
    }
}

module.exports = {
    createFigmaClient,
    findExportableNodes,
    downloadFromFigma,
    getFigmaFileInfo
};
