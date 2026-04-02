#!/usr/bin/env node

/**
 * Figma 图片同步主控系统
 * 
 * 功能：
 * 1. 扫描 img 目录下的所有任务文件夹
 * 2. 清空每个文件夹下的旧图片
 * 3. 根据配置从 Figma 下载新图片
 * 4. 保持原有文件名
 */

const fs = require('fs');
const path = require('path');
const { loadAllTasks, getTask } = require('./tasks');

// 配置
const IMG_DIR = path.join(__dirname, '../img');
const CONFIG_FILE = path.join(__dirname, 'config/global-config.json');

// 颜色输出
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    gray: '\x1b[90m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * 扫描 img 目录，获取所有任务文件夹
 */
function scanTaskFolders() {
    if (!fs.existsSync(IMG_DIR)) {
        throw new Error(`目录不存在: ${IMG_DIR}`);
    }

    const items = fs.readdirSync(IMG_DIR, { withFileTypes: true });
    const folders = items
        .filter(item => item.isDirectory() && !item.name.startsWith('.'))
        .map(item => ({
            name: item.name,
            path: path.join(IMG_DIR, item.name)
        }));

    return folders;
}

/**
 * 获取文件夹中的所有图片文件
 */
function getImagesInFolder(folderPath) {
    if (!fs.existsSync(folderPath)) {
        return [];
    }

    const files = fs.readdirSync(folderPath);
    return files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext);
    });
}

/**
 * 清空文件夹中的所有图片
 */
function clearImagesInFolder(folderPath, dryRun = false) {
    const images = getImagesInFolder(folderPath);

    if (images.length === 0) {
        return { deleted: 0, files: [] };
    }

    const deletedFiles = [];

    for (const image of images) {
        const imagePath = path.join(folderPath, image);
        if (!dryRun) {
            fs.unlinkSync(imagePath);
        }
        deletedFiles.push(image);
    }

    return { deleted: images.length, files: deletedFiles };
}

/**
 * 加载任务配置
 */
function loadTaskConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
        log(`⚠️  配置文件不存在: ${CONFIG_FILE}`, 'yellow');
        log('将创建默认配置文件...', 'yellow');
        return null;
    }

    try {
        const content = fs.readFileSync(CONFIG_FILE, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        throw new Error(`配置文件解析失败: ${error.message}`);
    }
}

/**
 * 创建默认配置文件
 */
function createDefaultConfig(taskFolders) {
    const config = {
        figmaFileKey: "YOUR_FIGMA_FILE_KEY",
        figmaAccessToken: "YOUR_FIGMA_ACCESS_TOKEN",
        tasks: {}
    };

    // 为每个任务文件夹创建配置模板
    taskFolders.forEach(folder => {
        config.tasks[folder.name] = {
            enabled: true,
            description: `${folder.name} 任务`,
            figmaPage: "页面名称",
            searchStrategy: "frame",  // frame | filter | node
            searchConfig: {
                framePrefix: "活动_",
                bannerPrefix: "Banner",
                targetCount: 13
            },
            outputFolder: folder.name,
            fileMapping: {
                // 示例: "Banner_01.png": "1.png"
            }
        };
    });

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return config;
}

/**
 * 执行 Figma 同步任务（预留接口）
 */
async function executeFigmaTask(taskName, taskConfig, globalConfig) {
    log(`\n${'='.repeat(80)}`, 'cyan');
    log(`📋 任务: ${taskName}`, 'magenta');
    log(`📝 描述: ${taskConfig.description}`, 'gray');
    log(`📄 Figma 页面: ${taskConfig.figmaPage}`, 'gray');
    log(`📂 输出目录: img/${taskConfig.outputFolder}`, 'gray');

    // TODO: 这里预留 Figma 下载逻辑
    // 1. 根据 searchStrategy 查找节点
    // 2. 下载图片
    // 3. 根据 fileMapping 重命名

    log(`⏸️  Figma 同步功能待实现`, 'yellow');

    return {
        success: false,
        downloaded: 0,
        skipped: 0,
        errors: []
    };
}

/**
 * 显示任务摘要
 */
function displayTaskSummary(tasks) {
    log('\n📊 任务摘要:', 'cyan');
    log('─'.repeat(80), 'gray');

    tasks.forEach((task, index) => {
        const status = task.enabled ? '✅ 启用' : '⏸️  禁用';
        log(`${index + 1}. ${task.name.padEnd(20)} ${status}  📁 ${task.imageCount} 张图片`, 'blue');
    });

    log('─'.repeat(80), 'gray');
    log(`总计: ${tasks.length} 个任务`, 'cyan');
}

/**
 * 主函数
 */
async function main() {
    const args = process.argv.slice(2);

    // 解析参数
    let dryRun = false;
    let skipClean = false;
    let onlyTask = null;

    for (const arg of args) {
        if (arg === '--dry-run') {
            dryRun = true;
        } else if (arg === '--skip-clean') {
            skipClean = true;
        } else if (arg.startsWith('--task=')) {
            onlyTask = arg.split('=')[1];
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
Figma 图片同步主控系统

使用方法:
  node figma-sync-master.js [选项]

选项:
  --dry-run       预览模式，不实际删除或下载
  --skip-clean    跳过清空图片步骤
  --task=NAME     只处理指定任务
  --help, -h      显示帮助信息

示例:
  # 完整流程（清空 + 下载）
  node figma-sync-master.js

  # 预览模式
  node figma-sync-master.js --dry-run

  # 只处理 systemActive 任务
  node figma-sync-master.js --task=systemActive

  # 跳过清空，只下载
  node figma-sync-master.js --skip-clean
            `);
            process.exit(0);
        }
    }

    try {
        log('\n╔════════════════════════════════════════════════════════════════╗', 'cyan');
        log('║           Figma 图片同步主控系统 v1.0                          ║', 'cyan');
        log('╚════════════════════════════════════════════════════════════════╝', 'cyan');

        if (dryRun) {
            log('\n⚠️  预览模式：不会实际删除或下载文件', 'yellow');
        }

        // 步骤 1: 扫描任务文件夹
        log('\n📁 步骤 1: 扫描任务文件夹...', 'cyan');
        const taskFolders = scanTaskFolders();
        log(`✅ 找到 ${taskFolders.length} 个任务文件夹`, 'green');

        taskFolders.forEach((folder, index) => {
            const imageCount = getImagesInFolder(folder.path).length;
            log(`   ${index + 1}. ${folder.name.padEnd(20)} (${imageCount} 张图片)`, 'blue');
        });

        // 步骤 2: 加载配置
        log('\n⚙️  步骤 2: 加载配置文件...', 'cyan');
        let config = loadTaskConfig();

        if (!config) {
            config = createDefaultConfig(taskFolders);
            log(`✅ 已创建默认配置: ${CONFIG_FILE}`, 'green');
            log(`⚠️  请编辑配置文件后再运行`, 'yellow');
            process.exit(0);
        }

        log(`✅ 配置加载成功`, 'green');
        log(`   Figma File Key: ${config.figmaFileKey}`, 'gray');
        log(`   配置任务数: ${Object.keys(config.tasks).length}`, 'gray');

        // 步骤 3: 清空旧图片
        if (!skipClean) {
            log('\n🗑️  步骤 3: 清空旧图片...', 'cyan');

            let totalDeleted = 0;

            for (const folder of taskFolders) {
                // 如果指定了任务，只处理该任务
                if (onlyTask && folder.name !== onlyTask) {
                    continue;
                }

                const result = clearImagesInFolder(folder.path, dryRun);

                if (result.deleted > 0) {
                    const action = dryRun ? '将删除' : '已删除';
                    log(`   ✅ ${folder.name}: ${action} ${result.deleted} 张图片`, 'green');
                    totalDeleted += result.deleted;
                } else {
                    log(`   ⏭️  ${folder.name}: 无图片`, 'gray');
                }
            }

            if (totalDeleted > 0) {
                const action = dryRun ? '将删除' : '已删除';
                log(`\n✅ 总计${action} ${totalDeleted} 张图片`, 'green');
            } else {
                log(`\n⏭️  所有文件夹都是空的`, 'gray');
            }
        } else {
            log('\n⏭️  步骤 3: 跳过清空图片', 'yellow');
        }

        // 步骤 4: 执行 Figma 同步任务
        log('\n📥 步骤 4: 执行 Figma 同步任务...', 'cyan');

        const tasksToRun = taskFolders.filter(folder => {
            if (onlyTask && folder.name !== onlyTask) {
                return false;
            }

            const taskConfig = config.tasks[folder.name];
            return taskConfig && taskConfig.enabled;
        });

        log(`   将执行 ${tasksToRun.length} 个任务`, 'blue');

        const results = [];

        for (const folder of tasksToRun) {
            const taskConfig = config.tasks[folder.name];

            try {
                const result = await executeFigmaTask(folder.name, taskConfig, config);
                results.push({
                    name: folder.name,
                    ...result
                });
            } catch (error) {
                log(`   ❌ ${folder.name}: ${error.message}`, 'red');
                results.push({
                    name: folder.name,
                    success: false,
                    error: error.message
                });
            }
        }

        // 步骤 5: 显示结果
        log('\n' + '='.repeat(80), 'cyan');
        log('📊 执行结果:', 'cyan');
        log('='.repeat(80), 'cyan');

        let successCount = 0;
        let failCount = 0;

        results.forEach(result => {
            if (result.success) {
                log(`✅ ${result.name}: 下载 ${result.downloaded} 张，跳过 ${result.skipped} 张`, 'green');
                successCount++;
            } else {
                log(`❌ ${result.name}: ${result.error || '失败'}`, 'red');
                failCount++;
            }
        });

        log('\n' + '='.repeat(80), 'cyan');
        log(`✅ 成功: ${successCount} 个任务`, 'green');
        if (failCount > 0) {
            log(`❌ 失败: ${failCount} 个任务`, 'red');
        }
        log('='.repeat(80), 'cyan');

        if (dryRun) {
            log('\n⚠️  这是预览模式，未实际执行操作', 'yellow');
        }

    } catch (error) {
        log(`\n❌ 错误: ${error.message}`, 'red');
        if (error.stack) {
            log(`\n堆栈: ${error.stack}`, 'gray');
        }
        process.exit(1);
    }
}

// 运行
if (require.main === module) {
    main().catch(error => {
        log(`❌ 发生错误: ${error.message}`, 'red');
        process.exit(1);
    });
}

module.exports = {
    scanTaskFolders,
    getImagesInFolder,
    clearImagesInFolder,
    loadTaskConfig,
    createDefaultConfig
};
