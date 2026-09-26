/**
 * 邀请下级 · 6 个测试用例(邀请 + 充值 + 投注,为触发自动通知造数)
 *
 * 你只需提供【一个普通邀请码】:
 *   - 代理邀请   : 下级直接用你的邀请码注册
 *   - 邀请转盘   : 下级用【邀请码末位补 W】派生的转盘码注册(纯字符串派生,不碰上级账号)
 * 所有下级都是【直属下级】。不登录/不操作你的上级账号。
 * 「同时邀请」用 k6 原生 http.batch 并发注册实现(真正同时发出);充值/投注在注册后逐个进行。
 * 每个下级流程: 注册 → 充值(随机 100~1000) → 投注(随机 100~600)。
 *
 * ┌──────┬────────┬────────┬──────────────────────────────────────────┐
 * │ 用例 │  方式  │ 下级数 │ 节奏(注册后每人都充值+投注)               │
 * ├──────┼────────┼────────┼──────────────────────────────────────────┤
 * │  1   │ 转盘   │   3    │ 串行,每个之间间隔 5s                        │
 * │  2   │ 代理   │   3    │ 串行,每个之间间隔 5s                        │
 * │  3   │ 转盘   │   5    │ 5 个同时注册(并发)                         │
 * │  4   │ 代理   │   5    │ 5 个同时注册(并发)                         │
 * │  5   │ 转盘   │  50    │ 分批并发(每批 3/5/10 轮换),批次之间间隔 2s │
 * │  6   │ 代理   │  50    │ 串行,每个之间间隔 3~5s 随机                 │
 * └──────┴────────┴────────┴──────────────────────────────────────────┘
 *
 * ============ 每个用例的独立执行命令(把 ASDCR8N 换成你的邀请码)============
 *   用例1: k6 run -e TENANT_ID=3004 -e INVITE_CODE=ASDCR8N -e CASE=1 inviteDownlineCases.test.js
 *   用例2: k6 run -e TENANT_ID=3004 -e INVITE_CODE=ASDCR8N -e CASE=2 inviteDownlineCases.test.js
 *   用例3: k6 run -e TENANT_ID=3004 -e INVITE_CODE=ASDCR8N -e CASE=3 inviteDownlineCases.test.js
 *   用例4: k6 run -e TENANT_ID=3004 -e INVITE_CODE=ASDCR8N -e CASE=4 inviteDownlineCases.test.js
 *   用例5: k6 run -e TENANT_ID=3004 -e INVITE_CODE=ASDCR8N -e CASE=5 inviteDownlineCases.test.js
 *   用例6: k6 run -e TENANT_ID=3004 -e INVITE_CODE=ASDCR8N -e CASE=6 inviteDownlineCases.test.js
 *
 * 可选参数:
 *   -e TOTAL=50          用例5/6 的总人数(默认 50)
 *   -e STEP_INTERVAL=5   用例1/2 的间隔秒数(默认 5)
 *   -e BATCH_GAP=2       用例5 批次间隔秒数(默认 2)
 *   -e RECHARGE_MIN=100 -e RECHARGE_MAX=1000   充值随机范围(默认 100~1000)
 *   -e BET_MIN=100 -e BET_MAX=600              投注随机范围(默认 100~600,取 10 的倍数)
 *   -e RECHARGE=0        关闭充值(同时会跳过投注)
 *   -e BET=0             关闭投注(只注册+充值)
 */

import http from 'k6/http';
import { sleep } from 'k6';
import { SignatureUtil } from '../../../libs/utils/signature.js';
import { getTimeRandom, generateCryptoRandomString } from '../../utils/utils.js';
import { generateRandomPhone } from '../../utils/accountGeneratorFaker.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { AdminLogin } from '../login/adminlogin.test.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { hybridRecharge } from '../recharge/rechargeService.js';
// 投注底层(复用 runbet,不改动)
import { getBetToken } from '../runbet/betToken.js';
import { betWingo } from '../runbet/bet.js';
import { isBet } from '../runbet/issueNumber.js';
import { getAccountBalance } from '../balance/balance.test.js';

const TAG = 'InviteCases';

const TENANT_ID = __ENV.TENANT_ID || __ENV.TENANT || '3004';
const INVITE_CODE = (__ENV.INVITE_CODE || '').trim();
const CASE = String(__ENV.CASE || '1');
const TOTAL = parseInt(__ENV.TOTAL, 10) || 50;             // 用例5/6 总人数
const STEP_INTERVAL = parseInt(__ENV.STEP_INTERVAL, 10) || 5; // 用例1/2 间隔
const BATCH_GAP = parseInt(__ENV.BATCH_GAP, 10) || 2;      // 用例5 批次间隔

// 充值 / 投注 金额范围
const RECHARGE_MIN = parseInt(__ENV.RECHARGE_MIN, 10) || 100;
const RECHARGE_MAX = parseInt(__ENV.RECHARGE_MAX, 10) || 1000;
const BET_MIN = parseInt(__ENV.BET_MIN, 10) || 100;
const BET_MAX = parseInt(__ENV.BET_MAX, 10) || 600;
const DO_RECHARGE = __ENV.RECHARGE !== '0';
const DO_BET = __ENV.BET !== '0';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

// 每个用例的最大运行时长(含充值+投注耗时)
const DURATION = { '1': '10m', '2': '10m', '3': '5m', '4': '5m', '5': '20m', '6': '30m' };

export const options = {
    scenarios: {
        ['case_' + CASE]: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: DURATION[CASE] || '20m'
        }
    }
};

// ================= 工具 =================

function getEnv() {
    return getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
}

/** 转盘邀请码 = 普通邀请码末位替换成 W */
function toWheelCode(code) {
    return code.slice(0, -1) + 'W';
}

/** 随机整数 [min, max] */
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 固定金额投注(复用 runbet 底层,多游戏重试);投注额 = unit × multiple
 * @returns {object|false} 成功返回 { amount, gameCode }
 */
function betFixed(loginToken, unit, multiple, userName) {
    if (!loginToken) return false;
    const target = unit * multiple;

    const balanceInfo = getAccountBalance(loginToken);
    if (!balanceInfo || balanceInfo.balance < target) {
        console.error(`[${TAG}] 投注前余额不足(${balanceInfo ? balanceInfo.balance : 'N/A'} < ${target}): ${userName}`);
        return false;
    }

    const games = ['WinGo_5M', 'WinGo_30S', 'TrxWinGo_10M'];
    const contents = ['BigSmall_Big', 'BigSmall_Small', 'Color_Green', 'Color_Red'];

    for (let i = 0; i < games.length; i++) {
        const gameCode = games[i];
        const tokenInfo = getBetToken(loginToken, gameCode);
        if (!tokenInfo || !tokenInfo.token) continue;

        const betInfo = isBet(tokenInfo.gameToken, gameCode, tokenInfo.gameBaseUrl);
        if (!betInfo || !betInfo.canBet) continue;

        const betContent = contents[Math.floor(Math.random() * contents.length)];
        const r = betWingo(gameCode, unit, multiple, betContent, betInfo.issueNumber, tokenInfo.token, tokenInfo.gameBaseUrl);
        if (r && r.code === 0 && r.msgCode === 0 && r.msg === 'Succeed') {
            console.log(`[${TAG}] ✅ 投注成功 ${userName}: ${gameCode} ${betContent} 金额=${target}`);
            return { amount: target, gameCode };
        }
    }
    console.error(`[${TAG}] ❌ 投注失败(所有游戏均不可投): ${userName}`);
    return false;
}

/**
 * 构造一个「邀请注册」请求(手机号 + 指定邀请码 + 独立设备),
 * payload/签名/URL/headers 与 httpClient 的邀请注册完全一致(签名密钥为空)。
 */
function buildRegisterRequest(inviteCode, env) {
    const phone = generateRandomPhone(env.COUNTRY_CODE || '91');
    const deviceId = generateCryptoRandomString(16);  // 每个下级独立设备,保证有效邀请
    const browserId = generateCryptoRandomString(32);
    const timeData = getTimeRandom();

    const payload = {
        userName: phone,
        inviteCode: inviteCode,
        loginType: 'Mobile',
        turnstileToken: '',
        password: 'qwer1234',
        code: '',
        deviceId: deviceId,
        browserId: browserId,
        language: timeData.language,
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };

    // 与后端一致:过滤 signature/timestamp/track+空值 → key 排序 → JSON → MD5 大写(空密钥)
    const signed = SignatureUtil.signRequest(payload, '');

    // 邀请注册专用域名优先(INVITE_REGISTER_URL),否则前台域
    const domain = env.INVITE_REGISTER_URL || env.BASE_DESK_URL;
    const url = domain + '/api/Home/Register';

    const req = {
        method: 'POST',
        url: url,
        body: JSON.stringify(signed),
        params: {
            headers: {
                'Content-Type': 'application/json',
                'Connection': 'keep-alive',
                'User-Agent': UA,
                'Domainurl': domain,
                'Referrer': domain
            },
            tags: { name: 'InviteRegister' }
        }
    };

    return { phone, deviceId, req };
}

/** 解析注册响应 → { ok, msg, token } */
function parseResult(resp) {
    try {
        const b = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body;
        if (!b) return { ok: false, msg: `空响应(status=${resp.status})`, token: null };
        const code = b.code !== undefined ? b.code : b.msgCode;
        const token = b.data && b.data.token ? b.data.token : null;
        return { ok: code === 0, msg: b.msg || `code=${code}`, token: token };
    } catch (e) {
        return { ok: false, msg: `解析失败(status=${resp.status})`, token: null };
    }
}

/**
 * 并发注册 count 个下级(一次 http.batch,真正「同时」发出)
 * @returns {Array<{account, deviceId, ok, msg, token, userId, recharged, rechargeAmount, betted, betAmount}>}
 */
function registerBatch(inviteCode, count, env, label) {
    const items = [];
    for (let i = 0; i < count; i++) items.push(buildRegisterRequest(inviteCode, env));

    const responses = http.batch(items.map((x) => x.req));

    const results = [];
    responses.forEach((resp, i) => {
        const r = parseResult(resp);
        results.push({
            account: items[i].phone, deviceId: items[i].deviceId,
            ok: r.ok, msg: r.msg, token: r.token,
            userId: null, recharged: false, rechargeAmount: 0, betted: false, betAmount: 0
        });
        console.log(`[${TAG}] ${r.ok ? '✅' : '❌'} ${label} 注册 ${items[i].phone} ${r.ok ? '成功' : '失败: ' + r.msg}`);
    });
    return results;
}

/** 对一个注册成功的下级执行: 取 userId → 充值(100~1000) → 投注(100~600) */
function doRechargeAndBet(sub, adminToken, label) {
    if (!sub.ok || !sub.token) return;

    // 取下级 userId(充值需要)
    const info = getFrontUserInfo(sub.token);
    sub.userId = info && info.userId ? info.userId : null;
    if (!sub.userId) {
        console.error(`[${TAG}] ⚠️ 取 userId 失败,跳过充值投注: ${sub.account}`);
        return;
    }

    // 金额: 投注取 10 的倍数(100~600),充值(100~1000)且保证 >= 投注,确保能投注
    const betLo = Math.max(1, Math.floor(BET_MIN / 10));
    const betHi = Math.max(betLo, Math.floor(BET_MAX / 10));
    const multiple = randInt(betLo, betHi);
    const betAmount = 10 * multiple;
    const rechargeAmount = randInt(Math.max(RECHARGE_MIN, betAmount), RECHARGE_MAX);

    // 充值
    if (DO_RECHARGE) {
        console.log(`[${TAG}] 💰 充值 ${label} ${sub.account}: userId=${sub.userId}, amount=${rechargeAmount}`);
        const rc = hybridRecharge({
            userToken: sub.token, adminToken, userId: sub.userId,
            amount: rechargeAmount, frontendFirst: true, remark: `${TAG}-${label}`
        });
        sub.recharged = !!(rc && rc.success);
        sub.rechargeAmount = sub.recharged ? (rc.amount || rechargeAmount) : 0;
        if (sub.recharged) console.log(`[${TAG}] ✅ 充值成功 ${sub.account}: ${sub.rechargeAmount}(${rc.method || '-'})`);
        else console.error(`[${TAG}] ❌ 充值失败 ${sub.account}: ${rc && rc.message ? rc.message : '未知'}`);
        sleep(2);
    }

    // 投注(充值成功才投)
    if (DO_BET && sub.recharged) {
        console.log(`[${TAG}] 🎲 投注 ${label} ${sub.account}: 目标=${betAmount}`);
        const bet = betFixed(sub.token, 10, multiple, sub.account);
        sub.betted = !!bet;
        sub.betAmount = bet ? bet.amount : 0;
        sleep(1);
    }
}

/** 邀请一批下级(同时注册 count 个)→ 逐个充值+投注 */
function inviteAndProcess(code, count, env, adminToken, label) {
    const subs = registerBatch(code, count, env, label);
    sleep(1); // 等账号数据同步
    for (const sub of subs) {
        if (sub.ok) doRechargeAndBet(sub, adminToken, label);
    }
    return subs;
}

// ================= 各用例执行器 =================

/** 串行:逐个(注册+充投),每个之间固定间隔 intervalSec 秒 */
function runSerial(code, total, intervalSec, adminToken, label) {
    const all = [];
    for (let i = 1; i <= total; i++) {
        console.log(`\n[${TAG}] —— ${label} 第 ${i}/${total} 个 ——`);
        all.push(...inviteAndProcess(code, 1, getEnv(), adminToken, label));
        if (i < total) {
            console.log(`[${TAG}] ⏳ 间隔 ${intervalSec}s ...`);
            sleep(intervalSec);
        }
    }
    return all;
}

/** 串行:逐个(注册+充投),每个之间随机 [minSec, maxSec] 秒 */
function runSerialRandom(code, total, minSec, maxSec, adminToken, label) {
    const all = [];
    for (let i = 1; i <= total; i++) {
        console.log(`\n[${TAG}] —— ${label} 第 ${i}/${total} 个 ——`);
        all.push(...inviteAndProcess(code, 1, getEnv(), adminToken, label));
        if (i < total) {
            const gap = randInt(minSec, maxSec);
            console.log(`[${TAG}] ⏳ 间隔 ${gap}s ...`);
            sleep(gap);
        }
    }
    return all;
}

/** 并发:一次性同时注册 count 个,再逐个充值+投注 */
function runConcurrent(code, count, adminToken, label) {
    console.log(`\n[${TAG}] —— ${label} 同时邀请 ${count} 个 ——`);
    return inviteAndProcess(code, count, getEnv(), adminToken, label);
}

/** 分批并发:总数 total,每批大小在 sizes 中轮换,批次之间间隔 gapSec 秒 */
function runBatched(code, total, sizes, gapSec, adminToken, label) {
    const all = [];
    let done = 0;
    let idx = 0;
    let batchNo = 0;
    while (done < total) {
        const size = Math.min(sizes[idx % sizes.length], total - done);
        batchNo++;
        console.log(`\n[${TAG}] —— ${label} 第 ${batchNo} 批: 同时 ${size} 个 (已完成 ${done}/${total}) ——`);
        all.push(...inviteAndProcess(code, size, getEnv(), adminToken, label));
        done += size;
        idx++;
        if (done < total) {
            console.log(`[${TAG}] ⏳ 批次间隔 ${gapSec}s ...`);
            sleep(gapSec);
        }
    }
    return all;
}

// ================= Setup / VU =================

export function setup() {
    console.log(`\n${'='.repeat(72)}`);
    console.log(`[${TAG}] 邀请下级用例  CASE=${CASE}  租户=${TENANT_ID}  邀请码=${INVITE_CODE || '(未提供!)'}`);
    console.log(`[${TAG}] 充值=${DO_RECHARGE ? `${RECHARGE_MIN}~${RECHARGE_MAX}` : '关'}  投注=${DO_BET ? `${BET_MIN}~${BET_MAX}` : '关'}`);
    console.log('='.repeat(72));

    if (!INVITE_CODE) {
        throw new Error(`[${TAG}] ❌ 必须提供邀请码: -e INVITE_CODE=xxxx`);
    }

    const env = getEnv();
    if (TENANT_ID !== '3004') {
        Object.assign(ENV_CONFIG, env);
        console.log(`[${TAG}] ✅ ENV_CONFIG 切换为租户 ${TENANT_ID}`);
    }
    console.log(`[${TAG}] 注册域名: ${env.INVITE_REGISTER_URL || env.BASE_DESK_URL}`);

    // 充值需要后台 adminToken
    let adminToken = null;
    if (DO_RECHARGE) {
        adminToken = AdminLogin();
        if (!adminToken) throw new Error(`[${TAG}] ❌ 管理员登录失败(充值需要 adminToken)`);
        console.log(`[${TAG}] ✅ 管理员登录成功`);
    }

    return { env, adminToken };
}

export default function (data) {
    const env = data.env || getEnv();
    const adminToken = data.adminToken;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, env);

    const agentCode = INVITE_CODE;              // 代理邀请: 原码
    const wheelCode = toWheelCode(INVITE_CODE); // 转盘邀请: 末位补 W

    let results = [];
    let title = '';

    switch (CASE) {
        case '1': // 转盘 3 个,串行隔 5s
            title = `用例1 · 邀请转盘 · 3个 · 串行隔${STEP_INTERVAL}s`;
            console.log(`[${TAG}] 🎡 转盘邀请码: ${agentCode} → ${wheelCode}`);
            results = runSerial(wheelCode, 3, STEP_INTERVAL, adminToken, '邀请转盘');
            break;
        case '2': // 代理 3 个,串行隔 5s
            title = `用例2 · 代理邀请 · 3个 · 串行隔${STEP_INTERVAL}s`;
            results = runSerial(agentCode, 3, STEP_INTERVAL, adminToken, '代理邀请');
            break;
        case '3': // 转盘 5 个同时
            title = '用例3 · 邀请转盘 · 5个同时';
            console.log(`[${TAG}] 🎡 转盘邀请码: ${agentCode} → ${wheelCode}`);
            results = runConcurrent(wheelCode, 5, adminToken, '邀请转盘');
            break;
        case '4': // 代理 5 个同时
            title = '用例4 · 代理邀请 · 5个同时';
            results = runConcurrent(agentCode, 5, adminToken, '代理邀请');
            break;
        case '5': // 邀请转盘,50 人,分批 3/5/10 并发,批次隔 2s
            title = `用例5 · 邀请转盘 · ${TOTAL}人 · 分批(3/5/10)并发 · 批次隔${BATCH_GAP}s`;
            console.log(`[${TAG}] 🎡 转盘邀请码: ${agentCode} → ${wheelCode}`);
            results = runBatched(wheelCode, TOTAL, [3, 5, 10], BATCH_GAP, adminToken, '邀请转盘');
            break;
        case '6': // 代理,50 人,串行隔 3~5s
            title = `用例6 · 代理邀请 · ${TOTAL}人 · 串行隔3~5s`;
            results = runSerialRandom(agentCode, TOTAL, 3, 5, adminToken, '代理邀请');
            break;
        default:
            throw new Error(`[${TAG}] ❌ 未知 CASE=${CASE},可选 1~6`);
    }

    printSummary(title, results);
}

// ================= 打印汇总 =================

function printSummary(title, results) {
    const ok = results.filter((r) => r.ok);
    const recharged = results.filter((r) => r.recharged);
    const betted = results.filter((r) => r.betted);
    const dline = '═'.repeat(72);

    console.log('\n' + dline);
    console.log(`  📊 ${title}    租户 ${TENANT_ID}`);
    console.log(`  ✅ 注册 ${ok.length}/${results.length}   💰 充值 ${recharged.length}   🎲 投注 ${betted.length}`);
    console.log(dline);
    results.forEach((r, i) => {
        const reg = r.ok ? '✅' : '❌';
        const rec = r.recharged ? r.rechargeAmount : (DO_RECHARGE && r.ok ? '❌' : '-');
        const bet = r.betted ? r.betAmount : (DO_BET && r.recharged ? '❌' : '-');
        console.log(`   [${i + 1}] ${reg} ${r.account} | userId=${r.userId || '-'} | 充值=${rec} | 投注=${bet}${r.ok ? '' : ' (' + r.msg + ')'}`);
    });
    console.log(dline);
}
