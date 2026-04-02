
import { AdminLogin } from '../login/adminlogin.test.js';
import { createCoupon } from '../activity/coupon/createCoupon.js';
import { createSignin } from '../activity/signin/createSignin.js';
import { createRedRainActivity } from '../activity/RedRainActivity/createRedRainActivity.js';
import { createChampion } from '../activity/champion/createChampion.js';
import { createluckyDoubleBonus } from '../activity/luckyDoubleBonus/createluckyDoubleBonus.js';
import { createGiftCodes } from '../activity/GiftCodes/createGiftCodes.js';
import { createMegaJackpot } from '../activity/MegaJackpot/createMegaJackpot.js';
import { createActivityGuide } from '../activity/activityGuide/createActivityGuide.js';
import { createBanner } from '../activity/banner/createBanner.js';
import { createCodeWashing } from '../activity/codeWashing/createCodeWashing.js';
import { createCustomizePopup } from '../activity/customizePopup/createCustomizePopup.js';
import { createDailyTasks } from '../activity/dailyTasks/createDailyTasks.js';
import { createGiftPack } from '../activity/giftPack/createGiftPack.js';
import { createInmail } from '../activity/inmail/createInmail.js';
import { createInviteTurntable } from '../activity/inviteTurntable/createInviteTurntable.js';
import { createLoginPopup } from '../activity/loginPopup/createLoginPopup.js';
import { createNewagent } from '../activity/newagent/createNewagent.js';
import { createNewagentRank } from '../activity/newagent/createNewagentRank.js';
import { createOrder } from '../activity/orderSystem/createOrder.js';
import { createRanking } from '../activity/ranking/createRanking.js';
import { createRechargeGiftPack } from '../activity/rechargeGiftPack/createRechargeGiftPack.js';
import { createRechargeWheel } from '../activity/rechargeWheel/createRechargeWheel.js';
import { createRescue } from '../activity/rescue/createRescue.js';
import { createTagfunc } from '../activity/tag/createTag.js';
import { createWeekCard } from '../activity/weekCard/createWeekCard.js';
import { createWithdrawalTimeout } from '../activity/withdrawalTimeout/createWithdrawalTimeout.js';
import { createSystemActive } from '../activity/systemActive/createSystemActive.js';

import { logger } from '../../../libs/utils/logger.js';
import { sleep } from 'k6';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { printLanguageConfig, getActiveLangs } from '../../../config/languageConfig.js';

// ==================== 活动配置映射表 ====================
// 所有活动使用 getActiveLangs() 自动支持多语言
const ACTIVITY_MAP = {
    'coupon': { name: '优惠券', handler: createCoupon },
    'signin': { name: '每日签到', handler: createSignin },
    'redRain': { name: '红包雨', handler: createRedRainActivity },
    'champion': { name: '锦标赛', handler: createChampion },
    'luckyDoubleBonus': { name: '幸运礼包', handler: createluckyDoubleBonus },
    'giftCodes': { name: '礼品码', handler: createGiftCodes },
    'megaJackpot': { name: '超级大奖', handler: createMegaJackpot },
    'activityGuide': { name: '引导活动', handler: createActivityGuide },
    'banner': { name: 'Banner', handler: createBanner },
    'codeWashing': { name: '洗码', handler: createCodeWashing },
    'customizePopup': { name: '定制化弹窗', handler: createCustomizePopup },
    'dailyTasks': { name: '每日任务', handler: createDailyTasks },
    'giftPack': { name: '礼包', handler: createGiftPack },
    'inmail': { name: '站内信', handler: createInmail },
    'inviteTurntable': { name: '邀请转盘', handler: createInviteTurntable },
    'loginPopup': { name: '登录前弹窗', handler: createLoginPopup },
    'newagent': { name: '新版代理', handler: createNewagent },
    'newagentRank': { name: '新版代理排行榜', handler: createNewagentRank },
    'order': { name: '工单系统', handler: createOrder },
    'ranking': { name: '会员排行榜', handler: createRanking },
    'rechargeGiftPack': { name: '充值礼包', handler: createRechargeGiftPack },
    'rechargeWheel': { name: '充值转盘', handler: createRechargeWheel },
    'rescue': { name: '救援金', handler: createRescue },
    'tag': { name: '标签', handler: createTagfunc },
    'weekCard': { name: '周卡月卡', handler: createWeekCard },
    'withdrawalTimeout': { name: '提现超时', handler: createWithdrawalTimeout },
    'systemActive': { name: '系统活动', handler: createSystemActive }
};

// ==================== setup：全局登录一次 ====================
export function setup() {
    try {
        // 固定使用3007租户
        const tenantId = '3007';
        logger.info(`[Setup] 目标租户: ${tenantId}`);

        // 切换到3007租户的环境配置
        logger.info(`[Setup] 切换到租户 ${tenantId} 的环境配置`);
        const targetEnv = getEnvByTenantId(tenantId);

        if (targetEnv) {
            logger.info(`[Setup]   前台域名: ${targetEnv.BASE_DESK_URL}`);
            logger.info(`[Setup]   后台域名: ${targetEnv.BASE_ADMIN_URL}`);
            logger.info(`[Setup]   管理员账号: ${targetEnv.ADMIN_USERNAME}`);
            logger.info(`[Setup]   国家区号: ${targetEnv.COUNTRY_CODE}`);

            // 更新 ENV_CONFIG
            Object.assign(ENV_CONFIG, targetEnv);
        } else {
            logger.error(`[Setup] 未找到租户 ${tenantId} 的配置`);
            throw new Error(`未找到租户 ${tenantId} 的配置`);
        }

        const token = AdminLogin();
        if (!token) {
            logger.error('AdminLogin 返回空值，登录失败');
            throw new Error('AdminLogin 返回空 token');
        }

        logger.info('[Setup] ✅ 管理员登录成功');

        // 获取租户的主要语言（用于系统活动等需要单一语言的场景）
        const activeLangs = getActiveLangs();
        const primaryLanguage = activeLangs[0] || 'zh';
        logger.info(`[Setup] 主要语言: ${primaryLanguage}`);

        return { token, tenantId, language: primaryLanguage };
    } catch (error) {
        logger.error('AdminLogin 发生异常:', error.message);
        throw new Error(`登录失败: ${error.message}`);
    }
}

// ==================== scenarios 定义 ====================
export const options = {
    scenarios: {
        sequentialExecution: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '600s' // 增加超时时间
        }
    },
};

// ==================== 主执行函数 ====================
export default function (data) {
    const tenantId = data.tenantId;

    // ✅ 重要：在 VU 中重新切换环境配置
    if (tenantId !== String(ENV_CONFIG.TENANTID)) {
        const targetEnv = getEnvByTenantId(tenantId);
        if (targetEnv) {
            Object.assign(ENV_CONFIG, targetEnv);
            logger.info(`[VU] 重新切换到租户 ${tenantId} 的环境配置`);
            logger.info(`[VU]   前台域名: ${ENV_CONFIG.BASE_DESK_URL}`);
            logger.info(`[VU]   后台域名: ${ENV_CONFIG.BASE_ADMIN_URL}`);
        }
    }

    logger.info(`========================================`);
    logger.info(`[VU] 开始为租户 ${tenantId} 创建多语言活动`);
    logger.info(`========================================`);

    // 打印当前语言配置
    printLanguageConfig();

    // 从环境变量读取要创建的活动类型（逗号分隔）
    // 例如：-e ACTIVITIES=coupon,signin
    // 默认只创建工单系统
    const activitiesEnv = __ENV.ACTIVITIES || 'order';
    const activityTypes = activitiesEnv.split(',').map(s => s.trim()).filter(Boolean);

    logger.info(`[VU] 要创建的活动: ${activityTypes.join(', ')}`);
    logger.info(`========================================`);

    let totalSuccess = 0;
    let totalFailed = 0;
    const failedActivities = []; // 收集失败的活动信息

    // 遍历要创建的活动类型
    activityTypes.forEach((activityType, index) => {
        const activityConfig = ACTIVITY_MAP[activityType];

        if (!activityConfig) {
            logger.error(`[VU] ❌ 未知的活动类型: ${activityType}`);
            logger.error(`[VU] 支持的活动类型: ${Object.keys(ACTIVITY_MAP).join(', ')}`);
            totalFailed++;
            failedActivities.push({
                type: activityType,
                name: activityType,
                reason: '未知的活动类型'
            });
            return;
        }

        logger.info(`\n========================================`);
        logger.info(`[VU] 第${index + 1}部分：创建${activityConfig.name}`);
        logger.info(`========================================`);
        logger.info(`${activityConfig.name}会自动为所有激活语言创建`);

        try {
            const result = activityConfig.handler(data);

            if (!result || !result.success) {
                const errorMsg = result?.message || '未知错误';
                logger.error(`${activityConfig.name}创建失败: ${errorMsg}`);
                totalFailed++;
                failedActivities.push({
                    type: activityType,
                    name: activityConfig.name,
                    reason: errorMsg
                });
            } else {
                logger.info(`✅ ${activityConfig.name}创建成功`);
                totalSuccess++;
            }
        } catch (error) {
            const errorMsg = error.message || String(error);
            logger.error(`${activityConfig.name}创建异常: ${errorMsg}`);
            totalFailed++;
            failedActivities.push({
                type: activityType,
                name: activityConfig.name,
                reason: `异常: ${errorMsg}`
            });
        }

        // 活动之间间隔3秒
        if (index < activityTypes.length - 1) {
            logger.info(`\n等待3秒后创建下一个活动...`);
            sleep(3);
        }
    });

    // ==================== 生成失败报告 ====================
    logger.info(`\n========================================`);
    logger.info(`[VU] 租户 ${tenantId} 活动创建完成`);
    logger.info(`[VU] 成功: ${totalSuccess}, 失败: ${totalFailed}`);
    logger.info(`========================================`);

    if (failedActivities.length > 0) {
        logger.info(`\n========================================`);
        logger.info(`[失败报告] 以下活动创建失败:`);
        logger.info(`========================================`);
        failedActivities.forEach((activity, index) => {
            logger.info(`${index + 1}. ${activity.name} (${activity.type})`);
            logger.info(`   原因: ${activity.reason}`);
        });
        logger.info(`========================================`);
    } else {
        logger.info(`\n✅ 所有活动创建成功！`);
    }
}
