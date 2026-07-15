/**
 * 代理层级 + 转线验证
 *
 * 输入：一个后台 userId（可为总代 parentId=0，也可为某层级代理）+ 租户。
 *
 * Step1 层级验证（/api/Agent/GetPageListAgentList，以 userId 为根验其子树）：
 *   ① 每个节点直属下级实际数 == firstChildCount（少了/多了都报）
 *   ② 每个直属下级 hierarchy == 父.hierarchy + 1（层级错误报出）
 *   ③ 每个节点全部后代递归数 == childCount
 * Step2 转线验证（/api/Agent/GetPageListAgentTransfer，当天）：
 *   对"转入本团队"的会员：新上级在团队内、新上级层级==newHierarchy-1、本人团队内层级==newHierarchy
 *
 * 运行：
 *   k6 run -e TENANT_ID=3004 -e USER_ID=163318  agentHierarchyValidation.test.js
 *   # 时间默认今天当天 00:00–23:59（机器本地时区）；可覆盖：-e TIME_FROM=..(ms) -e TIME_TO=..(ms)
 *
 * k6 check 绿 = 验证通过；红 = 发现层级/人数/转线不一致。
 */
import { check } from 'k6';
import { AdminLogin } from '../login/adminlogin.test.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { fetchAgentLine, fetchDayTransfers } from './agentHierarchyApi.js';
import { verifyHierarchy, verifyTransfers, buildMaps } from './agentVerifyCore.js';

export const options = {
    scenarios: {
        verify: { executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '30m' },
    },
};

export function setup() {
    const tenantId = __ENV.TENANT_ID || '3006';
    const userId = parseInt(__ENV.USER_ID || '0', 10);
    if (!userId) throw new Error('必须提供 -e USER_ID=<后台userId>');

    const adminToken = AdminLogin();
    if (!adminToken) throw new Error(`租户 ${tenantId} 后台登录失败`);
    const envConfig = getEnvByTenantId(tenantId);
    if (tenantId !== '3004') Object.assign(ENV_CONFIG, envConfig);

    // 时间范围：默认"今天当天" 00:00:00–23:59:59（机器本地时区；可用 -e TIME_FROM/TIME_TO 覆盖）
    let timeFrom, timeTo;
    if (__ENV.TIME_FROM && __ENV.TIME_TO) {
        timeFrom = parseInt(__ENV.TIME_FROM, 10);
        timeTo = parseInt(__ENV.TIME_TO, 10);
    } else {
        const now = new Date();
        timeFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
        timeTo = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 0).getTime();
    }

    console.log(`\n[Setup] 租户=${tenantId} 根userId=${userId} 时间=[${timeFrom}, ${timeTo}]`);
    const agentLine = fetchAgentLine(adminToken, userId);
    console.log(`[Setup] 代理列表拉取完成：${agentLine.list.length} 条 (totalCount=${agentLine.totalCount})`);
    const transfers = fetchDayTransfers(adminToken, timeFrom, timeTo);
    console.log(`[Setup] 当天转线拉取完成：${transfers.list.length} 条 (totalCount=${transfers.totalCount})`);

    return { tenantId, userId, agentLine, transfers, timeFrom, timeTo };
}

export default function (data) {
    const { tenantId, userId, agentLine, transfers } = data;
    const line = '='.repeat(72);
    console.log(`\n${line}\n  代理层级 + 转线验证   租户=${tenantId}   根userId=${userId}\n${line}`);

    // ---------- Step1 ----------
    const s1 = verifyHierarchy(agentLine.list, userId);
    const { nodeById } = buildMaps(agentLine.list);

    console.log(`\n----- Step1 层级验证 -----`);
    if (s1.rootNode) {
        const who = s1.rootNode.parentId === 0 ? '(总代)' : `(上级=${s1.rootNode.parentId})`;
        console.log(`  根 ${userId}：层级=${s1.rootNode.hierarchy} ${who}；本团队总代(generalAgentId)=${s1.expectedGA}；子树成员=${s1.teamSet.size} 人；接口 totalCount=${agentLine.totalCount}`);
    }
    if (s1.errors.length === 0 && s1.rootNode) {
        console.log(`  ✅ 通过：${s1.checked} 个节点的 直属人数 / 层级 / 全部下级数 全部一致`);
    } else {
        console.log(`  ❌ 发现 ${s1.errors.length} 处问题：`);
        s1.errors.forEach((e) => console.log(`    • ${e}`));
    }

    // ---------- Step2 ----------
    console.log(`\n----- Step2 转线验证（当天）-----`);
    const s2 = verifyTransfers(transfers.list, s1.teamSet, nodeById);
    console.log(`  当天转线记录 ${transfers.totalCount} 条；判定为"转入本团队"的会员 ${s2.intoTeamCount} 人`);

    // 打印转入本团队的会员明细
    if (s2.transferredIn.length > 0) {
        console.log(`  ── 转入本团队的会员明细（按转入时间倒序）──`);
        s2.transferredIn.forEach((d, i) => {
            let t = d.transferBeginTime;
            try { t = new Date(d.transferBeginTime).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'; } catch (e) { /* keep ms */ }
            const flag = d.ok ? '✅' : '❌';
            const actual = d.inTeam ? `团队内层级=${d.actualHierarchy}(上级=${d.actualParentId})` : '⚠不在团队子树';
            console.log(
                `    ${flag} [${i + 1}] userId=${d.userId}  新上级=${d.newParentId}(层级${d.parentHierarchy})  新层级=${d.newHierarchy}  ` +
                `原上级=${d.oldParentId}(层级${d.oldHierarchy})  队伍人数=${d.teamUserCount}  ${actual}  转入=${t}`
            );
            if (d.problems.length) console.log(`           ⛔ 问题：${d.problems.join('；')}`);
        });
    }

    if (s2.errors.length === 0) {
        console.log(`  ✅ 通过：转入本团队的会员 新上级存在 / 新上级层级=新层级-1 / 本人层级一致`);
    } else {
        console.log(`  ❌ 发现 ${s2.errors.length} 处问题：`);
        s2.errors.forEach((e) => console.log(`    • ${e}`));
    }
    s2.infos.forEach((i) => console.log(`    ${i}`));

    // ---------- 汇总 ----------
    const ok1 = s1.errors.length === 0 && !!s1.rootNode;
    const ok2 = s2.errors.length === 0;
    console.log(`\n===== 汇总：Step1 ${ok1 ? '✅ 通过' : '❌ 失败'}  |  Step2 ${ok2 ? '✅ 通过' : '❌ 失败'} =====\n`);

    check(null, {
        'Step1 层级/人数一致': () => ok1,
        'Step2 转线一致': () => ok2,
    });
}
