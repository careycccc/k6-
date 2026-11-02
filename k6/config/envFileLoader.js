// ============================================================
// envFileLoader.js —— k6 runtime 专用，读取并解析项目根目录的 .env 文件
//
// k6 脚本跑在 k6 自己的 JS 沙盒里，不是 Node.js，不能用 fs/dotenv 这类
// Node 模块。k6 自带的 open() 可以在模块顶层（init 阶段）同步读文件，
// 且按"调用 open() 的文件自身所在目录"解析相对路径（不受谁 import 它、
// 在哪个目录下运行 k6 影响）——已用一次性测试脚本在真实 k6 runtime 里
// 验证过这个行为。本文件在 k6/config/ 下，所以 '../../.env' 就是项目
// 根目录的 .env。
//
// envconfig.js / groupAdminConfig.js 都从这里取值，不再把真实账号密码、
// GOOGLE_SECRET 等敏感信息写死在源码里。
// ============================================================

function parseEnvContent(content) {
    const result = {};
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx < 0) continue;
        const key = trimmed.slice(0, idx).trim();
        let value = trimmed.slice(idx + 1).trim();
        if (value.length >= 2) {
            const first = value[0];
            const last = value[value.length - 1];
            if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
                value = value.slice(1, -1);
            }
        }
        result[key] = value;
    }
    return result;
}

let envContent;
try {
    envContent = open('../../.env');
} catch (e) {
    throw new Error(
        '[envFileLoader] 找不到项目根目录的 .env 文件。请复制 .env.example 为 .env 并填入真实配置值后重试。原始错误: ' + e.message
    );
}

// 解析结果：扁平的 { 'ENV_3001_BASE_ADMIN_URL': 'https://...', ... } 这种 map
export const ENV_FILE_MAP = parseEnvContent(envContent);

/**
 * 取字符串值，找不到或为空时返回 defaultValue
 */
export function getEnvValue(key, defaultValue = '') {
    const v = ENV_FILE_MAP[key];
    return v === undefined || v === '' ? defaultValue : v;
}

/**
 * 取整数值，找不到/为空/解析失败时返回 defaultValue
 */
export function getEnvInt(key, defaultValue = 0) {
    const v = ENV_FILE_MAP[key];
    if (v === undefined || v === '') return defaultValue;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? defaultValue : n;
}
