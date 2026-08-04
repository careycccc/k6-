import { sleep } from 'k6';
import exec from 'k6/execution';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { phoneRegister, phoneRegisterByInvite, getLastRegisterError, isRateLimitError } from '../../login/register.test.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { generateRandomPhone } from '../../../utils/accountGenerator.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';

// Options
export const options = {
    scenarios: {
        build_forest: {
            executor: 'per-vu-iterations',
            vus: parseInt(__ENV.VUS || '10', 10),
            iterations: 1,
            maxDuration: '8h',
        },
    },
};

// Utils
function extractToken(response) {
    if (!response) return null;
    if (response.data && response.data.token) return response.data.token;
    if (response.headers) {
        const auth = response.headers['Authorization'] || response.headers['authorization'];
        if (auth) return auth.replace(/^Bearer\s+/i, '').trim();
    }
    return null;
}

function distributePeople(totalPeople, levels) {
    if (levels <= 0 || totalPeople <= 0) return [];
    if (levels === 1) return [totalPeople];
    if (levels >= totalPeople) return Array.from({ length: levels }, (_, i) => (i < totalPeople ? 1 : 0));

    const weights = [];
    for (let i = 0; i < levels; i++) {
        weights.push(((levels - i) / levels) * (0.5 + Math.random()));
    }
    weights.sort((a, b) => b - a);
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const result = weights.map(w => Math.max(1, Math.floor((w / totalWeight) * totalPeople)));
    
    let diff = totalPeople - result.reduce((s, n) => s + n, 0);
    while (diff > 0) { for (let i = 0; i < levels && diff > 0; i++) { result[i]++; diff--; } }
    while (diff < 0) { for (let i = levels - 1; i >= 0 && diff < 0; i--) { if (result[i] > 1) { result[i]--; diff++; } } }
    result.sort((a, b) => b - a);
    return result;
}

function randomPick(pool) {
    if (!pool || pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

// 注册/取邀请码的重试上限（可用 -e 覆盖）
const MAX_REG_ATTEMPTS = parseInt(__ENV.MAX_REG_ATTEMPTS || '8', 10);
const MAX_INFO_ATTEMPTS = parseInt(__ENV.MAX_INFO_ATTEMPTS || '4', 10);

/**
 * 判断注册错误是否「瞬时、值得退避重试」：
 *   - 网络无响应 / 响应解析失败（transient）
 *   - 限流 msgCode=13 "Too frequent access"（等窗口过去就能成）
 * 其它一律视为永久性业务错误（如 5023 渠道不存在），重试无意义 → 应快速失败。
 */
function isTransientRegisterError(err) {
    return !err || err.type === 'network' || err.type === 'parse' || isRateLimitError(err);
}

/**
 * 注册单个下级：仅对限流/瞬时错误退避重试；命中永久性业务错误立即快速失败。
 * 每次重试换新手机号，避免偶发号码冲突。
 * @returns {{token: string}|{token: null, fatal: boolean, err: object|null}}
 *   成功 → { token }；永久错误 → { token:null, fatal:true, err }；重试耗尽 → { token:null, fatal:false, err }
 */
function registerOneWithRetry(parentCode, adminData, envConfig, customUrls) {
    for (let attempt = 1; attempt <= MAX_REG_ATTEMPTS; attempt++) {
        const phone = generateRandomPhone(envConfig.COUNTRY_CODE || '91');
        const res = phoneRegisterByInvite(phone, parentCode, adminData, 'qwer1234', '', customUrls);
        const token = extractToken(res);
        if (res && res.data && token) return { token };

        // 失败分类：只有限流/瞬时错误才退避重试；其它业务错误(如 5023 渠道不存在)是永久性的，
        // 立即快速失败，避免把「秒失败」拖成 8 次指数退避(每人~35s)的静默空转。
        const err = getLastRegisterError();
        if (!isTransientRegisterError(err)) {
            console.error(`[FAST_FAIL] 命中永久性业务错误，停止重试: code=${err.code} msgCode=${err.msgCode} msg="${err.msg}"`);
            return { token: null, fatal: true, err };
        }
        // 限流/瞬时 → 指数退避 + 抖动，给限流窗口让路
        const backoff = Math.min(0.8 * Math.pow(1.7, attempt - 1), 10) + Math.random() * 0.6;
        sleep(backoff);
    }
    return { token: null, fatal: false, err: getLastRegisterError() };
}

/** 取用户邀请码；失败(常因限流)退避重试，避免层级链被压平 */
function getInviteWithRetry(token) {
    for (let attempt = 1; attempt <= MAX_INFO_ATTEMPTS; attempt++) {
        const info = getFrontUserInfo(token);
        if (info && info.inviteCode) return info;
        sleep(0.6 + Math.random() * 0.6);
    }
    return null;
}

export function setup() {
    const tenantId = __ENV.TENANT_ID || '3006';
    const teamName = __ENV.TEAM_NAME || 'TeamA';
    
    const adminToken = AdminLogin();
    const envConfig = getEnvByTenantId(tenantId);
    if (tenantId !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const adminData = { token: adminToken, envConfig };
    let phone = generateRandomPhone(envConfig.COUNTRY_CODE || '91');

    const urls = { frontUrl: envConfig.BASE_DESK_URL, adminUrl: envConfig.BASE_ADMIN_URL, registerUrl: envConfig.BASE_DESK_URL };
    const inviteUrls = { ...urls, frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL, registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL };

    // 根节点注册也带限流退避重试：根建失败会丢掉整支团队，必须稳
    let token = null;
    let rootErr = null;
    for (let attempt = 1; attempt <= MAX_REG_ATTEMPTS && !token; attempt++) {
        let res = phoneRegister(phone, adminData, 'qwer1234', '', null);
        if (!res || !res.data) res = phoneRegisterByInvite(phone, '', adminData, 'qwer1234', '', inviteUrls);
        token = extractToken(res);
        if (token) break;
        // 两条注册路径都失败：仅限流/瞬时错误才退避重试；永久性业务错误(如渠道不存在)立即快速失败
        rootErr = getLastRegisterError();
        if (!isTransientRegisterError(rootErr)) break;
        phone = generateRandomPhone(envConfig.COUNTRY_CODE || '91'); // 换号后退避重试
        sleep(Math.min(0.8 * Math.pow(1.7, attempt - 1), 10) + Math.random() * 0.6);
    }
    if (!token) {
        const detail = rootErr ? ` code=${rootErr.code} msgCode=${rootErr.msgCode} msg="${rootErr.msg}"` : '（疑似限流）';
        throw new Error(`[${teamName}] 根节点注册失败，终止本团队:${detail}`);
    }

    sleep(1);
    const userInfo = getInviteWithRetry(token) || getFrontUserInfo(token);
    if (!userInfo || !userInfo.userId) throw new Error(`[${teamName}] 根节点用户信息获取失败`);

    const rootData = { rootId: userInfo.userId, rootInvite: userInfo.inviteCode };
    
    // 🔥 给 Node.js Orchestrator 的输出标志位
    console.log(`[ROOT_INFO]: ${JSON.stringify(rootData)}`);

    return { adminToken, envConfig, rootInviteCode: userInfo.inviteCode };
}

export default function (data) {
    const { adminToken, envConfig, rootInviteCode } = data;
    const vuId = exec.vu.idInInstance;
    const totalVUs = parseInt(__ENV.VUS || '10', 10);
    const totalTarget = parseInt(__ENV.TOTAL_USERS || '50', 10);
    const levels = parseInt(__ENV.LEVELS || '3', 10);
    
    const tenantId = __ENV.TENANT_ID || '3006';
    if (tenantId !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const adminData = { token: adminToken, envConfig };
    
    // 平均分片：前 (totalTarget % totalVUs) 个 VU 各多处理1人，确保总和严格等于 totalTarget
    const base = Math.floor(totalTarget / totalVUs);
    const extra = totalTarget % totalVUs;
    // vuId 从 1 开始，前 extra 个 VU 多得 1 人
    const myTotalUsers = vuId <= extra ? base + 1 : base;
    
    const levelDistribution = distributePeople(myTotalUsers, levels);
    const inviteCodesByLevel = Array.from({ length: levels }, () => []);
    
    const customUrls = {
        frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL,
        registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL
    };

    let created = 0, dropped = 0, noInvite = 0;
    let fatalErr = null; // 命中环境级永久错误(如渠道不存在)时置位，立即中止整棵树的建立
    for (let currentLevel = 0; currentLevel < levelDistribution.length && !fatalErr; currentLevel++) {
        const levelCount = levelDistribution[currentLevel];
        for (let i = 0; i < levelCount; i++) {
            let parentCode = currentLevel === 0 ? rootInviteCode : randomPick(inviteCodesByLevel[currentLevel - 1]);
            if (!parentCode) parentCode = rootInviteCode; // 降级兜底：父级还没建成时先挂到根

            // 核心修复：对每个名额带退避重试，直到真正建成，保证实建人数=目标、层级链不断
            const reg = registerOneWithRetry(parentCode, adminData, envConfig, customUrls);
            if (!reg.token) {
                dropped++;
                // 永久性业务错误 → 后续名额必然同样失败，直接中止本树，避免每人再各失败一次
                if (reg.fatal) { fatalErr = reg.err; break; }
                continue; // 仅限流/瞬时：超过重试上限才记为丢失，继续下一个名额
            }
            created++;

            // 取邀请码供下一层挂靠；失败也重试，避免层级被压平
            const userInfo = getInviteWithRetry(reg.token);
            if (userInfo && userInfo.inviteCode) inviteCodesByLevel[currentLevel].push(userInfo.inviteCode);
            else noInvite++;

            sleep(0.3 + Math.random() * 0.4); // 轻微节流，缓解限流
        }
    }
    if (fatalErr) {
        console.error(`[FAST_FAIL] VU=${vuId} team=${__ENV.TEAM_NAME || ''} 建树中止：命中环境级永久错误 code=${fatalErr.code} msgCode=${fatalErr.msgCode} msg="${fatalErr.msg}"（如「Channel does not exist / 渠道不存在」通常是该租户邀请注册域名未绑定有效渠道，非脚本问题）`);
    }
    // 建树结果对账：目标 vs 实建（丢失>0 且非中止 → 限流仍偏紧，可调大 MAX_REG_ATTEMPTS 或降低 VUS）
    console.log(`[BUILD_RESULT] VU=${vuId} team=${__ENV.TEAM_NAME || ''} 目标=${myTotalUsers} 实建=${created} 丢失=${dropped} 无邀请码=${noInvite}${fatalErr ? ' 中止=是' : ''}`);
}
