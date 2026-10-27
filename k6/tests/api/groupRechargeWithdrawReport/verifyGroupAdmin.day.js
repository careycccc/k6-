/**
 * 集团充提报表核对 —— 验证·集团后台查询半边(配合 verifyReportRunner.js 使用)
 *
 * 单次运行，查全部商户的报表数据(集团后台的3个接口本身就是一次性返回全部
 * 商户的，不需要按商户拆分成多进程)。只负责"查并打印标记行"，不做对比——
 * 对比逻辑统一在 verifyReportRunner.js 里做(Node端，拿到本地+集团两份数据
 * 才能对比)。
 *
 * 用法（在本目录内运行，推荐走 Runner）：
 *   k6 run -e START=2026-10-01 -e END=2026-10-26 verifyGroupAdmin.day.js
 */

import { GROUP_ADMIN_TEST } from '../../../config/groupAdminConfig.js';
import { groupAdminLogin, getTenantPageList, getRechargeChannelSummaryPageList, getWithdrawChannelSummaryPageList, getOverview } from './groupAdminApi.js';
import { TARGET_TENANT_IDS } from './seedConfig.js';

const START = __ENV.START;
const END = __ENV.END;
if (!START || !END) throw new Error('[VerifyGroupAdmin] 必须传 START/END (YYYY-MM-DD)');

export const options = {
    scenarios: { s: { executor: 'per-vu-iterations', vus: 1, iterations: 1 } }
};

function emit(tag, obj) {
    console.log(`##${tag}##${JSON.stringify(obj)}`);
}

export default function () {
    const g = GROUP_ADMIN_TEST;
    const token = groupAdminLogin(g);
    if (!token) { console.error('[VerifyGroupAdmin] 集团后台登录失败'); return; }

    // 商户明细：唯一真正按tenantId隔离、可以当权威对比依据的维度
    const tenantResp = getTenantPageList(g, token, START, END, 1, 50);
    const tenantList = (tenantResp && tenantResp.data && tenantResp.data.list) || [];
    for (const row of tenantList) {
        if (TARGET_TENANT_IDS.includes(String(row.tenantId))) {
            emit('TENANT', row);
        }
    }
    console.log(`[VerifyGroupAdmin] 商户明细共${tenantList.length}条，本次目标商户命中${tenantList.filter(r => TARGET_TENANT_IDS.includes(String(r.tenantId))).length}条`);

    // 充值/提现通道汇总：只有sysCurrency，没有tenantId，best-effort参考用，
    // 不当权威依据(见 groupAdminApi.js 顶部注释)
    const rechargeChResp = getRechargeChannelSummaryPageList(g, token, START, END, 1, 50);
    const rechargeChList = (rechargeChResp && rechargeChResp.data && rechargeChResp.data.list) || [];
    for (const row of rechargeChList) emit('RCHANNEL', row);
    console.log(`[VerifyGroupAdmin] 充值通道汇总共${rechargeChList.length}条`);

    const withdrawChResp = getWithdrawChannelSummaryPageList(g, token, START, END, 1, 50);
    const withdrawChList = (withdrawChResp && withdrawChResp.data && withdrawChResp.data.list) || [];
    for (const row of withdrawChList) emit('WCHANNEL', row);
    console.log(`[VerifyGroupAdmin] 提现通道汇总共${withdrawChList.length}条`);

    // 集团充提概览：按币种分组。2026-10-27用户明确这张表是"按天去重、多天
    // 累加"口径，和商户明细/本地统计的"周期内一次性去重"口径不同——不能
    // 用精确容差判定一致/不一致，Runner那边只展示数字供参考，不做强校验。
    const overviewResp = getOverview(g, token, START, END);
    const currencyList = (overviewResp && overviewResp.data && overviewResp.data.currencyList) || [];
    for (const row of currencyList) emit('OVERVIEW', row);
    console.log(`[VerifyGroupAdmin] 集团充提概览共${currencyList.length}个币种`);
}
