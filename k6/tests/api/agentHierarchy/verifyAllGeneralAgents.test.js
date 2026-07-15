/**
 * 验证「所有总代」的层级 + 总代一致性 + 当天转线
 *
 * 被验证的总代集合 = ROOT_IDS（流水线建的队根，逗号分隔）∪ 当天转线遗留的「野生总代」
 *   野生总代 = 最近一条转线记录仍是解绑态(newParentId=0) 的会员 → 解绑后没绑回任何团队（转线未闭合，通常是 bug）
 *
 * 每个总代都跑：Step1（直属人数/层级/全部下级数/总代 generalAgentId 一致）+ Step2（当天转入本团队的会员校验）。
 *
 * 运行：
 *   k6 run -e TENANT_ID=3004 -e ROOT_IDS=163573 verifyAllGeneralAgents.test.js
 *   # 时间默认今天当天；可覆盖 -e TIME_FROM=..(ms) -e TIME_TO=..(ms)
 *
 * k6 check 绿 = 全部总代通过且无野生总代；红 = 有总代验证不过或存在野生总代。
 */
import { check } from 'k6';
import { AdminLogin } from '../login/adminlogin.test.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { fetchAgentLine, fetchDayTransfers } from './agentHierarchyApi.js';
import { verifyHierarchy, verifyTransfers, buildMaps, deriveStrayGeneralAgents } from './agentVerifyCore.js';

export const options = {
    scenarios: {
        verify_all: { executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '1h' },
    },
};

export function setup() {
    const tenantId = __ENV.TENANT_ID || '3006';
    const rootIds = String(__ENV.ROOT_IDS || '')
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter(Boolean);

    const adminToken = AdminLogin();
    if (!adminToken) throw new Error(`租户 ${tenantId} 后台登录失败`);
    const envConfig = getEnvByTenantId(tenantId);
    if (tenantId !== '3004') Object.assign(ENV_CONFIG, envConfig);

    // 时间范围：默认今天当天（机器本地时区；可 -e TIME_FROM/TIME_TO 覆盖）
    let timeFrom, timeTo;
    if (__ENV.TIME_FROM && __ENV.TIME_TO) {
        timeFrom = parseInt(__ENV.TIME_FROM, 10);
        timeTo = parseInt(__ENV.TIME_TO, 10);
    } else {
        const now = new Date();
        timeFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
        timeTo = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 0).getTime();
    }

    console.log(`\n[Setup] 租户=${tenantId} 队根=[${rootIds.join(', ')}] 时间=[${timeFrom}, ${timeTo}]`);

    // 当天转线（只拉一次，供推导野生总代 + 各总代 Step2 共用）
    const transfers = fetchDayTransfers(adminToken, timeFrom, timeTo);
    console.log(`[Setup] 当天转线 ${transfers.list.length} 条 (totalCount=${transfers.totalCount})`);

    // 推导野生总代
    const strays = deriveStrayGeneralAgents(transfers.list);
    const strayIds = strays.map((s) => s.userId);
    if (strayIds.length > 0) {
        console.log(`[Setup] ⚠️ 发现 ${strayIds.length} 个野生总代(转线未闭合): ${strayIds.join(', ')}`);
    } else {
        console.log(`[Setup] ✅ 未发现野生总代（当天每次解绑都已绑回团队）`);
    }

    // 全部待验证总代 = 队根 ∪ 野生总代（去重）
    const allGA = [];
    const seen = {};
    for (const id of rootIds.concat(strayIds)) {
        if (!seen[id]) { seen[id] = true; allGA.push(id); }
    }

    // 逐个拉取代理线（Step1 用）
    const agentLines = {};
    for (const id of allGA) {
        agentLines[id] = fetchAgentLine(adminToken, id);
    }

    return { tenantId, rootIds, strays, allGA, agentLines, transfers };
}

export default function (data) {
    const { tenantId, rootIds, strays, allGA, agentLines, transfers } = data;
    const line = '='.repeat(72);
    console.log(`\n${line}\n  验证所有总代   租户=${tenantId}   总代数=${allGA.length}（队根 ${rootIds.length} + 野生 ${strays.length}）\n${line}`);

    const strayIdSet = {};
    strays.forEach((s) => { strayIdSet[s.userId] = s; });

    let passCount = 0;
    let failCount = 0;
    const failed = [];

    for (const gaId of allGA) {
        const isStray = !!strayIdSet[gaId];
        const tagWho = isStray ? '⚠️野生总代' : '队根';
        console.log(`\n${'█'.repeat(3)} 总代 ${gaId} (${tagWho}) ${'█'.repeat(3)}`);

        const agentLine = agentLines[gaId];
        if (!agentLine || agentLine.list.length === 0) {
            console.log(`  ❌ 拉取代理线为空，无法验证（该总代可能无成员或 userId 有误）`);
            failCount++; failed.push(gaId);
            continue;
        }

        // Step1
        const s1 = verifyHierarchy(agentLine.list, gaId);
        const { nodeById } = buildMaps(agentLine.list);
        if (s1.rootNode) {
            const who = s1.rootNode.parentId === 0 ? '(总代)' : `(上级=${s1.rootNode.parentId})`;
            console.log(`  Step1: 根层级=${s1.rootNode.hierarchy} ${who}；总代generalAgentId=${s1.expectedGA}；子树成员=${s1.teamSet.size} 人`);
        }
        if (s1.errors.length === 0 && s1.rootNode) {
            console.log(`  Step1 ✅ 通过（${s1.checked} 节点 直属人数/层级/全部下级数/总代 全一致）`);
        } else {
            console.log(`  Step1 ❌ ${s1.errors.length} 处问题：`);
            s1.errors.forEach((e) => console.log(`     • ${e}`));
        }

        // Step2
        const s2 = verifyTransfers(transfers.list, s1.teamSet, nodeById);
        console.log(`  Step2: 转入本团队 ${s2.intoTeamCount} 人`);
        if (s2.errors.length > 0) {
            console.log(`  Step2 ❌ ${s2.errors.length} 处问题：`);
            s2.errors.forEach((e) => console.log(`     • ${e}`));
        } else {
            console.log(`  Step2 ✅ 通过`);
        }

        const ok = s1.errors.length === 0 && !!s1.rootNode && s2.errors.length === 0 && !isStray;
        if (ok) { passCount++; }
        else { failCount++; failed.push(gaId); }
    }

    // 汇总
    console.log(`\n${line}\n  汇总：共 ${allGA.length} 个总代 → 通过 ${passCount} / 失败 ${failCount}` +
        (strays.length ? `；野生总代 ${strays.length} 个(${strays.map((s) => s.userId).join(',')})` : '；无野生总代') +
        (failed.length ? `\n  ❌ 需关注：${failed.join(', ')}` : '') + `\n${line}\n`);

    check(null, {
        '所有总代层级/转线一致': () => failCount === 0,
        '无野生总代(转线全部闭合)': () => strays.length === 0,
    });
}
