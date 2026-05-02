/**
 * 相同会员信息检测
 *
 * 功能：
 *   1. 获取全量用户列表
 *   2. 获取测试账号列表，从全量中剔除
 *   3. 逐个查询用户详情，提取注册IP / 注册设备 / 浏览器指纹
 *   4. 按三个维度分别统计，打印重复分组表格
 *
 * 运行方式：
 *   k6 run -e TENANT_ID=3004 k6/tests/api/user/duplicateUserDetect.test.js
 *   k6 run -e TENANT_ID=3004 -e PAGE_SIZE=200 duplicateUserDetect.test.js
 */

import { sleep } from 'k6';
import { sendRequest } from '../common/request.js';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';

const tenantId  = __ENV.TENANT_ID  || '3004';
const PAGE_SIZE = parseInt(__ENV.PAGE_SIZE || '500', 10);

const TAG = 'DuplicateUserDetect';

export const options = {
    scenarios: {
        duplicate_user_detect: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '2h'
        }
    }
};

// ============================================================
// Step 1 / Step 2 — 分页拉取用户列表
// ============================================================

/**
 * 分页拉取 /api/Users/GetPageList，返回所有 userId 集合
 * @param {string} adminToken
 * @param {object} extraPayload  - 额外过滤参数，如 { userType: 1 }
 * @returns {Set<number>}
 */
function fetchAllUserIds(adminToken, extraPayload = {}) {
    const api = '/api/Users/GetPageList';
    const idSet = new Set();
    let pageNo = 1;
    let totalPage = 1;

    while (pageNo <= totalPage) {
        const payload = {
            pageNo,
            pageSize: PAGE_SIZE,
            orderBy: 'Desc',
            ...extraPayload
        };

        const result = sendRequest(payload, api, TAG, false, adminToken);
        if (!result) break;

        const list      = result.list       || [];
        const tp        = result.totalPage  || result.totalPages || 1;
        if (tp > totalPage) totalPage = tp;

        list.forEach(u => idSet.add(u.userId));
        console.log(`   [GetPageList] 第${pageNo}/${totalPage}页，本页 ${list.length} 条，累计 ${idSet.size} 条`);

        pageNo++;
        if (pageNo <= totalPage) sleep(0.3);
    }

    return idSet;
}

// ============================================================
// Step 3 — 查询单个用户详情
// ============================================================

/**
 * 查询 /api/Users/GetUserDetail，返回三个维度的值
 * @param {string} adminToken
 * @param {number} userId
 * @returns {{ registerIp: string, registerDevice: string, registerFingerprint: string } | null}
 */
function fetchUserDetail(adminToken, userId) {
    const api = '/api/Users/GetUserDetail';
    const result = sendRequest({ userId }, api, TAG, false, adminToken);
    if (!result) return null;

    // 优先从 registerSourceRsp 取，兜底从 riskControlRsp 取
    const src  = result.registerSourceRsp  || {};
    const risk = result.riskControlRsp     || {};

    const registerIp          = src.registerIp          || (risk.registerIp          && risk.registerIp.account)          || '';
    const registerDevice      = src.registerDevice      || (risk.registerDevice      && risk.registerDevice.account)      || '';
    const registerFingerprint = src.registerFingerprint || (risk.registerFingerprint && risk.registerFingerprint.account) || '';

    return { registerIp, registerDevice, registerFingerprint };
}

// ============================================================
// 打印表格
// ============================================================

/**
 * 打印重复分组表格
 * @param {string}  title      - 表格标题
 * @param {string}  col1Label  - 第一列标题（如 "注册IP"）
 * @param {Map<string, number[]>} groupMap  - key → [userId, ...]
 */
function printDuplicateTable(title, col1Label, groupMap) {
    // 只保留人数 >= 2 的分组
    const rows = [];
    groupMap.forEach((userIds, key) => {
        if (userIds.length >= 2) {
            rows.push({ key, count: userIds.length, userIds });
        }
    });

    if (rows.length === 0) {
        console.log(`\n✅ [${title}] 未发现重复记录`);
        return;
    }

    // 按人数降序排列
    rows.sort((a, b) => b.count - a.count);

    // 计算列宽
    const col1Width = Math.max(col1Label.length + 2, ...rows.map(r => r.key.length + 2));
    const col2Width = Math.max('相同会员人数'.length + 2, 8);
    const col3Width = Math.max('会员ID列表'.length + 2, 20);

    const sep = `+${'-'.repeat(col1Width)}+${'-'.repeat(col2Width)}+${'-'.repeat(col3Width)}+`;

    console.log(`\n${'═'.repeat(sep.length)}`);
    console.log(`  📊 ${title}  （共 ${rows.length} 组重复）`);
    console.log(`${'═'.repeat(sep.length)}`);
    console.log(sep);
    console.log(`| ${col1Label.padEnd(col1Width - 1)}| ${'相同会员人数'.padEnd(col2Width - 1)}| ${'会员ID列表'.padEnd(col3Width - 1)}|`);
    console.log(sep);

    rows.forEach(r => {
        const idStr = r.userIds.join(', ');
        // 超长时截断
        const idDisplay = idStr.length > col3Width - 3 ? idStr.substring(0, col3Width - 6) + '...' : idStr;
        console.log(`| ${r.key.padEnd(col1Width - 1)}| ${String(r.count).padEnd(col2Width - 1)}| ${idDisplay.padEnd(col3Width - 1)}|`);
    });

    console.log(sep);
    console.log(`  合计：${rows.reduce((s, r) => s + r.count, 0)} 个账号分布在 ${rows.length} 个重复分组中`);
    console.log(`${'═'.repeat(sep.length)}\n`);
}

// ============================================================
// Setup
// ============================================================

export function setup() {
    console.log(`\n[Setup] 租户: ${tenantId}`);
    const adminToken = tenantAdminLogin(tenantId);
    if (!adminToken) throw new Error('[Setup] 管理员登录失败');
    console.log(`[Setup] ✅ 登录成功`);
    return { adminToken };
}

// ============================================================
// 主流程
// ============================================================

export default function (data) {
    const { adminToken } = data;

    console.log(`\n${'='.repeat(70)}`);
    console.log(`🔍 相同会员信息检测  租户=${tenantId}`);
    console.log(`${'='.repeat(70)}\n`);

    // ── Step 1: 全量用户 ──────────────────────────────────────
    console.log('【Step 1】获取全量用户列表...');
    const allUserIds = fetchAllUserIds(adminToken);
    console.log(`[Step 1] ✅ 全量用户: ${allUserIds.size} 人\n`);

    // ── Step 2: 测试账号，剔除后得到真实用户 ─────────────────
    console.log('【Step 2】获取测试账号列表并剔除...');
    const testUserIds = fetchAllUserIds(adminToken, { userType: 1 });
    console.log(`[Step 2] 测试账号: ${testUserIds.size} 人`);

    const realUserIds = [];
    allUserIds.forEach(uid => {
        if (!testUserIds.has(uid)) realUserIds.push(uid);
    });
    console.log(`[Step 2] ✅ 剔除后真实用户: ${realUserIds.length} 人\n`);

    if (realUserIds.length === 0) {
        console.warn('[Step 2] ⚠️  无真实用户，终止');
        return;
    }

    // ── Step 3: 逐个查询详情，按三个维度分组 ─────────────────
    console.log(`【Step 3】查询 ${realUserIds.length} 个用户详情...\n`);

    // key → [userId, ...]
    const ipMap          = new Map();
    const deviceMap      = new Map();
    const fingerprintMap = new Map();

    let querySuccess = 0;
    let queryFailed  = 0;

    realUserIds.forEach((uid, idx) => {
        if (idx > 0 && idx % 50 === 0) {
            console.log(`   ...已查询 ${idx}/${realUserIds.length} 人...`);
        }

        sleep(0.2); // 避免请求过快

        const detail = fetchUserDetail(adminToken, uid);
        if (!detail) {
            queryFailed++;
            return;
        }
        querySuccess++;

        const { registerIp, registerDevice, registerFingerprint } = detail;

        // 注册IP（非空才统计）
        if (registerIp) {
            if (!ipMap.has(registerIp)) ipMap.set(registerIp, []);
            ipMap.get(registerIp).push(uid);
        }

        // 注册设备（非空才统计）
        if (registerDevice) {
            if (!deviceMap.has(registerDevice)) deviceMap.set(registerDevice, []);
            deviceMap.get(registerDevice).push(uid);
        }

        // 浏览器指纹（非空才统计）
        if (registerFingerprint) {
            if (!fingerprintMap.has(registerFingerprint)) fingerprintMap.set(registerFingerprint, []);
            fingerprintMap.get(registerFingerprint).push(uid);
        }
    });

    console.log(`\n[Step 3] ✅ 查询完毕: 成功=${querySuccess}, 失败=${queryFailed}\n`);

    // ── 输出三张表格 ──────────────────────────────────────────
    printDuplicateTable('相同注册IP',       '注册IP',     ipMap);
    printDuplicateTable('相同注册设备',     '注册设备',   deviceMap);
    printDuplicateTable('相同浏览器指纹',   '浏览器指纹', fingerprintMap);

    console.log(`${'='.repeat(70)}`);
    console.log(`✅ 检测完成  租户=${tenantId}`);
    console.log(`${'='.repeat(70)}\n`);
}
