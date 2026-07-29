/**
 * 实时数据统计报表 API 封装
 *
 * ⚠️ 关键：这两个接口的签名口径是「只对标量字段签名，数组/对象字段(snapshotTypes/dateList)一律剔除」，
 * 已用真实抓包样本离线验证（与 WorkOrder/Submit 的 formFields、guestRegister 的 eventIdentity 同套路）。
 * 因此不能用标准 sendRequest（会把数组签进去），这里自定义签名后用 httpClient(sign:false) 发送。
 */
import { httpClient } from '../../../libs/http/client.js';
import { SignatureUtil } from '../../../libs/utils/signature.js';
import { getTimeRandom } from '../../utils/utils.js';

export const rptTag = 'rptDashboard';

/** 只对标量字段计算签名（剔除数组/对象/空值），复刻后端口径 */
function signScalarOnly(payload) {
    const scalar = {};
    for (const k in payload) {
        const v = payload[k];
        if (v === null || v === undefined || v === '') continue;
        if (Array.isArray(v) || typeof v === 'object') continue; // 剔除数组/对象
        scalar[k] = v;
    }
    return SignatureUtil.calculateSignature(scalar, '');
}

/** 后台 POST（带自定义签名） */
function postSigned(api, payload, token) {
    const t = getTimeRandom();
    const full = { random: t.random, language: 'zh', ...payload };
    full.signature = signScalarOnly(full);              // 先签(此时无 signature/timestamp)
    full.timestamp = Math.floor(Date.now() / 1000);

    httpClient.setAuthToken(token);
    const res = httpClient.post(api, full, { sign: false, params: { tags: { type: rptTag, name: api } } }, false); // isDesk=false → 后台

    let parsed = null;
    try { parsed = typeof res.body === 'string' ? JSON.parse(res.body) : res.body; } catch (e) { /* 非JSON */ }
    return { res, parsed };
}

/**
 * 第一步：按 snapshotType 的时间序列快照
 * @returns {Array|null} [{ snapshotDate, snapshotType, snapshotData:[{snapshotTime, snapshotNum}] }, ...]
 */
export function getRecordSnapshotList(token, date, snapshotTypes) {
    const { parsed } = postSigned('/api/RptDashBoard/GetRecordSnapshotList', { snapshotTypes, dateList: [date] }, token);
    if (parsed && parsed.code === 0 && Array.isArray(parsed.data)) return parsed.data;
    console.error(`[${rptTag}] GetRecordSnapshotList 失败: ${parsed ? JSON.stringify(parsed).slice(0, 200) : '无响应'}`);
    return null;
}

/**
 * 第二步：实时数据统计报表（按时间节点）
 * @returns {object|null} { list:[{ timeNode, cells:[{date, registerCount, ...}] }], summary, ... }
 */
export function getRealTimeSnapshotReport(token, date) {
    const { parsed } = postSigned('/api/RptDashBoard/GetRealTimeSnapshotReport', { dateList: [date], pageNo: 1, pageSize: 2000, orderBy: 2 }, token);
    if (parsed && parsed.code === 0 && parsed.data && Array.isArray(parsed.data.list)) return parsed.data;
    console.error(`[${rptTag}] GetRealTimeSnapshotReport 失败: ${parsed ? JSON.stringify(parsed).slice(0, 200) : '无响应'}`);
    return null;
}

/**
 * 三方成功率数据源 —— 第一步：充值通道列表（只取 state===1）
 * @returns {Array|null} [{ channelId, name }, ...]
 */
export function getRechargeChannels(token) {
    const { parsed } = postSigned('/api/RechargeChannel/GetPageList',
        { sortField: 'id', orderBy: 'Desc', pageNo: 1, pageSize: 200 }, token);
    if (parsed && parsed.code === 0 && parsed.data && Array.isArray(parsed.data.list)) {
        return parsed.data.list
            .filter(c => c.state === 1)
            .map(c => ({ channelId: c.channelId, name: c.name }));
    }
    console.error(`[${rptTag}] GetPageList(充值通道) 失败: ${parsed ? JSON.stringify(parsed).slice(0, 200) : '无响应'}`);
    return null;
}

/**
 * 三方成功率数据源 —— 第二步：单通道成功率
 * @returns {object|null} { day1Rate, day1Count, day1Amount, day3Rate, day3Count, day3Amount }
 */
export function getChannelSuccessRate(token, channelId) {
    const { parsed } = postSigned('/api/RechargeChannel/GetSucessRate', { channelId }, token);
    if (parsed && parsed.code === 0 && parsed.data) return parsed.data;
    console.error(`[${rptTag}] GetSucessRate(channelId=${channelId}) 失败: ${parsed ? JSON.stringify(parsed).slice(0, 200) : '无响应'}`);
    return null;
}
