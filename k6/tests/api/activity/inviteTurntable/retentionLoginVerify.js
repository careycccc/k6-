/**
 * 邀请转盘 - 真实留存核验（以后台登录日志为准）
 *
 * 背景：多人共用后台，别人可能登录了"我造的号"，而本地 txt 只在脚本自己触发登录时才写，
 *       导致本地统计的留存偏低。本脚本改用后台登录日志 /api/RptUserInfo/GetUserLoginLogPageList
 *       来判定"某号某天是否真的登录过"，得到真实留存。
 *
 * 口径（用户确认）：第一天 = 玩转盘的人(participants_dayNN.txt)；后续天 = 只要登录了就算；连续。
 *   - 次日留存 = 基期号里 第二天登录 的人数
 *   - 三日留存 = 基期号里 第二、三天都登录 的人数（连续）
 *
 * 用法（在本目录运行）：
 *   k6 run -e TENANT_ID=3004 retentionLoginVerify.js                       # 默认 day1 + 9.9/9.10/9.11
 *   k6 run -e TENANT_ID=3004 -e PART_FILE=./retention/participants_day02.txt -e DAYS=2026-09-10,2026-09-11,2026-09-12 retentionLoginVerify.js
 *   （或用 node retentionLoginRunner.js 拿干净报表 + 落档）
 */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { sendRequest } from '../../common/request.js';
import { loginWithPassword } from '../../recharge/rechargeLevel.service.js';
import { getFrontUserInfo } from '../../user/userManagement.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const TAG = 'RetLoginVerify';
const PAGE_SIZE = 500;
const MAX_SCAN_PAGES = 50;

// 基期号文件（第一天玩转盘的人）
const PART_FILE = __ENV.PART_FILE || './retention/participants_day01.txt';
const PHONES = open(PART_FILE).split(/\r?\n/).map(s => s.trim()).filter(Boolean);

// 要检查的自然日：[0]=第一天(基期日) [1]=第二天 [2]=第三天
const DAYS = (__ENV.DAYS || '2026-09-09,2026-09-10,2026-09-11').split(',').map(s => s.trim());

export const options = {
    scenarios: { v: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '30m' } }
};

// ---------- 工具 ----------
function extractList(res) {
    if (!res) return [];
    if (res.data && Array.isArray(res.data.list)) return res.data.list;
    if (Array.isArray(res.list)) return res.list;
    if (Array.isArray(res)) return res;
    return [];
}
function extractTotalPage(res) {
    if (!res) return 1;
    if (res.totalPage) return res.totalPage;
    if (res.data && res.data.totalPage) return res.data.totalPage;
    return 1;
}

/** 某自然日全站「登录用户」userId 集：GetUserLoginLogPageList（照 retentionVerify 口径） */
function fetchLoginUsers(token, dateStr) {
    const api = '/api/RptUserInfo/GetUserLoginLogPageList';
    const set = new Set();
    let pageNo = 1;
    while (pageNo <= MAX_SCAN_PAGES) {
        const payload = {
            memberIdType: 1,
            startTime: `${dateStr} 00:00:00`,
            endTime: `${dateStr} 23:59:59`,
            pageNo, pageSize: PAGE_SIZE, orderBy: 'Desc'
        };
        const res = sendRequest(payload, api, TAG, false, token);
        const list = extractList(res);
        for (const it of list) {
            if (it.userId != null && (!it.loginDate || it.loginDate === dateStr)) set.add(Number(it.userId));
        }
        const tp = extractTotalPage(res);
        if (pageNo >= tp || list.length === 0) break;
        pageNo++;
        sleep(0.3);
    }
    return set;
}

/** 手机号 → userId：先用 Users/GetPageList{userName} 精确查；查不到再登录兜底 */
function resolveUserId(token, phone) {
    const res = sendRequest({ userName: phone, pageNo: 1, pageSize: 20, orderBy: 'Desc' }, '/api/Users/GetPageList', TAG, false, token);
    const list = extractList(res);
    for (const u of list) {
        if (u.userId != null && String(u.userName) === phone) return { uid: Number(u.userId), via: 'query' };
    }
    if (list.length === 1 && list[0].userId != null) return { uid: Number(list[0].userId), via: 'query1' };
    // 兜底：登录（会产生"今天"的登录记录，不影响历史日期查询）
    const t = loginWithPassword(phone, 'qwer1234');
    if (t) {
        const info = getFrontUserInfo(t);
        if (info && info.userId) return { uid: Number(info.userId), via: 'login' };
    }
    return null;
}

// ---------- Setup / VU ----------
export function setup() {
    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const token = tenantAdminLogin(TENANT_ID);
    if (!token) throw new Error(`[${TAG}] 租户 ${TENANT_ID} 管理员登录失败`);
    return { token };
}

export default function (data) {
    const token = data.token;
    console.log(`##R## 基期文件=${PART_FILE}  号数=${PHONES.length}  检查天=${DAYS.join(' / ')}`);

    // 1) 手机号 → userId
    const ids = [];
    const id2phone = {};
    const miss = [];
    let viaLogin = 0;
    for (const phone of PHONES) {
        const r = resolveUserId(token, phone);
        if (r) { ids.push(r.uid); id2phone[r.uid] = phone; if (r.via === 'login') viaLogin++; }
        else { miss.push(phone); }
        sleep(0.2);
    }
    console.log(`##R## userId解析成功=${ids.length}  登录兜底=${viaLogin}  失败=${miss.length}${miss.length ? (' [' + miss.join(',') + ']') : ''}`);

    // 2) 每天全站登录 userId 集
    const sets = DAYS.map(d => ({ d, set: fetchLoginUsers(token, d) }));
    sets.forEach(x => console.log(`##R## ${x.d} 全站登录人数=${x.set.size}`));

    const d1 = sets[0] ? sets[0].set : new Set();
    const d2 = sets[1] ? sets[1].set : new Set();
    const d3 = sets[2] ? sets[2].set : new Set();

    // 3) 逐号判定 + 汇总
    let day1Login = 0, nextRet = 0, thirdRet = 0;
    console.log(`##ROW## phone,userId,${DAYS[0]},${DAYS[1] || 'd2'},${DAYS[2] || 'd3'}`);
    for (const uid of ids) {
        const in1 = d1.has(uid), in2 = d2.has(uid), in3 = d3.has(uid);
        if (in1) day1Login++;
        if (in2) nextRet++;              // 次日留存：第二天登录（基期已是玩转盘的人）
        if (in2 && in3) thirdRet++;      // 三日留存：第二、三天都登录（连续）
        console.log(`##ROW## ${id2phone[uid]},${uid},${in1 ? 1 : 0},${in2 ? 1 : 0},${in3 ? 1 : 0}`);
    }

    const base = ids.length;
    const pct = (a) => base ? (100 * a / base).toFixed(2) + '%' : '0%';
    console.log(`##SUM## 基期(玩转盘)号数=${PHONES.length}  能解析userId=${base}`);
    console.log(`##SUM## 第一天(${DAYS[0]})实际登录=${day1Login}  (玩转盘=已登录，应≈全部；缺的可能是号异常)`);
    console.log(`##SUM## 次日留存(${DAYS[1]}登录)=${nextRet}  留存率=${pct(nextRet)}`);
    console.log(`##SUM## 三日留存(${DAYS[1]}且${DAYS[2]}都登录)=${thirdRet}  留存率=${pct(thirdRet)}`);
}
