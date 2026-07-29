/**
 * 三方成功率 数据源认证
 *
 * 口径（与你确认）：
 *   1. /api/RechargeChannel/GetPageList  取 state===1 的通道 channelId
 *   2. 逐个 /api/RechargeChannel/GetSucessRate 取近 1 日成功率 day1Rate
 *   3. 只保留当天有充值发生(day1Count>0)的通道
 *   4. 平均通道率 = Σday1Rate ÷ 有活动的通道数
 *   5. 与报表 thirdPartySuccessRate 对比
 */
import { getRechargeChannels, getChannelSuccessRate, getRealTimeSnapshotReport } from './rptDashboardApi.js';

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nowHHMM() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 计算平均通道成功率（数据源真值） */
export function computeThirdPartyAvgRate(token) {
    const channels = getRechargeChannels(token);
    if (!channels) return null;

    const rows = [];
    for (const ch of channels) {
        const sr = getChannelSuccessRate(token, ch.channelId);
        rows.push({
            channelId: ch.channelId,
            name: ch.name,
            day1Rate:  sr ? (Number(sr.day1Rate)  || 0) : 0,
            day1Count: sr ? (Number(sr.day1Count) || 0) : 0,
        });
    }

    // 只算当天有成功率(有充值发生)的通道
    const active = rows.filter(r => r.day1Count > 0);
    const sum = active.reduce((a, r) => a + r.day1Rate, 0);
    const avgRate = active.length ? sum / active.length : 0;

    return { avgRate, activeCount: active.length, totalChannels: rows.length, rows, active };
}

/**
 * 三方成功率认证：数据源平均通道率  vs  报表当前最新时间节点的 thirdPartySuccessRate（同单位直接比）
 * @returns {object|null} { avgRate, reportRate, reportTimeNode, diff, ok, tol, src }
 */
export function verifyThirdPartyRate(token, date, tol = 0.01) {
    const src = computeThirdPartyAvgRate(token);
    if (!src) return null;

    const report = getRealTimeSnapshotReport(token, date);
    if (!report || !Array.isArray(report.list)) return null;

    // 当前最新时间节点：今天以当前时刻为界，历史日期取全天最后一个节点
    const cutoff = (date === todayStr()) ? nowHHMM() : '23:59';
    let latest = null;
    report.list.forEach(node => {
        if (node.timeNode > cutoff) return;                       // 跳过未来节点
        const cell = (node.cells || []).find(c => c.date === date) || (node.cells || [])[0];
        if (!cell || cell.thirdPartySuccessRate == null) return;
        if (!latest || node.timeNode > latest.timeNode) {
            latest = { timeNode: node.timeNode, rate: Number(cell.thirdPartySuccessRate) || 0 };
        }
    });

    const reportRate = latest ? latest.rate : 0;
    const diff = Math.abs(src.avgRate - reportRate);
    return {
        avgRate: src.avgRate,
        reportRate,
        reportTimeNode: latest ? latest.timeNode : null,
        diff,
        ok: diff <= tol,
        tol,
        src,
    };
}
