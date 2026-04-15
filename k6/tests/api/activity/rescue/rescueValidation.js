import { logger } from '../../../../libs/utils/logger.js';
import { sendQueryRequest, sendRequest } from '../../common/request.js';
import { createRescue } from './createRescue.js';
import { phoneRegister, emailRegister } from '../../login/register.test.js';
import { mobileAutoLoginFlow } from '../../login/MobileAutoLogin.test.js';
import { emailAutoLoginFlow } from '../../login/EmailAutoLogin.test.js';
import { hybridRecharge } from '../../recharge/rechargeService.js';
import { getBetToken } from '../../runbet/betToken.js';
import { isBet } from '../../runbet/issueNumber.js';
import { betWingo } from '../../runbet/bet.js';
import { getTimeRandom } from '../../../utils/utils.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { sleep } from 'k6';

export const tag = `rescue-VU${__VU}`;

/**
 * 获取亏损救援金活动分页列表
 */
function getRescueActivityList(data) {
    const api = "/api/LossRelief/GetPageList";
    const timeData = getTimeRandom();
    const payload = {
        pageNo: 1,
        pageSize: 20,
        orderBy: "Desc",
        random: timeData.random,
        language: timeData.language,
        signature: "",
        timestamp: timeData.timestamp
    };

    let result = sendQueryRequest(payload, api, tag, false, data.token);
    if (typeof result !== 'object') {
        try {
            result = JSON.parse(result);
        } catch (e) {
            return null;
        }
    }
    return result;
}

/**
 * 随机获取 VIP 用户
 */
function getRandomVipUser(data, vipLevel) {
    const api = "/api/Users/GetPageList";
    const timeData = getTimeRandom();

    // 随机增加分页偏移，减少并发冲突
    const randomPage = Math.floor(Math.random() * 5) + 1;

    const payload = {
        vipLevel: vipLevel,
        pageNo: randomPage,
        pageSize: 20,
        orderBy: "Desc",
        random: timeData.random,
        language: timeData.language,
        signature: "",
        timestamp: timeData.timestamp
    };
    let result = sendQueryRequest(payload, api, tag, false, data.token);
    if (typeof result !== 'object') {
        try {
            result = JSON.parse(result);
        } catch (e) {
            return null;
        }
    }

    if (result && result.list && result.list.length > 0) {
        // 随机取一个对应的账号
        const idx = Math.floor(Math.random() * result.list.length);
        return result.list[idx];
    } else if (result && result.data && Array.isArray(result.data.list) && result.data.list.length > 0) {
        const idx = Math.floor(Math.random() * result.data.list.length);
        return result.data.list[idx];
    }
    return null;
}

/**
 * 获取用户的真实登录账号
 */
function getUserAccountByUid(data, userId) {
    const api = "/api/Users/GetUserAccount";
    const timeData = getTimeRandom();
    const payload = {
        userId: userId,
        random: timeData.random,
        language: timeData.language,
        signature: "",
        timestamp: timeData.timestamp
    };
    let result = sendQueryRequest(payload, api, tag, false, data.token);
    console.log("");
    console.log("result------", result)
    console.log("");
    if (typeof result !== 'object') {
        try {
            result = JSON.parse(result);
        } catch (e) {
            return null;
        }
    }
    return result;
}

/**
 * 获取亏损救援金活动详情及分析策略 (供 setup 调用或独立调用)
 */
export function getRescueActivityDetail(data) {
    const listRes = getRescueActivityList(data);

    let listInfo = null;
    if (listRes && listRes.data && Array.isArray(listRes.data.list)) {
        listInfo = listRes.data.list;
    } else if (listRes && Array.isArray(listRes.list)) {
        listInfo = listRes.list;
    }

    if (!listInfo || listInfo.length === 0) {
        return null;
    }

    // 找到状态为进行的活动
    const activeActivity = listInfo.find(item => item.activityStatus === 1 && item.state === 1);
    if (!activeActivity) {
        return null;
    }

    const rewardConfig = activeActivity.rewardConfigDetail.rewardConfig;
    if (!rewardConfig || rewardConfig.length === 0) {
        return null;
    }

    const targetDetailStr = activeActivity.targetDetail || "";
    const vipArr = targetDetailStr.split(',').filter(x => x !== "").map(Number);

    return {
        activeActivity,
        rewardConfig,
        vipArr,
        targetIncludesZero: vipArr.includes(0)
    };
}

/**
 * 亏损救援金验证逻辑主流程
 */
export function validateRescue(data) {
    const strategy = data.strategy;
    if (!strategy) {
        logger.error(`[${tag}] 缺少活动策略配置，验证中止。`);
        return;
    }

    const { activeActivity, rewardConfig, vipArr, targetIncludesZero } = strategy;

    logger.info(`[${tag}] 开始执行亏损救援金验证逻辑`);
    logger.info(`[${tag}] 发现正在进行的活动: ${activeActivity.activityName} (ID: ${activeActivity.id})`);

    // 3. 读取和解析配置参数
    if (!activeActivity.rewardConfigDetail) {
        logger.error(`[${tag}] 活动缺少 rewardConfigDetail 参与条件字段配置，中断操作。`);
        return;
    }

    // 取第一项的最低亏损金额作为触发指标基准
    const minLossAmount = rewardConfig[0].minLossAmount || 0;
    if (minLossAmount <= 0) {
        logger.error(`[${tag}] 读取第一档次要求亏损额为 0，这不合理，中止。`);
        return;
    }
    logger.info(`[${tag}] 将用于触发的目标亏损基准金额 (minLossAmount) 为: ${minLossAmount}`);

    // 4. 解析目标群体条件并选定账号
    const limitGame = activeActivity.limitGame;
    if (limitGame && limitGame.length > 0) {
        const arLotteryDisabled = limitGame.some(g => g.vendorCode === "ARLottery");
        if (arLotteryDisabled) {
            logger.warn(`[${tag}] 警告：该活动禁用 ARLottery (彩票) 作为亏损累计条件。本验证脚本基于彩票流程设计，因此无法进行后续验证测试，退出执行。`);
            return;
        }
    }

    let choosedVip = -1;
    let targetAccount = null;
    let userRecord = null;

    // 逻辑调整：如果测试策略规定包含 0，则优先进入 VIP0 (新注册) 流程。
    if (targetIncludesZero) {
        choosedVip = 0;
        logger.info(`[${tag}] 活动允许 VIP 0，测试策略指定进入新用户注册验证流程。`);
    } else {
        logger.info(`[${tag}] 活动不包含 VIP 0，将从允许的 VIP 等级 [${vipArr}] 中抽取存量用户进行测试。`);
        const shuffledVips = vipArr.sort(() => Math.random() - 0.5);
        for (let vipIndex of shuffledVips) {
            userRecord = getRandomVipUser(data, vipIndex);
            if (userRecord) {
                choosedVip = vipIndex;
                break;
            }
        }
    }

    let isPhoneUser = false;
    let loginToken = "";

    if (choosedVip === -1) {
        logger.error(`[${tag}] 没有找到所有符合VIP参与条件的会员。所有随机匹配皆无法匹配到账号，中断操作。`);
        return;
    }

    logger.info(`[${tag}] 命中的 VIP 等级为: ${choosedVip}`);

    // ======================================
    //     注册/获取账号 并 登录获取Token
    // ======================================
    if (choosedVip === 0) {
        // 1. 并发错峰：让不同的 VU 稍微错开启动时间，避免由于 IP 频率限制导致发送验证码失败
        if (__VU > 1) {
            const staggerTime = (__VU - 1) * 2;
            logger.info(`[${tag}] 并发避让：VU-${__VU} 等待 ${staggerTime} 秒后再启动...`);
            sleep(staggerTime);
        }

        const mobilePrefix = data.envConfig?.COUNTRY_CODE || "91";
        const randomPart = Math.floor(Math.random() * 10000000).toString().padStart(7, '0');
        const vuSuffix = (__VU % 100).toString().padStart(2, '0');
        const randomStr = "9" + randomPart + vuSuffix;

        targetAccount = mobilePrefix + randomStr;
        isPhoneUser = true;

        logger.info(`[${tag}] 准备进行手机号注册: ${targetAccount}`);
        let regData = phoneRegister(targetAccount, data);

        if (!regData) {
            // 记录详尽的失败警告，以便通过日志确认是“没拿到验证码”还是“接口报错”
            logger.warn(`[${tag}] ⚠️ 注意：手机号注册路径未跑通（可能是验证码限流或格式问题）。正在按既定逻辑尝试【邮箱兜底】...`);
            targetAccount = `tester${randomStr}@gmail.com`;
            isPhoneUser = false;
            regData = emailRegister(targetAccount, data);

            if (!regData) {
                logger.error(`[${tag}] ❌ 手机号和邮箱注册均失败，该线程验证终止。`);
                return;
            }
        }

        // 注册之后使用自动登录拿取前台Token
        if (isPhoneUser) {
            loginToken = mobileAutoLoginFlow(targetAccount, data);
        } else {
            loginToken = emailAutoLoginFlow(targetAccount, data);
        }
    } else {
        // VIP > 0 从现有的账号里找来的
        logger.info(`[${tag}] 以目标VIP查找获取到可操作后台绑定的用户ID: ${userRecord.userId}`);
        const userAccountData = getUserAccountByUid(data, userRecord.userId);

        let rawAccount = null;

        if (typeof userAccountData === 'object' && userAccountData !== null) {
            if (userAccountData.code !== 0) {
                logger.error(`[${tag}] 获取用户账号失败 (此接口报错提示可能没有该权限)。所有的后续操作终止。`);
                return;
            }
            rawAccount = userAccountData.data || userAccountData.account;
        } else {
            // 如果接口直接返回了账号字符串或数字（如 912026011001）
            rawAccount = userAccountData;
        }

        if (!rawAccount) {
            logger.error(`[${tag}] 从接口查回的实际账号值为空。`);
            return;
        }

        // 强制转换为字符串以便做格式化处理
        rawAccount = String(rawAccount);

        // 解析是手机号还是邮箱
        if (rawAccount.includes("@")) {
            targetAccount = rawAccount;
            isPhoneUser = false;
        } else {
            // 是手机号 - 不再裁切区号，返回什么就用什么登录
            targetAccount = rawAccount;
            isPhoneUser = true;
        }

        logger.info(`[${tag}] 还原真实账号以用于前台登录: ${targetAccount}`);

        // 使用现有账号执行自动登录那去前台Token
        if (isPhoneUser) {
            loginToken = mobileAutoLoginFlow(targetAccount, data);
        } else {
            loginToken = emailAutoLoginFlow(targetAccount, data);
        }
    }

    if (!loginToken) {
        logger.error(`[${tag}] 前台登录失败，未能拿到 user loginToken，后续充值和投注中止。`);
        return;
    }

    logger.info(`[${tag}] 成功获取前台登录Token，准备混合充值与强制打新消耗...`);

    // 获取新账号或存量账号的 UID
    let frontUserId = -1;
    if (choosedVip > 0 && userRecord && userRecord.userId) {
        frontUserId = userRecord.userId;
        logger.info(`[${tag}] 使用存量用户的 UID: ${frontUserId}`);
    } else {
        // 调用标准模块获取前台用户信息
        const userInfo = getFrontUserInfo(loginToken);
        if (userInfo && userInfo.userId) {
            frontUserId = userInfo.userId;
            logger.info(`[${tag}] 成功通过 GetUserInfo 获取到 UID: ${frontUserId}`);
        } else {
            logger.error(`[${tag}] 无法获取新用户的 UID，后台充值兜底映射失败。`);
        }
    }

    logger.info(`[${tag}] 最终确定的充值目标 UID: ${frontUserId}`);

    // 充值金额读取配置范围，且必须满足触发活动的最低要求（minLossAmount * 2）
    const minAmt = data.envConfig.RECHARGE_AMOUNT_MIN || 2000;
    const maxAmt = data.envConfig.RECHARGE_AMOUNT_MAX || 5000;
    const randomAmount = Math.floor(Math.random() * (maxAmt - minAmt + 1)) + minAmt;

    // 确保金额足以触发活动（minLossAmount * 2）
    const triggerAmount = minLossAmount * 2;
    const depositAmount = Math.max(randomAmount, triggerAmount);

    logger.info(`[${tag}] 配置范围: ${minAmt}-${maxAmt}, 触发要求: ${triggerAmount}`);
    logger.info(`[${tag}] 最终确定的充值额: ${depositAmount}`);

    // 这里需要构建混合充值 options
    if (frontUserId > 0) {
        const rechargeResult = hybridRecharge({
            userToken: loginToken,
            adminToken: data.token, // Administrator token
            userId: frontUserId,
            amount: depositAmount,
            frontendFirst: true,
            remark: 'Rescue activity deposit'
        });

        if (!rechargeResult.success) {
            logger.error(`[${tag}] 充值策略失败。亏损验证流程中止。`);
            return;
        }

        // 充值成功后等待 5 秒，确保余额到账并同步到彩票系统
        logger.info(`[${tag}] 充值成功，等待 5 秒后准备投注...`);
        sleep(5);
    }

    // 5. 进行单次单量大额投注（引入随机性以模拟真实行为）
    // 随机选择游戏 (仅包含系统当前支持的种类: WinGo 和 TrxWinGo)
    const gameCodes = [
        "TrxWinGo_10M", "TrxWinGo_1M", "TrxWinGo_3M", "TrxWinGo_5M",
        "WinGo_1M", "WinGo_30S", "WinGo_3M", "WinGo_5M"
    ];
    const gameCode = gameCodes[Math.floor(Math.random() * gameCodes.length)];
    logger.info(`[${tag}] 准备进入投注阶段，随机选定游戏: ${gameCode}`);

    const tokenInfo = getBetToken(loginToken, gameCode);
    if (!tokenInfo || !tokenInfo.token) {
        logger.error(`[${tag}] 获取投注token失败，彩票授权流程中止。`);
        return;
    }

    // 投注前金额确认
    logger.info(`[${tag}] 投注前账户余额确认: ${tokenInfo.balance}`);

    // 获取期号
    let betInfo = null;
    let retryCount = 0;
    while (retryCount < 3) {
        betInfo = isBet(tokenInfo.gameToken, gameCode, tokenInfo.gameBaseUrl);
        if (betInfo && betInfo.canBet) {
            break;
        }
        logger.warn(`[${tag}] 当前期号不可投注，5秒后重试...`);
        sleep(5);
        retryCount++;
    }

    if (!betInfo || !betInfo.canBet) {
        logger.error(`[${tag}] 无法获取可投注期号，终止本次验证。`);
        return;
    }

    // 随机选择投注内容 (仅限 WinGo 接口支持的标准玩法)
    const betContentList = [
        "Color_Green", "Color_Red", "Color_Violet",
        "BigSmall_Big", "BigSmall_Small"
    ];
    const betContent = betContentList[Math.floor(Math.random() * betContentList.length)];

    // 最终计算投注金额：确保达到最小亏损门槛
    const targetBetAmount = minLossAmount;
    const betMultiple = 2;

    logger.info(`[${tag}] >>> 关键下单步骤 (随机模式) <<<`);
    logger.info(`[${tag}] 游戏: ${gameCode}, 期号: ${betInfo.issueNumber}, 内容: ${betContent}, 总额: ${targetBetAmount * betMultiple}, 账户余额: ${tokenInfo.balance}`);

    const betResult = betWingo(gameCode, targetBetAmount, betMultiple, betContent, betInfo.issueNumber, tokenInfo.token, tokenInfo.gameBaseUrl);

    if (betResult && (betResult.code === 0 || betResult.msg === 'Succeed')) {
        logger.info(`[${tag}] ✅ 投注下单执行成功。`);
    } else {
        logger.error(`[${tag}] ❌ 投注下单执行失败: ${JSON.stringify(betResult)}`);
    }

    if (betResult && betResult.code === 0 && betResult.msgCode === 0) {
        logger.info(`[${tag}] ✅ 【验证核心步骤成功】 彩票已成功成功投注 ${targetBetAmount * betMultiple} 元作为触发金额，等待开奖如被判定亏损则直接纳入福利金门槛计算，验证结束。`);
    } else {
        logger.error(`[${tag}] ❌ 投注执行失败。`);
    }
}
