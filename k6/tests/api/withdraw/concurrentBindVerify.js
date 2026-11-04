/**
 * 并发绑定同一张银行卡验证（真正的并发，不是顺序执行）
 *
 * 之前验证唯一性开关时做过"用户A绑卡→用户B尝试绑同一张卡"，但那是顺序执行的
 * （等A完全绑定成功之后，才发起B的请求），没有验证系统在"两个请求几乎同一时刻
 * 到达"这种竞态条件下是否存在漏洞——比如两个请求都在"这张卡未被占用"这个检查点
 * 通过了校验，最终两条记录都写入成功，导致同一张卡被两个用户同时持有。
 *
 * 用 k6 的 http.batch() 同时发出两个请求（不走现有 addFrontBankCard 封装，因为它
 * 是同步单次请求且带限流重试逻辑，会打乱并发时序），绕开高层封装直接构造已签名
 * 的请求。
 *
 * 运行方式：
 *   k6p -e TENANT_ID=3004 concurrentBindVerify.js
 */
import http from 'k6/http';
import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { tenantRequest } from '../../../libs/http/tenantRequest.js';
import { testCommonRequest } from '../common/request.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';
import { getTenantBaseUrl, buildBaseHeaders, signPayload } from '../../../libs/http/primitives.js';
import { getTimeRandom, generateCryptoRandomString } from '../../utils/utils.js';
import { randomDigits } from '../../../libs/common/random.js';
import { generateIFSC, getFrontRealName } from './addWalletApi.js';
import { setBankUniqueness } from './rechargeWithdrawSetting.js';

export const options = { vus: 1, iterations: 1 };

const tenantId = __ENV.TENANT_ID || '3004';

// 2026-11-03：实时注册新账号多次触发"Too frequent access"限流（窗口比预期长，
// 3分钟冷却仍不够），改成登录这次会话里早先测试矩阵已经注册成功、但从未碰过银行
// 卡接口的历史账号（电子钱包矩阵测试用的号码，银行卡字段必然是干净的）。可通过
// -e ACCOUNT_C= -e ACCOUNT_D= 覆盖指定其他账号。
const ACCOUNT_C = __ENV.ACCOUNT_C || '913848006665';
const ACCOUNT_D = __ENV.ACCOUNT_D || '913866015424';

/** 登录一个已存在的会员账号（不走注册，避免触发注册频率限制） */
function loginExistingMember(account, password = 'qwer1234') {
    const timeData = getTimeRandom();
    const loginData = {
        userName: account, password, loginType: 'Mobile', deviceId: '',
        browserId: generateCryptoRandomString(32), packageName: '',
        random: timeData.random, language: timeData.language, signature: '', timestamp: timeData.timestamp
    };
    const token = testCommonRequest(loginData, '/api/Home/Login', 'ConcurrentVerify_Login');
    if (!token || typeof token !== 'string') {
        console.error(`[ConcurrentVerify] ❌ 登录失败: ${account} res=${JSON.stringify(token)}`);
        return null;
    }
    console.log(`[ConcurrentVerify] ✅ 登录成功: ${account}`);
    return { token, phone: account };
}

function getUserId(adminToken, account, retries = 4) {
    for (let i = 0; i <= retries; i++) {
        const pageResp = tenantRequest('/api/Users/GetPageList', { account, pageNo: 1, pageSize: 10 }, { token: adminToken, isDesk: false });
        const userId = pageResp && pageResp.data && pageResp.data.list && pageResp.data.list[0] && pageResp.data.list[0].userId;
        if (userId) return userId;
        console.warn(`[GetUserId] 账号${account}暂时查不到userId(第${i + 1}次)，2s后重试`);
        sleep(2);
    }
    return null;
}

/** 构造一个已签名的"添加银行卡"请求对象，供 http.batch 使用 */
function buildAddBankCardRequest(baseUrl, userToken, cardNo, holderName) {
    const timeData = getTimeRandom();
    const payload = {
        bankCode: 'INR10125',
        holderName: holderName,
        accountNo: cardNo,
        mobileNo: randomDigits(10, true),
        ifscCode: generateIFSC(),
        withdrawType: 'BankCard',
        random: timeData.random,
        language: timeData.language
    };
    const signed = signPayload(payload);
    return {
        method: 'POST',
        url: `${baseUrl}/api/Withdraw/AddUserWithdrawWallet`,
        body: JSON.stringify(signed),
        params: { headers: buildBaseHeaders(baseUrl, userToken) }
    };
}

export function setup() {
    const envConfig = getEnvByTenantId(tenantId);
    const adminToken = tenantAdminLogin(tenantId);
    if (!adminToken) throw new Error('[ConcurrentVerify] 管理员登录失败');
    return { adminToken, adminData: { token: adminToken, envConfig, tenantId } };
}

export default function (data) {
    const { adminToken, adminData } = data;

    console.log(`\n========== 并发绑定同一张银行卡验证 ==========`);
    setBankUniqueness(adminToken, true);
    sleep(3);

    const memberC = loginExistingMember(ACCOUNT_C);
    const memberD = loginExistingMember(ACCOUNT_D);
    if (!memberC || !memberD) { console.error('登录账号失败，中止'); return; }

    const userIdC = getUserId(adminToken, memberC.phone);
    const userIdD = getUserId(adminToken, memberD.phone);
    console.log(`用户C: ${memberC.phone} userId=${userIdC}`);
    console.log(`用户D: ${memberD.phone} userId=${userIdD}`);

    // 历史账号可能已有实名信息，holderName 必须和会员的 realName 一致（否则 10035
    // Full name is not match），不能像全新账号那样随便填一个名字
    const holderNameC = getFrontRealName(memberC.token) || 'concurrentC';
    const holderNameD = getFrontRealName(memberD.token) || 'concurrentD';
    console.log(`holderName: C=${holderNameC}  D=${holderNameD}`);

    const fixedCardNo = randomDigits(18, true);
    const baseUrl = getTenantBaseUrl(true, tenantId); // isDesk=true 前台域名
    console.log(`固定卡号: ${fixedCardNo}  前台域名: ${baseUrl}`);

    const reqC = buildAddBankCardRequest(baseUrl, memberC.token, fixedCardNo, holderNameC);
    const reqD = buildAddBankCardRequest(baseUrl, memberD.token, fixedCardNo, holderNameD);

    console.log(`即将用 http.batch 同时发出两个绑卡请求...`);
    const responses = http.batch([reqC, reqD]);

    let bodyC = null, bodyD = null;
    try { bodyC = JSON.parse(responses[0].body); } catch (e) { console.error(`C响应解析失败: ${responses[0].body}`); }
    try { bodyD = JSON.parse(responses[1].body); } catch (e) { console.error(`D响应解析失败: ${responses[1].body}`); }

    console.log(`用户C响应: ${JSON.stringify(bodyC)} (HTTP ${responses[0].status})`);
    console.log(`用户D响应: ${JSON.stringify(bodyD)} (HTTP ${responses[1].status})`);

    sleep(2);

    // 后台实查：这张卡最终落在谁名下，有没有出现两边都有（并发漏洞）或两边都没有的异常情况
    const detailC = tenantRequest('/api/Users/GetWallet', { userId: userIdC }, { token: adminToken, isDesk: false });
    const detailD = tenantRequest('/api/Users/GetWallet', { userId: userIdD }, { token: adminToken, isDesk: false });
    const cHasCard = (detailC.data.usersWalletbankList || []).some((c) => c.cardNo === fixedCardNo);
    const dHasCard = (detailD.data.usersWalletbankList || []).some((c) => c.cardNo === fixedCardNo);

    console.log(`\n========== 并发验证结果 ==========`);
    console.log(`C响应msgCode=${bodyC && bodyC.msgCode}  D响应msgCode=${bodyD && bodyD.msgCode}`);
    console.log(`后台实查: C持有该卡=${cHasCard}  D持有该卡=${dHasCard}`);

    if (cHasCard && dHasCard) {
        console.error(`❌❌❌ 发现并发漏洞！同一张卡被两个用户同时持有，唯一性约束在并发场景下失效！`);
    } else if (cHasCard || dHasCard) {
        console.log(`✅ 符合预期：只有一方成功持有这张卡，唯一性约束在并发下依然生效`);
    } else {
        console.warn(`⚠️ 两边都没有这张卡，两个请求可能都失败了，需要看上面的响应详情排查原因`);
    }
}
