/**
 * libs/monitor/perfWrapper.js
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  HTTP 请求计时包装器
 *
 *  核心功能：
 *  1. 自动把单次 HTTP 响应的微观分段时间（TTFB / 建连 / TLS / 收发）
 *     写入对应 Trend 指标
 *  2. 根据 HTTP 状态码 + 业务码自动归类错误计数器
 *  3. 提供 measureAsync() 语法糖：wrap 任意业务函数并计时
 *
 *  使用方式：
 *
 *    // 方式一：包装整个业务动作（推荐）
 *    const result = measure(PERF_METRICS.WORK_ORDER_SUBMIT, () => {
 *        return sendRequest(payload, '/api/WorkOrder/Submit', TAG, true, token);
 *    });
 *
 *    // 方式二：直接记录已有的 k6 response 对象
 *    const res = httpClient.post(...);
 *    recordResponse(res, PERF_METRICS.WORK_ORDER_SUBMIT, {
 *        label: 'work_order_submit',
 *        successCheck: (r) => r && r.msgCode === 0,
 *        errorCounter: ERROR_COUNTERS.WORK_ORDER_SUBMIT_FAIL,
 *    });
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { ERROR_COUNTERS, SUCCESS_RATES } from './perfMetrics.js';
import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// 超时判定阈值（ms）。单次请求超过此值即计入 err_timeout
// ─────────────────────────────────────────────────────────────────────────────
const TIMEOUT_THRESHOLD_MS = parseInt(__ENV.TIMEOUT_THRESHOLD_MS || '5000', 10);

// ─────────────────────────────────────────────────────────────────────────────
// 核心：从 k6 原生 response 对象中解析微观计时指标
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 从 k6 response.timings 中提取全部分段指标并记录到对应 Trend。
 *
 * k6 内置的 response.timings：
 *   blocked     — 队列等待（连接池排队）
 *   looking_up  — DNS 解析
 *   connecting  — TCP 建连
 *   tls_handshaking — TLS 握手
 *   sending     — 发送请求体
 *   waiting     — TTFB（首字节等待，后端处理时间）
 *   receiving   — 接收响应体
 *   duration    — 总耗时
 *
 * @param {object} response   k6 http.Response 对象
 * @param {object} trendObj   PERF_METRICS 中的某个 Trend 对象（记录总 duration）
 * @param {object} [opts]
 * @param {string} [opts.label]          日志前缀
 * @param {function} [opts.successCheck] 判定业务成功的函数 (parsedBody) => bool
 * @param {object} [opts.errorCounter]   失败时额外递增的 Counter
 * @param {boolean} [opts.silent=false]  是否静默（不打印警告日志）
 * @returns {{ ok: boolean, timings: object, body: object|null }}
 */
export function recordResponse(response, trendObj, opts = {}) {
    const {
        label         = '',
        successCheck  = null,
        errorCounter  = null,
        silent        = false,
    } = opts;

    const tag = label ? `[${label}]` : '';

    // ── 1. 防御：response 为空 ────────────────────────────────────────────────
    if (!response) {
        ERROR_COUNTERS.HTTP_ERROR.add(1);
        if (errorCounter) errorCounter.add(1);
        SUCCESS_RATES.OVERALL.add(false);
        if (!silent) logger.error(`${tag} response 为空，HTTP请求彻底失败`);
        return { ok: false, timings: {}, body: null };
    }

    // ── 2. 解析 timings ───────────────────────────────────────────────────────
    const t = response.timings || {};
    const timings = {
        duration:        t.duration        || 0,
        waiting:         t.waiting         || 0,   // TTFB
        connecting:      t.connecting      || 0,
        tls_handshaking: t.tls_handshaking || 0,
        sending:         t.sending         || 0,
        receiving:       t.receiving       || 0,
        blocked:         t.blocked         || 0,
    };

    // ── 3. 写入业务 Trend（总耗时） ───────────────────────────────────────────
    if (trendObj && typeof trendObj.add === 'function') {
        trendObj.add(timings.duration);
    }

    // ── 4. 超时检测 ───────────────────────────────────────────────────────────
    if (timings.duration > TIMEOUT_THRESHOLD_MS) {
        ERROR_COUNTERS.TIMEOUT_ERROR.add(1);
        if (!silent) {
            logger.warn(
                `${tag} ⚠️ 请求超时！duration=${timings.duration}ms > 阈值${TIMEOUT_THRESHOLD_MS}ms` +
                ` | TTFB=${timings.waiting}ms | connecting=${timings.connecting}ms`
            );
        }
    }

    // ── 5. HTTP 层错误检测 ────────────────────────────────────────────────────
    const httpOk = response.status >= 200 && response.status < 300;
    if (!httpOk) {
        ERROR_COUNTERS.HTTP_ERROR.add(1);
        if (errorCounter) errorCounter.add(1);
        SUCCESS_RATES.OVERALL.add(false);
        if (!silent) {
            logger.error(`${tag} HTTP错误 status=${response.status} | TTFB=${timings.waiting}ms`);
        }
        _logTimingBreakdown(tag, timings, silent);
        return { ok: false, timings, body: null };
    }

    // ── 6. 解析响应体 ─────────────────────────────────────────────────────────
    let body = null;
    if (response.body) {
        try {
            body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
        } catch (e) {
            ERROR_COUNTERS.BUSINESS_ERROR.add(1);
            if (errorCounter) errorCounter.add(1);
            SUCCESS_RATES.OVERALL.add(false);
            if (!silent) logger.error(`${tag} 响应体解析失败: ${e.message}`);
            return { ok: false, timings, body: null };
        }
    }

    // ── 7. 业务逻辑成功检测 ───────────────────────────────────────────────────
    let bizOk = true;
    if (successCheck) {
        bizOk = successCheck(body);
    } else if (body !== null) {
        // 默认：msgCode === 0 视为成功
        bizOk = body.msgCode === 0 || body.code === 0;
    }

    if (!bizOk) {
        ERROR_COUNTERS.BUSINESS_ERROR.add(1);
        if (errorCounter) errorCounter.add(1);
        SUCCESS_RATES.OVERALL.add(false);
        if (!silent) {
            logger.warn(
                `${tag} 业务错误 msgCode=${body ? (body.msgCode ?? body.code) : 'N/A'}` +
                ` msg="${body ? body.msg : ''}"` +
                ` | TTFB=${timings.waiting}ms | total=${timings.duration}ms`
            );
        }
        _logTimingBreakdown(tag, timings, silent);
        return { ok: false, timings, body };
    }

    SUCCESS_RATES.OVERALL.add(true);

    // ── 8. 打印性能分解（仅当有显著值时） ────────────────────────────────────
    if (!silent && (timings.connecting > 50 || timings.tls_handshaking > 50 || timings.waiting > 300)) {
        _logTimingBreakdown(tag, timings, false);
    }

    return { ok: true, timings, body };
}

/**
 * 包装任意返回 k6 response 的业务函数并自动计时。
 *
 * @param {object}   trendObj  PERF_METRICS 中的某个 Trend 对象
 * @param {function} fn        执行函数，需返回 k6 response 或 null
 * @param {object}   [opts]    同 recordResponse opts
 * @returns {{ ok: boolean, timings: object, body: object|null, raw: any }}
 */
export function measure(trendObj, fn, opts = {}) {
    let raw;
    try {
        raw = fn();
    } catch (err) {
        ERROR_COUNTERS.HTTP_ERROR.add(1);
        if (opts.errorCounter) opts.errorCounter.add(1);
        SUCCESS_RATES.OVERALL.add(false);
        logger.error(`${opts.label ? '[' + opts.label + '] ' : ''}执行异常: ${err.message || err}`);
        return { ok: false, timings: {}, body: null, raw: null };
    }

    // 如果返回的是 k6 原生 response（含 timings），走完整分析
    if (raw && raw.timings) {
        const result = recordResponse(raw, trendObj, opts);
        return { ...result, raw };
    }

    // 返回的是业务层封装结果（如 sendRequest 返回 parsedBody）
    // 此时没有 timings，只能判断业务成功与否
    const bizOk = opts.successCheck ? opts.successCheck(raw) : (raw !== null && raw !== undefined);
    SUCCESS_RATES.OVERALL.add(bizOk);
    if (!bizOk && opts.errorCounter) opts.errorCounter.add(1);
    return { ok: bizOk, timings: {}, body: raw, raw };
}

// ─────────────────────────────────────────────────────────────────────────────
// 内部工具：打印时间分解日志
// ─────────────────────────────────────────────────────────────────────────────
function _logTimingBreakdown(tag, t, silent) {
    if (silent) return;
    logger.info(
        `${tag} ⏱ 耗时分解` +
        ` | 总=${t.duration.toFixed(0)}ms` +
        ` | TTFB=${t.waiting.toFixed(0)}ms` +
        ` | 建连=${t.connecting.toFixed(0)}ms` +
        ` | TLS=${t.tls_handshaking.toFixed(0)}ms` +
        ` | 发送=${t.sending.toFixed(0)}ms` +
        ` | 接收=${t.receiving.toFixed(0)}ms`
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 辅助：解析诊断 TTFB 瓶颈
//
// 调用示例：
//   diagnoseTiming(timings, 'work_order_submit');
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 根据单次请求 timings 输出诊断建议
 * @param {object} timings  recordResponse 返回的 timings 对象
 * @param {string} label    操作名称
 */
export function diagnoseTiming(timings, label = '') {
    const { duration = 0, waiting = 0, connecting = 0, tls_handshaking = 0 } = timings;
    if (duration === 0) return;

    const tag = label ? `[诊断:${label}]` : '[诊断]';
    const ttfbRatio = waiting / duration;
    const connRatio = (connecting + tls_handshaking) / duration;

    if (ttfbRatio > 0.85) {
        logger.warn(
            `${tag} 🔴 瓶颈在后端！TTFB占总时间 ${(ttfbRatio * 100).toFixed(1)}%` +
            ` (${waiting.toFixed(0)}ms/${duration.toFixed(0)}ms)` +
            ` → 排查：慢SQL / CPU飙升 / 代码阻塞`
        );
    } else if (connRatio > 0.30) {
        logger.warn(
            `${tag} 🟡 瓶颈在网络层！建连+TLS占 ${(connRatio * 100).toFixed(1)}%` +
            ` (建连${connecting.toFixed(0)}ms + TLS${tls_handshaking.toFixed(0)}ms)` +
            ` → 排查：带宽打满 / Nginx连接池 / TCP队列积压`
        );
    }
}
