/**
 * 多渠道造数公共工具
 *
 * 背景：验证"数据分析总览/渠道来源分析"按渠道拆分的字段(需求#2240新增的6个字段，
 * 以及旧有字段)时，光看"全站汇总"或"渠道合计行=总览值"这层内部一致性不够，还需要
 * 验证"每个具体渠道自己的统计值是否正确"——这要求测试环境里真实存在分布在多个渠道
 * (官网/wheel转盘/adjust/facebook/tiktok)、且产生过多次充值+多次投注(+提现)记录的
 * 账号。这个造数能力本身跟"渠道来源分析验证"这个具体任务解耦，所以抽成公共模块，
 * 之后任何需要"给N个渠道各自灌一批有行为数据的账号"的场景都可以直接复用。
 *
 * 2026-11-13实测踩坑记录（务必读完再改这个文件）：
 *   最初版本复用了 channelInviteService.js 的 registerSubUser（内部走固定域名
 *   CHANNEL_INVITE_BASE_URL='https://ar-cfdeploy.club' + sendToGetVerCode 发验证码），
 *   实测TEST(3004)环境下5个渠道全部注册失败，报"Channel does not exist"(验证码发送
 *   阶段就失败)。对照 facebookRegister.js 里的说明注释才发现：当前测试环境压根没启用
 *   验证码校验，sendToGetVerCode 这条路径本身就会报 msgCode 13011"this verification
 *   method is not enabled"；真正能用的是"code传空字符串直接注册"这条路径（facebook/
 *   tiktok 已经有现成的无验证码版本，adjust 原来的 adjustIdentityRegister 只有验证码
 *   版本，所以本文件给adjust内联了一个无验证码版本，跟 facebookIdentityRegister 的
 *   payload结构保持一致，只是 eventIdentityInfo 带上 Ttclid/Ttcsid 字段）。
 *   所以本模块完全不走 channelInviteService.js 的注册函数，只复用它的
 *   doRecharge/doBet/doWithdraw 这三个行为函数（这几个走的是标准前台充值/投注/提现
 *   接口，跟注册域名/验证码无关，没有踩坑）。
 *
 * 复用的现成能力（全部已验证过，没有发明新机制）：
 *   - official(官网)：login/register.test.js::phoneRegister（不传邀请码，无验证码）
 *   - wheel(转盘)：login/register.test.js::phoneRegisterByInvite，邀请码用"任意已有
 *     账号inviteCode去掉最后一位补'W'"这个转换（channelInviteService.js代码注释里
 *     明确标注这是渠道报表"转盘"的判定方式，不走真实邀请转盘活动接口）
 *   - facebook：channel/facebookRegister.js::facebookIdentityRegister（已是无验证码版）
 *   - tiktok：login/register.test.js::eventIdentityRegister（已是无验证码版）
 *   - adjust：本文件内联 registerAdjustNoCode()（参照 facebookIdentityRegister 改写）
 *   - 行为三件套：channel/channelInviteService.js::doRecharge/doBet/doWithdraw
 *   - 老账号查找+登录：groupRechargeWithdrawReport/oldMemberFisher.js::
 *     fishOldMembers/loginOrResetFished（本次已给 fishOldMembers 加上可选的
 *     packageId 过滤，并补上 forceTenant:true）
 *   - adjust/facebook/tiktok 的埋点配置：adjustRegisterConfig.js::getAdjustConfig、
 *     facebookRegisterConfig.js::getFbConfig、k6/config/eventRegisterConfig.js::getEventConfig
 *
 * 【关于 packageId↔渠道映射，2026-11-13最终确认】不需要再手动猜测或反查——本模块
 * 现在会给每个账号(老用户/新增)都确认并记录真实的packageId(新增账号额外查一次
 * GetPageList，老用户直接复用fishOldMembers返回的字段，不用再猜)，执行完在
 * summaryByChannel里能直接看到每个渠道对应的packageId，不需要调用方自己再去反查。
 * 之前一度以为"报表查不到按渠道数据=后台没配置渠道包"，排查到最后发现是两个独立
 * 问题：① tiktok注册漏传了eventRegisterConfig.js里的registerDomain专属域名，导致
 * 账号没被打上预期的packageId(已修复，adjust/facebook同款参数也一并补上，虽然它们
 * 的registerDomain目前是空串，不影响现状，但保持口径一致方便将来配置生效后自动
 * 跟上)；② 真正查"渠道来源分析"报表(GetPackageAnalysis)要按渠道查，payload字段名是
 * `packageIds`(复数+s的数组，哪怕只查一个包也要包成数组)，不是`packageId`(单数)，
 * 传错字段名不会报错也不会被忽略，而是返回空结果，非常容易误判成"后台没配置"。
 * 这套参数口径已经在 [dataAnalysisNewFieldsVerify.js](../../tests/api/rptDashboard/
 * dataAnalysisNewFieldsVerify.js) 的"按渠道求和 vs 总览"核验里验证通过(6项全部精确
 * 命中，差值为0)。
 *
 * 【造数(本文件/multiChannelAudienceSeed.test.js) 和 验证(dataAnalysisNewFieldsVerify.js)
 * 是两个完全独立的脚本，不要耦合】用户明确要求分开：执行完造数之后往往要等一段时间
 * (报表统计延迟)才去验证，而且验证有时候是单独跑、不一定紧跟着某一次造数。所以：
 *   - 本模块/入口脚本只负责"造数"，跑完后把每个渠道的packageId、涉及的userId打印
 *     清楚，方便事后随时核对，但不负责、也不应该去调用任何报表验证接口。
 *   - dataAnalysisNewFieldsVerify.js 完全独立运行，不依赖"这次会话刚造过数据"这个
 *     假设——它要么自动发现"某天出现过的所有渠道"(discoverActivePackageIds)，要么
 *     支持手动传PACKAGE_IDS精确指定要验证哪几个渠道，两种模式都不需要本模块提供
 *     任何运行时状态。
 */
import { sleep } from 'k6';
import { httpClient } from '../http/client.js';
import { getTimeRandom, generateCryptoRandomString } from '../../tests/utils/utils.js';
import { phoneRegister, phoneRegisterByInvite, eventIdentityRegister } from '../../tests/api/login/register.test.js';
import { facebookIdentityRegister } from '../../tests/api/channel/facebookRegister.js';
import { doRecharge, doBet, doWithdraw } from '../../tests/api/channel/channelInviteService.js';
import { generateRandomPhone } from '../../tests/utils/accountGeneratorFaker.js';
import { fishOldMembers, loginOrResetFished } from '../../tests/api/groupRechargeWithdrawReport/oldMemberFisher.js';
import { getAdjustConfig } from '../../tests/api/channel/adjustRegisterConfig.js';
import { getFbConfig } from '../../tests/api/channel/facebookRegisterConfig.js';
import { getEventConfig } from '../../config/eventRegisterConfig.js';
import { sendRequest } from '../../tests/api/common/request.js';

const TAG = 'MultiChannelAudience';

/** 新注册账号确认真实packageId(注册接口本身的响应不带这个字段，必须额外查一次) */
function fetchUserPackageId(adminToken, userId) {
    const res = sendRequest({ userId, pageNo: 1, pageSize: 1, orderBy: 'Desc' }, '/api/Users/GetPageList', TAG, false, adminToken, true);
    const list = (res && res.list) || (res && res.data && res.data.list) || [];
    const u = list[0];
    return u ? { packageId: u.packageId, packageName: u.packageName } : { packageId: null, packageName: null };
}

/**
 * Adjust 无验证码注册——adjustRegister.js::adjustIdentityRegister 只有"先发验证码"
 * 的版本，当前测试环境验证码不可用，照抄 facebookIdentityRegister 的无验证码结构，
 * 只是 eventIdentityInfo 带上 Ttclid/Ttcsid(Adjust专属字段，对齐adjustRegister.js
 * 原版的字段集合)。
 */
function registerAdjustNoCode(userName, options = {}) {
    const { password = 'qwer1234', pixelId, eventConfigId, eventType = 2, packageName, inviteCode = '', registerUrl = null } = options;
    const timeData = getTimeRandom();
    const deviceId = generateCryptoRandomString(16);
    const browserId = generateCryptoRandomString(32);
    const api = '/api/Home/Register';

    const eventIdentityInfo = JSON.stringify({ PixelId: pixelId, Fbp: '', Fbc: '', Ttclid: '', Ttcsid: '', AdjustDeviceId: '' });

    const payload = {
        loginType: 'Mobile', userName, password, inviteCode, code: '', captchaId: null,
        deviceId, browserId, packageName,
        eventIdentity: [{ eventConfigId, eventType, eventIdentityInfo }],
        language: 'en', random: timeData.random, signature: '', timestamp: timeData.timestamp
    };
    const signPayload = {
        loginType: 'Mobile', userName, password, inviteCode, code: '', captchaId: null,
        deviceId, browserId, packageName, language: 'en', random: timeData.random
    };
    const signClient = new httpClient.constructor();
    const signedParams = signClient.signData(signPayload);
    payload.signature = signedParams.signature;
    payload.timestamp = signedParams.timestamp;

    const httpResponse = registerUrl
        ? httpClient.post(api, payload, { fullUrl: registerUrl + api, sign: false }, true)
        : httpClient.post(api, payload, { sign: false }, true);
    if (!httpResponse || !httpResponse.body) { console.error(`[${TAG}] [adjust] 接口无响应: ${userName}`); return null; }
    let parsedBody;
    try { parsedBody = typeof httpResponse.body === 'string' ? JSON.parse(httpResponse.body) : httpResponse.body; }
    catch (e) { console.error(`[${TAG}] [adjust] 解析响应失败: ${e.message}`); return null; }
    const statusCode = parsedBody.code !== undefined ? parsedBody.code : parsedBody.msgCode;
    if (statusCode !== 0) { console.error(`[${TAG}] [adjust] 注册失败: code=${statusCode}, msg=${parsedBody.msg}`); return null; }
    return { headers: httpResponse.headers, data: parsedBody.data, code: statusCode, msg: parsedBody.msg };
}

/**
 * 统一入口：按渠道注册一个新账号，返回 {token, userId, account} 或 null。
 */
function registerNewAccountForChannel(channel, userName, anchorInviteCode, tenantId) {
    let result = null;
    switch (channel) {
        case 'official':
            result = phoneRegister(userName, null);
            break;
        case 'wheel': {
            const wheelInviteCode = anchorInviteCode.slice(0, -1) + 'W';
            result = phoneRegisterByInvite(userName, wheelInviteCode, null);
            break;
        }
        case 'adjust': {
            const cfg = getAdjustConfig(tenantId);
            result = registerAdjustNoCode(userName, { pixelId: cfg.pixelId, eventConfigId: cfg.id, eventType: cfg.eventType, packageName: cfg.packageName, registerUrl: cfg.registerDomain || null });
            break;
        }
        case 'facebook': {
            const cfg = getFbConfig(tenantId);
            result = facebookIdentityRegister(userName, {}, { pixelId: cfg.pixelId, eventConfigId: cfg.id, eventType: cfg.eventType, packageName: cfg.packageName, registerUrl: cfg.registerDomain || null });
            break;
        }
        case 'tiktok': {
            const cfg = getEventConfig(tenantId);
            result = eventIdentityRegister(userName, {}, { pixelId: cfg.pixelId, eventConfigId: cfg.id, eventType: cfg.eventType, packageName: cfg.packageName, registerUrl: cfg.registerDomain || null });
            break;
        }
        default:
            throw new Error(`[${TAG}] 未知渠道: ${channel}`);
    }
    if (!result || !result.data || !result.data.token || !result.data.userId) return null;
    return { token: result.data.token, userId: result.data.userId, account: userName };
}

/**
 * 均分人数，除不尽的余数依次分给前面的渠道。
 * @returns {number[]} 长度=channels.length
 */
function splitEvenly(total, parts) {
    const base = Math.floor(total / parts);
    const remainder = total % parts;
    return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * 对一批账号(老+新)统一跑"充值→投注→(可选)提现"行为，返回每个账号的行为记录。
 */
function runBehaviorBatch(accounts, adminToken, { enableWithdraw, enableBackendApproval }) {
    const records = [];
    for (const acc of accounts) {
        sleep(1);
        const record = {
            channel: acc.channel, source: acc.source, account: acc.account, userId: acc.userId,
            packageId: acc.packageId, packageName: acc.packageName,
            rechargeAmt: 0, rechargeTimes: 0, betAmt: 0, betTimes: 0, withdrawAmt: 0, withdrawTimes: 0, withdrawStatus: '未执行'
        };

        const rechargeResult = doRecharge(acc.token, acc.userId, adminToken);
        record.rechargeAmt = rechargeResult.totalAmount;
        record.rechargeTimes = rechargeResult.count;
        if (!rechargeResult.success) {
            record.withdrawStatus = '充值失败';
            records.push(record);
            continue;
        }

        sleep(2);
        const betResult = doBet(acc.token, acc.account);
        record.betAmt = betResult.totalAmount;
        record.betTimes = betResult.successCount;

        if (enableWithdraw) {
            sleep(2);
            // adminToken来自tenantAdminLogin(tenantId, true)——商户自己的token，
            // 后台审核的5个接口必须显式forceTenant=true，否则会被默认路由打到集团
            // 域名(见channelInviteService.js::doWithdraw/backendWithdrawApi.js文件头)
            const wResult = doWithdraw(acc.token, acc.userId, adminToken, enableBackendApproval, true);
            record.withdrawAmt = wResult.amount;
            record.withdrawTimes = wResult.count || 0;
            record.withdrawStatus = wResult.success ? `✅成功(${wResult.count}次)` : `❌${wResult.reason}`;
        } else {
            record.withdrawStatus = '跳过(未开启)';
        }
        records.push(record);
    }
    return records;
}

/**
 * 构建多渠道造数账号池并执行行为。
 *
 * @param {object} params
 * @param {string} params.adminToken
 * @param {string} params.tenantId
 * @param {string} params.anchorInviteCode   - 锚点账号的邀请码(任意一个已有、能正常注册
 *                                              下级的账号)，wheel渠道新增账号时转换用
 * @param {number} [params.totalPeople=100]
 * @param {string[]} [params.channels]       - 默认['official','wheel','adjust','facebook','tiktok']
 * @param {number} [params.oldUserRatio=0.4] - 每渠道里老用户占比
 * @param {Object<string, number[]>} [params.channelPackageIdMap={}] - 渠道名→packageId数组，
 *   用于按渠道过滤老账号；留空该渠道就直接全部走新增(见文件头说明)
 * @param {string[]} [params.excludeAccounts=[]] - 额外排除的账号(跨多次调用避免抽重)
 * @param {boolean} [params.enableWithdraw=true]
 * @param {boolean} [params.enableBackendApproval=false]
 * @param {string} [params.countryCode='91']
 * @returns {{records: Array, summaryByChannel: Object, channelPackageIds: Object<string, number[]>}}
 *   summaryByChannel[渠道名] 里含 packageIds(该渠道实际确认到的packageId去重列表，正常应该
 *   只有1个值)和 userIds；channelPackageIds 是同样信息的精简版(渠道名→packageId数组)，
 *   方便调用方事后单独跑验证脚本时直接拿去用，不需要再反查一遍。
 */
export function buildMultiChannelAudience(params) {
    const {
        adminToken, tenantId, anchorInviteCode,
        totalPeople = 100,
        channels = ['official', 'wheel', 'adjust', 'facebook', 'tiktok'],
        oldUserRatio = 0.4,
        channelPackageIdMap = {},
        excludeAccounts = [],
        enableWithdraw = true,
        enableBackendApproval = false,
        countryCode = '91'
    } = params;

    const perChannelCounts = splitEvenly(totalPeople, channels.length);
    const usedAccounts = new Set(excludeAccounts);
    const allRecords = [];

    console.log(`\n[${TAG}] ========== 开始构建多渠道账号池 ==========`);
    console.log(`[${TAG}] 总人数=${totalPeople} 渠道=${channels.join(',')} 各渠道人数=${perChannelCounts.join(',')} 老用户比例=${(oldUserRatio * 100).toFixed(0)}%`);

    channels.forEach((channel, idx) => {
        const perChannel = perChannelCounts[idx];
        const packageIdFilter = channelPackageIdMap[channel];
        const oldTarget = packageIdFilter ? Math.round(perChannel * oldUserRatio) : 0;

        console.log(`\n[${TAG}] --- 渠道[${channel}] 目标${perChannel}人 (老用户目标${oldTarget}人${packageIdFilter ? '' : '，未提供packageId映射，本渠道跳过查老账号'}) ---`);

        const channelAccounts = [];

        // 1) 老账号
        if (oldTarget > 0) {
            const fished = fishOldMembers(adminToken, usedAccounts, oldTarget, { packageId: packageIdFilter });
            for (const f of fished) {
                const { token } = loginOrResetFished(adminToken, f.account, f.userId);
                if (!token) {
                    console.warn(`[${TAG}] [${channel}] 老账号${f.account}登录失败，跳过`);
                    continue;
                }
                usedAccounts.add(f.account);
                channelAccounts.push({ channel, source: '老用户', account: f.account, userId: f.userId, token, packageId: f.packageId, packageName: f.packageName });
            }
            console.log(`[${TAG}] [${channel}] 老账号实际取得 ${channelAccounts.length}/${oldTarget} 人`);
        }

        // 2) 新增账号补足差额
        const newNeeded = perChannel - channelAccounts.length;
        let newOk = 0;

        for (let i = 0; i < newNeeded; i++) {
            sleep(1);
            const userName = generateRandomPhone(countryCode);
            const userInfo = registerNewAccountForChannel(channel, userName, anchorInviteCode, tenantId);
            if (!userInfo) {
                console.warn(`[${TAG}] [${channel}] 新增账号${userName}注册失败，跳过`);
                continue;
            }
            usedAccounts.add(userInfo.account);
            sleep(0.3);
            const { packageId, packageName } = fetchUserPackageId(adminToken, userInfo.userId);
            channelAccounts.push({ channel, source: '新增', account: userInfo.account, userId: userInfo.userId, token: userInfo.token, packageId, packageName });
            newOk++;
        }
        console.log(`[${TAG}] [${channel}] 新增账号实际完成 ${newOk}/${newNeeded} 人，渠道合计 ${channelAccounts.length}/${perChannel} 人`);

        // 渠道归属核验：同一个渠道的账号理应全部落在同一个packageId下，不一致就是造数本身
        // 出了问题(比如某个注册函数的域名/配置传错了)，必须显眼警告出来，不能悄悄吞掉。
        const distinctPkgIds = Array.from(new Set(channelAccounts.map(a => a.packageId)));
        if (distinctPkgIds.length > 1) {
            console.warn(`[${TAG}] ⚠️ [${channel}] 渠道内账号的packageId不一致: ${JSON.stringify(distinctPkgIds)}，造数可能有问题，请检查`);
        } else if (distinctPkgIds.length === 1) {
            console.log(`[${TAG}] [${channel}] 确认packageId=${distinctPkgIds[0]} (${channelAccounts[0] ? channelAccounts[0].packageName : ''})`);
        }

        // 3) 统一跑充值→投注→提现
        const records = runBehaviorBatch(channelAccounts, adminToken, { enableWithdraw, enableBackendApproval });
        allRecords.push(...records);
    });

    const summaryByChannel = {};
    const channelPackageIds = {};
    for (const ch of channels) {
        const rows = allRecords.filter(r => r.channel === ch);
        const distinctPkgIds = Array.from(new Set(rows.map(r => r.packageId))).filter(v => v !== null && v !== undefined);
        channelPackageIds[ch] = distinctPkgIds;
        summaryByChannel[ch] = {
            total: rows.length,
            oldCount: rows.filter(r => r.source === '老用户').length,
            newCount: rows.filter(r => r.source === '新增').length,
            packageIds: distinctPkgIds,
            userIds: rows.map(r => r.userId),
            rechargeAmount: rows.reduce((s, r) => s + r.rechargeAmt, 0),
            rechargeTimes: rows.reduce((s, r) => s + r.rechargeTimes, 0),
            betAmount: rows.reduce((s, r) => s + r.betAmt, 0),
            betTimes: rows.reduce((s, r) => s + r.betTimes, 0),
            withdrawAmount: rows.reduce((s, r) => s + r.withdrawAmt, 0),
            withdrawTimes: rows.reduce((s, r) => s + (r.withdrawTimes || 0), 0)
        };
    }

    console.log(`\n[${TAG}] ========== 多渠道账号池构建完成 ==========`);
    for (const [ch, s] of Object.entries(summaryByChannel)) {
        console.log(`[${TAG}] ${ch}: packageId=${JSON.stringify(s.packageIds)} 共${s.total}人(老${s.oldCount}/新${s.newCount}) 充值${s.rechargeAmount.toFixed(2)}(${s.rechargeTimes}次) 投注${s.betAmount.toFixed(2)}(${s.betTimes}次) 提现${s.withdrawAmount.toFixed(2)}(${s.withdrawTimes}次)`);
    }
    console.log(`[${TAG}] 渠道→packageId映射(供事后单独验证时直接传给验证脚本): ${JSON.stringify(channelPackageIds)}`);
    console.log(`[${TAG}] 本次涉及的全部userId: ${JSON.stringify(allRecords.map(r => r.userId))}`);

    return { records: allRecords, summaryByChannel, channelPackageIds };
}
