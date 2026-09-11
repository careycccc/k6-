/** 临时排查：查某 userId 的 首充/设备/IP 及同设备、同IP 关联数（判断触发哪条拒绝规则）。用完删。
 *   k6 run -e TENANT_ID=3004 -e UID=166191 auditProbe.js
 */
import { tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { sendRequest } from '../../common/request.js';

export const options = { scenarios: { p: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '3m' } } };

export function setup() {
    const t = tenantAdminLogin(__ENV.TENANT_ID || '3004');
    if (!t) throw new Error('登录失败');
    return { t };
}

function totalCount(res) {
    if (res && res.data && res.data.totalCount != null) return res.data.totalCount;
    if (res && res.totalCount != null) return res.totalCount;
    return '?';
}

export default function (d) {
    const uid = Number(__ENV.UID || '166191');
    const det = sendRequest({ userId: uid }, '/api/Users/GetUserDetail', 'probe', false, d.t);
    const src = det && det.registerSourceRsp ? det.registerSourceRsp : {};
    const dw = det && det.userDepositWithdrawInfo ? det.userDepositWithdrawInfo : {};
    console.log(`##P## uid=${uid} device=[${src.registerDevice}] ip=[${src.registerIp}] firstRechargeTime=${dw.firstRechargeTime}`);

    if (src.registerDevice) {
        const r = sendRequest({ registerDevice: src.registerDevice, userType: [0, 2], pageNo: 1, pageSize: 20, orderBy: 'Desc' }, '/api/Users/GetPageList', 'probe', false, d.t);
        console.log(`##P## 同设备关联数(含自己)=${totalCount(r)}  ← 规则5(≥2即命中)`);
    } else { console.log('##P## 无 registerDevice（空设备也可能被算关联）'); }

    if (src.registerIp) {
        const r2 = sendRequest({ registerIp: src.registerIp, userType: [0, 2], pageNo: 1, pageSize: 20, orderBy: 'Desc' }, '/api/Users/GetPageList', 'probe', false, d.t);
        console.log(`##P## 同IP关联数(含自己)=${totalCount(r2)}  ← 规则4/6(已关，仅参考)`);
    }
    // 最新提现记录详情（看 reason / 本轮邀请数 / 渠道）
    const wr = sendRequest({ userId: uid, startDay: '2026-09-08', endDay: '2026-09-12', pageNo: 1, pageSize: 5, orderBy: 'Desc' }, '/api/InvitedWheel/GetPageListWithdrawRecord', 'probe', false, d.t);
    const list = (wr && wr.data && wr.data.list) ? wr.data.list : (wr && wr.list ? wr.list : []);
    console.log(`##P## 提现记录 ${list.length} 条`);
    list.slice(0, 3).forEach(r => console.log(`##P## 记录 orderNo=${r.orderNo} auditState=${r.auditState}(${r.auditStateName}) reason=[${r.reason}] 本轮邀请=${r.invitedUserCount} 累计=${r.totalInvitedUserCount} 金额=${r.withdrawAmount} 轮次号=${r.invitedWheelRoundNum} 渠道=${r.packageName}`));
}
