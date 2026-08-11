/**
 * collectUserIds.test.js
 * 并发采集用户的 userId + account，写入文件（不修改密码）
 *
 *   1.txt → userId 列表（每行一个，共 TARGET 条）
 *   2.txt → account 账号列表（每行一个，共 TARGET 条）
 *
 * 多线程说明：
 *   k6 里只有 handleSummary 能写文件，且各 VU 在 default 里采集的数据无法回传，
 *   所以这里用 http.batch 在 setup 内做「并发翻页」：THREADS 个页面同时请求，
 *   分波次把所有页拉完。THREADS 就是同时翻页的线程数。
 *
 * 运行方式（在 k6/tests/api/activity/firebase/ 目录下执行）：
 *   k6 run -e TENANT=3004 collectUserIds.test.js
 *   k6 run -e TENANT=3005 -e TARGET=10 -e THREADS=2 collectUserIds.test.js
 *
 * 参数说明：
 *   TENANT      租户 ID（默认 3004）
 *   TARGET      目标采集条数（默认 25000）
 *   PAGE_SIZE   每页条数（默认 500，最大 500）
 *   THREADS     同时并发翻页的线程数（默认 10）
 */

import http from 'k6/http';
import { tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { SignedHttpClient } from '../../../../libs/utils/signature.js';
import { getTimeRandom } from '../../../utils/utils.js';
import { getEnvByTenantId } from '../../../../config/envconfig.js';

// ============================================================
// 参数
// ============================================================

const TENANT_ID = __ENV.TENANT || __ENV.TENANT_ID || '3004';
const TARGET    = parseInt(__ENV.TARGET    || '25000', 10);
const PAGE_SIZE = parseInt(__ENV.PAGE_SIZE || '500',   10);
const THREADS   = parseInt(__ENV.THREADS   || __ENV.VUS || '10', 10);

const TAG = 'CollectUserIds';

// ============================================================
// 模块级缓存：在 setup 与 handleSummary 之间传数据
// （k6 的 handleSummary 拿不到 setup 返回值，但二者共享主实例的模块作用域）
// ============================================================
let collectedUsers = [];

// ============================================================
// K6 Options
// ============================================================

export const options = {
    setupTimeout: '2h',
    scenarios: {
        collect: {
            executor:    'per-vu-iterations',
            vus:         1,
            iterations:  1,
            maxDuration: '2h'
        }
    }
};

// ============================================================
// 构造一个已签名的 GetPageList 请求（用于 http.batch）
// 完全复刻 tenantRequest 的签名/请求头逻辑
// ============================================================

function buildPageRequest(pageNo, token) {
    const envConfig = getEnvByTenantId(TENANT_ID);
    const baseUrl   = envConfig.BASE_ADMIN_URL;        // isDesk:false → 后台地址
    const url       = baseUrl + '/api/Users/GetPageList';

    const timeData = getTimeRandom();
    const requestData = {
        userType: 0,
        pageNo:   pageNo,
        pageSize: PAGE_SIZE,
        orderBy:  'Desc',
        random:    timeData.random,
        language:  timeData.language,
        timestamp: timeData.timestamp
    };

    const signedData = new SignedHttpClient().signData(requestData);

    return {
        method: 'POST',
        url:    url,
        body:   JSON.stringify(signedData),
        params: {
            headers: {
                'Content-Type': 'application/json',
                'Domainurl':    baseUrl,
                'Referrer':     baseUrl,
                'Authorization': `Bearer ${token}`
            }
        }
    };
}

// 解析一页响应，返回 [{userId, account}, ...]
function parsePage(resp) {
    if (!resp || resp.status !== 200 || !resp.body) return null;
    let body;
    try { body = JSON.parse(resp.body); } catch (e) { return null; }
    const code = body.msgCode !== undefined ? body.msgCode : body.code;
    if (code !== 0 || !body.data || !body.data.list) return null;
    return body.data;
}

// 把一组 list 收进 allUsers，达到 needCount 即返回 true
function collectInto(allUsers, list, needCount) {
    for (const u of (list || [])) {
        allUsers.push({ userId: u.userId, account: u.account });
        if (allUsers.length >= needCount) return true;
    }
    return false;
}

// ============================================================
// setup：并发翻页采集
// ============================================================

export function setup() {
    console.log(`[${TAG}] ========== Setup 开始 ==========`);
    console.log(`[${TAG}] 租户: ${TENANT_ID} | 目标: ${TARGET} 条 | 每页: ${PAGE_SIZE} | 并发线程: ${THREADS}`);

    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[${TAG}] 后台登录失败`);
    console.log(`[${TAG}] ✅ 后台登录成功`);

    // ── 第1页：拿 totalCount，并收集第1页数据 ────────────────
    const firstResp = http.batch([buildPageRequest(1, adminToken)])[0];
    const firstData = parsePage(firstResp);
    if (!firstData) throw new Error(`[${TAG}] 第1页请求失败: status=${firstResp ? firstResp.status : 'null'}`);

    const totalCount = firstData.totalCount || 0;
    console.log(`[${TAG}] 总用户数: ${totalCount}`);

    // 实际目标：不超过总数
    const needCount  = Math.min(TARGET, totalCount || TARGET);
    // 需要的总页数（向上取整）
    const pagesNeeded = Math.min(
        Math.ceil(needCount / PAGE_SIZE),
        Math.ceil((totalCount || needCount) / PAGE_SIZE)
    );
    console.log(`[${TAG}] 需采集 ${needCount} 条，共需 ${pagesNeeded} 页，分 ${Math.ceil((pagesNeeded - 1) / THREADS)} 波并发`);

    const allUsers = [];
    if (collectInto(allUsers, firstData.list, needCount)) {
        console.log(`[${TAG}] 第1页后已达目标，累计 ${allUsers.length} 条`);
    } else {
        // ── 第 2..pagesNeeded 页：每 THREADS 页一波，并发请求 ──
        for (let start = 2; start <= pagesNeeded; start += THREADS) {
            const end = Math.min(start + THREADS - 1, pagesNeeded);

            // 组装本波的并发请求
            const reqs = [];
            for (let p = start; p <= end; p++) reqs.push(buildPageRequest(p, adminToken));

            const responses = http.batch(reqs);

            // 按页顺序收集，保持顺序稳定
            let reachedTarget = false;
            for (let i = 0; i < responses.length; i++) {
                const data = parsePage(responses[i]);
                if (!data || !data.list) {
                    console.warn(`[${TAG}] 第 ${start + i} 页失败，跳过`);
                    continue;
                }
                if (collectInto(allUsers, data.list, needCount)) {
                    reachedTarget = true;
                    break;
                }
            }

            console.log(`[${TAG}] 已并发翻到第 ${end}/${pagesNeeded} 页，累计 ${allUsers.length} 条`);
            if (reachedTarget) break;
        }
    }

    // 裁剪到精确目标条数
    const finalUsers = allUsers.slice(0, needCount);
    // 存入模块级缓存，供 handleSummary 写文件
    collectedUsers = finalUsers;
    console.log(`[${TAG}] ✅ 采集完成，共 ${finalUsers.length} 个用户`);
    console.log(`[${TAG}] ========== Setup 完成 ==========`);

    return { allUsers: finalUsers };
}

// ============================================================
// default：无操作（采集已在 setup 完成）
// ============================================================

export default function () {
    // 采集逻辑全部在 setup，这里不需要做任何事
}

// ============================================================
// handleSummary：写 1.txt（userId）和 2.txt（account）
// ============================================================

export function handleSummary(_data) {
    // 优先用模块级缓存（handleSummary 拿不到 setup 返回值）
    const allUsers = collectedUsers;

    if (allUsers.length === 0) {
        console.warn(`[${TAG}] ⚠️ allUsers 为空，1.txt 和 2.txt 不会被写入`);
        return { stdout: `[${TAG}] 未收集到用户数据\n` };
    }

    const userIdContent  = allUsers.map(u => u.userId).join('\n');
    const accountContent = allUsers.map(u => u.account).join('\n');

    console.log(`[${TAG}] 写入 1.txt 和 2.txt，共 ${allUsers.length} 条`);

    return {
        '1.txt': userIdContent,
        '2.txt': accountContent,
        stdout: [
            '='.repeat(55),
            `  CollectUserIds 完成`,
            `  采集条数: ${allUsers.length}`,
            `  1.txt → userId 列表`,
            `  2.txt → account（账号）列表`,
            '='.repeat(55)
        ].join('\n') + '\n'
    };
}
