/**
 * 组 0：有效邀请「只读基线核对」
 *
 * 不改任何配置、不造任何数据。读当前配置 → 拉团队 → 对每个直推下级按配置自己算
 * 该不该是有效邀请 → 和后台的 isOkInvite 逐人比对。
 *
 * 口径未定的地方同时算两种，用不匹配的那一项反推后端到底用哪种：
 *   - 投注统计区间：全部历史 vs 注册当日
 *   - 充值口径：团队接口的 totalRechargeAmount（累计）
 *
 * 用法（落报告要走 runner）：
 *   node runner.js --tenant 3004 --agents 169800
 *   k6p -e TENANT_ID=3004 -e AGENT_IDS=169800 baseline.js -q     # 只看控制台
 */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { getTzOffsetMs } from '../../../../libs/common/time.js';
import {
    TAG, getConfig, getTeam, directDownlines, fetchOrders, sumOrders,
    expectOkInvite, limitGamesText, emit, MODE_BOTH
} from './api.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const AGENT_IDS = (__ENV.AGENT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const INCLUDE_INDIRECT = __ENV.INCLUDE_INDIRECT === '1'; // 默认只核对直推(有效邀请只算L1)

export const options = {
    setupTimeout: '2m',
    scenarios: { baseline: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '60m' } }
};

export function setup() {
    const env = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, env);
    if (AGENT_IDS.length === 0) throw new Error(`[${TAG}] 必须指定 -e AGENT_IDS=<上级userId,逗号分隔>`);
    const token = tenantAdminLogin(TENANT_ID);
    if (!token) throw new Error(`[${TAG}] 租户 ${TENANT_ID} 管理员登录失败`);
    return { token, env };
}

/** 注册当日在租户时区下的 [00:00, 23:59:59] 毫秒区间 */
function registerDayRange(registerTime) {
    const off = getTzOffsetMs(TENANT_ID);
    const local = new Date(Number(registerTime) + off);
    const dayStartLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    return { begin: dayStartLocal - off, end: dayStartLocal - off + 86400000 - 1 };
}

export default function (data) {
    const { token, env } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, env);

    const config = getConfig(token);
    if (!config) throw new Error(`[${TAG}] 读配置失败`);

    console.log(`\n[${TAG}] ===== 当前配置（租户 ${TENANT_ID}）=====`);
    console.log(`[${TAG}] 达标条件 = ${config.mode === MODE_BOTH ? '同时满足' : '满足任一'} (mode=${config.mode})`);
    console.log(`[${TAG}] 充值门槛 = ${config.rechargeThreshold}   投注门槛 = ${config.betThreshold}`);
    console.log(`[${TAG}] 生效游戏 = ${limitGamesText(config.limitGames)}`);
    console.log(`[${TAG}] 每日上限 = ${config.dayLimit}  总上限 = ${config.totalLimit}  同设备不计 = ${config.sameDeviceInvalid}`);
    emit('CONFIG', {
        tenantId: TENANT_ID, mode: config.mode, rechargeThreshold: config.rechargeThreshold,
        betThreshold: config.betThreshold, limitGameRaw: config.limitGameRaw,
        limitGamesText: limitGamesText(config.limitGames), dayLimit: config.dayLimit,
        totalLimit: config.totalLimit, sameDeviceInvalid: config.sameDeviceInvalid,
        readAt: new Date().toISOString()
    });

    const now = Date.now();
    let total = 0, matched = 0, mismatched = 0;

    for (const agentId of AGENT_IDS) {
        const team = getTeam(token, Number(agentId));
        const targets = INCLUDE_INDIRECT ? team : directDownlines(team, agentId);
        console.log(`\n[${TAG}] ===== 上级 ${agentId}：团队 ${team.length} 人，核对 ${targets.length} 人${INCLUDE_INDIRECT ? '(含间推)' : '(仅直推)'} =====`);

        for (const m of targets) {
            const userId = m.userId;
            const totalRecharge = Number(m.totalRechargeAmount) || 0;

            // 口径一：全部历史（从注册到现在）
            const allOrders = fetchOrders(token, userId, config.limitGames, Number(m.registerTime), now);
            const all = sumOrders(allOrders);
            // 口径二：注册当日
            const dr = registerDayRange(m.registerTime);
            const dayOrders = allOrders.filter(o => Number(o.betTime) >= dr.begin && Number(o.betTime) <= dr.end);
            const day = sumOrders(dayOrders);

            const byAll = expectOkInvite(config, totalRecharge, all.validAmount);
            const byDay = expectOkInvite(config, totalRecharge, day.validAmount);
            const actual = !!m.isOkInvite;

            // 两种口径哪种能解释后台结果
            let caliber = '两种口径一致';
            if (byAll.expected !== byDay.expected) {
                caliber = actual === byAll.expected ? '只有「全部历史」口径能解释'
                    : (actual === byDay.expected ? '只有「注册当日」口径能解释' : '两种口径都解释不了');
            }
            const match = actual === byAll.expected;
            total++; match ? matched++ : mismatched++;

            const row = {
                agentId: Number(agentId), userId,
                hierarchy: Number(m.parentId) === Number(agentId) ? 'L1直推' : (Number(m.parentIdL2) === Number(agentId) ? 'L2' : 'L3'),
                registerTime: new Date(Number(m.registerTime)).toISOString(),
                registerDevice: m.registerDevice || '',
                totalRecharge,
                firstRechargeAmount: Number(m.firstRechargeAmount) || 0,
                validBetAll: Number(all.validAmount.toFixed(2)),
                validBetDay: Number(day.validAmount.toFixed(2)),
                betAmountAll: Number(all.betAmount.toFixed(2)),
                orderCount: all.count, settled: all.settled, unsettled: all.unsettled,
                expected: byAll.expected, actual, match, caliber,
                reason: byAll.reason
            };
            emit('CASE', Object.assign({ caseId: '0-1', caseName: '只读基线核对' }, row));

            const flag = match ? '✅' : '❌';
            console.log(`[${TAG}] ${flag} userId=${userId} ${row.hierarchy} 充值=${totalRecharge} 范围内有效投注(全部)=${row.validBetAll}`
                + `${row.unsettled > 0 ? ` ⚠️未结算${row.unsettled}单` : ''}`
                + ` | 期望=${byAll.expected} 实际=${actual}`
                + (match ? '' : `  ← 不一致！${byAll.reason}；注册当日口径期望=${byDay.expected}（${caliber}）`));
            sleep(0.3);
        }
    }

    console.log(`\n[${TAG} ] ===== 汇总：核对 ${total} 人，一致 ${matched}，不一致 ${mismatched} =====`);
    emit('SUMMARY', { caseId: '0-1', total, matched, mismatched });
}
