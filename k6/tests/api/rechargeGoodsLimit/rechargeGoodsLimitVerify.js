/**
 * 首二三充配置 —— 同设备/同浏览器指纹限制次数验证(3007商户)
 *
 * 背景：后台"首二三充配置"（截图确认）对首充/次充/三充各配了梯度档位+
 * 赠送金额+打码量倍数，同时可以独立开启"同IP/同设备/同浏览器指纹限N次"
 * 防刷限制——超过限制后，充值金额即使精确命中档位，也不再赠送。
 *
 * 2026-10-27 调研+实测确认的关键事实(写脚本前必读，否则容易踩坑复现)：
 *   1) 真正的赠送financialType是 RechargeGoodsR1Reward(首充)/R2Reward(二充)/
 *      R3Reward(三充)——不是"充值赠送"(RechargeGift)！后者是另一个完全独立
 *      的"充值满返1%"规则，金额任意、codingMultiple固定99，跟本功能无关，
 *      两者偶尔会同时产生账变记录，查询时必须用前者的类型过滤，否则会被
 *      误导(实测踩过这个坑：查错类型会让"已经成功发放"误判成"没有发放")。
 *   2) ⚠️ 2026-10-27用实测纠正过一次：不是"充值金额必须精确等于档位金额
 *      才触发"！真实规则是"阶梯满额制"——充值金额≥某档位阈值，就按"能
 *      满足的最高档位"发放对应赠送。实测证据：首充阶段充150元(介于100/
 *      200之间)触发了档位1的21元；三充阶段充2000元(超过最高档1500)触发
 *      了档位2(最高档)的211元；只有低于最低档(比如次充阶段充50，低于
 *      500)才真正不发放。之前"精确等于才触发"的误判，是因为早期全部
 *      测试用例凑巧都用的精确档位金额，没有测过"介于两档之间"这种输入。
 *   3) 限制判断用的是"账号注册那一刻的关联账号快照"，不是实时判断——账号A
 *      注册时关联数未超限，哪怕之后又有新账号把关联数推过限制线，账号A
 *      后续的次充/三充依然正常发放，不会被"连带"取消资格(已用"先注册A→
 *      A首充成功→再注册超限的B/C→回头测A的次充"这个顺序实测确认)。
 *   4) GetRechargeBasicInfo响应里的classicBonusDetails字段，可以作为免费
 *      的"资格预判"信号——超限时这个字段直接是null，未超限是正常的档位
 *      数组，不需要真的发起充值就能提前判断，但最终结论还是要以账变记录
 *      为准(两者在本次验证里完全一致，预判可靠)。
 *   5) 充值走经典模式(商品模式goodsList为空)，不区分Local确认还是走通
 *      ThirdRecharge人工审核确认，两种方式都能正常触发赠送——不是只有
 *      "走通三方"才算数(之前一度怀疑过这个方向，已证伪)。
 *   6) GetUserRiskControlPageList(riskControlType: 1=设备/3=IP/5=浏览器指纹)
 *      的totalCount就是关联账号数，用来诊断/核对关联关系很方便，但不是
 *      判定本身的依据——真正起作用的是后端自己内部判断，这里只是观测用。
 *
 * 汇总报告设计：每条results记录都在生成的当下就拼好一个summary字符串(充值
 * 金额+预期+实际结果)，过程日志和最终汇总用的是同一个summary——这样最后
 * 的"验证汇总"小节不会丢失执行细节，方便直接照着userId+summary去定位要
 * 排查的那笔充值/账变，不需要再翻回过程日志找。
 *
 * 用法：
 *   k6 run rechargeGoodsLimitVerify.js
 */
import { sleep } from 'k6';
import { sendRequest } from '../common/request.js';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { generateRandomPhone } from '../../utils/accountGenerator.js';
import { generateCryptoRandomString } from '../../utils/utils.js';
import { phoneRegister } from '../login/register.test.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { getRechargeBasicInfo } from '../recharge/rechargeLevel.service.js';
import { assembleFiatRechargeNoUsdt } from '../groupRechargeWithdrawReport/rechargeAssembler.js';

const TENANT_ID = '3007';

// 截图确认的3007商户"首二三充配置"——档位/赠送金额/打码倍数，用于精确断言
const STAGE_CONFIG = {
    R1: { financialType: 'RechargeGoodsR1Reward', tiers: [{ amount: 100, bonus: 21 }, { amount: 200, bonus: 22 }], codingMultiple: 2 },
    R2: { financialType: 'RechargeGoodsR2Reward', tiers: [{ amount: 500, bonus: 51 }, { amount: 1000, bonus: 81 }], codingMultiple: 3 },
    R3: { financialType: 'RechargeGoodsR3Reward', tiers: [{ amount: 800, bonus: 101 }, { amount: 1500, bonus: 211 }], codingMultiple: 3.5 }
};
const DEVICE_LIMIT = 2;
const FINGERPRINT_LIMIT = 1;

export const options = { scenarios: { s: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '30m' } } };

function registerOne(envConfig, deviceId, browserId, label) {
    const phone = generateRandomPhone(envConfig.COUNTRY_CODE || '92');
    const reg = phoneRegister(phone, {}, 'qwer1234', '', null, deviceId, browserId);
    if (!reg || !reg.data || !reg.data.token) { console.error(`[${label}] 注册失败: ${JSON.stringify(reg)}`); return null; }
    const userToken = reg.data.token;
    const info = getFrontUserInfo(userToken);
    const userId = info && info.userId;
    console.log(`[${label}] ${phone} userId=${userId}`);
    return { label, phone, userToken, userId };
}

function checkEligibility(userToken) {
    const basicInfo = getRechargeBasicInfo(userToken);
    const tiers = basicInfo && basicInfo.classicBonusDetails;
    return { eligible: Array.isArray(tiers) && tiers.length > 0, tiers };
}

function queryStageReward(adminToken, userId, financialType) {
    const resp = sendRequest({
        searchUserIdType: 1, financialTypeList: [financialType], userId, pageNo: 1, pageSize: 20, orderBy: 'Desc'
    }, '/api/Financial/GetPageList', 'QueryStageReward', false, adminToken);
    return (resp && resp.list) || (resp && resp.data && resp.data.list) || [];
}

function getRiskControlCount(adminToken, accountNo, riskControlType) {
    const resp = sendRequest({ accountNo, riskControlType, pageNo: 1, pageSize: 1, orderBy: 'Desc' }, '/api/Users/GetUserRiskControlPageList', 'RiskControl', false, adminToken);
    const data = (resp && resp.data) || resp;
    return data ? data.totalCount : null;
}

/** 充值一笔命中stage指定档位(tierIndex，默认0=档位1)的金额，sleep(1)后查账变，返回{ok, amount, expectBonus, records, hit} */
function doStageRecharge(adminToken, acc, stage, label, tierIndex = 0) {
    const cfg = STAGE_CONFIG[stage];
    const tier = cfg.tiers[tierIndex];
    const amount = tier.amount;
    const expectBonus = tier.bonus;

    const r = assembleFiatRechargeNoUsdt(acc.userToken, adminToken, acc.userId, amount, { audit: true });
    if (!r.success) { console.error(`[${label}] 充值${amount}失败: ${r.reason}`); return { ok: false, amount, reason: 'RECHARGE_FAILED' }; }
    sleep(1);
    const records = queryStageReward(adminToken, acc.userId, cfg.financialType);
    const hit = records.find(x => Number(x.amount) === expectBonus && Number(x.codingMultiple) === cfg.codingMultiple);
    return { ok: !!hit, amount, expectBonus, records, hit };
}

/**
 * 按"阶梯满额"规则(见文件头注释2)，算出充值amount应该命中stage的哪个档位——
 * 取"amount>=tier.amount"里最高的那一档；一档都够不到则返回null(不该发放)。
 * 依赖STAGE_CONFIG.tiers本身按金额升序排列(当前配置确实如此)。
 */
function expectedTierForAmount(stage, amount) {
    const cfg = STAGE_CONFIG[stage];
    let matched = null;
    for (const tier of cfg.tiers) {
        if (amount >= tier.amount) matched = tier;
    }
    return matched;
}

/**
 * 按阶梯满额规则充值任意金额，断言实际发放是否符合expectedTierForAmount算出
 * 的预期(expected为null时预期不发放；否则预期精确发放expected.bonus、打码
 * codingMultiple倍)。
 */
function doThresholdRecharge(adminToken, acc, stage, amount, label) {
    const cfg = STAGE_CONFIG[stage];
    const expected = expectedTierForAmount(stage, amount);
    const before = queryStageReward(adminToken, acc.userId, cfg.financialType).length;
    const r = assembleFiatRechargeNoUsdt(acc.userToken, adminToken, acc.userId, amount, { audit: true });
    if (!r.success) { console.error(`[${label}] 充值${amount}失败: ${r.reason}`); return { ok: false, amount, reason: 'RECHARGE_FAILED' }; }
    sleep(1);
    const records = queryStageReward(adminToken, acc.userId, cfg.financialType);
    if (!expected) {
        return { ok: records.length === before, amount, expected: null, before, after: records.length };
    }
    const hit = records.find(x => Number(x.amount) === expected.bonus && Number(x.codingMultiple) === cfg.codingMultiple);
    return { ok: !!hit, amount, expected, hit, records };
}

/** 一次性拍下R1/R2/R3三个阶段当前的记录数，用来在"第4次充值"这类场景里做前后对比 */
function snapshotAllStageCounts(adminToken, userId) {
    const snap = {};
    for (const stage of Object.keys(STAGE_CONFIG)) {
        snap[stage] = queryStageReward(adminToken, userId, STAGE_CONFIG[stage].financialType).length;
    }
    return snap;
}

const results = [];

/** doStageRecharge结果专用：生成"充值XX元 → 预期.../实际..."的summary并记录+打印 */
function report(group, label, expectEligible, outcome, userId) {
    const gotReward = outcome.ok;
    const pass = expectEligible === gotReward;
    const amountPart = outcome.amount != null ? `充值${outcome.amount}元` : '充值失败';
    const resultPart = outcome.hit
        ? `实发${outcome.hit.amount}元(打码${outcome.hit.codingMultiple}倍)`
        : (gotReward ? '已发放' : '未发放');
    const summary = `${amountPart} → 预期${expectEligible ? '应发放' : '不应发放'}，${resultPart}`;
    results.push({ group, label, userId, summary, pass, detail: outcome });
    console.log(`[${pass ? '✅' : '❌'}] [${group}] userId=${userId} ${label}  ${summary}`);
}

/** doThresholdRecharge结果专用：同样生成summary并记录+打印(C组/D组复用，不再各自手写) */
function reportThreshold(group, label, outcome, userId) {
    const amountPart = `充值${outcome.amount}元`;
    let expectPart, resultPart;
    if (outcome.expected) {
        expectPart = `预期按档位(≥${outcome.expected.amount})发${outcome.expected.bonus}元`;
        resultPart = outcome.hit ? `实发${outcome.hit.amount}元(打码${outcome.hit.codingMultiple}倍)` : '实际未发放';
    } else {
        expectPart = '预期不发放(低于最低档)';
        resultPart = `实际记录数${outcome.before}→${outcome.after}`;
    }
    const summary = `${amountPart} → ${expectPart}，${resultPart}`;
    results.push({ group, label, userId, summary, pass: outcome.ok, detail: outcome });
    console.log(`[${outcome.ok ? '✅' : '❌'}] [${group}] userId=${userId} ${label}  ${summary}`);
}

export default function () {
    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    Object.assign(ENV_CONFIG, envConfig);
    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) { console.error('登录失败'); return; }

    // ============== E组：同设备限2 ==============
    console.log(`\n========== E组：同设备限${DEVICE_LIMIT} ==========`);
    const sharedDevice = generateCryptoRandomString(16);
    const deviceAccounts = [];
    for (let i = 1; i <= DEVICE_LIMIT + 1; i++) {
        const acc = registerOne(envConfig, sharedDevice, generateCryptoRandomString(32), `E${i}`);
        if (!acc) continue;
        deviceAccounts.push(acc);
        sleep(1);
        const elig = checkEligibility(acc.userToken);
        const riskCount = getRiskControlCount(adminToken, sharedDevice, 1);
        console.log(`  [E${i}] 注册时设备关联数=${riskCount}  资格预判=${elig.eligible ? '合格' : '超限'}`);
        const outcome = doStageRecharge(adminToken, acc, 'R1', `E${i}`);
        report('E', `E${i}首充(设备关联数=${riskCount})`, elig.eligible, outcome, acc.userId);
    }

    if (deviceAccounts[0]) {
        console.log(`\n--- E组快照验证：E1已完成首充，E2/E3注册推高了设备关联数，回头测E1的次充+三充 ---`);
        const outcome2 = doStageRecharge(adminToken, deviceAccounts[0], 'R2', 'E1-次充');
        report('E-快照', 'E1次充(注册时合格，不应被后续账号连带取消)', true, outcome2, deviceAccounts[0].userId);
        sleep(1);
        const outcome3 = doStageRecharge(adminToken, deviceAccounts[0], 'R3', 'E1-三充');
        report('E-快照', 'E1三充(该账号第3笔充值，应触发R3)', true, outcome3, deviceAccounts[0].userId);
    }

    // ============== F组：同浏览器指纹限1 ==============
    console.log(`\n========== F组：同浏览器指纹限${FINGERPRINT_LIMIT} ==========`);
    const sharedFingerprint = generateCryptoRandomString(32);
    const fpAccounts = [];
    for (let i = 1; i <= FINGERPRINT_LIMIT + 1; i++) {
        const acc = registerOne(envConfig, generateCryptoRandomString(16), sharedFingerprint, `F${i}`);
        if (!acc) continue;
        fpAccounts.push(acc);
        sleep(1);
        const elig = checkEligibility(acc.userToken);
        const riskCount = getRiskControlCount(adminToken, sharedFingerprint, 5);
        console.log(`  [F${i}] 注册时指纹关联数=${riskCount}  资格预判=${elig.eligible ? '合格' : '超限'}`);
        const outcome = doStageRecharge(adminToken, acc, 'R1', `F${i}`);
        report('F', `F${i}首充(指纹关联数=${riskCount})`, elig.eligible, outcome, acc.userId);
    }

    if (fpAccounts[0]) {
        console.log(`\n--- F组快照验证：F1已完成首充，F2注册推高了指纹关联数，回头测F1的次充+三充 ---`);
        const outcome2 = doStageRecharge(adminToken, fpAccounts[0], 'R2', 'F1-次充');
        report('F-快照', 'F1次充(注册时合格，不应被后续账号连带取消)', true, outcome2, fpAccounts[0].userId);
        sleep(1);
        const outcome3 = doStageRecharge(adminToken, fpAccounts[0], 'R3', 'F1-三充');
        report('F-快照', 'F1三充(该账号第3笔充值，应触发R3)', true, outcome3, fpAccounts[0].userId);
    }

    // ============== C组：阶梯满额规则验证 ==============
    // 一个全新账号，3笔充值分别覆盖"介于两档之间/低于最低档/高于最高档"
    // 三种情况，分布在首/次/三充三个不同阶段——不需要额外账号开销。按
    // 文件头注释2的"阶梯满额制"，只有"低于最低档"才真正不发放，其余两种
    // 应该按"能满足的最高档位"正常发放(这是2026-10-27的实测修正，不是
    // 猜测)。
    console.log(`\n========== C组：阶梯满额规则验证 ==========`);
    const accC = registerOne(envConfig, generateCryptoRandomString(16), generateCryptoRandomString(32), 'C1');
    if (accC) {
        sleep(1);
        const oc1 = doThresholdRecharge(adminToken, accC, 'R1', 150, 'C1-首充150');
        reportThreshold('C', 'C1首充阶段(100≤150<200)', oc1, accC.userId);

        sleep(1);
        const oc2 = doThresholdRecharge(adminToken, accC, 'R2', 50, 'C1-次充50');
        reportThreshold('C', 'C1次充阶段(低于最低档500)', oc2, accC.userId);

        sleep(1);
        const oc3 = doThresholdRecharge(adminToken, accC, 'R3', 2000, 'C1-三充2000');
        reportThreshold('C', 'C1三充阶段(超过最高档1500)', oc3, accC.userId);
    }

    // ============== D组：阶梯切换边界精确性 ==============
    // B2组已经验证过"刚好等于档位2金额"会按档位2发；这里补上"刚好低于
    // 档位2"这个边界点——同一个账号的首/次/三充各自验证一次，确认"阶梯
    // 满额"规则在三个阶段都成立，不是R1特有的。
    console.log(`\n========== D组：阶梯切换边界精确性 ==========`);
    const accD = registerOne(envConfig, generateCryptoRandomString(16), generateCryptoRandomString(32), 'D1');
    if (accD) {
        sleep(1);
        const od1 = doThresholdRecharge(adminToken, accD, 'R1', 199, 'D1-首充199');
        reportThreshold('D', 'D1首充阶段(刚好低于档位2=200)', od1, accD.userId);

        sleep(1);
        const od2 = doThresholdRecharge(adminToken, accD, 'R2', 999, 'D1-次充999');
        reportThreshold('D', 'D1次充阶段(刚好低于档位2=1000)', od2, accD.userId);

        sleep(1);
        const od3 = doThresholdRecharge(adminToken, accD, 'R3', 1499, 'D1-三充1499');
        reportThreshold('D', 'D1三充阶段(刚好低于档位2=1500)', od3, accD.userId);
    }

    // ============== B7：第4次充值不再触发 ==============
    // 全新账号正常走完首/次/三充(都命中档位1、应该正常拿到赠送)，第4笔
    // 充值故意选100元——精确等于R1档位1的金额，专门用来排查"系统会不会
    // 错误地把第4笔又循环判定成首充"这种bug，不是随便挑个数字。
    console.log(`\n========== B7：第4次充值不再触发 ==========`);
    const accB7 = registerOne(envConfig, generateCryptoRandomString(16), generateCryptoRandomString(32), 'B7');
    if (accB7) {
        sleep(1);
        const b7r1 = doStageRecharge(adminToken, accB7, 'R1', 'B7-首充');
        report('B7', 'B7首充(正常基线)', true, b7r1, accB7.userId);
        sleep(1);
        const b7r2 = doStageRecharge(adminToken, accB7, 'R2', 'B7-次充');
        report('B7', 'B7次充(正常基线)', true, b7r2, accB7.userId);
        sleep(1);
        const b7r3 = doStageRecharge(adminToken, accB7, 'R3', 'B7-三充');
        report('B7', 'B7三充(正常基线)', true, b7r3, accB7.userId);

        sleep(1);
        const before4 = snapshotAllStageCounts(adminToken, accB7.userId);
        const r4 = assembleFiatRechargeNoUsdt(accB7.userToken, adminToken, accB7.userId, 100, { audit: true });
        const r4ok = r4.success;
        sleep(1);
        const after4 = snapshotAllStageCounts(adminToken, accB7.userId);
        const pass4 = r4ok && before4.R1 === after4.R1 && before4.R2 === after4.R2 && before4.R3 === after4.R3;
        const summary4 = `充值100元(=R1档位1金额，第4笔) → 预期R1/R2/R3三阶段记录数都不变，实际 R1:${before4.R1}→${after4.R1} R2:${before4.R2}→${after4.R2} R3:${before4.R3}→${after4.R3}`;
        results.push({ group: 'B7', label: 'B7第4次充值(已用完首/次/三充机会)', userId: accB7.userId, summary: summary4, pass: pass4, detail: { before4, after4 } });
        console.log(`[${pass4 ? '✅' : '❌'}] [B7] userId=${accB7.userId} B7第4次充值(已用完首/次/三充机会)  ${summary4}`);
    }

    // ============== B2：每个阶段的档位2 ==============
    // 之前B组只验证过档位1(100/500/800)，这里补上档位2(200/1000/1500)。
    console.log(`\n========== B2：每个阶段的档位2 ==========`);
    const accB2 = registerOne(envConfig, generateCryptoRandomString(16), generateCryptoRandomString(32), 'B2');
    if (accB2) {
        sleep(1);
        const b2r1 = doStageRecharge(adminToken, accB2, 'R1', 'B2-首充档位2', 1);
        report('B2', 'B2首充命中档位2', true, b2r1, accB2.userId);
        sleep(1);
        const b2r2 = doStageRecharge(adminToken, accB2, 'R2', 'B2-次充档位2', 1);
        report('B2', 'B2次充命中档位2', true, b2r2, accB2.userId);
        sleep(1);
        const b2r3 = doStageRecharge(adminToken, accB2, 'R3', 'B2-三充档位2', 1);
        report('B2', 'B2三充命中档位2', true, b2r3, accB2.userId);
    }

    // ============== 汇总报告 ==============
    console.log(`\n\n================= 验证汇总 =================`);
    const failed = results.filter(r => !r.pass);
    for (const r of results) {
        console.log(`${r.pass ? '✅' : '❌'} [${r.group}] userId=${r.userId} ${r.label}  ${r.summary}`);
    }
    console.log(`\n共${results.length}项，通过${results.length - failed.length}项，失败${failed.length}项`);
    if (failed.length > 0) {
        console.log(`失败详情: ${JSON.stringify(failed, null, 2)}`);
    }
}
