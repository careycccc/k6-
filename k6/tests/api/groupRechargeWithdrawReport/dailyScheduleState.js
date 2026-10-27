/**
 * 多天衰减系列 —— 全局天数状态读写(Node/CommonJS，配合 dailyRunner.js 使用)
 *
 * "第几天"是跨3个商户统一的概念(不按商户分)，所以用一个全局单例状态文件，
 * 不是像 state/accounts_<tenantId>.ndjson 那样按商户拆分。
 *
 * 裸手写 fs 读写 + 临时文件rename原子替换，照抄 ndjsonStore.js 的 saveStore
 * 同款写法，防止写入中途被打断(比如Ctrl+C)导致状态文件损坏成半截JSON。
 */
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'state', 'dailySchedule.json');

/**
 * 读取天数状态。文件不存在时返回初始状态(lastCompletedDay:0)，不报错——
 * 这样第一次跑 dailyRunner.js 不需要手动初始化任何文件。
 * @returns {{lastCompletedDay:number, days:object}}
 */
function loadState() {
    if (!fs.existsSync(STATE_FILE)) return { lastCompletedDay: 0, days: {} };
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    } catch (e) {
        console.error(`[DailyScheduleState] 状态文件解析失败(${e.message})，当作初始状态处理——如果这是意外，先检查 ${STATE_FILE} 是否损坏`);
        return { lastCompletedDay: 0, days: {} };
    }
}

/** 原子写回状态文件：先写临时文件再rename，避免写入中途崩溃损坏数据 */
function saveState(state) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.tmp${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmp, STATE_FILE);
}

module.exports = { loadState, saveState, STATE_FILE };
