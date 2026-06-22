/**
 * libs/monitor/perfMetrics.js
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  统一性能指标注册中心
 *
 *  使用方式（在每个测试文件顶层 import，然后挂载到 options.thresholds）：
 *
 *    import { PERF_METRICS, buildThresholds } from '../../../../libs/monitor/perfMetrics.js';
 *
 *    export const options = {
 *        thresholds: buildThresholds({
 *            errorRateLimit:  0.01,   // 错误率上限（默认 1%）
 *            p95Limit:        500,    // P95 延迟上限 ms（默认 500ms）
 *            abortOnFail:     true,   // 超标时是否自动熔断（默认 true）
 *        }),
 *    };
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Trend, Counter, Rate, Gauge } from 'k6/metrics';

// ─────────────────────────────────────────────────────────────────────────────
// 一、微观 HTTP 分段耗时（与 k6 内置命名一致，供 handleSummary 解析）
//     k6 会自动收集这些内置指标，这里只是导出命名常量以便引用
// ─────────────────────────────────────────────────────────────────────────────
export const BUILTIN_METRICS = {
    /** 总响应时间 */
    DURATION:       'http_req_duration',
    /** TTFB 首字节时间 —— 后端处理性能核心 */
    WAITING:        'http_req_waiting',
    /** TCP 建连时间 */
    CONNECTING:     'http_req_connecting',
    /** TLS 握手时间 */
    TLS_HANDSHAKE:  'http_req_tls_handshaking',
    /** 发送请求耗时 */
    SENDING:        'http_req_sending',
    /** 接收响应耗时 */
    RECEIVING:      'http_req_receiving',
    /** HTTP 失败率（k6 内置） */
    FAILED:         'http_req_failed',
};

// ─────────────────────────────────────────────────────────────────────────────
// 二、业务级 Trend 指标（核心单步业务耗时大盘）
//     每个关键业务动作单独统计，防止快接口掩盖慢接口
// ─────────────────────────────────────────────────────────────────────────────
export const PERF_METRICS = {

    // ── 工单系统 ──────────────────────────────────────────────────────────────
    /** 工单提交（前台触发整体动作）耗时 */
    WORK_ORDER_SUBMIT:   new Trend('trend_work_order_submit',   true),
    /**
     * 工单创建耗时（前台 /api/WorkOrder/Submit 单次 HTTP 往返）
     * 业务语义：用户点击"提交"到服务器返回 code=0 的纯网络+后端时间。
     * 若 P95 > 1s，优先排查工单写库 SQL 或表单字段校验逻辑。
     */
    WORK_ORDER_CREATE:   new Trend('trend_create_work_order',  true),
    /**
     * 工单审批/关闭耗时（后台客服执行 Submit state=4 的 HTTP 往返）
     * 业务语义：客服点关闭/审批到服务器 code=0 的纯网络+后端时间。
     * 若 P95 > 2s，说明工单状态变更写库过慢或触发了后置钩子（如通知）。
     */
    WORK_ORDER_APPROVE:  new Trend('trend_approve_work_order', true),
    /** 客服派发/接单耗时 */
    WORK_ORDER_DISPATCH: new Trend('trend_work_order_dispatch', true),
    /** 客服回复/处理耗时 */
    WORK_ORDER_REPLY:    new Trend('trend_work_order_reply',    true),
    /** 工单查询（列表拉取）耗时 */
    WORK_ORDER_QUERY:    new Trend('trend_work_order_query',    true),

    // ── 合伙人奖励系统 ────────────────────────────────────────────────────────
    /** 用户注册耗时 */
    REGISTER:            new Trend('trend_register',            true),
    /** 充值耗时（单次） */
    RECHARGE:            new Trend('trend_recharge',            true),
    /** 投注耗时（单次） */
    BET:                 new Trend('trend_bet',                 true),
    /** 提现申请耗时 */
    WITHDRAW:            new Trend('trend_withdraw',            true),
    /** 后台审核耗时 */
    WITHDRAW_APPROVAL:   new Trend('trend_withdraw_approval',   true),

    // ── 通用 ──────────────────────────────────────────────────────────────────
    /** 管理员登录耗时 */
    ADMIN_LOGIN:         new Trend('trend_admin_login',         true),
    /** 会员前台登录耗时 */
    MEMBER_LOGIN:        new Trend('trend_member_login',        true),
    /** 文件/图片上传耗时 */
    FILE_UPLOAD:         new Trend('trend_file_upload',         true),
};

// ─────────────────────────────────────────────────────────────────────────────
// 三、业务错误计数器（精确定位"卡在哪一步的哪种错误"）
// ─────────────────────────────────────────────────────────────────────────────
export const ERROR_COUNTERS = {
    // ── 通用业务错误 ──────────────────────────────────────────────────────────
    /** 响应体业务码非 0（如签名失败、余额不足等） */
    BUSINESS_ERROR:      new Counter('err_business'),
    /** HTTP 层面失败（4xx/5xx） */
    HTTP_ERROR:          new Counter('err_http'),
    /** 请求超时（response.timings.duration 超过阈值） */
    TIMEOUT_ERROR:       new Counter('err_timeout'),

    // ── 工单专项错误 ──────────────────────────────────────────────────────────
    /** 工单提交失败（前台） */
    WORK_ORDER_SUBMIT_FAIL:   new Counter('err_work_order_submit'),
    /** 工单审批/关闭失败（后台） */
    WORK_ORDER_APPROVE_FAIL:  new Counter('err_work_order_approve'),
    /** 工单派发/处理失败（后台） */
    WORK_ORDER_PROCESS_FAIL:  new Counter('err_work_order_process'),
    /**
     * 库存不足导致失败（msgCode=xxx，如余额不足/工单类型超限等）
     * 触发条件：业务返回 msgCode=14013（同类型工单进行中）等库存类错误
     */
    INVENTORY_FAIL:      new Counter('err_inventory'),
    /**
     * 数据库锁死/超时导致失败（响应超过 TIMEOUT_MS 且业务码非0）
     * 触发条件：duration>5000ms 且 bizOk=false，推断为 DB 锁或慢查询
     */
    DB_LOCK_FAIL:        new Counter('err_db_lock'),

    // ── 合伙人系统专项错误 ────────────────────────────────────────────────────
    /** 注册失败次数 */
    REGISTER_FAIL:       new Counter('err_register'),
    /** 充值失败次数 */
    RECHARGE_FAIL:       new Counter('err_recharge'),
    /** 投注失败次数 */
    BET_FAIL:            new Counter('err_bet'),
    /** 提现失败次数 */
    WITHDRAW_FAIL:       new Counter('err_withdraw'),
};

// ─────────────────────────────────────────────────────────────────────────────
// 四、业务成功率（Rate 指标，与内置 http_req_failed 区分，用于业务维度成功率）
// ─────────────────────────────────────────────────────────────────────────────
export const SUCCESS_RATES = {
    /** 全局业务成功率 */
    OVERALL:             new Rate('biz_success_rate'),
    /** 工单提交成功率 */
    WORK_ORDER_SUBMIT:   new Rate('biz_work_order_submit_rate'),
    /** 充值成功率 */
    RECHARGE:            new Rate('biz_recharge_rate'),
    /** 注册成功率 */
    REGISTER:            new Rate('biz_register_rate'),
};

// ─────────────────────────────────────────────────────────────────────────────
// 五、实时并发水位（Gauge）
// ─────────────────────────────────────────────────────────────────────────────
export const GAUGES = {
    /** 当前活跃 VU 数（辅助观察真实并发水位） */
    ACTIVE_VUS: new Gauge('gauge_active_vus'),
};

// ─────────────────────────────────────────────────────────────────────────────
// 六、阈值构造器（Thresholds）— 支持自定义熔断参数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 构建 k6 thresholds 配置
 *
 * @param {object} opts
 * @param {number}  [opts.errorRateLimit=0.01]  业务错误率上限（0.01 = 1%）
 * @param {number}  [opts.httpFailLimit=0.01]   HTTP 层失败率上限
 * @param {number}  [opts.p95Limit=500]         所有 Trend 的 P95 上限（ms）
 * @param {number}  [opts.p99Limit=1000]        所有 Trend 的 P99 上限（ms）
 * @param {number}  [opts.ttfbP95Limit=400]     TTFB（http_req_waiting）P95 上限（ms）
 * @param {boolean} [opts.abortOnFail=true]     是否超标即熔断
 * @param {object}  [opts.extra={}]             额外自定义 thresholds（会合并）
 * @returns {object} k6 options.thresholds 对象
 */
export function buildThresholds(opts = {}) {
    const {
        errorRateLimit  = 0.01,
        httpFailLimit   = 0.01,
        p95Limit        = 500,
        p99Limit        = 1000,
        ttfbP95Limit    = 400,
        abortOnFail     = true,
        extra           = {},
    } = opts;

    const abort = abortOnFail ? { abortOnFail: true, delayAbortEval: '10s' } : {};

    // 构建所有 Trend 的 P95/P99 阈值
    const trendThresholds = {};
    const trendNames = [
        'trend_work_order_submit',
        'trend_create_work_order',
        'trend_approve_work_order',
        'trend_work_order_dispatch',
        'trend_work_order_reply',
        'trend_work_order_query',
        'trend_register',
        'trend_recharge',
        'trend_bet',
        'trend_withdraw',
        'trend_withdraw_approval',
        'trend_admin_login',
        'trend_member_login',
        'trend_file_upload',
    ];

    for (const name of trendNames) {
        trendThresholds[name] = [
            { threshold: `p(95)<${p95Limit}`, ...abort },
            { threshold: `p(99)<${p99Limit}` },
        ];
    }

    // ── 调用方追加的额外阈值 ─────────────────────────────────────────────
    const processedExtra = {};
    for (const [key, rules] of Object.entries(extra)) {
        processedExtra[key] = rules.map((rule, idx) => {
            // 为额外规则的第一条追加 abort 逻辑（如果启用了 abort 且规则没自带）
            if (idx === 0 && abort.abortOnFail && rule.abortOnFail === undefined) {
                return { ...rule, ...abort };
            }
            return rule;
        });
    }

    return {
        // ── 内置 HTTP 层阈值 ────────────────────────────────────────────────
        'http_req_failed': [
            { threshold: `rate<${httpFailLimit}`, ...abort },
        ],
        'http_req_duration': [
            { threshold: `p(95)<${p95Limit}`, ...abort },
            { threshold: `p(99)<${p99Limit}` },
        ],
        // TTFB：后端处理性能红线
        'http_req_waiting': [
            { threshold: `p(95)<${ttfbP95Limit}`, ...abort },
        ],

        // ── 业务成功率阈值 ──────────────────────────────────────────────────
        'biz_success_rate': [
            { threshold: `rate>${1 - errorRateLimit}`, ...abort },
        ],
        'biz_work_order_submit_rate': [
            { threshold: `rate>${1 - errorRateLimit}` },
        ],
        'biz_recharge_rate': [
            { threshold: `rate>${1 - errorRateLimit}` },
        ],
        'biz_register_rate': [
            { threshold: `rate>${1 - errorRateLimit}` },
        ],

        // ── 所有自定义业务 Trend 的阈值 ─────────────────────────────────────
        ...trendThresholds,

        // ── 调用方追加的额外阈值 ─────────────────────────────────────────────
        ...processedExtra,
    };
}

/**
 * 工厂：基于预设场景快速获取 thresholds
 *
 * @param {'strict'|'normal'|'relaxed'} preset
 * @param {object} extra 额外追加
 */
export function buildThresholdsByPreset(preset = 'normal', extra = {}) {
    const presets = {
        /** 严格模式：生产环境压测，超标立即熔断 */
        strict: {
            errorRateLimit: 0.005,
            httpFailLimit:  0.005,
            p95Limit:       300,
            p99Limit:       800,
            ttfbP95Limit:   250,
            abortOnFail:    true,
        },
        /** 标准模式：测试环境默认，只标红不熔断 */
        normal: {
            errorRateLimit: 0.01,
            httpFailLimit:  0.01,
            p95Limit:       500,
            p99Limit:       1000,
            ttfbP95Limit:   400,
            abortOnFail:    false,
        },
        /** 宽松模式：开发调试，不熔断，指标极宽 */
        relaxed: {
            errorRateLimit: 0.05,
            httpFailLimit:  0.05,
            p95Limit:       2000,
            p99Limit:       5000,
            ttfbP95Limit:   1500,
            abortOnFail:    false,
        },
    };

    const preset_opts = presets[preset] || presets.normal;
    return buildThresholds({ ...preset_opts, extra });
}
