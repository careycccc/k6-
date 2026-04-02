/**
 * 任务索引
 * 
 * 自动加载所有任务模块
 */

const fs = require('fs');
const path = require('path');

/**
 * 加载所有任务
 */
function loadAllTasks() {
    const tasks = {};
    const tasksDir = __dirname;

    const files = fs.readdirSync(tasksDir);

    for (const file of files) {
        // 跳过 index.js 和非 .js 文件
        if (file === 'index.js' || !file.endsWith('.js')) {
            continue;
        }

        const taskName = path.basename(file, '.js');
        const taskModule = require(path.join(tasksDir, file));

        if (taskModule.config && taskModule.execute) {
            tasks[taskName] = taskModule;
        }
    }

    return tasks;
}

/**
 * 获取任务列表
 */
function getTaskList() {
    const tasks = loadAllTasks();
    return Object.keys(tasks).map(name => ({
        name,
        description: tasks[name].config.description,
        enabled: tasks[name].config.enabled
    }));
}

/**
 * 获取单个任务
 */
function getTask(taskName) {
    const tasks = loadAllTasks();
    return tasks[taskName] || null;
}

module.exports = {
    loadAllTasks,
    getTaskList,
    getTask
};
