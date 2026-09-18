/**
 * 邀请转盘「每天 00 点免费次数发放」验证 —— k6 脚本
 *
 * 需求：提供一个已有账号 → 前台密码登录 → (可选)等到印度时间跨过 00:00 →
 *      循环请求 /api/Activity/GetUserInvitedWheelInfo 最多 5 次(每次隔 3 分钟)，
 *      看响应 data.userInvitedWheelCount：
 *        ≥1 = 已发放当天免费次数(PASS)；0 = 未发放(FAIL)。
 *      每 3 分钟轮询是因为 00 点派发不一定立即到账（后台发放定时任务要跑一会儿，约几分钟）；
 *      5 次(约 12~15min)仍为 0 则报错，提示排查发放定时任务。
 *
 * 时区：服务器印度 UTC+5:30；「00 点」按印度时区判断。
 *
 * 用法：node inviteWheelDailyGrantRunner.js --tenant 3004 --phone 917718003385
 *      node inviteWheelDailyGrantRunner.js --tenant 3004 --phone 911295019940 --wait-midnight 1 --max-duration 12h
 *      跨天验证(临近印度午夜启动，脚本等跨过 00:00 再查)：--wait-midnight 1 --max-duration 2h
 *      ⚠️ --wait-midnight 1 时必须把 --max-duration 调到能覆盖「从启动到下一个印度 00:00 + 循环耗时」。
 */

import { sleep } from 'k6';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { sendRequest } from '../../common/request.js';
import { loginWithPassword } from '../../recharge/rechargeLevel.service.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const TAG = 'InviteWheelDailyGrant';
const PHONE = __ENV.PHONE || '';
const PASSWORD = __ENV.PASSWORD || 'qwer1234';
const WAIT_MIDNIGHT = __ENV.WAIT_MIDNIGHT === '1';
const POLL_TIMES = Number(__ENV.POLL_TIMES || 5);   // 循环请求次数
const POLL_GAP = Number(__ENV.POLL_GAP || 180);     // 每次间隔秒（默认 3 分钟；00点派发可能延迟约3min）
const INDIA_OFFSET_MS = 5.5 * 3600 * 1000;

export const options = {
    setupTimeout: '2m',
    scenarios: {
        daily_grant: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            // 默认 20m 够「不等午夜」模式(5次×3min≈12~15min)；--wait-midnight 1 时必须由 runner 传更大 --max-duration
            maxDuration: __ENV.MAX_DURATION || '20m',
        },
    },
};

function pad2(n) { return String(n).padStart(2, '0'); }
function indiaDateStr(ts) {
    const d = new Date((ts == null ? Date.now() : ts) + INDIA_OFFSET_MS);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function indiaTimeStr(ts) {
    const d = new Date((ts == null ? Date.now() : ts) + INDIA_OFFSET_MS);
    return `${indiaDateStr(ts)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}
function R(caseName, phone, expect, actual, pass, detail) {
    console.log(`##R##${caseName}|${phone}|${expect}|${actual}|${pass ? 'PASS' : 'FAIL'}|${detail || ''}`);
}

/** 查邀请转盘信息，返回 userInvitedWheelCount（拿不到返回 -1） */
function getWheelCount(token) {
    const resp = sendRequest({}, '/api/Activity/GetUserInvitedWheelInfo', 'GetUserInvitedWheelInfo', true, token);
    if (!resp) return { count: -1, data: null };
    const data = (resp.data !== undefined) ? resp.data : resp; // sendRequest 有 data 时返回 data 本身
    const count = (data && data.userInvitedWheelCount != null) ? data.userInvitedWheelCount : -1;
    return { count, data };
}

export function setup() {
    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);
    if (!PHONE) throw new Error(`[${TAG}] 必须用 --phone 提供账号`);
    const token = loginWithPassword(PHONE, PASSWORD);
    if (!token) throw new Error(`[${TAG}] 账号 ${PHONE} 登录失败`);
    console.log(`[${TAG}] 账号 ${PHONE} 登录成功，印度当前时间=${indiaTimeStr()}，wait_midnight=${WAIT_MIDNIGHT}`);
    return { token, envConfig };
}

export default function (data) {
    const { token, envConfig } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    // 可选：等到印度时间跨过下一个 00:00（跨天发放验证；请临近午夜启动，否则会等很久）
    if (WAIT_MIDNIGHT) {
        const startDay = indiaDateStr();
        console.log(`[${TAG}] 等待印度跨过 00:00（启动日=${startDay}，当前=${indiaTimeStr()}）...`);
        const deadline = Date.now() + 26 * 3600 * 1000;
        while (Date.now() < deadline) {
            if (indiaDateStr() !== startDay) break;
            console.log(`[${TAG}] 等跨天中... 当前印度=${indiaTimeStr()}`);
            sleep(60);
        }
        if (indiaDateStr() === startDay) {
            R('invited_wheel_daily_grant', PHONE, 'userInvitedWheelCount≥1', '等待超时仍未跨过印度00:00(异常)', false);
            return;
        }
        console.log(`[${TAG}] 已跨天，当前印度=${indiaTimeStr()}，开始查发放...`);
    }

    // 循环请求，防止 00 点发放定时任务还没跑完
    const seq = [];
    let count = -1, granted = false;
    for (let i = 0; i < POLL_TIMES; i++) {
        const r = getWheelCount(token);
        count = r.count;
        seq.push(count);
        console.log(`[${TAG}] 第${i + 1}/${POLL_TIMES}次查询 userInvitedWheelCount=${count}（印度=${indiaTimeStr()}）`);
        if (count >= 1) { granted = true; break; }
        if (i < POLL_TIMES - 1) sleep(POLL_GAP);
    }
    const gapMin = (POLL_GAP / 60).toFixed(0);
    const actual = granted
        ? `userInvitedWheelCount=${count}（已发放当天免费次数）`
        : `❌ 每${gapMin}分钟轮询${seq.length}次仍未发放免费次数，count序列=[${seq.join(',')}] → 请排查 00 点发放定时任务`;
    R('invited_wheel_daily_grant', PHONE, 'userInvitedWheelCount≥1(00点后已发放免费次数)', actual, granted, `seq=[${seq.join(',')}],gap=${POLL_GAP}s`);
}
