/**
 * NDJSON(JSON Lines) 本地状态存储 —— Node端(CommonJS)读写工具
 *
 * 背景：k6 沙箱无法写文件，所有"多天数据持久化"只能由 Node.js 包装器
 * (xxxRunner.js) 在 spawn k6 子进程之后完成真正的 fs.writeFileSync。这个
 * 模块把"按 key 覆盖合并 + 整表原子重写"这套逻辑抽成通用工具，供 FB广告
 * 分析(fbAd)和邀请转盘(inviteTurntable)两个 feature 的 Runner 共用，避免
 * 各自重复实现。
 *
 * 文件格式：每行一个 JSON 对象(NDJSON)，不是单个 JSON 数组/对象 —— 不要用
 * JSON.parse(整个文件内容) 读取，必须按行 split 后逐行 parse。
 *
 * k6 侧配套读取方式(模块顶层/init阶段调用，不能在 default() 函数体内)：
 *   const records = open('./state/accounts_3004.ndjson')
 *       .split(/\r?\n/).filter(Boolean).map(JSON.parse);
 *
 * 落盘管道（照抄 inviteWheelRunner.js 的 spawn+正则提取标记行模式）：
 *   k6 脚本把要持久化的完整记录 JSON.stringify 后输出
 *   `console.log('##TAG##' + JSON.stringify(record))`；
 *   Node Runner 用 `/##TAG##(.+)/` 提取 → JSON.parse → upsertRecord → saveStore。
 */

const fs = require('fs');
const path = require('path');

/**
 * 读取 ndjson 文件为 Map，用 keyField 字段的值做 key。
 * 文件不存在时返回空 Map（不是 error）。
 *
 * @param {string} filePath - ndjson 文件绝对/相对路径
 * @param {string} [keyField='account'] - 作为 Map key 的字段名
 * @returns {Map<string, object>}
 */
function loadStore(filePath, keyField = 'account') {
    const store = new Map();
    if (!fs.existsSync(filePath)) return store;

    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    for (const line of lines) {
        try {
            const record = JSON.parse(line);
            const key = record[keyField];
            if (key === undefined || key === null) {
                console.warn(`[ndjsonStore] 跳过缺少 ${keyField} 字段的记录: ${line}`);
                continue;
            }
            store.set(String(key), record);
        } catch (e) {
            console.warn(`[ndjsonStore] 跳过无法解析的行: ${line.slice(0, 100)}... (${e.message})`);
        }
    }
    return store;
}

/**
 * 按 keyField 把 partial 合并进 store 对应记录（浅合并，不是整条替换）。
 * key 不存在时直接新增。
 *
 * @param {Map<string, object>} store
 * @param {object} partial - 必须含 keyField 字段
 * @param {string} [keyField='account']
 * @returns {object} 合并后的完整记录
 */
function upsertRecord(store, partial, keyField = 'account') {
    const key = partial[keyField];
    if (key === undefined || key === null) {
        throw new Error(`[ndjsonStore] upsertRecord: 记录缺少 ${keyField} 字段: ${JSON.stringify(partial)}`);
    }
    const keyStr = String(key);
    const existing = store.get(keyStr) || {};
    const merged = { ...existing, ...partial };
    store.set(keyStr, merged);
    return merged;
}

/**
 * 把 store 整表重写进文件：先写临时文件再 rename 原子覆盖，
 * 避免进程中途崩溃损坏唯一数据源（照抄 pkg/fbad Store.Save 的设计）。
 *
 * @param {string} filePath
 * @param {Map<string, object>} store
 */
function saveStore(filePath, store) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const lines = Array.from(store.values()).map(r => JSON.stringify(r));
    const content = lines.join('\n') + (lines.length ? '\n' : '');

    const tmpPath = `${filePath}.tmp${process.pid}`;
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
}

/**
 * 把一行 k6 输出中可能被 logfmt 转义包装的内容还原成原始文本。
 *
 * ⚠️ k6 默认用 logfmt 格式输出 console.log：整行会被包成
 *   time="..." level=info msg="##TAG##{\"k\":\"v\"}" source=console
 * msg 的值被转义过(" → \"，\ → \\)。若一行含有 msg="..." 结构，认为是这种包装
 * 格式，取出并反转义其内容(复用 JSON 字符串转义语法本身来反转义，而不是手写
 * 转义器)；否则视为裸文本(本地直接 k6 run 不经 logfmt 包装时)，原样返回。
 *
 * 旧版 ##ALL## 标记提取用 `[^\s"]+` 正则没暴露这个问题，是因为提取的是纯手机号
 * (不含引号也不含空格)，截到下一个双引号正好是完整内容，侧面绕开了转义——但这
 * 只对"不含特殊字符的简单标记值"管用，提取 JSON 对象或任意文本都必须先还原。
 *
 * @param {string} line
 * @returns {string} 还原后的原始文本（无 msg="..." 结构时原样返回 line）
 */
function unwrapLogfmtMsg(line) {
    const msgMatch = line.match(/msg="((?:[^"\\]|\\.)*)"/);
    if (!msgMatch) return line;
    try {
        return JSON.parse(`"${msgMatch[1]}"`); // 借用JSON字符串转义规则反转义
    } catch (e) {
        return line;
    }
}

/**
 * 从一行文本中提取 `##TAG##<纯文本>` 标记后的内容，不要求是 JSON（自动处理
 * k6 logfmt 包装转义）。找不到标记返回 null。
 *
 * @param {string} line - 单行文本
 * @param {string} tag - 标记名，不含 ##，如 'R'
 * @returns {string|null}
 */
function extractTaggedLine(line, tag) {
    const marker = `##${tag}##`;
    const text = unwrapLogfmtMsg(line);
    const idx = text.indexOf(marker);
    return idx === -1 ? null : text.slice(idx + marker.length).trim();
}

/**
 * 从一批标记行文本中提取 `##TAG##<json>` 格式的记录，解析失败的行跳过并打印警告。
 * 供 Runner 在 child.stdout/stderr 的 'data' 回调里配合自行实现的逐行缓冲使用。
 *
 * @param {string} line - 单行文本
 * @param {string} tag - 标记名，不含 ##，如 'ACCT'
 * @returns {object|null} 解析成功返回记录对象，否则 null
 */
function extractTaggedRecord(line, tag) {
    const text = extractTaggedLine(line, tag);
    if (text === null) return null;
    try {
        return JSON.parse(text);
    } catch (e) {
        console.warn(`[ndjsonStore] 标记行 JSON 解析失败(tag=${tag}): ${text.slice(0, 200)}... (${e.message})`);
        return null;
    }
}

module.exports = { loadStore, upsertRecord, saveStore, extractTaggedLine, extractTaggedRecord };
