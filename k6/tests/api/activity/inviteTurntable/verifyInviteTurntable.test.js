/**
 * 邀请转盘验证测试
 * 功能：验证邀请转盘活动的完整流程
 *
 * 流程：
 * 1. 总代注册（手机号优先，失败则邮箱）
 * 2. 点击4个礼物盒（开启邀请转盘）
 * 3. 旋转转盘（免费次数）
 * 4. 获取邀请码
 * 5. 邀请下级（按轮次交替：奇数轮真并发 / 偶数轮依次）
 * 6. 下级注册+充值
 * 7. 获取转盘总金额
 * 8. 提现
 *
 * 环境变量：
 * - TENANT_ID: 租户ID（必需）
 * - LANGUAGE: 语言（默认en）
 * - GENERAL_AGENT_COUNT: 总代数量（默认1）
 * - GENERAL_AGENT_CONCURRENT: 总代并发数（默认1，不传=现在的全串行行为）
 * - WHEEL_NUMBER: 轮次数量（默认1）
 * - SUB_MIN_NUMBER: 最小下级数量（默认2）
 * - SUB_MAX_NUMBER: 最大下级数量（默认5）
 * - SUB_CONCURRENT: 下级并发数（默认3，并发轮次下是 http.batch 每批最多并发数）
 * - MIN_MONEY: 最小充值金额（默认1000）
 * - MAX_MONEY: 最大充值金额（默认5000）
 *
 * 2026-11-07 新增：总代用 k6 原生多 VU 真并发（per-vu-iterations，照抄
 * concurrentLockWithdraw.test.js 的模式）；下级邀请按轮次交替——奇数轮用
 * http.batch 真并发注册（测"同一邀请码同时被多人注册"是否有并发 bug），偶数轮
 * 依次注册。总代改多 VU 后，脚本结尾不再有跨总代汇总大表格（每个 VU 只负责 1 个
 * 总代），改为各 VU 打印自己负责总代的小结日志。
 *
 * k6p verifyInviteTurntable.test.js -e TENANT_ID=3004
 * k6p verifyInviteTurntable.test.js -e TENANT_ID=3004 -e SUB_MIN_NUMBER=15 -e SUB_MAX_NUMBER=20
 * k6p -e TENANT_ID=3004 -e GENERAL_AGENT_COUNT=4 -e GENERAL_AGENT_CONCURRENT=2 -e WHEEL_NUMBER=3 -e SUB_MIN_NUMBER=3 -e SUB_MAX_NUMBER=5 -e MIN_MONEY=1000 -e MAX_MONEY=5000 verifyInviteTurntable.test.js
 */

import http from 'k6/http';
import { sleep } from 'k6';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { phoneRegister, emailRegister, phoneRegisterByInvite, emailRegisterByInvite, getLastRegisterError, isRateLimitError } from '../../login/register.test.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { hybridRecharge } from '../../recharge/rechargeService.js';
import { generateRandomPhone, generateRandomEmail } from '../../../utils/accountGeneratorFaker.js';
import { getTimeRandom, generateCryptoRandomString } from '../../../utils/utils.js';
import { SignatureUtil } from '../../../../libs/utils/signature.js';
import { httpClient } from '../../../../libs/http/client.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import {
    getInvitedWheelConfig,
    updateInvitedWheelConfig,
    clickSpinInvitedWheel,
    clickShareLink,
    clickSpinningTurntable,
    getUserInvitedWheelInfo,
    clickWheelWithdraw
} from './inviteTurntableApi.js';
import { randInt as getRandomRechargeAmount } from '../../../../libs/common/index.js';

const tag = 'VerifyInviteTurntable';

// ============================================================
// 总代并发：k6 options 必须在 init 阶段静态可读，不能等 getConfig() 再算
// ============================================================
const AGENT_COUNT = parseInt(__ENV.GENERAL_AGENT_COUNT) || 1;
const AGENT_CONCURRENT = Math.max(1, Math.min(parseInt(__ENV.GENERAL_AGENT_CONCURRENT) || 1, AGENT_COUNT));

export const options = {
    scenarios: {
        generalAgents: {
            executor: 'per-vu-iterations',
            vus: AGENT_CONCURRENT,
            iterations: Math.ceil(AGENT_COUNT / AGENT_CONCURRENT),
            maxDuration: '2h'
        }
    }
};

/**
 * 获取环境变量配置
 */
function getConfig() {
    const tenantId = __ENV.TENANT_ID || __ENV.TENANT || '3004';
    const language = __ENV.LANGUAGE || 'en';

    // generalAgentCount/generalAgentConcurrent 必须跟模块顶层 options 用的
    // AGENT_COUNT/AGENT_CONCURRENT 保持同一份值，否则 default() 里分配总代
    // 序号的算法会跟实际启动的 VU/iterations 数量错位
    const generalAgentCount = AGENT_COUNT;
    const generalAgentConcurrent = AGENT_CONCURRENT;
    const wheelNumber = parseInt(__ENV.WHEEL_NUMBER) || 1;
    const subMinNumber = parseInt(__ENV.SUB_MIN_NUMBER) || 2;
    const subMaxNumber = parseInt(__ENV.SUB_MAX_NUMBER) || 5;
    const subConcurrent = parseInt(__ENV.SUB_CONCURRENT) || 3;
    const minMoney = parseInt(__ENV.MIN_MONEY) || 1000;
    const maxMoney = parseInt(__ENV.MAX_MONEY) || 5000;

    const envConfig = getEnvByTenantId(tenantId);
    const countryCode = envConfig.COUNTRY_CODE || '91';

    return {
        tenantId,
        language,
        generalAgentCount,
        generalAgentConcurrent,
        wheelNumber,
        subMinNumber,
        subMaxNumber,
        subConcurrent,
        minMoney,
        maxMoney,
        countryCode,
        envConfig
    };
}


/**
 * 对一个"返回结果对象/null"的注册调用做限流退避重试。
 *
 * 2026-11-07：第一次小规模(2总代2下级)验证时单次 sleep(1) 重试够用；但按用户
 * 要求的完整规模(4总代、每批3-5下级)再验证时，发现高并发压力下后台限流窗口
 * 会跨越超过1秒——单次重试后仍可能限流。改成最多重试 maxRetries 次、每次等待
 * 递增(1s/2s/3s...)，直到成功或遇到非限流的真实业务错误（isRateLimitError
 * 判定规则见 register.test.js 顶部注释，全项目统一约定）。
 *
 * @param {function(): object|null} callFn - 执行一次注册调用，返回结果或 null
 * @param {string} label - 日志里标注这是哪个调用（手机号/邮箱注册等）
 * @param {number} [maxRetries=3]
 * @returns {object|null} 最后一次调用的返回值
 */
export function callWithRateLimitRetry(callFn, label, maxRetries = 3) {
    let result = callFn();
    let attempt = 0;
    while (!result && isRateLimitError(getLastRegisterError()) && attempt < maxRetries) {
        attempt++;
        console.warn(`[${tag}] ${label} 触发限流，${attempt}s后重试（第${attempt}/${maxRetries}次）...`);
        sleep(attempt);
        result = callFn();
    }
    return result;
}

/**
 * 总代注册（手机号优先，失败则邮箱）
 * 2026-11-07 导出：供 verifyInviteTurntableManualSpin.test.js 复用，避免重复实现
 */
export function registerGeneralAgent(data, config) {
    const { countryCode } = config;

    // 1. 尝试手机号注册
    // 2026-11-07：总代改多 VU 真并发后，多个总代几乎同时发起注册请求，会撞上
    // 后台"访问过于频繁"限流（msgCode 13）——这不是真的注册失败，退避重试
    // 同一个手机号即可，不该直接判失败/换邮箱
    const phone = generateRandomPhone(countryCode);
    console.log(`[${tag}] 尝试手机号注册总代: ${phone}`);

    let registerResult = callWithRateLimitRetry(() => phoneRegister(phone, data), '手机号注册总代');

    if (registerResult && registerResult.code === 0) {
        console.log(`[${tag}] ✅ 手机号注册成功: ${phone}`);
        return {
            success: true,
            account: phone,
            type: 'phone',
            token: registerResult.data.token,
            headers: registerResult.headers
        };
    }

    // 2. 手机号失败，尝试邮箱注册
    console.log(`[${tag}] 手机号注册失败，尝试邮箱注册...`);
    const email = generateRandomEmail();
    console.log(`[${tag}] 尝试邮箱注册总代: ${email}`);

    registerResult = callWithRateLimitRetry(() => emailRegister(email, data), '邮箱注册总代');

    if (registerResult && registerResult.code === 0) {
        console.log(`[${tag}] ✅ 邮箱注册成功: ${email}`);
        return {
            success: true,
            account: email,
            type: 'email',
            token: registerResult.data.token,
            headers: registerResult.headers
        };
    }

    console.error(`[${tag}] ❌ 总代注册失败`);
    return { success: false };
}

/**
 * 下级注册（手机号优先，失败则邮箱）
 * 注意：邀请转盘活动需要将邀请码最后一位替换成 'W'
 * 2026-11-07 导出：供 verifyInviteTurntableManualSpin.test.js 复用
 */
export function registerSubordinate(inviteCode, data, config) {
    const { countryCode, envConfig } = config;

    // 将邀请码最后一位替换成 'W'（邀请转盘活动的特殊要求）
    const modifiedInviteCode = inviteCode.slice(0, -1) + 'W';
    console.log(`[${tag}] 原始邀请码: ${inviteCode}, 修改后邀请码: ${modifiedInviteCode}`);

    // 准备自定义URL（使用推广页域名）
    const customUrls = {
        frontUrl: envConfig.INVITE_REGISTER_URL,      // 推广页域名（发验证码）
        adminUrl: envConfig.BASE_ADMIN_URL,           // 后台域名（查验证码）
        registerUrl: envConfig.INVITE_REGISTER_URL    // 推广页域名（注册）
    };

    console.log(`[${tag}] 使用推广页域名: ${envConfig.INVITE_REGISTER_URL}`);

    // 1. 尝试手机号邀请注册（限流退避重试，理由同 registerGeneralAgent）
    const phone = generateRandomPhone(countryCode);
    console.log(`[${tag}] 尝试手机号邀请注册: ${phone}, 邀请码: ${modifiedInviteCode}`);

    let registerResult = callWithRateLimitRetry(
        () => phoneRegisterByInvite(phone, modifiedInviteCode, data, 'qwer1234', '', customUrls),
        '手机号邀请注册'
    );

    if (registerResult && registerResult.code === 0) {
        console.log(`[${tag}] ✅ 手机号邀请注册成功: ${phone}`);
        return {
            success: true,
            account: phone,
            type: 'phone',
            token: registerResult.data.token,
            headers: registerResult.headers
        };
    }

    // 2. 手机号失败，尝试邮箱邀请注册
    console.log(`[${tag}] 手机号邀请注册失败，尝试邮箱邀请注册...`);
    const email = generateRandomEmail();
    console.log(`[${tag}] 尝试邮箱邀请注册: ${email}, 邀请码: ${modifiedInviteCode}`);

    registerResult = callWithRateLimitRetry(
        () => emailRegisterByInvite(email, modifiedInviteCode, data, 'qwer1234', '', customUrls),
        '邮箱邀请注册'
    );

    if (registerResult && registerResult.code === 0) {
        console.log(`[${tag}] ✅ 邮箱邀请注册成功: ${email}`);
        return {
            success: true,
            account: email,
            type: 'email',
            token: registerResult.data.token,
            headers: registerResult.headers
        };
    }

    console.error(`[${tag}] ❌ 下级注册失败`);
    return { success: false };
}

/**
 * 已拿到 token 的下级，完成"查 userId + 充值"收尾步骤。
 * 并发/依次两种注册模式最终都走这里，统一保持顺序执行——各账号的查询/充值互相
 * 独立，没有共享资源竞争，不是本次"同一邀请码并发注册"测试的重点。
 */
export function finishSubordinate(token, account, adminToken, config, index, total) {
    // 1. 获取用户信息（userId）
    const userInfo = getFrontUserInfo(token);
    if (!userInfo || !userInfo.userId) {
        console.error(`[${tag}] [${index}/${total}] 获取用户信息失败: ${account}`);
        return { success: false, account };
    }

    const userId = userInfo.userId;
    console.log(`[${tag}] [${index}/${total}] 获取到用户ID: ${userId}`);

    // 2. 充值（使用混合充值策略）
    const rechargeAmount = getRandomRechargeAmount(config.minMoney, config.maxMoney);
    console.log(`[${tag}] [${index}/${total}] 开始充值: ${account}, 金额: ${rechargeAmount}`);

    const rechargeResult = hybridRecharge({
        userToken: token,
        adminToken: adminToken,
        userId: userId,
        amount: rechargeAmount,
        frontendFirst: true,
        remark: `InviteTurntable-Sub-${index}`
    });

    if (rechargeResult.success) {
        console.log(`[${tag}] [${index}/${total}] ✅ 充值成功: ${account}, 金额: ${rechargeAmount}, 方式: ${rechargeResult.method}`);
        return { success: true, account, userId, amount: rechargeAmount };
    } else {
        console.error(`[${tag}] [${index}/${total}] ❌ 充值失败: ${account}`);
        return { success: false, account, userId };
    }
}

/**
 * 单个下级的完整流程：注册 + 充值（依次模式用）
 */
function processSubordinate(inviteCode, data, adminToken, config, index, total) {
    console.log(`\n[${tag}] [${index}/${total}] 开始处理下级...`);

    // 1. 注册下级
    const registerResult = registerSubordinate(inviteCode, data, config);
    if (!registerResult.success) {
        console.error(`[${tag}] [${index}/${total}] 下级注册失败`);
        return { success: false };
    }

    const { account, token } = registerResult;
    return finishSubordinate(token, account, adminToken, config, index, total);
}

/**
 * 依次处理多个下级（诚实的顺序实现）。
 *
 * 2026-11-07 改名：老版本叫 processSubordinatesConcurrently，但内部循环直接
 * 同步调用 processSubordinate，没有 Promise.all/http.batch，batchPromises 数组
 * 声明了但从未使用——所谓"并发"其实是严格顺序请求，只是凑够一批人多 sleep(2)。
 * 这里改名以反映真实行为；真并发见下面的 processSubordinatesConcurrentlyReal。
 */
function processSubordinatesSequentially(inviteCode, data, adminToken, config) {
    const subCount = Math.floor(Math.random() * (config.subMaxNumber - config.subMinNumber + 1)) + config.subMinNumber;
    console.log(`\n[${tag}] 开始依次处理 ${subCount} 个下级（本轮：依次模式）`);

    const results = [];
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < subCount; i++) {
        const index = i + 1;
        // 随机延迟，模拟真实用户的间隔节奏
        sleep(Math.random() * 2);
        const result = processSubordinate(inviteCode, data, adminToken, config, index, subCount);
        results.push(result);

        if (result.success) {
            successCount++;
        } else {
            failedCount++;
        }
    }

    console.log(`\n[${tag}] 下级处理完成: 总数=${subCount}, 成功=${successCount}, 失败=${failedCount}`);

    return {
        total: subCount,
        success: successCount,
        failed: failedCount,
        results: results
    };
}

/**
 * 构造一份"手机号邀请注册"的已签名请求对象，供 http.batch 使用。
 *
 * 字段结构照抄 register.test.js 的 phoneRegisterByInvite（无验证码场景），
 * 签名复用 SignatureUtil.signRequest（跟 httpClient 内部走的 secret='' 完全
 * 一致，见 libs/http/client.js 的 HttpClient 构造函数不传 verifyPwd），不新发明
 * 签名逻辑、不碰 httpClient 本身（httpClient.post 是同步阻塞调用，没法塞进
 * http.batch 的并行请求数组）。
 *
 * @param {string} phone        - 手机号
 * @param {string} inviteCode   - 已经替换过末位为 'W' 的邀请码
 * @param {string} registerUrl  - 推广页域名（envConfig.INVITE_REGISTER_URL）
 * @returns {{method:string,url:string,body:string,params:object,account:string}}
 */
function buildPhoneInviteRegisterRequest(phone, inviteCode, registerUrl) {
    const api = '/api/Home/Register';
    const timeData = getTimeRandom();
    const deviceId = generateCryptoRandomString(16);
    const browserId = generateCryptoRandomString(32);

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

    // 跟 httpClient._signIfNeeded 内部走的签名逻辑保持一致：secret 固定为空字符串
    const signedPayload = SignatureUtil.signRequest(payload, '');

    const fullUrl = registerUrl + api;
    const domainMatch = fullUrl.match(/^(https?:\/\/[^\/]+)/);
    const domainUrl = domainMatch ? domainMatch[1] : fullUrl;

    // 跟 client.js 的 generateRequestBody 保持一致：Domainurl/Referrer 都是域名部分
    const headers = {
        ...httpClient.defaultHeaders,
        Domainurl: domainUrl,
        Referrer: domainUrl
    };

    return {
        method: 'POST',
        url: fullUrl,
        body: JSON.stringify(signedPayload),
        params: { headers, tags: { type: tag, name: `${tag}_batch_register` } },
        account: phone
    };
}

/**
 * 从 http.batch 返回的单个响应里解析出注册结果。
 * 判定逻辑照抄 register.test.js 的 handleRegisterResponseWithToken：
 * code 字段不存在时退回 msgCode，统一按 === 0 判定成功，token 在 data.token。
 */
function parseBatchRegisterResponse(resp) {
    if (!resp || !resp.body) {
        return { success: false, token: null, raw: null };
    }
    try {
        const body = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body;
        const statusCode = body.code !== undefined ? body.code : body.msgCode;
        if (statusCode === 0 && body.data && body.data.token) {
            return { success: true, token: body.data.token, raw: body };
        }
        return { success: false, token: null, raw: body };
    } catch (e) {
        console.error(`[${tag}] 并发注册响应解析失败: ${e.message}`);
        return { success: false, token: null, raw: null };
    }
}

/**
 * 真并发处理多个下级：用 http.batch 把这一批"手机号邀请注册"请求真正同时发出，
 * 测试"同一邀请码同时被多人注册"是否有并发 bug——这是本次改造的核心目的。
 *
 * 手机号注册失败的（小概率），批次发送完之后退化为顺序补跑一次邮箱邀请注册兜底
 * （异常分支，不追求并发，跟现有"手机号优先失败则邮箱"策略保持一致）。查 userId
 * + 充值复用 finishSubordinate，保持顺序执行（理由见该函数注释）。
 */
function processSubordinatesConcurrentlyReal(inviteCode, data, adminToken, config) {
    const subCount = Math.floor(Math.random() * (config.subMaxNumber - config.subMinNumber + 1)) + config.subMinNumber;
    console.log(`\n[${tag}] 开始真并发处理 ${subCount} 个下级（本轮：http.batch 并发模式，批大小=${config.subConcurrent}）`);

    const registerUrl = config.envConfig.INVITE_REGISTER_URL;
    const modifiedInviteCode = inviteCode.slice(0, -1) + 'W';

    const results = [];
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < subCount; i += config.subConcurrent) {
        const batchSize = Math.min(config.subConcurrent, subCount - i);
        console.log(`\n[${tag}] 并发批次 [${i + 1}-${i + batchSize}/${subCount}]，${batchSize} 个注册请求将真正同时发出`);

        // 1. 构造这一批的手机号邀请注册请求
        const batchItems = [];
        for (let j = 0; j < batchSize; j++) {
            const index = i + j + 1;
            const phone = generateRandomPhone(config.countryCode);
            batchItems.push({ index, phone, req: buildPhoneInviteRegisterRequest(phone, modifiedInviteCode, registerUrl) });
        }

        // 2. http.batch 真正并行发出（同一邀请码、几乎同一时刻）
        const batchRequests = {};
        batchItems.forEach(item => {
            const r = item.req;
            batchRequests[String(item.index)] = { method: r.method, url: r.url, body: r.body, params: r.params };
        });
        const batchStartedAt = Date.now();
        const responses = http.batch(batchRequests);
        console.log(`[${tag}] 批次 ${batchSize} 个请求已全部返回，耗时: ${Date.now() - batchStartedAt}ms`);

        // 3. 解析响应。2026-11-07 实测：几个请求真并发发出后，后台会用"访问过于
        // 频繁"限流（msgCode 13）拒绝部分请求——这不是真的注册失败，不该直接换邮箱
        // （而且邮箱注册在部分租户环境本身是关闭的，换了也没用），应该顺序退避重试
        // 同一手机号；只有真实业务失败才落入邮箱兜底。
        const needRetryPhone = [];
        const needEmailFallback = [];
        for (const item of batchItems) {
            const parsed = parseBatchRegisterResponse(responses[String(item.index)]);
            if (parsed.success) {
                console.log(`[${tag}] [${item.index}/${subCount}] ✅ 并发手机号注册成功: ${item.phone}`);
                const finishResult = finishSubordinate(parsed.token, item.phone, adminToken, config, item.index, subCount);
                results.push(finishResult);
                finishResult.success ? successCount++ : failedCount++;
            } else if (isRateLimitError(parsed.raw)) {
                console.warn(`[${tag}] [${item.index}/${subCount}] ⚠️ 并发手机号注册触发限流: ${item.phone}，稍后顺序重试同一手机号`);
                needRetryPhone.push(item);
            } else {
                console.warn(`[${tag}] [${item.index}/${subCount}] ⚠️ 并发手机号注册失败: ${item.phone}（${JSON.stringify(parsed.raw)}），稍后顺序补跑邮箱兜底`);
                needEmailFallback.push(item);
            }
        }

        // 3b. 限流的，退避重试同一手机号（最多3次，递增等待 1s/2s/3s），仍失败
        // 才落入邮箱兜底。2026-11-07 完整规模(4总代、每批3-5下级)验证实测：高
        // 并发压力下单次重试不够，部分请求重试后仍被限流——改成多次递增重试。
        if (needRetryPhone.length > 0) {
            const maxPhoneRetries = 3;
            for (const item of needRetryPhone) {
                let retryParsed = null;
                for (let attempt = 1; attempt <= maxPhoneRetries; attempt++) {
                    sleep(attempt);
                    const retryReq = buildPhoneInviteRegisterRequest(item.phone, modifiedInviteCode, registerUrl);
                    const retryResp = http.request(retryReq.method, retryReq.url, retryReq.body, retryReq.params);
                    retryParsed = parseBatchRegisterResponse(retryResp);
                    if (retryParsed.success || !isRateLimitError(retryParsed.raw)) {
                        break;
                    }
                    console.warn(`[${tag}] [${item.index}/${subCount}] ⚠️ 限流重试第${attempt}/${maxPhoneRetries}次仍失败: ${item.phone}`);
                }
                if (retryParsed.success) {
                    console.log(`[${tag}] [${item.index}/${subCount}] ✅ 限流重试后手机号注册成功: ${item.phone}`);
                    const finishResult = finishSubordinate(retryParsed.token, item.phone, adminToken, config, item.index, subCount);
                    results.push(finishResult);
                    finishResult.success ? successCount++ : failedCount++;
                } else {
                    console.warn(`[${tag}] [${item.index}/${subCount}] ⚠️ 限流重试${maxPhoneRetries}次后仍失败: ${item.phone}（${JSON.stringify(retryParsed.raw)}），稍后顺序补跑邮箱兜底`);
                    needEmailFallback.push(item);
                }
            }
        }

        // 4. 邮箱兜底（顺序，异常分支，不追求并发）。
        // 2026-11-07 修复：这里原来直接单次调用 emailRegisterByInvite，若邮箱注册
        // 本身也撞上限流会被误判为"邮箱兜底也失败"——同样要做限流退避重试，复用
        // callWithRateLimitRetry（判断依据是 getLastRegisterError()，跟上面批次
        // 内部直接判断响应体 raw 字段是两条独立路径，因为这里走的是高层函数）。
        if (needEmailFallback.length > 0) {
            const customUrls = {
                frontUrl: config.envConfig.INVITE_REGISTER_URL,
                adminUrl: config.envConfig.BASE_ADMIN_URL,
                registerUrl: config.envConfig.INVITE_REGISTER_URL
            };
            for (const item of needEmailFallback) {
                const email = generateRandomEmail();
                const emailResult = callWithRateLimitRetry(
                    () => emailRegisterByInvite(email, modifiedInviteCode, data, 'qwer1234', '', customUrls),
                    `[${item.index}/${subCount}] 邮箱兜底`
                );
                if (emailResult && emailResult.code === 0) {
                    console.log(`[${tag}] [${item.index}/${subCount}] ✅ 邮箱兜底注册成功: ${email}`);
                    const finishResult = finishSubordinate(emailResult.data.token, email, adminToken, config, item.index, subCount);
                    results.push(finishResult);
                    finishResult.success ? successCount++ : failedCount++;
                } else {
                    console.error(`[${tag}] [${item.index}/${subCount}] ❌ 邮箱兜底也失败: ${JSON.stringify(getLastRegisterError())}`);
                    results.push({ success: false });
                    failedCount++;
                }
            }
        }

        // 批次间等待
        if (i + batchSize < subCount) {
            sleep(2);
        }
    }

    console.log(`\n[${tag}] 下级处理完成: 总数=${subCount}, 成功=${successCount}, 失败=${failedCount}`);

    return {
        total: subCount,
        success: successCount,
        failed: failedCount,
        results: results
    };
}

/**
 * 单轮邀请转盘流程
 */
function runSingleRound(generalAgentToken, adminToken, data, config, roundIndex) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${tag}] 开始第 ${roundIndex} 轮邀请转盘流程`);
    console.log(`${'='.repeat(80)}\n`);

    // 0. 检查邀请转盘配置（仅第一轮执行）
    if (roundIndex === 1) {
        console.log(`[${tag}] 步骤0: 检查邀请转盘配置...`);
        const configResult = getInvitedWheelConfig(adminToken);

        if (!configResult || !configResult.success) {
            console.error(`[${tag}] ❌ 获取配置失败`);
            return { success: false, step: 'getConfig' };
        }

        // 检查需要更新的配置项
        const needsUpdate = [];

        // 1. 检查活动开关
        if (!configResult.isOpen) {
            console.log(`[${tag}] 活动已关闭，需要开启`);
            needsUpdate.push({ key: 'IsOpenInvitedWheel', value: '1', desc: '开启活动' });
        }

        // 2. 检查提现方式
        if (!configResult.cashToMainWallet) {
            console.log(`[${tag}] 提现方式为银行卡，需要改为主钱包`);
            needsUpdate.push({ key: 'IsInvitedWheelCashToMainWallet', value: '1', desc: '提现到主钱包' });
        }

        // 3. 检查自动旋转
        if (!configResult.autoRotate) {
            console.log(`[${tag}] 自动旋转已关闭，需要开启`);
            needsUpdate.push({ key: 'InviteAutoRotate', value: '1', desc: '开启自动旋转' });
        }

        // 如果有需要更新的配置，批量更新
        if (needsUpdate.length > 0) {
            console.log(`[${tag}] 需要更新 ${needsUpdate.length} 项配置`);

            let allSuccess = true;
            for (const item of needsUpdate) {
                console.log(`[${tag}] 更新配置: ${item.desc}`);
                const updateResult = updateInvitedWheelConfig(adminToken, item.key, item.value);

                if (!updateResult || !updateResult.success) {
                    console.error(`[${tag}] ❌ 更新配置失败: ${item.desc}`);
                    allSuccess = false;
                    break;
                }
            }

            if (!allSuccess) {
                return { success: false, step: 'updateConfig' };
            }

            console.log(`[${tag}] ✅ 所有配置更新成功，等待10秒...`);
            sleep(10);
        } else {
            console.log(`[${tag}] ✅ 所有配置已正确设置，无需更新`);
        }
    }

    // 1. 点击4个礼物盒（开启邀请转盘）
    console.log(`\n[${tag}] 步骤1: 点击4个礼物盒...`);
    const spinResult = clickSpinInvitedWheel(generalAgentToken);
    if (!spinResult || !spinResult.success) {
        console.error(`[${tag}] ❌ 点击礼物盒失败`);
        return { success: false, step: 'clickGiftBox' };
    }
    console.log(`[${tag}] ✅ 礼物盒点击成功，isFirstInvitedWheel: ${spinResult.isFirstInvitedWheel}`);

    // 等待5秒后再旋转转盘
    console.log(`\n[${tag}] 等待5秒后旋转转盘...`);
    sleep(5);

    // 2. 旋转转盘（免费次数，带重试逻辑）
    console.log(`\n[${tag}] 步骤2: 旋转转盘...`);
    const turntableResult = clickSpinningTurntable(generalAgentToken);
    if (!turntableResult || !turntableResult.success) {
        console.error(`[${tag}] ❌ 旋转转盘失败`);
        return { success: false, step: 'spinTurntable' };
    }
    console.log(`[${tag}] ✅ 旋转成功，本次金额: ${turntableResult.prizeAmount}, 是否中奖: ${turntableResult.isWin}`);

    // 3. 获取邀请码
    console.log(`\n[${tag}] 步骤3: 获取邀请码...`);
    const shareLinkResult = clickShareLink(generalAgentToken);
    if (!shareLinkResult || !shareLinkResult.success) {
        console.error(`[${tag}] ❌ 获取邀请码失败`);
        return { success: false, step: 'getInviteCode' };
    }
    const inviteCode = shareLinkResult.inviteCode;
    console.log(`[${tag}] ✅ 获取邀请码成功: ${inviteCode}`);

    // 4. 邀请下级并充值：奇数轮真并发（http.batch），偶数轮依次
    const subMode = (roundIndex % 2 === 1) ? 'concurrent' : 'sequential';
    console.log(`\n[${tag}] 步骤4: 邀请下级并充值（第${roundIndex}轮，模式=${subMode}）...`);
    const subResults = (subMode === 'concurrent')
        ? processSubordinatesConcurrentlyReal(inviteCode, data, adminToken, config)
        : processSubordinatesSequentially(inviteCode, data, adminToken, config);
    console.log(`[${tag}] ✅ 下级处理完成: 成功=${subResults.success}, 失败=${subResults.failed}`);

    // 5. 等待5秒（确保状态更新）
    console.log(`\n[${tag}] 步骤5: 等待5秒，确保状态更新...`);
    sleep(5);

    // 6. 获取转盘总金额并检查是否满足提现条件
    console.log(`\n[${tag}] 步骤6: 获取转盘总金额...`);
    const wheelInfoResult = getUserInvitedWheelInfo(generalAgentToken);
    if (!wheelInfoResult || !wheelInfoResult.success) {
        console.error(`[${tag}] ❌ 获取转盘信息失败`);
        return { success: false, step: 'getWheelInfo' };
    }

    const totalPrizeAmount = wheelInfoResult.totalPrizeAmount;
    const userWheelAmount = wheelInfoResult.userWheelAmount;

    console.log(`[${tag}] 转盘总金额: ${totalPrizeAmount}`);
    console.log(`[${tag}] 用户已旋转金额: ${userWheelAmount}`);

    // 检查是否满足提现条件
    const canWithdraw = (totalPrizeAmount === userWheelAmount);
    console.log(`[${tag}] 是否满足提现条件: ${canWithdraw ? '是' : '否'}`);

    if (!canWithdraw) {
        console.warn(`[${tag}] ⚠️ 未满足提现条件，跳过提现步骤`);
        console.log(`[${tag}] 第 ${roundIndex} 轮完成（未提现）`);
        return {
            success: true,
            roundIndex,
            inviteCode,
            subCount: subResults.total,
            subSuccess: subResults.success,
            totalAmount: totalPrizeAmount,
            prizeAmount: turntableResult.prizeAmount,
            withdrawn: false,
            withdrawSkipped: true
        };
    }

    // 7. 提现
    console.log(`\n[${tag}] 步骤7: 提现...`);
    const withdrawResult = clickWheelWithdraw(totalPrizeAmount, generalAgentToken);
    if (!withdrawResult || !withdrawResult.success) {
        console.error(`[${tag}] ❌ 提现失败`);
        return {
            success: false,
            step: 'withdraw',
            totalAmount: totalPrizeAmount,
            subCount: subResults.total,
            subSuccess: subResults.success
        };
    }
    console.log(`[${tag}] ✅ 提现成功，金额: ${totalPrizeAmount}`);

    console.log(`\n[${tag}] 第 ${roundIndex} 轮完成！`);
    return {
        success: true,
        roundIndex,
        inviteCode,
        subCount: subResults.total,
        subSuccess: subResults.success,
        totalAmount: totalPrizeAmount,
        prizeAmount: turntableResult.prizeAmount,
        withdrawn: true
    };
}

/**
 * 单个总代的完整流程
 */
function runGeneralAgentFlow(data, config, agentIndex) {
    console.log(`\n${'#'.repeat(100)}`);
    console.log(`[${tag}] 开始处理总代 [${agentIndex}/${config.generalAgentCount}]`);
    console.log(`${'#'.repeat(100)}\n`);

    // 1. 注册总代
    console.log(`[${tag}] 步骤1: 注册总代...`);
    const registerResult = registerGeneralAgent(data, config);
    if (!registerResult.success) {
        console.error(`[${tag}] ❌ 总代注册失败`);
        return { success: false, step: 'register' };
    }

    const { account, token } = registerResult;
    console.log(`[${tag}] ✅ 总代注册成功: ${account}`);

    // 2. 获取用户信息
    const userInfo = getFrontUserInfo(token);
    if (!userInfo || !userInfo.userId) {
        console.error(`[${tag}] ❌ 获取总代用户信息失败`);
        return { success: false, step: 'getUserInfo' };
    }

    const userId = userInfo.userId;
    const inviteCode = userInfo.inviteCode;
    console.log(`[${tag}] ✅ 总代信息: userId=${userId}, inviteCode=${inviteCode}`);

    // 3. 执行多轮邀请转盘流程
    const roundResults = [];
    for (let round = 1; round <= config.wheelNumber; round++) {
        const roundResult = runSingleRound(token, data.token, data, config, round);
        roundResults.push(roundResult);

        if (!roundResult.success) {
            console.error(`[${tag}] ❌ 第 ${round} 轮失败，停止后续轮次`);
            break;
        }

        // 轮次间等待
        if (round < config.wheelNumber) {
            console.log(`\n[${tag}] 等待5秒后开始下一轮...`);
            sleep(5);
        }
    }

    console.log(`\n[${tag}] 总代 [${agentIndex}] 完成！账号: ${account}, 完成轮次: ${roundResults.filter(r => r.success).length}/${config.wheelNumber}`);

    return {
        success: true,
        account,
        userId,
        inviteCode,
        roundResults
    };
}

/**
 * Setup函数 - 初始化环境
 */
export function setup() {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`[${tag}] 邀请转盘验证测试 - 初始化`);
    console.log(`${'='.repeat(100)}\n`);

    const config = getConfig();

    console.log(`[${tag}] 配置信息:`);
    console.log(`  - 租户ID: ${config.tenantId}`);
    console.log(`  - 语言: ${config.language}`);
    console.log(`  - 总代数量: ${config.generalAgentCount}`);
    console.log(`  - 总代并发数: ${config.generalAgentConcurrent}`);
    console.log(`  - 轮次数量: ${config.wheelNumber}（奇数轮下级并发/偶数轮下级依次）`);
    console.log(`  - 下级数量范围: ${config.subMinNumber}-${config.subMaxNumber}`);
    console.log(`  - 下级并发数: ${config.subConcurrent}`);
    console.log(`  - 充值金额范围: ${config.minMoney}-${config.maxMoney}`);
    console.log(`  - 区号: ${config.countryCode}`);

    // 更新全局 ENV_CONFIG（重要！）
    if (config.tenantId !== '3004') {
        Object.assign(ENV_CONFIG, config.envConfig);
        console.log(`[${tag}] ✅ 已更新 ENV_CONFIG 为租户 ${config.tenantId} 的配置`);
        console.log(`[${tag}] BASE_DESK_URL: ${ENV_CONFIG.BASE_DESK_URL}`);
        console.log(`[${tag}] INVITE_REGISTER_URL: ${ENV_CONFIG.INVITE_REGISTER_URL}`);
    }

    // 后台管理员登录
    console.log(`\n[${tag}] 后台管理员登录...`);
    const adminToken = AdminLogin();
    if (!adminToken) {
        throw new Error('后台管理员登录失败');
    }
    console.log(`[${tag}] ✅ 后台管理员登录成功`);

    return {
        token: adminToken,
        envConfig: config.envConfig,
        config: config
    };
}

/**
 * 主测试函数
 */
export default function (data) {
    const config = data.config;

    // VU中重新应用环境配置（重要！）
    if (config.tenantId !== '3004') {
        Object.assign(ENV_CONFIG, data.envConfig);
        console.log(`[${tag}] ✅ VU中已更新 ENV_CONFIG 为租户 ${config.tenantId} 的配置`);
        console.log(`[${tag}] BASE_DESK_URL: ${ENV_CONFIG.BASE_DESK_URL}`);
        console.log(`[${tag}] INVITE_REGISTER_URL: ${ENV_CONFIG.INVITE_REGISTER_URL}`);
    }

    // 2026-11-07：总代改用 k6 原生多 VU 真并发（per-vu-iterations，见顶部 options），
    // 每个 VU 这次迭代只负责"分配到的那 1 个总代"，不再循环跑完所有总代。
    // 4总代2并发的例子：VU1/ITER0→总代1，VU2/ITER0→总代2（几乎同时开始），
    // VU1/ITER1→总代3，VU2/ITER1→总代4。总代数不能被并发数整除时，多出来的
    // VU×iteration 组合会算出超出范围的 agentIndex，直接跳过不处理。
    const agentIndex = __ITER * config.generalAgentConcurrent + __VU;
    if (agentIndex > config.generalAgentCount) {
        console.log(`[${tag}] VU${__VU} 第${__ITER}次迭代分配到的总代序号(${agentIndex})超出总数(${config.generalAgentCount})，跳过`);
        return;
    }

    console.log(`\n${'='.repeat(100)}`);
    console.log(`[${tag}] 开始邀请转盘验证测试 (VU${__VU}, 总代#${agentIndex}/${config.generalAgentCount})`);
    console.log(`${'='.repeat(100)}\n`);

    const result = runGeneralAgentFlow(data, config, agentIndex);

    console.log(`\n${'='.repeat(100)}`);
    console.log(`[${tag}] 总代#${agentIndex} 验证测试完成（VU${__VU}）`);
    console.log(`${'='.repeat(100)}`);

    if (!result.success) {
        console.error(`[${tag}] [总代#${agentIndex}] ❌ 流程失败: ${result.step || 'unknown'}`);
        console.log(`\n[${tag}] 测试结束（总代#${agentIndex}）`);
        return;
    }

    // 打印这一个总代自己的小结。
    // 注：总代改多 VU 真并发后，每个 VU 只知道自己负责的总代，脚本内部不再能像
    // 以前那样自动拼出"所有总代"的跨 VU 汇总大表格（k6 脚本内没有 fs，VU 之间
    // 也没有共享可写状态）——已跟用户确认接受，各 VU 各自打印自己的小结即可，
    // 要看全量结果，汇总各 VU 的日志输出即可。
    const totalRounds = result.roundResults.filter(rr => rr.success).length;
    let totalSubCount = 0;
    let totalWithdrawAmount = 0;
    let withdrawnRounds = 0;

    result.roundResults.forEach(round => {
        if (round.success) {
            totalSubCount += (round.subCount || 0);
            if (round.withdrawn) {
                totalWithdrawAmount += (round.totalAmount || 0);
                withdrawnRounds++;
            }
        }
    });

    const withdrawInfo = withdrawnRounds === totalRounds ? `已提现 ${totalWithdrawAmount.toFixed(2)}` :
        withdrawnRounds > 0 ? `部分提现 ${totalWithdrawAmount.toFixed(2)} (${withdrawnRounds}/${totalRounds}轮)` :
            '未提现';

    console.log(`\n[${tag}] ========== 总代#${agentIndex} 验证结果 ==========`);
    console.log(`[${tag}] 账号: ${result.account}`);
    console.log(`[${tag}] 完成轮次: ${totalRounds}/${config.wheelNumber}`);
    console.log(`[${tag}] 下级总数: ${totalSubCount}`);
    console.log(`[${tag}] 提现情况: ${withdrawInfo}`);
    console.log(`\n[${tag}] 测试结束（总代#${agentIndex}）`);
}
