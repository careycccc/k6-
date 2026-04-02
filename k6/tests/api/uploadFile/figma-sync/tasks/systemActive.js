/**
 * 系统活动任务
 * 
 * 负责下载系统活动的 Banner 图片（Banner 1-13）
 */

const path = require('path');
const { downloadFromFigma } = require('../core/figma-api');

/**
 * 系统活动任务配置
 */
const config = {
    name: 'systemActive',
    description: '系统活动 Banner 图片',
    enabled: true,

    // Figma 配置
    figma: {
        page: '活动',
        searchStrategy: 'frame',
        searchConfig: {
            framePrefix: '活动_',
            bannerPrefix: 'Banner',
            targetCount: 13
        }
    },

    // 输出配置
    output: {
        folder: 'systemActive',
        fileMapping: {
            'Banner_01.png': '1.png',
            'Banner_02.png': '2.png',
            'Banner_03.png': '3.png',
            'Banner_04.png': '4.png',
            'Banner_05.png': '5.png',
            'Banner_06.png': '6.png',
            'Banner_07.png': '7.png',
            'Banner_08.png': '8.png',
            'Banner_09.png': '9.png',
            'Banner_10.png': '10.png',
            'Banner_11.png': '11.png',
            'Banner_12.png': '12.png',
            'Banner_13.png': '13.png'
        }
    }
};

/**
 * 执行任务
 */
async function execute(globalConfig, options = {}) {
    const { dryRun = false } = options;

    console.log(`\n📋 执行任务: ${config.name}`);
    console.log(`📝 描述: ${config.description}`);

    if (dryRun) {
        console.log('⚠️  预览模式');
        return {
            success: true,
            downloaded: 0,
            skipped: 0,
            message: '预览模式，未实际下载'
        };
    }

    try {
        // 使用批量下载方法（只消耗 2 次 API 请求）
        const result = await downloadFromFigma({
            fileKey: globalConfig.figmaFileKey,
            accessToken: globalConfig.figmaAccessToken,
            outputFolder: path.join(__dirname, '../../img', config.output.folder),
            options: {
                skipHidden: true,
                pageFilter: config.figma.page,  // 只处理指定页面
                nameFilter: config.figma.searchConfig.bannerPrefix  // 只处理 Banner 开头的图层
            },
            fileMapping: config.output.fileMapping,
            format: 'png',
            scale: 2
        });

        return {
            success: result.downloaded > 0,
            downloaded: result.downloaded,
            skipped: result.skipped,
            errors: result.errors,
            apiCalls: result.apiCalls,
            message: `成功下载 ${result.downloaded} 张图片，API 调用 ${result.apiCalls} 次`
        };

    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    config,
    execute
};
