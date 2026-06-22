/**
 * libs/monitor/perfIntegration.js
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  通用性能监控中间层（Universal Perf Bridge）
 *
 *  解决的核心问题：
 *    sendRequest / sendQueryRequest / signAndPost 都是在 testCommonRequest
 *    内部解析了 k6 原生 response，只把业务数据往外传，导致 TTFB / 建连 /
 *    TLS 等微观计时数据在传出来之前就丢失了。
 *
 *    本模块提供一个"探针包装器"，在原有调用链之外，通过直接访问
 *    httpClient 获得原始 response，再把微观指标写入监控中心。
 *    业务代码只需要额外传入一个可选的 trendObj 即可。
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  一、自动采集（每次请求都会做，无需业务代码操心）
 *    ✓ http_req_duration   总响应时间
 *    ✓ http_req_waiting    TTFB 首字节等待（后端性能核心）
 *    ✓ http_req_connecting TCP 建连时间
 *    ✓ http_req_tls_handshaking  TLS 握手时间
 *    ✓ http_req_sending / http_req_receiving 收发时间
 *    ✓ err_http / err_timeout / err_business 自动计数
 *    ✓ biz_success_rate 全局业务成功率
 *
 *  二、业务特化（业务代码自己传入）
 *    ✓ trendObj —— PERF_METRICS.WORK_ORDER_SUBMIT 等，只有该接口才写入
 *    ✓ errorCounter —— ERROR_COUNTERS.WORK_ORDER_SUBMIT_FAIL 等
 *    ✓ successCheck —— 自定义业务成功判断函数
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  使用示例（业务代码）：
 *
 *    // 1. 最简用法：只记录通用微观指标，不记录业务 Trend
 *    const result = monitoredPost(payload, '/api/WorkOrder/Submit', TAG, true, token);
 *    // result.ok / result.body / result.timings
 *
 *    // 2. 带业务 Trend：工单提交单独统计耗时
 *    const result = monitoredPost(
 *        payload,
 *        '/api/WorkOrder/Submit',
 *        TAG,
 *        true,
 *        token,
 *        {
 *            trendObj:     PERF_METRICS.WORK_ORDER_SUBMIT,
 *            errorCounter: ERROR_COUNTERS.WORK_ORDER_SUBMIT_FAIL,
 *        }
 *    );
 *
 *    // 3. 包装现有 sendRequest（不修改 sendRequest 函数本身）
 *    const body = monitoredSendRequest(
 *        payload, '/api/WorkOrder/Submit', TAG, true, token,
 *        { trendObj: PERF_METRICS.WORK_ORDER_SUBMIT }
 *    );
 *    // body 同 sendRequest 的返回值，向后兼容
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { httpClient }              from '../http/client.js';
import { getTimeRandom }           from '../../tests/utils/utils.js';
import { ENV_CONFIG }              from '../../config/envconfig.js';
import { logger }                  from '../utils/logger.js';
import { ERROR_COUNTERS, SUCCESS_RATES } from './perfMetrics.js';

// ─────────────────────────────────────────────────────────────────────────────
// 超时阈值（可通过环境变量覆盖）
// ─────────────────────────────────────────────────────────────────────────────
const TIMEOUT_MS = parseInt(__ENV.TIMEOUT_THRESHOLD_MS || '5000', 10);

// ─────────────────────────────────────────────────────────────────────────────
// 核心：解析 k6 原生 response，写入所有通用指标
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 解析 k6 原生 response 对象，完成：
 *   1. 提取所有微观计时
 *   2. 写入业务 Trend（如果传了 trendObj）
 *   3. 超时 / HTTP错误 / 业务错误 计数
 *   4. 全局成功率更新
 *   5. 返回解析后的业务 body
 *
 * @param {object} response       k6 原生 http.Response
 * @param {object} [opts]
 * @param {object} [opts.trendObj]       业务级 Trend（PERF_METRICS 中的某个）
 * @param {object} [opts.errorCounter]   业务级失败计数器
 * @param {function} [opts.successCheck] (parsedBody) => bool，默认 msgCode===0
 * @param {string}  [opts.label]         日志前缀
 * @param {boolean} [opts.silent]        是否静默
 * @returns {{ ok: boolean, timings: object, body: object|null }}
 */
function _analyzeResponse(response, opts = {}) {
    const {
        trendObj      = null,
        errorCounter  = null,
        successCheck  = null,
        label         = '',
        silent        = false,
    } = opts;

    const tag = label ? `[${label}]` : '';

    // ── 1. 防御：response 为空 ─────────────────────────────────────────────
    if (!response) {
        ERROR_COUNTERS.HTTP_ERROR.add(1);
        if (errorCounter) errorCounter.add(1);
        SUCCESS_RATES.OVERALL.add(false);
        if (!silent) logger.error(`${tag} response 为空，请求彻底失败`);
        return { ok: false, timings: {}, body: null };
    }

    // ── 2. 提取微观计时（k6 内置，自动写入 http_req_* 系列指标） ──────────
    // 注意：k6 内置指标（http_req_waiting 等）是 k6 引擎自动记录的，
    // 无需手动 add。这里只是读出来供业务 Trend 和日志使用。
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

    // ── 3. 写入业务 Trend（该接口独有的耗时统计） ─────────────────────────
    if (trendObj && typeof trendObj.add === 'function') {
        trendObj.add(timings.duration);
    }

    // ── 4. 超时检测 ────────────────────────────────────────────────────────
    if (timings.duration > TIMEOUT_MS) {
        ERROR_COUNTERS.TIMEOUT_ERROR.add(1);
        if (!silent) {
            logger.warn(
                `${tag} ⚠️ 请求超时 duration=${timings.duration}ms > ${TIMEOUT_MS}ms` +
                ` | TTFB=${timings.waiting}ms | 建连=${timings.connecting}ms`
            );
        }
    }

    // ── 5. HTTP 层错误 ─────────────────────────────────────────────────────
    const httpOk = response.status >= 200 && response.status < 300;
    if (!httpOk) {
        ERROR_COUNTERS.HTTP_ERROR.add(1);
        if (errorCounter) errorCounter.add(1);
        SUCCESS_RATES.OVERALL.add(false);
        if (!silent) {
            logger.error(
                `${tag} HTTP错误 status=${response.status}` +
                ` | TTFB=${timings.waiting}ms | 总=${timings.duration}ms`
            );
        }
        _logBreakdown(tag, timings, silent);
        return { ok: false, timings, body: null };
    }

    // ── 6. 解析响应体 ──────────────────────────────────────────────────────
    let body = null;
    if (response.body) {
        try {
            body = typeof response.body === 'string'
                ? JSON.parse(response.body)
                : response.body;
        } catch (e) {
            ERROR_COUNTERS.BUSINESS_ERROR.add(1);
            if (errorCounter) errorCounter.add(1);
            SUCCESS_RATES.OVERALL.add(false);
            if (!silent) logger.error(`${tag} 响应体解析失败: ${e.message}`);
            return { ok: false, timings, body: null };
        }
    }

    // ── 7. 业务成功检测 ────────────────────────────────────────────────────
    let bizOk = true;
    if (successCheck) {
        bizOk = successCheck(body);
    } else if (body !== null) {
        // 默认：msgCode===0 或 code===0 视为成功
        bizOk = body.msgCode === 0 || body.code === 0;
    }

    if (!bizOk) {
        ERROR_COUNTERS.BUSINESS_ERROR.add(1);
        if (errorCounter) errorCounter.add(1);
        SUCCESS_RATES.OVERALL.add(false);
        if (!silent) {
            logger.warn(
                `${tag} 业务错误 msgCode=${body ? (body.msgCode ?? body.code) : 'N/A'}` +
                ` msg="${body ? (body.msg || '') : ''}"` +
                ` | TTFB=${timings.waiting}ms | 总=${timings.duration}ms`
            );
        }
        _logBreakdown(tag, timings, silent);
        return { ok: false, timings, body };
    }

    SUCCESS_RATES.OVERALL.add(true);

    // ── 8. 性能预警日志（显著值才打印，减少噪音） ─────────────────────────
    if (!silent && (timings.waiting > 500 || timings.connecting > 100 || timings.tls_handshaking > 100)) {
        _logBreakdown(tag, timings, false);
    }

    return { ok: true, timings, body };
}

// ─────────────────────────────────────────────────────────────────────────────
// 内部：打印耗时分解日志
// ─────────────────────────────────────────────────────────────────────────────
function _logBreakdown(tag, t, silent) {
    if (silent || !t.duration) return;
    logger.info(
        `${tag} ⏱ 耗时分解` +
        ` 总=${t.duration.toFixed(0)}ms` +
        ` TTFB=${t.waiting.toFixed(0)}ms` +
        ` 建连=${t.connecting.toFixed(0)}ms` +
        ` TLS=${t.tls_handshaking.toFixed(0)}ms` +
        ` 发=${t.sending.toFixed(0)}ms` +
        ` 收=${t.receiving.toFixed(0)}ms`
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 公开 API 1：monitoredPost
//   直接发起 POST，获取原生 response，完成全量监控，返回完整结果对象
//
//   注意：内部通过 httpClient 直接发请求，不经过 sendRequest，
//   因此不会丢失 timings。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 带全量监控的 POST 请求
 *
 * @param {object}  payload     请求体（会自动加 random/timestamp/signature）
 * @param {string}  api         接口路径，如 '/api/WorkOrder/Submit'
 * @param {string}  tag         日志标签
 * @param {boolean} isDesk      true=前台 false=后台
 * @param {string}  token       Bearer token
 * @param {object}  [monOpts]   监控选项
 * @param {object}  [monOpts.trendObj]      业务级 Trend（PERF_METRICS.XXX）
 * @param {object}  [monOpts.errorCounter]  业务级错误计数器
 * @param {function}[monOpts.successCheck]  (body) => bool
 * @param {boolean} [monOpts.silent]        是否静默
 * @returns {{ ok: boolean, timings: object, body: object|null, raw: object }}
 */
export function monitoredPost(payload, api, tag, isDesk = true, token = '', monOpts = {}) {
    const timeData = getTimeRandom();
    const data = {
        random:    timeData.random,
        language:  timeData.language,
        signature: '',
        timestamp: timeData.timestamp,
        ...payload,
    };

    // 设置 token
    if (token) {
        httpClient.setAuthToken(token);
    } else {
        httpClient.setAuthToken('');
    }

    let raw;
    try {
        raw = httpClient.post(api, data, {}, isDesk);
    } catch (err) {
        ERROR_COUNTERS.HTTP_ERROR.add(1);
        if (monOpts.errorCounter) monOpts.errorCounter.add(1);
        SUCCESS_RATES.OVERALL.add(false);
        logger.error(`[${tag}] 请求异常: ${err.message || err}`);
        return { ok: false, timings: {}, body: null, raw: null };
    }

    const result = _analyzeResponse(raw, { label: tag, ...monOpts });
    return { ...result, raw };
}

// ─────────────────────────────────────────────────────────────────────────────
// 公开 API 2：monitoredQuery
//   等价于 sendQueryRequest + 监控，返回业务 body（向后兼容）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 带全量监控的查询 POST（自动加分页默认参数）
 *
 * @param {object}  payload
 * @param {string}  api
 * @param {string}  tag
 * @param {boolean} isDesk
 * @param {string}  token
 * @param {object}  [monOpts]
 * @returns {{ ok: boolean, timings: object, body: object|null, raw: object }}
 */
export function monitoredQuery(payload, api, tag, isDesk = false, token = '', monOpts = {}) {
    return monitoredPost(
        {
            pageNo:  ENV_CONFIG.PAGENO,
            pageSize: ENV_CONFIG.PAGESIZE,
            orderBy: 'Desc',
            ...payload,
        },
        api,
        tag,
        isDesk,
        token,
        monOpts
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 公开 API 3：monitoredSendRequest
//   包装现有 sendRequest，返回值与 sendRequest 完全相同（向后兼容）
//   同时完成所有监控采集。
//
//   迁移方式：将 sendRequest(...) 替换为 monitoredSendRequest(..., monOpts)
//   不需要修改任何其他代码。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 兼容 sendRequest 签名的监控版本
 *
 * 返回值与原 sendRequest 完全一致（业务 data / token 字符串），
 * 额外完成了所有通用微观指标的采集。
 *
 * @param {object}  payload
 * @param {string}  api
 * @param {string}  tag
 * @param {boolean} isDesk
 * @param {string}  token
 * @param {object}  [monOpts]   监控选项（trendObj / errorCounter / successCheck）
 * @returns {any}  同原 sendRequest 返回值（data / token / result）
 */
export function monitoredSendRequest(payload, api, tag, isDesk, token, monOpts = {}) {
    const { body } = monitoredPost(payload, api, tag, isDesk, token, monOpts);
    // 模拟 sendRequest 的返回逻辑：token > data > body
    if (body && body.data && body.data.token) return body.data.token;
    if (body && body.data !== undefined)       return body.data;
    return body;
}

/**
 * 兼容 sendQueryRequest 签名的监控版本
 *
 * @param {object}  payload
 * @param {string}  api
 * @param {string}  tag
 * @param {boolean} isDesk
 * @param {string}  token
 * @param {object}  [monOpts]
 * @returns {any}
 */
export function monitoredQueryRequest(payload, api, tag, isDesk, token, monOpts = {}) {
    const { body } = monitoredQuery(payload, api, tag, isDesk, token, monOpts);
    if (body && body.data && body.data.token) return body.data.token;
    if (body && body.data !== undefined)       return body.data;
    return body;
}

// ─────────────────────────────────────────────────────────────────────────────
// 公开 API 4：probeResponse
//   用于已经拿到原生 response 对象的场景（如 signAndPost 的调用者）
//   直接传入 raw response，触发全量监控分析。
//
//   使用场景：
//     const raw = httpClient.post(...);
//     const result = probeResponse(raw, TAG, { trendObj: PERF_METRICS.WORK_ORDER_REPLY });
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 对已有的原生 k6 response 进行监控分析
 *
 * @param {object} rawResponse  k6 http.Response 对象（含 .timings）
 * @param {string} tag          日志标签
 * @param {object} [monOpts]    同 _analyzeResponse opts
 * @returns {{ ok: boolean, timings: object, body: object|null }}
 */
export function probeResponse(rawResponse, tag, monOpts = {}) {
    return _analyzeResponse(rawResponse, { label: tag, ...monOpts });
}

// ─────────────────────────────────────────────────────────────────────────────
// 公开 API 5：createMonitoredAction
//   工厂函数：为某个特定业务动作创建一个"已绑定监控配置"的执行函数。
//   适合在模块顶部声明，在 default function 中直接调用。
//
//   示例（在测试文件顶部）：
//     const submitOrder = createMonitoredAction({
//         trendObj:     PERF_METRICS.WORK_ORDER_SUBMIT,
//         errorCounter: ERROR_COUNTERS.WORK_ORDER_SUBMIT_FAIL,
//         successCheck: (b) => b && b.code === 0,
//         label:        'WorkOrderSubmit',
//     });
//
//   在 default function 中：
//     const result = submitOrder(payload, '/api/WorkOrder/Submit', true, memberToken);
//     if (result.ok) { ... }
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 工厂：创建一个预绑定了监控配置的 POST 动作函数
 *
 * @param {object} monOpts   监控配置（trendObj / errorCounter / successCheck / label / silent）
 * @returns {function} (payload, api, isDesk, token) => { ok, timings, body, raw }
 */
export function createMonitoredAction(monOpts = {}) {
    return function monitoredAction(payload, api, isDesk = true, token = '') {
        return monitoredPost(payload, api, monOpts.label || 'Action', isDesk, token, monOpts);
    };
}
