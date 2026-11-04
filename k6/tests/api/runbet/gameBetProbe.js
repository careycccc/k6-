/**
 * 投注能力探测 —— 用项目现有的投注方式，逐个游戏真实下注，看哪些能投、哪些不能
 *
 * 为什么需要它：项目里所有投注(betRun / betFixed / 底层三件套)都只打 ARLottery 这一个
 * 厂商，而且各脚本只验证过 WinGo/TrxWinGo。要给某个租户设计"指定游戏"的测试计划，
 * 必须先知道这个租户到底哪些游戏码能走通"开游戏→拿期号→下注"这条链。
 *
 * 做什么（会真实注册、真实充值、真实下注，花的是测试站的钱）：
 *   1. 注册一个新账号(或用 -e ACCOUNT/-e PASSWORD 复用已有账号)
 *   2. 充值一笔(默认 5000)
 *   3. 对每个游戏码：重登拿新token → getBetToken → 取期号 → betWingo 下一注
 *   4. 等结算，用管理员 token 回查后台注单，确认哪些注单真落库(接口成功≠业务生效)
 *
 * 投注内容(betContent)按游戏族取真实抓到过的格式，不是猜的——来自 3004 历史注单：
 *   WinGo_* / TrxWinGo_*  playType Color/BigSmall/Num   如 BigSmall_Big、Color_Red、Num_2
 *   K3_*                  playType NumSame3             如 NumSame3_111
 *   D5_*                  playType FirstNum             如 FirstNum_0
 *   MotoRace_*            playType FirstNum/SecondOddEven  如 FirstNum_3、SecondOddEven_Odd
 *   LuckyWinGo_*          没有任何历史注单，按 WinGo 格式试(结果以本脚本实测为准)
 *
 * 用法：
 *   k6p -e TENANT_ID=3004 gameBetProbe.js -q
 *   k6p -e TENANT_ID=3007 gameBetProbe.js -q
 *   k6p -e TENANT_ID=3004 -e GAMES=WinGo_30S,K3_1M -e ACCOUNT=91xxxx gameBetProbe.js -q
 *
 * 参数：
 *   TENANT_ID  租户(默认3004)
 *   GAMES      只测这几个游戏码(逗号分隔)，不传=测全部18个
 *   ACCOUNT    复用已有账号(不传则新注册)；配合 PASSWORD(默认 qwer1234)
 *   RECHARGE   充值金额(默认5000，0=不充值，复用已有余额账号时用)
 *   AMOUNT     每注金额(默认100，betMultiple 固定1，所以注单 betAmount=AMOUNT)
 */

import { sleep } from 'k6';
import http from 'k6/http';
import { tenantAdminLogin, tenantRequest } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { generateRandomPhone, } from '../../utils/accountGenerator.js';
import { getTimeRandom, generateCryptoRandomString } from '../../utils/utils.js';
import { SignedHttpClient } from '../../../libs/utils/signature.js';
import { phoneRegister } from '../login/register.test.js';
import { loginByPasswordRetry } from '../common/auth.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { hybridRecharge } from '../recharge/rechargeService.js';
import { getAccountBalance } from '../balance/balance.test.js';
import { getBetToken } from './betToken.js';
import { getNowBetNumber } from './issueNumber.js';
import { betWingo } from './bet.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const PASSWORD = __ENV.PASSWORD || 'qwer1234';
const ACCOUNT = __ENV.ACCOUNT || '';
const RECHARGE = parseInt(__ENV.RECHARGE || '5000', 10);
const AMOUNT = parseInt(__ENV.AMOUNT || '100', 10);
// 期号剩余多少毫秒才敢下注（短周期游戏调大，默认6秒）
const ISSUE_MIN_MS = parseInt(__ENV.ISSUE_MIN_MS || '6000', 10);
const TAG = 'GameBetProbe';

const ALL_GAMES = [
    'WinGo_30S', 'WinGo_1M', 'WinGo_3M', 'WinGo_5M',
    'TrxWinGo_1M', 'TrxWinGo_3M', 'TrxWinGo_5M', 'TrxWinGo_10M',
    'K3_1M', 'K3_3M', 'K3_5M', 'K3_10M',
    'D5_1M', 'D5_3M', 'D5_5M', 'D5_10M',
    'MotoRace_1M', 'LuckyWinGo_30S'
];
const GAMES = (__ENV.GAMES || '').split(',').map(s => s.trim()).filter(Boolean);
const TARGET_GAMES = GAMES.length ? GAMES : ALL_GAMES;

export const options = {
    // 充值刻意放在 default 里而不是 setup：setup 有 60 秒硬上限，而商品模式充值是
    // 按固定面额拆单的(3007 面额200，充6000要发30单)，很容易超时把整轮探测打断。
    setupTimeout: '5m',
    scenarios: { probe: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '40m' } }
};

/** 按游戏族取真实存在过的投注内容格式 */
function contentFor(gameCode) {
    const p = gameCode.split('_')[0];
    if (p === 'K3') return 'NumSame3_111';
    if (p === 'D5') return 'FirstNum_0';
    if (p === 'MotoRace') return 'FirstNum_3';
    return 'BigSmall_Big'; // WinGo / TrxWinGo / LuckyWinGo
}

/**
 * 取可投注期号。不用 issueNumber.js 的 isBet：那个在期号剩余不足7秒时会无限递归
 * sleep(7) 重试，一个坏游戏能把整轮探测卡死。这里最多试 3 次。
 */
function fetchIssue(gameToken, gameCode, gameBaseUrl) {
    for (let i = 0; i < 4; i++) {
        const info = getNowBetNumber(gameToken, gameCode, gameBaseUrl);
        if (!info) return { ok: false, reason: '取期号失败(接口无数据)' };
        const left = info.endTime - Date.now();
        // 剩余时间要够走完"下注请求"这一跳，否则下注落地时该期已结算(msgCode 404
        // The current period is settled)——这是时序问题，不代表游戏不能投。
        // 1分钟一期的游戏(WinGo_1M/MotoRace_1M)尤其容易踩，用 ISSUE_MIN_MS 调大窗口。
        if (left >= ISSUE_MIN_MS) return { ok: true, issueNumber: info.issueNumber, leftMs: left };
        sleep(Math.min(10, Math.ceil(left / 1000) + 2));
    }
    return { ok: false, reason: `连续4次剩余时间都不足 ${ISSUE_MIN_MS}ms` };
}

/** 直接试 GetGameUrl，用来看非 ARLottery 厂商能不能通过现有方式打开（能打开也不代表能下注） */
function tryOpenGame(loginToken, vendorCode, gameCode, gameId) {
    const env = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    const baseUrl = env.BASE_DESK_URL;
    const timeData = getTimeRandom();
    const payload = {
        gameCode, vendorCode, gameId,
        returnUrl: baseUrl + '/game/allGames',
        deviceType: 'PC', deviceTypeId: generateCryptoRandomString(32), language: 'en',
        random: timeData.random, signature: '', timestamp: timeData.timestamp
    };
    const signed = new SignedHttpClient().signData(payload);
    const res = http.post(baseUrl + '/api/ThirdGame/GetGameUrl', JSON.stringify(signed), {
        headers: { 'Content-Type': 'application/json', Referer: baseUrl, Origin: baseUrl, Authorization: 'Bearer ' + loginToken },
        tags: { name: 'GetGameUrl' }
    });
    try {
        const b = JSON.parse(res.body);
        return { ok: b.msgCode === 0 && !!(b.data && b.data.url), msgCode: b.msgCode, msg: b.msg };
    } catch (e) {
        return { ok: false, msgCode: res.status, msg: '响应解析失败' };
    }
}

export function setup() {
    const env = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, env);
    console.log(`[${TAG}] ===== 租户 ${TENANT_ID} 投注能力探测 =====`);
    console.log(`[${TAG}] 前台=${env.BASE_DESK_URL}  待测游戏=${TARGET_GAMES.length} 个  每注=${AMOUNT}`);

    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[${TAG}] 租户 ${TENANT_ID} 管理员登录失败`);

    let account = ACCOUNT;
    let token = null;
    if (!account) {
        // 区号必须按租户取：3004=91(印度) 3005=52(墨西哥) 3006=880(孟加拉) 3007=92(巴基斯坦)。
        // 写死 91 会被 3006 这种严格校验号段的站拒掉(msgCode 5014 Phone number is wrong)。
        const countryCode = __ENV.COUNTRY_CODE || env.COUNTRY_CODE || '91';
        account = generateRandomPhone(countryCode);
        console.log(`[${TAG}] 使用区号 ${countryCode} 生成账号 ${account}`);
        const r = phoneRegister(account, { token: adminToken }, PASSWORD);
        if (!r || !r.data || !r.data.token) throw new Error(`[${TAG}] 注册失败: ${account}`);
        token = r.data.token;
        console.log(`[${TAG}] ✅ 新注册账号 ${account}`);
    } else {
        token = loginByPasswordRetry(account, PASSWORD);
        if (!token) throw new Error(`[${TAG}] 登录失败: ${account}`);
        console.log(`[${TAG}] ✅ 复用已有账号 ${account}`);
    }

    const info = getFrontUserInfo(token);
    const userId = info && info.userId;
    if (!userId) throw new Error(`[${TAG}] 拿不到 userId: ${account}`);
    console.log(`[${TAG}] userId=${userId}`);

    return { adminToken, account, userId, env };
}

export default function (data) {
    const { adminToken, account, userId, env } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, env);

    if (RECHARGE > 0) {
        const token0 = loginByPasswordRetry(account, PASSWORD);
        const rr = hybridRecharge({ userToken: token0, adminToken, userId, amount: RECHARGE, frontendFirst: true, remark: 'GameBetProbe' });
        if (!rr || !rr.success) {
            console.error(`[${TAG}] ❌ 充值失败，无法继续下注: ${JSON.stringify(rr)}`);
            return;
        }
        console.log(`[${TAG}] ✅ 充值成功 ${rr.amount}`);
        sleep(5);
    }

    const results = [];
    const startTs = Date.now();

    // 先看非 ARLottery 厂商能不能打开（现有方式只有 ARLottery 有下注接口，这里只验证"能否进游戏"）
    const probeToken0 = loginByPasswordRetry(account, PASSWORD);
    const nonLottery = [
        { vendor: 'JILI', game: '116', gameId: 10304, name: 'Happy Taxi(电子)' },
        { vendor: 'PG', game: '102', gameId: 10304, name: 'Mermaid Riches(电子)' }
    ];
    const openResults = nonLottery.map(g => {
        const r = tryOpenGame(probeToken0, g.vendor, g.game, g.gameId);
        console.log(`[${TAG}] 非彩票 ${g.vendor}/${g.game} ${g.name} 开游戏: ${r.ok ? '✅ 能拿到游戏URL' : '❌ ' + r.msgCode + ' ' + r.msg}`);
        return { ...g, ...r };
    });

    for (const gameCode of TARGET_GAMES) {
        const row = { gameCode, step: '', ok: false, detail: '' };
        console.log(`\n[${TAG}] ========== ${gameCode} ==========`);

        // 会员 token 约55秒失效，每个游戏前重登
        const token = loginByPasswordRetry(account, PASSWORD);
        if (!token) { row.step = '登录'; row.detail = '重登失败'; results.push(row); continue; }

        const bal = getAccountBalance(token);
        if (!bal || bal.balance < AMOUNT) {
            row.step = '余额'; row.detail = `余额不足(${bal ? bal.balance : 'N/A'} < ${AMOUNT})，后续游戏都会失败`;
            results.push(row);
            console.error(`[${TAG}] ${gameCode} 余额不足，终止探测`);
            break;
        }

        const tokenInfo = getBetToken(token, gameCode);
        if (!tokenInfo || !tokenInfo.token) {
            row.step = '开游戏'; row.detail = 'GetGameUrl/token链失败(该游戏对本租户不可用)';
            results.push(row); continue;
        }

        const issue = fetchIssue(tokenInfo.gameToken, gameCode, tokenInfo.gameBaseUrl);
        if (!issue.ok) { row.step = '期号'; row.detail = issue.reason; results.push(row); continue; }

        const content = contentFor(gameCode);
        const r = betWingo(gameCode, AMOUNT, 1, content, issue.issueNumber, tokenInfo.token, tokenInfo.gameBaseUrl);
        if (r && r.code === 0 && r.msgCode === 0) {
            row.step = '下注'; row.ok = true;
            row.detail = `期号=${issue.issueNumber} 内容=${content} 金额=${AMOUNT} 下注时该期剩余${issue.leftMs}ms`;
        } else {
            row.step = '下注';
            row.detail = `内容=${content} 失败: ${r ? 'code=' + r.code + ' msgCode=' + r.msgCode + ' msg=' + r.msg : '无响应'}`;
        }
        results.push(row);
        sleep(1);
    }

    // 等结算后回查后台，确认注单真落库（接口返回成功不等于业务生效）
    console.log(`\n[${TAG}] 等待 60 秒后回查后台注单...`);
    sleep(60);
    const landed = {};
    const br = tenantRequest('/api/ThirdGame/GetBetRecordPageList', {
        categoryType: 3, queryTimeType: 'BetTime', userId,
        beginTimeUnix: startTs - 600000, endTimeUnix: Date.now(), pageNo: 1, pageSize: 100, orderBy: 'Desc', sortField: 'BetTime'
    }, { token: adminToken, isDesk: false });
    (((br && br.data && br.data.list)) || []).forEach(it => {
        landed[it.gameCode] = landed[it.gameCode] || [];
        landed[it.gameCode].push({ bet: it.betAmount, valid: it.validAmount, fee: it.feeAmount, content: it.betContent, play: it.playType, state: it.orderState });
    });

    console.log(`\n[${TAG}] ================= 结果 租户 ${TENANT_ID} 账号 ${account} (userId=${userId}) =================`);
    results.forEach(r => {
        const back = landed[r.gameCode];
        const backTxt = back ? `后台已落库 ${back.length} 笔 ${JSON.stringify(back[0])}` : '后台查不到注单';
        console.log(`[${TAG}] ${r.ok ? '✅ 能投' : '❌ 不能投'}  ${r.gameCode}  [${r.step}] ${r.detail}  |  ${backTxt}`);
    });
    const okList = results.filter(r => r.ok).map(r => r.gameCode);
    const landedList = Object.keys(landed);
    console.log(`[${TAG}] 下注接口成功: ${okList.length ? okList.join(', ') : '无'}`);
    console.log(`[${TAG}] 后台真落库  : ${landedList.length ? landedList.join(', ') : '无'}`);
    openResults.forEach(g => console.log(`[${TAG}] 非彩票 ${g.vendor}/${g.game}: ${g.ok ? '能开游戏(但项目没有该厂商的下注实现)' : '开不了 ' + g.msg}`));
}
