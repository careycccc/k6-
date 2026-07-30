/**
 * libs/monitor/perfSummary.js
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  增强版 handleSummary 生成器
 *
 *  输出内容：
 *  1. 终端彩色报告（分 HTTP微观 / 业务Trend / 业务成功率 / 错误计数 四节）
 *  2. HTML 可视化报告（使用 k6-reporter）
 *  3. JSON 原始数据（可接入 Grafana / InfluxDB 解析）
 *
 *  使用方式：
 *
 *    import { buildHandleSummary } from '../../../../libs/monitor/perfSummary.js';
 *
 *    export function handleSummary(data) {
 *        return buildHandleSummary(data, {
 *            testName: 'WorkOrderFull',
 *            environment: __ENV.TENANT_ID || '3004',
 *        });
 *    }
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { htmlReport }   from '../vendor/k6-reporter.js';
import { textSummary }  from '../vendor/k6-summary-0.0.1.js';

// ─────────────────────────────────────────────────────────────────────────────
// 辅助：从 data.metrics 中安全取值
// ─────────────────────────────────────────────────────────────────────────────
function safeGet(data, metricName, stat) {
    const m = data.metrics && data.metrics[metricName];
    if (!m || !m.values) return null;
    return m.values[stat] !== undefined ? m.values[stat] : null;
}

function fmtMs(val) {
    if (val === null || val === undefined) return '  -    ';
    return `${val.toFixed(2)}ms`;
}

function fmtRate(val) {
    if (val === null || val === undefined) return '  -  ';
    return `${(val * 100).toFixed(2)}%`;
}

function fmtCount(val) {
    if (val === null || val === undefined) return '-';
    return String(Math.round(val));
}

// ─────────────────────────────────────────────────────────────────────────────
// 构建 ASCII 分析报告（输出到 stdout）
// ─────────────────────────────────────────────────────────────────────────────
function buildTextReport(data, opts) {
    const {
        testName    = 'K6Test',
        environment = 'unknown',
    } = opts;

    const sep   = '═'.repeat(80);
    const line  = '─'.repeat(80);
    const lines = [];

    lines.push('');
    lines.push(sep);
    lines.push(`  📊  性能压测分析报告 | 测试: ${testName} | 环境/租户: ${environment}`);
    lines.push(`  🕐  时间: ${new Date().toISOString()}`);
    lines.push(sep);

    // ── 节一：HTTP 微观分段耗时 ─────────────────────────────────────────────
    lines.push('');
    lines.push('  ┌─ 一、HTTP 微观分段耗时（找瓶颈关键数据）');
    lines.push('  │');

    const httpMetrics = [
        ['http_req_duration',        '🔵 总响应时间   (duration)    '],
        ['http_req_waiting',         '🔴 首字节等待   (TTFB)        '],
        ['http_req_connecting',      '🟡 TCP建连时间  (connecting)  '],
        ['http_req_tls_handshaking', '🟠 TLS握手时间  (tls)         '],
        ['http_req_sending',         '⚪ 发送请求体   (sending)     '],
        ['http_req_receiving',       '⚪ 接收响应体   (receiving)   '],
    ];

    for (const [metric, label] of httpMetrics) {
        const avg = safeGet(data, metric, 'avg');
        const med = safeGet(data, metric, 'med');
        const p90 = safeGet(data, metric, 'p(90)');
        const p95 = safeGet(data, metric, 'p(95)');
        const p99 = safeGet(data, metric, 'p(99)');
        const max = safeGet(data, metric, 'max');

        if (avg === null) continue;

        lines.push(`  │  ${label}`);
        lines.push(
            `  │      avg=${fmtMs(avg)}  med=${fmtMs(med)}  ` +
            `p(90)=${fmtMs(p90)}  p(95)=${fmtMs(p95)}  p(99)=${fmtMs(p99)}  max=${fmtMs(max)}`
        );
        lines.push('  │');
    }

    // TTFB 诊断建议
    const ttfbP95   = safeGet(data, 'http_req_waiting',   'p(95)');
    const totalP95  = safeGet(data, 'http_req_duration',  'p(95)');
    const connP95   = safeGet(data, 'http_req_connecting', 'p(95)');
    const tlsP95    = safeGet(data, 'http_req_tls_handshaking', 'p(95)');

    if (ttfbP95 !== null && totalP95 !== null && totalP95 > 0) {
        const ratio = ttfbP95 / totalP95;
        lines.push('  │  📌 诊断建议：');
        if (ratio > 0.85) {
            lines.push(`  │     🔴 TTFB P95 占总耗时 ${(ratio * 100).toFixed(1)}%，瓶颈在后端！`);
            lines.push('  │        建议：排查慢SQL / 接口CPU占用 / 代码阻塞逻辑');
        } else if (connP95 !== null && tlsP95 !== null && (connP95 + tlsP95) > 100) {
            lines.push(`  │     🟡 建连+TLS P95=${fmtMs(connP95 + tlsP95)}，瓶颈可能在网络层`);
            lines.push('  │        建议：排查带宽饱和 / Nginx连接池 / 服务器TCP队列');
        } else {
            lines.push('  │     🟢 HTTP各阶段时间正常，后端无明显瓶颈');
        }
    }
    lines.push('  └' + line.slice(2));

    // ── 节二：业务级单步耗时（Trend） ──────────────────────────────────────
    const trendMetrics = [
        ['trend_work_order_submit',   '工单提交    (前台触发整体)'],
        ['trend_create_work_order',   '工单创建    (核心网络交互)'],
        ['trend_approve_work_order',  '工单审批    (后台关闭)'],
        ['trend_work_order_dispatch', '工单派发    (客服接单)'],
        ['trend_work_order_reply',    '工单回复    (客服处理)'],
        ['trend_work_order_query',    '工单查询    (列表拉取)'],
        ['trend_register',            '用户注册'],
        ['trend_recharge',            '充值操作    (单次)   '],
        ['trend_bet',                 '投注操作    (单次)   '],
        ['trend_withdraw',            '提现申请'],
        ['trend_withdraw_approval',   '提现审核    (后台)   '],
        ['trend_admin_login',         '管理员登录'],
        ['trend_member_login',        '会员前台登录'],
        ['trend_file_upload',         '文件/图片上传'],
    ];

    const activeTrends = trendMetrics.filter(([name]) => safeGet(data, name, 'count') !== null);

    if (activeTrends.length > 0) {
        lines.push('');
        lines.push('  ┌─ 二、业务单步耗时大盘（快接口 vs 慢接口一目了然）');
        lines.push(`  │  ${'业务操作'.padEnd(22)} ${'avg'.padStart(10)} ${'P(95)'.padStart(10)} ${'P(99)'.padStart(10)} ${'max'.padStart(10)} ${'count'.padStart(7)}`);
        lines.push('  │  ' + '─'.repeat(72));

        for (const [metric, label] of activeTrends) {
            const avg   = safeGet(data, metric, 'avg');
            const p95   = safeGet(data, metric, 'p(95)');
            const p99   = safeGet(data, metric, 'p(99)');
            const max   = safeGet(data, metric, 'max');
            const count = safeGet(data, metric, 'count');

            const p95Flag = p95 !== null && p95 > 500 ? ' ⚠️' : '';
            lines.push(
                `  │  ${label.padEnd(22)} ` +
                `${fmtMs(avg).padStart(10)} ` +
                `${(fmtMs(p95) + p95Flag).padStart(10)} ` +
                `${fmtMs(p99).padStart(10)} ` +
                `${fmtMs(max).padStart(10)} ` +
                `${fmtCount(count).padStart(7)}`
            );
        }
        lines.push('  └' + line.slice(2));
    }

    // ── 节三：业务成功率 ────────────────────────────────────────────────────
    const rateMetrics = [
        ['biz_success_rate',              '整体业务成功率'],
        ['biz_work_order_submit_rate',    '工单提交成功率'],
        ['biz_recharge_rate',             '充值成功率    '],
        ['biz_register_rate',             '注册成功率    '],
        ['Response_success_rate',         '通用响应成功率'],
    ];

    const activeRates = rateMetrics.filter(([name]) => safeGet(data, name, 'rate') !== null);

    if (activeRates.length > 0) {
        lines.push('');
        lines.push('  ┌─ 三、业务成功率看板');
        for (const [metric, label] of activeRates) {
            const rate   = safeGet(data, metric, 'rate');
            const passes = safeGet(data, metric, 'passes');
            const fails  = safeGet(data, metric, 'fails');
            const total  = (passes || 0) + (fails || 0);
            const flag   = rate !== null && rate < 0.99 ? ' ⚠️ 低于99%！' : '';
            lines.push(
                `  │  ${label.padEnd(18)} ${fmtRate(rate).padStart(8)}  (${fmtCount(passes)}/${fmtCount(total)})${flag}`
            );
        }
        lines.push('  └' + line.slice(2));
    }

    // ── 节四：错误计数器 ────────────────────────────────────────────────────
    const errMetrics = [
        ['err_business',            '业务逻辑错误  (msgCode≠0)'],
        ['err_http',                'HTTP层错误    (4xx/5xx)  '],
        ['err_timeout',             '请求超时      (>5s)      '],
        ['err_work_order_submit',   '工单提交失败'],
        ['err_work_order_approve',  '工单审批失败'],
        ['err_work_order_process',  '工单处理失败'],
        ['err_inventory',           '库存不足/超限 (14013等)'],
        ['err_db_lock',             '数据库锁死/慢查'],
        ['err_register',            '注册失败'],
        ['err_recharge',            '充值失败'],
        ['err_bet',                 '投注失败'],
        ['err_withdraw',            '提现失败'],
    ];

    const activeErrs = errMetrics.filter(([name]) => {
        const c = safeGet(data, name, 'count');
        return c !== null && c > 0;
    });

    lines.push('');
    lines.push('  ┌─ 四、错误计数器（只显示有值的项）');
    if (activeErrs.length === 0) {
        lines.push('  │  ✅ 全部指标归零，无明显错误！');
    } else {
        for (const [metric, label] of activeErrs) {
            const count = safeGet(data, metric, 'count');
            const rate  = safeGet(data, metric, 'rate');
            lines.push(
                `  │  ⚠️  ${label.padEnd(28)} count=${fmtCount(count)}` +
                (rate !== null ? `  rate=${fmtRate(rate)}` : '')
            );
        }
    }
    lines.push('  └' + line.slice(2));

    // ── 阈值通过情况 ────────────────────────────────────────────────────────
    const thresholdMet   = [];
    const thresholdBreak = [];
    const thresholds = data.metrics ? Object.keys(data.metrics) : [];
    for (const key of thresholds) {
        const m = data.metrics[key];
        if (!m || !m.thresholds) continue;
        for (const [expr, result] of Object.entries(m.thresholds)) {
            if (result.ok) {
                thresholdMet.push(`${key}: ${expr}`);
            } else {
                thresholdBreak.push(`${key}: ${expr}`);
            }
        }
    }

    if (thresholdBreak.length > 0 || thresholdMet.length > 0) {
        lines.push('');
        lines.push('  ┌─ 五、熔断阈值检查结果');
        if (thresholdBreak.length > 0) {
            lines.push('  │  ❌ 以下阈值触发（可能已自动熔断）:');
            for (const t of thresholdBreak) lines.push(`  │     • ${t}`);
        }
        if (thresholdMet.length > 0) {
            lines.push(`  │  ✅ ${thresholdMet.length} 个阈值全部通过`);
        }
        lines.push('  └' + line.slice(2));
    }

    lines.push('');
    lines.push(sep);
    lines.push('');

    return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 公开入口
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 增强版 handleSummary
 *
 * @param {object} data      k6 传入的 summary data
 * @param {object} opts
 * @param {string} opts.testName      测试名称（用于文件名和报告标题）
 * @param {string} opts.environment   环境/租户标识
 * @param {boolean} [opts.saveJson=true]  是否保存 JSON 原始数据
 * @returns {object} k6 handleSummary 返回格式
 */
export function buildHandleSummary(data, opts = {}) {
    const {
        testName    = 'K6Test',
        environment = __ENV.TENANT_ID || 'unknown',
        saveJson    = true,
    } = opts;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const baseName  = `${testName}-${environment}-${timestamp}`;

    const result = {
        // 终端报告 = k6 默认 textSummary + 自定义性能分析报告
        stdout: textSummary(data, { indent: ' ', enableColors: true }) + buildTextReport(data, opts),

        // HTML 可视化报告
        [`k6/reports/${baseName}.html`]: htmlReport(data, {
            title: `${testName} | 租户 ${environment}`,
        }),
    };

    // JSON 原始数据（可接入 Grafana / 数据平台）
    if (saveJson) {
        result[`k6/reports/${baseName}.json`] = JSON.stringify(data, null, 2);
    }

    return result;
}
