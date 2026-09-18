/**
 * 充值拉单黑名单（拉单监控）风控验证 —— k6 脚本
 *
 * 真实规则（后台实测，已对齐）：
 *   1) 触发口径：单日「累计未支付订单数 > 阈值(默认5，即 ≥6)」。
 *      未支付 = Wait(待处理) + 待审核(PendingReview) + Cancel(超时取消) 等所有非 Payed；已支付 = Payed。
 *      累计未支付 = pullOrderCount(当日累计发起数,只增不减) - paidOrderCount(已支付数)；计数以后台报表为准。
 *   2) 超时取消：Wait 订单后台约 5 分钟自动转 Cancel，但 Cancel 仍算未支付 → 未支付数不降、不抵消触发。
 *   3) 检测机制：后台每 10 分钟轮询一次；轮询到才在 /api/RechargePullMonitor/GetPageList 出现记录，并持续刷新当天数据。
 *   4) 两阶段：进表 = 已风控(监控中)，但只有 SetLimitTime 设了 limitStartTime 后前台才正式被拦；未设限可【无限发】。
 *   5) 前台被拦判定：/api/Recharge/GoodsDepositRecharge 返回 msgCode===10068。
 *   6) 限制时长：SetLimitTime，闭区间 [30,1440] 的【整数】分钟；后一次必须 > 前一次；
 *      绝对值(不累加)，从 GetPageList 响应的 limitStartTime 算起；到期后再设更大值会重新限制直到新 limitEndTime。
 *   7) 一个会员一天只能有一条记录(同一 tenantDate)，出现两条即异常。
 *   8) 跨天：数据只按「当天」，今天订单算今天、明天算明天；下一天的触发/限制按下一天报表；最多跨 1 天(≤1440)。
 *   9) 时区：服务器印度(UTC+5:30)。tenantDate / 查询范围一律按印度时区生成。
 *
 * 架构：一条用例 = 一个账号 = 一个 VU，并发跑；每条用例自判「预期 vs 实际」，
 *      打 ##R##case|userId|phone|预期|实际|PASS/FAIL|详情，由 runner 汇总。
 *
 * 用法：node pullBlacklistRunner.js --tenant 3004
 *      （长用例 cross_day / dubai_release 默认不跑：--cases cross_day,dubai_release --max-duration 24h）
 */

import { sleep } from 'k6';
import exec from 'k6/execution';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { generateRandomPhone } from '../../utils/accountGeneratorFaker.js';
import { generateCryptoRandomString } from '../../utils/utils.js';
import { sendRequest } from '../common/request.js';
import { phoneRegister } from '../login/register.test.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { goodsDepositRecharge } from './frontendRechargeApi.js';
import { getRechargeOrderPageListFull, getLocalRechargeOrderPageList, manualAuditRechargeOrder, manualAuditLocalRechargeOrder } from './backendRechargeApi.js';
import { getPullMonitorRecord, getPullMonitorRecords, setPullLimitTime } from './pullMonitorApi.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const TAG = 'PullBlacklist';
const SKIP_TYPES = ['ArUpi', 'ARPay'];
const BLOCK_MSGCODE = 10068;                        // 前台被风控拦截的固定 msgCode
const THRESHOLD = Number(__ENV.THRESHOLD || 5);    // 触发阈值（累计未支付 >THRESHOLD 触发）
const TARGET_UNPAID = THRESHOLD + 1;               // 触发需要的累计未支付数（默认 6）

// 轮询/等待参数（秒）
const POLL_SEC = Number(__ENV.POLL_SEC || 900);         // 进表：最多等 15 分钟（>1 个轮询周期）
const POLL_INTERVAL = Number(__ENV.POLL_INTERVAL || 30);
const NOTRIGGER_SEC = Number(__ENV.NOTRIGGER_SEC || 780); // 确认「不进表」：等 13 分钟
const CANCEL_WAIT_SEC = Number(__ENV.CANCEL_WAIT_SEC || 360); // 等 Wait 超时取消（默认 6 分钟 >5min）

// 时区：印度 UTC+5:30 / 迪拜 UTC+4
const INDIA_OFFSET_MS = 5.5 * 3600 * 1000;
const DUBAI_OFFSET_MS = 4 * 3600 * 1000;

// 短脚本组(默认全跑)：当天/几十分钟内可完成；长脚本(cross_day/dubai_release)需跑到半夜/第二天，默认不跑
const CASE_LIST = (__ENV.CASES || 'trigger,no_trigger,cancel_still_trigger,limit_block,no_limit_pass,limit_bounds,limit_increase_absolute,limit_decrease_reject,paid_reduce_no_trigger,paid_partial_trigger,paid_during_no_release,paid_after_limit,data_keeps_updating,update_last_4,update_last_5,update_last_6')
    .split(',').map(s => s.trim()).filter(Boolean);

export const options = {
    setupTimeout: '5m',
    scenarios: {
        pull_blacklist: {
            executor: 'per-vu-iterations',
            vus: CASE_LIST.length,
            iterations: 1,
            // maxDuration 是「上限」(per-vu-iterations 下用例做完即退)，必须 ≥ 最慢用例内部等待总和，宁大勿小。
            // 短脚本组最慢 data_keeps_updating(进表15min+等解除30min+等更新15min≈60min+)，故默认 120m；
            // 长脚本 cross_day/dubai_release 必须传 --max-duration 24h。
            maxDuration: __ENV.MAX_DURATION || '120m',
        },
    },
};

// ================= 工具 =================
function pad2(n) { return String(n).padStart(2, '0'); }

/** 印度时区当日信息：日期串 / 今日起止(字符串给 GetPageList) / 今日起止(毫秒给订单列表) */
function indiaDayInfo(ts) {
    const t = (ts == null ? Date.now() : ts);
    const d = new Date(t + INDIA_OFFSET_MS);
    const y = d.getUTCFullYear(), mo = d.getUTCMonth(), da = d.getUTCDate();
    const dateStr = `${y}-${pad2(mo + 1)}-${pad2(da)}`;
    return {
        dateStr,
        startStr: `${dateStr} 00:00:00`,
        endStr: `${dateStr} 23:59:59`,
        startMs: Date.UTC(y, mo, da, 0, 0, 0, 0) - INDIA_OFFSET_MS,
        endMs: Date.UTC(y, mo, da, 23, 59, 59, 999) - INDIA_OFFSET_MS,
    };
}
/** 绝对毫秒时间戳 → 印度时区 "YYYY-MM-DD HH:mm:ss" */
function fmtIndia(ms) {
    if (!ms) return '-';
    const d = new Date(ms + INDIA_OFFSET_MS);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}
/** 下一个「迪拜 10:00」的绝对毫秒（若今天迪拜10点已过则取明天） */
function nextDubai10amMs() {
    const now = Date.now();
    const d = new Date(now + DUBAI_OFFSET_MS);
    const y = d.getUTCFullYear(), mo = d.getUTCMonth(), da = d.getUTCDate();
    let target = Date.UTC(y, mo, da, 10, 0, 0, 0) - DUBAI_OFFSET_MS;
    if (target <= now) target = Date.UTC(y, mo, da + 1, 10, 0, 0, 0) - DUBAI_OFFSET_MS;
    return target;
}
/** 今晚印度午夜之后 extraMin 分钟的绝对毫秒（用于 cross_day 跨午夜） */
function tonightIndiaMidnightPlusMs(extraMin) {
    const d = new Date(Date.now() + INDIA_OFFSET_MS);
    const y = d.getUTCFullYear(), mo = d.getUTCMonth(), da = d.getUTCDate();
    return Date.UTC(y, mo, da + 1, 0, 0, 0, 0) - INDIA_OFFSET_MS + extraMin * 60000;
}

/** 结果输出：case|userId|phone|预期|实际|PASS/FAIL|详情 */
function R(caseName, acct, expect, actual, pass, detail) {
    const uid = acct && acct.userId != null ? acct.userId : '?';
    const phone = acct && acct.phone ? acct.phone : '?';
    console.log(`##R##${caseName}|${uid}|${phone}|${expect}|${actual}|${pass ? 'PASS' : 'FAIL'}|${detail || ''}`);
}
function extractToken(r) {
    if (!r) return null;
    if (typeof r === 'string' && r.length > 10) return r;
    if (r.data && r.data.token) return r.data.token;
    return null;
}

/** 商品盘面 */
function getRechargeBasicInfo(userToken) {
    const resp = sendRequest({}, '/api/Recharge/GetRechargeBasicInfo', 'GetRechargeBasicInfo', true, userToken);
    if (!resp) return null;
    return resp.goodsList !== undefined ? resp : (resp.data || null);
}
/** 选一个有可用充值方式的商品 */
function pickGoodsAndCat(basic) {
    const goodsList = basic && Array.isArray(basic.goodsList) ? basic.goodsList : [];
    for (const g of goodsList) {
        const cats = (g.supportCategories || []).filter(c => !SKIP_TYPES.includes(c.rechargeType));
        if (cats.length) return { goodsId: g.id, catId: cats[0].id, amount: g.rechargeAmount, type: cats[0].rechargeType };
    }
    return null;
}

/** 前台发起一笔充值（不补单=留 Wait）；msgCode===10068 即被风控拦 */
function fireOneRecharge(userToken, gc) {
    const resp = goodsDepositRecharge(userToken, gc.goodsId, gc.catId);
    const code = resp ? resp.code : undefined;
    const msgCode = resp ? resp.msgCode : undefined;
    const msg = resp ? (resp.msg || '') : '';
    const blocked = msgCode === BLOCK_MSGCODE;
    const ok = (msgCode === 0 || code === 0) && !blocked;
    return { ok, blocked, code, msgCode, msg };
}

/** 后台查今日某状态订单笔数（印度时区毫秒范围）；rechargeState 传 '' 查全部状态 */
function countTodayOrders(adminToken, userId, rechargeState) {
    const info = indiaDayInfo();
    const resp = getRechargeOrderPageListFull(adminToken, {
        userId, rechargeState: rechargeState || '', startTime: info.startMs, endTime: info.endMs,
        pageNo: 1, pageSize: 200, dateType: 0, orderBy: 'Desc',
    });
    if (!resp) return 0;
    const d = resp.data || resp;
    if (d && d.totalCount != null) return d.totalCount;
    if (d && Array.isArray(d.list)) return d.list.length;
    return 0;
}
/** 今日累计未支付数（触发口径）：全部发起数 - 已支付数 */
function countUnpaid(adminToken, userId) {
    const total = countTodayOrders(adminToken, userId, '');
    const paid = countTodayOrders(adminToken, userId, 'Payed');
    return { total, paid, unpaid: total - paid };
}

/** 造未支付：连发充值直到累计未支付 ≥ target 或发够 maxFire 次；返回 {gc, unpaid, total, paid, fired, blockedEarly} */
function buildUnpaid(acct, ctx, target, maxFire) {
    const basic = getRechargeBasicInfo(acct.token);
    const gc = pickGoodsAndCat(basic);
    if (!gc) return { gc: null, unpaid: 0, total: 0, paid: 0, fired: 0, blockedEarly: false };
    let fired = 0, blockedEarly = false;
    let c = countUnpaid(ctx.adminToken, acct.userId);
    console.log(`[${TAG}] [造数] userId=${acct.userId} 目标累计未支付≥${target}，起始未支付=${c.unpaid}(total=${c.total},paid=${c.paid})`);
    for (let i = 0; i < maxFire && c.unpaid < target; i++) {
        const r = fireOneRecharge(acct.token, gc);
        fired++;
        if (r.blocked) {
            console.log(`[${TAG}] [造数] userId=${acct.userId} 第${fired}次发起被风控拦(msgCode=10068)，提前停止`);
            blockedEarly = true; break;
        }
        sleep(4);
        c = countUnpaid(ctx.adminToken, acct.userId);
        console.log(`[${TAG}] [造数] userId=${acct.userId} 第${fired}次发起(code=${r.code}/msgCode=${r.msgCode})后 累计未支付=${c.unpaid} (total=${c.total},paid=${c.paid})`);
    }
    console.log(`[${TAG}] [造数] userId=${acct.userId} 造数结束：发起${fired}次，累计未支付=${c.unpaid}`);
    return { gc, unpaid: c.unpaid, total: c.total, paid: c.paid, fired, blockedEarly };
}

/** 补单：把今日 N 笔"未支付"订单(Wait/Cancel/待审核 等非 Payed)审核成已支付（三方优先，其次本地）；返回实际补单成功笔数 */
function auditNUnpaidOrders(adminToken, userId, n) {
    if (n <= 0) return 0;
    const info = indiaDayInfo();
    let done = 0;
    // 三方订单（查全部状态，补所有非 Payed）
    const thirdResp = getRechargeOrderPageListFull(adminToken, {
        userId, rechargeState: '', startTime: info.startMs, endTime: info.endMs,
        pageNo: 1, pageSize: 200, dateType: 0, orderBy: 'Desc',
    });
    const thirdD = thirdResp ? (thirdResp.data || thirdResp) : null;
    const thirdList = thirdD && Array.isArray(thirdD.list) ? thirdD.list : [];
    for (const o of thirdList) {
        if (done >= n) break;
        if (o.rechargeState === 'Payed') continue;
        if (manualAuditRechargeOrder(adminToken, o.orderNo, userId, o.createTime, o.amount)) done++;
        sleep(0.5);
    }
    // 本地订单（补足；补所有非 Payed）
    if (done < n) {
        const localList = getLocalRechargeOrderPageList(adminToken, userId, info.startMs, info.endMs) || [];
        for (const o of localList) {
            if (done >= n) break;
            if (o.rechargeState === 'Payed') continue;
            if (manualAuditLocalRechargeOrder(adminToken, o.orderNo, userId, o.createTime, o.amount)) done++;
            sleep(0.5);
        }
    }
    console.log(`[${TAG}] [补单] userId=${userId} 目标补${n}笔，实际补单成功${done}笔`);
    return done;
}

/** 轮询等待进入监控名单；返回 {rec, polls} */
function pollMonitor(adminToken, userId, maxWaitSec, intervalSec) {
    const info = indiaDayInfo();
    const start = Date.now();
    const deadline = start + maxWaitSec * 1000;
    let polls = 0;
    console.log(`[${TAG}] [轮询进表] userId=${userId} 开始轮询监控名单(每${intervalSec}s一次，最多等${Math.round(maxWaitSec / 60)}min；后台约每10min才入库)...`);
    while (Date.now() < deadline) {
        polls++;
        const rec = getPullMonitorRecord(adminToken, userId, info.startStr, info.endStr);
        if (rec) {
            console.log(`[${TAG}] [轮询进表] userId=${userId} 第${polls}次命中✅ 已进表(pullOrderCount=${rec.pullOrderCount},paidOrderCount=${rec.paidOrderCount})`);
            return { rec, polls };
        }
        console.log(`[${TAG}] [轮询进表] userId=${userId} 第${polls}次未命中，已等待~${Math.round((Date.now() - start) / 1000)}s，${intervalSec}s后重试`);
        sleep(intervalSec);
    }
    return { rec: null, polls };
}

/** 造未支付>阈值 并等待进入监控名单（limit 系列公共前置）；返回 {rec, gc, unpaid, fired, polls, reason} */
function triggerIntoMonitor(acct, ctx) {
    const b = buildUnpaid(acct, ctx, TARGET_UNPAID, 20);
    if (!b.gc) return { rec: null, gc: null, reason: '拿不到充值商品/通道' };
    if (b.unpaid < TARGET_UNPAID) return { rec: null, gc: b.gc, unpaid: b.unpaid, fired: b.fired, reason: `未支付只造到${b.unpaid}(<${TARGET_UNPAID})` };
    const p = pollMonitor(ctx.adminToken, acct.userId, POLL_SEC, POLL_INTERVAL);
    return { rec: p.rec, gc: b.gc, unpaid: b.unpaid, fired: b.fired, polls: p.polls, reason: p.rec ? '' : `轮询${p.polls}次仍未进表` };
}

// ================= 用例实现 =================

/** trigger：造累计未支付>阈值 → 等轮询进入监控名单 */
function caseTrigger(acct, ctx) {
    const b = buildUnpaid(acct, ctx, TARGET_UNPAID, 20);
    if (!b.gc) return R('trigger', acct, '进监控名单', '拿不到充值商品/通道', false);
    if (b.unpaid < TARGET_UNPAID)
        return R('trigger', acct, '进监控名单', `未支付只造到${b.unpaid}(<${TARGET_UNPAID})`, false, `fired=${b.fired},total=${b.total}`);
    const p = pollMonitor(ctx.adminToken, acct.userId, POLL_SEC, POLL_INTERVAL);
    const rec = p.rec;
    if (!rec)
        return R('trigger', acct, `累计未支付>${THRESHOLD}→进监控名单且今日仅1条`, `未支付=${b.unpaid} 轮询${p.polls}次(~${Math.round(POLL_SEC / 60)}min)仍未进表`, false, `fired=${b.fired},total=${b.total}`);
    // 一天一条：查该会员今日记录数，>1 即异常
    const info = indiaDayInfo();
    const recs = getPullMonitorRecords(ctx.adminToken, acct.userId, info.startStr, info.endStr);
    const unique = recs.length === 1;
    const actual = `未支付=${b.unpaid} 轮询${p.polls}次后进表: pullOrderCount=${rec.pullOrderCount}, paidOrderCount=${rec.paidOrderCount}, triggerTime=${fmtIndia(rec.triggerTime)}; 今日记录数=${recs.length}${unique ? '(唯一✓)' : '(❗应为1)'}`;
    return R('trigger', acct, `累计未支付>${THRESHOLD}→进监控名单且今日仅1条`, actual, unique, `fired=${b.fired},total=${b.total}`);
}

/** no_trigger：只造 ≤阈值 个累计未支付 → 不进监控名单 */
function caseNoTrigger(acct, ctx) {
    const b = buildUnpaid(acct, ctx, THRESHOLD, THRESHOLD + 3); // 目标造到 5(=阈值，不>阈值)
    if (!b.gc) return R('no_trigger', acct, '不进名单', '拿不到充值商品/通道', false);
    if (b.unpaid > THRESHOLD)
        return R('no_trigger', acct, '不进名单', `造数失控 未支付=${b.unpaid}(>${THRESHOLD})，用例无效`, false, `fired=${b.fired},total=${b.total}`);
    const p = pollMonitor(ctx.adminToken, acct.userId, NOTRIGGER_SEC, POLL_INTERVAL);
    const actual = p.rec
        ? `异常进表 pullOrderCount=${p.rec.pullOrderCount}`
        : `未支付=${b.unpaid} 轮询${p.polls}次(~${Math.round(NOTRIGGER_SEC / 60)}min)未进表`;
    return R('no_trigger', acct, `累计未支付≤${THRESHOLD}→不进监控名单`, actual, !p.rec, `fired=${b.fired},total=${b.total}`);
}

/** cancel_still_trigger：造6笔→等5min全部超时(Wait→Cancel)→Cancel仍算未支付、未支付数不变→仍进表 */
function caseCancelStillTrigger(acct, ctx) {
    const b = buildUnpaid(acct, ctx, TARGET_UNPAID, 20);
    if (!b.gc) return R('cancel_still_trigger', acct, '超时取消后仍进表', '拿不到充值商品/通道', false);
    if (b.unpaid < TARGET_UNPAID)
        return R('cancel_still_trigger', acct, '超时取消后仍进表', `未支付只造到${b.unpaid}(<${TARGET_UNPAID})`, false, `fired=${b.fired}`);
    console.log(`[${TAG}] cancel_still_trigger userId=${acct.userId} 造未支付=${b.unpaid}，等${CANCEL_WAIT_SEC}s 让 Wait 超时取消...`);
    sleep(CANCEL_WAIT_SEC);
    const waitState = countTodayOrders(ctx.adminToken, acct.userId, 'Wait');
    const cAfter = countUnpaid(ctx.adminToken, acct.userId);
    const p = pollMonitor(ctx.adminToken, acct.userId, POLL_SEC, POLL_INTERVAL);
    const rec = p.rec;
    const actual = rec
        ? `等${Math.round(CANCEL_WAIT_SEC / 60)}min后 Wait状态=${waitState}(超时转Cancel)，但未支付(含Cancel)=${cAfter.unpaid}不变 → 仍进表 pullOrderCount=${rec.pullOrderCount}`
        : `等${Math.round(CANCEL_WAIT_SEC / 60)}min后 Wait状态=${waitState}, 未支付(含Cancel)=${cAfter.unpaid}, 轮询${p.polls}次未进表`;
    return R('cancel_still_trigger', acct, '超时取消(Wait→Cancel)仍算未支付→仍进表', actual, !!rec, `waitState=${waitState},unpaid=${cAfter.unpaid},fired=${b.fired}`);
}

/** limit_block：进表后 SetLimitTime → 限制期内前台发起被拦(10068) */
function caseLimitBlock(acct, ctx) {
    const enter = triggerIntoMonitor(acct, ctx);
    if (!enter.rec) return R('limit_block', acct, '设限后前台被拦', `未能进表(${enter.reason})`, false);
    const info = indiaDayInfo();
    const set = setPullLimitTime(ctx.adminToken, acct.userId, info.dateStr, 30);
    if (!set || set.code !== 0)
        return R('limit_block', acct, '设限后前台被拦', `SetLimitTime失败 code=${set && set.code}, msg=${set && set.msg}`, false);
    sleep(3);
    const rec = getPullMonitorRecord(ctx.adminToken, acct.userId, info.startStr, info.endStr);
    const r = fireOneRecharge(acct.token, enter.gc);
    const actual = r.blocked
        ? `设限30min(至${fmtIndia(rec && rec.limitEndTime)})后前台发起被拦(msgCode=10068)`
        : `设限后前台发起未被拦 code=${r.code}, msgCode=${r.msgCode}, msg=${r.msg}`;
    return R('limit_block', acct, '限制期内前台发起返回10068', actual, r.blocked,
        `limitStart=${fmtIndia(rec && rec.limitStartTime)},limitEnd=${fmtIndia(rec && rec.limitEndTime)}`);
}

/** no_limit_pass：进表但未 SetLimitTime → 前台可【无限发】(连发多笔全不被拦) */
function caseNoLimitPass(acct, ctx) {
    const enter = triggerIntoMonitor(acct, ctx);
    if (!enter.rec) return R('no_limit_pass', acct, '进表未设限可无限发', `未能进表(${enter.reason})`, false);
    if (enter.rec.limitStartTime)
        return R('no_limit_pass', acct, '进表未设限可无限发', `记录已带limitStartTime=${fmtIndia(enter.rec.limitStartTime)}，非未设限状态`, false);
    let okCnt = 0, blockedCnt = 0; const codes = [];
    for (let i = 0; i < 5; i++) {
        const r = fireOneRecharge(acct.token, enter.gc);
        codes.push(r.msgCode);
        if (r.blocked) blockedCnt++; else if (r.ok) okCnt++;
        sleep(4);
    }
    const pass = blockedCnt === 0;
    const actual = `进表未设限，连发5笔：成功${okCnt}，被拦${blockedCnt}（msgCodes=${codes.join(',')}）`;
    return R('no_limit_pass', acct, '进表但未SetLimitTime→前台可无限发(全部不被拦)', actual, pass,
        `pullOrderCount=${enter.rec.pullOrderCount}`);
}

/** limit_bounds：SetLimitTime 边界 29拒/1441拒/30过/1440过（顺序避开递增约束） */
function caseLimitBounds(acct, ctx) {
    const enter = triggerIntoMonitor(acct, ctx);
    if (!enter.rec) return R('limit_bounds', acct, '边界校验', `未能进表(${enter.reason})`, false);
    const info = indiaDayInfo();
    const s29 = setPullLimitTime(ctx.adminToken, acct.userId, info.dateStr, 29); sleep(2);
    const s1441 = setPullLimitTime(ctx.adminToken, acct.userId, info.dateStr, 1441); sleep(2);
    const s30 = setPullLimitTime(ctx.adminToken, acct.userId, info.dateStr, 30); sleep(2);
    const s1440 = setPullLimitTime(ctx.adminToken, acct.userId, info.dateStr, 1440); sleep(2);
    const c = s => (s ? s.code : 'null');
    const pass = s29 && s29.code !== 0 && s1441 && s1441.code !== 0 && s30 && s30.code === 0 && s1440 && s1440.code === 0;
    const actual = `29→code=${c(s29)}(期望≠0); 1441→code=${c(s1441)}(期望≠0); 30→code=${c(s30)}(期望0); 1440→code=${c(s1440)}(期望0)`;
    return R('limit_bounds', acct, '29/1441拒绝, 30/1440成功', actual, pass);
}

/** limit_increase_absolute：递增覆盖(30→40)，起点不变、总时长=40min(绝对值非累加) */
function caseLimitIncrease(acct, ctx) {
    const enter = triggerIntoMonitor(acct, ctx);
    if (!enter.rec) return R('limit_increase_absolute', acct, '递增覆盖+绝对值', `未能进表(${enter.reason})`, false);
    const info = indiaDayInfo();
    const s30 = setPullLimitTime(ctx.adminToken, acct.userId, info.dateStr, 30);
    if (!s30 || s30.code !== 0) return R('limit_increase_absolute', acct, '递增覆盖+绝对值', `首次设30失败 code=${s30 && s30.code}`, false);
    sleep(3);
    const rec1 = getPullMonitorRecord(ctx.adminToken, acct.userId, info.startStr, info.endStr);
    const start1 = rec1 && rec1.limitStartTime, end1 = rec1 && rec1.limitEndTime;
    const s40 = setPullLimitTime(ctx.adminToken, acct.userId, info.dateStr, 40);
    if (!s40 || s40.code !== 0) return R('limit_increase_absolute', acct, '递增覆盖+绝对值', `设40失败 code=${s40 && s40.code}`, false);
    sleep(3);
    const rec2 = getPullMonitorRecord(ctx.adminToken, acct.userId, info.startStr, info.endStr);
    const start2 = rec2 && rec2.limitStartTime, end2 = rec2 && rec2.limitEndTime;
    const durMin = (end2 && start2) ? (end2 - start2) / 60000 : -1;
    const startUnchanged = start1 && start2 && Math.abs(start2 - start1) < 60000;
    const absOk = Math.abs(durMin - 40) <= 1.5; // 总时长=40(绝对值)，而非 30+40=70
    const pass = startUnchanged && absOk;
    const actual = `设30后 start=${fmtIndia(start1)} end=${fmtIndia(end1)}; 设40后 start=${fmtIndia(start2)} end=${fmtIndia(end2)}; 总时长=${durMin.toFixed(1)}min; 起点${startUnchanged ? '不变✓' : '变了✗'}`;
    return R('limit_increase_absolute', acct, '起点不变&总时长=40min(绝对值非累加)', actual, pass,
        `totalLimitMinutes=${rec2 && rec2.totalLimitMinutes}`);
}

/** limit_decrease_reject：先40再设更小的30 → 拒绝或不生效(时长不变小) */
function caseLimitDecrease(acct, ctx) {
    const enter = triggerIntoMonitor(acct, ctx);
    if (!enter.rec) return R('limit_decrease_reject', acct, '递减被拒', `未能进表(${enter.reason})`, false);
    const info = indiaDayInfo();
    const s40 = setPullLimitTime(ctx.adminToken, acct.userId, info.dateStr, 40);
    if (!s40 || s40.code !== 0) return R('limit_decrease_reject', acct, '递减被拒', `首次设40失败 code=${s40 && s40.code}`, false);
    sleep(3);
    const rec1 = getPullMonitorRecord(ctx.adminToken, acct.userId, info.startStr, info.endStr);
    const end1 = rec1 && rec1.limitEndTime;
    const s30 = setPullLimitTime(ctx.adminToken, acct.userId, info.dateStr, 30);
    sleep(3);
    const rec2 = getPullMonitorRecord(ctx.adminToken, acct.userId, info.startStr, info.endStr);
    const end2 = rec2 && rec2.limitEndTime;
    const rejected = s30 && s30.code !== 0;
    const endUnchanged = end1 && end2 && Math.abs(end2 - end1) < 60000;
    const pass = rejected || endUnchanged;
    const actual = `设40后 end=${fmtIndia(end1)}; 再设30→code=${s30 && s30.code}, end=${fmtIndia(end2)}; ${rejected ? '接口拒绝✓' : (endUnchanged ? '时长未变小✓' : '时长被改小✗')}`;
    return R('limit_decrease_reject', acct, '后一次<前一次→拒绝/不生效', actual, pass,
        `totalLimitMinutes=${rec2 && rec2.totalLimitMinutes}`);
}

/** cross_day（长）：设跨午夜的限制 → 等印度日期跨过今晚00点 → 前台发起仍被拦(10068) */
function caseCrossDay(acct, ctx) {
    const today = indiaDayInfo().dateStr;
    const enter = triggerIntoMonitor(acct, ctx);
    if (!enter.rec) return R('cross_day', acct, '跨天后仍风控', `未能进表(${enter.reason})`, false);
    const info = indiaDayInfo();
    const target = tonightIndiaMidnightPlusMs(30); // 明天印度 00:30
    let limitMinutes = Math.ceil((target - Date.now()) / 60000);
    if (limitMinutes < 30) limitMinutes = 30;
    if (limitMinutes > 1440) return R('cross_day', acct, '跨天后仍风控', `距明天00:30需${limitMinutes}min(>1440)，请临近午夜再跑`, false);
    const set = setPullLimitTime(ctx.adminToken, acct.userId, info.dateStr, limitMinutes);
    if (!set || set.code !== 0) return R('cross_day', acct, '跨天后仍风控', `SetLimitTime失败 code=${set && set.code}`, false);
    sleep(3);
    const rec = getPullMonitorRecord(ctx.adminToken, acct.userId, info.startStr, info.endStr);
    const limitEnd = rec && rec.limitEndTime;
    console.log(`[${TAG}] cross_day userId=${acct.userId} 设限${limitMinutes}min，limitEnd=${fmtIndia(limitEnd)}，等待跨过今晚00点...`);
    const deadline = Date.now() + 26 * 3600 * 1000;
    while (Date.now() < deadline) {
        if (indiaDayInfo().dateStr !== today) break;
        console.log(`[${TAG}] cross_day userId=${acct.userId} 等跨过今晚00点中... 当前印度日期=${indiaDayInfo().dateStr}(仍为${today})，limitEnd=${fmtIndia(limitEnd)}`);
        sleep(60);
    }
    const nowDay = indiaDayInfo().dateStr;
    if (nowDay === today) return R('cross_day', acct, '跨天后仍风控', '等待26h仍未跨天(异常)', false);
    if (limitEnd && Date.now() >= limitEnd)
        return R('cross_day', acct, '跨天后仍风控', `跨天时限制已到期(limitEnd=${fmtIndia(limitEnd)})，无法验证，请设更长时长`, false);
    const r = fireOneRecharge(acct.token, enter.gc);
    const actual = `跨天(${today}→${nowDay})后前台发起 code=${r.code}, msgCode=${r.msgCode}, ${r.blocked ? '仍被拦(10068)✓' : '未被拦✗'}`;
    return R('cross_day', acct, '跨午夜后限制按绝对limitEnd生效(被拦10068)', actual, r.blocked, `limitEnd=${fmtIndia(limitEnd)}`);
}

/** dubai_release（长）：今天限制到「明天迪拜10:00」→ 到期后前台充值可正常发起(code=0) */
function caseDubaiRelease(acct, ctx) {
    const enter = triggerIntoMonitor(acct, ctx);
    if (!enter.rec) return R('dubai_release', acct, '迪拜10点解除后可充值', `未能进表(${enter.reason})`, false);
    const info = indiaDayInfo();
    const target = nextDubai10amMs();
    let limitMinutes = Math.ceil((target - Date.now()) / 60000);
    if (limitMinutes < 30) limitMinutes = 30;
    if (limitMinutes > 1440) return R('dubai_release', acct, '迪拜10点解除后可充值', `距下个迪拜10点需${limitMinutes}min(>1440)，请更晚再跑`, false);
    const set = setPullLimitTime(ctx.adminToken, acct.userId, info.dateStr, limitMinutes);
    if (!set || set.code !== 0) return R('dubai_release', acct, '迪拜10点解除后可充值', `SetLimitTime失败 code=${set && set.code}`, false);
    sleep(3);
    const rec = getPullMonitorRecord(ctx.adminToken, acct.userId, info.startStr, info.endStr);
    const limitEnd = rec && rec.limitEndTime;
    console.log(`[${TAG}] dubai_release userId=${acct.userId} 设限${limitMinutes}min，limitEnd=${fmtIndia(limitEnd)}(≈迪拜10:00)，等待解除...`);
    const deadline = Date.now() + 26 * 3600 * 1000;
    while (Date.now() < deadline) {
        if (limitEnd && Date.now() >= limitEnd) break;
        console.log(`[${TAG}] dubai_release userId=${acct.userId} 等迪拜10点解除中... 距 limitEnd(${fmtIndia(limitEnd)}) 还剩~${limitEnd ? Math.max(0, Math.round((limitEnd - Date.now()) / 60000)) : '?'}min`);
        sleep(60);
    }
    if (limitEnd && Date.now() < limitEnd)
        return R('dubai_release', acct, '迪拜10点解除后可充值', '等待26h仍未到解除时刻(异常)', false);
    sleep(5);
    const r = fireOneRecharge(acct.token, enter.gc);
    const actual = `解除(limitEnd=${fmtIndia(limitEnd)})后前台发起 code=${r.code}, msgCode=${r.msgCode}, ${r.ok && !r.blocked ? '正常发起✓' : (r.blocked ? '仍被拦(10068)✗' : '发起异常✗')}`;
    return R('dubai_release', acct, '限制到期(迪拜10点)后前台充值可正常发起(code=0)', actual, r.ok && !r.blocked, `limitEnd=${fmtIndia(limitEnd)}`);
}

/** paid_reduce_no_trigger（风控前补单）：发>阈值笔 → 进表前补单使净未支付≤阈值 → 不触发 */
function casePaidReduceNoTrigger(acct, ctx) {
    const b = buildUnpaid(acct, ctx, THRESHOLD + 3, THRESHOLD + 6); // 造到 ~8
    if (!b.gc) return R('paid_reduce_no_trigger', acct, '补单后不触发', '拿不到充值商品/通道', false);
    if (b.unpaid <= THRESHOLD)
        return R('paid_reduce_no_trigger', acct, '补单后不触发', `未支付只造到${b.unpaid}(需>${THRESHOLD}才有意义)`, false, `fired=${b.fired}`);
    const toPaid = b.unpaid - (THRESHOLD - 1);          // 补到净未支付=阈值-1（如 8→4）
    const paidDone = auditNUnpaidOrders(ctx.adminToken, acct.userId, toPaid);
    sleep(2);
    const c = countUnpaid(ctx.adminToken, acct.userId);
    console.log(`[${TAG}] paid_reduce userId=${acct.userId} 补单${paidDone}笔后 净未支付=${c.unpaid}(total=${c.total},paid=${c.paid})`);
    if (c.unpaid > THRESHOLD)
        return R('paid_reduce_no_trigger', acct, `补单使净未支付≤${THRESHOLD}→不触发`, `补单${paidDone}笔后净未支付仍=${c.unpaid}(>${THRESHOLD})，补单不足`, false, `total=${c.total},paid=${c.paid}`);
    const p = pollMonitor(ctx.adminToken, acct.userId, NOTRIGGER_SEC, POLL_INTERVAL);
    const actual = p.rec
        ? `补单后净未支付=${c.unpaid}却仍进表 → 触发疑似看pullOrderCount(不减paid): pull=${p.rec.pullOrderCount},paid=${p.rec.paidOrderCount}`
        : `补单${paidDone}笔后净未支付=${c.unpaid}，轮询${p.polls}次未进表`;
    return R('paid_reduce_no_trigger', acct, `风控前补单使净未支付≤${THRESHOLD}→不触发`, actual, !p.rec, `total=${c.total},paid=${c.paid}`);
}

/** paid_partial_trigger（风控前补部分）：发>阈值笔 → 补一部分但净未支付仍>阈值 → 仍进表，验证 pull/paid 字段 */
function casePaidPartialTrigger(acct, ctx) {
    const b = buildUnpaid(acct, ctx, THRESHOLD + 3, THRESHOLD + 6); // ~8
    if (!b.gc) return R('paid_partial_trigger', acct, '补部分后仍进表', '拿不到充值商品/通道', false);
    if (b.unpaid < THRESHOLD + 2)
        return R('paid_partial_trigger', acct, '补部分后仍进表', `未支付只造到${b.unpaid}(需≥${THRESHOLD + 2})`, false, `fired=${b.fired}`);
    const toPaid = b.unpaid - (THRESHOLD + 1);           // 补到净未支付=阈值+1（如 8→6，仍>5）
    const paidDone = auditNUnpaidOrders(ctx.adminToken, acct.userId, toPaid);
    sleep(2);
    const c = countUnpaid(ctx.adminToken, acct.userId);
    const p = pollMonitor(ctx.adminToken, acct.userId, POLL_SEC, POLL_INTERVAL);
    const rec = p.rec;
    const actual = rec
        ? `发起total=${c.total},补单${paidDone}笔,净未支付=${c.unpaid} → 进表 pullOrderCount=${rec.pullOrderCount},paidOrderCount=${rec.paidOrderCount}`
        : `净未支付=${c.unpaid}但轮询${p.polls}次未进表`;
    return R('paid_partial_trigger', acct, `补部分后净未支付>${THRESHOLD}仍进表(pull=发起数,paid=补单数)`, actual, !!rec,
        `paidDone=${paidDone},total=${c.total},recPaid=${rec && rec.paidOrderCount}`);
}

/** paid_during_no_release（风控中补单）：进表后补单降净未支付 → 记录不撤销、paidOrderCount 随轮询更新 */
function casePaidDuringNoRelease(acct, ctx) {
    const enter = triggerIntoMonitor(acct, ctx);
    if (!enter.rec) return R('paid_during_no_release', acct, '风控中补单不解除', `未能进表(${enter.reason})`, false);
    const pullBefore = enter.rec.pullOrderCount;
    const c0 = countUnpaid(ctx.adminToken, acct.userId);
    const toPaid = Math.max(1, c0.unpaid - (THRESHOLD - 1)); // 降到净未支付≤阈值-1
    const paidDone = auditNUnpaidOrders(ctx.adminToken, acct.userId, toPaid);
    console.log(`[${TAG}] paid_during userId=${acct.userId} 进表后补单${paidDone}笔，等轮询看paidOrderCount更新...`);
    const info = indiaDayInfo();
    const start = Date.now();
    const deadline = start + POLL_SEC * 1000;
    let rec2 = null;
    while (Date.now() < deadline) {
        sleep(POLL_INTERVAL);
        rec2 = getPullMonitorRecord(ctx.adminToken, acct.userId, info.startStr, info.endStr);
        if (rec2 && rec2.paidOrderCount >= paidDone) break;
        console.log(`[${TAG}] paid_during userId=${acct.userId} 等paidOrderCount更新，当前=${rec2 && rec2.paidOrderCount}，已等${Math.round((Date.now() - start) / 1000)}s`);
    }
    const c1 = countUnpaid(ctx.adminToken, acct.userId);
    const stillIn = !!rec2;
    const paidUpdated = rec2 && rec2.paidOrderCount >= paidDone;
    const actual = `进表后补单${paidDone}笔(净未支付${c0.unpaid}→${c1.unpaid})；记录${stillIn ? '仍在✓' : '消失✗'}, paidOrderCount=${rec2 && rec2.paidOrderCount}(${paidUpdated ? '已更新✓' : '未更新✗'}), pullOrderCount=${rec2 && rec2.pullOrderCount}(原${pullBefore})`;
    return R('paid_during_no_release', acct, '风控中补单→记录不撤销&paidOrderCount更新', actual, stillIn && paidUpdated, `paidDone=${paidDone}`);
}

/** paid_after_limit（风控后补单）：进表+设限后补单 → 前台仍被拦、limitEndTime 不变、paidOrderCount 更新 */
function casePaidAfterLimit(acct, ctx) {
    const enter = triggerIntoMonitor(acct, ctx);
    if (!enter.rec) return R('paid_after_limit', acct, '限制期补单不解除限制', `未能进表(${enter.reason})`, false);
    const info = indiaDayInfo();
    const set = setPullLimitTime(ctx.adminToken, acct.userId, info.dateStr, 30);
    if (!set || set.code !== 0) return R('paid_after_limit', acct, '限制期补单不解除限制', `SetLimitTime失败 code=${set && set.code}`, false);
    sleep(3);
    const recA = getPullMonitorRecord(ctx.adminToken, acct.userId, info.startStr, info.endStr);
    const endA = recA && recA.limitEndTime;
    const c0 = countUnpaid(ctx.adminToken, acct.userId);
    const toPaid = Math.max(1, c0.unpaid - (THRESHOLD - 1));
    const paidDone = auditNUnpaidOrders(ctx.adminToken, acct.userId, toPaid);
    sleep(3);
    const r = fireOneRecharge(acct.token, enter.gc);
    const recB = getPullMonitorRecord(ctx.adminToken, acct.userId, info.startStr, info.endStr);
    const endB = recB && recB.limitEndTime;
    const endUnchanged = endA && endB && Math.abs(endA - endB) < 60000;
    const pass = r.blocked && endUnchanged;
    const actual = `限制期补单${paidDone}笔后：前台发起${r.blocked ? '仍被拦(10068)✓' : '未被拦✗'}, limitEnd ${endUnchanged ? '不变✓' : '变了✗'}(${fmtIndia(endA)}→${fmtIndia(endB)}), paidOrderCount=${recB && recB.paidOrderCount}`;
    return R('paid_after_limit', acct, '限制期内补单不解除限制(仍被拦,limitEnd不变)', actual, pass, `paidDone=${paidDone}`);
}

/** data_keeps_updating（长）：进表→设限30min→等解除→再发起+随机补2单→下个轮询→
 *  验证 pullOrderCount/paidOrderCount 累计当天全量(含解封后新增)，即"进表后数据一直更新" */
function caseDataKeepsUpdating(acct, ctx) {
    const enter = triggerIntoMonitor(acct, ctx);
    if (!enter.rec) return R('data_keeps_updating', acct, '进表后数据持续累计更新', `未能进表(${enter.reason})`, false);
    const info = indiaDayInfo();
    const pull1 = enter.rec.pullOrderCount;   // 进表时累计发起数
    const paid1 = enter.rec.paidOrderCount;   // 进表时已支付数（通常 0）

    // 设限 30min（最短），模拟"被限制发起充值 30 分钟"
    const set = setPullLimitTime(ctx.adminToken, acct.userId, info.dateStr, 30);
    if (!set || set.code !== 0) return R('data_keeps_updating', acct, '进表后数据持续累计更新', `SetLimitTime失败 code=${set && set.code}`, false);
    sleep(3);
    const recL = getPullMonitorRecord(ctx.adminToken, acct.userId, info.startStr, info.endStr);
    const limitEnd = recL && recL.limitEndTime;
    console.log(`[${TAG}] data_keeps_updating userId=${acct.userId} 进表 pull=${pull1},paid=${paid1}；设限30min limitEnd=${fmtIndia(limitEnd)}，等待解除...`);

    // 等到解除（limitEndTime 过后）
    const dl1 = Date.now() + 50 * 60 * 1000;
    while (Date.now() < dl1) {
        if (limitEnd && Date.now() >= limitEnd) break;
        console.log(`[${TAG}] data_keeps_updating userId=${acct.userId} 等限制解除中... 距 limitEnd(${fmtIndia(limitEnd)}) 还剩~${limitEnd ? Math.max(0, Math.round((limitEnd - Date.now()) / 60000)) : '?'}min`);
        sleep(60);
    }
    if (limitEnd && Date.now() < limitEnd) return R('data_keeps_updating', acct, '进表后数据持续累计更新', '等待超时仍未解除限制', false);

    // 解除后再发起 3 笔
    sleep(5);
    let newFired = 0, blockedAfter = false;
    for (let i = 0; i < 3; i++) {
        const r = fireOneRecharge(acct.token, enter.gc);
        newFired++;
        if (r.blocked) { blockedAfter = true; break; } // 解除后不应再被拦
        sleep(4);
    }
    // 随机补 2 单
    const paidDone = auditNUnpaidOrders(ctx.adminToken, acct.userId, 2);
    const cReal = countUnpaid(ctx.adminToken, acct.userId);
    console.log(`[${TAG}] data_keeps_updating userId=${acct.userId} 解除后再发${newFired}笔+补${paidDone}单(后台total=${cReal.total},paid=${cReal.paid})，等下个轮询更新...`);

    // 等下一个轮询让 pull/paid 更新
    const start2 = Date.now();
    const dl2 = start2 + POLL_SEC * 1000;
    let rec2 = enter.rec;
    while (Date.now() < dl2) {
        sleep(POLL_INTERVAL);
        const rr = getPullMonitorRecord(ctx.adminToken, acct.userId, info.startStr, info.endStr);
        if (rr) {
            rec2 = rr;
            if (rr.pullOrderCount > pull1 && rr.paidOrderCount >= paid1 + paidDone) break;
        }
        console.log(`[${TAG}] data_keeps_updating userId=${acct.userId} 等更新... 当前 pull=${rec2 && rec2.pullOrderCount},paid=${rec2 && rec2.paidOrderCount}`);
    }
    const pullUp = rec2 && rec2.pullOrderCount > pull1;
    const paidUp = rec2 && rec2.paidOrderCount >= paid1 + paidDone && rec2.paidOrderCount > paid1;
    const pass = pullUp && paidUp && !blockedAfter;
    const actual = `进表 pull=${pull1},paid=${paid1}；解除后再发${newFired}笔${blockedAfter ? '(仍被拦✗)' : ''}+补${paidDone}单；轮询后 pull=${rec2 && rec2.pullOrderCount}(${pullUp ? '累计增长✓' : '未增✗'}),paid=${rec2 && rec2.paidOrderCount}(${paidUp ? '累计增长✓' : '未增✗'})；后台真实 total=${cReal.total},paid=${cReal.paid}`;
    return R('data_keeps_updating', acct, '进表后当天数据(pull/paid)持续累计更新(含解封后新增)', actual, pass, `newFired=${newFired},paidDone=${paidDone}`);
}

/** update_last_N（长）：已进表会员，补单清空当前未支付(Wait/Cancel) → 再发起精确 N 笔(最后一批未支付=N)
 *  → 等下个轮询看数据是否更新且与后台一致。用于定位"最后一批未支付未达阈值(如4笔)导致不更新→表单与后台对应不上"的 bug。
 *  预期：进表后无论最后一批几笔都应更新到与后台一致（pullOrderCount 增长 且 = 后台真实累计）。 */
function caseUpdateLastBatch(acct, ctx, n, caseName) {
    const enter = triggerIntoMonitor(acct, ctx);
    if (!enter.rec) return R(caseName, acct, `风控后最后一批未支付=${n}笔应更新`, `未能进表(${enter.reason})`, false);
    const info = indiaDayInfo();
    const pull0 = enter.rec.pullOrderCount;
    const lastUpd0 = enter.rec.lastUpdateTime;

    // 补单清掉当前所有未支付(Wait/Cancel)，使"最后一批未支付"干净
    const cBefore = countUnpaid(ctx.adminToken, acct.userId).unpaid;
    if (cBefore > 0) auditNUnpaidOrders(ctx.adminToken, acct.userId, cBefore + 3);
    sleep(2);
    const cCleared = countUnpaid(ctx.adminToken, acct.userId).unpaid;
    console.log(`[${TAG}] ${caseName} userId=${acct.userId} 进表pull=${pull0}(lastUpd=${fmtIndia(lastUpd0)})，补单清未支付后当前未支付=${cCleared}`);

    // 再发起，使当前未支付精确达到 n（最后一批未支付=n）
    let fired = 0, blocked = false;
    for (let i = 0; i < n * 3; i++) {
        if (countUnpaid(ctx.adminToken, acct.userId).unpaid >= n) break;
        const r = fireOneRecharge(acct.token, enter.gc);
        fired++;
        if (r.blocked) { blocked = true; break; }
        sleep(4);
    }
    const waitNow = countUnpaid(ctx.adminToken, acct.userId).unpaid;
    if (blocked)
        return R(caseName, acct, `风控后最后一批未支付=${n}笔应更新`, `再发起被拦(未设限却10068?)，无法构造${n}笔`, false, `unpaidNow=${waitNow}`);
    console.log(`[${TAG}] ${caseName} userId=${acct.userId} 再发${fired}笔，当前未支付=${waitNow}，等轮询看是否更新...`);

    // 等下一个轮询看是否更新
    const start = Date.now();
    const dl = start + POLL_SEC * 1000;
    let rec2 = enter.rec, updated = false;
    while (Date.now() < dl) {
        sleep(POLL_INTERVAL);
        const rr = getPullMonitorRecord(ctx.adminToken, acct.userId, info.startStr, info.endStr);
        if (rr) {
            rec2 = rr;
            if (rr.pullOrderCount > pull0 || (lastUpd0 && rr.lastUpdateTime > lastUpd0)) { updated = true; break; }
        }
        console.log(`[${TAG}] ${caseName} userId=${acct.userId} 等表单更新中... 当前表单pull=${rec2 && rec2.pullOrderCount}(进表时${pull0})，已等${Math.round((Date.now() - start) / 1000)}s`);
    }
    // 对比表单数据 vs 后台真实数据（核心：数据是否对应得上）
    const realTotal = countTodayOrders(ctx.adminToken, acct.userId, '');
    const realPaid = countTodayOrders(ctx.adminToken, acct.userId, 'Payed');
    const formPull = rec2 ? rec2.pullOrderCount : -1;
    const formPaid = rec2 ? rec2.paidOrderCount : -1;
    const pullDelta = formPull - pull0;
    const matched = Math.abs(formPull - realTotal) <= 1;   // 表单 pull 与后台真实累计基本一致
    const pass = updated && matched;
    const actual = `进表pull=${pull0}；再发${fired}笔使当前未支付=${waitNow}；轮询后 表单pull=${formPull}(Δ+${pullDelta}),表单paid=${formPaid}；后台真实 total=${realTotal},paid=${realPaid}；${updated ? '已更新' : '未更新✗'}，${matched ? '表单与后台一致✓' : '❗表单与后台对应不上✗'}`;
    return R(caseName, acct, `风控后最后一批未支付=${n}笔→表单更新且与后台一致`, actual, pass,
        `waitNow=${waitNow},formPull=${formPull},realTotal=${realTotal},pullDelta=${pullDelta}`);
}

const DISPATCH = {
    trigger: caseTrigger,
    no_trigger: caseNoTrigger,
    cancel_still_trigger: caseCancelStillTrigger,
    limit_block: caseLimitBlock,
    no_limit_pass: caseNoLimitPass,
    limit_bounds: caseLimitBounds,
    limit_increase_absolute: caseLimitIncrease,
    limit_decrease_reject: caseLimitDecrease,
    paid_reduce_no_trigger: casePaidReduceNoTrigger,
    paid_partial_trigger: casePaidPartialTrigger,
    paid_during_no_release: casePaidDuringNoRelease,
    paid_after_limit: casePaidAfterLimit,
    data_keeps_updating: caseDataKeepsUpdating,
    update_last_4: (a, c) => caseUpdateLastBatch(a, c, 4, 'update_last_4'),
    update_last_5: (a, c) => caseUpdateLastBatch(a, c, 5, 'update_last_5'),
    update_last_6: (a, c) => caseUpdateLastBatch(a, c, 6, 'update_last_6'),
    cross_day: caseCrossDay,
    dubai_release: caseDubaiRelease,
};

// ================= Setup / VU =================
function registerAccount(ctx) {
    for (let a = 1; a <= 3; a++) {
        const phone = generateRandomPhone(ctx.countryCode);
        const res = phoneRegister(phone, ctx.adminData, 'qwer1234', '', null, generateCryptoRandomString(16), '');
        const token = extractToken(res);
        if (token) {
            const infoUser = getFrontUserInfo(token);
            if (infoUser && infoUser.userId) return { phone, token, userId: infoUser.userId };
        }
        sleep(1 + a);
    }
    return null;
}

export function setup() {
    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[${TAG}] 租户 ${TENANT_ID} 管理员登录失败`);

    const countryCode = __ENV.COUNTRY_CODE || envConfig.COUNTRY_CODE || '91';
    const adminData = { token: adminToken, envConfig };
    const ctx = { countryCode, adminData };

    console.log(`[${TAG}] 阈值=${THRESHOLD}(累计未支付>${THRESHOLD}触发), 用例=${CASE_LIST.join(',')}`);
    const accounts = [];
    for (let i = 0; i < CASE_LIST.length; i++) {
        const acct = registerAccount(ctx);
        if (!acct) throw new Error(`[${TAG}] 用例 ${CASE_LIST[i]} 账号注册失败`);
        console.log(`[${TAG}] 用例 ${CASE_LIST[i]} → 账号 ${acct.phone} (userId=${acct.userId})`);
        accounts.push(acct);
        sleep(1);
    }
    return { adminToken, envConfig, accounts };
}

export default function (data) {
    const { adminToken, envConfig, accounts } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const vuIndex = (exec.vu.idInInstance - 1) % CASE_LIST.length;
    const caseName = CASE_LIST[vuIndex];
    const acct = accounts[vuIndex];
    const ctx = { adminToken, envConfig };

    const fn = DISPATCH[caseName];
    if (!fn) { R(caseName, acct, '(未知用例)', '无对应实现', false); return; }
    if (!acct) { R(caseName, null, '有账号', '账号缺失', false); return; }

    console.log(`[${TAG}] VU${exec.vu.idInInstance} 执行用例 ${caseName} 账号 userId=${acct.userId}`);
    fn(acct, ctx);
}
