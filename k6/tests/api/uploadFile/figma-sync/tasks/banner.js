/**
 * 首页 Banner 任务
 */

const config = {
    name: 'banner',
    description: '首页 Banner 图片',
    enabled: true,

    figma: {
        page: '首页_home',
        searchStrategy: 'filter',
        searchConfig: {
            filterPrefix: 'banner',
            filterMode: 'startswith'
        }
    },

    output: {
        folder: 'banner',
        fileMapping: {}  // 保持原名
    }
};

async function execute(globalConfig, options = {}) {
    console.log(`\n📋 执行任务: ${config.name}`);

    // TODO: 实现下载逻辑

    return {
        success: false,
        message: '待实现'
    };
}

module.exports = { config, execute };
